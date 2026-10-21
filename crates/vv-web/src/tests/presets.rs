use super::*;
use vv_core::{
    Clip, ClipSource, Interpolation, Rational, Timeline, Track, TrackKind, TransformParam,
};

fn fixture() -> (Session, core::TimelineId, String, core::TimelineId, String) {
    let mut session = Session::default();
    let mut create = |fps, resolution, start, source_in, source_out| {
        let id = session.create_timeline(Timeline {
            name: "Preset test".into(),
            fps,
            resolution,
            tracks: vec![Track::new(TrackKind::Video)],
            markers: vec![],
            master: Default::default(),
        });
        let clip_id = session.project.alloc_clip_id();
        session.project.timelines[id].tracks[0].insert_sorted(Clip::from_source_range(
            clip_id,
            ClipSource::SolidColor,
            source_in,
            source_out,
            start,
            Rational::one(),
        ));
        (id, clip_id.0.to_string())
    };
    let (source, source_clip) = create(Rational::new(24, 1), (640, 360), 0, 0, 48);
    let (target, target_clip) = create(Rational::new(48, 1), (1280, 720), 100, 10, 154);
    let clip = &mut session.project.timelines[source].tracks[0].clips[0];
    clip.effects
        .transform
        .track_mut(TransformParam::ZoomX)
        .default = 2.0;
    clip.effects
        .transform
        .track_mut(TransformParam::PositionX)
        .default = 10.0;
    clip.effects
        .transform
        .track_mut(TransformParam::PositionY)
        .default = 20.0;
    clip.effects
        .transform
        .track_mut(TransformParam::Opacity)
        .upsert(0, 20.0, Interpolation::EaseIn);
    clip.effects
        .transform
        .track_mut(TransformParam::Opacity)
        .upsert(24, 80.0, Interpolation::Hold);
    clip.fade_in = 12;
    let mut blur = core::ClipFilter::new(core::FilterKind::BoxBlur);
    blur.radius.default = 3.0;
    clip.effects.filters.push(blur);
    session.project.timelines[target].tracks[0].clips[0]
        .effects
        .filters
        .push(core::ClipFilter::new(core::FilterKind::Exposure));
    (session, source, source_clip, target, target_clip)
}
fn options(anchor: KeyframeAnchor) -> Options {
    Options {
        name: "Native look α".into(),
        attributes: vec![
            Attribute::Position,
            Attribute::Zoom,
            Attribute::Opacity,
            Attribute::Fades,
            Attribute::Filters,
        ],
        anchor,
        append_filters: true,
        shortcut: None,
    }
}

#[test]
fn native_preset_converts_fps_resolution_and_all_anchors_as_one_undo() {
    for (anchor, frames) in [
        (KeyframeAnchor::Start, [10, 58]),
        (KeyframeAnchor::End, [58, 106]),
        (KeyframeAnchor::Stretch, [10, 82]),
    ] {
        let (mut session, source, source_clip, target, target_clip) = fixture();
        let before = serde_json::to_value(&session.project.timelines[target]).unwrap();
        let position = session.history.position();
        let mut preset = capture(&session, source, &[source_clip], &options(anchor)).unwrap();
        preset.video.as_mut().unwrap().id = session.project.timelines[target].tracks[0].clips[0].id;
        let wire = serde_json::to_value(&preset).unwrap();
        assert_eq!(wire["version"], 1);
        assert_eq!(wire["shortcut"], Value::Null);
        let preset: Preset = serde_json::from_value(wire).unwrap();
        apply(&mut session, target, &[target_clip], &preset).unwrap();
        assert_eq!(session.history.position(), position + 1);
        assert_eq!(
            session.history.labels().last().unwrap(),
            core::CommandLabel::ApplyPreset
        );
        let clip = &session.project.timelines[target].tracks[0].clips[0];
        assert_eq!(
            clip.effects
                .transform
                .track(TransformParam::PositionX)
                .default,
            20.0
        );
        assert_eq!(
            clip.effects
                .transform
                .track(TransformParam::PositionY)
                .default,
            40.0
        );
        assert_eq!(
            clip.effects.transform.track(TransformParam::ZoomX).default,
            2.0
        );
        assert_eq!(
            clip.effects
                .transform
                .track(TransformParam::Opacity)
                .keyframes(),
            &[
                (frames[0], 20.0, Interpolation::EaseIn),
                (frames[1], 80.0, Interpolation::Hold)
            ]
        );
        assert_eq!(clip.fade_in, 24);
        assert_eq!(
            clip.effects
                .filters
                .iter()
                .map(|filter| filter.kind)
                .collect::<Vec<_>>(),
            vec![core::FilterKind::Exposure, core::FilterKind::BoxBlur]
        );
        assert_eq!(clip.effects.filters[1].radius.default, 6.0);
        assert_eq!(
            (clip.timeline_start, clip.timeline_len, clip.source_in()),
            (100, 144, 10)
        );
        session.history.undo(&mut session.project);
        assert_eq!(
            serde_json::to_value(&session.project.timelines[target]).unwrap(),
            before
        );
    }
}

