use super::*;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use tower::ServiceExt;

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
        ("/js/export.js", 200),
        ("/js/scopes.js", 200),
        ("/js/balance.js", 200),
        ("/js/silence.js", 200),
        ("/js/library.js", 200),
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
            serde_json::from_value::<PrepareSource>(
                json!({"project_epoch":"p:1","audio_stream_index":value})
            )
            .is_err()
        );
    }
    assert!(
        serde_json::from_value::<PrepareSource>(
            json!({"project_epoch":"p:1","audio_stream_index":0,"fallback":true})
        )
        .is_err()
    );
}
