use super::*;
use serde_json::json;

fn root(label: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "vv-shared-audio-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    root
}
fn empty() -> serde_json::Value {
    json!({"eq_presets":[],"compressor_presets":[]})
}
fn eq(gain: f32) -> Equalizer {
    let mut params = Equalizer::DEFAULT;
    params.bands[2].gain_db = gain;
    params
}

struct InteropWeb {
    root: PathBuf,
    child: Option<std::process::Child>,
    stdout: Option<std::thread::JoinHandle<()>>,
    address: std::net::SocketAddr,
    deadline: std::time::Instant,
}

impl InteropWeb {
    fn start(binary: &Path) -> Self {
        use std::{
            io::{BufRead, Read},
            process::{Command, Stdio},
            time::Duration,
        };
        let mut server = Self {
            root: root("real-web-interop"),
            child: None,
            stdout: None,
            address: "127.0.0.1:0".parse().unwrap(),
            deadline: std::time::Instant::now() + Duration::from_secs(60),
        };
        let temp = server.root.join("tmp");
        std::fs::create_dir(&temp).unwrap();
        server.child = Some(
            Command::new(binary)
                .args(["--listen", "127.0.0.1:0", "--projects-root"])
                .arg(server.root.join("projects"))
                .arg("--presets-root")
                .arg(server.root.join("library/presets"))
                .arg("--assets-root")
                .arg(server.root.join("library"))
                .current_dir(&server.root)
                .env("TMPDIR", &temp)
                .env("TMP", &temp)
                .env("TEMP", &temp)
                .env("RAYON_NUM_THREADS", "1")
                .env("TOKIO_WORKER_THREADS", "1")
                .env("OMP_NUM_THREADS", "1")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .expect("Could not start the exact VENTURI_INTEROP_WEB binary"),
        );
        let stdout = server.child.as_mut().unwrap().stdout.take().unwrap();
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        server.stdout = Some(std::thread::spawn(move || {
            let mut input = std::io::BufReader::new(stdout).take(4097);
            let mut line = String::new();
            let address = input
                .read_line(&mut line)
                .ok()
                .filter(|&count| count <= 4096)
                .and_then(|_| line.trim().strip_prefix("Venturi Web: http://"))
                .and_then(|value| value.parse::<std::net::SocketAddr>().ok());
            let _ = send.send(address);
            let _ = std::io::copy(&mut input, &mut std::io::sink());
        }));
        server.address = receive
            .recv_timeout(Duration::from_secs(5))
            .expect("vv-web did not announce its own ephemeral listener within five seconds")
            .expect("Unexpected vv-web listener announcement");
        assert!(server.address.ip().is_loopback() && server.address.port() != 0);
        server
    }

    fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> (u16, serde_json::Value) {
        use std::{
            io::{Read, Write},
            time::Duration,
        };
        let remaining = self
            .deadline
            .checked_duration_since(std::time::Instant::now())
            .expect("The native/web interoperability test exceeded its sixty-second budget");
        let timeout = remaining.min(Duration::from_secs(2));
        assert!(!path.contains(['\r', '\n']));
        let mut socket = std::net::TcpStream::connect_timeout(&self.address, timeout).unwrap();
        socket.set_read_timeout(Some(timeout)).unwrap();
        socket.set_write_timeout(Some(timeout)).unwrap();
        let body = body.map_or_else(String::new, |value| value.to_string());
        assert!(body.len() <= 65536);
        write!(socket, "{method} {path} HTTP/1.0\r\nHost: {}\r\nOrigin: http://{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", self.address, self.address, body.len()).unwrap();
        let mut response = Vec::new();
        (&mut socket)
            .take(65537)
            .read_to_end(&mut response)
            .unwrap();
        assert!(
            response.len() <= 65536,
            "Interop HTTP response exceeded 64 KiB"
        );
        let end = response
            .windows(4)
            .position(|bytes| bytes == b"\r\n\r\n")
            .expect("Missing HTTP headers");
        assert!(end <= 4096);
        let headers = std::str::from_utf8(&response[..end]).unwrap();
        let status = headers
            .lines()
            .next()
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        assert!(
            !headers.to_ascii_lowercase().contains("transfer-encoding:"),
            "This bounded HTTP/1.0 helper requires an unchunked JSON response"
        );
        let value =
            serde_json::from_slice(&response[end + 4..]).expect("vv-web returned invalid JSON");
        (status, value)
    }

    fn catalog(&self, session: &serde_json::Value) -> (u16, serde_json::Value) {
        self.request(
            "GET",
            &format!(
                "/api/v1/audio/presets?project_epoch={}",
                session["project_epoch"].as_str().unwrap()
            ),
            None,
        )
    }

    fn library_item(
        &self,
        session: &serde_json::Value,
        catalog: &str,
        id: &str,
    ) -> serde_json::Value {
        let (status, item) = self.request(
            "GET",
            &format!(
                "/api/v1/{catalog}/items/{id}?project_epoch={}",
                session["project_epoch"].as_str().unwrap()
            ),
            None,
        );
        assert_eq!(status, 200, "{item}");
        assert!(item.get("error").is_none(), "{item}");
        item
    }