#[test]
fn invalid_presets_and_locked_targets_do_not_mutate_any_native_state() {
    let (mut session, source, source_clip, target, target_clip) = fixture();
    let preset = capture(
        &session,
        source,
        &[source_clip],
        &options(KeyframeAnchor::Start),
    )
    .unwrap();
    let mut invalid = Vec::new();
    let mut value = preset.clone();
    value.version = 2;
    invalid.push(value);
    let mut value = preset.clone();
    value.fps = Rational::new(0, 1);
    invalid.push(value);
    let mut value = preset.clone();
    value.fps = Rational::new(1, i32::MAX);
    invalid.push(value);
    let mut value = preset.clone();
    value.attributes.push(Attribute::Volume);
    invalid.push(value);
    let mut value = preset.clone();
    value
        .video
        .as_mut()
        .unwrap()
        .effects
        .transform
        .track_mut(TransformParam::PositionX)
        .default = f32::MAX;
    invalid.push(value);
    let mut value = serde_json::to_value(&preset).unwrap();
    value["video"]["rate"] = serde_json::json!({"num":i32::MAX,"den":1});
    invalid.push(serde_json::from_value(value).unwrap());
    let mut value = preset.clone();
    value.attributes.push(value.attributes[0]);
    invalid.push(value);
    let mut value = preset.clone();
    value.video.as_mut().unwrap().timeline_len = 0;
    invalid.push(value);
    let mut value = preset.clone();
    value
        .video
        .as_mut()
        .unwrap()
        .effects
        .transform
        .track_mut(TransformParam::Opacity)
        .upsert(i64::MIN, 42.0, Interpolation::Linear);
    invalid.push(value);
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    for preset in invalid {
        assert!(
            apply(
                &mut session,
                target,
                std::slice::from_ref(&target_clip),
                &preset
            )
            .is_err()
        );
    }
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), position);
    session.project.timelines[target].tracks[0].locked = true;
    let before = session.timeline_revision(target);
    assert_eq!(
        apply(&mut session, target, &[target_clip], &preset)
            .unwrap_err()
            .1,
        "TRACK_LOCKED"
    );
    assert_eq!(session.timeline_revision(target), before);
    assert_eq!(session.history.position(), position);
}

#[test]
fn capture_includes_linked_audio_and_chooses_earliest_video_without_history() {
    let (mut session, source, source_clip, _, _) = fixture();
    let group = session.project.alloc_link_group_id();
    session.project.timelines[source].tracks[0].clips[0].linked_group = Some(group);
    session.project.timelines[source].tracks[0].clips[0].timeline_start = 20;
    let early_id = session.project.alloc_clip_id();
    let mut earlier =
        Clip::from_source_range(early_id, ClipSource::SolidColor, 0, 10, 0, Rational::one());
    earlier
        .effects
        .transform
        .track_mut(TransformParam::ZoomX)
        .default = 3.0;
    session.project.timelines[source].tracks[0].insert_sorted(earlier);
    let id = session.project.alloc_clip_id();
    let mut audio = Clip::from_source_range(id, ClipSource::SolidColor, 0, 48, 20, Rational::one());
    audio.linked_group = Some(group);
    audio.effects.gain_db.default = -6.0;
    let timeline = &mut session.project.timelines[source];
    timeline.tracks.push(Track::new(TrackKind::Audio));
    timeline.tracks[1].insert_sorted(audio);
    let mut opts = options(KeyframeAnchor::Start);
    opts.attributes.push(Attribute::Volume);
    let before = session.timeline_revision(source);
    let position = session.history.position();
    let preset = capture(
        &session,
        source,
        &[source_clip, early_id.0.to_string()],
        &opts,
    )
    .unwrap();
    assert_eq!(preset.audio.unwrap().effects.gain_db.default, -6.0);
    assert_eq!(
        preset
            .video
            .unwrap()
            .effects
            .transform
            .track(TransformParam::ZoomX)
            .default,
        3.0
    );
    assert_eq!(session.timeline_revision(source), before);
    assert_eq!(session.history.position(), position);
}

