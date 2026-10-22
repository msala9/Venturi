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
