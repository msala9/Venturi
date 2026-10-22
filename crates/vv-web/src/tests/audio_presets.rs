use super::*;
use vv_core as core;

struct Fixture {
    root: PathBuf,
    store: Store,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("vv-audio-presets-{}", crate::asset_jobs::nonce()));
        let store = Store::new(&root).unwrap();
        Self { root, store }
    }
    fn revision(&self) -> String {
        self.store.list().unwrap()["revision"]
            .as_str()
            .unwrap()
            .into()
    }
    fn save(&self, name: &str, parameters: AudioEffectKind) {
        self.store
            .edit(&Edit::Save {
                name: name.into(),
                revision: self.revision(),
                parameters,
            })
            .unwrap();
    }
    fn bytes(&self) -> Vec<u8> {
        std::fs::read(self.root.join(FILE_NAME)).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn eq(gain: f32) -> AudioEffectKind {
    let mut params = core::Equalizer::DEFAULT;
    params.bands[2].gain_db = gain;
    AudioEffectKind::Equalizer(params)
}
fn compressor(ratio: f32) -> AudioEffectKind {
    let mut params = core::MultibandCompressor::DEFAULT;
    params.bands[1].ratio = ratio;
    AudioEffectKind::MultibandCompressor(params)
}

#[test]
fn native_audio_preset_lifecycle_preserves_order_kind_scoped_names_and_restart() {
    let fixture = Fixture::new();
    std::fs::write(
        fixture.root.join("settings.json"),
        b"native desktop settings preserved",
    )
    .unwrap();
    assert_eq!(fixture.revision(), format!("{:x}", Sha256::digest([])));
    assert!(!fixture.root.join(FILE_NAME).exists());
    fixture.save("  Mine / α  ", eq(-4.0));
    fixture.save("Second", eq(2.0));
    fixture.save("Mine / α", compressor(5.0));
    fixture.save("Mine / α", eq(3.0));
    let list = fixture.store.list().unwrap();
    assert_eq!(list["eq_presets"][0]["name"], "Mine / α");
    assert_eq!(list["eq_presets"][1]["name"], "Second");
    assert_eq!(list["compressor_presets"][0]["name"], "Mine / α");
    let revision = fixture.revision();
    assert_eq!(
        fixture
            .store
            .resolve(Kind::Equalizer, "Mine / α", &revision)
            .unwrap(),
        eq(3.0)
    );
    assert_eq!(
        fixture
            .store
            .resolve(Kind::MultibandCompressor, "Mine / α", &revision)
            .unwrap(),
        compressor(5.0)
    );
    let bytes = fixture.bytes();
    let serialized: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(serialized.as_object().unwrap().len(), 2);
    assert_eq!(serialized["eq_presets"][0].as_object().unwrap().len(), 2);
    let raw: NativeFile = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        AudioEffectKind::Equalizer(raw.eq_presets[0].params.clone()),
        eq(3.0)
    );
    let identity =
        crate::asset_store::stable_identity(&File::open(fixture.root.join(FILE_NAME)).unwrap())
            .unwrap();
    fixture.save(" Mine / α ", eq(3.0));
    assert_eq!(fixture.bytes(), bytes);
    assert_eq!(fixture.revision(), revision);
    assert_eq!(
        crate::asset_store::stable_identity(&File::open(fixture.root.join(FILE_NAME)).unwrap())
            .unwrap(),
        identity
    );
    fixture
        .store
        .edit(&Edit::Delete {
            kind: Kind::Equalizer,
            name: "Mine / α".into(),
            revision,
        })
        .unwrap();
    let after = fixture.store.list().unwrap();
    assert_eq!(after["eq_presets"].as_array().unwrap().len(), 1);
    assert_eq!(after["eq_presets"][0]["name"], "Second");
    assert_eq!(after["compressor_presets"], list["compressor_presets"]);
    let reopened = Store::new(&fixture.root).unwrap();
    assert_eq!(reopened.list().unwrap(), after);
    let missing = reopened
        .resolve(
            Kind::Equalizer,
            "Mine / α",
            after["revision"].as_str().unwrap(),
        )
        .unwrap_err();
    assert_eq!(missing.0, axum::http::StatusCode::NOT_FOUND);
    assert!(
        reopened
            .resolve(
                Kind::Equalizer,
                "second",
                after["revision"].as_str().unwrap()
            )
            .is_err()
    );
    assert_eq!(
        std::fs::read(fixture.root.join("settings.json")).unwrap(),
        b"native desktop settings preserved"
    );
}