#[test]
fn shortcut_metadata_rejects_incompatible_wire_types_without_changing_native_strings() {
    let (session, source, source_clip, _, _) = fixture();
    let mut preset = capture(
        &session,
        source,
        &[source_clip],
        &options(KeyframeAnchor::Start),
    )
    .unwrap();
    for value in [
        serde_json::json!({"ctrl":true}),
        serde_json::json!(true),
        serde_json::json!(12),
        serde_json::json!(""),
        serde_json::json!("Ctrl+\nS"),
    ] {
        preset.shortcut = Some(value);
        assert!(preset.validate().is_err());
    }
    preset.shortcut = Some(serde_json::json!("Ctrl+Alt+Shift+P"));
    preset.validate().unwrap();
    let decoded: Preset = serde_json::from_slice(&serde_json::to_vec(&preset).unwrap()).unwrap();
    assert_eq!(decoded.shortcut, preset.shortcut);
}

#[test]
fn shortcut_assignment_uses_native_aliases_modifier_order_and_complete_key_domain() {
    for (input, expected) in [
        ("Alt+Ctrl+Shift+KeyP", "Ctrl+Shift+Alt+P"),
        ("Ctrl++", "Ctrl+Plus"),
        ("Shift+Alt+Ctrl+NumpadAdd", "Ctrl+Shift+Alt+Plus"),
        ("Plus", "Plus"),
        ("Ctrl+⏷", "Ctrl+Down"),
        ("Alt+ArrowLeft", "Alt+Left"),
        ("Return", "Enter"),
        ("Ctrl+Help", "Ctrl+Insert"),
        (" ", "Space"),
        ("Ctrl+−", "Ctrl+Minus"),
        ("Ctrl+NumpadComma", "Ctrl+Comma"),
        ("Ctrl+NumpadDecimal", "Ctrl+Period"),
        ("Ctrl+NumpadDivide", "Ctrl+Slash"),
        ("Ctrl+NumpadEqual", "Ctrl+Equals"),
        ("BracketLeft", "OpenBracket"),
        ("Grave", "Backtick"),
        ("Ctrl+\\", "Ctrl+Backslash"),
        ("'", "Quote"),
        ("Ctrl+Digit7", "Ctrl+7"),
        ("Numpad0", "0"),
        ("p", "P"),
        ("OSLeft", "SuperLeft"),
        ("MetaRight", "SuperRight"),
        ("ControlLeft", "ControlLeft"),
        ("Shift+AltRight", "Shift+AltRight"),
        ("F35", "F35"),
        ("BrowserBack", "BrowserBack"),
        ("IntlBackslash", "IntlBackslash"),
    ] {
        assert_eq!(canonical_shortcut(input).unwrap(), expected, "{input}");
    }
    let catalog = shortcut_catalog();
    assert_eq!(catalog["version"], 1);
    assert_eq!(
        catalog["modifiers"],
        serde_json::json!(["Ctrl", "Shift", "Alt"])
    );
    let keys = catalog["keys"].as_array().unwrap();
    assert_eq!(keys.len(), 117);
    let mut unique = std::collections::HashSet::new();
    for key in keys {
        let key = key.as_str().unwrap();
        assert!(unique.insert(key));
        assert_eq!(canonical_shortcut(key).unwrap(), key);
        assert_eq!(
            canonical_shortcut(&format!("Alt+Shift+Ctrl+{key}")).unwrap(),
            format!("Ctrl+Shift+Alt+{key}")
        );
    }
}

