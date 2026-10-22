use super::*;

fn root(label: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "vv-native-library-coordination-{label}-{}",
        super::super::new_id()
    ));
    std::fs::create_dir_all(&root).unwrap();
    root
}

#[test]
fn native_library_locks_match_web_names_and_readers_do_not_observe_pending_transactions() {
    for kind in [Kind::Assets, Kind::Presets, Kind::AudioPresets] {
        let root = root("locks");
        let directory = Directory::open(&root, false).unwrap();
        let name = match kind {
            Kind::Assets => ".venturi-assets-catalog.lock",
            Kind::Presets => ".venturi-presets.lock",
            Kind::AudioPresets => ".venturi-audio-presets.lock",
        };
        let reader = directory.lock(name, true).unwrap();
        let other_reader = Guard::snapshot(&root, kind).unwrap();
        assert!(Guard::write(&root, kind).is_err());
        drop((reader, other_reader));
        let writer = Guard::write(&root, kind).unwrap();
        assert!(Guard::snapshot(&root, kind).is_err());
        drop(writer);
        if matches!(kind, Kind::Assets) {
            let global = directory.lock(".venturi-assets.lock", false).unwrap();
            assert!(Guard::write(&root, kind).is_err());
            drop(global);
            std::fs::write(root.join(".venturi-assets-pending.json"), b"not ours").unwrap();
            assert!(Guard::write(&root, kind).is_err());
            assert!(Guard::snapshot(&root, kind).is_err());
            assert_eq!(
                std::fs::read(root.join(".venturi-assets-pending.json")).unwrap(),
                b"not ours"
            );
        }
    }
}

