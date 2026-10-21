use super::*;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use tower::ServiceExt;

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
        ("/js/compound-navigation.js", 200),
        ("/js/export.js", 200),
        ("/js/scopes.js", 200),
        ("/js/balance.js", 200),
        ("/js/silence.js", 200),
        ("/js/library.js", 200),
        ("/js/native-assets.js", 200),
        ("/js/native-asset-folders.js", 200),
        ("/js/media-import.js", 200),
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
    let (tx, rx) = tokio::sync::oneshot::channel();
    host.call(Action::PrepareNativeAssetEdit(
        serde_json::from_value(folder_command("pending-http-folder")).unwrap(),
        tx,
    ))
    .await
    .unwrap();
    let preparation = rx.await.unwrap().unwrap();
    assert!(matches!(
        &preparation,
        crate::host::NativeEditPreparation::Pending(_)
    ));
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
    assert_eq!(pending["error"]["details"]["status"], "preparing");
    assert!(pending["error"]["details"]["job_id"].is_string());
    drop(preparation);
    let command = folder_command("create-http-folder");
    let response = app
        .clone()
        .oneshot(make(
            "POST",
            "/api/v1/native-assets/commands",
            command.clone(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let receipt: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 32768).await.unwrap()).unwrap();
    assert_eq!(receipt["status"], "applied");
    assert_eq!(receipt["library_durable"], true);
    assert_eq!(receipt["generation"], session["generation"]);
    assert_eq!(receipt["durability"]["state"], "volatile");
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
