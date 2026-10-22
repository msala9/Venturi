use super::*;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use tower::ServiceExt;

#[tokio::test]
async fn native_asset_source_browser_http_is_lease_free_epoch_bound_strict_and_embeds_picker() {
    let root = std::env::temp_dir().join(format!(
        "vv-native-source-http-{}",
        crate::asset_jobs::nonce()
    ));
    std::fs::create_dir_all(root.join("Footage/Sub")).unwrap();
    std::fs::create_dir_all(root.join(".private")).unwrap();
    std::fs::write(root.join("Footage/take.png"), b"listing does not probe").unwrap();
    let host = Host::start(&root).unwrap();
    host.call(Action::Lease("another-editor".into()))
        .await
        .unwrap();
    let before = host.call(Action::Session).await.unwrap();
    let epoch = before["project_epoch"].as_str().unwrap();
    let app = router(AppState {
        host: host.clone(),
        port: 8787,
        preview: Preview::disabled(),
        codecs: crate::codecs::Codecs::new(Preview::disabled()),
        source: MediaJobs::start().unwrap(),
        silence: crate::silence::Jobs::start(),
        library: crate::library::Library::default(),
        recordings: crate::recording::Store::new(std::fs::File::open(&root).unwrap()),
    });
    for (path, expected) in [
        (
            format!("/api/v1/media/sources?project_epoch={epoch}"),
            StatusCode::OK,
        ),
        (
            format!("/api/v1/media/sources?project_epoch={epoch}&directory_token=Footage"),
            StatusCode::OK,
        ),
        (
            "/api/v1/media/sources".into(),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            "/api/v1/media/sources?project_epoch=stale".into(),
            StatusCode::CONFLICT,
        ),
        (
            format!("/api/v1/media/sources?project_epoch={epoch}&directory_token=.."),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            format!("/api/v1/media/sources?project_epoch={epoch}&force=true"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            format!("/api/v1/media/sources?project_epoch={epoch}&page=999"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let request = Request::builder()
            .uri(&path)
            .header("host", "127.0.0.1:8787")
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        if expected == StatusCode::OK {
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        }
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
        assert_eq!(status, expected, "{path}: {body}");
        if expected == StatusCode::OK {
            assert_eq!(body["project_epoch"], epoch);
            assert!(
                body["entries"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|item| item["name"] != ".private")
            );
            if body["directory_token"] == "Footage" {
                assert!(
                    body["entries"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|item| item["path_token"] == "Footage/take.png"
                            && item["kind"] == "media")
                );
            }
        }
    }
    let request = Request::builder()
        .uri("/js/source-picker.js")
        .header("host", "127.0.0.1:8787")
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        response.headers()[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .contains("javascript")
    );
    assert_eq!(host.call(Action::Session).await.unwrap(), before);
    drop(app);
    drop(host);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn inspector_selection_http_uses_one_guarded_read_without_a_writer_client() {
    let root =
        std::env::temp_dir().join(format!("vv-selection-http-{}", crate::asset_jobs::nonce()));
    let host = Host::start(&root).unwrap();
    let initial = host.call(Action::Session).await.unwrap();
    let create = crate::commands::Mutation {
        command_id: "selection-project".into(),
        client_id: "owner".into(),
        command_epoch: initial["command_epoch"].as_str().map(str::to_owned),
        project_epoch: initial["project_epoch"].as_str().unwrap().into(),
        if_generation: initial["generation"].as_str().unwrap().into(),
        if_revision: None,
        operation: crate::commands::Operation::NewProject {
            name: "Selection".into(),
        },
    };
    host.call(Action::Mutation(None, create)).await.unwrap();
    let initial = host.call(Action::Session).await.unwrap();
    let timeline = initial["timelines"][0]["id"].as_str().unwrap().to_owned();
    let add = crate::commands::Mutation {
        command_id: "selection-base".into(),
        client_id: "owner".into(),
        command_epoch: initial["command_epoch"].as_str().map(str::to_owned),
        project_epoch: initial["project_epoch"].as_str().unwrap().into(),
        if_generation: initial["generation"].as_str().unwrap().into(),
        if_revision: Some(initial["timelines"][0]["revision"].as_str().unwrap().into()),
        operation: crate::commands::Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 48,
        },
    };
    host.call(Action::Mutation(Some(timeline.clone()), add))
        .await
        .unwrap();
    let session = host.call(Action::Session).await.unwrap();
    let current = host.call(Action::Timeline(timeline.clone())).await.unwrap();
    let clip = current["tracks"][0]["clips"][0]["id"].as_str().unwrap();
    let app = router(AppState {
        host: host.clone(),
        port: 8787,
        preview: Preview::disabled(),
        codecs: crate::codecs::Codecs::new(Preview::disabled()),
        source: MediaJobs::start().unwrap(),
        silence: crate::silence::Jobs::start(),
        library: crate::library::Library::default(),
        recordings: crate::recording::Store::new(std::fs::File::open(&root).unwrap()),
    });
    let body = json!({"query":{"timeline_id":timeline,"project_epoch":session["project_epoch"],"if_generation":session["generation"],"revision":current["revision"],"frame":99,"width":16},"clip_ids":[clip]});
    for case in 0..5 {
        let mut body = body.clone();
        let path = if case == 1 { "999" } else { &timeline };
        let expected = match case {
            0 => StatusCode::OK,
            1 => StatusCode::UNPROCESSABLE_ENTITY,
            2 => {
                body["query"]["if_generation"] = json!("999");
                StatusCode::CONFLICT
            }
            3 => {
                body["extra"] = json!(true);
                StatusCode::UNPROCESSABLE_ENTITY
            }
            _ => {
                body["clip_ids"] = json!([clip, clip]);
                StatusCode::UNPROCESSABLE_ENTITY
            }
        };
        let request = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/timelines/{path}/inspector-selection"))
            .header("host", "127.0.0.1:8787")
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), expected, "case {case}");
        if case == 0 {
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
            let read: Value =
                serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap())
                    .unwrap();
            assert_eq!(read["query"], body["query"]);
            assert_eq!(read["rows"][0]["source_frame"], 47);
        }
    }
    assert_eq!(host.call(Action::Session).await.unwrap(), session);
    let viewport = json!({"query":body["query"],"target":{"kind":"transform","param":"Opacity"},"source_start":0,"source_end":48,"points":3});
    for case in 0..11 {
        let mut payload = viewport.clone();
        let path = if case == 1 { "999" } else { &timeline };
        let expected = match case {
            0 => StatusCode::OK,
            1 => StatusCode::UNPROCESSABLE_ENTITY,
            2 => {
                payload["query"]["if_generation"] = json!("999");
                StatusCode::CONFLICT
            }
            3 => {
                payload["unexpected"] = json!(true);
                StatusCode::UNPROCESSABLE_ENTITY
            }
            4 => {
                payload["query"]["unexpected"] = json!(true);
                StatusCode::UNPROCESSABLE_ENTITY
            }
            5 => {
                payload["target"]["unexpected"] = json!(true);
                StatusCode::UNPROCESSABLE_ENTITY
            }
            6 => {
                payload["points"] = json!(2049);
                StatusCode::UNPROCESSABLE_ENTITY
            }
            7 => {
                payload["source_end"] = json!(49);
                StatusCode::UNPROCESSABLE_ENTITY
            }
            8 => {
                payload["source_start"] = json!(0.5);
                StatusCode::UNPROCESSABLE_ENTITY
            }
            9 => {
                payload["target"] = json!({"kind":"gain"});
                StatusCode::NOT_FOUND
            }
            _ => {
                payload["target"] = json!({"kind":"gain","unexpected":true});
                StatusCode::UNPROCESSABLE_ENTITY
            }
        };
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/api/v1/timelines/{path}/clips/{clip}/curve-viewport"
                    ))
                    .header("host", "127.0.0.1:8787")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let value: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
        assert_eq!(status, expected, "curve case {case}: {value}");
        if case == 0 {
            assert_eq!(value["clip_id"], clip);
            assert_eq!(value["project_epoch"], session["project_epoch"]);
            assert_eq!(value["generation"], session["generation"]);
            assert_eq!(value["timeline_id"], timeline);
            assert_eq!(value["revision"], current["revision"]);
            assert_eq!(value["target"], payload["target"]);
            assert_eq!(value["source_start"], 0);
            assert_eq!(value["source_end"], 48);
            assert_eq!(value["points"], 3);
            assert_eq!(
                value["samples"],
                json!([[0.0, 100.0], [24.0, 100.0], [48.0, 100.0]])
            );
        }
    }
    assert_eq!(host.call(Action::Session).await.unwrap(), session);
    drop(app);
    drop(host);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn audio_preset_http_library_is_native_strict_retry_safe_and_project_independent() {
    use sha2::Digest;
    let root = std::env::temp_dir().join(format!(
        "vv-audio-preset-http-{}",
        crate::asset_jobs::nonce()
    ));
    let host = Host::start(&root).unwrap();
    let app = router(AppState {
        host: host.clone(),
        port: 8787,
        preview: Preview::disabled(),
        codecs: crate::codecs::Codecs::new(Preview::disabled()),
        source: MediaJobs::start().unwrap(),
        silence: crate::silence::Jobs::start(),
        library: crate::library::Library::default(),
        recordings: crate::recording::Store::new(std::fs::File::open(&root).unwrap()),
    });
    let make = |method: &str, path: &str, body: Option<&Value>| {
        Request::builder()
            .method(method)
            .uri(path)
            .header("host", "127.0.0.1:8787")
            .header("content-type", "application/json")
            .body(body.map_or_else(Body::empty, |value| Body::from(value.to_string())))
            .unwrap()
    };
    let initial = host.call(Action::Session).await.unwrap();
    assert!(initial["project_name"].is_null());
    let query = format!(
        "/api/v1/audio/presets?project_epoch={}",
        initial["project_epoch"].as_str().unwrap()
    );
    let response = app
        .clone()
        .oneshot(make("GET", &query, None))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let blank: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    assert_eq!(blank["project_epoch"], initial["project_epoch"]);
    assert_eq!(blank["eq_presets"], json!([]));
    assert_eq!(blank["compressor_presets"], json!([]));
    assert_eq!(
        blank["revision"],
        json!(format!("{:x}", sha2::Sha256::digest([])))
    );
    for (path, expected) in [
        (
            "/api/v1/audio/presets".to_owned(),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            format!("{query}&extra=true"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            "/api/v1/audio/presets?project_epoch=foreign-project".to_owned(),
            StatusCode::CONFLICT,
        ),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(make("GET", &path, None))
                .await
                .unwrap()
                .status(),
            expected
        );
    }
    let lease = json!({"client_id":"audio-preset-browser"});
    assert_eq!(
        app.clone()
            .oneshot(make("POST", "/api/v1/lease", Some(&lease)))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let before = host.call(Action::Session).await.unwrap();
    let mutation = |id: &str, operation: Value| {
        json!({
            "command_id":id, "client_id":"audio-preset-browser", "command_epoch":before["command_epoch"],
            "project_epoch":before["project_epoch"], "if_generation":before["generation"],
            "if_revision":null, "operation":operation,
        })
    };
    let mut eq = vv_core::Equalizer::DEFAULT;
    eq.bands[2].gain_db = -4.0;
    let save = mutation(
        "audio-http-save",
        json!({"kind":"edit_audio_preset_library","edit":{
            "action":"save","name":"  Mine / α  ","revision":blank["revision"],
            "parameters":vv_core::AudioEffectKind::Equalizer(eq.clone()),
        }}),
    );
    let path = "/api/v1/audio/presets/commands";
    let mut original_ack = None;
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(make("POST", path, Some(&save)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let ack: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
        if let Some(first) = &original_ack {
            assert_eq!(first, &ack);
        } else {
            original_ack = Some(ack);
        }
        assert_eq!(host.call(Action::Session).await.unwrap(), before);
    }
    let response = app
        .clone()
        .oneshot(make("GET", &query, None))
        .await
        .unwrap();
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let listed: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    assert_eq!(
        listed["eq_presets"],
        json!([{"name":"Mine / α","params":eq}])
    );
    assert_eq!(listed["compressor_presets"], json!([]));
    assert_ne!(listed["revision"], blank["revision"]);
    let preset_file = root.join(".presets/.venturi-audio-presets.json");
    let bytes = std::fs::read(&preset_file).unwrap();
    let mut malformed = save.clone();
    malformed["command_id"] = json!("audio-http-malformed");
    malformed["operation"]["edit"]["revision"] = listed["revision"].clone();
    malformed["operation"]["edit"]["parameters"]["Equalizer"]["bands"][0]["freq_hz"] = json!(-1.0);
    let mut unknown = save.clone();
    unknown["command_id"] = json!("audio-http-unknown");
    unknown["operation"]["edit"]["extra"] = json!(true);
    for body in [
        malformed,
        unknown,
        mutation("audio-http-wrong-operation", json!({"kind":"save"})),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(make("POST", path, Some(&body)))
                .await
                .unwrap()
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(std::fs::read(&preset_file).unwrap(), bytes);
        assert_eq!(host.call(Action::Session).await.unwrap(), before);
    }
    let valid = mutation(
        "audio-http-origin",
        json!({"kind":"edit_audio_preset_library","edit":{
            "action":"save","name":"Blocked","revision":listed["revision"],
            "parameters":vv_core::AudioEffectKind::Equalizer(vv_core::Equalizer::DEFAULT),
        }}),
    );
    let mut foreign_origin = make("POST", path, Some(&valid));
    foreign_origin
        .headers_mut()
        .insert(header::ORIGIN, "https://evil.example".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(foreign_origin).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let mut foreign_writer = valid;
    foreign_writer["command_id"] = json!("audio-http-other-writer");
    foreign_writer["client_id"] = json!("other-browser");
    assert_eq!(
        app.clone()
            .oneshot(make("POST", path, Some(&foreign_writer)))
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    assert_eq!(std::fs::read(preset_file).unwrap(), bytes);
    assert_eq!(host.call(Action::Session).await.unwrap(), before);
    assert_eq!(
        app.clone()
            .oneshot(make("GET", "/js/audio-presets.js", None))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    drop(app);
    drop(host);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn bitmap_clipboard_http_checks_saved_binding_mime_body_limit_and_typed_cancel_before_import()
{
    let root = std::env::temp_dir().join(format!("vv-image-http-{}", crate::asset_jobs::nonce()));
    let host = Host::start(&root).unwrap();
    let app = router(AppState {
        host: host.clone(),
        port: 8787,
        preview: Preview::disabled(),
        codecs: crate::codecs::Codecs::new(Preview::disabled()),
        source: MediaJobs::start().unwrap(),
        silence: crate::silence::Jobs::start(),
        library: crate::library::Library::default(),
        recordings: crate::recording::Store::new(std::fs::File::open(&root).unwrap()),
    });
    let make = |method: &str, path: &str, mime: &str, body: Vec<u8>| {
        Request::builder()
            .method(method)
            .uri(path)
            .header("host", "127.0.0.1:8787")
            .header("content-type", mime)
            .body(Body::from(body))
            .unwrap()
    };
    let url = |session: &Value| {
        format!(
            "/api/v1/clipboard/images/prepare?project_epoch={}&if_generation={}",
            session["project_epoch"].as_str().unwrap(),
            session["generation"].as_str().unwrap()
        )
    };
    let initial = host.call(Action::Session).await.unwrap();
    assert_eq!(
        app.clone()
            .oneshot(make("POST", &url(&initial), "image/png", vec![1]))
            .await
            .unwrap()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    host.call(Action::Lease("image-http".into())).await.unwrap();
    host.call(Action::Mutation(
        None,
        Mutation {
            command_id: "image-http-project".into(),
            client_id: "image-http".into(),
            command_epoch: Some(initial["command_epoch"].as_str().unwrap().into()),
            project_epoch: initial["project_epoch"].as_str().unwrap().into(),
            if_generation: initial["generation"].as_str().unwrap().into(),
            if_revision: None,
            operation: crate::commands::Operation::NewProject {
                name: "Image_HTTP".into(),
            },
        },
    ))
    .await
    .unwrap();
    let before = host.call(Action::Session).await.unwrap();
    assert_eq!(
        app.clone()
            .oneshot(make(
                "POST",
                &(url(&before) + "&path=/tmp/outside"),
                "image/png",
                vec![1]
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        app.clone()
            .oneshot(make(
                "POST",
                &url(&before),
                "image/svg+xml",
                b"<svg/>".to_vec()
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut foreign = make("POST", &url(&before), "image/png", vec![1]);
    foreign
        .headers_mut()
        .insert(header::ORIGIN, "https://evil.example".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(foreign).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.clone()
            .oneshot(make(
                "POST",
                &url(&before),
                "image/png",
                vec![0; crate::clipboard_image::MAX_BYTES + 1]
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, 16, 16);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&vec![127; 16 * 16 * 4])
            .unwrap();
    }
    let response = app
        .clone()
        .oneshot(make("POST", &url(&before), "image/png", png_bytes.clone()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let job: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    let path = format!(
        "/api/v1/clipboard/images/jobs/{}?project_epoch={}",
        job["id"].as_str().unwrap(),
        before["project_epoch"].as_str().unwrap()
    );
    let until = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let response = app
            .clone()
            .oneshot(make("GET", &path, "image/png", vec![]))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let value: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
        if value["state"] == "ready" {
            assert_eq!(value["result"]["bytes"], png_bytes.len());
            assert_eq!(value["result"]["width"], 16);
            break;
        }
        assert!(
            matches!(value["state"].as_str(), Some("queued" | "running")),
            "{value}"
        );
        assert!(std::time::Instant::now() < until);
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    let wrong = path.replace("/clipboard/images/jobs/", "/clipboard/jobs/");
    assert_eq!(
        app.clone()
            .oneshot(make("DELETE", &wrong, "image/png", vec![]))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    let response = app
        .clone()
        .oneshot(make("DELETE", &path, "image/png", vec![]))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let canceled: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    assert_eq!(canceled["state"], "canceled");
    assert_eq!(host.call(Action::Session).await.unwrap(), before);
    assert!(!root.join("Pasted Images").exists());
    assert_eq!(
        app.clone()
            .oneshot(make("GET", "/js/clipboard-image.js", "image/png", vec![]))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    drop(app);
    drop(host);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn clipboard_http_preparation_is_bounded_strict_read_only_and_typed() {
    let root =
        std::env::temp_dir().join(format!("vv-clipboard-http-{}", crate::asset_jobs::nonce()));
    let host = Host::start(&root).unwrap();
    let initial = host.call(Action::Session).await.unwrap();
    let app = router(AppState {
        host: host.clone(),
        port: 8787,
        preview: Preview::disabled(),
        codecs: crate::codecs::Codecs::new(Preview::disabled()),
        source: MediaJobs::start().unwrap(),
        silence: crate::silence::Jobs::start(),
        library: crate::library::Library::default(),
        recordings: crate::recording::Store::new(std::fs::File::open(&root).unwrap()),
    });
    let mut project = vv_core::Project::default();
    let clip = vv_core::Clip::from_source_range(
        project.alloc_clip_id(),
        vv_core::ClipSource::SolidColor,
        0,
        12,
        0,
        vv_core::Rational::new(1, 1),
    );
    let payload = vv_core::clipboard::ClipboardPayload::new(
        vv_core::clipboard::ClipboardOrigin {
            instance: 7,
            epoch: 1,
        },
        &project,
        &[],
        &[vv_core::clipboard::ClipboardEntry {
            track_kind: vv_core::TrackKind::Video,
            track_number: 1,
            relative_start: 0,
            clip,
            timeline_fps: vv_core::Rational::new(24, 1),
            link_tag: None,
        }],
    )
    .to_text();
    let make = |method: &str, path: &str, body: Value| {
        Request::builder()
            .method(method)
            .uri(path)
            .header("host", "127.0.0.1:8787")
            .header("content-type", "application/json")
            .body(if body.is_null() {
                Body::empty()
            } else {
                Body::from(body.to_string())
            })
            .unwrap()
    };
    let prepare = json!({"project_epoch":initial["project_epoch"],"if_generation":initial["generation"],"text":payload,"to_pool":false});
    let mut invalid = prepare.clone();
    invalid["path_token"] = json!("outside");
    assert_eq!(
        app.clone()
            .oneshot(make("POST", "/api/v1/clipboard/prepare", invalid))
            .await
            .unwrap()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut large = prepare.clone();
    large["text"] = json!("x".repeat(4 * 1024 * 1024 + 1));
    assert_eq!(
        app.clone()
            .oneshot(make("POST", "/api/v1/clipboard/prepare", large))
            .await
            .unwrap()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut foreign = make("POST", "/api/v1/clipboard/prepare", prepare.clone());
    foreign
        .headers_mut()
        .insert(header::ORIGIN, "https://evil.example".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(foreign).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let response = app
        .clone()
        .oneshot(make("POST", "/api/v1/clipboard/prepare", prepare))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let job: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    let path = format!(
        "/api/v1/clipboard/jobs/{}?project_epoch={}",
        job["id"].as_str().unwrap(),
        initial["project_epoch"].as_str().unwrap()
    );
    let until = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let response = app
            .clone()
            .oneshot(make("GET", &path, Value::Null))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let value: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
        if value["state"] == "ready" {
            assert_eq!(value["result"]["clip_count"], 1);
            break;
        }
        assert!(
            matches!(value["state"].as_str(), Some("queued" | "running")),
            "{value}"
        );
        assert!(std::time::Instant::now() < until);
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    assert_eq!(host.call(Action::Session).await.unwrap(), initial);
    let wrong = path.replace("/clipboard/jobs/", "/projects/otio/jobs/");
    assert_eq!(
        app.clone()
            .oneshot(make("DELETE", &wrong, Value::Null))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    let response = app
        .clone()
        .oneshot(make("DELETE", &path, Value::Null))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(host.call(Action::Session).await.unwrap(), initial);
    drop(app);
    drop(host);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn otio_prepare_http_is_strict_read_only_and_current_import_has_explicit_reuse() {
    let root = std::env::temp_dir().join(format!(
        "vv-otio-prepare-http-{}",
        crate::asset_jobs::nonce()
    ));
    let host = Host::start(&root).unwrap();
    let initial = host.call(Action::Session).await.unwrap();
    let mut source = vv_session::Session::default();
    let id = source.create_timeline(vv_core::Timeline {
        name: "Source".into(),
        fps: vv_core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![vv_core::Track::new(vv_core::TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    std::fs::write(
        root.join("source.otio"),
        serde_json::to_vec(&vv_core::otio::timeline_to_otio(&source.project, id, None)).unwrap(),
    )
    .unwrap();
    let app = router(AppState {
        host: host.clone(),
        port: 8787,
        preview: Preview::disabled(),
        codecs: crate::codecs::Codecs::new(Preview::disabled()),
        source: MediaJobs::start().unwrap(),
        silence: crate::silence::Jobs::start(),
        library: crate::library::Library::default(),
        recordings: crate::recording::Store::new(std::fs::File::open(&root).unwrap()),
    });
    let make = |method: &str, path: &str, body: Value| {
        Request::builder()
            .method(method)
            .uri(path)
            .header("host", "127.0.0.1:8787")
            .header("content-type", "application/json")
            .body(if body.is_null() {
                Body::empty()
            } else {
                Body::from(body.to_string())
            })
            .unwrap()
    };
    let prepare = json!({"project_epoch":initial["project_epoch"],"if_generation":initial["generation"],"path_token":"source.otio"});
    let mut invalid = prepare.clone();
    invalid["reuse_existing"] = json!(true);
    assert_eq!(
        app.clone()
            .oneshot(make("POST", "/api/v1/projects/otio/prepare", invalid))
            .await
            .unwrap()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut foreign = make("POST", "/api/v1/projects/otio/prepare", prepare.clone());
    foreign
        .headers_mut()
        .insert(header::ORIGIN, "https://evil.example".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(foreign).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let response = app
        .clone()
        .oneshot(make("POST", "/api/v1/projects/otio/prepare", prepare))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let job: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    let path = format!(
        "/api/v1/projects/otio/jobs/{}?project_epoch={}",
        job["id"].as_str().unwrap(),
        initial["project_epoch"].as_str().unwrap()
    );
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let response = app
            .clone()
            .oneshot(make("GET", &path, Value::Null))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let status: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
        if status["state"] == "ready" {
            assert_eq!(status["result"]["timeline_count"], 1);
            break;
        }
        assert!(
            matches!(status["state"].as_str(), Some("queued" | "running")),
            "{status}"
        );
        assert!(std::time::Instant::now() < deadline);
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    assert_eq!(host.call(Action::Session).await.unwrap(), initial);
    let mutation = json!({"command_id":"otio-current-http","client_id":"otio-browser","command_epoch":initial["command_epoch"],"project_epoch":initial["project_epoch"],"if_generation":initial["generation"],"if_revision":null,"operation":{"kind":"import_prepared_otio","job_id":job["id"],"name":"Imported","reuse_existing":false}});
    let mut missing = mutation.clone();
    missing["operation"]
        .as_object_mut()
        .unwrap()
        .remove("reuse_existing");
    assert_eq!(
        app.clone()
            .oneshot(make("POST", "/api/v1/projects/commands", missing))
            .await
            .unwrap()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let response = app
        .clone()
        .oneshot(make("POST", "/api/v1/projects/commands", mutation.clone()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let receipt: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    assert_eq!(receipt["timeline_ids"].as_array().unwrap().len(), 1);
    let response = app
        .clone()
        .oneshot(make("POST", "/api/v1/projects/commands", mutation))
        .await
        .unwrap();
    let replay: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    assert_eq!(receipt, replay);
    assert_eq!(
        app.clone()
            .oneshot(make("DELETE", &path, Value::Null))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        host.call(Action::Session).await.unwrap()["timelines"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    drop(app);
    drop(host);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn otio_http_export_matches_native_cpu_measured_title_background() {
    let root = std::env::temp_dir().join(format!(
        "vv-otio-text-http-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let mut session = vv_session::Session::default();
    let timeline = session.create_timeline(vv_core::Timeline {
        name: "Native text".into(),
        fps: vv_core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![vv_core::Track::new(vv_core::TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let mut clip = vv_core::Clip::from_source_range(
        session.project.alloc_clip_id(),
        vv_core::ClipSource::Text,
        0,
        24,
        0,
        vv_core::Rational::one(),
    );
    let mut title = vv_core::TitleParams::default();
    title.content.default = "Native title".into();
    title.size = 32.0;
    title.background.enabled = true;
    title.background.width = 0.0;
    title.background.height = 0.0;
    clip.effects.title = Some(title);
    session.project.timelines[timeline].tracks[0].insert_sorted(clip);
    session.sync_timeline_media(timeline);
    let measure = |title: &vv_core::TitleParams| vv_render::text::title_metrics(title);
    let expected = vv_core::otio::timeline_to_otio(&session.project, timeline, Some(&measure));
    let fallback = vv_core::otio::timeline_to_otio(&session.project, timeline, None);
    assert_ne!(
        expected, fallback,
        "Auto-sized title background needs measured dimensions"
    );
    crate::files::Files::new(&root)
        .unwrap()
        .save(&session.project, "title.vvproj", true)
        .unwrap();
    let host = Host::start(&root).unwrap();
    let state = host.call(Action::Session).await.unwrap();
    host.project_mutation(serde_json::from_value(json!({
        "command_id":"open-title", "client_id":"otio-text-browser", "command_epoch":state["command_epoch"],
        "project_epoch":state["project_epoch"], "if_generation":state["generation"], "if_revision":null,
        "operation":{"kind":"open_project","path_token":"title.vvproj"}
    })).unwrap()).await.unwrap();
    let before = host.call(Action::Session).await.unwrap();
    let timeline_id = before["timelines"][0]["id"].as_str().unwrap();
    let app = router(AppState {
        host: host.clone(),
        port: 8787,
        preview: Preview::disabled(),
        codecs: crate::codecs::Codecs::new(Preview::disabled()),
        source: MediaJobs::start().unwrap(),
        silence: crate::silence::Jobs::start(),
        library: crate::library::Library::default(),
        recordings: crate::recording::Store::new(std::fs::File::open(&root).unwrap()),
    });
    let query = format!(
        "project_epoch={}&if_generation={}&timeline_id={}&revision={}&frame=0&width=640",
        before["project_epoch"].as_str().unwrap(),
        before["generation"].as_str().unwrap(),
        timeline_id,
        before["timelines"][0]["revision"].as_str().unwrap()
    );
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/v1/timelines/{timeline_id}/timeline.otio?{query}"
                ))
                .header("host", "127.0.0.1:8787")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let actual: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
            .unwrap();
    assert_eq!(actual, expected);
    assert_eq!(
        host.call(Action::Session).await.unwrap(),
        before,
        "Export is read-only"
    );
    drop(app);
    drop(host);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn media_import_http_batch_is_explicit_native_single_undo_and_legacy_import_uses_worker() {
    let root = std::env::temp_dir().join(format!(
        "vv-import-http-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let host = Host::start(&root).unwrap();
    let session = host.call(Action::Session).await.unwrap();
    let mutation = |state: &Value, id: &str, operation: Value| json!({"command_id":id,"client_id":"import-browser","command_epoch":state["command_epoch"],"project_epoch":state["project_epoch"],"if_generation":state["generation"],"if_revision":null,"operation":operation});
    host.project_mutation(
        serde_json::from_value(mutation(
            &session,
            "new-import-project",
            json!({"kind":"new_project","name":"imports"}),
        ))
        .unwrap(),
    )
    .await
    .unwrap();
    let session = host.call(Action::Session).await.unwrap();
    let epoch = session["project_epoch"].as_str().unwrap();
    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&1636u32.to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&8000u32.to_le_bytes());
    wav.extend_from_slice(&16000u32.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&1600u32.to_le_bytes());
    wav.resize(1644, 0);
    std::fs::write(root.join("first.wav"), &wav).unwrap();
    std::fs::write(root.join("second.wav"), &wav).unwrap();
    std::fs::write(root.join("bad.wav"), b"not media").unwrap();
    let app = router(AppState {
        host: host.clone(),
        port: 8787,
        preview: Preview::disabled(),
        codecs: crate::codecs::Codecs::new(Preview::disabled()),
        source: MediaJobs::start().unwrap(),
        silence: crate::silence::Jobs::start(),
        library: crate::library::Library::default(),
        recordings: crate::recording::Store::new(std::fs::File::open(&root).unwrap()),
    });
    let make = |method: &str, path: &str, body: Value| {
        Request::builder()
            .method(method)
            .uri(path)
            .header("host", "127.0.0.1:8787")
            .header("content-type", "application/json")
            .body(if body.is_null() {
                Body::empty()
            } else {
                Body::from(body.to_string())
            })
            .unwrap()
    };
    for body in [
        json!({"project_epoch":epoch,"if_generation":session["generation"],"path_tokens":[],"force":true}),
        json!({"project_epoch":epoch,"if_generation":session["generation"],"path_tokens":["../escape.wav"]}),
        json!({"project_epoch":epoch,"if_generation":session["generation"],"path_tokens":(0..257).map(|n|format!("file-{n}.wav")).collect::<Vec<_>>()}),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(make("POST", "/api/v1/media/imports/prepare", body))
                .await
                .unwrap()
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let prepare = json!({"project_epoch":epoch,"if_generation":session["generation"],"path_tokens":["second.wav","bad.wav","first.wav","second.wav"]});
    let mut foreign = make("POST", "/api/v1/media/imports/prepare", prepare.clone());
    foreign
        .headers_mut()
        .insert(header::ORIGIN, "https://evil.example".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(foreign).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let response = app
        .clone()
        .oneshot(make("POST", "/api/v1/media/imports/prepare", prepare))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let job: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    let job_id = job["id"].as_str().unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let ready = loop {
        let response = app
            .clone()
            .oneshot(make(
                "GET",
                &format!("/api/v1/media/imports/{job_id}?project_epoch={epoch}"),
                Value::Null,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let value: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
        if value["state"] == "ready" {
            break value;
        }
        assert_ne!(value["state"], "failed", "{value}");
        assert!(std::time::Instant::now() < deadline);
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    };
    assert_eq!(ready["progress"], json!({"completed":3,"total":3}));
    assert_eq!(
        host.call(Action::Session).await.unwrap()["media"],
        session["media"]
    );
    for (path, status) in [
        (
            format!("/api/v1/media/imports/missing?project_epoch={epoch}"),
            StatusCode::NOT_FOUND,
        ),
        (
            format!("/api/v1/media/imports/{job_id}?project_epoch=stale"),
            StatusCode::CONFLICT,
        ),
        (
            format!("/api/v1/media/imports/{job_id}?project_epoch={epoch}&force=true"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(make("GET", &path, Value::Null))
                .await
                .unwrap()
                .status(),
            status
        );
    }
    let mut foreign = make(
        "DELETE",
        &format!("/api/v1/media/imports/{job_id}?project_epoch={epoch}"),
        Value::Null,
    );
    foreign
        .headers_mut()
        .insert(header::ORIGIN, "https://evil.example".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(foreign).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let command = mutation(
        &session,
        "commit-import-batch",
        json!({"kind":"import_prepared_media","job_id":job_id}),
    );
    let response = app
        .clone()
        .oneshot(make("POST", "/api/v1/projects/commands", command.clone()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let receipt: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    assert_eq!(receipt["media_ids"].as_array().unwrap().len(), 2);
    assert_eq!(receipt["errors"], ready["result"]["errors"]);
    let response = app
        .clone()
        .oneshot(make("POST", "/api/v1/projects/commands", command))
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&to_bytes(response.into_body(), 65536).await.unwrap())
            .unwrap(),
        receipt
    );
    let imported = host.call(Action::Session).await.unwrap();
    assert_eq!(
        imported["history"]["position"].as_u64().unwrap(),
        session["history"]["position"].as_u64().unwrap() + 1
    );
    let response = app
        .clone()
        .oneshot(make(
            "DELETE",
            &format!("/api/v1/media/imports/{job_id}?project_epoch={epoch}"),
            Value::Null,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<Value>(&to_bytes(response.into_body(), 65536).await.unwrap())
            .unwrap()["state"],
        "applied"
    );
    let legacy = mutation(
        &imported,
        "legacy-existing-import",
        json!({"kind":"import_media","path_token":"first.wav"}),
    );
    let response = app
        .clone()
        .oneshot(make("POST", "/api/v1/projects/commands", legacy))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let reused: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
    assert_eq!(reused["media_ids"], json!([receipt["media_ids"][1]]));
    assert_eq!(
        host.call(Action::Session).await.unwrap()["history"]["position"],
        imported["history"]["position"]
    );
    let legacy = mutation(
        &imported,
        "legacy-bad-import",
        json!({"kind":"import_media","path_token":"bad.wav"}),
    );
    let mut original = None;
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(make("POST", "/api/v1/projects/commands", legacy.clone()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let value: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
        assert_eq!(value["error"]["code"], "INVALID_OPERATION");
        if let Some(previous) = &original {
            assert_eq!(&value, previous);
        } else {
            original = Some(value);
        }
    }
    let response = app
        .clone()
        .oneshot(make(
            "GET",
            "/api/v1/commands/legacy-bad-import",
            Value::Null,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        serde_json::from_slice::<Value>(&to_bytes(response.into_body(), 65536).await.unwrap())
            .unwrap(),
        original.unwrap()
    );
    let files = |snapshot: &Value| {
        snapshot["media"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|media| media["compound_timeline_id"].is_null())
            .cloned()
            .collect::<Vec<_>>()
    };
    assert_eq!(
        files(&host.call(Action::Session).await.unwrap()),
        files(&imported)
    );
    let undo = mutation(&imported, "undo-import-batch", json!({"kind":"undo"}));
    assert_eq!(
        app.clone()
            .oneshot(make("POST", "/api/v1/projects/commands", undo))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let empty = host.call(Action::Session).await.unwrap();
    assert!(empty["media"].as_array().unwrap().iter().all(|media| {
        !receipt["media_ids"]
            .as_array()
            .unwrap()
            .contains(&media["id"])
    }));
    let redo = mutation(&empty, "redo-import-batch", json!({"kind":"redo"}));
    assert_eq!(
        app.clone()
            .oneshot(make("POST", "/api/v1/projects/commands", redo))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        files(&host.call(Action::Session).await.unwrap()),
        files(&imported)
    );
    drop(app);
    drop(host);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn saved_export_discard_http_checks_payload_epoch_cas_and_open_download_body() {
    let root = std::env::temp_dir().join(format!(
        "venturi-discard-http-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    let directory = std::fs::File::open(&root).unwrap();
    let store = crate::export_store::Store::open(&directory).unwrap();
    let mut stored = store
        .admit(crate::export_store::Record {
            version: 1,
            id: "1".into(),
            key: "export:old".into(),
            epoch: "old:7".into(),
            state: "queued".into(),
            previous_state: None,
            cancel_requested: false,
            error: None,
            program: json!({}),
            progress: None,
            bytes: 0,
            output: None,
            discard: None,
        })
        .unwrap();
    std::fs::write(
        stored.directory().join("rendering.mp4"),
        b"completed export",
    )
    .unwrap();
    let output = store.publish_output(&stored).unwrap();
    let mut ready = stored.record.clone();
    ready.state = "ready".into();
    ready.bytes = output.bytes;
    ready.output = Some(output);
    store.save(&mut stored, ready).unwrap();
    let revision = stored.revision().to_owned();
    drop(stored);
    drop(store);
    let app = router(AppState {
        preview: Preview::disabled(),
        codecs: crate::codecs::Codecs::new(Preview::disabled()),
        source: MediaJobs::start_with_exports(directory).unwrap(),
        silence: crate::silence::Jobs::start(),
        library: crate::library::Library::default(),
        host: Host::start(&root).unwrap(),
        recordings: crate::recording::Store::new(std::fs::File::open(&root).unwrap()),
        port: 8787,
    });
    let make = |method: &str, path: &str, body: Value| {
        Request::builder()
            .method(method)
            .uri(path)
            .header("host", "127.0.0.1:8787")
            .header("content-type", "application/json")
            .body(if body.is_null() {
                Body::empty()
            } else {
                Body::from(body.to_string())
            })
            .unwrap()
    };
    let payload = json!({"project_epoch":"old:7","revision":revision,"command_id":"ca27058c-768e-4d82-a11d-95b29b5a1d71"});
    for (field, value, expected) in [
        ("project_epoch", json!("new:1"), StatusCode::NOT_FOUND),
        ("revision", json!("0".repeat(64)), StatusCode::CONFLICT),
        (
            "command_id",
            json!("invalid"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let mut invalid = payload.clone();
        invalid[field] = value;
        let response = app
            .clone()
            .oneshot(make("POST", "/api/v1/exports/1/discard", invalid))
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
    }
    let response = app
        .clone()
        .oneshot(make(
            "GET",
            "/api/v1/exports/1/export.mp4?project_epoch=old:7",
            Value::Null,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body();
    let refusal = app
        .clone()
        .oneshot(make("POST", "/api/v1/exports/1/discard", payload.clone()))
        .await
        .unwrap();
    assert_eq!(refusal.status(), StatusCode::CONFLICT);
    let refusal: Value =
        serde_json::from_slice(&to_bytes(refusal.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(refusal["error"]["code"], "EXPORT_DOWNLOAD_ACTIVE");
    drop(body);
    let response = app
        .clone()
        .oneshot(make("POST", "/api/v1/exports/1/discard", payload.clone()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let ack: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(
        ack,
        json!({"id":"1","status":"discarded","project_epoch":"old:7"})
    );
    let repeated = app
        .clone()
        .oneshot(make("POST", "/api/v1/exports/1/discard", payload))
        .await
        .unwrap();
    assert_eq!(repeated.status(), StatusCode::NOT_FOUND);
    let history = app
        .clone()
        .oneshot(make("GET", "/api/v1/exports", Value::Null))
        .await
        .unwrap();
    let history: Value =
        serde_json::from_slice(&to_bytes(history.into_body(), 4096).await.unwrap()).unwrap();
    assert!(history["jobs"].as_array().unwrap().is_empty());
    assert_eq!(history["capacity"]["charged_bytes"], 0);
    assert!(!root.join(".exports/1").exists());
    assert!(!root.join(".exports/1.json").exists());
    drop(app);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn http_command_roundtrip_and_malformed_requests() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-http-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let app = router(AppState {
        preview: Preview::disabled(),
        codecs: crate::codecs::Codecs::new(Preview::disabled()),
        source: MediaJobs::start().unwrap(),
        silence: crate::silence::Jobs::start(),
        library: crate::library::Library::default(),
        host: Host::start(&root).unwrap(),
        recordings: crate::recording::Store::new(std::fs::File::open(&root).unwrap()),
        port: 8787,
    });
    let get = || {
        Request::builder()
            .uri("/api/v1/session")
            .header("host", "127.0.0.1:8787")
            .body(Body::empty())
            .unwrap()
    };
    let response = app.clone().oneshot(get()).await.unwrap();
    let snapshot: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
            .unwrap();
    let body = json!({"command_id":"http-new","client_id":"http-client","project_epoch":snapshot["project_epoch"],"if_generation":snapshot["generation"],"if_revision":null,"operation":{"kind":"new_project","name":"http_test"}});
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/projects/commands")
                    .header("host", "127.0.0.1:8787")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
    assert!(root.join("http_test.vvproj").is_file());
    let response = app.clone().oneshot(get()).await.unwrap();
    let snapshot: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
            .unwrap();
    let timeline = &snapshot["timelines"][0];
    let id = timeline["id"].as_str().unwrap();
    let edit = json!({"command_id":"http-solid","client_id":"http-client","project_epoch":snapshot["project_epoch"],"if_generation":snapshot["generation"],"if_revision":timeline["revision"],"operation":{"kind":"add_solid","track":"0","start_frame":0,"length_frames":24}});
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/timelines/{id}/commands"))
                .header("host", "127.0.0.1:8787")
                .header("content-type", "application/json")
                .body(Body::from(edit.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = app.clone().oneshot(get()).await.unwrap();
    let latest: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
            .unwrap();
    let navigation_query = json!({"project_epoch":latest["project_epoch"],"if_generation":latest["generation"],"timeline_id":id,"revision":latest["timelines"][0]["revision"],"frame":10000,"width":320});
    for (path, action, expected) in [
        (
            format!("/api/v1/timelines/{id}/compound-navigation"),
            json!({"kind":"enter","clip_ids":["9007199254740993"]}),
            StatusCode::NOT_FOUND,
        ),
        (
            "/api/v1/timelines/other/compound-navigation".into(),
            json!({"kind":"enter","clip_ids":["1"]}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            format!("/api/v1/timelines/{id}/compound-navigation"),
            json!({"kind":"enter","clip_ids":["1"],"unexpected":true}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .header("host", "127.0.0.1:8787")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({"query":navigation_query,"action":action}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
    }
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/timelines/{id}/compound-navigation"))
                .header("host", "127.0.0.1:8787")
                .header("origin", "https://evil.example")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"query":navigation_query,"action":{"kind":"enter","clip_ids":["1"]}})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    for (state, status) in [(&latest, StatusCode::OK), (&snapshot, StatusCode::CONFLICT)] {
        let query = format!(
            "project_epoch={}&if_generation={}&timeline_id={id}&revision={}&frame=0&width=960",
            state["project_epoch"].as_str().unwrap(),
            state["generation"].as_str().unwrap(),
            state["timelines"][0]["revision"].as_str().unwrap()
        );
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/timelines/{id}/timeline.otio?{query}"))
                    .header("host", "127.0.0.1:8787")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), status);
        if status == StatusCode::OK {
            assert_eq!(
                response.headers()[header::CONTENT_DISPOSITION],
                "attachment; filename=\"timeline.otio\""
            );
            let otio: Value =
                serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
                    .unwrap();
            assert_eq!(otio["OTIO_SCHEMA"], "Timeline.1");
        }
    }
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects/commands")
                .header("host", "127.0.0.1:8787")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let error: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1024).await.unwrap()).unwrap();
    assert_eq!(error["error"]["code"], "INVALID_OPERATION");
    let capture = vec![0_u8; 65540];
    let recording_query = format!(
        "project_epoch={}&client_id=http-client&sample_rate=48000&channels=1&format=wav",
        latest["project_epoch"].as_str().unwrap()
    );
    let recording_id = "01234567-89ab-4def-8123-456789abcdef";
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/api/v1/recordings/{recording_id}?{recording_query}"
                    ))
                    .header("host", "127.0.0.1:8787")
                    .header("content-type", "application/octet-stream")
                    .body(Body::from(capture.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let receipt: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 16384).await.unwrap()).unwrap();
        assert_eq!(receipt["frames"], 16385);
    }
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/recordings/{recording_id}/audio"))
                .header("host", "127.0.0.1:8787")
                .header("range", "bytes=0-3")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "audio/wav");
    assert_eq!(
        &to_bytes(response.into_body(), 4).await.unwrap()[..],
        b"RIFF"
    );
    for (state, expected) in [
        (&latest, StatusCode::UNPROCESSABLE_ENTITY),
        (&snapshot, StatusCode::CONFLICT),
    ] {
        let speech = json!({"query":{"project_epoch":state["project_epoch"],"if_generation":state["generation"],"timeline_id":id,"revision":state["timelines"][0]["revision"],"frame":0,"width":640},"clip_ids":[latest["timelines"][0]["tracks"][0]["clips"][0]["id"]],"params":{"threshold":0.5,"min_silence_secs":0.3,"head_secs":0.1,"tail_secs":0.1}});
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/analysis/silence")
                    .header("host", "127.0.0.1:8787")
                    .header("content-type", "application/json")
                    .body(Body::from(speech.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn health_assets_snapshot_and_host_boundary() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-api-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let app = router(AppState {
        preview: Preview::disabled(),
        codecs: crate::codecs::Codecs::new(Preview::disabled()),
        source: MediaJobs::start().unwrap(),
        silence: crate::silence::Jobs::start(),
        library: crate::library::Library::default(),
        host: Host::start(&root).unwrap(),
        recordings: crate::recording::Store::new(std::fs::File::open(&root).unwrap()),
        port: 8787,
    });
    for (path, status) in [
        ("/api/v1/health", 200),
        ("/api/v1/presets/shortcuts", 200),
        ("/", 200),
        ("/js/timeline/input.js", 200),
        ("/js/timeline/preset-drop.js", 200),
        ("/js/timeline/asset-drop.js", 200),
        ("/js/curve-viewport.js", 200),
        ("/js/curve-window.js", 200),
        ("/js/compound-navigation.js", 200),
        ("/js/export.js", 200),
        ("/js/scopes.js", 200),
        ("/js/viewer-zoom.js", 200),
        ("/js/keyframe-lanes.js", 200),
        ("/js/balance.js", 200),
        ("/js/silence.js", 200),
        ("/js/library.js", 200),
        ("/js/native-assets.js", 200),
        ("/js/native-asset-folders.js", 200),
        ("/js/media-import.js", 200),
        ("/js/mark-range.js", 200),
        ("/api/v1/library", 200),
        ("/js/slip.js", 200),
        ("/js/catalog.js", 200),
        ("/api/v1/timelines/1/clips/1/slip/0", 422),
        ("/api/v1/timelines/1/clips/1/keys/0", 422),
        ("/api/v1/timelines/1/clips/1/keys/bad", 400),
        (
            "/api/v1/timelines/1/clips/1/keys/0?project_epoch=p&if_generation=0&timeline_id=other&revision=r&frame=0",
            422,
        ),
        (
            "/api/v1/timelines/1/clips/1/slip/bad?project_epoch=p&if_generation=0&timeline_id=1&revision=r&frame=0",
            422,
        ),
        ("/api/v1/preview/balance/0", 422),
        ("/api/v1/preview/scopes/0/Invalid/Parade", 400),
        ("/api/v1/preview/scopes/0/Waveform/Parade", 422),
        ("/api/v1/exports/missing?project_epoch=p:1", 404),
        ("/api/v1/exports/missing", 422),
        ("/api/v1/exports/missing/export.mp4?project_epoch=p:1", 404),
        ("/api/v1/session", 200),
        ("/api/v1/timelines/nope", 404),
        ("/../../Cargo.toml", 404),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(path)
                    .header("host", "127.0.0.1:8787")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), status, "{path}");
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        assert!(!bytes.is_empty());
        if path == "/api/v1/presets/shortcuts" {
            let catalog: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(catalog["version"], 1);
            assert_eq!(catalog["modifiers"], json!(["Ctrl", "Shift", "Alt"]));
            assert!(catalog["keys"].as_array().unwrap().contains(&json!("Plus")));
            assert!(catalog["keys"].as_array().unwrap().contains(&json!("F35")));
        }
    }
    for (host, origin) in [
        ("evil.example:8787", "http://evil.example:8787"),
        ("127.0.0.1:8787", "https://evil.example"),
    ] {
        for path in ["/api/v1/session", "/api/v1/presets/shortcuts"] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(path)
                        .header("host", host)
                        .header("origin", origin)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
        }
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn source_prepare_audio_stream_is_an_optional_strict_unsigned_native_index() {
    let legacy: PrepareSource = serde_json::from_value(json!({"project_epoch":"p:1"})).unwrap();
    assert_eq!(legacy.audio_stream_index, 0);
    assert_eq!(legacy.audio_mode, crate::source_audio::AudioMode::Selected);
    let all: PrepareSource =
        serde_json::from_value(json!({"project_epoch":"p:1","audio_mode":"all"})).unwrap();
    assert_eq!(all.audio_mode, crate::source_audio::AudioMode::All);
    assert_eq!(all.audio_stream_index, 0);
    for mode in [json!(null), json!("ALL"), json!("mix"), json!(0)] {
        assert!(
            serde_json::from_value::<PrepareSource>(
                json!({"project_epoch":"p:1","audio_mode":mode})
            )
            .is_err()
        );
    }
    let assets: PrepareAssets = serde_json::from_value(json!({"project_epoch":"p:1"})).unwrap();
    assert_eq!(assets.audio_stream_index, 0);
    assert!(assets.include_waveform);
    let assets: PrepareAssets = serde_json::from_value(
        json!({"project_epoch":"p:1","audio_stream_index":2,"include_waveform":false}),
    )
    .unwrap();
    assert_eq!(assets.audio_stream_index, 2);
    assert!(!assets.include_waveform);
    let selected: PrepareSource = serde_json::from_value(json!({"project_epoch":"p:1","audio_stream_index":1,"window":{"start_frame":12,"end_frame":24}})).unwrap();
    assert_eq!(selected.audio_stream_index, 1);
    for value in [
        json!(-1),
        json!(0.5),
        json!("1"),
        json!(null),
        json!(4_294_967_296u64),
    ] {
        assert!(
            serde_json::from_value::<PrepareAssets>(
                json!({"project_epoch":"p:1","audio_stream_index":value.clone()})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<PrepareSource>(
                json!({"project_epoch":"p:1","audio_stream_index":value})
            )
            .is_err()
        );
    }
    for body in [
        json!({"project_epoch":"p:1","include_waveform":null}),
        json!({"project_epoch":"p:1","include_waveform":0}),
        json!({"project_epoch":"p:1","window":null}),
    ] {
        assert!(serde_json::from_value::<PrepareAssets>(body).is_err());
    }
    assert!(
        serde_json::from_value::<PrepareSource>(
            json!({"project_epoch":"p:1","audio_stream_index":0,"fallback":true})
        )
        .is_err()
    );
}

#[test]
fn native_asset_requests_and_mutations_are_strict_and_keep_legacy_mutation_bytes() {
    let capture = json!({"project_epoch":"p:1","if_generation":"0","action":{"kind":"capture","media_id":"9007199254740993","name":"Native take"}});
    assert!(serde_json::from_value::<crate::host::NativeAssetRequest>(capture.clone()).is_ok());
    for patch in [
        json!({"kind":"capture","media_id":9007199254740993u64,"name":"Take"}),
        json!({"kind":"capture","media_id":"1","name":"Take","path":"/etc/passwd"}),
        json!({"kind":"import","asset_id":"asset","revision":"r","payload":"forged"}),
        json!({"kind":"publish","job_id":"job"}),
    ] {
        let mut invalid = capture.clone();
        invalid["action"] = patch;
        assert!(serde_json::from_value::<crate::host::NativeAssetRequest>(invalid).is_err());
    }
    let base = json!({"command_id":"command","client_id":"browser","command_epoch":null,"project_epoch":"p:1","if_generation":"0","if_revision":null,"operation":{"kind":"import_media","path_token":"take.wav"}});
    let legacy: Mutation = serde_json::from_value(base.clone()).unwrap();
    assert_eq!(serde_json::to_value(legacy).unwrap(), base);
    for operation in [
        json!({"kind":"publish_native_asset","job_id":"job"}),
        json!({"kind":"import_native_asset","job_id":"job","asset_id":"asset","revision":"r"}),
        json!({"kind":"edit_native_asset_library","edit":{"action":"update","id":"asset","revision":"r","name":"Renamed"}}),
    ] {
        let mut body = base.clone();
        body["operation"] = operation;
        assert_eq!(
            serde_json::to_value(serde_json::from_value::<Mutation>(body.clone()).unwrap())
                .unwrap(),
            body
        );
        body["operation"]["force"] = json!(true);
        assert!(serde_json::from_value::<Mutation>(body).is_err());
    }
}

#[tokio::test]
async fn native_asset_http_library_readers_import_routes_security_and_download_contract() {
    use vv_core::{Clip, ClipId, ClipSource, Rational, Timeline, Track, TrackKind};
    let root = std::env::temp_dir().join(format!(
        "vv-native-assets-http-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let host = Host::start(&root).unwrap();
    let session = host.call(Action::Session).await.unwrap();
    let new=serde_json::from_value::<Mutation>(json!({"command_id":"native-http-project","client_id":"native-browser","project_epoch":session["project_epoch"],"if_generation":session["generation"],"if_revision":null,"operation":{"kind":"new_project","name":"destination"}})).unwrap();
    host.call(Action::Mutation(None, new)).await.unwrap();
    let session = host.call(Action::Session).await.unwrap();
    let epoch = session["project_epoch"].as_str().unwrap();
    let mut source = vv_session::Session::default();
    let mut track = Track::new(TrackKind::Video);
    track.clips.push(Clip::from_source_range(
        ClipId(9007199254740993),
        ClipSource::SolidColor,
        0,
        24,
        0,
        Rational::one(),
    ));
    let child = source.create_timeline(Timeline {
        name: "Generator compound".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![track],
        markers: vec![],
        master: Default::default(),
    });
    let media = source
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(child))
        .unwrap()
        .0;
    let asset = crate::asset_payload::capture(
        &source,
        media,
        "Native compound",
        vv_core::clipboard::ClipboardOrigin {
            instance: 1,
            epoch: source.epoch(),
        },
    )
    .unwrap();
    let store = crate::asset_store::Store::new(&root.join(".assets")).unwrap();
    store.create("native-source", &asset).unwrap();
    let revision = store.item("native-source", false).unwrap()["revision"]
        .as_str()
        .unwrap()
        .to_owned();
    let app = router(AppState {
        host: host.clone(),
        port: 8787,
        preview: Preview::disabled(),
        codecs: crate::codecs::Codecs::new(Preview::disabled()),
        source: MediaJobs::start().unwrap(),
        silence: crate::silence::Jobs::start(),
        library: crate::library::Library::default(),
        recordings: crate::recording::Store::new(std::fs::File::open(&root).unwrap()),
    });
    let make = |method: &str, path: &str, body: Value| {
        Request::builder()
            .method(method)
            .uri(path)
            .header("host", "127.0.0.1:8787")
            .header("content-type", "application/json")
            .body(if body.is_null() {
                Body::empty()
            } else {
                Body::from(body.to_string())
            })
            .unwrap()
    };
    let response = app
        .clone()
        .oneshot(make(
            "GET",
            &format!("/api/v1/native-assets/folders?project_epoch={epoch}"),
            Value::Null,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let folders: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 32768).await.unwrap()).unwrap();
    assert_eq!(
        folders,
        json!({"project_epoch":epoch,"version":1,"folders_revision":"absent","folders":[]})
    );
    for (path, status) in [
        (
            "/api/v1/native-assets/folders".into(),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            "/api/v1/native-assets/folders?project_epoch=stale".into(),
            StatusCode::CONFLICT,
        ),
        (
            format!("/api/v1/native-assets/folders?project_epoch={epoch}&force=true"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(make("GET", &path, Value::Null))
                .await
                .unwrap()
                .status(),
            status
        );
    }
    let folder_command = |id: &str| json!({"command_id":id,"client_id":"native-browser","command_epoch":session["command_epoch"],"project_epoch":epoch,"if_generation":session["generation"],"if_revision":null,"operation":{"kind":"edit_native_asset_library","edit":{"action":"create_folder","folders_revision":"absent","name":"Takes","parent":null}}});
    let response = app
        .clone()
        .oneshot(make(
            "POST",
            "/api/v1/native-assets/commands/prepare",
            folder_command("pending-http-folder"),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let preparation: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 32768).await.unwrap()).unwrap();
    assert!(preparation["id"].is_string());
    assert!(!root.join(".assets/folders.json").exists());
    let unchanged = host.call(Action::Session).await.unwrap();
    for key in ["project_epoch", "generation", "history", "unsaved"] {
        assert_eq!(unchanged[key], session[key]);
    }
    let response = app
        .clone()
        .oneshot(make(
            "GET",
            "/api/v1/commands/pending-http-folder",
            Value::Null,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let pending: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 32768).await.unwrap()).unwrap();
    assert_eq!(pending["error"]["code"], "OUTCOME_UNKNOWN");
    assert!(matches!(
        pending["error"]["details"]["status"].as_str(),
        Some("preparing" | "pending")
    ));
    if pending["error"]["details"]["status"] == "pending" {
        assert_eq!(pending["error"]["details"]["recovery_pending"], true);
    }
    assert!(pending["error"]["details"]["job_id"].is_string());
    let response = app
        .clone()
        .oneshot(make(
            "DELETE",
            &format!(
                "/api/v1/native-assets/jobs/{}?project_epoch={epoch}",
                preparation["id"].as_str().unwrap()
            ),
            Value::Null,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(!root.join(".assets/folders.json").exists());
    let mut unprepared = folder_command("refuse-direct-prepare");
    unprepared["operation"] = json!({"kind":"edit_native_asset_library","edit":{"action":"update","id":"native-source","revision":revision,"name":"Must not rename during preparation"}});
    let response = app
        .clone()
        .oneshot(make(
            "POST",
            "/api/v1/native-assets/commands/prepare",
            unprepared,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        store.item("native-source", false).unwrap()["name"],
        "Native compound"
    );
    let command = folder_command("create-http-folder");
    let response = app
        .clone()
        .oneshot(make(
            "POST",
            "/api/v1/native-assets/commands/prepare",
            command.clone(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let queued: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 32768).await.unwrap()).unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let status = host
            .call(Action::NativeAssetStatus(
                queued["id"].as_str().unwrap().into(),
                SourceQuery {
                    project_epoch: epoch.into(),
                },
                false,
            ))
            .await
            .unwrap();
        if status["state"] == "ready" {
            break;
        }
        assert!(
            matches!(status["state"].as_str(), Some("queued" | "running")),
            "{status}"
        );
        assert!(std::time::Instant::now() < deadline);
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    assert!(!root.join(".assets/folders.json").exists());
    let response = app
        .clone()
        .oneshot(make(
            "POST",
            "/api/v1/native-assets/commands",
            command.clone(),
        ))
        .await
        .unwrap();
    let status = response.status();
    let receipt: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 32768).await.unwrap()).unwrap();
    assert_eq!(status, StatusCode::OK, "{receipt}");
    assert_eq!(receipt["status"], "applied");
    assert_eq!(receipt["library_durable"], true);
    assert_eq!(receipt["generation"], session["generation"]);
    assert_eq!(receipt["durability"]["state"], "volatile");
    let response = app
        .clone()
        .oneshot(make(
            "POST",
            "/api/v1/native-assets/commands/prepare",
            command.clone(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let completed: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 32768).await.unwrap()).unwrap();
    assert_eq!(completed, json!({"state":"applied","receipt":receipt}));
    let response = app
        .clone()
        .oneshot(make("POST", "/api/v1/native-assets/commands", command))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<Value>(&to_bytes(response.into_body(), 32768).await.unwrap())
            .unwrap(),
        receipt
    );
    let current = host.call(Action::Session).await.unwrap();
    assert_eq!(current["generation"], session["generation"]);
    let graph = store.folders().unwrap();
    assert_eq!(graph["folders"].as_array().unwrap().len(), 1);
    assert_eq!(graph["folders"][0]["name"], "Takes");
    let folder_bytes = std::fs::read(root.join(".assets/folders.json")).unwrap();
    let project_bytes = std::fs::read(root.join("destination.vvproj")).unwrap();
    let asset_bytes = store.export("native-source").unwrap();
    let receipt_bytes = std::fs::read(root.join(".venturi-command-receipts.jsonl")).unwrap();
    for (id, edit, status, code) in [
        (
            "cycle-http-folder",
            json!({"action":"move_folder","id":graph["folders"][0]["id"],"parent":graph["folders"][0]["id"],"folders_revision":graph["folders_revision"]}),
            StatusCode::UNPROCESSABLE_ENTITY,
            "INVALID_OPERATION",
        ),
        (
            "missing-http-folder",
            json!({"action":"rename_folder","id":"does-not-exist","name":"Missing","folders_revision":graph["folders_revision"]}),
            StatusCode::NOT_FOUND,
            "NOT_FOUND",
        ),
        (
            "stale-http-folder",
            json!({"action":"rename_folder","id":graph["folders"][0]["id"],"name":"Stale","folders_revision":"absent"}),
            StatusCode::CONFLICT,
            "FOLDERS_CHANGED",
        ),
    ] {
        let mut command = folder_command(id);
        command["operation"]["edit"] = edit;
        let response = app
            .clone()
            .oneshot(make(
                "POST",
                "/api/v1/native-assets/commands",
                command.clone(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{id}");
        let failure: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 32768).await.unwrap()).unwrap();
        assert_eq!(failure["error"]["code"], code);
        if id == "cycle-http-folder" {
            assert!(
                failure["error"]["message"]
                    .as_str()
                    .unwrap()
                    .contains("cycle")
            );
        }
        let lookup = app
            .clone()
            .oneshot(make("GET", &format!("/api/v1/commands/{id}"), Value::Null))
            .await
            .unwrap();
        assert_eq!(lookup.status(), status);
        assert_eq!(
            serde_json::from_slice::<Value>(&to_bytes(lookup.into_body(), 32768).await.unwrap())
                .unwrap(),
            failure
        );
        let retry = app
            .clone()
            .oneshot(make("POST", "/api/v1/native-assets/commands", command))
            .await
            .unwrap();
        assert_eq!(retry.status(), status);
        assert_eq!(
            serde_json::from_slice::<Value>(&to_bytes(retry.into_body(), 32768).await.unwrap())
                .unwrap(),
            failure
        );
        assert_eq!(
            std::fs::read(root.join(".assets/folders.json")).unwrap(),
            folder_bytes
        );
        assert_eq!(
            std::fs::read(root.join("destination.vvproj")).unwrap(),
            project_bytes
        );
        assert_eq!(store.export("native-source").unwrap(), asset_bytes);
        assert_eq!(
            std::fs::read(root.join(".venturi-command-receipts.jsonl")).unwrap(),
            receipt_bytes
        );
        let unchanged = host.call(Action::Session).await.unwrap();
        for key in [
            "project_epoch",
            "generation",
            "history",
            "timelines",
            "media",
        ] {
            assert_eq!(unchanged[key], current[key], "{id}: {key}");
        }
    }
    for path in [
        format!("/api/v1/native-assets/pages/0?project_epoch={epoch}"),
        format!("/api/v1/native-assets/items/native-source?project_epoch={epoch}"),
    ] {
        let response = app
            .clone()
            .oneshot(make("GET", &path, Value::Null))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let value: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 16384).await.unwrap()).unwrap();
        let item = if path.contains("pages") {
            &value["items"][0]
        } else {
            &value
        };
        assert_eq!(item["id"], "native-source");
        assert_eq!(item["revision"], revision);
        assert!(item.get("payload").is_none());
    }
    let response = app
        .clone()
        .oneshot(make(
            "GET",
            &format!("/api/v1/native-assets/items/native-source/download?project_epoch={epoch}"),
            Value::Null,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(
        response.headers()[header::CONTENT_DISPOSITION],
        "attachment; filename=\"native-source.json\""
    );
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    assert_eq!(&bytes[..], store.export("native-source").unwrap());
    assert!(crate::asset_payload::parse(&bytes).is_ok());
    for (path, status) in [
        (
            format!("/api/v1/native-assets/jobs/forged?project_epoch={epoch}"),
            StatusCode::NOT_FOUND,
        ),
        (
            "/api/v1/native-assets/pages/0?project_epoch=stale".into(),
            StatusCode::CONFLICT,
        ),
        (
            format!("/api/v1/native-assets/pages/0?project_epoch={epoch}&archived=invalid"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            format!("/api/v1/native-assets/items/..%2Fsecret/download?project_epoch={epoch}"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(make("GET", &path, Value::Null))
                .await
                .unwrap()
                .status(),
            status
        );
    }
    for path in [
        format!("/api/v1/native-assets/pages/0?project_epoch={epoch}"),
        format!("/api/v1/native-assets/folders?project_epoch={epoch}"),
        "/api/v1/native-assets/prepare".into(),
    ] {
        let mut request = make(
            if path.contains("prepare") {
                "POST"
            } else {
                "GET"
            },
            &path,
            json!({}),
        );
        request
            .headers_mut()
            .insert(header::ORIGIN, "https://evil.example".parse().unwrap());
        assert_eq!(
            app.clone().oneshot(request).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }
    let prepare = json!({"project_epoch":epoch,"if_generation":session["generation"],"action":{"kind":"import","asset_id":"native-source","revision":revision}});
    let response = app
        .clone()
        .oneshot(make("POST", "/api/v1/native-assets/prepare", prepare))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let job: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 16384).await.unwrap()).unwrap();
    let id = job["id"].as_str().unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        let response = app
            .clone()
            .oneshot(make(
                "GET",
                &format!("/api/v1/native-assets/jobs/{id}?project_epoch={epoch}"),
                Value::Null,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let value: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 16384).await.unwrap()).unwrap();
        if value["state"] == "ready" {
            break;
        }
        assert_ne!(value["state"], "failed", "{value}");
        assert!(std::time::Instant::now() < deadline);
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    let mutation = |command: &str, operation: Value| json!({"command_id":command,"client_id":"native-browser","project_epoch":epoch,"if_generation":session["generation"],"if_revision":null,"operation":operation});
    for (path, operation) in [
        (
            "/api/v1/native-assets/commands",
            json!({"kind":"import_native_asset","job_id":id,"asset_id":"native-source","revision":revision}),
        ),
        ("/api/v1/native-assets/commands", json!({"kind":"undo"})),
        (
            "/api/v1/projects/commands",
            json!({"kind":"publish_native_asset","job_id":id}),
        ),
        (
            "/api/v1/projects/commands",
            json!({"kind":"edit_native_asset_library","edit":{"action":"archive","id":"native-source","revision":revision}}),
        ),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(make("POST", path, mutation("wrong-route", operation)))
                .await
                .unwrap()
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let import = mutation(
        "native-http-import",
        json!({"kind":"import_native_asset","job_id":id,"asset_id":"native-source","revision":revision}),
    );
    let mut acknowledged = None;
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(make("POST", "/api/v1/projects/commands", import.clone()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let receipt: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 16384).await.unwrap()).unwrap();
        assert_eq!(receipt["media_ids"].as_array().unwrap().len(), 1);
        if let Some(previous) = &acknowledged {
            assert_eq!(&receipt, previous);
        } else {
            acknowledged = Some(receipt);
        }
    }
    let latest = host.call(Action::Session).await.unwrap();
    assert_eq!(
        latest["history"]["position"].as_u64().unwrap(),
        session["history"]["position"].as_u64().unwrap() + 1
    );
    assert_eq!(
        latest["timelines"].as_array().unwrap().len(),
        session["timelines"].as_array().unwrap().len() + 1
    );
    assert!(
        latest["media"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == acknowledged.as_ref().unwrap()["media_ids"][0])
    );
    let save = json!({"command_id":"native-http-save","client_id":"native-browser","project_epoch":epoch,"if_generation":latest["generation"],"if_revision":null,"operation":{"kind":"save"}});
    assert_eq!(
        app.clone()
            .oneshot(make("POST", "/api/v1/projects/commands", save))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let switch = json!({"command_id":"native-http-switch","client_id":"native-browser","project_epoch":epoch,"if_generation":latest["generation"],"if_revision":null,"operation":{"kind":"new_project","name":"other"}});
    assert_eq!(
        app.clone()
            .oneshot(make("POST", "/api/v1/projects/commands", switch))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let after_switch = host.call(Action::Session).await.unwrap();
    assert_ne!(after_switch["project_epoch"], epoch);
    assert_eq!(
        app.clone()
            .oneshot(make(
                "GET",
                &format!("/api/v1/native-assets/jobs/{id}?project_epoch={epoch}"),
                Value::Null
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    for (job_id, project_epoch) in [
        (id, "wrong-project"),
        ("foreign-job", epoch),
        (id, after_switch["project_epoch"].as_str().unwrap()),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(make(
                    "DELETE",
                    &format!("/api/v1/native-assets/jobs/{job_id}?project_epoch={project_epoch}"),
                    Value::Null
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
    }
    let response = app
        .clone()
        .oneshot(make(
            "DELETE",
            &format!("/api/v1/native-assets/jobs/{id}?project_epoch={epoch}"),
            Value::Null,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let canceled: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 16384).await.unwrap()).unwrap();
    assert_eq!(canceled["state"], "canceled");
    assert_eq!(canceled["project_epoch"], epoch);
    assert!(canceled["result"].is_null());
    let after_cancel = host.call(Action::Session).await.unwrap();
    for field in [
        "project_epoch",
        "generation",
        "history",
        "media",
        "timelines",
    ] {
        assert_eq!(after_cancel[field], after_switch[field]);
    }
    assert!(source.project.media_pool.contains_key(media));
    drop(app);
    drop(host);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_folder_edits_reuse_library_operation_and_require_strict_folder_and_asset_revisions()
{
    let base = json!({"command_id":"folder-command","client_id":"browser","command_epoch":null,"project_epoch":"p:1","if_generation":"0","if_revision":null,"operation":{"kind":"edit_native_asset_library","edit":{"action":"update","id":"asset","revision":"asset-r1","name":"Legacy update"}}});
    assert_eq!(
        serde_json::to_value(serde_json::from_value::<Mutation>(base.clone()).unwrap()).unwrap(),
        base
    );
    for edit in [
        json!({"action":"create_folder","folders_revision":"absent","name":"Folder","parent":null}),
        json!({"action":"rename_folder","id":"folder","folders_revision":"folders-r1","name":"Renamed"}),
        json!({"action":"move_folder","id":"folder","folders_revision":"folders-r1","parent":"parent"}),
        json!({"action":"remove_folder","id":"folder","folders_revision":"folders-r1"}),
        json!({"action":"move_assets","folders_revision":"folders-r1","items":[{"id":"asset","revision":"asset-r1"}],"folder":null}),
    ] {
        let mut body = base.clone();
        body["operation"]["edit"] = edit;
        assert_eq!(
            serde_json::to_value(serde_json::from_value::<Mutation>(body.clone()).unwrap())
                .unwrap(),
            body
        );
        let mut missing = body.clone();
        missing["operation"]["edit"]
            .as_object_mut()
            .unwrap()
            .remove("folders_revision");
        assert!(serde_json::from_value::<Mutation>(missing).is_err());
        body["operation"]["edit"]["force"] = json!(true);
        assert!(serde_json::from_value::<Mutation>(body).is_err());
    }
    let mut missing_asset_revision = base;
    missing_asset_revision["operation"]["edit"] = json!({"action":"move_assets","folders_revision":"folders-r1","items":[{"id":"asset"}],"folder":null});
    assert!(serde_json::from_value::<Mutation>(missing_asset_revision).is_err());
    let all: crate::asset_store::Query =
        serde_json::from_value(json!({"project_epoch":"p:1"})).unwrap();
    assert!(all.folder.is_none());
    assert!(all.folders_revision.is_none());
    let root: crate::asset_store::Query = serde_json::from_value(
        json!({"project_epoch":"p:1","folder":"","folders_revision":"absent"}),
    )
    .unwrap();
    assert_eq!(root.folder.as_deref(), Some(""));
    assert_eq!(root.folders_revision.as_deref(), Some("absent"));
}

#[tokio::test]
async fn embedded_editor_module_imports_are_served_with_javascript_mime() {
    use std::collections::{HashSet, VecDeque};
    let editor = assets(Request::builder().uri("/").body(Body::empty()).unwrap()).await;
    assert_eq!(editor.status(), StatusCode::OK);
    let html = to_bytes(editor.into_body(), 512 * 1024).await.unwrap();
    let html = std::str::from_utf8(&html).unwrap();
    let stylesheets: Vec<_> = html
        .split("<link")
        .skip(1)
        .filter_map(|tag| {
            let attributes = tag.split('>').next()?;
            if !attributes.contains("rel=\"stylesheet\"") {
                return None;
            }
            attributes.split_once("href=\"")?.1.split('"').next()
        })
        .collect();
    for expected in [
        "/style/native-shell.css",
        "/style/native-browser.css",
        "/style/native-inspector.css",
    ] {
        assert!(
            stylesheets.contains(&expected),
            "Missing native editor stylesheet: {expected}"
        );
    }
    for path in stylesheets {
        assert!(
            path.starts_with("/style/") && path.ends_with(".css"),
            "Unexpected stylesheet path: {path}"
        );
        let response = assets(Request::builder().uri(path).body(Body::empty()).unwrap()).await;
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "Missing embedded stylesheet: {path}"
        );
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "text/css",
            "Wrong stylesheet MIME: {path}"
        );
        let body = to_bytes(response.into_body(), 256 * 1024).await.unwrap();
        assert!(!body.is_empty(), "Empty embedded stylesheet: {path}");
    }
    let mut queue = VecDeque::from(["/js/main.js".to_owned()]);
    let mut seen = HashSet::new();
    while let Some(path) = queue.pop_front() {
        if !seen.insert(path.clone()) {
            continue;
        }
        let response = assets(Request::builder().uri(&path).body(Body::empty()).unwrap()).await;
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "Missing embedded module: {path}"
        );
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "text/javascript",
            "Wrong module MIME: {path}"
        );
        let body = to_bytes(response.into_body(), 512 * 1024).await.unwrap();
        let text = std::str::from_utf8(&body).unwrap();
        for line in text
            .lines()
            .filter(|line| line.trim_start().starts_with("import ") || line.contains(" from "))
        {
            for dependency in line.split(['\'', '\"']).filter(|value| {
                value.starts_with('.')
                    && value.ends_with(".js")
                    && !value.chars().any(char::is_whitespace)
            }) {
                let mut parts: Vec<_> = path
                    .rsplit_once('/')
                    .unwrap()
                    .0
                    .split('/')
                    .filter(|part| !part.is_empty())
                    .collect();
                for part in dependency.split('/') {
                    match part {
                        "." => {}
                        ".." => {
                            assert!(parts.pop().is_some(), "Module escapes root");
                        }
                        _ => parts.push(part),
                    }
                }
                queue.push_back(format!("/{}", parts.join("/")));
            }
        }
    }
    assert!(seen.contains("/js/project-view.js"));
    assert!(seen.contains("/js/timeline/input.js"));
}

#[test]
fn prepared_audio_telemetry_query_is_strict_bounded_and_retains_origin() {
    let body = json!({"project_epoch":"p:1","if_generation":"7","timeline_id":"1","revision":"r","start_frame":120,"end_frame":240,"width":960,"audio_origin_frame":0});
    let parsed: ProgramMetersQuery = serde_json::from_value(body.clone()).unwrap();
    let (query, from, limit, insert) = parsed.parts().unwrap();
    assert_eq!(query.audio_origin_frame, Some(0));
    assert_eq!((from, limit), (0, 64));
    assert!(insert.is_none());
    let mut with_insert = body.clone();
    with_insert["insert_channel"] = json!("master");
    with_insert["insert_index"] = json!(2);
    let (_, _, _, insert) = serde_json::from_value::<ProgramMetersQuery>(with_insert.clone())
        .unwrap()
        .parts()
        .unwrap();
    assert_eq!(insert.unwrap().index, 2);
    for patch in [
        json!({"limit":0}),
        json!({"limit":65}),
        json!({"insert_channel":"master"}),
        json!({"insert_index":0}),
        json!({"insert_channel":"01","insert_index":0}),
        json!({"insert_channel":"128","insert_index":0}),
        json!({"insert_channel":"0","insert_index":32}),
    ] {
        let mut invalid = body.clone();
        for (key, value) in patch.as_object().unwrap() {
            invalid[key] = value.clone();
        }
        assert!(
            serde_json::from_value::<ProgramMetersQuery>(invalid)
                .unwrap()
                .parts()
                .is_err()
        );
    }
    for (key, value) in [("fps", json!({"num":24,"den":1})), ("from_bin", json!(-1))] {
        let mut invalid = body.clone();
        invalid[key] = value;
        assert!(serde_json::from_value::<ProgramMetersQuery>(invalid).is_err());
    }
}
