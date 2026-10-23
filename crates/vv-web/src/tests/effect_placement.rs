use super::*;
use crate::commands::Operation;
use serde_json::json;

fn fixture() -> (Session, TimelineId) {
    let mut session = Session::default();
    let id = session.create_timeline(core::Timeline {
        name: "Palette effects".into(),
        fps: core::Rational::new(30000, 1001),
        resolution: (640, 360),
        tracks: vec![
            core::Track::new(TrackKind::Video),
            core::Track::new(TrackKind::Audio),
        ],
        markers: vec![],
        master: Default::default(),
    });
    (session, id)
}

fn state(session: &Session) -> (String, usize, u64) {
    (
        ron::to_string(&session.project).unwrap(),
        session.history.position(),
        session.history.generation(),
    )
}

#[test]
fn effect_palette_generators_match_native_defaults_and_append_as_one_undo() {
    for generator in [Generator::Title, Generator::Solid, Generator::Adjustment] {
        let (mut session, id) = fixture();
        let before = ron::to_string(&session.project.timelines[id]).unwrap();
        let mut oracle = session.project.clone();
        let mut history = core::History::default();
        insert(&mut oracle, &mut history, id, generator, 2, true, 17);
        let position = session.history.position();
        super::generator(
            &mut session,
            id,
            generator,
            17,
            &AssetDropTarget::NewVideoTrack {},
            false,
        )
        .unwrap();
        assert_eq!(
            ron::to_string(&session.project).unwrap(),
            ron::to_string(&oracle).unwrap()
        );
        assert_eq!(session.history.position(), position + 1);
        let clip = &session.project.timelines[id].tracks[2].clips[0];
        assert_eq!((clip.timeline_start, clip.timeline_len), (17, 150));
        let after = ron::to_string(&session.project).unwrap();
        session.history.undo(&mut session.project);
        history.undo(&mut oracle);
        assert_eq!(
            ron::to_string(&session.project.timelines[id]).unwrap(),
            before
        );
        assert_eq!(
            ron::to_string(&session.project).unwrap(),
            ron::to_string(&oracle).unwrap()
        );
        session.history.redo(&mut session.project);
        assert_eq!(ron::to_string(&session.project).unwrap(), after);
    }
}

#[test]
fn effect_palette_target_policy_refuses_atomically_and_overwrite_uses_native_undo() {
    let (mut session, id) = fixture();
    super::generator(
        &mut session,
        id,
        Generator::Solid,
        0,
        &AssetDropTarget::Track {
            track_id: "1".into(),
        },
        false,
    )
    .unwrap();
    assert_eq!(session.project.timelines[id].tracks[0].clips.len(), 1);
    assert!(session.project.timelines[id].tracks[1].clips.is_empty());
    for target in [
        AssetDropTarget::Track {
            track_id: "0".into(),
        },
        AssetDropTarget::Track {
            track_id: "99".into(),
        },
        AssetDropTarget::NewAudioTrack {},
    ] {
        let before = state(&session);
        assert!(super::generator(&mut session, id, Generator::Title, 10, &target, false).is_err());
        assert_eq!(state(&session), before);
    }
    session.project.timelines[id].tracks[1].locked = true;
    let before = state(&session);
    assert!(
        super::generator(
            &mut session,
            id,
            Generator::Title,
            200,
            &AssetDropTarget::Track {
                track_id: "1".into()
            },
            false
        )
        .is_err()
    );
    assert_eq!(state(&session), before);
    let before = ron::to_string(&session.project.timelines[id]).unwrap();
    let before_media = ron::to_string(&session.project.media_pool).unwrap();
    let position = session.history.position();
    super::generator(
        &mut session,
        id,
        Generator::Adjustment,
        10,
        &AssetDropTarget::Track {
            track_id: "0".into(),
        },
        true,
    )
    .unwrap();
    assert_eq!(session.history.position(), position + 1);
    assert!(
        session.project.timelines[id].tracks[0]
            .clips
            .iter()
            .any(|clip| matches!(clip.source, core::ClipSource::Adjustment))
    );
    session.history.undo(&mut session.project);
    assert_eq!(
        ron::to_string(&session.project.timelines[id]).unwrap(),
        before
    );
    assert_eq!(
        ron::to_string(&session.project.media_pool).unwrap(),
        before_media
    );
    session.project.timelines[id]
        .tracks
        .resize_with(128, || core::Track::new(TrackKind::Video));
    let before = state(&session);
    assert!(
        super::generator(
            &mut session,
            id,
            Generator::Solid,
            0,
            &AssetDropTarget::NewVideoTrack {},
            false
        )
        .is_err()
    );
    assert_eq!(state(&session), before);
}

