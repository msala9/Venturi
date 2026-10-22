use super::*;
use vv_core::{
    ClipId, Command, CommandLabel, Id, Interpolation, MediaItem, MediaMeta, Rational, Timeline,
    Track, TrackKind, TransformParam, clipboard::ClipboardEntry,
};

const ORIGIN: ClipboardOrigin = ClipboardOrigin {
    instance: 9_007_199_254_740_993,
    epoch: 7,
};

#[test]
fn clipboard_validation_accepts_multiple_roots_clip_entries_and_intentional_offline_references() {
    let (session, compound, timeline, file) = fixture();
    let entry = ClipboardEntry {
        track_kind: TrackKind::Video,
        track_number: 1,
        relative_start: 0,
        clip: session.project.timelines[timeline].tracks[0].clips[0].clone(),
        timeline_fps: Rational::new(24, 1),
        link_tag: Some(7),
    };
    validate_clipboard_capture(
        &session.project,
        &[compound, file],
        std::slice::from_ref(&entry),
    )
    .unwrap();
    let payload = ClipboardPayload::new(
        ORIGIN,
        &session.project,
        &[compound, file],
        std::slice::from_ref(&entry),
    );
    validate_clipboard(&payload).unwrap();
    assert_eq!(payload.media_ids().len(), 2);
    assert_eq!(payload.clip_entries().len(), 1);
    let mut offline_project = Project::default();
    let mut offline = entry;
    offline.clip.source = ClipSource::Media(offline_project.media_pool.alloc());
    validate_clipboard_capture(&offline_project, &[], std::slice::from_ref(&offline)).unwrap();
    let offline = ClipboardPayload::new(ORIGIN, &offline_project, &[], &[offline]);
    validate_clipboard(&offline).unwrap();
    assert_eq!(offline.files().count(), 0);
    assert!(
        validate_clipboard_capture(&session.project, &[MediaId::from_raw(u64::MAX - 1)], &[])
            .is_err()
    );
}

#[test]
fn clipboard_validation_rejects_unselected_entities_bad_entry_geometry_and_cycles_before_copy() {
    let (session, compound, timeline, file) = fixture();
    let parse = |asset: AssetFile| {
        ClipboardPayload::from_text(&asset.payload)
            .unwrap()
            .unwrap()
    };
    assert!(
        validate_clipboard(&parse(wire(&session.project, vec![file], vec![]))).is_err(),
        "Unrelated compound entities are not imported"
    );
    let entry = ClipboardEntry {
        track_kind: TrackKind::Video,
        track_number: 128,
        relative_start: 0,
        clip: session.project.timelines[timeline].tracks[0].clips[0].clone(),
        timeline_fps: Rational::new(24, 1),
        link_tag: None,
    };
    validate_clipboard_capture(&session.project, &[], std::slice::from_ref(&entry)).unwrap();
    for case in 0..5 {
        let mut invalid = entry.clone();
        match case {
            0 => invalid.track_number = 0,
            1 => invalid.track_number = 129,
            2 => invalid.relative_start = -1,
            3 => invalid.timeline_fps = Rational::new(241, 1),
            _ => invalid.clip.timeline_len = i64::MIN,
        }
        assert!(
            validate_clipboard_capture(&session.project, &[], &[invalid]).is_err(),
            "{case}"
        );
    }
    let mut cyclic = session.project.clone();
    cyclic.timelines[timeline].tracks[0].clips[0].source = ClipSource::Media(compound);
    assert!(validate_clipboard_capture(&cyclic, &[compound], &[]).is_err());
}

#[test]
fn clipboard_capture_bounds_unique_file_dependencies_before_native_fragment_copy() {
    let (session, _, _, file) = fixture();
    let mut project = Project::default();
    let mut selected = Vec::new();
    for index in 0..65 {
        let mut item = session.project.media_pool[file].clone();
        item.path = format!("/root/file-{index}.png").into();
        selected.push(project.media_pool.insert(item));
    }
    validate_clipboard_capture(&project, &selected[..64], &[]).unwrap();
    assert!(validate_clipboard_capture(&project, &selected, &[]).is_err());
}

