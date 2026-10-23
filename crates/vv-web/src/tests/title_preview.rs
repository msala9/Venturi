use super::*;
use vv_core::{Clip, ClipSource, Command, Id, Interpolation, Rational, Timeline, Track, TrackKind};

fn fixture() -> (vv_session::Session, vv_core::TimelineId, Vec<String>) {
    let mut session = vv_session::Session::default();
    let timeline = session.create_timeline(Timeline {
        name: "Font draft".into(),
        fps: Rational::new(24, 1),
        resolution: (128, 72),
        tracks: vec![
            Track::new(TrackKind::Video),
            Track::new(TrackKind::Video),
            Track::new(TrackKind::Video),
            Track::new(TrackKind::Audio),
        ],
        markers: vec![],
        master: Default::default(),
    });
    let mut ids = Vec::new();
    for track in 0..3 {
        let id = session.project.alloc_clip_id();
        let mut clip = Clip::from_source_range(
            id,
            if track < 2 {
                ClipSource::Text
            } else {
                ClipSource::SolidColor
            },
            0,
            60,
            if track == 0 { 10 } else { 0 },
            Rational::new(3, 2),
        );
        if track < 2 {
            let mut title = vv_core::TitleParams::default();
            title.font_family = if track == 0 { "Primary" } else { "Peer" }.into();
            title.font_weight = if track == 0 { 400 } else { 700 };
            title.italic = track == 1;
            title.content.default = format!("Own text {track}");
            title.content.upsert(
                12 + track as i64,
                format!("Own key {track}"),
                Interpolation::Hold,
            );
            title.background.width = 0.2 + track as f32 * 0.1;
            clip.effects.title = Some(title);
            if track == 1 {
                clip.freeze = Some(7);
            }
        }
        session.project.timelines[timeline].tracks[track].insert_sorted(clip);
        ids.push(id.0.to_string());
    }
    let media = session.project.media_pool.insert(vv_core::MediaItem {
        path: "/not-opened-by-font-drafts/audio.wav".into(),
        meta: vv_core::MediaMeta {
            duration_frames: 24,
            fps: Rational::new(24, 1),
            width: 0,
            height: 0,
            has_video: false,
            has_audio: true,
            sample_rate: 48000,
            channels: 1,
            audio_streams: 1,
            file: Default::default(),
        },
        content_hash: 0,
        compound: None,
        folder: None,
    });
    let id = session.project.alloc_clip_id();
    session.project.timelines[timeline].tracks[3].insert_sorted(Clip::from_source_range(
        id,
        ClipSource::Media(media),
        0,
        24,
        0,
        Rational::one(),
    ));
    ids.push(id.0.to_string());
    (session, timeline, ids)
}
fn snapshot(session: &vv_session::Session, timeline: vv_core::TimelineId) -> FrameSnapshot {
    FrameSnapshot {
        originals: None,
        video: Default::default(),
        project: session.project.clone(),
        timeline,
        query: FrameQuery {
            timeline_id: timeline.raw().to_string(),
            project_epoch: "epoch:1".into(),
            if_generation: session.history.generation().to_string(),
            revision: session.timeline_revision(timeline),
            frame: 19,
            width: 64,
        },
        size: (64, 36),
    }
}
fn request(snapshot: &FrameSnapshot, ids: &[String]) -> Request {
    Request {
        query: snapshot.query.clone(),
        clip_ids: ids.to_vec(),
        font_family: Some("Draft family".into()),
        font_weight: Some(400),
        italic: Some(true),
    }
}

