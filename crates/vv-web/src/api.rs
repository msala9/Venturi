use crate::{
    commands::Mutation,
    error::{ApiError, Result},
    host::{Action, Host},
    preview::{FrameQuery, Preview},
    program::{ExportRequest, ProgramQuery, ProgramTask},
    source::{MediaJobs, SourceQuery},
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
    pub source: MediaJobs,
}
pub fn router(state: AppState) -> Router {
    Router::new()
        .route(
            "/api/v1/health",
            get(|| async { Json(json!({"status":"ok","api_version":1})) }),
        )
        .route("/api/v1/session", get(session))
        .route("/api/v1/timelines/{id}", get(timeline))
        .route("/api/v1/timelines/{id}/clips/{clip}", get(clip_detail))
        .route(
            "/api/v1/timelines/{id}/audio/{channel}/eq/{index}",
            get(eq_response),
        )
        .route("/api/v1/projects", get(projects))
        .route("/api/v1/projects/commands", post(project_command))
        .route("/api/v1/timelines/{id}/commands", post(timeline_command))
        .route("/api/v1/commands/{id}", get(lookup))
        .route("/api/v1/lease", post(lease))
        .route("/api/v1/preview/frame", get(frame))
        .route("/api/v1/preview/program/prepare", post(prepare_program))
        .route("/api/v1/exports", post(prepare_export))
        .route(
            "/api/v1/exports/{job}",
            get(export_status).delete(cancel_export),
        )
        .route("/api/v1/exports/{job}/export.mp4", get(export_asset))
        .route(
            "/api/v1/preview/program/{job}",
            get(program_status).delete(cancel_program),
        )
        .route(
            "/api/v1/preview/program/{job}/program.mp4",
            get(program_asset),
        )
        .route("/api/v1/diagnostics", get(diagnostics))
        .route("/api/v1/media/{id}/prepare", post(prepare_source))
        .route(
            "/api/v1/media/{id}/jobs/{job}",
            get(source_status).delete(cancel_source),
        )
        .route("/api/v1/media/{id}/jobs/{job}/{name}", get(source_asset))
        .fallback(assets)
        .layer(DefaultBodyLimit::max(64 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), security))
        .with_state(state)
}
async fn prepare_program(
    State(state): State<AppState>,
    payload: std::result::Result<Json<ProgramQuery>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    if !state.preview.available() {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "GPU_UNAVAILABLE",
            "An initialized AMD Vulkan compositor is required for Program playback",
        ));
    }
    let query = payload
        .map_err(|_| ApiError::invalid("Invalid Program request"))?
        .0;
    let snapshot = state.host.frame_snapshot(query.frame()).await?;
    state
        .source
        .prepare_program(ProgramTask {
            snapshot,
            query,
            preview: state.preview,
            export: None,
        })
        .map(Json)
}
async fn prepare_export(
    State(state): State<AppState>,
    payload: std::result::Result<Json<ExportRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    let request = payload
        .map_err(|_| ApiError::invalid("Invalid export request"))?
        .0;
    request.settings.validate()?;
    if !state.preview.available() {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "GPU_UNAVAILABLE",
            "An available Vulkan compositor is required for export",
        ));
    }
    let snapshot = state.host.frame_snapshot(request.range.frame()).await?;
    state
        .source
        .prepare_program(ProgramTask {
            snapshot,
            query: request.range,
            preview: state.preview,
            export: Some(request.settings),
        })
        .map(Json)
}
async fn export_status(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid export query"))?
        .0;
    state
        .source
        .export_status(&job, &query.project_epoch, false)
        .map(Json)
}
async fn cancel_export(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid export query"))?
        .0;
    state
        .source
        .export_status(&job, &query.project_epoch, true)
        .map(Json)
}
async fn export_asset(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
    headers: axum::http::HeaderMap,
) -> Result<Response> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid export query"))?
        .0;
    let file = state.source.export_asset(&job, &query.project_epoch)?;
    let mut response = crate::source::stream_file(file, "video/mp4", &job, &headers).await?;
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        "attachment; filename=\"venturi-export.mp4\""
            .parse()
            .unwrap(),
    );
    Ok(response)
}
async fn program_status(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<ProgramQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid Program query"))?
        .0;
    state.host.call(Action::CheckFrame(query.frame())).await?;
    state.source.program_status(&job, &query, false).map(Json)
}
async fn cancel_program(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<ProgramQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid Program query"))?
        .0;
    state.source.program_status(&job, &query, true).map(Json)
}
async fn program_asset(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<ProgramQuery>, axum::extract::rejection::QueryRejection>,
    headers: axum::http::HeaderMap,
) -> Result<Response> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid Program query"))?
        .0;
    state.host.call(Action::CheckFrame(query.frame())).await?;
    crate::source::stream_file(
        state.source.program_asset(&job, &query)?,
        "video/mp4",
        &job,
        &headers,
    )
    .await
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PrepareSource {
    project_epoch: String,
    #[serde(default = "medium")]
    quality: String,
}
fn medium() -> String {
    "medium".into()
}
async fn prepare_source(
    State(state): State<AppState>,
    Path(id): Path<String>,
    payload: std::result::Result<Json<PrepareSource>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    let payload = payload
        .map_err(|_| ApiError::invalid("Invalid source request"))?
        .0;
    let spec = state
        .host
        .source_snapshot(
            id,
            SourceQuery {
                project_epoch: payload.project_epoch,
            },
        )
        .await?;
    state.source.prepare(spec, &payload.quality).map(Json)
}
async fn source_status(
    State(state): State<AppState>,
    Path((id, job)): Path<(String, String)>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    let spec = state
        .host
        .source_snapshot(
            id,
            query
                .map_err(|_| ApiError::invalid("Invalid source query"))?
                .0,
        )
        .await?;
    state.source.status(&job, &spec, false).map(Json)
}
async fn cancel_source(
    State(state): State<AppState>,
    Path((id, job)): Path<(String, String)>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    let spec = state
        .host
        .source_snapshot(
            id,
            query
                .map_err(|_| ApiError::invalid("Invalid source query"))?
                .0,
        )
        .await?;
    state.source.status(&job, &spec, true).map(Json)
}
async fn source_asset(
    State(state): State<AppState>,
    Path((id, job, name)): Path<(String, String, String)>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
    headers: axum::http::HeaderMap,
) -> Result<Response> {
    let spec = state
        .host
        .source_snapshot(
            id,
            query
                .map_err(|_| ApiError::invalid("Invalid source query"))?
                .0,
        )
        .await?;
    let file = state.source.asset(&job, &spec, &name)?;
    let mime = match name.as_str() {
        "source.mp4" => "video/mp4",
        "thumb.png" | "source.png" => "image/png",
        "source.jpg" => "image/jpeg",
        _ => "application/json",
    };
    crate::source::stream_file(file, mime, &job, &headers).await
}
async fn session(State(state): State<AppState>) -> Result<Json<Value>> {
    let mut snapshot = state.host.call(Action::Session).await?;
    snapshot["capabilities"]["preview"] = json!(state.preview.available());
    snapshot["capabilities"]["source_playback"] = json!(true);
    snapshot["capabilities"]["playback"] = json!(state.preview.available());
    snapshot["capabilities"]["export"] = json!(state.preview.available());
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
async fn clip_detail(
    State(state): State<AppState>,
    Path((id, clip)): Path<(String, String)>,
    query: std::result::Result<Query<FrameQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid clip detail query"))?
        .0;
    if query.timeline_id != id {
        return Err(ApiError::invalid("Timeline ID does not match the query"));
    }
    state
        .host
        .call(Action::ClipDetail(clip, query))
        .await
        .map(Json)
}
async fn projects(State(state): State<AppState>) -> Result<Json<Value>> {
    state.host.call(Action::Projects).await.map(Json)
}
async fn eq_response(
    State(state): State<AppState>,
    Path((id, channel, index)): Path<(String, String, String)>,
    query: std::result::Result<Query<FrameQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid equalizer query"))?
        .0;
    if query.timeline_id != id {
        return Err(ApiError::invalid("Timeline ID does not match the query"));
    }
    let index = index
        .parse()
        .map_err(|_| ApiError::invalid("Invalid equalizer index"))?;
    state
        .host
        .call(Action::EqResponse(channel, index, query))
        .await
        .map(Json)
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
        "/js/source.js" => asset!("/web/js/source.js", "text/javascript"),
        "/js/program.js" => asset!("/web/js/program.js", "text/javascript"),
        "/js/export.js" => asset!("/web/js/export.js", "text/javascript"),
        "/js/inspector.js" => asset!("/web/js/inspector.js", "text/javascript"),
        "/js/mixer.js" => asset!("/web/js/mixer.js", "text/javascript"),
        "/js/visual.js" => asset!("/web/js/visual.js", "text/javascript"),
        "/js/masks.js" => asset!("/web/js/masks.js", "text/javascript"),
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