    fn library_command(
        &self,
        session: &serde_json::Value,
        catalog: &str,
        id: &str,
        edit: serde_json::Value,
    ) -> (u16, serde_json::Value) {
        let kind = match catalog {
            "native-assets" => "edit_native_asset_library",
            "presets" => "edit_preset_library",
            _ => panic!("Unknown interop catalog"),
        };
        self.request("POST", &format!("/api/v1/{catalog}/commands"), Some(json!({
            "command_id":id,"client_id":"native-web-interop","command_epoch":session["command_epoch"],
            "project_epoch":session["project_epoch"],"if_generation":session["generation"],"if_revision":null,
            "operation":{"kind":kind,"edit":edit},
        })))
    }

    fn save(
        &self,
        session: &serde_json::Value,
        id: &str,
        revision: &serde_json::Value,
        value: Equalizer,
    ) -> (u16, serde_json::Value) {
        self.request("POST", "/api/v1/audio/presets/commands", Some(json!({
            "command_id":id,"client_id":"native-web-interop","command_epoch":session["command_epoch"],
            "project_epoch":session["project_epoch"],"if_generation":session["generation"],"if_revision":null,
            "operation":{"kind":"edit_audio_preset_library","edit":{
                "action":"save","name":"Voice","revision":revision,"parameters":{"Equalizer":value},
            }},
        })))
    }
}