#[test]
fn shortcut_assignment_rejects_unknown_duplicate_and_malformed_native_strings() {
    for value in [
        "",
        "+",
        "++",
        "Ctrl",
        "Ctrl+",
        "+P",
        "Ctrl+++",
        "Ctrl+Ctrl+P",
        "Alt+Shift+Alt+P",
        "ctrl+P",
        "Control+P",
        "Meta+P",
        "Command+P",
        "Ctrl+ P",
        " Ctrl+P",
        "Ctrl+P ",
        "Ctrl+A+B",
        "Num0",
        "F0",
        "F36",
        "F01",
        "Ctrl+\nP",
        "Vendor+FutureKey",
    ] {
        assert!(canonical_shortcut(value).is_err(), "{value:?}");
    }
    assert!(canonical_shortcut(&"A".repeat(129)).is_err());
}

#[test]
fn shortcut_options_have_explicit_strict_tristate_and_preserve_legacy_command_bytes() {
    let legacy = r#"{"name":"Look","attributes":["zoom"],"anchor":"start","append_filters":false}"#;
    let parsed: Options = serde_json::from_str(legacy).unwrap();
    assert!(parsed.shortcut.is_none());
    assert_eq!(serde_json::to_string(&parsed).unwrap(), legacy);
    let imported = serde_json::json!("Vendor+FutureKey");
    assert_eq!(
        parsed.shortcut_value(Some(&imported)).unwrap(),
        Some(imported)
    );
    assert_eq!(parsed.shortcut_value(None).unwrap(), None);
    for (edit, expected) in [
        (serde_json::json!({"action":"clear"}), None),
        (
            serde_json::json!({"action":"set","value":"Alt+Ctrl+Shift+KeyP"}),
            Some(serde_json::json!("Ctrl+Shift+Alt+P")),
        ),
    ] {
        let mut wire: Value = serde_json::from_str(legacy).unwrap();
        wire["shortcut"] = edit;
        let parsed: Options = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(parsed.shortcut_value(None).unwrap(), expected);
        assert_eq!(serde_json::to_value(parsed).unwrap(), wire);
    }
    for edit in [
        serde_json::json!(null),
        serde_json::json!("Ctrl+P"),
        serde_json::json!(true),
        serde_json::json!({"action":"set"}),
        serde_json::json!({"action":"set","value":1}),
        serde_json::json!({"action":"clear","value":"Ctrl+P"}),
        serde_json::json!({"action":"set","value":"Ctrl+P","extra":true}),
        serde_json::json!({"action":"keep"}),
    ] {
        let mut wire: Value = serde_json::from_str(legacy).unwrap();
        wire["shortcut"] = edit;
        assert!(
            serde_json::from_value::<Options>(wire.clone()).is_err(),
            "{wire}"
        );
    }
    for edit in [
        r#"{"action":"set","value":"P","value":"Q"}"#,
        r#"{"action":"set","action":"clear","value":"P"}"#,
    ] {
        let wire = format!("{},\"shortcut\":{edit}}}", &legacy[..legacy.len() - 1]);
        assert!(serde_json::from_str::<Options>(&wire).is_err(), "{wire}");
    }
}

#[test]
fn capture_sets_or_clears_shortcut_metadata_without_changing_project_or_history() {
    let (session, source, source_clip, _, _) = fixture();
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    let mut options = options(KeyframeAnchor::Start);
    let plain = capture(
        &session,
        source,
        std::slice::from_ref(&source_clip),
        &options,
    )
    .unwrap();
    assert_eq!(plain.shortcut, None);
    options.shortcut = Some(ShortcutEdit::Set {
        value: "Alt+Ctrl++".into(),
    });
    let assigned = capture(
        &session,
        source,
        std::slice::from_ref(&source_clip),
        &options,
    )
    .unwrap();
    assert_eq!(assigned.shortcut, Some(serde_json::json!("Ctrl+Alt+Plus")));
    let mut payload = serde_json::to_value(assigned).unwrap();
    payload["shortcut"] = Value::Null;
    assert_eq!(payload, serde_json::to_value(&plain).unwrap());
    options.shortcut = Some(ShortcutEdit::Clear);
    assert_eq!(
        capture(
            &session,
            source,
            std::slice::from_ref(&source_clip),
            &options
        )
        .unwrap()
        .shortcut,
        None
    );
    options.shortcut = Some(ShortcutEdit::Set {
        value: "Ctrl+Ctrl+P".into(),
    });
    assert!(capture(&session, source, &[source_clip], &options).is_err());
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), position);
}