#[test]
fn title_font_draft_matches_native_title_commands_preserves_peer_values_and_never_edits_authority()
{
    let (session, timeline, ids) = fixture();
    let before = serde_json::to_value(&session.project).unwrap();
    let generation = session.history.generation();
    let position = session.history.position();
    let revision = session.timeline_revision(timeline);
    let dirty = session.has_unsaved_changes();
    let captured = snapshot(&session, timeline);
    let request = request(&captured, &[ids[1].clone(), ids[2].clone(), ids[0].clone()]);
    let mut expected = session.project.clone();
    for track in 0..2 {
        let clip = &expected.timelines[timeline].tracks[track].clips[0];
        let mut title = clip.effects.title.clone().unwrap();
        title.font_family = "Draft family".into();
        title.italic = true;
        vv_core::set_clip_title(timeline, track, clip.id, title).apply(&mut expected);
    }
    let (draft, tag) = apply(captured, &request).unwrap();
    assert_eq!(
        serde_json::to_value(&draft.project).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
    assert_eq!(
        draft.project.timelines[timeline].tracks[1].clips[0]
            .effects
            .title
            .as_ref()
            .unwrap()
            .font_weight,
        700
    );
    assert!(
        draft.project.timelines[timeline].tracks[2].clips[0]
            .effects
            .title
            .is_none()
    );
    assert_eq!(
        serde_json::to_value(&draft.query).unwrap(),
        serde_json::to_value(&request.query).unwrap()
    );
    assert_eq!(draft.size, (64, 36));
    assert_eq!(tag.len(), 64);
    assert!(
        tag.bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    );
    assert_eq!(
        apply(snapshot(&session, timeline), &request).unwrap().1,
        tag
    );
    let mut other = request.clone();
    other.font_family = Some("Other draft family".into());
    assert_ne!(apply(snapshot(&session, timeline), &other).unwrap().1, tag);
    drop(draft);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(
        (
            session.history.generation(),
            session.history.position(),
            session.timeline_revision(timeline),
            session.has_unsaved_changes()
        ),
        (generation, position, revision, dirty)
    );
}

#[test]
fn title_font_draft_requires_exact_frame_identity_and_native_valid_atomic_targets() {
    let (session, timeline, ids) = fixture();
    let base = snapshot(&session, timeline);
    let original = request(&base, &ids[..2]);
    for field in [
        "epoch",
        "generation",
        "timeline",
        "revision",
        "frame",
        "width",
    ] {
        let mut changed = original.clone();
        match field {
            "epoch" => changed.query.project_epoch = "other".into(),
            "generation" => changed.query.if_generation = "99".into(),
            "timeline" => changed.query.timeline_id = "999".into(),
            "revision" => changed.query.revision = "other".into(),
            "frame" => changed.query.frame += 1,
            _ => changed.query.width += 1,
        }
        assert_eq!(
            apply(snapshot(&session, timeline), &changed)
                .err()
                .unwrap()
                .1,
            "STALE_PREVIEW",
            "{field}"
        );
    }
    let mut bad_size = snapshot(&session, timeline);
    bad_size.size = (63, 36);
    assert_eq!(apply(bad_size, &original).err().unwrap().1, "STALE_PREVIEW");
    for targets in [
        vec![],
        vec![ids[0].clone(), ids[0].clone()],
        vec![ids[0].clone(), "999999".into()],
        vec![ids[0].clone(), ids[3].clone()],
        vec![ids[2].clone()],
        vec!["not-an-id".into()],
    ] {
        let mut changed = original.clone();
        changed.clip_ids = targets;
        assert!(apply(snapshot(&session, timeline), &changed).is_err());
    }
    let mut locked = snapshot(&session, timeline);
    locked.project.timelines[timeline].tracks[1].locked = true;
    assert!(apply(locked, &original).is_err());
    for family in ["bad\nfamily".to_string(), "x".repeat(129)] {
        let mut changed = original.clone();
        changed.font_family = Some(family);
        assert!(apply(snapshot(&session, timeline), &changed).is_err());
    }
    let mut empty = original.clone();
    empty.font_family = None;
    empty.font_weight = None;
    empty.italic = None;
    assert!(apply(snapshot(&session, timeline), &empty).is_err());
    let mut malformed = serde_json::to_value(&original).unwrap();
    malformed["text"] = serde_json::json!("not a font draft");
    assert!(serde_json::from_value::<Request>(malformed).is_err());
    let mut unchanged = original;
    unchanged.font_family = Some("Primary".into());
    unchanged.font_weight = None;
    unchanged.italic = None;
    let (draft, _) = apply(snapshot(&session, timeline), &unchanged).unwrap();
    assert_eq!(
        serde_json::to_value(draft.project).unwrap(),
        serde_json::to_value(&session.project).unwrap()
    );
}
