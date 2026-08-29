use crate::ast::{CapabilityRequirement, Function, Program, Statement};

#[derive(Debug, Clone, PartialEq, Eq)]
enum TokenKind {
    Atom(String),
    String(String),
    Symbol(char),
    Arrow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Token {
    kind: TokenKind,
    line: usize,
    column: usize,
}

pub fn parse(source: &str) -> Result<Program, String> {
    Parser::new(lex(source)?).parse_program()
}

struct Parser {
    tokens: Vec<Token>,
    cursor: usize,
}

impl Parser {
    fn new(tokens: Vec<Token>) -> Self {
        Self { tokens, cursor: 0 }
    }

    fn parse_program(mut self) -> Result<Program, String> {
        self.expect_atom("air")?;
        let version = self.take_atom("AIR version")?;
        self.expect_symbol(';')?;

        self.expect_atom("program")?;
        let name = self.take_atom("program name")?;
        self.expect_symbol(';')?;

        self.expect_atom("requires")?;
        self.expect_symbol('{')?;
        let mut capabilities = Vec::new();
        while !self.peek_symbol('}') {
            capabilities.push(self.parse_capability()?);
        }
        self.expect_symbol('}')?;

        let main = self.parse_main()?;
        if let Some(token) = self.peek() {
            return Err(at(token, "unexpected content after main function"));
        }

        Ok(Program {
            version,
            name,
            capabilities,
            main,
        })
    }

    fn parse_capability(&mut self) -> Result<CapabilityRequirement, String> {
        self.expect_atom("capability")?;
        let id = self.take_atom("capability id")?;
        self.expect_atom("digest")?;
        let digest = self.take_string("quoted capability digest")?;
        self.expect_atom("signed-by")?;
        let signer = self.take_string("quoted signer id")?;
        self.expect_symbol(';')?;
        Ok(CapabilityRequirement { id, digest, signer })
    }

    fn parse_main(&mut self) -> Result<Function, String> {
        self.expect_atom("fn")?;
        self.expect_atom("main")?;
        self.expect_symbol('(')?;
        self.expect_symbol(')')?;
        self.expect_arrow()?;
        self.expect_atom("i32")?;

        self.expect_atom("effects")?;
        self.expect_symbol('{')?;
        let mut effects = Vec::new();
        while !self.peek_symbol('}') {
            effects.push(self.take_atom("effect capability id")?);
            self.expect_symbol(';')?;
        }
        self.expect_symbol('}')?;

        self.expect_symbol('{')?;
        let mut statements = Vec::new();
        while !self.peek_symbol('}') {
            statements.push(self.parse_statement()?);
        }
        self.expect_symbol('}')?;

        Ok(Function {
            effects,
            statements,
        })
    }

    fn parse_statement(&mut self) -> Result<Statement, String> {
        let token = self
            .peek()
            .cloned()
            .ok_or_else(|| "unexpected end of input".to_string())?;
        match &token.kind {
            TokenKind::Atom(value) if value == "print" => {
                self.cursor += 1;
                let value = self.take_string("quoted text after print")?;
                self.expect_symbol(';')?;
                Ok(Statement::Print(value))
            }
            TokenKind::Atom(value) if value == "return" => {
                self.cursor += 1;
                let value = self.take_atom("integer after return")?;
                let parsed = value
                    .parse::<i32>()
                    .map_err(|_| at(&token, "return value must be an i32 integer"))?;
                self.expect_symbol(';')?;
                Ok(Statement::Return(parsed))
            }
            _ => Err(at(&token, "expected print or return statement")),
        }
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.cursor)
    }

    fn peek_symbol(&self, expected: char) -> bool {
        matches!(self.peek().map(|token| &token.kind), Some(TokenKind::Symbol(actual)) if *actual == expected)
    }

    fn expect_atom(&mut self, expected: &str) -> Result<(), String> {
        let token = self
            .tokens
            .get(self.cursor)
            .ok_or_else(|| format!("unexpected end of input; expected {expected}"))?;
        match &token.kind {
            TokenKind::Atom(actual) if actual == expected => {
                self.cursor += 1;
                Ok(())
            }
            _ => Err(at(token, &format!("expected `{expected}`"))),
        }
    }

    fn take_atom(&mut self, description: &str) -> Result<String, String> {
        let token = self
            .tokens
            .get(self.cursor)
            .ok_or_else(|| format!("unexpected end of input; expected {description}"))?;
        match &token.kind {
            TokenKind::Atom(value) => {
                self.cursor += 1;
                Ok(value.clone())
            }
            _ => Err(at(token, &format!("expected {description}"))),
        }
    }

    fn take_string(&mut self, description: &str) -> Result<String, String> {
        let token = self
            .tokens
            .get(self.cursor)
            .ok_or_else(|| format!("unexpected end of input; expected {description}"))?;
        match &token.kind {
            TokenKind::String(value) => {
                self.cursor += 1;
                Ok(value.clone())
            }
            _ => Err(at(token, &format!("expected {description}"))),
        }
    }