#[test]
fn audio_preset_stale_cas_and_final_source_witness_preserve_foreign_metadata() {
    let fixture = Fixture::new();
    let another = Store::new(&fixture.root).unwrap();
    let old = fixture.revision();
    fixture.save("First", eq(1.0));
    let before = fixture.bytes();
    assert_eq!(
        another
            .edit(&Edit::Save {
                name: "Lost update".into(),
                revision: old.clone(),
                parameters: eq(2.0)
            })
            .unwrap_err()
            .1,
        "AUDIO_PRESETS_CHANGED"
    );
    assert_eq!(
        another
            .resolve(Kind::Equalizer, "First", &old)
            .unwrap_err()
            .1,
        "AUDIO_PRESETS_CHANGED"
    );
    assert_eq!(fixture.bytes(), before);
    let lock = fixture.store.lock(true).unwrap();
    let expected = fixture.store.raw().unwrap();
    let path = fixture.root.join(FILE_NAME);
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    let mut foreign = before.clone();
    foreign[0] = b'!';
    std::fs::write(&path, &foreign).unwrap();
    File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert_eq!(
        fixture
            .store
            .publish(&before, &expected, &lock)
            .unwrap_err()
            .1,
        "AUDIO_PRESETS_CHANGED"
    );
    assert_eq!(fixture.bytes(), foreign);
    assert!(!std::fs::read_dir(&fixture.root).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")
    }));
}

#[test]
fn audio_preset_busy_or_replaced_lock_refuses_without_mutation() {
    let fixture = Fixture::new();
    fixture.save("Original", eq(0.0));
    let before = fixture.bytes();
    let revision = fixture.revision();
    let held = fixture.store.lock(true).unwrap();
    let another = Store::new(&fixture.root).unwrap();
    assert_eq!(another.list().unwrap_err().1, "AUDIO_PRESETS_BUSY");
    assert_eq!(
        another
            .edit(&Edit::Delete {
                kind: Kind::Equalizer,
                name: "Original".into(),
                revision
            })
            .unwrap_err()
            .1,
        "AUDIO_PRESETS_BUSY"
    );
    let expected = fixture.store.raw().unwrap();
    std::fs::rename(fixture.root.join(LOCK_NAME), fixture.root.join("old-lock")).unwrap();
    std::fs::write(fixture.root.join(LOCK_NAME), b"foreign lock").unwrap();
    assert_eq!(
        fixture
            .store
            .publish(&before, &expected, &held)
            .unwrap_err()
            .1,
        "AUDIO_PRESETS_CHANGED"
    );
    assert_eq!(fixture.bytes(), before);
    assert_eq!(
        std::fs::read(fixture.root.join(LOCK_NAME)).unwrap(),
        b"foreign lock"
    );
}

