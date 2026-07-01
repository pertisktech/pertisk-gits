use thiserror::Error;

#[derive(Debug, Error)]
pub enum DomainError {
    #[error("not found")]
    NotFound,
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden")]
    Forbidden,
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("validation error: {0}")]
    Validation(String),
    #[error("internal error: {0}")]
    Internal(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_messages() {
        assert_eq!(DomainError::NotFound.to_string(), "not found");
        assert_eq!(DomainError::Unauthorized.to_string(), "unauthorized");
        assert_eq!(
            DomainError::Conflict("dup".into()).to_string(),
            "conflict: dup"
        );
        assert_eq!(
            DomainError::Validation("bad".into()).to_string(),
            "validation error: bad"
        );
        assert_eq!(DomainError::Forbidden.to_string(), "forbidden");
        assert_eq!(
            DomainError::Internal("oops".into()).to_string(),
            "internal error: oops"
        );
    }
}
