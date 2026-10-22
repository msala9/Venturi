use super::*;

fn setup() -> (
    Files,
    Session,
    core::TimelineId,
    Replacement,
    std::path::PathBuf,
) {
    let root = std::env::temp_dir().join(format!(
        "vv-web-take-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let files = Files::new(&root).unwrap();
    for (name, frames) in [("old.wav", 48000), ("new.wav", 72000)] {
        vv_media::audio_file::write_audio_file(
            &root.join(name),
            vv_media::audio_file::AudioFileFormat::Wav,
            &vec![0.125; frames],
            48000,
            1,
        )
        .unwrap();
    }
    let mut session = Session::default();
    let id = session.create_timeline(core::Timeline {
        name: "Takes".into(),
        fps: core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![
            core::Track::new(core::TrackKind::Video),
            core::Track::new(core::TrackKind::Audio),
        ],
        markers: vec![],
        master: Default::default(),
    });
    let (path, meta) = files.probe("old.wav").unwrap();
    let rate = core::Rational::conform_rate(session.project.timelines[id].fps, meta.fps);
    let end = meta.duration_frames;
    let old = session.add_media(path, meta);
    let (path, meta) = files.probe("new.wav").unwrap();
    let media = session.add_media(path, meta);
    let clip = core::Clip::from_source_range(
        session.project.alloc_clip_id(),
        core::ClipSource::Media(old),
        0,
        end,
        12,
        rate,
    );
    let clip_id = clip.id.0.to_string();
    session.project.timelines[id].tracks[1].clips.push(clip);
    session.sync_timeline_media(id);
    session.save_to(&root.join("take.vvproj")).unwrap();
    (
        files,
        session,
        id,
        Replacement {
            clip_id,
            media_id: media.raw().to_string(),
            source_in: 0,
            duration: core::take::DurationPolicy::Preserve,
            links: core::take::LinkPolicy::ReplaceLinked,
            attributes: core::take::AttributePolicy::Preserve,
            audio_streams: core::take::AudioStreamPolicy::Preserve,
            frozen: core::take::FrozenPolicy::Reject,
            source_version: None,
        },
        root,
    )
}
fn query(session: &Session, id: core::TimelineId) -> FrameQuery {
    FrameQuery {
        project_epoch: "test".into(),
        if_generation: session.history.generation().to_string(),
        timeline_id: id.raw().to_string(),
        revision: session.timeline_revision(id),
        frame: 12,
        width: 320,
    }
}

#[test]
fn take_worker_snapshot_is_probe_free_and_cancellation_and_restored_mtime_changes_fail_closed() {
    let (files, session, id, replacement, root) = setup();
    let before = serde_json::to_value(&session.project).unwrap();
    let task = Task::new(&session, &files, id, &replacement, false).unwrap();
    assert_eq!(
        task.run(&AtomicBool::new(true)).err().unwrap().1,
        "TAKE_CANCELED"
    );
    let task = Task::new(&session, &files, id, &replacement, false).unwrap();
    let path = root.join("new.wav");
    let bytes = std::fs::read(&path).unwrap();
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    std::fs::write(&path, &bytes).unwrap();
    std::fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert_ne!(
        crate::source::source_version(&std::fs::File::open(&path).unwrap()).unwrap(),
        task.version
    );
    assert_eq!(
        task.run(&AtomicBool::new(false)).err().unwrap().1,
        "SOURCE_CHANGED"
    );
    std::fs::write(
        &path,
        b"invalid bytes must not be probed by the Session snapshot",
    )
    .unwrap();
    let task = Task::new(&session, &files, id, &replacement, false).unwrap();
    assert!(task.run(&AtomicBool::new(false)).is_err());
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn verified_take_rejects_changed_source_session_metadata_request_and_planning_mode_without_editing()
{
    for failure in ["source", "metadata", "request", "planning"] {
        let (files, mut session, id, mut replacement, root) = setup();
        replacement.source_version = Some(
            crate::source::source_version(&files.media_file(&root.join("new.wav")).unwrap())
                .unwrap(),
        );
        let verified = Task::new(&session, &files, id, &replacement, failure != "planning")
            .unwrap()
            .run(&AtomicBool::new(false))
            .unwrap();
        match failure {
            "source" => {
                let path = root.join("new.wav");
                let bytes = std::fs::read(&path).unwrap();
                let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
                std::fs::write(&path, &bytes).unwrap();
                std::fs::OpenOptions::new()
                    .write(true)
                    .open(path)
                    .unwrap()
                    .set_times(std::fs::FileTimes::new().set_modified(modified))
                    .unwrap();
            }
            "metadata" => {
                let media = core::MediaId::from_raw(replacement.media_id.parse().unwrap());
                session.project.media_pool[media].meta.channels += 1;
            }
            "request" => replacement.source_in = 1,
            "planning" => (),
            _ => unreachable!(),
        }
        let before = serde_json::to_value(&session.project).unwrap();
        let history = session.history.position();
        assert_eq!(
            apply_verified(&mut session, &files, id, &replacement, &verified)
                .unwrap_err()
                .1,
            "SOURCE_CHANGED",
            "{failure}"
        );
        assert_eq!(session.history.position(), history);
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
        drop(verified);
        drop(files);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn replacement_nested_b_uses_exact_approved_path_not_a_same_named_root_file_and_rejects_parent_links()
 {
    let (files, mut session, id, mut replacement, root) = setup();
    std::fs::create_dir_all(root.join("approved/deep")).unwrap();
    let nested = root.join("approved/deep/new.wav");
    std::fs::rename(root.join("new.wav"), &nested).unwrap();
    vv_media::audio_file::write_audio_file(
        &root.join("new.wav"),
        vv_media::audio_file::AudioFileFormat::Wav,
        &vec![0.25; 12000],
        48000,
        1,
    )
    .unwrap();
    let media = core::MediaId::from_raw(replacement.media_id.parse().unwrap());
    session.project.media_pool[media].path = nested.clone();
    session.project.media_pool[media].content_hash =
        vv_media::content_fingerprint(&nested).unwrap();
    session.sync_timeline_media(id);
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let history = session.history.position();
    let planned = preview(
        &session,
        &files,
        id,
        &Preview {
            query: query(&session, id),
            replacement: replacement.clone(),
        },
    )
    .unwrap();
    assert_eq!(session.history.position(), history);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    replacement.source_version = Some(planned["source_version"].as_str().unwrap().into());
    apply(&mut session, &files, id, &replacement).unwrap();
    assert_eq!(session.history.position(), history + 1);
    assert!(
        matches!(session.project.timelines[id].tracks[1].clips[0].source, core::ClipSource::Media(actual) if actual == media)
    );
    crate::commands::history(&mut session, &crate::commands::Operation::Undo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    files
        .save(&session.project, "nested-take.vvproj", true)
        .unwrap();
    assert_eq!(
        files.load("nested-take.vvproj").unwrap().media_pool[media].path,
        nested
    );
    assert!(
        files
            .media_import_tokens(&["approved/deep/new.wav".into()])
            .is_err()
    );
    std::fs::rename(root.join("approved"), root.join("previous-approved")).unwrap();
    std::os::unix::fs::symlink(root.join("previous-approved"), root.join("approved")).unwrap();
    let history = session.history.position();
    assert!(apply(&mut session, &files, id, &replacement).is_err());
    assert_eq!(session.history.position(), history);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn replacement_native_pasted_image_b_preserves_managed_path_original_bytes_and_one_undo() {
    let (files, mut session, id, mut replacement, root) = setup();
    std::fs::create_dir(root.join("Pasted Images")).unwrap();
    let old = root.join("old.png");
    let pasted = root.join("Pasted Images/.Native B.png");
    let mut encoder = png::Encoder::new(std::fs::File::create(&old).unwrap(), 2, 2);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .unwrap()
        .write_image_data(&[127; 16])
        .unwrap();
    std::fs::copy(&old, &pasted).unwrap();
    std::fs::write(
        root.join(".Native B.png"),
        b"wrong root file must never be selected",
    )
    .unwrap();
    let original = std::fs::read(&pasted).unwrap();
    let old_media = session.add_media(old.clone(), vv_media::probe_image(&old).unwrap());
    let media = session.add_media(pasted.clone(), vv_media::probe_image(&pasted).unwrap());
    let clip = session.project.timelines[id].tracks[1].clips.remove(0);
    let rate = core::Rational::conform_rate(
        session.project.timelines[id].fps,
        session.project.media_pool[old_media].meta.fps,
    );
    session.project.timelines[id].tracks[0]
        .clips
        .push(core::Clip::from_source_range(
            clip.id,
            core::ClipSource::Media(old_media),
            0,
            25,
            12,
            rate,
        ));
    replacement.media_id = media.raw().to_string();
    session.sync_timeline_media(id);
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let history = session.history.position();
    let planned = preview(
        &session,
        &files,
        id,
        &Preview {
            query: query(&session, id),
            replacement: replacement.clone(),
        },
    )
    .unwrap();
    replacement.source_version = Some(planned["source_version"].as_str().unwrap().into());
    apply(&mut session, &files, id, &replacement).unwrap();
    assert_eq!(session.history.position(), history + 1);
    assert!(
        matches!(session.project.timelines[id].tracks[0].clips[0].source, core::ClipSource::Media(actual) if actual == media)
    );
    assert_eq!(session.project.media_pool[media].path, pasted);
    assert_eq!(std::fs::read(&pasted).unwrap(), original);
    crate::commands::history(&mut session, &crate::commands::Operation::Undo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    crate::commands::history(&mut session, &crate::commands::Operation::Redo).unwrap();
    files
        .save(&session.project, "pasted-take.vvproj", true)
        .unwrap();
    assert_eq!(
        files.load("pasted-take.vvproj").unwrap().media_pool[media].path,
        pasted
    );
    assert_eq!(std::fs::read(&pasted).unwrap(), original);
    assert!(
        files
            .media_import_tokens(&["Pasted Images/.Native B.png".into()])
            .is_err()
    );
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn replacement_preview_is_read_only_and_binds_one_native_undo_to_the_actual_source_file() {
    let (files, mut session, id, mut replacement, root) = setup();
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let position = session.history.position();
    let old = std::fs::read(root.join("old.wav")).unwrap();
    let new = std::fs::read(root.join("new.wav")).unwrap();
    assert_eq!(
        apply(&mut session, &files, id, &replacement).unwrap_err().1,
        "SOURCE_CHANGED"
    );
    let planned = preview(
        &session,
        &files,
        id,
        &Preview {
            query: query(&session, id),
            replacement: replacement.clone(),
        },
    )
    .unwrap();
    assert_eq!(planned["changes"][0]["clip_id"], replacement.clip_id);
    assert_eq!(planned["changes"][0]["track"], "1");
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    assert_eq!(session.history.position(), position);
    replacement.source_version = Some(planned["source_version"].as_str().unwrap().into());
    apply(&mut session, &files, id, &replacement).unwrap();
    assert_eq!(session.history.position(), position + 1);
    assert_eq!(
        session.history.labels().last(),
        Some(core::CommandLabel::ReplaceTake)
    );
    let clip = &session.project.timelines[id].tracks[1].clips[0];
    assert_eq!(
        (
            clip.timeline_start,
            clip.timeline_len,
            clip.id.0.to_string()
        ),
        (12, 24, replacement.clip_id)
    );
    assert!(
        matches!(clip.source,core::ClipSource::Media(media) if media.raw().to_string()==replacement.media_id)
    );
    crate::commands::history(&mut session, &crate::commands::Operation::Undo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    assert_eq!(std::fs::read(root.join("old.wav")).unwrap(), old);
    assert_eq!(std::fs::read(root.join("new.wav")).unwrap(), new);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn previewed_source_changes_locked_targets_and_shortening_policy_never_partially_mutate() {
    let (files, mut session, id, mut replacement, root) = setup();
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    let planned = preview(
        &session,
        &files,
        id,
        &Preview {
            query: query(&session, id),
            replacement: replacement.clone(),
        },
    )
    .unwrap();
    replacement.source_version = Some(planned["source_version"].as_str().unwrap().into());
    replacement.source_in = 40;
    assert_eq!(
        apply(&mut session, &files, id, &replacement).unwrap_err().1,
        "TAKE_TOO_SHORT"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), position);
    replacement.duration = core::take::DurationPolicy::Shorten;
    session.project.timelines[id].tracks[1].locked = true;
    assert_eq!(
        apply(&mut session, &files, id, &replacement).unwrap_err().1,
        "TRACK_LOCKED"
    );
    session.project.timelines[id].tracks[1].locked = false;
    let bytes = std::fs::read(root.join("new.wav")).unwrap();
    use std::io::Write;
    std::fs::OpenOptions::new()
        .append(true)
        .open(root.join("new.wav"))
        .unwrap()
        .write_all(&[0])
        .unwrap();
    assert_eq!(
        apply(&mut session, &files, id, &replacement).unwrap_err().1,
        "SOURCE_CHANGED"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    std::fs::write(root.join("new.wav"), bytes).unwrap();
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn replacement_audio_policy_defaults_to_preserve_and_rejects_ambiguous_or_malformed_stream_choices()
{
    let legacy = json!({"clip_id":"1","media_id":"2","source_in":0,"duration":"preserve","links":"replace_linked","attributes":"preserve","source_version":null});
    let parsed: Replacement = serde_json::from_value(legacy.clone()).unwrap();
    assert_eq!(
        parsed.audio_streams,
        core::take::AudioStreamPolicy::Preserve
    );
    assert_eq!(serde_json::to_value(&parsed).unwrap(), legacy);
    assert_eq!(
        serde_json::to_string(&parsed).unwrap(),
        r#"{"clip_id":"1","media_id":"2","source_in":0,"duration":"preserve","links":"replace_linked","attributes":"preserve","source_version":null}"#
    );
    let mut selected = legacy.clone();
    selected["audio_streams"] = json!({"policy":"select","index":0});
    assert_eq!(
        serde_json::from_value::<Replacement>(selected)
            .unwrap()
            .audio_streams,
        core::take::AudioStreamPolicy::Select { index: 0 }
    );
    for policy in [
        json!(null),
        json!("preserve"),
        json!({"policy":"select","index":-1}),
        json!({"policy":"select","index":0.5}),
        json!({"policy":"select","index":"0"}),
        json!({"policy":"select","index":0,"fallback":true}),
    ] {
        let mut invalid = legacy.clone();
        invalid["audio_streams"] = policy;
        assert!(serde_json::from_value::<Replacement>(invalid).is_err());
    }
}
#[test]
fn native_web_preview_reports_explicit_audio_remap_and_refuses_missing_streams_without_partial_edits()
 {
    let (files, mut session, id, mut replacement, root) = setup();
    let clip = &mut session.project.timelines[id].tracks[1].clips[0];
    clip.audio_stream_index = 1;
    let core::ClipSource::Media(old) = clip.source else {
        unreachable!()
    };
    session
        .project
        .media_pool
        .get_mut(old)
        .unwrap()
        .meta
        .audio_streams = 2;
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let position = session.history.position();
    let original_old = std::fs::read(root.join("old.wav")).unwrap();
    let original_new = std::fs::read(root.join("new.wav")).unwrap();
    let preview_body = |session: &Session, replacement: &Replacement| Preview {
        query: query(session, id),
        replacement: replacement.clone(),
    };
    assert_eq!(
        preview(&session, &files, id, &preview_body(&session, &replacement))
            .unwrap_err()
            .1,
        "TAKE_AUDIO_STREAM"
    );
    replacement.audio_streams = core::take::AudioStreamPolicy::Select { index: 1 };
    assert_eq!(
        preview(&session, &files, id, &preview_body(&session, &replacement))
            .unwrap_err()
            .1,
        "TAKE_AUDIO_STREAM"
    );
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    assert_eq!(session.history.position(), position);
    replacement.audio_streams = core::take::AudioStreamPolicy::Select { index: 0 };
    let planned = preview(&session, &files, id, &preview_body(&session, &replacement)).unwrap();
    assert_eq!(planned["audio_stream_count"], 1);
    assert_eq!(planned["changes"][0]["previous_audio_stream_index"], 1);
    assert_eq!(planned["changes"][0]["audio_stream_index"], 0);
    replacement.source_version = Some(planned["source_version"].as_str().unwrap().into());
    session.project.timelines[id].tracks[1].locked = true;
    assert_eq!(
        apply(&mut session, &files, id, &replacement).unwrap_err().1,
        "TRACK_LOCKED"
    );
    session.project.timelines[id].tracks[1].locked = false;
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    assert_eq!(session.history.position(), position);
    apply(&mut session, &files, id, &replacement).unwrap();
    assert_eq!(
        session.project.timelines[id].tracks[1].clips[0].audio_stream_index,
        0
    );
    assert_eq!(session.history.position(), position + 1);
    let after = serde_json::to_value(&session.project.timelines[id]).unwrap();
    crate::commands::history(&mut session, &crate::commands::Operation::Undo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    crate::commands::history(&mut session, &crate::commands::Operation::Redo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        after
    );
    assert_eq!(std::fs::read(root.join("old.wav")).unwrap(), original_old);
    assert_eq!(std::fs::read(root.join("new.wav")).unwrap(), original_new);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn take_probe_revalidates_audio_rate_channels_and_stream_count_before_plan_or_mutation() {
    let (files, mut session, id, mut replacement, root) = setup();
    let planned = preview(
        &session,
        &files,
        id,
        &Preview {
            query: query(&session, id),
            replacement: replacement.clone(),
        },
    )
    .unwrap();
    replacement.source_version = Some(planned["source_version"].as_str().unwrap().into());
    let media = core::MediaId::from_raw(replacement.media_id.parse().unwrap());
    let actual = session.project.media_pool[media].meta.clone();
    let position = session.history.position();
    for scenario in 0..3 {
        let meta = &mut session.project.media_pool.get_mut(media).unwrap().meta;
        *meta = actual.clone();
        match scenario {
            0 => meta.sample_rate += 1,
            1 => meta.channels += 1,
            _ => meta.audio_streams += 1,
        }
        let before = serde_json::to_value(&session.project).unwrap();
        let body = Preview {
            query: query(&session, id),
            replacement: replacement.clone(),
        };
        assert_eq!(
            preview(&session, &files, id, &body).unwrap_err().1,
            "SOURCE_CHANGED"
        );
        assert_eq!(
            apply(&mut session, &files, id, &replacement).unwrap_err().1,
            "SOURCE_CHANGED"
        );
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
        assert_eq!(session.history.position(), position);
    }
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn frozen_replacement_defaults_preserve_legacy_bytes_and_only_accept_explicit_string_policies() {
    let legacy = r#"{"clip_id":"1","media_id":"2","source_in":0,"duration":"preserve","links":"replace_linked","attributes":"preserve","source_version":null}"#;
    let parsed: Replacement = serde_json::from_str(legacy).unwrap();
    assert_eq!(parsed.frozen, core::take::FrozenPolicy::Reject);
    assert_eq!(serde_json::to_string(&parsed).unwrap(), legacy);
    let mut explicit = serde_json::from_str::<Value>(legacy).unwrap();
    explicit["frozen"] = json!("reject");
    assert_eq!(
        serde_json::to_string(&serde_json::from_value::<Replacement>(explicit).unwrap()).unwrap(),
        legacy
    );
    for policy in ["hold_source_in", "unfreeze"] {
        let mut value = serde_json::from_str::<Value>(legacy).unwrap();
        value["frozen"] = json!(policy);
        let parsed: Replacement = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    }
    for policy in [
        json!(null),
        json!(false),
        json!(0),
        json!("preserve"),
        json!({"hold_source_in":null}),
        json!({"policy":"unfreeze"}),
        json!([]),
    ] {
        let mut value = serde_json::from_str::<Value>(legacy).unwrap();
        value["frozen"] = policy;
        assert!(
            serde_json::from_value::<Replacement>(value.clone()).is_err(),
            "{value}"
        );
    }
}

#[test]
fn frozen_native_preview_keeps_long_linked_holds_and_binds_one_undo_to_unchanged_b_file() {
    let (files, mut session, id, mut replacement, root) = setup();
    let first = &mut session.project.timelines[id].tracks[1].clips[0];
    first.freeze = Some(0);
    first.timeline_len = 240;
    first.fade_in = 48;
    first.linked_group = Some(core::LinkGroupId(77));
    let mut peer = first.clone();
    peer.id = session.project.alloc_clip_id();
    peer.timeline_start = 300;
    peer.source_offset = 100;
    peer.freeze = Some(20);
    session.project.timelines[id].tracks[1].clips.push(peer);
    session.sync_timeline_media(id);
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let position = session.history.position();
    let old_bytes = std::fs::read(root.join("old.wav")).unwrap();
    let new_bytes = std::fs::read(root.join("new.wav")).unwrap();
    assert!(
        preview(
            &session,
            &files,
            id,
            &Preview {
                query: query(&session, id),
                replacement: replacement.clone()
            }
        )
        .is_err()
    );
    replacement.frozen = core::take::FrozenPolicy::HoldSourceIn;
    replacement.source_in = 1;
    let planned = preview(
        &session,
        &files,
        id,
        &Preview {
            query: query(&session, id),
            replacement: replacement.clone(),
        },
    )
    .unwrap();
    assert_eq!(session.history.position(), position);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    let changes = planned["changes"].as_array().unwrap();
    assert_eq!(changes.len(), 2);
    assert_eq!(changes[0]["previous_freeze_source_frame"], 0);
    assert_eq!(changes[1]["previous_freeze_source_frame"], 20);
    for change in changes {
        assert_eq!(change["freeze_source_frame"], 1);
        assert_eq!(change["length"], 240);
        assert_eq!(change["previous_length"], 240);
    }
    replacement.source_version = Some(planned["source_version"].as_str().unwrap().into());
    session.project.timelines[id].tracks[1].locked = true;
    let locked = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        apply(&mut session, &files, id, &replacement).unwrap_err().1,
        "TRACK_LOCKED"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), locked);
    session.project.timelines[id].tracks[1].locked = false;
    use std::io::Write;
    std::fs::OpenOptions::new()
        .append(true)
        .open(root.join("new.wav"))
        .unwrap()
        .write_all(&[0])
        .unwrap();
    assert_eq!(
        apply(&mut session, &files, id, &replacement).unwrap_err().1,
        "SOURCE_CHANGED"
    );
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    assert_eq!(session.history.position(), position);
    std::fs::write(root.join("new.wav"), &new_bytes).unwrap();
    // Restoring bytes also changes the descriptor; obtain a fresh explicit plan.
    let planned = preview(
        &session,
        &files,
        id,
        &Preview {
            query: query(&session, id),
            replacement: Replacement {
                source_version: None,
                ..replacement.clone()
            },
        },
    )
    .unwrap();
    replacement.source_version = Some(planned["source_version"].as_str().unwrap().into());
    apply(&mut session, &files, id, &replacement).unwrap();
    assert_eq!(session.history.position(), position + 1);
    for clip in &session.project.timelines[id].tracks[1].clips {
        assert_eq!(clip.freeze, Some(1));
        assert_eq!(clip.timeline_len, 240);
        assert_eq!(clip.fade_in, 48);
        assert_eq!(clip.picture_frame_at(clip.timeline_start + 100), 1);
    }
    let after = serde_json::to_value(&session.project.timelines[id]).unwrap();
    crate::commands::history(&mut session, &crate::commands::Operation::Undo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    crate::commands::history(&mut session, &crate::commands::Operation::Redo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        after
    );
    assert_eq!(std::fs::read(root.join("old.wav")).unwrap(), old_bytes);
    assert_eq!(std::fs::read(root.join("new.wav")).unwrap(), new_bytes);
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn web_unfreeze_requires_explicit_shortening_and_reports_nullable_moving_frames() {
    let (files, mut session, id, mut replacement, root) = setup();
    session.project.timelines[id].tracks[1].clips[0].freeze = Some(0);
    session.project.timelines[id].tracks[1].clips[0].timeline_len = 240;
    session.sync_timeline_media(id);
    replacement.frozen = core::take::FrozenPolicy::Unfreeze;
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    assert_eq!(
        preview(
            &session,
            &files,
            id,
            &Preview {
                query: query(&session, id),
                replacement: replacement.clone()
            }
        )
        .unwrap_err()
        .1,
        "TAKE_TOO_SHORT"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), position);
    replacement.duration = core::take::DurationPolicy::Shorten;
    let planned = preview(
        &session,
        &files,
        id,
        &Preview {
            query: query(&session, id),
            replacement: replacement.clone(),
        },
    )
    .unwrap();
    assert_eq!(planned["changes"][0]["previous_freeze_source_frame"], 0);
    assert!(planned["changes"][0]["freeze_source_frame"].is_null());
    assert!(planned["changes"][0]["length"].as_i64().unwrap() < 240);
    replacement.source_version = Some(planned["source_version"].as_str().unwrap().into());
    apply(&mut session, &files, id, &replacement).unwrap();
    assert_eq!(session.history.position(), position + 1);
    assert_eq!(
        session.project.timelines[id].tracks[1].clips[0].freeze,
        None
    );
    let after = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let moving = preview(
        &session,
        &files,
        id,
        &Preview {
            query: query(&session, id),
            replacement: replacement.clone(),
        },
    )
    .unwrap();
    assert!(
        moving["changes"][0]
            .get("previous_freeze_source_frame")
            .unwrap()
            .is_null()
    );
    assert!(
        moving["changes"][0]
            .get("freeze_source_frame")
            .unwrap()
            .is_null()
    );
    crate::commands::history(&mut session, &crate::commands::Operation::Undo).unwrap();
    assert_eq!(
        session.project.timelines[id].tracks[1].clips[0].freeze,
        Some(0)
    );
    assert_eq!(
        session.project.timelines[id].tracks[1].clips[0].timeline_len,
        240
    );
    crate::commands::history(&mut session, &crate::commands::Operation::Redo).unwrap();
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        after
    );
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}