impl Drop for InteropWeb {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            if child.try_wait().ok().flatten().is_none() {
                let _ = child.kill();
            }
            let _ = child.wait();
        }
        if let Some(stdout) = self.stdout.take() {
            let _ = stdout.join();
        }
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
#[ignore = "Set VENTURI_INTEROP_WEB to an existing vv-web binary; run explicitly under finite CPU/RAM limits"]
fn shared_audio_presets_native_web_process_interoperability() {
    let binary = PathBuf::from(std::env::var_os("VENTURI_INTEROP_WEB").expect(
        "Set VENTURI_INTEROP_WEB to the exact existing vv-web binary; this test never builds one",
    ));
    assert!(binary.is_absolute() && binary.is_file());
    let binary = binary.canonicalize().unwrap();
    let web = InteropWeb::start(&binary);
    let shared = web.root.join("library/presets");
    let settings_path = web.root.join("settings.json");
    let legacy = json!({"eq_presets":[{"name":"Legacy","params":eq(-1.0)}],
        "compressor_presets":[{"name":"Legacy","params":MultibandCompressor::DEFAULT}]});
    let settings_bytes = serde_json::to_vec_pretty(&legacy).unwrap();
    std::fs::write(&settings_path, &settings_bytes).unwrap();
    let settings = crate::settings::Settings::load(&settings_path);
    let mut native = AudioPresetLibrary::open(shared.clone(), settings.audio_preset_values());
    native.bank().save("Voice", &eq(-6.0)).unwrap();
    let mut compressor = MultibandCompressor::DEFAULT;
    compressor.bands[1].ratio = 5.0;
    native.bank().save("Voice", &compressor).unwrap();
    let file = shared.join(AUDIO_PRESET_FILE);
    assert_eq!(
        web.request(
            "POST",
            "/api/v1/lease",
            Some(json!({"client_id":"native-web-interop"}))
        )
        .0,
        200
    );
    let (status, session) = web.request("GET", "/api/v1/session", None);
    assert_eq!(status, 200);
    assert_eq!(
        session["capabilities"]["preview"], false,
        "The interop child must not initialize a renderer"
    );
    let (status, first) = web.catalog(&session);
    assert_eq!(status, 200, "{first}");
    let entry = |catalog: &serde_json::Value, kind: &str| {
        catalog[kind]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["name"] == "Voice")
            .unwrap()["params"]
            .clone()
    };
    assert_eq!(
        serde_json::from_value::<Equalizer>(entry(&first, "eq_presets")).unwrap(),
        eq(-6.0)
    );
    assert_eq!(
        serde_json::from_value::<MultibandCompressor>(entry(&first, "compressor_presets")).unwrap(),
        compressor
    );
    let (status, ack) = web.save(&session, "web-first", &first["revision"], eq(-7.0));
    assert_eq!(status, 200, "{ack}");
    let bytes = std::fs::read(&file).unwrap();
    assert!(native.bank::<Equalizer>().resolve("Voice").is_err());
    assert!(native.bank().save("Stale", &eq(1.0)).is_err());
    assert!(native.bank::<Equalizer>().delete("Voice").is_err());
    assert_eq!(std::fs::read(&file).unwrap(), bytes);
    native.refresh().unwrap();
    assert_eq!(
        native.bank::<Equalizer>().resolve("Voice").unwrap(),
        eq(-7.0)
    );
    let (status, second) = web.catalog(&session);
    assert_eq!(status, 200);
    native.bank().save("Voice", &eq(-8.0)).unwrap();
    let bytes = std::fs::read(&file).unwrap();
    let (status, rejected) = web.save(&session, "web-stale", &second["revision"], eq(1.0));
    assert_eq!(status, 409, "{rejected}");
    assert_eq!(rejected["error"]["code"], "AUDIO_PRESETS_CHANGED");
    assert_eq!(std::fs::read(&file).unwrap(), bytes);
    let (status, current) = web.catalog(&session);
    assert_eq!(status, 200);
    assert_ne!(second["revision"], current["revision"]);
    assert_eq!(
        serde_json::from_value::<Equalizer>(entry(&current, "eq_presets")).unwrap(),
        eq(-8.0)
    );
    for (exclusive, command) in [(false, "web-native-sh"), (true, "web-native-ex")] {
        let guard = if exclusive {
            Guard::write(&shared, Kind::AudioPresets)
        } else {
            Guard::snapshot(&shared, Kind::AudioPresets)
        }
        .unwrap();
        let started = std::time::Instant::now();
        let (status, listed) = web.catalog(&session);
        assert_eq!(status, if exclusive { 409 } else { 200 }, "{listed}");
        if exclusive {
            assert_eq!(listed["error"]["code"], "AUDIO_PRESETS_BUSY");
        }
        let (status, blocked) = web.save(&session, command, &current["revision"], eq(2.0));
        assert_eq!(status, 409, "{blocked}");
        assert_eq!(blocked["error"]["code"], "AUDIO_PRESETS_BUSY");
        assert_eq!(std::fs::read(&file).unwrap(), bytes);
        eprintln!(
            "native audio lock exclusive={exclusive}, web refusal after {:?}",
            started.elapsed()
        );
        drop(guard);
    }
    let mut after = native.data.clone();
    after
        .eq_presets
        .iter_mut()
        .find(|entry| entry.name == "Voice")
        .unwrap()
        .params = eq(-9.0);
    after
        .compressor_presets
        .iter_mut()
        .find(|entry| entry.name == "Voice")
        .unwrap()
        .params
        .bands[1]
        .ratio = 6.0;
    let mut writer = Guard::write(&shared, Kind::AudioPresets).unwrap();
    writer.fail_after_intent_for_test();
    assert!(
        writer
            .commit(vec![Target {
                path: AUDIO_PRESET_FILE.into(),
                before: writer.read(AUDIO_PRESET_FILE).unwrap(),
                after: Some(after.bytes().unwrap()),
            }])
            .unwrap_err()
            .contains("durable native library intent")
    );
    drop(writer);
    let marker = shared.join(crate::library::io::AUDIO_PRESET_PENDING);
    assert!(std::fs::metadata(&marker).unwrap().len() <= 65536);
    let pending = std::fs::read(&marker).unwrap();
    for write in [false, true] {
        let (status, refused) = if write {
            web.save(&session, "web-pending", &current["revision"], eq(3.0))
        } else {
            web.catalog(&session)
        };
        assert_eq!(status, 409, "{refused}");
        assert_eq!(refused["error"]["code"], "LIBRARY_RECOVERY_REQUIRED");
        assert_eq!(std::fs::read(&file).unwrap(), bytes);
        assert_eq!(std::fs::read(&marker).unwrap(), pending);
    }
    native.refresh().unwrap();
    assert!(!marker.exists());
    assert_eq!(
        native.bank::<Equalizer>().resolve("Voice").unwrap(),
        eq(-9.0)
    );
    assert_eq!(
        native
            .bank::<MultibandCompressor>()
            .resolve("Voice")
            .unwrap()
            .bands[1]
            .ratio,
        6.0
    );
    let (status, recovered) = web.catalog(&session);
    assert_eq!(status, 200, "{recovered}");
    assert_ne!(recovered["revision"], current["revision"]);
    assert_eq!(
        serde_json::from_value::<Equalizer>(entry(&recovered, "eq_presets")).unwrap(),
        eq(-9.0)
    );
    assert_eq!(
        serde_json::from_value::<MultibandCompressor>(entry(&recovered, "compressor_presets"))
            .unwrap()
            .bands[1]
            .ratio,
        6.0
    );
    assert_eq!(web.request("GET", "/api/v1/session", None), (200, session));
    assert_eq!(std::fs::read(&settings_path).unwrap(), settings_bytes);
    assert_eq!(settings.audio_preset_values(), legacy);
    eprintln!(
        "Native/web audio preset interoperability passed with {} (owned child {:?})",
        binary.display(),
        web.child.as_ref().map(std::process::Child::id)
    );
    let owned_root = web.root.clone();
    drop(native);
    drop(web);
    assert!(
        !owned_root.exists(),
        "The owned interoperability fixture was not cleaned up"
    );
}

