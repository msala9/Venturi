use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Clone, Debug)]
pub struct ApiError(pub StatusCode, pub &'static str, pub &'static str);

impl ApiError {
    pub fn invalid(message: &'static str) -> Self {
        Self(
            StatusCode::UNPROCESSABLE_ENTITY,
            "INVALID_OPERATION",
            message,
        )
    }
    pub fn conflict(code: &'static str, message: &'static str) -> Self {
        Self(StatusCode::CONFLICT, code, message)
    }
    pub fn io() -> Self {
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "IO_ERROR",
            "The project file operation failed",
        )
    }
    pub fn missing() -> Self {
        Self(
            StatusCode::NOT_FOUND,
            "NOT_FOUND",
            "The requested resource does not exist",
        )
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.0,
            Json(json!({"error":{"code":self.1,"message":self.2,"recoverable":true,"details":{}}})),
        )
            .into_response()
    }
}
pub type Result<T> = std::result::Result<T, ApiError>;
