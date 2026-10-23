use super::*;
use std::{io::Read, net::TcpListener, sync::atomic::AtomicUsize, time::Instant};

fn item(bytes: u64) -> Value {
    json!({"id":"0123456789abcdef","kind":"audio","mime":"audio/wav","filename":"0123456789abcdef.wav","model":"Native integration fixture","tool":"audio","prompt":"Synthetic silence","seed":u64::MAX,"bytes":bytes,"created":"2026-10-20T00:00:00Z"})
}
fn index(item: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"archive":{"configured":true,"reachable":true,"retention_days":7},"sequence":5,"items":[item]})).unwrap()
}
fn root() -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "vv-web-library-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    root
}
struct Server {
    url: String,
    stop: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
    requests: Arc<AtomicUsize>,
}
impl Server {
    fn start(catalog: Vec<u8>, media: Vec<u8>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let stop = Arc::new(AtomicBool::new(false));
        let done = stop.clone();
        let requests = Arc::new(AtomicUsize::new(0));
        let count = requests.clone();
        let worker = std::thread::spawn(move || {
            while !done.load(Ordering::Relaxed) {
                let (mut stream, _) = match listener.accept() {
                    Ok(stream) => stream,
                    Err(_) => {
                        std::thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = Vec::new();
                let mut buffer = [0; 4096];
                loop {
                    let n = stream.read(&mut buffer).unwrap();
                    if n == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..n]);
                    if request.windows(4).any(|part| part == b"\r\n\r\n") {
                        break;
                    }
                }
                count.fetch_add(1, Ordering::Relaxed);
                let path = String::from_utf8_lossy(&request);
                let body = if path.starts_with("GET /api/v1/library ") {
                    &catalog
                } else {
                    &media
                };
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .unwrap();
                let _ = stream.write_all(body);
            }
        });
        Self {
            url,
            stop,
            worker: Some(worker),
            requests,
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.worker.take().unwrap().join().unwrap();
    }
}

#[test]
fn catalog_validates_opaque_ids_names_urls_and_keeps_exact_u64_seed_provenance() {
    let catalog = parse_catalog(&index(item(100))).unwrap();
    assert_eq!(
        catalog.items[0].seed.as_deref(),
        Some("18446744073709551615")
    );
    assert_eq!(
        serde_json::to_value(&catalog.items[0]).unwrap()["seed"],
        "18446744073709551615"
    );
    for (field, value) in [
        ("id", json!("../escape")),
        ("filename", json!("../source.wav")),
        ("bytes", json!(0)),
        ("mime", json!("text/html")),
    ] {
        let mut invalid = item(100);
        invalid[field] = value;
        assert!(parse_catalog(&index(invalid)).is_err());
    }
    for url in [
        "file:///etc/passwd",
        "http://user:secret@127.0.0.1/",
        "http://127.0.0.1/path",
        "http://127.0.0.1/?token=secret",
    ] {
        assert!(endpoint(url).is_err());
    }
    assert!(endpoint("http://192.168.1.153:8787").is_ok());
}

#[tokio::test]
async fn oversized_catalog_item_stays_visible_but_cannot_queue_or_download_a_project_copy() {
    let root = root();
    let mut other = item(100);
    other["id"] = json!("fedcba9876543210");
    other["filename"] = json!("fedcba9876543210.wav");
    let mut catalog: Value = serde_json::from_slice(&index(item(MAX_ITEM + 1))).unwrap();
    catalog["items"].as_array_mut().unwrap().push(other);
    let server = Server::start(serde_json::to_vec(&catalog).unwrap(), vec![]);
    let library = Library::start(Some(&server.url), File::open(&root).unwrap()).unwrap();
    let result = library.catalog().await.unwrap();
    assert_eq!(result["max_copy_bytes"], MAX_ITEM);
    assert_eq!(result["items"].as_array().unwrap().len(), 2);
    assert_eq!(result["items"][0]["bytes"], MAX_ITEM + 1);
    let error = library
        .prepare("0123456789abcdef", "epoch")
        .await
        .unwrap_err();
    assert_eq!(error.1, "LIBRARY_COPY_LIMIT");
    assert!(library.state().unwrap().jobs.lock().unwrap().is_empty());
    assert_eq!(server.requests.load(Ordering::Relaxed), 2);
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
    let boundary: Item = serde_json::from_value(item(MAX_ITEM)).unwrap();
    assert!(boundary.validate_copy().is_ok());
    drop(library);
    drop(server);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn declared_movie_type_refuses_playlist_bytes_before_native_probing() {
    let root = root();
    let path = root.join("claimed.mp4");
    std::fs::write(
        &path,
        b"ffconcat version 1.0\nfile /outside-root/private.mp4\n",
    )
    .unwrap();
    let mut value = item(60);
    value["kind"] = json!("video");
    value["mime"] = json!("video/mp4");
    value["filename"] = json!("0123456789abcdef.mp4");
    let item: Item = serde_json::from_value(value).unwrap();
    assert!(validate_header(&File::open(&path).unwrap(), &item).is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn shared_asset_download_preserves_native_samples_and_import_provenance_without_overwrites() {
    let root = root();
    let source = root.join("fixture.wav");
    vv_media::audio_file::write_audio_file(
        &source,
        vv_media::audio_file::AudioFileFormat::Wav,
        &vec![0.0; 48000],
        48000,
        1,
    )
    .unwrap();
    let bytes = std::fs::read(&source).unwrap();
    let server = Server::start(index(item(bytes.len() as u64)), bytes.clone());
    let library = Library::start(Some(&server.url), File::open(&root).unwrap()).unwrap();
    let job = library.prepare("0123456789abcdef", "epoch").await.unwrap();
    let id = job["id"].as_str().unwrap();
    let started = Instant::now();
    let result = loop {
        let job = library.status(id, "epoch", false).unwrap();
        if job["state"] == "ready" {
            break job["result"].clone();
        }
        assert_ne!(job["state"], "failed", "{job}");
        assert!(started.elapsed() < Duration::from_secs(10));
        tokio::time::sleep(Duration::from_millis(10)).await;
    };
    let name = result["path_token"].as_str().unwrap();
    assert_eq!(std::fs::read(root.join(name)).unwrap(), bytes);
    assert!(library.status(id, "another-document", false).is_err());
    let files = crate::files::Files::new(&root).unwrap();
    let (path, meta) = files.probe(name).unwrap();
    assert_eq!(meta.duration_frames, 30);
    let origin = files.shared_origin(&path).unwrap();
    assert_eq!(origin["item"]["id"], "0123456789abcdef");
    assert_eq!(origin["item"]["seed"], "18446744073709551615");
    assert_eq!(origin["sha256"], format!("{:x}", Sha256::digest(&bytes)));
    assert!(server.requests.load(Ordering::Relaxed) >= 3);
    assert!(std::fs::read_dir(&root).unwrap().all(|file| {
        !file
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")
    }));
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(&[0])
        .unwrap();
    assert_eq!(
        library.status(id, "epoch", false).unwrap_err().1,
        "SOURCE_CHANGED"
    );
    let retry = library.prepare("0123456789abcdef", "epoch").await.unwrap();
    let retry = retry["id"].as_str().unwrap();
    assert_ne!(retry, id);
    let started = Instant::now();
    loop {
        let status = library.status(retry, "epoch", false).unwrap();
        if status["state"] == "failed" {
            break;
        }
        assert!(started.elapsed() < Duration::from_secs(10));
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let mut changed = bytes.clone();
    changed.push(0);
    assert_eq!(std::fs::read(&path).unwrap(), changed);
    assert_eq!(std::fs::read(&source).unwrap(), bytes);
    drop(files);
    drop(library);
    drop(server);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn truncated_library_transfer_never_publishes_project_media() {
    let root = root();
    let server = Server::start(index(item(100)), vec![1; 20]);
    let library = Library::start(Some(&server.url), File::open(&root).unwrap()).unwrap();
    let job = library.prepare("0123456789abcdef", "epoch").await.unwrap();
    let id = job["id"].as_str().unwrap();
    let started = Instant::now();
    loop {
        let job = library.status(id, "epoch", false).unwrap();
        if job["state"] == "failed" {
            break;
        }
        assert!(started.elapsed() < Duration::from_secs(10));
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
    drop(library);
    drop(server);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn shared_original_reference_uses_verified_archive_locator_without_downloading_media() {
    let root = root();
    let shared = super::tests::root();
    std::fs::create_dir(shared.join("2026-10")).unwrap();
    let path = shared.join("2026-10/0123456789abcdef.wav");
    vv_media::audio_file::write_audio_file(
        &path,
        vv_media::audio_file::AudioFileFormat::Wav,
        &vec![0.0; 800],
        8000,
        1,
    )
    .unwrap();
    let original = std::fs::read(&path).unwrap();
    let mut archived = item(original.len() as u64);
    archived["archived"] = json!(true);
    archived["archive_rel"] = json!("2026-10/0123456789abcdef.wav");
    let server = Server::start(index(archived), vec![]);
    let mut files = crate::files::Files::new(&root).unwrap();
    files.set_shared_root(&shared).unwrap();
    let library = Library::start_with_roots(
        Some(&server.url),
        files.root_file().unwrap(),
        files.media_roots(),
    )
    .unwrap();
    let job = library
        .prepare_with_mode("0123456789abcdef", "epoch", PrepareMode::Reference)
        .await
        .unwrap();
    let id = job["id"].as_str().unwrap();
    let started = Instant::now();
    let result = loop {
        let status = library.status(id, "epoch", false).unwrap();
        if status["state"] == "ready" {
            break status["result"].clone();
        }
        assert!(
            matches!(status["state"].as_str(), Some("queued" | "running")),
            "{status}"
        );
        assert!(started.elapsed() < Duration::from_secs(10));
        tokio::time::sleep(Duration::from_millis(10)).await;
    };
    assert_eq!(
        result["path_token"],
        format!(
            "library://2026-10/0123456789abcdef.wav?source={:x}",
            Sha256::digest(result["source_version"].as_str().unwrap().as_bytes())
        )
    );
    assert_eq!(result["origin"]["mode"], "reference");
    assert!(result["origin"].get("sha256").is_none());
    assert_eq!(server.requests.load(Ordering::Relaxed), 2);
    assert_eq!(std::fs::read(&path).unwrap(), original);
    assert!(std::fs::read_dir(&root).unwrap().all(|entry| {
        !entry
            .unwrap()
            .path()
            .extension()
            .is_some_and(|ext| ext == "wav")
    }));
    assert_eq!(
        files.shared_origin(&path).unwrap()["item"]["id"],
        "0123456789abcdef"
    );
    assert_eq!(
        files
            .media_roots()
            .path(result["path_token"].as_str().unwrap())
            .unwrap(),
        path
    );
    drop(library);
    drop(files);
    let host =
        crate::host::Host::start_with_libraries(&root, &root.join(".presets"), &shared).unwrap();
    for (id, operation) in [
        (
            "reference-project",
            json!({"kind":"new_project","name":"Referenced"}),
        ),
        (
            "reference-import",
            json!({"kind":"import_media","path_token":result["path_token"]}),
        ),
        ("reference-save", json!({"kind":"save"})),
        (
            "reference-reopen",
            json!({"kind":"open_project","path_token":"Referenced.vvproj"}),
        ),
    ] {
        let state = host.call(crate::host::Action::Session).await.unwrap();
        let mutation = serde_json::from_value(json!({"command_id":id,"client_id":"test-reference","command_epoch":state["command_epoch"],"project_epoch":state["project_epoch"],"if_generation":state["generation"],"operation":operation})).unwrap();
        host.project_mutation(mutation).await.unwrap();
    }
    let state = host.call(crate::host::Action::Session).await.unwrap();
    let media = state["media"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["name"] == "0123456789abcdef.wav")
        .unwrap();
    assert_eq!(media["offline"], false);
    assert_eq!(media["shared_origin"]["mode"], "reference");
    let mutation = serde_json::from_value(json!({"command_id":"reference-relink","client_id":"test-reference","command_epoch":state["command_epoch"],"project_epoch":state["project_epoch"],"if_generation":state["generation"],"operation":{"kind":"edit_catalog","edit":{"kind":"relink","items":[{"media_id":media["id"],"path_token":result["path_token"]}]}}})).unwrap();
    host.project_mutation(mutation).await.unwrap();
    let source = host
        .source_snapshot(
            media["id"].as_str().unwrap().into(),
            crate::source::SourceQuery {
                project_epoch: state["project_epoch"].as_str().unwrap().into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(source.file.metadata().unwrap().len(), original.len() as u64);
    assert!(
        std::fs::read_to_string(root.join("Referenced.vvproj"))
            .unwrap()
            .contains(path.to_str().unwrap())
    );
    let roots = host.media_roots().await.unwrap();
    assert!(roots.open(&path).is_ok());
    drop(source);
    drop(host);
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(&[0])
        .unwrap();
    assert_ne!(
        crate::asset_store::stable_identity(&roots.open(&path).unwrap()).unwrap(),
        result["source_version"].as_str().unwrap()
    );
    drop(roots);
    drop(server);
    std::fs::remove_dir_all(root).unwrap();
    std::fs::remove_dir_all(shared).unwrap();
}
