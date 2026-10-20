use super::*;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use tower::ServiceExt;

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
        source: MediaJobs::start().unwrap(),
        host: Host::start(&root).unwrap(),
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
        source: MediaJobs::start().unwrap(),
        host: Host::start(&root).unwrap(),
        port: 8787,
    });
    for (path, status) in [
        ("/api/v1/health", 200),
        ("/", 200),
        ("/js/timeline/input.js", 200),
        ("/js/export.js", 200),
        ("/js/scopes.js", 200),
        ("/js/balance.js", 200),
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
        assert!(
            !to_bytes(response.into_body(), 1024 * 1024)
                .await
                .unwrap()
                .is_empty()
        );
    }
    for (host, origin) in [
        ("evil.example:8787", "http://evil.example:8787"),
        ("127.0.0.1:8787", "https://evil.example"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/session")
                    .header("host", host)
                    .header("origin", origin)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
    std::fs::remove_dir_all(root).unwrap();
}
