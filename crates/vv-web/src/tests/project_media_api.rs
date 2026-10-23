use super::*;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use tower::ServiceExt;

fn wave() -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&1636u32.to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&8000u32.to_le_bytes());
    bytes.extend_from_slice(&16000u32.to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&1600u32.to_le_bytes());
    bytes.resize(1644, 0);
    bytes
}

fn mutation(state: &Value, id: &str, operation: Value) -> Value {
    json!({"command_id":id,"client_id":"project-media-http","command_epoch":state["command_epoch"],"project_epoch":state["project_epoch"],"if_generation":state["generation"],"if_revision":null,"operation":operation})
}

fn media_without_compound_generation(state: &Value) -> Value {
    let mut media = state["media"].clone();
    for item in media.as_array_mut().unwrap() {
        if item["compound_timeline_id"].is_string() {
            item.as_object_mut().unwrap().remove("content_hash");
        }
    }
    media
}

async fn send(app: &axum::Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:8787")
        .header("content-type", "application/json")
        .body(if body.is_null() {
            Body::empty()
        } else {
            Body::from(body.to_string())
        })
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    if status == StatusCode::OK && path.starts_with("/api/v1/media/") {
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "no-store",
            "{path}"
        );
    }
    let value = serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
        .unwrap();
    (status, value)
}

async fn ready(app: &axum::Router, id: &str, epoch: &str, kind: &str) -> Value {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        let (status, value) = send(
            app,
            "GET",
            &format!("/api/v1/media/jobs/{id}?project_epoch={epoch}"),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["kind"], kind, "{value}");
        if value["state"] == "ready" {
            return value;
        }
        assert!(
            value["state"] == "queued" || value["state"] == "running",
            "{value}"
        );
        assert!(std::time::Instant::now() < deadline, "{value}");
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
}

