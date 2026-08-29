#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Program {
    pub version: String,
    pub name: String,
    pub capabilities: Vec<CapabilityRequirement>,
    pub main: Function,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapabilityRequirement {
    pub id: String,
    pub digest: String,
    pub signer: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Function {
    pub effects: Vec<String>,
    pub statements: Vec<Statement>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Statement {
    Print(String),
    Return(i32),
}