fn fixture() -> (Session, MediaId, TimelineId, MediaId) {
    let mut session = Session::default();
    let file = session.project.media_pool.insert(MediaItem {
        path: "/authorized/image.png".into(),
        meta: MediaMeta {
            fps: Rational::new(24, 1),
            duration_frames: 1,
            width: 640,
            height: 360,
            has_video: true,
            has_audio: false,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            file: Default::default(),
        },
        content_hash: 18_000_000_000_000_001,
        compound: None,
        folder: None,
    });
    let timeline = session.create_timeline(Timeline {
        name: "Nested α".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![Track::new(TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let mut clip = Clip::from_source_range(
        ClipId(9_007_199_254_740_995),
        ClipSource::Media(file),
        0,
        48,
        12,
        Rational::one(),
    );
    clip.freeze = Some(0);
    clip.effects
        .transform
        .track_mut(TransformParam::PositionX)
        .upsert(0, 12.5, Interpolation::Hold);
    clip.effects
        .transform
        .track_mut(TransformParam::PositionX)
        .upsert(47, -8.0, Interpolation::Linear);
    clip.effects
        .masks
        .push(vv_core::ClipMask::new(vv_core::MaskShape::Path, (640, 360)));
    session.project.timelines[timeline].tracks[0]
        .clips
        .push(clip);
    session.sync_timeline_media(timeline);
    let media = session
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(timeline))
        .unwrap()
        .0;
    (session, media, timeline, file)
}

fn wire(project: &Project, media: Vec<MediaId>, clips: Vec<ClipboardEntry>) -> AssetFile {
    #[derive(Serialize)]
    struct Payload<'a> {
        origin: ClipboardOrigin,
        project: &'a Project,
        media: Vec<MediaId>,
        clips: Vec<ClipboardEntry>,
    }
    AssetFile {
        version: 1,
        name: "Native asset".into(),
        folder: None,
        payload: format!(
            "venturi-clipboard/1\n{}",
            ron::to_string(&Payload {
                origin: ORIGIN,
                project,
                media,
                clips
            })
            .unwrap()
        ),
    }
}

#[test]
fn native_nested_capture_roundtrips_images_animation_paths_and_large_ids_without_mutation() {
    let (session, root, timeline, _) = fixture();
    let before = ron::to_string(&session.project).unwrap();
    let generation = session.history.generation();
    let mut asset = capture(&session, root, "Reusable α", ORIGIN).unwrap();
    asset.folder = Some("desktop-folder_Unknown42".into());
    let bytes = serde_json::to_vec(&asset).unwrap();
    let parsed = parse(&bytes).unwrap();
    assert_eq!(parsed.folder, asset.folder);
    let payload = decode(&parsed).unwrap();
    assert_eq!(payload.origin, ORIGIN);
    assert_eq!(payload.media_ids().len(), 1);
    assert!(!payload.has_clips());
    assert_eq!(payload.files().count(), 1);
    assert_eq!(
        payload.files().next().unwrap().content_hash,
        18_000_000_000_000_001
    );
    let nested = payload.fragment().timelines.values().next().unwrap();
    let clip = &nested.tracks[0].clips[0];
    assert_eq!(clip.id.0, 9_007_199_254_740_995);
    assert_eq!(clip.freeze, Some(0));
    assert_eq!(
        serde_json::to_value(&clip.effects).unwrap(),
        serde_json::to_value(&session.project.timelines[timeline].tracks[0].clips[0].effects)
            .unwrap()
    );
    assert_eq!(ron::to_string(&session.project).unwrap(), before);
    assert_eq!(session.history.generation(), generation);

    let mut destination = Project::default();
    let mut add = vv_core::AddEntities::new(CommandLabel::ImportMedia);
    let pasted = payload.merge_into(&mut destination, &mut add);
    add.apply(&mut destination);
    crate::files::validate_project(&destination).unwrap();
    assert_eq!(pasted.media.len(), 1);
    assert!(destination.media_pool[pasted.media[0]].compound.is_some());
    add.undo(&mut destination);
    assert!(destination.media_pool.is_empty());
    assert!(destination.timelines.is_empty());
}

#[test]
fn decoding_validates_references_before_native_merge_and_capture_before_native_copy() {
    let (mut session, root, timeline, file) = fixture();
    let original = session.project.clone();
    session.project.media_pool.remove(file);
    let before = ron::to_string(&session.project).unwrap();
    assert!(decode(&wire(&session.project, vec![root], vec![])).is_err());
    assert!(capture(&session, root, "Missing file", ORIGIN).is_err());
    assert_eq!(ron::to_string(&session.project).unwrap(), before);
    session.project = original.clone();
    session.project.timelines.remove(timeline);
    assert!(decode(&wire(&session.project, vec![root], vec![])).is_err());
    assert!(capture(&session, root, "Missing timeline", ORIGIN).is_err());
    session.project = original;
    assert!(
        decode(&wire(
            &session.project,
            vec![MediaId::from_raw(999)],
            vec![]
        ))
        .is_err()
    );
}

#[test]
fn asset_top_level_pool_selection_rejects_duplicate_or_multiple_items_and_copied_clips() {
    let (session, root, timeline, file) = fixture();
    for roots in [vec![], vec![root, root], vec![root, file]] {
        assert!(decode(&wire(&session.project, roots, vec![])).is_err());
    }
    let clip = session.project.timelines[timeline].tracks[0].clips[0].clone();
    let copied = ClipboardEntry {
        track_kind: TrackKind::Video,
        track_number: 1,
        relative_start: 0,
        clip,
        timeline_fps: Rational::new(24, 1),
        link_tag: None,
    };
    assert!(decode(&wire(&session.project, vec![root], vec![copied])).is_err());
    let mut project = session.project.clone();
    project.media_pool.insert(project.media_pool[file].clone());
    assert!(decode(&wire(&project, vec![root], vec![])).is_err());
}

#[test]
fn native_asset_json_is_strict_bounded_and_retains_supported_opaque_folder_ids() {
    let (session, root, _, _) = fixture();
    let asset = capture(&session, root, "Valid", ORIGIN).unwrap();
    for payload in [
        "not native",
        "venturi-clipboard/99\n()",
        "venturi-clipboard/1\n(",
    ] {
        let mut invalid = asset.clone();
        invalid.payload = payload.into();
        assert!(decode(&invalid).is_err());
    }
    for field in ["version", "name", "folder"] {
        let mut value = serde_json::to_value(&asset).unwrap();
        value[field] = match field {
            "version" => serde_json::json!(2),
            "name" => serde_json::json!("bad\nname"),
            _ => serde_json::json!("../outside"),
        };
        assert!(parse(&serde_json::to_vec(&value).unwrap()).is_err());
    }
    let mut extra = serde_json::to_value(&asset).unwrap();
    extra["unknown"] = serde_json::json!(true);
    assert!(parse(&serde_json::to_vec(&extra).unwrap()).is_err());
    assert!(parse(&vec![b' '; MAX_ASSET_BYTES + 1]).is_err());
    let mut value = serde_json::to_value(&asset).unwrap();
    value.as_object_mut().unwrap().remove("folder");
    assert!(
        parse(&serde_json::to_vec(&value).unwrap())
            .unwrap()
            .folder
            .is_none()
    );
}

#[test]
fn native_cycles_duplicate_clip_ids_and_extreme_clip_values_are_rejected_atomically() {
    let (mut session, root, timeline, _) = fixture();
    let original = session.project.clone();
    session.project.timelines[timeline].tracks[0].clips[0].source = ClipSource::Media(root);
    assert!(capture(&session, root, "Cycle", ORIGIN).is_err());
    assert!(decode(&wire(&session.project, vec![root], vec![])).is_err());
    session.project = original.clone();
    let mut duplicate = session.project.timelines[timeline].tracks[0].clips[0].clone();
    duplicate.timeline_start = 60;
    session.project.timelines[timeline].tracks[0]
        .clips
        .push(duplicate);
    assert!(capture(&session, root, "Duplicate", ORIGIN).is_err());
    session.project = original.clone();
    session.project.timelines[timeline].tracks[0].clips[0].timeline_len = i64::MAX;
    assert!(capture(&session, root, "Range", ORIGIN).is_err());
    for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        session.project = original.clone();
        session.project.timelines[timeline].tracks[0].clips[0]
            .effects
            .transform
            .track_mut(TransformParam::PositionX)
            .default = value;
        assert!(capture(&session, root, "Nonfinite", ORIGIN).is_err());
        assert!(decode(&wire(&session.project, vec![root], vec![])).is_err());
    }
    session.project = original;
    session.project.timelines[timeline].tracks[0].clips[0]
        .effects
        .transform
        .track_mut(TransformParam::PositionX)
        .upsert(1_000_000_001, 1.0, Interpolation::Linear);
    assert!(capture(&session, root, "Invalid keys", ORIGIN).is_err());
}

#[test]
fn native_payload_preserves_u64_media_ids_and_allows_worker_path_remapping() {
    let (session, _, _, file) = fixture();
    let high = 9_007_199_254_740_993_u64;
    let mut project = Project::default();
    let item = ron::to_string(&session.project.media_pool[file]).unwrap();
    project.media_pool =
        ron::from_str(&format!("(next:{},items:{{{}:{}}})", high + 1, high, item)).unwrap();
    let asset = wire(&project, vec![MediaId::from_raw(high)], vec![]);
    let mut payload = decode(&parse(&serde_json::to_vec(&asset).unwrap()).unwrap()).unwrap();
    assert_eq!(payload.media_ids()[0].raw(), high);
    payload.files_mut().next().unwrap().path = "/library/media/hash/image.png".into();
    let remapped = AssetFile {
        payload: payload.to_text(),
        ..asset
    };
    assert_eq!(
        decode(&remapped).unwrap().files().next().unwrap().path,
        std::path::Path::new("/library/media/hash/image.png")
    );
}

#[test]
fn native_compound_depth_boundary_is_checked_before_copying() {
    let (mut session, mut root, _, _) = fixture();
    for level in 2..=vv_core::MAX_COMPOUND_DEPTH + 1 {
        let child = session.project.media_pool[root].compound.unwrap();
        let timeline = session.create_timeline(Timeline {
            name: format!("Level {level}"),
            fps: Rational::new(24, 1),
            resolution: (640, 360),
            tracks: vec![Track::new(TrackKind::Video)],
            markers: vec![],
            master: Default::default(),
        });
        let id = session.project.alloc_clip_id();
        session.project.timelines[timeline].tracks[0]
            .clips
            .push(Clip::from_source_range(
                id,
                ClipSource::Media(root),
                0,
                48,
                0,
                Rational::one(),
            ));
        assert_ne!(timeline, child);
        session.sync_timeline_media(timeline);
        root = session
            .project
            .media_pool
            .iter()
            .find(|(_, item)| item.compound == Some(timeline))
            .unwrap()
            .0;
        if level == vv_core::MAX_COMPOUND_DEPTH {
            assert!(capture(&session, root, "Boundary", ORIGIN).is_ok());
        } else if level > vv_core::MAX_COMPOUND_DEPTH {
            assert!(capture(&session, root, "Too deep", ORIGIN).is_err());
            assert!(decode(&wire(&session.project, vec![root], vec![])).is_err());
        }
    }
}
