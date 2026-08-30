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

pub(crate) fn profile_timezone(body: &Value) -> Result<&str, Error> {
    let Some(body) = body.as_object() else {
        return Err(Error::InvalidJson);
    };
    if body.len() != 1 {
        return Err(Error::InvalidJson);
    }
    let Some(timezone) = body.get("timezone").and_then(Value::as_str) else {
        return Err(Error::InvalidJson);
    };
    if timezone.is_empty() {
        return Err(Error::InvalidJson);
    }
    Ok(timezone)
}

pub(crate) fn name(value: &str) -> bool {
    let length = value.chars().count();
    (2..=80).contains(&length)
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
    use super::{email, name, profile_timezone};
    use serde_json::json;

    #[test]
    fn accepts_two_through_eighty_unicode_scalars() {
        assert!(name("ab"));
        assert!(name(&"🙂".repeat(80)));
    }

    #[test]
    fn rejects_fewer_than_two_and_more_than_eighty_unicode_scalars() {
        assert!(!name(""));
        assert!(!name("a"));
        assert!(!name(&"🙂".repeat(81)));
    }

    #[test]
    fn counts_unicode_scalars_instead_of_utf8_bytes() {
        assert!(name(&"é".repeat(80)));
        assert!(!name(&"é".repeat(81)));
    }

    #[test]
    fn preserves_email_validation_rules() {
        assert!(email("ada@example.com"));
        assert!(!email("ada example@example.com"));
        assert!(!email("ada@example"));
        assert!(!email("ada@@example.com"));
    }

    #[test]
    fn accepts_only_a_non_empty_timezone_field() {
        assert!(
            profile_timezone(&json!({ "timezone": "Europe/London" }))
                .is_ok_and(|timezone| timezone == "Europe/London")
        );
        assert!(profile_timezone(&json!({ "timezone": "" })).is_err());
        assert!(profile_timezone(&json!({ "timezone": "UTC", "extra": true })).is_err());
        assert!(profile_timezone(&json!("UTC")).is_err());
    }
}
