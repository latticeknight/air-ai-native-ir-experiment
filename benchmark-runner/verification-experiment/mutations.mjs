const emailPrefix = `    let bytes = email.as_bytes();
    if bytes.len() < 5 || bytes.iter().any(|byte| byte.is_ascii_whitespace()) {
        return false;
    }`;

const emailSuffix = `    at > 0
        && bytes[at + 1..]
            .iter()
            .enumerate()
            .any(|(offset, byte)| *byte == b'.' && offset > 0 && at + offset + 2 < bytes.len())`;

const exactAtLoop = `        if byte == b'@' {
            if at.is_some() {
                return false;
            }
            at = Some(index);
        }`;

const wasmResult = `    #[cfg(target_arch = "wasm32")]
    let result = unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) };

    #[cfg(not(target_arch = "wasm32"))]
    let result = STORAGE_FAILURE;`;

export const candidateManifest = `[package]
name = "mutation-candidate"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[profile.release]
codegen-units = 1
lto = true
opt-level = "s"
panic = "abort"
strip = true
`;

export const mutations = [
  {
    id: "accept-domain-without-dot",
    defect: "The guest accepts an address whose domain contains no dot.",
    category: "input_validation",
    expected_baseline_detection: false,
    ordinary_equivalent: "An additional integration test or asserted JSON Schema format implementation.",
    mutateSource: (source) => replaceExact(source, emailSuffix, "    at > 0 && at + 1 < bytes.len()"),
  },
  {
    id: "accept-multiple-at",
    defect: "The guest accepts an address containing more than one at sign.",
    category: "input_validation",
    expected_baseline_detection: false,
    ordinary_equivalent: "An additional integration test or asserted JSON Schema format implementation.",
    mutateSource: (source) =>
      replaceExact(
        source,
        exactAtLoop,
        `        if byte == b'@' {
            at = Some(index);
        }`,
      ),
  },
  {
    id: "accept-ascii-whitespace",
    defect: "The guest accepts an email containing ASCII whitespace.",
    category: "input_validation",
    expected_baseline_detection: false,
    ordinary_equivalent: "An additional integration test or asserted JSON Schema format implementation.",
    mutateSource: (source) =>
      replaceExact(
        source,
        emailPrefix,
        `    let bytes = email.as_bytes();
    if bytes.len() < 5 {
        return false;
    }`,
      ),
  },
  {
    id: "accept-leading-domain-dot",
    defect: "The guest accepts an email whose domain begins with a dot.",
    category: "input_validation",
    expected_baseline_detection: false,
    ordinary_equivalent: "An additional integration test or asserted JSON Schema format implementation.",
    mutateSource: (source) =>
      replaceExact(
        source,
        emailSuffix,
        `    at > 0
        && bytes[at + 1..]
            .iter()
            .enumerate()
            .any(|(offset, byte)| *byte == b'.' && at + offset + 2 < bytes.len())`,
      ),
  },
  {
    id: "accept-trailing-domain-dot",
    defect: "The guest accepts an email whose domain ends with a dot.",
    category: "input_validation",
    expected_baseline_detection: false,
    ordinary_equivalent: "An additional integration test or asserted JSON Schema format implementation.",
    mutateSource: (source) =>
      replaceExact(
        source,
        emailSuffix,
        `    at > 0
        && bytes[at + 1..]
            .iter()
            .enumerate()
            .any(|(offset, byte)| *byte == b'.' && offset > 0)`,
      ),
  },
  {
    id: "accept-empty-name",
    defect: "The guest permits an empty name.",
    category: "input_validation",
    expected_baseline_detection: true,
    ordinary_equivalent: "The existing integration test.",
    mutateSource: (source) =>
      replaceExact(source, "    if name.is_empty() {", "    if false && name.is_empty() {"),
  },
  {
    id: "allow-duplicate-email",
    defect: "The guest converts the duplicate-email result into a successful ID.",
    category: "business_invariant",
    expected_baseline_detection: true,
    ordinary_equivalent: "The existing duplicate integration test.",
    mutateSource: (source) =>
      replaceExact(
        source,
        "        DUPLICATE_EMAIL => DUPLICATE_EMAIL,",
        "        DUPLICATE_EMAIL => 1,",
      ),
  },
  {
    id: "fake-id-without-insert",
    defect: "The guest returns a positive ID without performing the declared insert.",
    category: "missing_effect",
    expected_baseline_detection: true,
    ordinary_equivalent: "A duplicate or database-state integration test.",
    mutateSource: (source) =>
      replaceExact(
        source,
        wasmResult,
        `    #[cfg(target_arch = "wasm32")]
    let result = if name_len < 0 {
        unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) }
    } else {
        1
    };

    #[cfg(not(target_arch = "wasm32"))]
    let result = STORAGE_FAILURE;`,
      ),
  },
  {
    id: "wrong-returned-id",
    defect: "The guest persists the row but returns an ID that does not identify it.",
    category: "postcondition",
    expected_baseline_detection: true,
    ordinary_equivalent: "The existing exact first-ID assertion or a database postcondition test.",
    mutateSource: (source) =>
      replaceExact(source, "        id if id > 0 => id,", "        id if id > 0 => id + 1000,"),
  },
  {
    id: "mask-storage-failure",
    defect: "The guest converts storage failure into a successful ID.",
    category: "error_mapping",
    expected_baseline_detection: true,
    ordinary_equivalent: "The existing unavailable-storage integration test.",
    mutateSource: (source) =>
      replaceExact(source, "        _ => STORAGE_FAILURE,", "        _ => 1,"),
  },
  {
    id: "environment-import",
    defect: "The guest requests an undeclared environment capability.",
    category: "capability",
    expected_baseline_detection: true,
    ordinary_equivalent: "A manually maintained Wasmtime import allowlist.",
    mutateSource: (source) => addForbiddenImport(source, "wasi_snapshot_preview1", "environ_sizes_get"),
  },
  {
    id: "outbound-http-import",
    defect: "The guest requests an undeclared outbound-network capability.",
    category: "capability",
    expected_baseline_detection: true,
    ordinary_equivalent: "A manually maintained Wasmtime import allowlist.",
    mutateSource: (source) => addForbiddenImport(source, "air_http_client_v1", "request"),
  },
  {
    id: "other-table-import",
    defect: "The guest requests a SQLite operation for an undeclared table.",
    category: "capability",
    expected_baseline_detection: true,
    ordinary_equivalent: "A manually maintained Wasmtime import allowlist.",
    mutateSource: (source) =>
      source
        .replace('fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;', 'fn insert_secrets(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;')
        .replace("unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) }", "unsafe { insert_secrets(name_ptr, name_len, email_ptr, email_len) }"),
  },
  {
    id: "undeclared-local-dependency",
    defect: "The candidate adds a direct dependency forbidden by the contract.",
    category: "dependency",
    expected_baseline_detection: false,
    ordinary_equivalent: "Cargo metadata plus a dependency policy tool.",
    mutateSource: (source) =>
      source.replace(
        "    // SAFETY: the benchmark host guarantees both pointer/length pairs for this call.",
        "    let _dependency_marker = mutation_helper::marker();\n\n    // SAFETY: the benchmark host guarantees both pointer/length pairs for this call.",
      ),
    mutateManifest: (manifest) => `${manifest}\n[dependencies]\nmutation-helper = { path = "helper" }\n`,
    extraFiles: {
      "helper/Cargo.toml": `[package]\nname = "mutation-helper"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n\n[lib]\npath = "src/lib.rs"\n`,
      "helper/src/lib.rs": "#![no_std]\n\npub fn marker() -> i32 { 7 }\n",
    },
  },
];

function addForbiddenImport(source, module, name) {
  const declaration = `
#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "${module}")]
extern "C" {
    fn ${name}(first: i32, second: i32) -> i32;
}
`;
  return source
    .replace(
      "/// Validate inputs and delegate the single permitted database operation to the host.",
      `${declaration}\n/// Validate inputs and delegate the single permitted database operation to the host.`,
    )
    .replace(
      "    // SAFETY: the benchmark host guarantees both pointer/length pairs for this call.",
      `    #[cfg(target_arch = "wasm32")]
    let _forbidden_probe = unsafe { ${name}(0, 0) };

    // SAFETY: the benchmark host guarantees both pointer/length pairs for this call.`,
    );
}

function replaceExact(value, from, to) {
  if (!value.includes(from)) throw new Error(`mutation source pattern not found: ${from.slice(0, 80)}`);
  return value.replace(from, to);
}