#[test]
fn native_audio_presets_recover_the_single_shared_file_and_refuse_foreign_or_invalid_intent() {
    for applied in [false, true] {
        let root = root("audio-recovery");
        let guard = Guard::write(&root, Kind::AudioPresets).unwrap();
        let before = "{\"eq_presets\":[],\"compressor_presets\":[]}";
        let after = serde_json::to_string(&serde_json::json!({"eq_presets":[{
            "name":"Recovered", "params":vv_core::Equalizer::DEFAULT,
        }],"compressor_presets":[]}))
        .unwrap();
        guard
            .commit(vec![Target {
                path: AUDIO_PRESET_FILE.into(),
                before: None,
                after: Some(before.into()),
            }])
            .unwrap();
        let journal = Journal {
            version: 1,
            targets: vec![Target {
                path: AUDIO_PRESET_FILE.into(),
                before: guard.read(AUDIO_PRESET_FILE).unwrap(),
                after: Some(after.clone()),
            }],
        };
        guard
            .directory
            .atomic(
                AUDIO_PRESET_PENDING,
                &serde_json::to_vec(&journal).unwrap(),
                false,
            )
            .unwrap();
        if applied {
            guard
                .directory
                .atomic(AUDIO_PRESET_FILE, after.as_bytes(), true)
                .unwrap();
        }
        drop(guard);
        let recovered = Guard::snapshot(&root, Kind::AudioPresets).unwrap();
        assert_eq!(
            recovered.read(AUDIO_PRESET_FILE).unwrap().unwrap().bytes,
            after
        );
        assert!(!root.join(AUDIO_PRESET_PENDING).exists());
        assert!(
            recovered
                .commit(vec![Target {
                    path: "other.json".into(),
                    before: None,
                    after: Some("{}".into())
                }])
                .is_err()
        );
        assert!(
            recovered
                .commit(vec![Target {
                    path: AUDIO_PRESET_FILE.into(),
                    before: recovered.read(AUDIO_PRESET_FILE).unwrap(),
                    after: Some(" ".repeat(MAX_AUDIO_PRESET_BYTES + 1))
                }])
                .is_err()
        );
        drop(recovered);
        let writer = Guard::write(&root, Kind::AudioPresets).unwrap();
        let journal = Journal {
            version: 1,
            targets: vec![Target {
                path: AUDIO_PRESET_FILE.into(),
                before: writer.read(AUDIO_PRESET_FILE).unwrap(),
                after: Some(before.into()),
            }],
        };
        writer
            .directory
            .atomic(
                AUDIO_PRESET_PENDING,
                &serde_json::to_vec(&journal).unwrap(),
                false,
            )
            .unwrap();
        std::fs::write(root.join(AUDIO_PRESET_FILE), b"foreign").unwrap();
        drop(writer);
        assert!(Guard::snapshot(&root, Kind::AudioPresets).is_err());
        assert_eq!(
            std::fs::read(root.join(AUDIO_PRESET_FILE)).unwrap(),
            b"foreign"
        );
        assert!(root.join(AUDIO_PRESET_PENDING).exists());
        std::fs::remove_file(root.join(AUDIO_PRESET_PENDING)).unwrap();
        std::fs::write(root.join(AUDIO_PRESET_PENDING), b"malformed").unwrap();
        assert!(Guard::snapshot(&root, Kind::AudioPresets).is_err());
        assert_eq!(
            std::fs::read(root.join(AUDIO_PRESET_PENDING)).unwrap(),
            b"malformed"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn native_library_rollforward_checks_all_foreign_witnesses_before_finishing_a_partial_transaction()
{
    for conflict in [false, true] {
        let root = root("recovery");
        let guard = Guard::write(&root, Kind::Assets).unwrap();
        guard
            .commit(vec![
                Target {
                    path: "assets/a.json".into(),
                    before: None,
                    after: Some("{\"version\":1}".into()),
                },
                Target {
                    path: "folders.json".into(),
                    before: None,
                    after: Some("{\"version\":1,\"folders\":[]}".into()),
                },
            ])
            .unwrap();
        let journal = Journal {
            version: 1,
            targets: vec![
                Target {
                    path: "assets/a.json".into(),
                    before: guard.read("assets/a.json").unwrap(),
                    after: Some("{\"version\":1,\"name\":\"After\"}".into()),
                },
                Target {
                    path: "folders.json".into(),
                    before: guard.read("folders.json").unwrap(),
                    after: Some("{\"version\":1,\"folders\":[1]}".into()),
                },
            ],
        };
        guard
            .directory
            .atomic(ASSET_PENDING, &serde_json::to_vec(&journal).unwrap(), false)
            .unwrap();
        let (directory, name) = guard.target("assets/a.json").unwrap();
        directory
            .atomic(
                &name,
                journal.targets[0].after.as_ref().unwrap().as_bytes(),
                true,
            )
            .unwrap();
        if conflict {
            std::fs::write(root.join("folders.json"), b"foreign").unwrap();
        }
        drop(guard);
        let recovered = Guard::snapshot(&root, Kind::Assets);
        if conflict {
            assert!(recovered.is_err());
            assert!(root.join(ASSET_PENDING).exists());
            assert_eq!(
                std::fs::read(root.join("folders.json")).unwrap(),
                b"foreign"
            );
        } else {
            let recovered = recovered.unwrap();
            assert_eq!(
                recovered.read("assets/a.json").unwrap().unwrap().bytes,
                journal.targets[0].after.clone().unwrap()
            );
            assert_eq!(
                recovered.read("folders.json").unwrap().unwrap().bytes,
                journal.targets[1].after.clone().unwrap()
            );
            assert!(!root.join(ASSET_PENDING).exists());
        }
    }
}

#[test]
fn native_preset_recovery_preserves_multi_record_shortcut_results_and_refuses_malformed_markers() {
    let root = root("presets");
    let guard = Guard::write(&root, Kind::Presets).unwrap();
    let journal = Journal {
        version: 1,
        targets: vec![
            Target {
                path: "one.json".into(),
                before: None,
                after: Some("{\"shortcut\":null}".into()),
            },
            Target {
                path: "two.json".into(),
                before: None,
                after: Some("{\"shortcut\":\"Ctrl+A\"}".into()),
            },
        ],
    };
    guard
        .directory
        .atomic(
            PRESET_PENDING,
            &serde_json::to_vec(&journal).unwrap(),
            false,
        )
        .unwrap();
    guard
        .directory
        .atomic(
            "one.json",
            journal.targets[0].after.as_ref().unwrap().as_bytes(),
            false,
        )
        .unwrap();
    drop(guard);
    let recovered = Guard::write(&root, Kind::Presets).unwrap();
    assert_eq!(
        recovered.read("two.json").unwrap().unwrap().bytes,
        journal.targets[1].after.clone().unwrap()
    );
    assert!(!root.join(PRESET_PENDING).exists());
    drop(recovered);
    std::fs::write(root.join(PRESET_PENDING), b"invalid").unwrap();
    assert!(Guard::snapshot(&root, Kind::Presets).is_err());
    assert_eq!(
        std::fs::read(root.join(PRESET_PENDING)).unwrap(),
        b"invalid"
    );
}

#[test]
fn native_library_preflight_is_bounded_and_never_rewrites_a_stale_or_unsafe_target() {
    let root = root("preflight");
    let guard = Guard::write(&root, Kind::Assets).unwrap();
    guard
        .commit(vec![Target {
            path: "assets/a.json".into(),
            before: None,
            after: Some("before".into()),
        }])
        .unwrap();
    let before = guard.read("assets/a.json").unwrap();
    std::fs::write(root.join("assets/a.json"), b"changed").unwrap();
    assert!(
        guard
            .commit(vec![Target {
                path: "assets/a.json".into(),
                before,
                after: Some("after".into())
            }])
            .is_err()
    );
    assert!(!root.join(ASSET_PENDING).exists());
    assert_eq!(
        std::fs::read(root.join("assets/a.json")).unwrap(),
        b"changed"
    );
    for path in [
        "../escape.json",
        "assets/../escape.json",
        "media/file.json",
        "assets/.hidden.json",
    ] {
        assert!(
            guard
                .commit(vec![Target {
                    path: path.into(),
                    before: None,
                    after: Some("{}".into())
                }])
                .is_err()
        );
    }
    assert!(
        guard
            .commit(vec![Target {
                path: "assets/large.json".into(),
                before: None,
                after: Some("x".repeat(MAX_BYTES + 1))
            }])
            .is_err()
    );
    assert!(!root.join(ASSET_PENDING).exists());
    let stage = root.join(".venturi-native-library-staging");
    for i in 0..8 {
        std::fs::write(stage.join(format!(".venturi-native-orphan-{i}")), b"kept").unwrap();
    }
    assert!(
        guard
            .commit(vec![Target {
                path: "assets/full.json".into(),
                before: None,
                after: Some("{}".into())
            }])
            .is_err()
    );
    assert!(!root.join(ASSET_PENDING).exists());
    assert_eq!(std::fs::read_dir(stage).unwrap().count(), 8);
}

#[cfg(unix)]
#[test]
fn native_library_rejects_symlinked_lock_markers_directories_and_media_without_following_them() {
    use std::os::unix::fs::symlink;
    for case in 0..4 {
        let root = root("links");
        let outside = root.join("outside");
        std::fs::write(&outside, b"untouched").unwrap();
        match case {
            0 => symlink(&outside, root.join(".venturi-assets.lock")).unwrap(),
            1 => symlink(&outside, root.join(ASSET_PENDING)).unwrap(),
            2 => symlink(root.join("absent"), root.join("assets")).unwrap(),
            _ => {
                let media = root.join("media/0000000000000001");
                std::fs::create_dir_all(&media).unwrap();
                symlink(&outside, media.join("image.png")).unwrap();
                assert!(copy_media(&root, &outside, 1, "image.png").is_err());
                assert!(remove_media(&root, &media.join("image.png")).is_err());
                assert_eq!(std::fs::read(&outside).unwrap(), b"untouched");
                continue;
            }
        }
        let attempt = Guard::write(&root, Kind::Assets).and_then(|guard| guard.records(false));
        assert!(attempt.is_err());
        assert_eq!(std::fs::read(&outside).unwrap(), b"untouched");
    }
}
