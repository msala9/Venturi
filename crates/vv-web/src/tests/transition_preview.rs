use super::*;
use vv_core::{
    Clip, ClipId, ClipSource, Command, CrossTransition, Rational, Timeline, Track, TrackKind,
};

fn value(kind: vv_core::TransitionKind, duration: i64) -> Transition {
    Transition {
        kind,
        duration,
        direction: vv_core::PushDirection::Right,
        ease: vv_core::Ease::None,
        curve: 0.5,
    }
}
fn fixture() -> (vv_session::Session, vv_core::TimelineId, ClipId, ClipId) {
    let mut session = vv_session::Session::default();
    let timeline = session.create_timeline(Timeline {
        name: "Transition draft".into(),
        fps: Rational::new(24, 1),
        resolution: (128, 72),
        tracks: vec![Track::new(TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let left = session.project.alloc_clip_id();
    let right = session.project.alloc_clip_id();
    for (id, start) in [(left, 0), (right, 24)] {
        let mut clip =
            Clip::from_source_range(id, ClipSource::SolidColor, 0, 24, start, Rational::one());
        clip.effects.transition_in = Some(value(vv_core::TransitionKind::Push, 12));
        clip.effects.transition_out = Some(value(vv_core::TransitionKind::CrossDissolve, 6));
        session.project.timelines[timeline].tracks[0].insert_sorted(clip);
    }
    session.project.timelines[timeline].tracks[0]
        .crossings
        .push(CrossTransition {
            left_clip: left,
            right_clip: right,
            transition: value(vv_core::TransitionKind::SmoothCut, 8),
        });
    (session, timeline, left, right)
}
fn snapshot(session: &vv_session::Session, timeline: vv_core::TimelineId) -> FrameSnapshot {
    FrameSnapshot {
        originals: None,
        video: Default::default(),
        project: session.project.clone(),
        timeline,
        query: FrameQuery {
            timeline_id: timeline.raw().to_string(),
            project_epoch: "transition-epoch".into(),
            if_generation: session.history.generation().to_string(),
            revision: session.timeline_revision(timeline),
            frame: 22,
            width: 64,
        },
        size: (64, 36),
    }
}
fn request(snapshot: &FrameSnapshot, clip: ClipId, slot: TransitionSlot) -> Request {
    let kind = match slot {
        TransitionSlot::In => vv_core::TransitionKind::Push,
        TransitionSlot::Out => vv_core::TransitionKind::CrossDissolve,
        TransitionSlot::CutAfter => vv_core::TransitionKind::SmoothCut,
    };
    let mut transition = value(kind, 20);
    transition.direction = vv_core::PushDirection::Up;
    transition.ease = vv_core::Ease::InOut;
    transition.curve = 0.75;
    Request {
        query: snapshot.query.clone(),
        clip_id: clip.0.to_string(),
        slot,
        transition,
    }
}

#[test]
fn existing_transition_drafts_match_native_edge_and_crossing_commands_without_authority_mutation() {
    let (session, timeline, left, right) = fixture();
    let before = serde_json::to_value(&session.project).unwrap();
    let history = (
        session.history.generation(),
        session.history.position(),
        session.timeline_revision(timeline),
        session.has_unsaved_changes(),
    );
    let mut tags = Vec::new();
    for slot in [
        TransitionSlot::In,
        TransitionSlot::Out,
        TransitionSlot::CutAfter,
    ] {
        let captured = snapshot(&session, timeline);
        let request = request(&captured, left, slot);
        let mut expected = session.project.clone();
        match slot {
            TransitionSlot::In | TransitionSlot::Out => vv_core::set_clip_transition(
                timeline,
                0,
                left,
                if matches!(slot, TransitionSlot::In) {
                    vv_core::FadeEdge::In
                } else {
                    vv_core::FadeEdge::Out
                },
                Some(request.transition.clone()),
            )
            .apply(&mut expected),
            TransitionSlot::CutAfter => vv_core::SetCrossTransition::new(
                timeline,
                0,
                left,
                Some(CrossTransition {
                    left_clip: left,
                    right_clip: right,
                    transition: request.transition.clone(),
                }),
            )
            .apply(&mut expected),
        }
        let (draft, tag) = apply(captured, &request).unwrap();
        assert_eq!(
            serde_json::to_value(&draft.project).unwrap(),
            serde_json::to_value(expected).unwrap()
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
        let mut changed = request.clone();
        changed.transition.curve = 0.25;
        assert_ne!(
            apply(snapshot(&session, timeline), &changed).unwrap().1,
            tag
        );
        tags.push(tag);
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
        assert_eq!(
            (
                session.history.generation(),
                session.history.position(),
                session.timeline_revision(timeline),
                session.has_unsaved_changes()
            ),
            history
        );
    }
    assert!(
        tags.iter()
            .enumerate()
            .all(|(index, tag)| !tags[..index].contains(tag))
    );
}

#[test]
fn transition_draft_rejects_stale_frames_missing_slots_locks_kinds_and_native_bounds_atomically() {
    let (session, timeline, left, right) = fixture();
    let original = request(
        &snapshot(&session, timeline),
        left,
        TransitionSlot::CutAfter,
    );
    let before = serde_json::to_value(&session.project).unwrap();
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
            "generation" => changed.query.if_generation = "999".into(),
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
            "STALE_PREVIEW"
        );
    }
    for frame in [-1, 48, crate::commands::MAX_FRAME + 1] {
        let mut captured = snapshot(&session, timeline);
        captured.query.frame = frame;
        let mut changed = original.clone();
        changed.query.frame = frame;
        assert_eq!(apply(captured, &changed).err().unwrap().1, "STALE_PREVIEW");
    }
    for scenario in 0..10 {
        let mut captured = snapshot(&session, timeline);
        let mut changed = original.clone();
        match scenario {
            0 => captured.size = (63, 36),
            1 => captured.project.timelines[timeline].tracks[0].locked = true,
            2 => captured.project.timelines[timeline].tracks[0]
                .crossings
                .clear(),
            3 => {
                captured.project.timelines[timeline]
                    .clip_mut(0, right)
                    .unwrap()
                    .timeline_start += 1
            }
            4 => changed.clip_id = "missing".into(),
            5 => changed.transition.duration = 0,
            6 => changed.transition.duration = 49,
            7 => changed.transition.curve = f32::NAN,
            8 => changed.transition.kind = vv_core::TransitionKind::Push,
            _ => captured.project.timelines[timeline].tracks[0].kind = TrackKind::Audio,
        }
        assert!(apply(captured, &changed).is_err(), "scenario {scenario}");
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    }
    for slot in [TransitionSlot::In, TransitionSlot::Out] {
        let mut captured = snapshot(&session, timeline);
        let changed = request(&captured, left, slot);
        let clip = captured.project.timelines[timeline]
            .clip_mut(0, left)
            .unwrap();
        if matches!(slot, TransitionSlot::In) {
            clip.effects.transition_in = None;
        } else {
            clip.effects.transition_out = None;
        }
        assert_eq!(
            apply(captured, &changed).err().unwrap().1,
            "TRANSITION_CHANGED"
        );
        let mut captured = snapshot(&session, timeline);
        let mut changed = request(&captured, left, slot);
        changed.transition.duration = 25;
        assert!(apply(captured, &changed).is_err());
        captured = snapshot(&session, timeline);
        captured.project.timelines[timeline]
            .clip_mut(0, left)
            .unwrap()
            .source = ClipSource::Adjustment;
        assert!(
            apply(
                captured,
                &request(&snapshot(&session, timeline), left, slot)
            )
            .is_err()
        );
    }
    let mut unchanged = original.clone();
    unchanged.transition = value(vv_core::TransitionKind::SmoothCut, 8);
    assert_eq!(
        serde_json::to_value(
            apply(snapshot(&session, timeline), &unchanged)
                .unwrap()
                .0
                .project
        )
        .unwrap(),
        before
    );
    for location in ["outer", "query", "transition", "slot", "null"] {
        let mut body = serde_json::to_value(&original).unwrap();
        match location {
            "outer" => body["path"] = serde_json::json!("/tmp/project"),
            "query" => body["query"]["path"] = serde_json::json!("/tmp/project"),
            "transition" => body["transition"]["path"] = serde_json::json!("/tmp/project"),
            "slot" => body["slot"] = serde_json::json!("unknown"),
            _ => body["transition"] = serde_json::Value::Null,
        }
        assert!(
            serde_json::from_value::<Request>(body).is_err(),
            "{location}"
        );
    }
}
