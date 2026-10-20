use crate::{
    commands::Mutation,
    error::{ApiError, Result},
    host::{Action, Host},
    preview::{FrameQuery, Preview},
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};

#[derive(Clone)]
pub struct AppState {
    pub host: Host,
    pub port: u16,
    pub preview: Preview,
}
pub fn router(state: AppState) -> Router {
    Router::new()
        .route(
            "/api/v1/health",
            get(|| async { Json(json!({"status":"ok","api_version":1})) }),
        )
        .route("/api/v1/session", get(session))
        .route("/api/v1/timelines/{id}", get(timeline))
        .route("/api/v1/projects", get(projects))
        .route("/api/v1/projects/commands", post(project_command))
        .route("/api/v1/timelines/{id}/commands", post(timeline_command))
        .route("/api/v1/commands/{id}", get(lookup))
        .route("/api/v1/lease", post(lease))
        .route("/api/v1/preview/frame", get(frame))
        .route("/api/v1/diagnostics", get(diagnostics))
        .fallback(assets)
        .layer(DefaultBodyLimit::max(64 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), security))
        .with_state(state)
}
async fn session(State(state): State<AppState>) -> Result<Json<Value>> {
    let mut snapshot = state.host.call(Action::Session).await?;
    snapshot["capabilities"]["preview"] = json!(state.preview.available());
    Ok(Json(snapshot))
}
async fn diagnostics(State(state): State<AppState>) -> Json<Value> {
    Json(json!({"preview":state.preview.diagnostic()}))
}
async fn frame(
    State(state): State<AppState>,
    query: std::result::Result<Query<FrameQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    if !state.preview.available() {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "GPU_UNAVAILABLE",
            "Start with an available AMD Vulkan adapter",
        ));
    }
    let query = query
        .map_err(|_| ApiError::invalid("Invalid preview query"))?
        .0;
    let snapshot = state.host.frame_snapshot(query).await?;
    let data = state.preview.frame(snapshot).await?;
    Ok(([(header::CONTENT_TYPE, "image/png")], data).into_response())
}
async fn timeline(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>> {
    state.host.call(Action::Timeline(id)).await.map(Json)
}
async fn projects(State(state): State<AppState>) -> Result<Json<Value>> {
    state.host.call(Action::Projects).await.map(Json)
}
async fn project_command(
    State(state): State<AppState>,
    payload: std::result::Result<Json<Mutation>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    state
        .host
        .call(Action::Mutation(
            None,
            payload
                .map_err(|_| ApiError::invalid("Invalid command JSON"))?
                .0,
        ))
        .await
        .map(Json)
}
async fn timeline_command(
    State(state): State<AppState>,
    Path(id): Path<String>,
    payload: std::result::Result<Json<Mutation>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    state
        .host
        .call(Action::Mutation(
            Some(id),
            payload
                .map_err(|_| ApiError::invalid("Invalid command JSON"))?
                .0,
        ))
        .await
        .map(Json)
}
async fn lookup(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>> {
    state.host.call(Action::Lookup(id)).await.map(Json)
}
#[derive(serde::Deserialize)]
struct Lease {
    client_id: String,
}
async fn lease(
    State(state): State<AppState>,
    payload: std::result::Result<Json<Lease>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    state
        .host
        .call(Action::Lease(
            payload
                .map_err(|_| ApiError::invalid("Invalid lease JSON"))?
                .0
                .client_id,
        ))
        .await
        .map(Json)
}

async fn security(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let allowed = [
        format!("127.0.0.1:{}", state.port),
        format!("localhost:{}", state.port),
        format!("[::1]:{}", state.port),
    ];
    if !allowed.iter().any(|value| value == host) {
        return ApiError(
            StatusCode::FORBIDDEN,
            "INVALID_HOST",
            "Use the configured loopback address",
        )
        .into_response();
    }
    if let Some(origin) = request.headers().get(header::ORIGIN)
        && origin.to_str().ok() != Some(format!("http://{host}").as_str())
    {
        return ApiError(
            StatusCode::FORBIDDEN,
            "INVALID_ORIGIN",
            "Cross-origin requests are refused",
        )
        .into_response();
    }
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    headers.insert(header::CONTENT_SECURITY_POLICY,"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'".parse().unwrap());
    headers.insert(header::REFERRER_POLICY, "no-referrer".parse().unwrap());
    response
}
async fn assets(request: Request) -> Response {
    macro_rules! asset {
        ($path:literal,$mime:literal) => {
            ($mime, include_str!(concat!("../../..", $path)))
        };
    }
    let (mime, body) = match request.uri().path() {
        "/" => asset!("/web/index.html", "text/html; charset=utf-8"),
        "/style/tokens.css" => asset!("/web/style/tokens.css", "text/css"),
        "/style/app.css" => asset!("/web/style/app.css", "text/css"),
        "/js/main.js" => asset!("/web/js/main.js", "text/javascript"),
        "/js/ui.js" => asset!("/web/js/ui.js", "text/javascript"),
        "/js/api.js" => asset!("/web/js/api.js", "text/javascript"),
        "/js/viewer.js" => asset!("/web/js/viewer.js", "text/javascript"),
        "/js/timeline/index.js" => asset!("/web/js/timeline/index.js", "text/javascript"),
        "/js/timeline/geometry.js" => asset!("/web/js/timeline/geometry.js", "text/javascript"),
        "/js/timeline/input.js" => asset!("/web/js/timeline/input.js", "text/javascript"),
        "/js/timeline/draw.js" => asset!("/web/js/timeline/draw.js", "text/javascript"),
        _ => return ApiError::missing().into_response(),
    };
    ([(header::CONTENT_TYPE, mime)], body).into_response()
}

#[cfg(test)]
#[path = "tests/api.rs"]
mod tests;