#[test]
fn effect_palette_filter_reenables_in_place_preserves_animation_and_targets_only_one_clip() {
    let (mut session, id) = fixture();
    let first = edit::insert_generator(
        &mut session.project,
        &mut session.history,
        id,
        edit::Generator::SolidColor,
        0,
        0,
        Some(150),
    );
    let second = edit::insert_generator(
        &mut session.project,
        &mut session.history,
        id,
        edit::Generator::Text,
        0,
        180,
        Some(150),
    );
    let mut blur = core::ClipFilter::new(core::FilterKind::GaussianBlur);
    blur.enabled = false;
    blur.radius.upsert(12, 17.0, core::Interpolation::Linear);
    let exposure = core::ClipFilter::new(core::FilterKind::Exposure);
    session.project.timelines[id].tracks[0].clips[0]
        .effects
        .filters = vec![exposure.clone(), blur.clone()];
    let before = ron::to_string(&session.project).unwrap();
    let position = session.history.position();
    filter(
        &mut session,
        id,
        &first.0.to_string(),
        core::FilterKind::GaussianBlur,
        None,
    )
    .unwrap();
    let mut enabled = blur;
    enabled.enabled = true;
    assert_eq!(
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .filters,
        vec![exposure, enabled]
    );
    assert!(
        session.project.timelines[id]
            .clip(0, second)
            .unwrap()
            .effects
            .filters
            .is_empty()
    );
    assert_eq!(session.history.position(), position + 1);
    let unchanged = state(&session);
    filter(
        &mut session,
        id,
        &first.0.to_string(),
        core::FilterKind::GaussianBlur,
        None,
    )
    .unwrap();
    assert_eq!(state(&session), unchanged);
    session.history.undo(&mut session.project);
    assert_eq!(ron::to_string(&session.project).unwrap(), before);
    session.history.redo(&mut session.project);
    filter(
        &mut session,
        id,
        &second.0.to_string(),
        core::FilterKind::ColorCorrection,
        Some(Preset::BlackAndWhite),
    )
    .unwrap();
    let mut native = core::ClipFilter::new(core::FilterKind::ColorCorrection);
    native.grade.apply_preset(core::GradePreset::BlackAndWhite);
    assert_eq!(
        session.project.timelines[id]
            .clip(0, second)
            .unwrap()
            .effects
            .filters,
        vec![native]
    );
    session.project.timelines[id].tracks[0].locked = true;
    let before = state(&session);
    assert!(
        filter(
            &mut session,
            id,
            &second.0.to_string(),
            core::FilterKind::Exposure,
            None
        )
        .is_err()
    );
    assert_eq!(state(&session), before);
}

#[test]
fn effect_palette_wire_rejects_unknown_values_and_preserves_legacy_add_generator() {
    for value in [
        json!({"kind":"place_generator","generator":"noise","start_frame":0,"target":{"kind":"new_video_track"}}),
        json!({"kind":"place_generator","generator":"title","start_frame":0,"target":{"kind":"new_video_track"},"extra":true}),
        json!({"kind":"apply_palette_filter","clip_id":"1","filter":"ColorCorrection","preset":"Neutral"}),
    ] {
        assert!(serde_json::from_value::<Operation>(value).is_err());
    }
    let legacy = json!({"kind":"add_generator","generator":"title","track":"0","start_frame":0,"length_frames":24});
    let operation: Operation = serde_json::from_value(legacy.clone()).unwrap();
    assert_eq!(serde_json::to_value(operation).unwrap(), legacy);
    let (mut session, id) = fixture();
    let before = state(&session);
    assert!(
        filter(
            &mut session,
            id,
            "missing",
            core::FilterKind::Exposure,
            Some(Preset::BlackAndWhite)
        )
        .is_err()
    );
    assert_eq!(state(&session), before);
}