#[tokio::test]
async fn project_media_http_tree_and_recursive_relink_are_prepared_typed_atomic_and_replayable() {
    let root = std::env::temp_dir().join(format!(
        "vv-project-media-http-{}",
        crate::asset_jobs::nonce()
    ));
    std::fs::create_dir_all(root.join("Shots/Sub")).unwrap();
    std::fs::create_dir_all(root.join("Shots/Empty")).unwrap();
    std::fs::create_dir_all(root.join("Repairs/Deep")).unwrap();
    std::fs::write(root.join("Shots/A.wav"), wave()).unwrap();
    std::fs::write(root.join("Shots/Sub/B.wav"), wave()).unwrap();
    std::fs::write(root.join("Shots/Sub/bad.wav"), b"not audio").unwrap();
    std::fs::write(root.join("Shots/Empty/note.txt"), b"not media").unwrap();
    std::fs::write(root.join("Cancel.wav"), wave()).unwrap();
    let host = Host::start(&root).unwrap();
    let initial = host.call(Action::Session).await.unwrap();
    host.project_mutation(
        serde_json::from_value(mutation(
            &initial,
            "project-media-new",
            json!({"kind":"new_project","name":"Project_media"}),
        ))
        .unwrap(),
    )
    .await
    .unwrap();
    let initial = host.call(Action::Session).await.unwrap();
    let epoch = initial["project_epoch"].as_str().unwrap();
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
    let import_path = "/api/v1/media/project-imports/prepare";
    let tree = json!({"project_epoch":epoch,"if_generation":initial["generation"],"directory_token":"Shots","parent":null});
    for invalid in [
        json!({"project_epoch":epoch,"if_generation":initial["generation"],"directory_token":"Shots","parent":null,"force":true}),
        json!({"project_epoch":epoch,"if_generation":initial["generation"],"directory_token":"Shots","path_tokens":["Cancel.wav"],"parent":null}),
        json!({"project_epoch":epoch,"if_generation":initial["generation"],"path_tokens":["../escape.wav"],"parent":null}),
    ] {
        let (status, value) = send(&app, "POST", import_path, invalid).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{value}");
    }
    let mut stale = tree.clone();
    stale["project_epoch"] = json!("stale");
    assert_eq!(
        send(&app, "POST", import_path, stale).await.0,
        StatusCode::CONFLICT
    );
    let (status, job) = send(&app, "POST", import_path, tree).await;
    assert_eq!(status, StatusCode::OK, "{job}");
    let job_id = job["id"].as_str().unwrap();
    let prepared = ready(&app, job_id, epoch, "project_import").await;
    assert_eq!(prepared["result"]["mode"], "tree");
    assert_eq!(prepared["result"]["items"].as_array().unwrap().len(), 2);
    assert_eq!(prepared["result"]["errors"].as_array().unwrap().len(), 1);
    assert_eq!(
        prepared["result"]["folders"]
            .as_array()
            .unwrap()
            .iter()
            .map(|folder| folder["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["Shots", "Sub"]
    );
    assert_eq!(
        host.call(Action::Session).await.unwrap(),
        initial,
        "preparation must not create folders, import media, or alter history"
    );
    for (path, expected) in [
        (
            format!("/api/v1/media/jobs/{job_id}"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            format!("/api/v1/media/jobs/{job_id}?project_epoch=stale"),
            StatusCode::CONFLICT,
        ),
        (
            format!("/api/v1/media/jobs/{job_id}?project_epoch={epoch}&force=true"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            format!("/api/v1/media/imports/{job_id}?project_epoch={epoch}"),
            StatusCode::NOT_FOUND,
        ),
    ] {
        let (status, value) = send(&app, "GET", &path, Value::Null).await;
        assert_eq!(status, expected, "{path}: {value}");
    }
    let command = mutation(
        &initial,
        "project-media-import",
        json!({"kind":"import_prepared_project_media","job_id":job_id}),
    );
    let mut foreign = command.clone();
    foreign["command_id"] = json!("project-media-foreign");
    foreign["client_id"] = json!("other-writer");
    assert_eq!(
        send(&app, "POST", "/api/v1/projects/commands", foreign)
            .await
            .0,
        StatusCode::CONFLICT
    );
    let wrong = mutation(
        &initial,
        "project-media-wrong-kind",
        json!({"kind":"relink_prepared_media","job_id":job_id}),
    );
    assert_eq!(
        send(&app, "POST", "/api/v1/projects/commands", wrong)
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(host.call(Action::Session).await.unwrap(), initial);
    let (status, receipt) = send(&app, "POST", "/api/v1/projects/commands", command.clone()).await;
    assert_eq!(status, StatusCode::OK, "{receipt}");
    assert_eq!(receipt["media_ids"].as_array().unwrap().len(), 2);
    assert_eq!(receipt["folder_ids"].as_array().unwrap().len(), 2);
    assert_eq!(receipt["errors"], prepared["result"]["errors"]);
    assert_eq!(receipt["changed"], true);
    assert_eq!(
        send(&app, "POST", "/api/v1/projects/commands", command).await,
        (StatusCode::OK, receipt.clone())
    );
    let imported = host.call(Action::Session).await.unwrap();
    assert_eq!(
        imported["history"]["position"].as_u64().unwrap(),
        initial["history"]["position"].as_u64().unwrap() + 1
    );
    let root_folder = imported["folders"]
        .as_array()
        .unwrap()
        .iter()
        .find(|folder| folder["name"] == "Shots")
        .unwrap();
    let child_folder = imported["folders"]
        .as_array()
        .unwrap()
        .iter()
        .find(|folder| folder["name"] == "Sub")
        .unwrap();
    assert_eq!(child_folder["parent"], root_folder["id"]);
    let undo = mutation(
        &imported,
        "project-media-undo-import",
        json!({"kind":"undo"}),
    );
    assert_eq!(
        send(&app, "POST", "/api/v1/projects/commands", undo)
            .await
            .0,
        StatusCode::OK
    );
    let undone = host.call(Action::Session).await.unwrap();
    assert_eq!(
        media_without_compound_generation(&undone),
        media_without_compound_generation(&initial)
    );
    assert_eq!(undone["folders"], initial["folders"]);
    let redo = mutation(&undone, "project-media-redo-import", json!({"kind":"redo"}));
    assert_eq!(
        send(&app, "POST", "/api/v1/projects/commands", redo)
            .await
            .0,
        StatusCode::OK
    );
    let restored = host.call(Action::Session).await.unwrap();
    assert_eq!(
        media_without_compound_generation(&restored),
        media_without_compound_generation(&imported)
    );
    assert_eq!(restored["folders"], imported["folders"]);

    std::fs::rename(root.join("Shots/A.wav"), root.join("Repairs/Deep/A.wav")).unwrap();
    let before_relink = host.call(Action::Session).await.unwrap();
    let selected = receipt["media_ids"].clone();
    let relink = json!({"project_epoch":epoch,"if_generation":before_relink["generation"],"action":{"kind":"by_name","directory_token":"Repairs","scope":{"kind":"selected","media_ids":selected}}});
    let (status, job) = send(&app, "POST", "/api/v1/media/relinks/prepare", relink).await;
    assert_eq!(status, StatusCode::OK, "{job}");
    let relink_id = job["id"].as_str().unwrap();
    let prepared = ready(&app, relink_id, epoch, "project_relink").await;
    assert_eq!(prepared["result"]["mode"], "by_name");
    assert_eq!(prepared["result"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        prepared["result"]["items"][0]["path_token"],
        "Repairs/Deep/A.wav"
    );
    assert_eq!(prepared["result"]["skipped"].as_array().unwrap().len(), 1);
    assert_eq!(prepared["result"]["not_found"], json!([]));
    assert_eq!(host.call(Action::Session).await.unwrap(), before_relink);
    let command = mutation(
        &before_relink,
        "project-media-relink",
        json!({"kind":"relink_prepared_media","job_id":relink_id}),
    );
    let (status, receipt) = send(&app, "POST", "/api/v1/projects/commands", command.clone()).await;
    assert_eq!(status, StatusCode::OK, "{receipt}");
    assert_eq!(receipt["relinked_media_ids"].as_array().unwrap().len(), 1);
    assert_eq!(receipt["skipped"], prepared["result"]["skipped"]);
    assert_eq!(
        send(&app, "POST", "/api/v1/projects/commands", command).await,
        (StatusCode::OK, receipt)
    );
    let repaired = host.call(Action::Session).await.unwrap();
    let repaired_id = &prepared["result"]["items"][0]["media_id"];
    assert_eq!(
        before_relink["media"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| &item["id"] == repaired_id)
            .unwrap()["offline"],
        true
    );
    assert_eq!(
        repaired["media"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| &item["id"] == repaired_id)
            .unwrap()["offline"],
        false
    );
    assert_eq!(
        repaired["history"]["position"].as_u64().unwrap(),
        before_relink["history"]["position"].as_u64().unwrap() + 1
    );
    assert_eq!(repaired["folders"], imported["folders"]);
    assert_eq!(
        repaired["media"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["id"].clone())
            .collect::<Vec<_>>(),
        imported["media"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["id"].clone())
            .collect::<Vec<_>>()
    );
    let undo = mutation(
        &repaired,
        "project-media-undo-relink",
        json!({"kind":"undo"}),
    );
    assert_eq!(
        send(&app, "POST", "/api/v1/projects/commands", undo)
            .await
            .0,
        StatusCode::OK
    );
    let undone = host.call(Action::Session).await.unwrap();
    assert_eq!(
        media_without_compound_generation(&undone),
        media_without_compound_generation(&before_relink)
    );

    let prepare = json!({"project_epoch":epoch,"if_generation":undone["generation"],"path_tokens":["Cancel.wav"],"parent":null});
    let (status, job) = send(&app, "POST", import_path, prepare.clone()).await;
    assert_eq!(status, StatusCode::OK, "{job}");
    let canceled_id = job["id"].as_str().unwrap();
    ready(&app, canceled_id, epoch, "project_import").await;
    assert_eq!(
        send(
            &app,
            "DELETE",
            &format!("/api/v1/media/jobs/{canceled_id}?project_epoch={epoch}"),
            Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
    let canceled = mutation(
        &undone,
        "project-media-canceled",
        json!({"kind":"import_prepared_project_media","job_id":canceled_id}),
    );
    assert_ne!(
        send(&app, "POST", "/api/v1/projects/commands", canceled)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(host.call(Action::Session).await.unwrap(), undone);
    let (status, job) = send(&app, "POST", import_path, prepare).await;
    assert_eq!(status, StatusCode::OK, "{job}");
    let stale_id = job["id"].as_str().unwrap();
    ready(&app, stale_id, epoch, "project_import").await;
    let change = mutation(
        &undone,
        "project-media-generation-change",
        json!({"kind":"edit_catalog","edit":{"kind":"new_folder","name":"Later","parent":null}}),
    );
    assert_eq!(
        send(&app, "POST", "/api/v1/projects/commands", change)
            .await
            .0,
        StatusCode::OK
    );
    let changed = host.call(Action::Session).await.unwrap();
    let stale = mutation(
        &changed,
        "project-media-stale",
        json!({"kind":"import_prepared_project_media","job_id":stale_id}),
    );
    assert_eq!(
        send(&app, "POST", "/api/v1/projects/commands", stale)
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(host.call(Action::Session).await.unwrap(), changed);
    drop(app);
    drop(host);
    std::fs::remove_dir_all(root).unwrap();
}
