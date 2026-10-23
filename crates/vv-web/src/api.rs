use crate::{
    commands::Mutation,
    error::{ApiError, Result},
    host::{Action, Host},
    preview::{FrameQuery, Preview},
    program::{ExportRequest, ProgramQuery, ProgramTask},
    source::{MediaJobs, SourceQuery, SourceWindow},
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
    pub codecs: crate::codecs::Codecs,
    pub source: MediaJobs,
    pub silence: crate::silence::Jobs,
    pub library: crate::library::Library,
    pub recordings: crate::recording::Store,
}
pub fn router(state: AppState) -> Router {
    Router::new()
        .route(
            "/api/v1/health",
            get(|| async { Json(json!({"status":"ok","api_version":1})) }),
        )
        .route("/api/v1/session", get(session))
        .route("/api/v1/media/sources", get(media_sources))
        .route(
            "/api/v1/media/proxies",
            get(proxy_status).put(proxy_configure),
        )
        .route("/api/v1/media/proxies/prepare", post(proxy_prepare))
        .route("/api/v1/projects/otio/prepare", post(prepare_otio))
        .route("/api/v1/clipboard", get(clipboard_text))
        .route(
            "/api/v1/clipboard/images/prepare",
            post(prepare_clipboard_image),
        )
        .route(
            "/api/v1/clipboard/images/jobs/{job}",
            get(clipboard_image_status).delete(cancel_clipboard_image),
        )
        .route(
            "/api/v1/clipboard/prepare",
            post(prepare_clipboard).layer(DefaultBodyLimit::max(8 * 1024 * 1024 + 4096)),
        )
        .route(
            "/api/v1/clipboard/jobs/{job}",
            get(clipboard_status).delete(cancel_clipboard),
        )
        .route(
            "/api/v1/projects/otio/jobs/{job}",
            get(otio_import_status).delete(cancel_otio_import),
        )
        .route("/api/v1/review", get(review_metadata))
        .route("/api/v1/audio/presets", get(audio_presets))
        .route(
            "/api/v1/audio/presets/commands",
            post(audio_preset_library_command),
        )
        .route("/api/v1/media/imports/prepare", post(prepare_media_import))
        .route(
            "/api/v1/media/project-imports/prepare",
            post(prepare_project_import),
        )
        .route(
            "/api/v1/media/relinks/prepare",
            post(prepare_project_relink),
        )
        .route(
            "/api/v1/media/jobs/{job}",
            get(project_media_status).delete(cancel_project_media),
        )
        .route(
            "/api/v1/media/imports/{job}",
            get(media_import_status).delete(cancel_media_import),
        )
        .route("/api/v1/native-assets/prepare", post(prepare_native_asset))
        .route("/api/v1/native-assets/folders", get(native_asset_folders))
        .route("/api/v1/native-assets/pages/{page}", get(native_asset_list))
        .route("/api/v1/native-assets/items/{id}", get(native_asset_item))
        .route(
            "/api/v1/native-assets/items/{id}/download",
            get(native_asset_download),
        )
        .route(
            "/api/v1/native-assets/jobs/{job}",
            get(native_asset_status).delete(cancel_native_asset),
        )
        .route("/api/v1/native-assets/commands", post(native_asset_command))
        .route(
            "/api/v1/native-assets/commands/prepare",
            post(prepare_native_asset_command),
        )
        .route("/api/v1/presets", get(preset_list_first))
        .route("/api/v1/presets/shortcuts", get(preset_shortcuts))
        .route("/api/v1/presets/pages/{page}", get(preset_list))
        .route("/api/v1/presets/items/{id}", get(preset_item))
        .route("/api/v1/presets/items/{id}/download", get(preset_download))
        .route(
            "/api/v1/presets/commands",
            post(preset_library_command).layer(DefaultBodyLimit::max(8 * 1024 * 1024)),
        )
        .route("/api/v1/review/replace/plan", post(take_plan))
        .route(
            "/api/v1/recordings/{id}",
            post(recording_upload).get(recording_status),
        )
        .route("/api/v1/recordings/{id}/audio", get(recording_audio))
        .route("/api/v1/library", get(library_catalog))
        .route("/api/v1/library/items/{id}/prepare", post(library_prepare))
        .route(
            "/api/v1/library/jobs/{job}",
            get(library_status).delete(library_cancel),
        )
        .route("/api/v1/timelines/{id}", get(timeline))
        .route(
            "/api/v1/timelines/{id}/compound-navigation",
            post(compound_navigation),
        )
        .route("/api/v1/timelines/{id}/timeline.otio", get(export_otio))
        .route("/api/v1/timelines/{id}/clips/{clip}", get(clip_detail))
        .route(
            "/api/v1/timelines/{id}/inspector-selection",
            post(inspector_selection),
        )
        .route(
            "/api/v1/timelines/{id}/clips/{clip}/keyframe-navigation",
            post(keyframe_navigation),
        )
        .route(
            "/api/v1/timelines/{id}/clips/{clip}/curve-viewport",
            post(curve_viewport),
        )
        .route(
            "/api/v1/timelines/{id}/presets/capture",
            post(capture_preset),
        )
        .route(
            "/api/v1/timelines/{id}/presets/apply",
            post(apply_attribute_preset).layer(DefaultBodyLimit::max(4 * 1024 * 1024)),
        )
        .route(
            "/api/v1/timelines/{id}/clips/{clip}/keys/{page}",
            get(clip_key_page),
        )
        .route(
            "/api/v1/timelines/{id}/clips/{clip}/slip/{center}",
            get(slip_detail),
        )
        .route(
            "/api/v1/timelines/{id}/audio/{channel}/eq/{index}",
            get(eq_response),
        )
        .route("/api/v1/projects", get(projects))
        .route("/api/v1/recovery", get(recovery_status))
        .route("/api/v1/projects/commands", post(project_command))
        .route("/api/v1/projects/view", post(project_view))
        .route(
            "/api/v1/timelines/{id}/commands",
            post(timeline_command).layer(DefaultBodyLimit::max(256 * 1024)),
        )
        .route("/api/v1/analysis/silence", post(prepare_silence))
        .route(
            "/api/v1/analysis/silence/{job}",
            get(silence_status).delete(cancel_silence),
        )
        .route("/api/v1/commands/{id}", get(lookup))
        .route("/api/v1/lease", post(lease))
        .route("/api/v1/preview/frame", get(frame))
        .route("/api/v1/preview/cache", get(preview_cache))
        .route("/api/v1/preview/audio.wav", get(audition))
        .route("/api/v1/preview/audio/window", post(program_audio_window))
        .route("/api/v1/preview/audio/meters", post(audio_meters))
        .route("/api/v1/media/{id}/audio.wav", get(source_audition))
        .route("/api/v1/media/{id}/audio/window", post(source_audio_window))
        .route("/api/v1/preview/balance/{clip}", get(balance))
        .route(
            "/api/v1/preview/scopes/{clip}/{first}/{second}",
            get(scopes),
        )
        .route("/api/v1/preview/program/prepare", post(prepare_program))
        .route("/api/v1/exports", post(prepare_export).get(export_history))
        .route("/api/v1/exports/codecs", get(codec_catalog))
        .route(
            "/api/v1/exports/codecs/probe",
            post(codec_probe).layer(DefaultBodyLimit::max(2048)),
        )
        .route(
            "/api/v1/exports/{job}",
            get(export_status).delete(cancel_export),
        )
        .route("/api/v1/exports/{job}/export.mp4", get(export_asset))
        .route(
            "/api/v1/exports/{job}/discard",
            post(discard_export).layer(DefaultBodyLimit::max(2048)),
        )
        .route(
            "/api/v1/preview/program/{job}",
            get(program_status).delete(cancel_program),
        )
        .route(
            "/api/v1/preview/program/{job}/program.mp4",
            get(program_asset),
        )
        .route("/api/v1/preview/program/{job}/meters", get(program_meters))
        .route("/api/v1/diagnostics", get(diagnostics))
        .route("/api/v1/media/{id}/prepare", post(prepare_source))
        .route(
            "/api/v1/media/{id}/assets/prepare",
            post(prepare_source_assets),
        )
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
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ProxySettingsRequest {
    project_epoch: String,
    client_id: String,
    enabled: bool,
    quality: String,
    paused: bool,
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ProxyPrepareRequest {
    project_epoch: String,
    client_id: String,
    media_ids: Vec<String>,
}
async fn proxy_status(
    State(state): State<AppState>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid proxy query"))?
        .0;
    state
        .host
        .call(Action::ProxyContext(query.project_epoch.clone(), None))
        .await?;
    state.source.proxies.status(&query.project_epoch).map(Json)
}
async fn proxy_configure(
    State(state): State<AppState>,
    payload: std::result::Result<
        Json<ProxySettingsRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Json<Value>> {
    let payload = payload
        .map_err(|_| ApiError::invalid("Invalid proxy settings"))?
        .0;
    state
        .host
        .call(Action::ProxyContext(
            payload.project_epoch.clone(),
            Some(payload.client_id),
        ))
        .await?;
    let manager = state.source.proxies.clone();
    let epoch = payload.project_epoch;
    tokio::task::spawn_blocking(move || {
        manager.configure(payload.enabled, &payload.quality, payload.paused)?;
        manager.status(&epoch)
    })
    .await
    .map_err(|_| ApiError::io())?
    .map(Json)
}
async fn proxy_prepare(
    State(state): State<AppState>,
    payload: std::result::Result<
        Json<ProxyPrepareRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Json<Value>> {
    let payload = payload
        .map_err(|_| ApiError::invalid("Invalid proxy preparation"))?
        .0;
    if payload.media_ids.is_empty()
        || payload.media_ids.len() > 32
        || payload
            .media_ids
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != payload.media_ids.len()
    {
        return Err(ApiError::invalid(
            "Choose one to32 distinct moving-video sources",
        ));
    }
    state
        .host
        .call(Action::ProxyContext(
            payload.project_epoch.clone(),
            Some(payload.client_id),
        ))
        .await?;
    let mut specs = vec![];
    for id in payload.media_ids {
        specs.push(
            state
                .host
                .proxy_source_snapshot(
                    id,
                    SourceQuery {
                        project_epoch: payload.project_epoch.clone(),
                    },
                )
                .await?,
        );
    }
    let manager = state.source.proxies.clone();
    let epoch = payload.project_epoch;
    tokio::task::spawn_blocking(move || {
        let mut errors = vec![];
        for spec in specs {
            let id = spec.spec.media_id.clone();
            if let Err(error) = manager.enqueue(spec) {
                errors.push(json!({"media_id":id,"code":error.1,"error":error.2}));
            }
        }
        let mut result = manager.status(&epoch)?;
        result["errors"] = json!(errors);
        Ok(Json(result))
    })
    .await
    .map_err(|_| ApiError::io())?
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ProgramMetersQuery {
    project_epoch: String,
    if_generation: String,
    timeline_id: String,
    revision: String,
    start_frame: i64,
    end_frame: i64,
    width: u32,
    #[serde(default)]
    audio_origin_frame: Option<i64>,
    #[serde(default)]
    from_bin: u64,
    #[serde(default = "meter_page_limit")]
    limit: u32,
    insert_channel: Option<String>,
    insert_index: Option<usize>,
}
fn meter_page_limit() -> u32 {
    64
}
impl ProgramMetersQuery {
    fn parts(self) -> Result<(ProgramQuery, u64, u32, Option<crate::audition::InsertQuery>)> {
        if !(1..=64).contains(&self.limit) {
            return Err(ApiError::invalid(
                "Choose between 1 and 64 audio telemetry bins",
            ));
        }
        let insert = match (self.insert_channel, self.insert_index) {
            (None, None) => None,
            (Some(channel), Some(index))
                if (channel == "master"
                    || channel
                        .parse::<usize>()
                        .is_ok_and(|value| value < 128 && value.to_string() == channel))
                    && index < 32 =>
            {
                Some(crate::audition::InsertQuery { channel, index })
            }
            _ => {
                return Err(ApiError::invalid(
                    "Choose a native audio insert channel and index together",
                ));
            }
        };
        Ok((
            ProgramQuery {
                project_epoch: self.project_epoch,
                if_generation: self.if_generation,
                timeline_id: self.timeline_id,
                revision: self.revision,
                start_frame: self.start_frame,
                end_frame: self.end_frame,
                audio_origin_frame: self.audio_origin_frame,
                width: self.width,
            },
            self.from_bin,
            self.limit,
            insert,
        ))
    }
}
async fn program_meters(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<ProgramMetersQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    let (query, from, limit, insert) = query
        .map_err(|_| ApiError::invalid("Invalid prepared Program audio telemetry query"))?
        .0
        .parts()?;
    state.host.call(Action::CheckFrame(query.frame())).await?;
    state
        .source
        .program_meters(&job, &query, from, limit, insert.as_ref())
        .map(Json)
}
async fn audio_meters(
    State(state): State<AppState>,
    payload: std::result::Result<
        Json<crate::audition::MeterRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Response> {
    let payload = payload
        .map_err(|_| ApiError::invalid("Invalid audio meter request"))?
        .0;
    let task = state.host.audio_snapshot(payload.query.clone()).await?;
    let result = render_audio(move |cancel| task.meters(payload.insert, cancel)).await?;
    state.host.call(Action::CheckFrame(payload.query)).await?;
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(result)).into_response())
}
async fn audition(
    State(state): State<AppState>,
    query: std::result::Result<Query<FrameQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid audio audition query"))?
        .0;
    let task = state.host.audio_snapshot(query.clone()).await?;
    let bytes = render_audition(task).await?;
    state.host.call(Action::CheckFrame(query)).await?;
    Ok(audio_response(bytes))
}
async fn source_audition(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: std::result::Result<
        Query<crate::audition::SourceQuery>,
        axum::extract::rejection::QueryRejection,
    >,
) -> Result<Response> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid source audition query"))?
        .0;
    let source_query = SourceQuery {
        project_epoch: query.project_epoch,
    };
    let spec = state
        .host
        .source_snapshot(id.clone(), source_query.clone())
        .await?;
    let identity = crate::source::source_version(&spec.file)?;
    let bytes = render_audition(crate::audition::Task::source_options(
        spec,
        query.frame,
        query.audio_mode,
        query.audio_stream_index,
    )?)
    .await?;
    let current = state.host.source_snapshot(id, source_query).await?;
    if crate::source::source_version(&current.file)? != identity {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "Audio source changed; seek again",
        ));
    }
    Ok(audio_response(bytes))
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ProgramAudioWindow {
    query: FrameQuery,
    window: crate::audition::WindowParams,
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceAudioWindow {
    query: crate::audition::SourceQuery,
    window: crate::audition::WindowParams,
}
async fn program_audio_window(
    State(state): State<AppState>,
    payload: std::result::Result<Json<ProgramAudioWindow>, axum::extract::rejection::JsonRejection>,
) -> Result<Response> {
    let payload = payload
        .map_err(|_| ApiError::invalid("Invalid Program audio window"))?
        .0;
    let task = state.host.audio_snapshot(payload.query.clone()).await?;
    let window = render_audio(move |cancel| task.window(payload.window, cancel)).await?;
    state.host.call(Action::CheckFrame(payload.query)).await?;
    Ok(window_response(window))
}
async fn source_audio_window(
    State(state): State<AppState>,
    Path(id): Path<String>,
    payload: std::result::Result<Json<SourceAudioWindow>, axum::extract::rejection::JsonRejection>,
) -> Result<Response> {
    let payload = payload
        .map_err(|_| ApiError::invalid("Invalid Source audio window"))?
        .0;
    let source_query = SourceQuery {
        project_epoch: payload.query.project_epoch,
    };
    let spec = state
        .host
        .source_snapshot(id.clone(), source_query.clone())
        .await?;
    let identity = crate::source::source_version(&spec.file)?;
    let task = crate::audition::Task::source_options(
        spec,
        payload.query.frame,
        payload.query.audio_mode,
        payload.query.audio_stream_index,
    )?;
    let window = render_audio(move |cancel| task.window(payload.window, cancel)).await?;
    let current = state.host.source_snapshot(id, source_query).await?;
    if crate::source::source_version(&current.file)? != identity {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "Audio source changed; prepare again",
        ));
    }
    Ok(window_response(window))
}
fn window_response(window: crate::audition::Window) -> Response {
    let mut response = audio_response(window.bytes);
    for (name, value) in [
        ("x-audio-start-sample", window.start.to_string()),
        ("x-audio-end-sample", window.end.to_string()),
        ("x-audio-tempo", window.tempo.to_string()),
        ("x-audio-last", window.last.to_string()),
        ("x-audio-source-version", window.source_version),
    ] {
        response
            .headers_mut()
            .insert(name, value.parse().expect("numeric audio metadata"));
    }
    response
}
async fn render_audition(task: crate::audition::Task) -> Result<Vec<u8>> {
    render_audio(move |cancel| task.run(cancel)).await
}
async fn render_audio<T: Send + 'static>(
    work: impl FnOnce(std::sync::Arc<std::sync::atomic::AtomicBool>) -> Result<T> + Send + 'static,
) -> Result<T> {
    static WORKER: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
    let permit = WORKER
        .try_acquire()
        .map_err(|_| ApiError::conflict("AUDIO_BUSY", "Audio audition is busy; seek again"))?;
    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let _cancel_on_drop = crate::audition::CancelOnDrop(cancel.clone());
    let worker_cancel = cancel.clone();
    let worker = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        work(worker_cancel)
    });
    let bytes = match tokio::time::timeout(std::time::Duration::from_secs(5), worker).await {
        Ok(result) => result.map_err(|_| ApiError::io())??,
        Err(_) => {
            cancel.store(true, std::sync::atomic::Ordering::Relaxed);
            return Err(ApiError::conflict(
                "AUDIO_TIMEOUT",
                "Audio audition exceeded its time budget",
            ));
        }
    };
    Ok(bytes)
}
fn audio_response(bytes: Vec<u8>) -> Response {
    (
        [
            (header::CONTENT_TYPE, "audio/wav"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        bytes,
    )
        .into_response()
}
async fn review_metadata(
    State(state): State<AppState>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid review metadata query"))?
        .0;
    state.host.call(Action::Review(query)).await.map(Json)
}
async fn preset_shortcuts() -> Response {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(crate::presets::shortcut_catalog()),
    )
        .into_response()
}
fn native_asset_json(value: Value) -> Response {
    ([(header::CACHE_CONTROL, "no-store")], Json(value)).into_response()
}
async fn prepare_native_asset(
    State(state): State<AppState>,
    payload: std::result::Result<
        Json<crate::host::NativeAssetRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Response> {
    state
        .host
        .call(Action::PrepareNativeAsset(
            payload
                .map_err(|_| ApiError::invalid("Invalid native asset preparation"))?
                .0,
        ))
        .await
        .map(native_asset_json)
}
async fn prepare_media_import(
    State(state): State<AppState>,
    payload: std::result::Result<
        Json<crate::host::MediaImportRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Response> {
    state
        .host
        .call(Action::PrepareMediaImport(
            payload
                .map_err(|_| ApiError::invalid("Invalid media import preparation"))?
                .0,
        ))
        .await
        .map(native_asset_json)
}
async fn prepare_project_import(
    State(state): State<AppState>,
    payload: std::result::Result<
        Json<crate::project_media::ImportRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Response> {
    state
        .host
        .call(Action::PrepareProjectImport(
            payload
                .map_err(|_| ApiError::invalid("Invalid project media import preparation"))?
                .0,
        ))
        .await
        .map(native_asset_json)
}
async fn prepare_project_relink(
    State(state): State<AppState>,
    payload: std::result::Result<
        Json<crate::project_media::RelinkRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Response> {
    state
        .host
        .call(Action::PrepareProjectRelink(
            payload
                .map_err(|_| ApiError::invalid("Invalid project media relink preparation"))?
                .0,
        ))
        .await
        .map(native_asset_json)
}
async fn project_media_status(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    state
        .host
        .call(Action::ProjectMediaJobStatus(
            job,
            query
                .map_err(|_| ApiError::invalid("Invalid project media job query"))?
                .0,
            false,
        ))
        .await
        .map(native_asset_json)
}
async fn cancel_project_media(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    state
        .host
        .call(Action::ProjectMediaJobStatus(
            job,
            query
                .map_err(|_| ApiError::invalid("Invalid project media job cancellation"))?
                .0,
            true,
        ))
        .await
        .map(native_asset_json)
}
async fn clipboard_text(
    State(state): State<AppState>,
    query: std::result::Result<
        Query<crate::host::ClipboardQuery>,
        axum::extract::rejection::QueryRejection,
    >,
) -> Result<Response> {
    state
        .host
        .call(Action::Clipboard(
            query
                .map_err(|_| ApiError::invalid("Invalid clipboard query"))?
                .0,
        ))
        .await
        .map(native_asset_json)
}
async fn prepare_clipboard_image(
    State(state): State<AppState>,
    query: std::result::Result<
        Query<crate::host::ClipboardImageQuery>,
        axum::extract::rejection::QueryRejection,
    >,
    request: Request,
) -> Result<Response> {
    const MAX_BYTES: usize = crate::clipboard_image::MAX_BYTES;
    static UPLOAD: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
    let _permit = UPLOAD.try_acquire().map_err(|_| {
        ApiError::conflict("IMAGE_UPLOAD_BUSY", "Another clipboard image is uploading")
    })?;
    let query = query
        .map_err(|_| ApiError::invalid("Invalid clipboard image query"))?
        .0;
    let mime = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !matches!(
        mime.as_str(),
        "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/bmp" | "image/tiff"
    ) {
        return Err(ApiError::invalid("Choose a supported clipboard image type"));
    }
    state
        .host
        .call(Action::CheckClipboardImage(query.clone()))
        .await?;
    let bytes = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        axum::body::to_bytes(request.into_body(), MAX_BYTES),
    )
    .await
    .map_err(|_| ApiError::conflict("IMAGE_UPLOAD_TIMEOUT", "Clipboard image upload timed out"))?
    .map_err(|_| {
        ApiError(
            StatusCode::PAYLOAD_TOO_LARGE,
            "IMAGE_TOO_LARGE",
            "Clipboard image exceeds the 32 MiB upload limit",
        )
    })?;
    state
        .host
        .call(Action::PrepareClipboardImage(query, mime, bytes.to_vec()))
        .await
        .map(native_asset_json)
}
async fn clipboard_image_status(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    state
        .host
        .call(Action::ClipboardImageStatus(
            job,
            query
                .map_err(|_| ApiError::invalid("Invalid clipboard image job query"))?
                .0,
            false,
        ))
        .await
        .map(native_asset_json)
}
async fn cancel_clipboard_image(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    state
        .host
        .call(Action::ClipboardImageStatus(
            job,
            query
                .map_err(|_| ApiError::invalid("Invalid clipboard image cancellation query"))?
                .0,
            true,
        ))
        .await
        .map(native_asset_json)
}
async fn prepare_clipboard(
    State(state): State<AppState>,
    payload: std::result::Result<
        Json<crate::host::ClipboardRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Response> {
    state
        .host
        .call(Action::PrepareClipboard(
            payload
                .map_err(|_| ApiError::invalid("Invalid clipboard preparation"))?
                .0,
        ))
        .await
        .map(native_asset_json)
}
async fn clipboard_status(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    state
        .host
        .call(Action::ClipboardStatus(
            job,
            query
                .map_err(|_| ApiError::invalid("Invalid clipboard job query"))?
                .0,
            false,
        ))
        .await
        .map(native_asset_json)
}
async fn cancel_clipboard(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    state
        .host
        .call(Action::ClipboardStatus(
            job,
            query
                .map_err(|_| ApiError::invalid("Invalid clipboard cancellation query"))?
                .0,
            true,
        ))
        .await
        .map(native_asset_json)
}
async fn prepare_otio(
    State(state): State<AppState>,
    payload: std::result::Result<
        Json<crate::host::OtioImportRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Response> {
    state
        .host
        .call(Action::PrepareOtio(
            payload
                .map_err(|_| ApiError::invalid("Invalid OTIO preparation"))?
                .0,
        ))
        .await
        .map(native_asset_json)
}
async fn otio_import_status(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    state
        .host
        .call(Action::OtioImportStatus(
            job,
            query
                .map_err(|_| ApiError::invalid("Invalid OTIO job query"))?
                .0,
            false,
        ))
        .await
        .map(native_asset_json)
}
async fn cancel_otio_import(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    state
        .host
        .call(Action::OtioImportStatus(
            job,
            query
                .map_err(|_| ApiError::invalid("Invalid OTIO cancellation query"))?
                .0,
            true,
        ))
        .await
        .map(native_asset_json)
}
async fn media_import_status(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    state
        .host
        .call(Action::MediaImportStatus(
            job,
            query
                .map_err(|_| ApiError::invalid("Invalid media import job query"))?
                .0,
            false,
        ))
        .await
        .map(native_asset_json)
}
async fn cancel_media_import(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    state
        .host
        .call(Action::MediaImportStatus(
            job,
            query
                .map_err(|_| ApiError::invalid("Invalid media import cancellation query"))?
                .0,
            true,
        ))
        .await
        .map(native_asset_json)
}
async fn native_asset_folders(
    State(state): State<AppState>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    state
        .host
        .call(Action::NativeAssetFolders(
            query
                .map_err(|_| ApiError::invalid("Invalid native asset folder query"))?
                .0,
        ))
        .await
        .map(native_asset_json)
}
async fn native_asset_list(
    State(state): State<AppState>,
    Path(page): Path<usize>,
    query: std::result::Result<
        Query<crate::asset_store::Query>,
        axum::extract::rejection::QueryRejection,
    >,
) -> Result<Response> {
    state
        .host
        .call(Action::NativeAssetList(
            page,
            query
                .map_err(|_| ApiError::invalid("Invalid native asset list query"))?
                .0,
        ))
        .await
        .map(native_asset_json)
}
async fn native_asset_item(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: std::result::Result<
        Query<crate::host::NativeAssetItemQuery>,
        axum::extract::rejection::QueryRejection,
    >,
) -> Result<Response> {
    state
        .host
        .call(Action::NativeAssetItem(
            id,
            query
                .map_err(|_| ApiError::invalid("Invalid native asset item query"))?
                .0,
        ))
        .await
        .map(native_asset_json)
}
async fn native_asset_download(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    let bytes = state
        .host
        .native_asset_export(
            id.clone(),
            query
                .map_err(|_| ApiError::invalid("Invalid native asset download query"))?
                .0,
        )
        .await?;
    Ok((
        [
            (
                header::CONTENT_TYPE,
                "application/json; charset=utf-8".to_owned(),
            ),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{id}.json\""),
            ),
            (header::CACHE_CONTROL, "no-store".into()),
        ],
        bytes,
    )
        .into_response())
}
async fn native_asset_status(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    state
        .host
        .call(Action::NativeAssetStatus(
            job,
            query
                .map_err(|_| ApiError::invalid("Invalid native asset job query"))?
                .0,
            false,
        ))
        .await
        .map(native_asset_json)
}
async fn cancel_native_asset(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    state
        .host
        .call(Action::NativeAssetStatus(
            job,
            query
                .map_err(|_| ApiError::invalid("Invalid native asset job query"))?
                .0,
            true,
        ))
        .await
        .map(native_asset_json)
}
async fn prepare_native_asset_command(
    State(state): State<AppState>,
    payload: std::result::Result<Json<Mutation>, axum::extract::rejection::JsonRejection>,
) -> Result<Response> {
    state
        .host
        .prepare_native_asset_edit(
            payload
                .map_err(|_| ApiError::invalid("Invalid native asset library preparation"))?
                .0,
        )
        .await
        .map(native_asset_json)
}
async fn native_asset_command(
    State(state): State<AppState>,
    payload: std::result::Result<Json<Mutation>, axum::extract::rejection::JsonRejection>,
) -> Result<Response> {
    let request = payload
        .map_err(|_| ApiError::invalid("Invalid native asset library mutation"))?
        .0;
    if !matches!(
        request.operation,
        crate::commands::Operation::PublishNativeAsset { .. }
            | crate::commands::Operation::EditNativeAssetLibrary { .. }
    ) {
        return Err(ApiError::invalid(
            "This route accepts only native asset publication and library edits",
        ));
    }
    state
        .host
        .native_asset_mutation(request)
        .await
        .map(native_asset_json)
}
async fn preset_list_first(
    State(state): State<AppState>,
    query: std::result::Result<
        Query<crate::preset_store::Query>,
        axum::extract::rejection::QueryRejection,
    >,
) -> Result<Json<Value>> {
    state
        .host
        .call(Action::PresetList(
            0,
            query
                .map_err(|_| ApiError::invalid("Invalid preset library query"))?
                .0,
        ))
        .await
        .map(Json)
}
async fn preset_list(
    State(state): State<AppState>,
    Path(page): Path<usize>,
    query: std::result::Result<
        Query<crate::preset_store::Query>,
        axum::extract::rejection::QueryRejection,
    >,
) -> Result<Json<Value>> {
    state
        .host
        .call(Action::PresetList(
            page,
            query
                .map_err(|_| ApiError::invalid("Invalid preset library query"))?
                .0,
        ))
        .await
        .map(Json)
}
async fn preset_download(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<impl IntoResponse> {
    let bytes = state
        .host
        .preset_export(
            id.clone(),
            query
                .map_err(|_| ApiError::invalid("Invalid preset download query"))?
                .0,
        )
        .await?;
    Ok((
        [
            (
                header::CONTENT_TYPE,
                "application/json; charset=utf-8".to_owned(),
            ),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{id}.json\""),
            ),
            (header::CACHE_CONTROL, "no-store".into()),
        ],
        bytes,
    ))
}
async fn preset_item(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    state
        .host
        .call(Action::PresetItem(
            id,
            query
                .map_err(|_| ApiError::invalid("Invalid preset query"))?
                .0,
        ))
        .await
        .map(Json)
}
async fn audio_presets(
    State(state): State<AppState>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid audio preset query"))?
        .0;
    let value = state.host.call(Action::AudioPresets(query)).await?;
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(value)).into_response())
}
async fn audio_preset_library_command(
    State(state): State<AppState>,
    payload: std::result::Result<Json<Mutation>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    let request = payload
        .map_err(|_| ApiError::invalid("Invalid audio preset mutation"))?
        .0;
    if !matches!(
        request.operation,
        crate::commands::Operation::EditAudioPresetLibrary { .. }
    ) {
        return Err(ApiError::invalid(
            "This route accepts only audio preset library edits",
        ));
    }
    state
        .host
        .call(Action::Mutation(None, request))
        .await
        .map(Json)
}
async fn preset_library_command(
    State(state): State<AppState>,
    payload: std::result::Result<Json<Mutation>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    let request = payload
        .map_err(|_| ApiError::invalid("Invalid preset library mutation"))?
        .0;
    if !matches!(
        request.operation,
        crate::commands::Operation::EditPresetLibrary { .. }
    ) {
        return Err(ApiError::invalid(
            "This route accepts only preset library edits",
        ));
    }
    state
        .host
        .call(Action::Mutation(None, request))
        .await
        .map(Json)
}
async fn take_plan(
    State(state): State<AppState>,
    payload: std::result::Result<
        Json<crate::take::Preview>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Json<Value>> {
    let payload = payload
        .map_err(|_| ApiError::invalid("Invalid take replacement preview"))?
        .0;
    state.host.take_plan(payload).await.map(Json)
}
async fn recording_upload(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: std::result::Result<
        Query<crate::recording::Query>,
        axum::extract::rejection::QueryRejection,
    >,
    request: Request,
) -> Result<Json<Value>> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid recording capture metadata"))?
        .0;
    if request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        != Some("application/octet-stream")
    {
        return Err(ApiError::invalid(
            "Recording upload must be raw captured audio",
        ));
    }
    let snapshot = state.host.call(Action::Session).await?;
    if snapshot["project_epoch"] != query.project_epoch || snapshot["project_name"].is_null() {
        return Err(ApiError::conflict(
            "REVISION_CONFLICT",
            "Open the intended project before saving the take",
        ));
    }
    state
        .host
        .call(Action::Lease(query.client_id.clone()))
        .await?;
    state
        .recordings
        .upload(id, query, request.into_body())
        .await
        .map(Json)
}
async fn recording_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    state.recordings.get(&id).map(Json)
}
async fn recording_audio(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
) -> Result<Response> {
    let (file, mime, tag) = state.recordings.asset(&id)?;
    crate::source::stream_file(file, mime, &tag, &headers).await
}
async fn library_catalog(State(state): State<AppState>) -> Result<Json<Value>> {
    state.library.catalog().await.map(Json)
}
async fn library_prepare(
    State(state): State<AppState>,
    Path(id): Path<String>,
    payload: std::result::Result<Json<SourceQuery>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    let query = payload
        .map_err(|_| ApiError::invalid("Invalid library transfer request"))?
        .0;
    let snapshot = state.host.call(Action::Session).await?;
    if snapshot["project_epoch"] != query.project_epoch || snapshot["project_name"].is_null() {
        return Err(ApiError::conflict(
            "REVISION_CONFLICT",
            "Open the intended project before importing shared assets",
        ));
    }
    state
        .library
        .prepare(&id, &query.project_epoch)
        .await
        .map(Json)
}
async fn library_status(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    state
        .library
        .status(
            &job,
            &query
                .map_err(|_| ApiError::invalid("Invalid library transfer query"))?
                .0
                .project_epoch,
            false,
        )
        .map(Json)
}
async fn library_cancel(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<SourceQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    state
        .library
        .status(
            &job,
            &query
                .map_err(|_| ApiError::invalid("Invalid library transfer query"))?
                .0
                .project_epoch,
            true,
        )
        .map(Json)
}
async fn prepare_silence(
    State(state): State<AppState>,
    payload: std::result::Result<
        Json<crate::silence::Request>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Json<Value>> {
    let task = state
        .host
        .speech_snapshot(
            payload
                .map_err(|_| ApiError::invalid("Invalid speech analysis request"))?
                .0,
        )
        .await?;
    state.silence.prepare(task).map(Json)
}
async fn silence_status(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<FrameQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid speech analysis query"))?
        .0;
    let request = state.silence.request(&job, &query)?;
    let task = state.host.speech_snapshot(request).await?;
    state.silence.status(&job, &task).map(Json)
}
async fn cancel_silence(
    State(state): State<AppState>,
    Path(job): Path<String>,
    query: std::result::Result<Query<FrameQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    state
        .silence
        .cancel(
            &job,
            &query
                .map_err(|_| ApiError::invalid("Invalid speech cancellation query"))?
                .0,
        )
        .map(Json)
}
async fn slip_detail(
    State(state): State<AppState>,
    Path((id, clip, center)): Path<(String, String, String)>,
    query: std::result::Result<Query<FrameQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid slip preview query"))?
        .0;
    let center = center
        .parse()
        .map_err(|_| ApiError::invalid("Slip preview center must be an integer frame"))?;
    if query.timeline_id != id {
        return Err(ApiError::missing());
    }
    state
        .host
        .call(Action::SlipDetail(clip, center, query))
        .await
        .map(Json)
}
async fn export_otio(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: std::result::Result<Query<FrameQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid OTIO snapshot query"))?
        .0;
    if query.timeline_id != id {
        return Err(ApiError::missing());
    }
    let snapshot = state.host.frame_snapshot(query).await?;
    if snapshot.project.timelines[snapshot.timeline]
        .tracks
        .iter()
        .flat_map(|t| &t.clips)
        .any(|clip| {
            if let vv_core::ClipSource::Media(media) = clip.source {
                snapshot
                    .project
                    .media_pool
                    .get(media)
                    .is_some_and(|m| m.compound.is_some())
            } else {
                false
            }
        })
    {
        return Err(ApiError::invalid(
            "Native OTIO export does not serialize compound contents; open and export the child timeline directly",
        ));
    }
    let bytes = tokio::task::spawn_blocking(move || {
        let measure = |title: &vv_core::TitleParams| vv_render::text::title_metrics(title);
        serde_json::to_vec_pretty(&vv_core::otio::timeline_to_otio(
            &snapshot.project,
            snapshot.timeline,
            Some(&measure),
        ))
    })
    .await
    .map_err(|_| ApiError::io())?
    .map_err(|_| ApiError::io())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(ApiError::invalid(
            "OTIO export exceeds the 8 MiB download limit",
        ));
    }
    Ok((
        [
            (header::CONTENT_TYPE, "application/json"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"timeline.otio\"",
            ),
        ],
        bytes,
    )
        .into_response())
}
async fn prepare_program(
    State(state): State<AppState>,
    payload: std::result::Result<Json<ProgramQuery>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    if !state.preview.available() {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "GPU_UNAVAILABLE",
            "An initialized native Vulkan compositor is required for Program playback",
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
async fn export_history(State(state): State<AppState>) -> Result<Json<Value>> {
    state.source.export_history().map(Json)
}
async fn prepare_export(
    State(state): State<AppState>,
    payload: std::result::Result<Json<ExportRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    let request = payload
        .map_err(|_| ApiError::invalid("Invalid export request"))?
        .0;
    state.codecs.validate_export(&request.settings)?;
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
async fn codec_catalog(State(state): State<AppState>) -> Json<Value> {
    Json(state.codecs.catalog())
}
async fn codec_probe(
    State(state): State<AppState>,
    payload: std::result::Result<
        Json<crate::codecs::ProbeRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Json<Value>> {
    let request = payload
        .map_err(|_| ApiError::invalid("Invalid codec probe request"))?
        .0;
    tokio::task::spawn_blocking(move || state.codecs.probe(request))
        .await
        .map_err(|_| ApiError::io())?
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
async fn discard_export(
    State(state): State<AppState>,
    Path(job): Path<String>,
    payload: std::result::Result<
        Json<crate::export_store::DiscardRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Json<Value>> {
    state
        .source
        .export_discard(
            &job,
            payload
                .map_err(|_| ApiError::invalid("Invalid saved export discard request"))?
                .0,
        )
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
    #[serde(default)]
    window: Option<SourceWindow>,
    #[serde(default)]
    audio_stream_index: u32,
    #[serde(default)]
    audio_mode: crate::source_audio::AudioMode,
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
    if payload.audio_mode == crate::source_audio::AudioMode::All {
        return state
            .source
            .prepare_audio(
                spec,
                &payload.quality,
                payload.window,
                payload.audio_mode,
                payload.audio_stream_index,
            )
            .map(Json);
    }
    match (payload.window, payload.audio_stream_index) {
        (Some(window), 0) => state.source.prepare_window(spec, &payload.quality, window),
        (None, 0) => state.source.prepare(spec, &payload.quality),
        (window, index) => state
            .source
            .prepare_selected(spec, &payload.quality, window, index),
    }
    .map(Json)
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PrepareAssets {
    project_epoch: String,
    #[serde(default)]
    audio_stream_index: u32,
    #[serde(default = "include_waveform")]
    include_waveform: bool,
}
fn include_waveform() -> bool {
    true
}
async fn prepare_source_assets(
    State(state): State<AppState>,
    Path(id): Path<String>,
    payload: std::result::Result<Json<PrepareAssets>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    let query = payload
        .map_err(|_| ApiError::invalid("Invalid source assets request"))?
        .0;
    let spec = state
        .host
        .source_snapshot(
            id,
            SourceQuery {
                project_epoch: query.project_epoch,
            },
        )
        .await?;
    if !query.include_waveform {
        state
            .source
            .prepare_assets_options(spec, query.audio_stream_index, false)
    } else if query.audio_stream_index == 0 {
        state.source.prepare_assets(spec)
    } else {
        state
            .source
            .prepare_assets_selected(spec, query.audio_stream_index)
    }
    .map(Json)
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
        "source.webp" => "image/webp",
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
    snapshot["capabilities"]["scopes"] = json!(state.preview.available());
    snapshot["capabilities"]["software_preview"] = json!(
        state.preview.diagnostic()["software"]
            .as_bool()
            .unwrap_or(false)
    );
    Ok(Json(snapshot))
}
async fn diagnostics(State(state): State<AppState>) -> Json<Value> {
    Json(json!({"preview":state.preview.diagnostic()}))
}
async fn preview_cache(
    State(state): State<AppState>,
    query: std::result::Result<Query<FrameQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid cache query"))?
        .0;
    let mut snapshot = state.host.frame_snapshot(query.clone()).await?;
    snapshot.video = std::sync::Arc::new(crate::proxy_video::Selection::capture(
        &state.source.proxies,
        &snapshot,
    )?);
    let frames = state.preview.cached_frames(&snapshot);
    let programs = state.source.cached_programs(&snapshot);
    state.host.call(Action::CheckFrame(query)).await?;
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(json!({"frames":frames,"programs":programs})),
    )
        .into_response())
}
async fn frame(
    State(state): State<AppState>,
    query: std::result::Result<Query<FrameQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    if !state.preview.available() {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "GPU_UNAVAILABLE",
            "Start with an available native Vulkan compositor",
        ));
    }
    let query = query
        .map_err(|_| ApiError::invalid("Invalid preview query"))?
        .0;
    let mut snapshot = state.host.frame_snapshot(query).await?;
    snapshot.video = std::sync::Arc::new(crate::proxy_video::Selection::capture(
        &state.source.proxies,
        &snapshot,
    )?);
    let count = snapshot.video.sources.len().to_string();
    let data = state.preview.frame(snapshot).await?;
    Ok((
        [
            (header::CONTENT_TYPE, "image/png"),
            (
                header::HeaderName::from_static("x-venturi-proxy-count"),
                count.as_str(),
            ),
        ],
        data,
    )
        .into_response())
}
async fn scopes(
    State(state): State<AppState>,
    Path((clip, first, second)): Path<(String, vv_render::ScopeKind, vv_render::ScopeKind)>,
    query: std::result::Result<Query<FrameQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid scope query"))?
        .0;
    let snapshot = state.host.frame_snapshot(query.clone()).await?;
    let data = state
        .preview
        .scopes(snapshot, &clip, [first, second])
        .await?;
    state.host.call(Action::CheckFrame(query)).await?;
    Ok(([(header::CONTENT_TYPE, "image/png")], data).into_response())
}
async fn balance(
    State(state): State<AppState>,
    Path(clip): Path<String>,
    query: std::result::Result<Query<FrameQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid balance query"))?
        .0;
    let snapshot = state.host.frame_snapshot(query.clone()).await?;
    let result = state.preview.balance(snapshot, &clip).await?;
    state.host.call(Action::CheckFrame(query)).await?;
    Ok(Json(result))
}
async fn timeline(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>> {
    state.host.call(Action::Timeline(id)).await.map(Json)
}
async fn compound_navigation(
    State(state): State<AppState>,
    Path(id): Path<String>,
    payload: std::result::Result<
        Json<crate::compound_navigation::Request>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Json<Value>> {
    let request = payload
        .map_err(|_| ApiError::invalid("Invalid compound navigation request"))?
        .0;
    if request.query.timeline_id != id {
        return Err(ApiError::invalid("Timeline ID does not match the query"));
    }
    state
        .host
        .call(Action::CompoundNavigation(request))
        .await
        .map(Json)
}
async fn inspector_selection(
    State(state): State<AppState>,
    Path(id): Path<String>,
    payload: std::result::Result<
        Json<crate::selection::Request>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Json<Value>> {
    let request = payload
        .map_err(|_| ApiError::invalid("Invalid Inspector selection query"))?
        .0;
    if request.query.timeline_id != id {
        return Err(ApiError::invalid("Timeline ID does not match the query"));
    }
    state
        .host
        .call(Action::InspectorSelection(request))
        .await
        .map(Json)
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
        .call(Action::ClipDetail(clip, query, None))
        .await
        .map(Json)
}
async fn project_view(
    State(state): State<AppState>,
    payload: std::result::Result<
        Json<crate::project_view::Request>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Json<Value>> {
    let request = payload
        .map_err(|_| ApiError::invalid("Invalid project view request"))?
        .0;
    state
        .host
        .call(Action::ProjectView(request))
        .await
        .map(Json)
}
async fn curve_viewport(
    State(state): State<AppState>,
    Path((id, clip)): Path<(String, String)>,
    payload: std::result::Result<
        Json<crate::curves::ViewportRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Json<Value>> {
    let request = payload
        .map_err(|_| ApiError::invalid("Invalid native curve viewport request"))?
        .0;
    if request.query.timeline_id != id {
        return Err(ApiError::invalid("Timeline ID does not match the query"));
    }
    state
        .host
        .call(Action::CurveViewport(clip, request))
        .await
        .map(Json)
}

async fn keyframe_navigation(
    State(state): State<AppState>,
    Path((id, clip)): Path<(String, String)>,
    payload: std::result::Result<
        Json<crate::host::KeyframeNavigationRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Json<Value>> {
    let request = payload
        .map_err(|_| ApiError::invalid("Invalid native keyframe navigation request"))?
        .0;
    if request.query.timeline_id != id {
        return Err(ApiError::invalid("Timeline ID does not match the query"));
    }
    state
        .host
        .call(Action::KeyframeNavigation(clip, request))
        .await
        .map(Json)
}
async fn clip_key_page(
    State(state): State<AppState>,
    Path((id, clip, page)): Path<(String, String, usize)>,
    query: std::result::Result<Query<FrameQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>> {
    let query = query
        .map_err(|_| ApiError::invalid("Invalid clip key page query"))?
        .0;
    if query.timeline_id != id {
        return Err(ApiError::invalid("Timeline ID does not match the query"));
    }
    state
        .host
        .call(Action::ClipDetail(clip, query, Some(page)))
        .await
        .map(Json)
}
async fn recovery_status(State(state): State<AppState>) -> Result<Json<Value>> {
    state.host.call(Action::Recovery).await.map(Json)
}
async fn capture_preset(
    State(state): State<AppState>,
    Path(id): Path<String>,
    payload: std::result::Result<
        Json<crate::presets::Capture>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Result<Json<Value>> {
    let request = payload
        .map_err(|_| ApiError::invalid("Invalid preset capture request"))?
        .0;
    if request.query.timeline_id != id {
        return Err(ApiError::invalid(
            "Timeline ID does not match the preset query",
        ));
    }
    state
        .host
        .call(Action::CapturePreset(request))
        .await
        .map(Json)
}
async fn apply_attribute_preset(
    State(state): State<AppState>,
    Path(id): Path<String>,
    payload: std::result::Result<Json<Mutation>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    let request = payload
        .map_err(|_| ApiError::invalid("Invalid native preset mutation"))?
        .0;
    if !matches!(
        request.operation,
        crate::commands::Operation::ApplyAttributePreset { .. }
    ) {
        return Err(ApiError::invalid(
            "This route accepts only native attribute preset application",
        ));
    }
    state
        .host
        .call(Action::Mutation(Some(id), request))
        .await
        .map(Json)
}
async fn projects(State(state): State<AppState>) -> Result<Json<Value>> {
    state.host.call(Action::Projects).await.map(Json)
}
async fn media_sources(
    State(state): State<AppState>,
    query: std::result::Result<
        Query<crate::files::SourcesQuery>,
        axum::extract::rejection::QueryRejection,
    >,
) -> Result<Response> {
    state
        .host
        .source_browser(
            query
                .map_err(|_| ApiError::invalid("Invalid approved source directory query"))?
                .0,
        )
        .await
        .map(native_asset_json)
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
    let request = payload
        .map_err(|_| ApiError::invalid("Invalid command JSON"))?
        .0;
    if matches!(
        request.operation,
        crate::commands::Operation::PublishNativeAsset { .. }
            | crate::commands::Operation::EditNativeAssetLibrary { .. }
    ) {
        return Err(ApiError::invalid(
            "Native asset library writes require the native asset command endpoint",
        ));
    }
    state.host.project_mutation(request).await.map(Json)
}
async fn timeline_command(
    State(state): State<AppState>,
    Path(id): Path<String>,
    payload: std::result::Result<Json<Mutation>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    let request = payload
        .map_err(|_| ApiError::invalid("Invalid command JSON"))?
        .0;
    if matches!(
        request.operation,
        crate::commands::Operation::PlaceSource { .. }
    ) {
        return state
            .host
            .call(Action::SourcePlacementMutation(
                id,
                request,
                state.source.clone(),
            ))
            .await
            .map(Json);
    }
    state.host.timeline_mutation(id, request).await.map(Json)
}
async fn lookup(State(state): State<AppState>, Path(id): Path<String>) -> Result<Response> {
    let value = state.host.call(Action::Lookup(id)).await?;
    if matches!(value["status"].as_str(), Some("pending" | "preparing")) {
        return Ok((StatusCode::CONFLICT,[(header::CACHE_CONTROL,"no-store")],Json(json!({"error":{"code":"OUTCOME_UNKNOWN","message":"The command is preparing or requires recovery; resolve this command before retrying","details":value,"recoverable":true}}))).into_response());
    }
    Ok(Json(value).into_response())
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
    headers.insert(header::CONTENT_SECURITY_POLICY,"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'".parse().unwrap());
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
        "/style/native-shell.css" => asset!("/web/style/native-shell.css", "text/css"),
        "/style/native-browser.css" => asset!("/web/style/native-browser.css", "text/css"),
        "/style/native-inspector.css" => asset!("/web/style/native-inspector.css", "text/css"),

        "/js/proxies.js" => asset!("/web/js/proxies.js", "text/javascript"),
        "/js/main.js" => asset!("/web/js/main.js", "text/javascript"),
        "/js/compound-navigation.js" => asset!("/web/js/compound-navigation.js", "text/javascript"),
        "/js/project-view.js" => asset!("/web/js/project-view.js", "text/javascript"),
        "/js/ui.js" => asset!("/web/js/ui.js", "text/javascript"),
        "/js/api.js" => asset!("/web/js/api.js", "text/javascript"),
        "/js/viewer.js" => asset!("/web/js/viewer.js", "text/javascript"),
        "/js/viewer-zoom.js" => asset!("/web/js/viewer-zoom.js", "text/javascript"),
        "/js/scopes.js" => asset!("/web/js/scopes.js", "text/javascript"),
        "/js/balance.js" => asset!("/web/js/balance.js", "text/javascript"),
        "/js/source.js" => asset!("/web/js/source.js", "text/javascript"),
        "/js/source-assets.js" => asset!("/web/js/source-assets.js", "text/javascript"),
        "/js/retime-menu.js" => asset!("/web/js/retime-menu.js", "text/javascript"),
        "/js/retime-visibility.js" => asset!("/web/js/retime-visibility.js", "text/javascript"),
        "/js/source-clock.js" => asset!("/web/js/source-clock.js", "text/javascript"),
        "/js/source-seek.js" => asset!("/web/js/source-seek.js", "text/javascript"),
        "/js/program.js" => asset!("/web/js/program.js", "text/javascript"),
        "/js/program-range.js" => asset!("/web/js/program-range.js", "text/javascript"),
        "/js/export.js" => asset!("/web/js/export.js", "text/javascript"),
        "/js/inspector.js" => asset!("/web/js/inspector.js", "text/javascript"),
        "/js/keyframe-navigation.js" => asset!("/web/js/keyframe-navigation.js", "text/javascript"),
        "/js/curves.js" => asset!("/web/js/curves.js", "text/javascript"),
        "/js/curve-viewport.js" => asset!("/web/js/curve-viewport.js", "text/javascript"),
        "/js/curve-window.js" => asset!("/web/js/curve-window.js", "text/javascript"),
        "/js/source-placement.js" => asset!("/web/js/source-placement.js", "text/javascript"),
        "/js/project-pool-placement.js" => {
            asset!("/web/js/project-pool-placement.js", "text/javascript")
        }
        "/js/source-waveform.js" => asset!("/web/js/source-waveform.js", "text/javascript"),
        "/js/eventkeys.js" => asset!("/web/js/eventkeys.js", "text/javascript"),
        "/js/keyselection.js" => asset!("/web/js/keyselection.js", "text/javascript"),
        "/js/keyframe-lanes.js" => asset!("/web/js/keyframe-lanes.js", "text/javascript"),
        "/js/presets.js" => asset!("/web/js/presets.js", "text/javascript"),
        "/js/preset-shortcuts.js" => asset!("/web/js/preset-shortcuts.js", "text/javascript"),
        "/js/audio-presets.js" => asset!("/web/js/audio-presets.js", "text/javascript"),
        "/js/viewer-transform.js" => asset!("/web/js/viewer-transform.js", "text/javascript"),
        "/js/viewer-transform-overlay.js" => {
            asset!("/web/js/viewer-transform-overlay.js", "text/javascript")
        }
        "/js/viewer-mask.js" => asset!("/web/js/viewer-mask.js", "text/javascript"),
        "/js/viewer-mask-pen.js" => asset!("/web/js/viewer-mask-pen.js", "text/javascript"),
        "/js/viewer-mask-overlay.js" => {
            asset!("/web/js/viewer-mask-overlay.js", "text/javascript")
        }
        "/js/catalog.js" => asset!("/web/js/catalog.js", "text/javascript"),
        "/js/catalog-interactions.js" => {
            asset!("/web/js/catalog-interactions.js", "text/javascript")
        }
        "/js/catalog-menu.js" => asset!("/web/js/catalog-menu.js", "text/javascript"),
        "/js/slip.js" => asset!("/web/js/slip.js", "text/javascript"),
        "/js/silence.js" => asset!("/web/js/silence.js", "text/javascript"),
        "/js/library.js" => asset!("/web/js/library.js", "text/javascript"),
        "/js/native-assets.js" => asset!("/web/js/native-assets.js", "text/javascript"),
        "/js/source-picker.js" => asset!("/web/js/source-picker.js", "text/javascript"),
        "/js/native-asset-folders.js" => {
            asset!("/web/js/native-asset-folders.js", "text/javascript")
        }
        "/js/media-import.js" => asset!("/web/js/media-import.js", "text/javascript"),
        "/js/media-relink.js" => asset!("/web/js/media-relink.js", "text/javascript"),
        "/js/otio-import.js" => asset!("/web/js/otio-import.js", "text/javascript"),
        "/js/clipboard.js" => asset!("/web/js/clipboard.js", "text/javascript"),
        "/js/clipboard-image.js" => asset!("/web/js/clipboard-image.js", "text/javascript"),
        "/js/mark-range.js" => asset!("/web/js/mark-range.js", "text/javascript"),
        "/js/voiceover.js" => asset!("/web/js/voiceover.js", "text/javascript"),
        "/js/review.js" => asset!("/web/js/review.js", "text/javascript"),
        "/js/reviewmeta.js" => asset!("/web/js/reviewmeta.js", "text/javascript"),
        "/js/attributes.js" => asset!("/web/js/attributes.js", "text/javascript"),
        "/js/recovery.js" => asset!("/web/js/recovery.js", "text/javascript"),
        "/js/audition.js" => asset!("/web/js/audition.js", "text/javascript"),
        "/js/fast-transport.js" => asset!("/web/js/fast-transport.js", "text/javascript"),
        "/js/preview-cache.js" => asset!("/web/js/preview-cache.js", "text/javascript"),
        "/js/audio-meters.js" => asset!("/web/js/audio-meters.js", "text/javascript"),
        "/js/capture.js" => asset!("/web/js/capture.js", "text/javascript"),
        "/js/capture-worklet.js" => asset!("/web/js/capture-worklet.js", "text/javascript"),
        "/js/capture-buffer.js" => asset!("/web/js/capture-buffer.js", "text/javascript"),
        "/js/mixer.js" => asset!("/web/js/mixer.js", "text/javascript"),
        "/js/visual.js" => asset!("/web/js/visual.js", "text/javascript"),
        "/js/masks.js" => asset!("/web/js/masks.js", "text/javascript"),
        "/js/timeline/index.js" => asset!("/web/js/timeline/index.js", "text/javascript"),
        "/js/timeline/geometry.js" => asset!("/web/js/timeline/geometry.js", "text/javascript"),
        "/js/timeline/input.js" => asset!("/web/js/timeline/input.js", "text/javascript"),
        "/js/timeline/preset-drop.js" => {
            asset!("/web/js/timeline/preset-drop.js", "text/javascript")
        }
        "/js/timeline/asset-drop.js" => {
            asset!("/web/js/timeline/asset-drop.js", "text/javascript")
        }
        "/js/timeline/draw.js" => asset!("/web/js/timeline/draw.js", "text/javascript"),
        _ => return ApiError::missing().into_response(),
    };
    ([(header::CONTENT_TYPE, mime)], body).into_response()
}

#[cfg(test)]
#[path = "tests/api.rs"]
mod tests;

#[cfg(test)]
#[path = "tests/project_media_api.rs"]
mod project_media_tests;