    fn expect_symbol(&mut self, expected: char) -> Result<(), String> {
        let token = self
            .tokens
            .get(self.cursor)
            .ok_or_else(|| format!("unexpected end of input; expected `{expected}`"))?;
        match token.kind {
            TokenKind::Symbol(actual) if actual == expected => {
                self.cursor += 1;
                Ok(())
            }
            _ => Err(at(token, &format!("expected `{expected}`"))),
        }
    }

    fn expect_arrow(&mut self) -> Result<(), String> {
        let token = self
            .tokens
            .get(self.cursor)
            .ok_or_else(|| "unexpected end of input; expected `->`".to_string())?;
        if token.kind == TokenKind::Arrow {
            self.cursor += 1;
            Ok(())
        } else {
            Err(at(token, "expected `->`"))
        }
    }
}

fn at(token: &Token, message: &str) -> String {
    format!("{}:{}: {message}", token.line, token.column)
}

fn lex(source: &str) -> Result<Vec<Token>, String> {
    let chars: Vec<char> = source.chars().collect();
    let mut tokens = Vec::new();
    let mut cursor = 0;
    let mut line = 1;
    let mut column = 1;

    while cursor < chars.len() {
        let current = chars[cursor];
        if current == '\n' {
            cursor += 1;
            line += 1;
            column = 1;
            continue;
        }
        if current.is_whitespace() {
            cursor += 1;
            column += 1;
            continue;
        }
        if current == '#' {
            while cursor < chars.len() && chars[cursor] != '\n' {
                cursor += 1;
                column += 1;
            }
            continue;
        }

        let start_line = line;
        let start_column = column;
        if "{}();".contains(current) {
            tokens.push(Token {
                kind: TokenKind::Symbol(current),
                line: start_line,
                column: start_column,
            });
            cursor += 1;
            column += 1;
            continue;
        }
        if current == '-' && chars.get(cursor + 1) == Some(&'>') {
            tokens.push(Token {
                kind: TokenKind::Arrow,
                line: start_line,
                column: start_column,
            });
            cursor += 2;
            column += 2;
            continue;
        }
        if current == '"' {
            cursor += 1;
            column += 1;
            let mut value = String::new();
            let mut terminated = false;
            while cursor < chars.len() {
                match chars[cursor] {
                    '"' => {
                        cursor += 1;
                        column += 1;
                        terminated = true;
                        break;
                    }
                    '\\' => {
                        let escape_column = column;
                        cursor += 1;
                        column += 1;
                        let escaped = chars.get(cursor).ok_or_else(|| {
                            format!("{line}:{escape_column}: incomplete string escape")
                        })?;
                        value.push(match escaped {
                            'n' => '\n',
                            'r' => '\r',
                            't' => '\t',
                            '"' => '"',
                            '\\' => '\\',
                            _ => {
                                return Err(format!(
                                    "{line}:{escape_column}: unsupported string escape `\\{escaped}`"
                                ));
                            }
                        });
                        cursor += 1;
                        column += 1;
                    }
                    '\n' => {
                        return Err(format!(
                            "{start_line}:{start_column}: strings cannot contain literal newlines"
                        ));
                    }
                    character => {
                        value.push(character);
                        cursor += 1;
                        column += 1;
                    }
                }
            }
            if !terminated {
                return Err(format!(
                    "{start_line}:{start_column}: unterminated string literal"
                ));
            }
            tokens.push(Token {
                kind: TokenKind::String(value),
                line: start_line,
                column: start_column,
            });
            continue;
        }

        let mut value = String::new();
        while cursor < chars.len() {
            let character = chars[cursor];
            if character.is_whitespace()
                || "{}();\"#".contains(character)
                || (character == '-' && chars.get(cursor + 1) == Some(&'>'))
            {
                break;
            }
            value.push(character);
            cursor += 1;
            column += 1;
        }
        if value.is_empty() {
            return Err(format!(
                "{start_line}:{start_column}: unexpected character `{current}`"
            ));
        }
        tokens.push(Token {
            kind: TokenKind::Atom(value),
            line: start_line,
            column: start_column,
        });
    }

    Ok(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: &str = r#"
air 0.1;
program hello;
requires {
  capability wasi:stdout@1
    digest "sha256:abc"
    signed-by "air:foundation";
}
fn main() -> i32
effects { wasi:stdout@1; }
{
  print "hello\n";
  return 0;
}
"#;

    #[test]
    fn parses_the_mvp_language() {
        let program = parse(SOURCE).expect("valid AIR should parse");
        assert_eq!(program.version, "0.1");
        assert_eq!(program.name, "hello");
        assert_eq!(
            program.main.statements[0],
            Statement::Print("hello\n".into())
        );
    }

    #[test]
    fn reports_source_location() {
        let error = parse("air 0.1; program x; requires {} nope").unwrap_err();
        assert!(error.contains("1:33"), "{error}");
    }
}
