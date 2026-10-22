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
                .arg(server.root.join("presets"))
                .arg("--assets-root")
                .arg(server.root.join("assets"))
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
    let shared = web.root.join("presets");
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
