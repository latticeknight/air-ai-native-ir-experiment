#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Program {
    pub version: String,
    pub name: String,
    pub capabilities: Vec<CapabilityRequirement>,
    pub body: ProgramBody,
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
pub enum ProgramBody {
    Command(Function),
    UserService(Box<UserService>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserService {
    pub input: RecordDefinition,
    pub output: RecordDefinition,
    pub error: ErrorDefinition,
    pub handler: UserHandler,
    pub endpoint: Endpoint,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordDefinition {
    pub name: String,
    pub fields: Vec<Field>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Field {
    pub name: String,
    pub type_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErrorDefinition {
    pub name: String,
    pub variants: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserHandler {
    pub name: String,
    pub input_binding: String,
    pub input_type: String,
    pub output_type: String,
    pub error_type: String,
    pub effects: Vec<String>,
    pub preconditions: Vec<String>,
    pub postconditions: Vec<String>,
    pub insert: InsertOperation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InsertOperation {
    pub capability: String,
    pub table: String,
    pub values: Vec<FieldValue>,
    pub result_binding: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldValue {
    pub field: String,
    pub expression: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub method: String,
    pub path: String,
    pub handler: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Statement {
    Print(String),
    Return(i32),
}
