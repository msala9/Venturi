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
