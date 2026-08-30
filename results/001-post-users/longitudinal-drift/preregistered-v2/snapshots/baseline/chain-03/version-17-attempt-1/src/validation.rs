use serde_json::Value;

pub(crate) struct NewUser<'a> {
    pub(crate) name: &'a str,
    pub(crate) email: &'a str,
}

pub(crate) enum Error {
    InvalidJson,
    InvalidName,
    InvalidEmail,
}

pub(crate) fn new_user(body: &Value) -> Result<NewUser<'_>, Error> {
    let Some(body) = body.as_object() else {
        return Err(Error::InvalidJson);
    };
    if body.len() != 2 || !body.contains_key("name") || !body.contains_key("email") {
        return Err(Error::InvalidJson);
    }
    let Some(name_value) = body.get("name").and_then(Value::as_str) else {
        return Err(Error::InvalidJson);
    };
    let Some(email_value) = body.get("email").and_then(Value::as_str) else {
        return Err(Error::InvalidJson);
    };
    if !name(name_value) {
        return Err(Error::InvalidName);
    }
    if !email(email_value) {
        return Err(Error::InvalidEmail);
    }
    Ok(NewUser {
        name: name_value,
        email: email_value,
    })
}

pub(crate) fn updated_name(body: &Value) -> Result<&str, Error> {
    let Some(body) = body.as_object() else {
        return Err(Error::InvalidJson);
    };
    if body.len() != 1 {
        return Err(Error::InvalidJson);
    }
    let Some(name_value) = body.get("name").and_then(Value::as_str) else {
        return Err(Error::InvalidJson);
    };
    if !name(name_value) {
        return Err(Error::InvalidName);
    }
    Ok(name_value)
}

pub(crate) fn name(value: &str) -> bool {
    let length = value.chars().count();
    (1..=100).contains(&length)
}

pub(crate) fn email(value: &str) -> bool {
    if value.bytes().any(|byte| byte.is_ascii_whitespace()) {
        return false;
    }
    let mut parts = value.split('@');
    let Some(local) = parts.next() else {
        return false;
    };
    let Some(domain) = parts.next() else {
        return false;
    };
    if parts.next().is_some() || local.is_empty() || domain.is_empty() {
        return false;
    }
    if domain.starts_with('.') || domain.ends_with('.') || !domain.contains('.') {
        return false;
    }
    !domain.split('.').any(str::is_empty)
}

#[cfg(test)]
mod tests {
    use super::{email, name};

    #[test]
    fn accepts_one_through_one_hundred_unicode_scalars() {
        assert!(name("a"));
        assert!(name(&"🙂".repeat(100)));
    }

    #[test]
    fn rejects_empty_and_more_than_one_hundred_unicode_scalars() {
        assert!(!name(""));
        assert!(!name(&"🙂".repeat(101)));
    }

    #[test]
    fn counts_unicode_scalars_instead_of_utf8_bytes() {
        assert!(name(&"é".repeat(100)));
        assert!(!name(&"é".repeat(101)));
    }

    #[test]
    fn preserves_email_validation_rules() {
        assert!(email("ada@example.com"));
        assert!(!email("ada example@example.com"));
        assert!(!email("ada@example"));
        assert!(!email("ada@@example.com"));
    }
}