#[test]
fn native_audio_preset_pending_entries_block_reads_and_edits_without_touching_any_file() {
    use std::os::unix::fs::PermissionsExt;
    for shape in [
        "malformed",
        "unreadable",
        "directory",
        "dangling_link",
        "foreign_link",
    ] {
        let fixture = Fixture::new();
        fixture.save("Original", eq(1.0));
        let revision = fixture.revision();
        let before = fixture.bytes();
        let marker = fixture.root.join(NATIVE_PENDING);
        let foreign = fixture.root.join("foreign-native.json");
        std::fs::write(&foreign, b"unrelated native data").unwrap();
        match shape {
            "directory" => std::fs::create_dir(&marker).unwrap(),
            "dangling_link" => {
                std::os::unix::fs::symlink("missing-native-transaction", &marker).unwrap()
            }
            "foreign_link" => std::os::unix::fs::symlink(&foreign, &marker).unwrap(),
            _ => std::fs::write(&marker, b"malformed pending transaction").unwrap(),
        }
        if shape == "unreadable" {
            std::fs::set_permissions(&marker, std::fs::Permissions::from_mode(0o0)).unwrap();
        }
        let witness = std::fs::symlink_metadata(&marker).unwrap();
        let entries = std::fs::read_dir(&fixture.root).unwrap().count();
        let errors = [
            fixture.store.list().unwrap_err(),
            fixture
                .store
                .resolve(Kind::Equalizer, "Original", &revision)
                .unwrap_err(),
            fixture
                .store
                .edit(&Edit::Save {
                    name: "New".into(),
                    revision: revision.clone(),
                    parameters: eq(2.0),
                })
                .unwrap_err(),
            fixture
                .store
                .edit(&Edit::Delete {
                    kind: Kind::Equalizer,
                    name: "Original".into(),
                    revision: revision.clone(),
                })
                .unwrap_err(),
        ];
        for error in errors {
            assert_eq!(error.0, axum::http::StatusCode::CONFLICT, "{shape}");
            assert_eq!(error.1, "LIBRARY_RECOVERY_REQUIRED", "{shape}");
            assert!(error.2.contains("desktop library"));
        }
        let retained = std::fs::symlink_metadata(&marker).unwrap();
        assert_eq!(retained.ino(), witness.ino());
        assert_eq!(retained.file_type(), witness.file_type());
        assert_eq!(retained.permissions().mode(), witness.permissions().mode());
        assert_eq!(fixture.bytes(), before);
        assert_eq!(std::fs::read(&foreign).unwrap(), b"unrelated native data");
        assert_eq!(std::fs::read_dir(&fixture.root).unwrap().count(), entries);
        match shape {
            "directory" => assert_eq!(std::fs::read_dir(&marker).unwrap().count(), 0),
            "dangling_link" => assert_eq!(
                std::fs::read_link(&marker).unwrap(),
                PathBuf::from("missing-native-transaction")
            ),
            "foreign_link" => assert_eq!(std::fs::read_link(&marker).unwrap(), foreign),
            _ => {
                std::fs::set_permissions(&marker, std::fs::Permissions::from_mode(0o600)).unwrap();
                assert_eq!(
                    std::fs::read(&marker).unwrap(),
                    b"malformed pending transaction"
                );
            }
        }
    }
}

