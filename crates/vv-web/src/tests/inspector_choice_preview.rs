use super::*;
use vv_core::{
    Clip, ClipFilter, ClipSource, Command, Interpolation, Keyframed, Rational, Timeline, Track,
    TrackKind,
};

fn fixture() -> (vv_session::Session, vv_core::TimelineId, Vec<String>) {
    let mut session = vv_session::Session::default();
    let timeline = session.create_timeline(Timeline {
        name: "Choice draft".into(),
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
        let mut clip = Clip::from_source_range(
            session.project.alloc_clip_id(),
            if track < 2 {
                ClipSource::Text
            } else {
                ClipSource::SolidColor
            },
            0,
            60,
            if track == 1 { 10 } else { 0 },
            if track == 1 {
                Rational::new(3, 2)
            } else {
                Rational::one()
            },
        );
        if track < 2 {
            let mut title = vv_core::TitleParams::default();
            title.content.default = format!("Own text {track}");
            title.case = if track == 0 {
                FontCase::Mixed
            } else {
                FontCase::Lower
            };
            title.background.width = 0.2 + track as f32 * 0.1;
            clip.effects.title = Some(title);
            for kind in [FilterKind::BoxBlur, FilterKind::GaussianBlur] {
                let mut filter = ClipFilter::new(kind);
                filter.enabled = false;
                filter.radius = Keyframed::constant(7.0 + track as f32);
                filter
                    .direction
                    .upsert(7, BlurDirection::Horizontal, Interpolation::Hold);
                filter
                    .direction
                    .upsert(50, BlurDirection::Both, Interpolation::Linear);
                clip.effects.filters.push(filter);
            }
            if track == 1 {
                clip.freeze = Some(40);
            }
        }
        clip.effects.masks = vec![
            vv_core::ClipMask::new(vv_core::MaskShape::Rectangle, (128, 72)),
            vv_core::ClipMask::new(vv_core::MaskShape::Ellipse, (128, 72)),
        ];
        clip.effects.masks[1].enabled = false;
        ids.push(clip.id.0.to_string());
        session.project.timelines[timeline].tracks[track].insert_sorted(clip);
    }
    let media = session.project.media_pool.insert(vv_core::MediaItem {
        path: "/not-opened-by-choice-drafts/audio.wav".into(),
        meta: vv_core::MediaMeta {
            duration_frames: 60,
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
    let clip = Clip::from_source_range(
        session.project.alloc_clip_id(),
        ClipSource::Media(media),
        0,
        60,
        0,
        Rational::one(),
    );
    ids.push(clip.id.0.to_string());
    session.project.timelines[timeline].tracks[3].insert_sorted(clip);
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
            project_epoch: "choice-epoch".into(),
            if_generation: session.history.generation().to_string(),
            revision: session.timeline_revision(timeline),
            frame: 19,
            width: 64,
        },
        size: (64, 36),
    }
}

fn request(snapshot: &FrameSnapshot, ids: &[String], choice: Choice) -> Request {
    Request {
        query: snapshot.query.clone(),
        clip_ids: ids.to_vec(),
        choice,
    }
}

#[test]
fn inspector_choice_drafts_match_native_mask_and_title_commands_without_authority_mutation() {
    let (session, timeline, ids) = fixture();
    let before = serde_json::to_value(&session.project).unwrap();
    let history = (
        session.history.generation(),
        session.history.position(),
        session.has_unsaved_changes(),
        session.timeline_revision(timeline),
    );
    for mode in vv_core::MaskMode::ALL {
        let captured = snapshot(&session, timeline);
        let request = request(&captured, &ids[2..3], Choice::MaskMode { index: 1, mode });
        let mut expected = session.project.clone();
        let clip = &expected.timelines[timeline].tracks[2].clips[0];
        let mut masks = clip.effects.masks.clone();
        masks[1].mode = mode;
        vv_core::set_clip_masks(timeline, 2, clip.id, masks).apply(&mut expected);
        let (draft, tag) = apply(captured, &request).unwrap();
        assert_eq!(
            serde_json::to_value(&draft.project).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        assert_eq!(tag.len(), 64);
        assert_eq!(draft.query.frame, 19);
        assert_eq!(draft.size, (64, 36));
    }
    for case in [FontCase::Upper, FontCase::Lower, FontCase::Title] {
        let captured = snapshot(&session, timeline);
        let request = request(
            &captured,
            &[ids[1].clone(), ids[2].clone(), ids[0].clone()],
            Choice::TitleCase { case },
        );
        let mut expected = session.project.clone();
        for track in 0..2 {
            let clip = &expected.timelines[timeline].tracks[track].clips[0];
            let mut title = clip.effects.title.clone().unwrap();
            title.case = case;
            vv_core::set_clip_title(timeline, track, clip.id, title).apply(&mut expected);
        }
        let (draft, _) = apply(captured, &request).unwrap();
        assert_eq!(
            serde_json::to_value(draft.project).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
    }
    let captured = snapshot(&session, timeline);
    let unchanged = request(
        &captured,
        &ids[..2],
        Choice::TitleCase {
            case: FontCase::Mixed,
        },
    );
    assert_eq!(
        serde_json::to_value(apply(captured, &unchanged).unwrap().0.project).unwrap(),
        before
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(
        (
            session.history.generation(),
            session.history.position(),
            session.has_unsaved_changes(),
            session.timeline_revision(timeline)
        ),
        history
    );
}

#[test]
fn inspector_choice_blur_draft_uses_native_animated_own_clocks_and_preserves_bypass_and_missing_peers()
 {
    let (session, timeline, ids) = fixture();
    let before = serde_json::to_value(&session.project).unwrap();
    for filter in [BlurFilter::BoxBlur, BlurFilter::GaussianBlur] {
        let captured = snapshot(&session, timeline);
        let request = request(
            &captured,
            &[ids[2].clone(), ids[1].clone(), ids[0].clone()],
            Choice::BlurDirection {
                filter,
                direction: BlurDirection::Vertical,
            },
        );
        let mut expected = session.project.clone();
        for track in 0..2 {
            let clip = &expected.timelines[timeline].tracks[track].clips[0];
            let frame =
                clip.source_frame_at(19_i64.clamp(clip.timeline_start, clip.timeline_end() - 1));
            if track == 1 {
                assert_ne!(Some(frame), clip.freeze);
            }
            vv_core::UpsertKeyframe::new(
                timeline,
                track,
                clip.id,
                frame,
                vv_core::KeyframeValue::FilterDirection(filter.native(), BlurDirection::Vertical),
                Interpolation::Linear,
            )
            .apply(&mut expected);
        }
        let (draft, _) = apply(captured, &request).unwrap();
        assert_eq!(
            serde_json::to_value(draft.project).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
    }
    assert_eq!(serde_json::to_value(session.project).unwrap(), before);
}

#[test]
fn inspector_choice_draft_rejects_stale_locked_ineligible_and_invalid_selections_atomically() {
    let (session, timeline, ids) = fixture();
    let baseline = serde_json::to_value(&session.project).unwrap();
    let captured = snapshot(&session, timeline);
    let base = request(
        &captured,
        &ids[..2],
        Choice::TitleCase {
            case: FontCase::Upper,
        },
    );
    for changed in [
        "epoch",
        "generation",
        "revision",
        "timeline",
        "frame",
        "width",
    ] {
        let mut value = base.clone();
        match changed {
            "epoch" => value.query.project_epoch.push('x'),
            "generation" => value.query.if_generation.push('x'),
            "revision" => value.query.revision.push('x'),
            "timeline" => value.query.timeline_id = "999".into(),
            "frame" => value.query.frame += 1,
            "width" => value.query.width = 32,
            _ => unreachable!(),
        }
        assert!(
            apply(snapshot(&session, timeline), &value).is_err(),
            "{changed}"
        );
    }
    for frame in [-1, session.project.timelines[timeline].total_frames()] {
        let mut invalid = snapshot(&session, timeline);
        invalid.query.frame = frame;
        let value = request(
            &invalid,
            &ids[..1],
            Choice::TitleCase {
                case: FontCase::Upper,
            },
        );
        assert!(apply(invalid, &value).is_err());
    }
    for clips in [
        vec![],
        vec![ids[0].clone(), ids[0].clone()],
        vec![ids[0].clone(), "99999".into()],
        vec![ids[3].clone()],
        vec![ids[2].clone()],
        vec!["x".into()],
    ] {
        let mut value = base.clone();
        value.clip_ids = clips;
        assert!(apply(snapshot(&session, timeline), &value).is_err());
    }
    for (clips, choice) in [
        (
            ids[..2].to_vec(),
            Choice::MaskMode {
                index: 0,
                mode: MaskMode::Subtract,
            },
        ),
        (
            vec![ids[2].clone()],
            Choice::MaskMode {
                index: 99,
                mode: MaskMode::Subtract,
            },
        ),
        (
            vec![ids[3].clone()],
            Choice::MaskMode {
                index: 0,
                mode: MaskMode::Subtract,
            },
        ),
        (
            vec![ids[2].clone()],
            Choice::BlurDirection {
                filter: BlurFilter::BoxBlur,
                direction: BlurDirection::Both,
            },
        ),
    ] {
        assert!(
            apply(
                snapshot(&session, timeline),
                &request(&captured, &clips, choice)
            )
            .is_err()
        );
    }
    for choice in [
        Choice::TitleCase {
            case: FontCase::Upper,
        },
        Choice::BlurDirection {
            filter: BlurFilter::GaussianBlur,
            direction: BlurDirection::Vertical,
        },
        Choice::MaskMode {
            index: 0,
            mode: MaskMode::Intersect,
        },
    ] {
        let mut locked = snapshot(&session, timeline);
        locked.project.timelines[timeline].tracks[0].locked = true;
        assert!(apply(locked, &request(&captured, &ids[..1], choice)).is_err());
    }
    let mut late_locked = snapshot(&session, timeline);
    late_locked.project.timelines[timeline].tracks[1].locked = true;
    assert!(apply(late_locked, &base).is_err());
    assert_eq!(serde_json::to_value(session.project).unwrap(), baseline);
}

#[test]
fn inspector_choice_schema_is_strict_and_tags_bind_the_whole_choice_and_selection() {
    let (session, timeline, ids) = fixture();
    let captured = snapshot(&session, timeline);
    let request = request(
        &captured,
        &ids[..1],
        Choice::TitleCase {
            case: FontCase::Title,
        },
    );
    let valid = serde_json::to_value(&request).unwrap();
    assert!(serde_json::from_value::<Request>(valid.clone()).is_ok());
    for field in ["outer", "choice", "query"] {
        let mut value = valid.clone();
        match field {
            "outer" => value["extra"] = true.into(),
            "choice" => value["choice"]["extra"] = true.into(),
            "query" => value["query"]["extra"] = true.into(),
            _ => unreachable!(),
        }
        assert!(serde_json::from_value::<Request>(value).is_err());
    }
    for choice in [
        serde_json::json!({"kind":"blur_direction","filter":"Exposure","direction":"Both"}),
        serde_json::json!({"kind":"mask_mode","index":0,"mode":"Multiply"}),
        serde_json::json!({"kind":"title_case","case":"Unknown"}),
        serde_json::json!({"kind":"title_font","font_weight":700}),
    ] {
        let mut value = valid.clone();
        value["choice"] = choice;
        assert!(serde_json::from_value::<Request>(value).is_err());
    }
    let (_, first) = apply(snapshot(&session, timeline), &request).unwrap();
    let (_, repeated) = apply(snapshot(&session, timeline), &request).unwrap();
    assert_eq!(first, repeated);
    let mut changed = request.clone();
    changed.choice = Choice::TitleCase {
        case: FontCase::Upper,
    };
    assert_ne!(
        first,
        apply(snapshot(&session, timeline), &changed).unwrap().1
    );
    changed = request.clone();
    changed.clip_ids.push(ids[1].clone());
    assert_ne!(
        first,
        apply(snapshot(&session, timeline), &changed).unwrap().1
    );
    let mut wrong_size = snapshot(&session, timeline);
    wrong_size.size = (32, 18);
    assert!(apply(wrong_size, &request).is_err());
}

#[test]
fn inspector_choice_compositing_matches_native_broadcast_and_preserves_saved_project_and_clocks() {
    let (mut session, timeline, ids) = fixture();
    session.project.timelines[timeline].tracks[1].clips[0]
        .effects
        .blend_mode = BlendMode::Screen;
    session.project.timelines[timeline].tracks[1].clips[0]
        .effects
        .matte = Some(vv_core::MatteMode::Luma);
    session.mark_saved();
    let before = serde_json::to_value(&session.project).unwrap();
    let history = (
        session.history.generation(),
        session.history.position(),
        session.has_unsaved_changes(),
        session.timeline_revision(timeline),
    );
    let selected = vec![ids[2].clone(), ids[0].clone(), ids[1].clone()];
    for blend in BlendMode::ALL {
        let captured = snapshot(&session, timeline);
        let value = request(&captured, &selected, Choice::BlendMode { blend });
        let mut expected = session.project.clone();
        for track in 0..3 {
            let clip_id = expected.timelines[timeline].tracks[track].clips[0].id;
            vv_core::set_clip_blend_mode(timeline, track, clip_id, blend).apply(&mut expected);
        }
        let draft = apply(captured, &value).unwrap().0;
        assert_eq!(
            serde_json::to_value(&draft.project).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        assert_eq!(draft.query.frame, 19);
    }
    for (matte, native) in [
        (Matte::None, None),
        (Matte::Alpha, Some(vv_core::MatteMode::Alpha)),
        (
            Matte::AlphaInverted,
            Some(vv_core::MatteMode::AlphaInverted),
        ),
        (Matte::Luma, Some(vv_core::MatteMode::Luma)),
        (Matte::LumaInverted, Some(vv_core::MatteMode::LumaInverted)),
    ] {
        let captured = snapshot(&session, timeline);
        let value = request(&captured, &selected, Choice::TrackMatte { matte });
        let mut expected = session.project.clone();
        for track in 0..3 {
            let clip_id = expected.timelines[timeline].tracks[track].clips[0].id;
            vv_core::set_clip_matte(timeline, track, clip_id, native).apply(&mut expected);
        }
        assert_eq!(
            serde_json::to_value(apply(captured, &value).unwrap().0.project).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
    }
    let captured = snapshot(&session, timeline);
    let single = request(
        &captured,
        &ids[..1],
        Choice::TrackMatte {
            matte: Matte::Alpha,
        },
    );
    let draft = apply(captured, &single).unwrap().0;
    assert_eq!(
        serde_json::to_value(&draft.project.timelines[timeline].tracks[1]).unwrap(),
        serde_json::to_value(&session.project.timelines[timeline].tracks[1]).unwrap()
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(
        (
            session.history.generation(),
            session.history.position(),
            session.has_unsaved_changes(),
            session.timeline_revision(timeline)
        ),
        history
    );
}

#[test]
fn inspector_choice_compositing_rejects_invalid_matte_schema_and_atomic_target_failures() {
    let (session, timeline, ids) = fixture();
    let before = serde_json::to_value(&session.project).unwrap();
    let captured = snapshot(&session, timeline);
    for choice in [
        Choice::BlendMode {
            blend: BlendMode::Multiply,
        },
        Choice::TrackMatte { matte: Matte::None },
    ] {
        for selected in [
            vec![],
            vec![ids[0].clone(), ids[0].clone()],
            vec![ids[0].clone(), "99999".into()],
            vec![ids[0].clone(), ids[3].clone()],
            vec![ids[0].clone(); 4097],
        ] {
            let value = request(&captured, &selected, choice.clone());
            assert!(apply(snapshot(&session, timeline), &value).is_err());
        }
        let mut locked = snapshot(&session, timeline);
        locked.project.timelines[timeline].tracks[1].locked = true;
        assert!(apply(locked, &request(&captured, &ids[..2], choice)).is_err());
    }
    let base = request(
        &captured,
        &ids[..1],
        Choice::TrackMatte { matte: Matte::None },
    );
    let encoded = serde_json::to_value(&base).unwrap();
    assert_eq!(encoded["choice"]["matte"], "None");
    assert!(serde_json::from_value::<Request>(encoded.clone()).is_ok());
    for choice in [
        serde_json::json!({"kind":"track_matte","matte":null}),
        serde_json::json!({"kind":"track_matte","matte":"Unknown"}),
        serde_json::json!({"kind":"track_matte"}),
        serde_json::json!({"kind":"track_matte","matte":{"mode":"Alpha"}}),
        serde_json::json!({"kind":"track_matte","matte":"Alpha","track":0}),
        serde_json::json!({"kind":"blend_mode","blend":"Unknown"}),
    ] {
        let mut invalid = encoded.clone();
        invalid["choice"] = choice;
        assert!(serde_json::from_value::<Request>(invalid).is_err());
    }
    let blend = request(
        &captured,
        &ids[..1],
        Choice::BlendMode {
            blend: BlendMode::Normal,
        },
    );
    assert_ne!(
        apply(snapshot(&session, timeline), &base).unwrap().1,
        apply(snapshot(&session, timeline), &blend).unwrap().1
    );
    assert_eq!(serde_json::to_value(session.project).unwrap(), before);
}