#[test]
#[ignore = "Set VENTURI_INTEROP_WEB to an existing vv-web binary and TMPDIR to a private filesystem qualification directory; run explicitly under finite limits"]
fn shared_library_native_web_full_catalog_process_interoperability() {
    use crate::library::{AttributePreset, Library};
    use vv_core::attributes::{Attribute, TimelineFormat};
    use vv_core::clipboard::{ClipboardOrigin, ClipboardPayload};
    use vv_core::{Clip, ClipSource, Rational, Timeline, Track, TrackKind};

    let binary = PathBuf::from(std::env::var_os("VENTURI_INTEROP_WEB").expect(
        "Set VENTURI_INTEROP_WEB to the exact existing vv-web binary; this test never builds one",
    ));
    assert!(binary.is_absolute() && binary.is_file());
    let mut web = InteropWeb::start(&binary.canonicalize().unwrap());
    web.deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
    let shared = web.root.join("library");
    let preset_root = shared.join("presets");
    let mut native = Library::open(shared.clone());
    assert!(native.error().is_none(), "{:?}", native.error());
    let parent = native.add_folder("Parent".into(), None).unwrap();
    let folder = native
        .add_folder("Child".into(), Some(parent.clone()))
        .unwrap();

    let mut source = vv_session::Session::default();
    let timeline = source.create_timeline(Timeline {
        name: "Native solid compound".into(),
        fps: Rational::new(24, 1),
        resolution: (16, 16),
        tracks: vec![Track::new(TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let clip = Clip::from_source_range(
        source.project.alloc_clip_id(),
        ClipSource::SolidColor,
        0,
        24,
        0,
        Rational::one(),
    );
    source.project.timelines[timeline].tracks[0].insert_sorted(clip.clone());
    source.sync_timeline_media(timeline);
    let media = source
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(timeline))
        .unwrap()
        .0;
    let source_before = serde_json::to_value(&source.project).unwrap();
    let payload = ClipboardPayload::new(
        ClipboardOrigin {
            instance: 1,
            epoch: 1,
        },
        &source.project,
        &[media],
        &[],
    );
    let original_payload = payload.to_text();
    native.add_asset("Native compound".into(), Some(folder.clone()), payload);
    while native.pending().next().is_some() {
        let errors = native.poll();
        assert!(errors.is_empty(), "{errors:?}");
        assert!(
            std::time::Instant::now() < web.deadline,
            "Native asset did not finish"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    let asset_id = native.assets[0].id.clone();
    let mut preset = AttributePreset::new(
        "Native look".into(),
        TimelineFormat {
            fps: Rational::new(24, 1),
            resolution: (16, 16),
        },
        Some(clip),
        None,
    );
    preset.attributes = vec![Attribute::Zoom];
    let preset_id = native.add_preset(preset.clone()).unwrap();
    let peer_id = native.add_preset(preset.clone()).unwrap();
    let settings_path = web.root.join("settings.json");
    let legacy =
        json!({"eq_presets":[{"name":"Legacy","params":eq(-1.0)}],"compressor_presets":[]});
    let settings_bytes = serde_json::to_vec_pretty(&legacy).unwrap();
    std::fs::write(&settings_path, &settings_bytes).unwrap();
    let settings = crate::settings::Settings::load(&settings_path);
    let mut audio = AudioPresetLibrary::open(preset_root.clone(), settings.audio_preset_values());
    audio.bank().save("Voice", &eq(-6.0)).unwrap();
    audio
        .bank()
        .save("Voice", &MultibandCompressor::DEFAULT)
        .unwrap();
    let audio_bytes = std::fs::read(preset_root.join(AUDIO_PRESET_FILE)).unwrap();
    assert_eq!(
        web.request(
            "POST",
            "/api/v1/lease",
            Some(json!({"client_id":"native-web-interop"}))
        )
        .0,
        200
    );
    let (status, session) = web.request("GET", "/api/v1/session", None);
    assert_eq!(status, 200);
    assert_eq!(session["capabilities"]["preview"], false);
    let epoch = session["project_epoch"].as_str().unwrap();
    let folders_path = format!("/api/v1/native-assets/folders?project_epoch={epoch}");
    let item_path =
        |catalog: &str, id: &str| format!("/api/v1/{catalog}/items/{id}?project_epoch={epoch}");
    let options = |name: &str| json!({"name":name,"attributes":preset.attributes,"anchor":preset.anchor,"append_filters":preset.append_filters});
    let asset = web.library_item(&session, "native-assets", &asset_id);
    assert_eq!(asset["name"], "Native compound");
    assert_eq!(asset["folder"], folder);
    let first_preset = web.library_item(&session, "presets", &preset_id);
    assert_eq!(first_preset["name"], "Native look");
    assert_eq!(web.catalog(&session).0, 200);

    let (status, ack) = web.library_command(
        &session,
        "native-assets",
        "asset-web-first",
        json!({"action":"update","id":asset_id,"revision":asset["revision"],"name":"Web compound"}),
    );
    assert_eq!(status, 200, "{ack}");
    assert!(
        native
            .rename_asset(&asset_id, "Stale draft".into())
            .is_err()
    );
    assert_eq!(native.assets[0].name, "Native compound");
    native.refresh().unwrap();
    assert_eq!(native.assets[0].name, "Web compound");
    let stale_asset = web.library_item(&session, "native-assets", &asset_id);
    native
        .rename_asset(&asset_id, "Native refreshed".into())
        .unwrap();
    let asset_file = shared.join(format!("assets/{asset_id}.json"));
    let asset_bytes = std::fs::read(&asset_file).unwrap();
    let (status, refused) = web.library_command(&session, "native-assets", "asset-web-stale", json!({"action":"update","id":asset_id,"revision":stale_asset["revision"],"name":"Must not write"}));
    assert_eq!(status, 409, "{refused}");
    assert_eq!(std::fs::read(&asset_file).unwrap(), asset_bytes);
    assert_eq!(
        web.library_item(&session, "native-assets", &asset_id)["name"],
        "Native refreshed"
    );

    let (status, ack) = web.library_command(&session, "presets", "preset-web-first", json!({"action":"update","id":preset_id,"revision":first_preset["revision"],"options":options("Web look")}));
    assert_eq!(status, 200, "{ack}");
    assert!(
        native
            .update_preset(&preset_id, |preset| preset.name = "Stale draft".into())
            .is_err()
    );
    assert_eq!(native.preset(&preset_id).unwrap().name, "Native look");
    native.refresh().unwrap();
    assert_eq!(native.preset(&preset_id).unwrap().name, "Web look");
    let stale_preset = web.library_item(&session, "presets", &preset_id);
    native
        .update_preset(&preset_id, |preset| {
            preset.name = "Native refreshed look".into()
        })
        .unwrap();
    let preset_file = preset_root.join(format!("{preset_id}.json"));
    let preset_bytes = std::fs::read(&preset_file).unwrap();
    let (status, refused) = web.library_command(&session, "presets", "preset-web-stale", json!({"action":"update","id":preset_id,"revision":stale_preset["revision"],"options":options("Must not write")}));
    assert_eq!(status, 409, "{refused}");
    assert_eq!(std::fs::read(&preset_file).unwrap(), preset_bytes);

    let (status, folders) = web.request("GET", &folders_path, None);
    assert_eq!(status, 200);
    let (status, ack) = web.library_command(&session, "native-assets", "folder-web-rename", json!({"action":"rename_folder","id":folder,"folders_revision":folders["folders_revision"],"name":"Web child"}));
    assert_eq!(status, 200, "{ack}");
    assert!(native.rename_folder(&folder, "Stale child".into()).is_err());
    assert_eq!(native.folder(&folder).unwrap().name, "Child");
    native.refresh().unwrap();
    assert_eq!(native.folder(&folder).unwrap().name, "Web child");
    native.remove_folder(&folder).unwrap();
    let folder_bytes = std::fs::read(shared.join("folders.json")).unwrap();
    let (status, refused) = web.library_command(&session, "native-assets", "folder-web-stale", json!({"action":"rename_folder","id":parent,"folders_revision":folders["folders_revision"],"name":"Must not write"}));
    assert_eq!(status, 409, "{refused}");
    assert_eq!(
        std::fs::read(shared.join("folders.json")).unwrap(),
        folder_bytes
    );
    let moved = web.library_item(&session, "native-assets", &asset_id);
    assert_eq!(moved["folder"], parent);
    assert_eq!(native.assets[0].payload.to_text(), original_payload);

    for (catalog, kind, directory, id) in [
        ("native-assets", Kind::Assets, &shared, &asset_id),
        ("presets", Kind::Presets, &preset_root, &preset_id),
    ] {
        let before = web.library_item(&session, catalog, id);
        let file = if catalog == "native-assets" {
            shared.join(format!("assets/{id}.json"))
        } else {
            preset_root.join(format!("{id}.json"))
        };
        let bytes = std::fs::read(&file).unwrap();
        for exclusive in [false, true] {
            let guard = if exclusive {
                Guard::write(directory, kind)
            } else {
                Guard::snapshot(directory, kind)
            }
            .unwrap();
            let (status, listed) = web.request("GET", &item_path(catalog, id), None);
            assert_eq!(status, if exclusive { 409 } else { 200 }, "{listed}");
            let edit = if catalog == "native-assets" {
                json!({"action":"update","id":id,"revision":before["revision"],"name":"Blocked"})
            } else {
                json!({"action":"update","id":id,"revision":before["revision"],"options":options("Blocked")})
            };
            let (status, refused) = web.library_command(
                &session,
                catalog,
                &format!("lock-{catalog}-{exclusive}"),
                edit,
            );
            assert_eq!(status, 409, "{refused}");
            assert_eq!(refused["error"]["code"], "LIBRARY_BUSY");
            assert_eq!(std::fs::read(&file).unwrap(), bytes);
            drop(guard);
        }
        let mut writer = Guard::write(directory, kind).unwrap();
        let paths = if catalog == "native-assets" {
            vec![format!("assets/{asset_id}.json"), "folders.json".into()]
        } else {
            vec![format!("{preset_id}.json"), format!("{peer_id}.json")]
        };
        let mut targets = Vec::new();
        let mut originals = Vec::new();
        for path in paths {
            let record = writer.read(&path).unwrap().unwrap();
            let mut after: serde_json::Value = serde_json::from_str(&record.bytes).unwrap();
            if path == "folders.json" {
                after["folders"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|entry| entry["id"] == parent)
                    .unwrap()["name"] = json!("Recovered parent");
            } else {
                after["name"] = json!("Recovered native record");
            }
            originals.push((directory.join(&path), record.bytes.clone()));
            targets.push(Target {
                path,
                before: Some(record),
                after: Some(serde_json::to_string_pretty(&after).unwrap()),
            });
        }
        writer.fail_after_intent_for_test();
        assert!(
            writer
                .commit(targets)
                .unwrap_err()
                .contains("durable native library intent")
        );
        drop(writer);
        let marker = directory.join(if catalog == "native-assets" {
            ".venturi-native-assets-pending.json"
        } else {
            ".venturi-native-presets-pending.json"
        });
        let pending = std::fs::read(&marker).unwrap();
        let (status, refused) = web.request("GET", &item_path(catalog, id), None);
        assert_eq!(status, 409, "{refused}");
        assert_eq!(
            refused["error"]["code"],
            if catalog == "native-assets" {
                "LIBRARY_BUSY"
            } else {
                "LIBRARY_RECOVERY_REQUIRED"
            }
        );
        let edit = if catalog == "native-assets" {
            json!({"action":"update","id":id,"revision":before["revision"],"name":"Blocked pending"})
        } else {
            json!({"action":"update","id":id,"revision":before["revision"],"options":options("Blocked pending")})
        };
        assert_eq!(
            web.library_command(&session, catalog, &format!("pending-{catalog}"), edit)
                .0,
            409
        );
        for (path, bytes) in &originals {
            assert_eq!(std::fs::read(path).unwrap(), bytes.as_bytes());
        }
        assert_eq!(std::fs::read(&marker).unwrap(), pending);
        native.refresh().unwrap();
        assert!(!marker.exists());
        let recovered = web.library_item(&session, catalog, id);
        assert_eq!(recovered["name"], "Recovered native record");
        assert_ne!(recovered["revision"], before["revision"]);
        if catalog == "native-assets" {
            assert_eq!(native.folder(&parent).unwrap().name, "Recovered parent");
            assert_eq!(native.assets[0].payload.to_text(), original_payload);
        } else {
            assert_eq!(
                native.preset(&peer_id).unwrap().name,
                "Recovered native record"
            );
        }
    }
    audio.refresh().unwrap();
    assert_eq!(
        audio.bank::<Equalizer>().resolve("Voice").unwrap(),
        eq(-6.0)
    );
    assert_eq!(
        audio
            .bank::<MultibandCompressor>()
            .resolve("Voice")
            .unwrap(),
        MultibandCompressor::DEFAULT
    );
    assert_eq!(
        std::fs::read(preset_root.join(AUDIO_PRESET_FILE)).unwrap(),
        audio_bytes
    );
    assert_eq!(web.request("GET", "/api/v1/session", None), (200, session));
    assert_eq!(
        serde_json::to_value(&source.project).unwrap(),
        source_before
    );
    assert_eq!(std::fs::read(settings_path).unwrap(), settings_bytes);
    assert_eq!(settings.audio_preset_values(), legacy);
    eprintln!(
        "Native/Web full-catalog interop passed at {} with {}",
        shared.display(),
        binary.display()
    );
    let owned_root = web.root.clone();
    drop((native, audio));
    drop(web);
    assert!(!owned_root.exists());
}

#[test]
fn shared_audio_presets_use_the_web_schema_kind_scoping_exact_noops_and_restart() {
    let root = root("schema");
    let mut library = AudioPresetLibrary::open(root.clone(), empty());
    assert!(library.error().is_none());
    library.bank().save("Voice", &eq(-6.0)).unwrap();
    let mut comp = MultibandCompressor::DEFAULT;
    comp.bands[1].ratio = 5.0;
    library.bank().save("Voice", &comp).unwrap();
    let before = Guard::snapshot(&root, Kind::AudioPresets)
        .unwrap()
        .read(AUDIO_PRESET_FILE)
        .unwrap();
    library.bank().save("Voice", &eq(-6.0)).unwrap();
    assert_eq!(
        Guard::snapshot(&root, Kind::AudioPresets)
            .unwrap()
            .read(AUDIO_PRESET_FILE)
            .unwrap(),
        before
    );
    let raw: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join(AUDIO_PRESET_FILE)).unwrap()).unwrap();
    assert_eq!(raw.as_object().unwrap().len(), 2);
    assert_eq!(raw["eq_presets"][0]["name"], "Voice");
    let native = crate::settings::Settings::load(&root.join(AUDIO_PRESET_FILE));
    assert_eq!(native.eq_presets[0].params, eq(-6.0));
    assert_eq!(native.compressor_presets[0].params, comp);
    library
        .bank::<MultibandCompressor>()
        .delete("Voice")
        .unwrap();
    assert_eq!(
        library.bank::<Equalizer>().resolve("Voice").unwrap(),
        eq(-6.0)
    );
    let mut reopened = AudioPresetLibrary::open(root.clone(), empty());
    assert_eq!(
        reopened.bank::<Equalizer>().resolve("Voice").unwrap(),
        eq(-6.0)
    );
    assert!(reopened.bank::<MultibandCompressor>().entries().is_empty());
    assert!(!root.join(crate::library::io::AUDIO_PRESET_PENDING).exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn shared_audio_presets_refuse_stale_apply_save_delete_and_busy_then_refresh_without_losing_cache()
{
    let root = root("cas");
    let mut first = AudioPresetLibrary::open(root.clone(), empty());
    first.bank().save("Voice", &eq(-6.0)).unwrap();
    let mut second = AudioPresetLibrary::open(root.clone(), empty());
    first.bank().save("Voice", &eq(-7.0)).unwrap();
    first.bank().save("Peer", &eq(2.0)).unwrap();
    let before = std::fs::read(root.join(AUDIO_PRESET_FILE)).unwrap();
    assert!(second.bank::<Equalizer>().resolve("Voice").is_err());
    assert!(second.bank().save("Draft", &eq(3.0)).is_err());
    assert!(second.bank::<Equalizer>().delete("Voice").is_err());
    assert_eq!(second.bank::<Equalizer>().entries()[0].params, eq(-6.0));
    assert_eq!(std::fs::read(root.join(AUDIO_PRESET_FILE)).unwrap(), before);
    let guard = Guard::write(&root, Kind::AudioPresets).unwrap();
    assert!(second.refresh().is_err());
    assert_eq!(second.bank::<Equalizer>().entries()[0].params, eq(-6.0));
    drop(guard);
    second.refresh().unwrap();
    assert!(second.error().is_none());
    assert_eq!(
        second.bank::<Equalizer>().resolve("Voice").unwrap(),
        eq(-7.0)
    );
    second.bank().save("Draft", &eq(3.0)).unwrap();
    assert!(
        second
            .bank::<Equalizer>()
            .entries()
            .iter()
            .any(|entry| entry.name == "Peer")
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn shared_audio_presets_seed_only_absent_files_and_explicit_legacy_merge_refuses_all_conflicts() {
    let root = root("migration");
    let legacy = json!({"eq_presets":[{"name":"Voice","params":eq(-6.0)}],"compressor_presets":[]});
    let mut first = AudioPresetLibrary::open(root.clone(), legacy.clone());
    assert!(first.error().is_none());
    assert_eq!(
        first.bank::<Equalizer>().resolve("Voice").unwrap(),
        eq(-6.0)
    );
    first.bank().save("Voice", &eq(-7.0)).unwrap();
    let before = std::fs::read(root.join(AUDIO_PRESET_FILE)).unwrap();
    let incoming = json!({"eq_presets":[{"name":"Unmerged","params":eq(1.0)},
        {"name":"Voice","params":eq(-6.0)}],"compressor_presets":[]});
    let mut second = AudioPresetLibrary::open(root.clone(), incoming);
    assert_eq!(
        std::fs::read(root.join(AUDIO_PRESET_FILE)).unwrap(),
        before,
        "Opening an existing shared catalog never imports over it"
    );
    assert!(second.import_legacy().unwrap_err().contains("conflicts"));
    assert_eq!(second.bank::<Equalizer>().entries().len(), 1);
    assert_eq!(std::fs::read(root.join(AUDIO_PRESET_FILE)).unwrap(), before);
    let compatible = json!({"eq_presets":[{"name":"Voice","params":eq(-7.0)},
        {"name":"Legacy","params":eq(1.0)}],"compressor_presets":[]});
    let mut third = AudioPresetLibrary::open(root.clone(), compatible);
    third.import_legacy().unwrap();
    let imported = Guard::snapshot(&root, Kind::AudioPresets)
        .unwrap()
        .read(AUDIO_PRESET_FILE)
        .unwrap();
    third.import_legacy().unwrap();
    assert_eq!(
        Guard::snapshot(&root, Kind::AudioPresets)
            .unwrap()
            .read(AUDIO_PRESET_FILE)
            .unwrap(),
        imported
    );
    assert_eq!(
        third.bank::<Equalizer>().resolve("Legacy").unwrap(),
        eq(1.0)
    );
    third.bank::<Equalizer>().delete("Voice").unwrap();
    third.bank::<Equalizer>().delete("Legacy").unwrap();
    let emptied = std::fs::read(root.join(AUDIO_PRESET_FILE)).unwrap();
    let mut reopened = AudioPresetLibrary::open(root.clone(), legacy.clone());
    assert!(
        reopened.bank::<Equalizer>().entries().is_empty(),
        "Deleting the last preset never resurrects local legacy on restart"
    );
    assert_eq!(
        std::fs::read(root.join(AUDIO_PRESET_FILE)).unwrap(),
        emptied
    );
    assert_eq!(legacy["eq_presets"][0]["params"], json!(eq(-6.0)));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn shared_audio_presets_explicit_empty_start_preserves_legacy_through_save_restart_and_absent_cas()
{
    let root = root("empty-recovery");
    let settings_path = root.join("settings.json");
    let raw = json!({"eq_presets":[{"name":"Old","params":{"bands":3},"legacy_note":"Keep"}],"compressor_presets":[]});
    std::fs::write(&settings_path, serde_json::to_vec(&raw).unwrap()).unwrap();
    let settings = crate::settings::Settings::load(&settings_path);
    let shared = root.join("presets");
    let mut library = AudioPresetLibrary::open(shared.clone(), settings.audio_preset_values());
    assert!(library.error().is_some());
    assert!(library.legacy_error().is_some());
    assert!(library.can_start_empty());
    assert!(library.refresh().is_err());
    assert!(library.can_start_empty());
    library.start_empty().unwrap();
    assert!(!library.can_start_empty());
    assert!(library.error().is_none());
    assert!(
        library.legacy_error().is_some(),
        "Starting an empty catalog does not discard the legacy warning"
    );
    library.bank().save("Current", &eq(-3.0)).unwrap();
    let bytes = std::fs::read(shared.join(AUDIO_PRESET_FILE)).unwrap();
    settings.save(&settings_path).unwrap();
    let restored_settings = crate::settings::Settings::load(&settings_path);
    assert_eq!(restored_settings.audio_preset_values(), raw);
    let mut reopened =
        AudioPresetLibrary::open(shared.clone(), restored_settings.audio_preset_values());
    assert_eq!(
        reopened.bank::<Equalizer>().resolve("Current").unwrap(),
        eq(-3.0)
    );
    reopened.refresh().unwrap();
    assert!(reopened.legacy_error().is_some());
    assert!(!reopened.can_start_empty());
    assert!(reopened.start_empty().is_err());
    assert_eq!(
        std::fs::read(shared.join(AUDIO_PRESET_FILE)).unwrap(),
        bytes
    );

    let other = root.join("stale-absent");
    let mut stale = AudioPresetLibrary::open(other.clone(), raw.clone());
    assert!(stale.can_start_empty());
    let mut peer = AudioPresetLibrary::open(other.clone(), empty());
    peer.bank().save("Peer", &eq(2.0)).unwrap();
    let peer_bytes = std::fs::read(other.join(AUDIO_PRESET_FILE)).unwrap();
    assert!(
        stale.start_empty().is_err(),
        "A file created since the absent snapshot cannot be overwritten"
    );
    assert_eq!(
        std::fs::read(other.join(AUDIO_PRESET_FILE)).unwrap(),
        peer_bytes
    );
    stale.refresh().unwrap();
    assert!(!stale.can_start_empty());
    assert_eq!(stale.bank::<Equalizer>().resolve("Peer").unwrap(), eq(2.0));
    assert!(stale.legacy_error().is_some());
    assert_eq!(restored_settings.audio_preset_values(), raw);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn shared_audio_presets_validate_before_publication_and_preserve_invalid_legacy_and_foreign_data() {
    let root = root("invalid");
    let invalid_legacy =
        json!({"eq_presets":[{"name":"Old","params":{"bands":3}}],"compressor_presets":[]});
    let failed = AudioPresetLibrary::open(root.clone(), invalid_legacy.clone());
    assert!(failed.error().is_some());
    assert!(!root.join(AUDIO_PRESET_FILE).exists());
    let mut library = AudioPresetLibrary::open(root.clone(), empty());
    library.bank().save("Voice", &eq(-6.0)).unwrap();
    let before = std::fs::read(root.join(AUDIO_PRESET_FILE)).unwrap();
    for name in ["", " untrimmed", "line\nbreak", &"a".repeat(257)] {
        assert!(library.bank().save(name, &eq(1.0)).is_err());
    }
    assert!(library.bank().save("NaN", &eq(f32::NAN)).is_err());
    let mut comp = MultibandCompressor::DEFAULT;
    comp.crossovers_hz = [1000.0, 1000.0];
    assert!(library.bank().save("Bad", &comp).is_err());
    let mut other = AudioPresetLibrary::open(root.clone(), invalid_legacy.clone());
    assert!(
        other.error().is_none(),
        "Invalid local legacy cannot disable a valid shared catalog"
    );
    assert!(other.import_legacy().is_err());
    assert_eq!(std::fs::read(root.join(AUDIO_PRESET_FILE)).unwrap(), before);
    let too_many = json!({"eq_presets":(0..257).map(|i|json!({"name":format!("P{i}"),"params":eq(0.0)})).collect::<Vec<_>>(),"compressor_presets":[]});
    assert!(Catalog::parse(&serde_json::to_vec(&too_many).unwrap()).is_err());
    assert!(Catalog::parse(&vec![b' '; MAX_AUDIO_PRESET_BYTES + 1]).is_err());
    std::fs::write(root.join(AUDIO_PRESET_FILE), b"foreign invalid").unwrap();
    assert!(library.refresh().is_err());
    assert_eq!(library.bank::<Equalizer>().entries()[0].params, eq(-6.0));
    assert!(library.bank().save("No overwrite", &eq(0.0)).is_err());
    assert_eq!(
        std::fs::read(root.join(AUDIO_PRESET_FILE)).unwrap(),
        b"foreign invalid"
    );
    assert_eq!(invalid_legacy["eq_presets"][0]["params"]["bands"], 3);
    std::fs::remove_dir_all(root).unwrap();
}