#[test]
fn native_audio_preset_recovery_releases_failed_locks_and_rereads_the_recovered_revision() {
    let fixture = Fixture::new();
    fixture.save("Original", eq(1.0));
    let revision = fixture.revision();
    let before = fixture.bytes();
    let lock = fixture.store.lock(true).unwrap();
    let raw = fixture.store.raw().unwrap();
    let marker = fixture.root.join(NATIVE_PENDING);
    std::fs::write(&marker, b"desktop recovery owns this transaction").unwrap();
    assert_eq!(
        fixture.store.publish(&before, &raw, &lock).unwrap_err().1,
        "LIBRARY_RECOVERY_REQUIRED"
    );
    assert_eq!(fixture.bytes(), before);
    drop(lock);
    assert_eq!(
        fixture.store.list().unwrap_err().1,
        "LIBRARY_RECOVERY_REQUIRED"
    );
    let mut recovered: NativeFile = serde_json::from_slice(&before).unwrap();
    recovered.eq_presets.push(Preset {
        name: "Recovered".into(),
        params: core::Equalizer::DEFAULT,
    });
    let recovered_bytes = serde_json::to_vec_pretty(&recovered).unwrap();
    std::fs::write(fixture.root.join(FILE_NAME), &recovered_bytes).unwrap();
    std::fs::remove_file(marker).unwrap();
    let catalog = fixture.store.list().unwrap();
    let current = catalog["revision"].as_str().unwrap();
    assert_eq!(current, format!("{:x}", Sha256::digest(&recovered_bytes)));
    assert_ne!(current, revision);
    assert_eq!(
        fixture
            .store
            .resolve(Kind::Equalizer, "Recovered", current)
            .unwrap(),
        eq(0.0)
    );
    assert_eq!(
        fixture
            .store
            .edit(&Edit::Delete {
                kind: Kind::Equalizer,
                name: "Recovered".into(),
                revision
            })
            .unwrap_err()
            .1,
        "AUDIO_PRESETS_CHANGED"
    );
    fixture
        .store
        .edit(&Edit::Delete {
            kind: Kind::Equalizer,
            name: "Recovered".into(),
            revision: current.into(),
        })
        .unwrap();
    assert_eq!(
        fixture.store.list().unwrap()["eq_presets"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn audio_preset_name_parameter_and_capacity_bounds_are_atomic() {
    let fixture = Fixture::new();
    fixture.save(&"é".repeat(128), eq(0.0));
    let revision = fixture.revision();
    let before = fixture.bytes();
    for name in [
        "".to_owned(),
        " \t ".into(),
        "bad\nname".into(),
        "é".repeat(129),
    ] {
        assert!(
            fixture
                .store
                .edit(&Edit::Save {
                    name,
                    revision: revision.clone(),
                    parameters: eq(1.0)
                })
                .is_err()
        );
    }
    for parameters in [
        AudioEffectKind::Mono,
        AudioEffectKind::Normalize {
            target_db: -1.0,
            mode: core::NormalizeMode::SamplePeak,
            set_level: core::SetLevel::Relative,
        },
        eq(f32::INFINITY),
        compressor(0.0),
    ] {
        assert!(
            fixture
                .store
                .edit(&Edit::Save {
                    name: "Invalid".into(),
                    revision: revision.clone(),
                    parameters
                })
                .is_err()
        );
    }
    assert!(
        fixture
            .store
            .edit(&Edit::Save {
                name: "Wrong revision".into(),
                revision: "0".repeat(63),
                parameters: eq(0.0)
            })
            .is_err()
    );
    assert_eq!(fixture.bytes(), before);
    let AudioEffectKind::Equalizer(params) = eq(0.0) else {
        unreachable!()
    };
    let data = NativeFile {
        eq_presets: (0..MAX_PRESETS)
            .map(|i| Preset {
                name: format!("Preset {i}"),
                params: params.clone(),
            })
            .collect(),
        compressor_presets: Vec::new(),
    };
    std::fs::write(
        fixture.root.join(FILE_NAME),
        serde_json::to_vec(&data).unwrap(),
    )
    .unwrap();
    let full = fixture.bytes();
    assert!(
        fixture
            .store
            .edit(&Edit::Save {
                name: "One too many".into(),
                revision: fixture.revision(),
                parameters: eq(1.0)
            })
            .is_err()
    );
    assert_eq!(fixture.bytes(), full);
    fixture.save("Preset 0", eq(2.0));
    fixture.save("Preset 0", compressor(2.0));
    let list = fixture.store.list().unwrap();
    assert_eq!(list["eq_presets"].as_array().unwrap().len(), MAX_PRESETS);
    assert_eq!(list["compressor_presets"].as_array().unwrap().len(), 1);
}

#[test]
fn audio_preset_corrupt_unknown_duplicate_and_unreadable_files_fail_closed() {
    let fixture = Fixture::new();
    fixture.save("Valid", eq(0.0));
    let valid: Value = serde_json::from_slice(&fixture.bytes()).unwrap();
    let mut duplicate = valid.clone();
    duplicate["eq_presets"]
        .as_array_mut()
        .unwrap()
        .push(valid["eq_presets"][0].clone());
    let mut unknown = valid.clone();
    unknown["foreign"] = json!(true);
    let mut invalid = valid.clone();
    invalid["eq_presets"][0]["params"]["bands"][0]["freq_hz"] = json!(-10.0);
    for value in [json!(null), json!({}), duplicate, unknown, invalid] {
        let bytes = serde_json::to_vec(&value).unwrap();
        std::fs::write(fixture.root.join(FILE_NAME), &bytes).unwrap();
        let revision = format!("{:x}", Sha256::digest(&bytes));
        assert!(fixture.store.list().is_err());
        assert!(
            fixture
                .store
                .resolve(Kind::Equalizer, "Valid", &revision)
                .is_err()
        );
        assert!(
            fixture
                .store
                .edit(&Edit::Save {
                    name: "No reset".into(),
                    revision,
                    parameters: eq(0.0)
                })
                .is_err()
        );
        assert_eq!(fixture.bytes(), bytes);
    }
    let path = fixture.root.join(FILE_NAME);
    std::fs::write(&path, serde_json::to_vec(&valid).unwrap()).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
    if File::open(&path).is_err() {
        assert!(fixture.store.list().is_err());
    }
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_len(MAX_BYTES + 1)
        .unwrap();
    assert!(fixture.store.list().is_err());
}

#[test]
fn audio_preset_links_and_foreign_temporary_replacements_are_preserved() {
    let fixture = Fixture::new();
    let foreign = fixture.root.join("foreign.json");
    std::fs::write(&foreign, b"foreign bytes").unwrap();
    std::os::unix::fs::symlink(&foreign, fixture.root.join(FILE_NAME)).unwrap();
    assert!(fixture.store.list().is_err());
    assert!(
        fixture
            .store
            .edit(&Edit::Save {
                name: "Do not overwrite".into(),
                revision: format!("{:x}", Sha256::digest([])),
                parameters: eq(0.0)
            })
            .is_err()
    );
    assert_eq!(std::fs::read(&foreign).unwrap(), b"foreign bytes");
    std::fs::remove_file(fixture.root.join(FILE_NAME)).unwrap();
    let temp = Temporary::new(&fixture.store.dir).unwrap();
    let path = fixture.root.join(&temp.name);
    std::fs::remove_file(&path).unwrap();
    std::fs::write(&path, b"foreign temporary replacement").unwrap();
    drop(temp);
    assert_eq!(
        std::fs::read(path).unwrap(),
        b"foreign temporary replacement"
    );
    std::fs::remove_file(fixture.root.join(LOCK_NAME)).unwrap();
    std::os::unix::fs::symlink(&foreign, fixture.root.join(LOCK_NAME)).unwrap();
    assert!(fixture.store.list().is_err());
    assert_eq!(std::fs::read(foreign).unwrap(), b"foreign bytes");
}

#[test]
fn audio_preset_replaced_root_and_unknown_edit_fields_are_refused() {
    let fixture = Fixture::new();
    fixture.save("Saved", eq(0.0));
    let before = fixture.bytes();
    let moved = fixture.root.with_extension("moved");
    std::fs::rename(&fixture.root, &moved).unwrap();
    std::fs::create_dir(&fixture.root).unwrap();
    assert_eq!(fixture.store.list().unwrap_err().1, "AUDIO_PRESETS_CHANGED");
    assert_eq!(std::fs::read(moved.join(FILE_NAME)).unwrap(), before);
    assert_eq!(std::fs::read_dir(&fixture.root).unwrap().count(), 0);
    assert!(serde_json::from_value::<Edit>(json!({"action":"delete","kind":"equalizer","name":"Saved","revision":"0".repeat(64),"extra":true})).is_err());
    assert!(
        serde_json::from_value::<Edit>(
            json!({"action":"delete","kind":"Equalizer","name":"Saved","revision":"0".repeat(64)})
        )
        .is_err()
    );
    std::fs::remove_dir_all(moved).unwrap();
}
