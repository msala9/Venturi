use super::*;
use vv_core::{Rational, Timeline, Track, TrackKind};

fn timeline(name: &str, fps: Rational) -> Timeline {
    Timeline {
        name: name.into(),
        fps,
        resolution: (640, 360),
        tracks: vec![Track::new(TrackKind::Video), Track::new(TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    }
}
fn fixture() -> (Session, TimelineId, TimelineId, ClipId) {
    let mut session = Session::default();
    let parent = session.create_timeline(timeline("Parent", Rational::new(24000, 1001)));
    let child = session.create_timeline(timeline("Child", Rational::new(30000, 1001)));
    session.project.timelines[child].tracks[0]
        .clips
        .push(Clip::from_source_range(
            ClipId(1),
            ClipSource::SolidColor,
            0,
            500,
            0,
            Rational::one(),
        ));
    session.sync_timeline_media(child);
    let media = session
        .project
        .media_pool
        .iter()
        .find(|(_, m)| m.compound == Some(child))
        .unwrap()
        .0;
    let id = ClipId(9007199254740993);
    let mut wrapper = Clip::from_source_range(
        id,
        ClipSource::Media(media),
        30,
        150,
        100,
        Rational::new(4, 5),
    );
    wrapper.set_speed(Rational::new(2, 1), Rational::new(4, 5));
    session.project.timelines[parent].tracks[0]
        .clips
        .push(wrapper);
    (session, parent, child, id)
}
fn request(session: &Session, id: TimelineId, frame: i64, action: Navigation) -> Request {
    Request {
        query: FrameQuery {
            timeline_id: id.raw().to_string(),
            project_epoch: "project:1".into(),
            if_generation: session.history.generation().to_string(),
            revision: session.timeline_revision(id),
            frame,
            width: 320,
        },
        action,
    }
}
fn ancestor(session: &Session, id: TimelineId, clip: Option<ClipId>, frame: i64) -> Ancestor {
    Ancestor {
        timeline_id: id.raw().to_string(),
        revision: session.timeline_revision(id),
        clip_id: clip.map(|id| id.0.to_string()),
        entry_playhead: frame,
    }
}

#[test]
fn entry_uses_native_rational_speed_offset_and_raw_outside_playhead_even_on_locked_tracks() {
    let (mut session, parent, child, clip) = fixture();
    session.project.timelines[parent].tracks[0].locked = true;
    let before = serde_json::to_value(&session.project).unwrap();
    let generation = session.history.generation();
    for (frame, expected) in [(0, 31), (112, 61), (1_000_000_000, 148)] {
        let result = navigate(
            &session,
            parent,
            &request(
                &session,
                parent,
                frame,
                Navigation::Enter {
                    clip_ids: vec![clip.0.to_string()],
                },
            ),
        )
        .unwrap();
        assert_eq!(result["frame"], expected);
        assert_eq!(result["source_frame"], frame);
        assert_eq!(result["timeline_id"], child.raw().to_string());
        assert_eq!(result["via_clip_id"], clip.0.to_string());
        assert_eq!(result["revision"], session.timeline_revision(child));
    }
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.generation(), generation);
}

#[test]
fn selection_ignores_noncompounds_uses_native_track_clip_order_and_refuses_mixed_children() {
    let (mut session, parent, child, clip) = fixture();
    let mut peer = session.project.timelines[parent].tracks[0].clips[0].clone();
    peer.id = ClipId(9007199254740995);
    peer.freeze = Some(90);
    session.project.timelines[parent].tracks[1]
        .clips
        .push(peer.clone());
    session.project.timelines[parent].tracks[0]
        .clips
        .push(Clip::from_source_range(
            ClipId(2),
            ClipSource::SolidColor,
            0,
            10,
            200,
            Rational::one(),
        ));
    let selected = Navigation::Enter {
        clip_ids: vec![peer.id.0.to_string(), "2".into(), clip.0.to_string()],
    };
    let result = navigate(&session, parent, &request(&session, parent, 112, selected)).unwrap();
    assert_eq!(result["timeline_id"], child.raw().to_string());
    assert_eq!(result["via_clip_id"], clip.0.to_string());
    assert_eq!(result["frame"], 61);
    assert!(
        navigate(
            &session,
            parent,
            &request(
                &session,
                parent,
                0,
                Navigation::Enter {
                    clip_ids: vec!["2".into()]
                }
            )
        )
        .is_err()
    );
    assert_eq!(
        navigate(
            &session,
            parent,
            &request(
                &session,
                parent,
                0,
                Navigation::Enter {
                    clip_ids: vec!["999".into()]
                }
            )
        )
        .unwrap_err()
        .1,
        "NOT_FOUND"
    );
    let other = session.create_timeline(timeline("Other", Rational::new(24, 1)));
    let other_media = session
        .project
        .media_pool
        .iter()
        .find(|(_, m)| m.compound == Some(other))
        .unwrap()
        .0;
    session.project.timelines[parent].tracks[1].clips[0].source = ClipSource::Media(other_media);
    assert!(
        navigate(
            &session,
            parent,
            &request(
                &session,
                parent,
                112,
                Navigation::Enter {
                    clip_ids: vec![clip.0.to_string(), peer.id.0.to_string()]
                }
            )
        )
        .is_err()
    );
}

#[test]
fn frozen_entry_uses_picture_frame_then_clamps_to_actual_child_including_empty_timeline() {
    let (mut session, parent, child, clip) = fixture();
    for (held, expected) in [(7, 7), (-1, 0), (9999, 499)] {
        session.project.timelines[parent].tracks[0].clips[0].freeze = Some(held);
        let result = navigate(
            &session,
            parent,
            &request(
                &session,
                parent,
                120,
                Navigation::Enter {
                    clip_ids: vec![clip.0.to_string()],
                },
            ),
        )
        .unwrap();
        assert_eq!(result["frame"], expected);
    }
    session.project.timelines[child].tracks[0].clips.clear();
    assert_eq!(
        navigate(
            &session,
            parent,
            &request(
                &session,
                parent,
                120,
                Navigation::Enter {
                    clip_ids: vec![clip.0.to_string()]
                }
            )
        )
        .unwrap()["frame"],
        0
    );
    let media = session
        .project
        .media_pool
        .iter()
        .find(|(_, m)| m.compound == Some(parent))
        .unwrap()
        .0;
    session.project.timelines[parent].tracks[0].clips[0].source = ClipSource::Media(media);
    assert!(
        navigate(
            &session,
            parent,
            &request(
                &session,
                parent,
                120,
                Navigation::Enter {
                    clip_ids: vec![clip.0.to_string()]
                }
            )
        )
        .is_err()
    );
}

#[test]
fn multilevel_exit_applies_native_live_inverse_in_reverse_ancestor_order_and_clamps_wrappers() {
    let (mut session, parent, child, clip) = fixture();
    let root = session.create_timeline(timeline("Root", Rational::new(24000, 1001)));
    let media = session
        .project
        .media_pool
        .iter()
        .find(|(_, m)| m.compound == Some(parent))
        .unwrap()
        .0;
    let outer = ClipId(9007199254741007);
    session.project.timelines[root].tracks[0]
        .clips
        .push(Clip::from_source_range(
            outer,
            ClipSource::Media(media),
            0,
            200,
            300,
            Rational::one(),
        ));
    let ancestors = vec![
        ancestor(&session, root, Some(outer), 310),
        ancestor(&session, parent, Some(clip), 112),
    ];
    let result = navigate(
        &session,
        child,
        &request(
            &session,
            child,
            61,
            Navigation::Exit {
                ancestors: ancestors.clone(),
            },
        ),
    )
    .unwrap();
    assert_eq!(result["timeline_id"], root.raw().to_string());
    assert_eq!(result["frame"], 412);
    assert!(result["via_clip_id"].is_null());
    assert_eq!(result["source_frame"], 61);
    assert_eq!(
        navigate(
            &session,
            child,
            &request(
                &session,
                child,
                1_000_000_000,
                Navigation::Exit { ancestors }
            )
        )
        .unwrap()["frame"],
        447
    );
}

#[test]
fn exit_keeps_native_unclamped_entry_fallback_for_frozen_missing_and_null_wrappers() {
    let (mut session, parent, child, clip) = fixture();
    for stored_clip in [None, Some(ClipId(999))] {
        let result = navigate(
            &session,
            child,
            &request(
                &session,
                child,
                20,
                Navigation::Exit {
                    ancestors: vec![ancestor(&session, parent, stored_clip, 777)],
                },
            ),
        )
        .unwrap();
        assert_eq!(result["frame"], 777);
    }
    session.project.timelines[parent].tracks[0].clips[0].freeze = Some(31);
    let result = navigate(
        &session,
        child,
        &request(
            &session,
            child,
            20,
            Navigation::Exit {
                ancestors: vec![ancestor(&session, parent, Some(clip), 777)],
            },
        ),
    )
    .unwrap();
    assert_eq!(result["frame"], 777);
    let mut stale = ancestor(&session, parent, None, 777);
    stale.revision = "old".into();
    let before = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        navigate(
            &session,
            child,
            &request(
                &session,
                child,
                20,
                Navigation::Exit {
                    ancestors: vec![stale]
                }
            )
        )
        .unwrap_err()
        .1,
        "REVISION_CONFLICT"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
}

#[test]
fn navigation_dto_requires_explicit_fields_native_ids_safe_frames_and_bounded_distinct_ancestors() {
    let query = json!({"project_epoch":"p","if_generation":"0","timeline_id":"1","revision":"r","frame":0,"width":320});
    for action in [
        json!({"kind":"enter","clip_ids":[1]}),
        json!({"kind":"enter","clip_ids":["1"],"extra":true}),
        json!({"kind":"exit","ancestors":[{"timeline_id":"2","revision":"r","entry_playhead":0}]}),
        json!({"kind":"exit","ancestors":[{"timeline_id":"2","revision":"r","clip_id":null,"entry_playhead":0.5}]}),
        json!({"kind":"exit","ancestors":[],"extra":true}),
        json!({"kind":"other"}),
    ] {
        assert!(serde_json::from_value::<Request>(json!({"query":query,"action":action})).is_err());
    }
    for action in [
        json!({"kind":"enter","clip_ids":[]}),
        json!({"kind":"enter","clip_ids":["1","1"]}),
        json!({"kind":"enter","clip_ids":["01"]}),
        json!({"kind":"enter","clip_ids":["18446744073709551616"]}),
        json!({"kind":"exit","ancestors":[]}),
        json!({"kind":"exit","ancestors":[{"timeline_id":"1","revision":"r","clip_id":null,"entry_playhead":0}]}),
        json!({"kind":"exit","ancestors":[{"timeline_id":"2","revision":"r","clip_id":null,"entry_playhead":-1}]}),
    ] {
        let request: Request =
            serde_json::from_value(json!({"query":query,"action":action})).unwrap();
        assert!(request.validate().is_err());
    }
    let ancestors:Vec<_>=(2..=18).map(|id|json!({"timeline_id":id.to_string(),"revision":"r","clip_id":null,"entry_playhead":0})).collect();
    let request: Request = serde_json::from_value(
        json!({"query":query,"action":{"kind":"exit","ancestors":ancestors}}),
    )
    .unwrap();
    assert!(request.validate().is_err());
    let mut large: Request = serde_json::from_value(
        json!({"query":query,"action":{"kind":"enter","clip_ids":["9007199254740993"]}}),
    )
    .unwrap();
    assert!(large.validate().is_ok());
    large.query.frame = 1_000_000_001;
    assert!(large.validate().is_err());
}
