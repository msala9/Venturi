use super::*;
use vv_core::attributes::{Attribute, KeyframeMode};

#[test]
fn selected_properties_use_native_mapping_per_kind_and_one_complete_undo() {
    let (mut session, id, selected) = fixture();
    let timeline = &mut session.project.timelines[id];
    timeline.tracks[0].clips[0]
        .effects
        .transform
        .track_mut(core::TransformParam::Opacity)
        .upsert(5, 42.0, core::Interpolation::EaseInOut);
    timeline.tracks[1].clips[0].effects.gain_db.default = 6.0;
    timeline.tracks[0].clips[1]
        .effects
        .transform
        .track_mut(core::TransformParam::PositionX)
        .default = 3.0;
    timeline.tracks[1].clips[1].effects.gain_db.default = -3.0;
    let clipboard = copy(&session, id, &selected[..1]).unwrap();
    let revision = clipboard.revision(&session).unwrap().to_owned();
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let steps = session.history.position();
    paste_attributes(
        &mut session,
        id,
        &clipboard,
        &revision,
        &selected[1..],
        &[Attribute::Opacity, Attribute::Volume],
        KeyframeMode::MaintainTiming,
    )
    .unwrap();
    assert_eq!(session.history.position(), steps + 1);
    let timeline = &session.project.timelines[id];
    let video = &timeline.tracks[0].clips[1];
    assert_eq!(
        video
            .effects
            .transform
            .track(core::TransformParam::Opacity)
            .keyframes()[0],
        (29, 42.0, core::Interpolation::EaseInOut)
    );
    assert_eq!(
        video
            .effects
            .transform
            .track(core::TransformParam::PositionX)
            .default,
        3.0
    );
    assert_eq!(timeline.tracks[1].clips[1].effects.gain_db.default, 6.0);
    assert_eq!((video.timeline_start, video.timeline_len), (34, 24));
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
}

#[test]
fn property_paste_refuses_stale_clipboards_and_whole_locked_groups_without_partial_changes() {
    let (mut session, id, selected) = fixture();
    let steps = session.history.position();
    let clipboard = copy(&session, id, &selected[..1]).unwrap();
    let revision = clipboard.revision(&session).unwrap().to_owned();
    let before = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        paste_attributes(
            &mut session,
            id,
            &clipboard,
            "changed",
            &selected[1..],
            &[Attribute::Masks],
            KeyframeMode::StretchToFit
        )
        .unwrap_err()
        .1,
        "CLIPBOARD_STALE"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    session.project.timelines[id].tracks[1].locked = true;
    let before = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        paste_attributes(
            &mut session,
            id,
            &clipboard,
            &revision,
            &selected[1..],
            &[Attribute::Masks],
            KeyframeMode::StretchToFit
        )
        .unwrap_err()
        .1,
        "TRACK_LOCKED"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), steps);
}

#[test]
fn pasted_speed_uses_native_linked_ripple_and_undo_restores_following_clips() {
    let (mut session, id, selected) = fixture();
    let after_id = session.project.alloc_clip_id();
    let timeline = &mut session.project.timelines[id];
    for track in &mut timeline.tracks {
        track.crossings.clear();
        track.clips[0].set_speed(core::Rational::new(2, 1), core::Rational::one());
        track.clips[0].pitch_correction = true;
    }
    timeline.tracks[0].insert_sorted(core::Clip::from_source_range(
        after_id,
        core::ClipSource::SolidColor,
        0,
        10,
        60,
        core::Rational::one(),
    ));
    let clipboard = copy(&session, id, &selected[..1]).unwrap();
    let revision = clipboard.revision(&session).unwrap().to_owned();
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    paste_attributes(
        &mut session,
        id,
        &clipboard,
        &revision,
        &selected[1..],
        &[Attribute::Speed],
        KeyframeMode::MaintainTiming,
    )
    .unwrap();
    let timeline = &session.project.timelines[id];
    for track in &timeline.tracks {
        let target = &track.clips[1];
        assert_eq!(
            (target.speed(), target.pitch_correction, target.timeline_len),
            (core::Rational::new(2, 1), true, 12)
        );
    }
    assert_eq!(timeline.clip(0, after_id).unwrap().timeline_start, 48);
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
}
#[test]
fn pasted_speed_refuses_ripple_that_would_separate_a_locked_downstream_link() {
    let (mut session, id, selected) = fixture();
    let video = session.project.alloc_clip_id();
    let audio = session.project.alloc_clip_id();
    let timeline = &mut session.project.timelines[id];
    for track in &mut timeline.tracks {
        track.crossings.clear();
        track.clips[0].set_speed(core::Rational::new(2, 1), core::Rational::one());
    }
    let mut following = core::Clip::from_source_range(
        video,
        core::ClipSource::SolidColor,
        0,
        10,
        60,
        core::Rational::one(),
    );
    following.linked_group = Some(core::LinkGroupId(100));
    timeline.tracks[0].insert_sorted(following.clone());
    following.id = audio;
    let mut locked = core::Track::new(core::TrackKind::Audio);
    locked.locked = true;
    locked.insert_sorted(following);
    timeline.tracks.push(locked);
    let clipboard = copy(&session, id, &selected[..1]).unwrap();
    let revision = clipboard.revision(&session).unwrap().to_owned();
    let before = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        paste_attributes(
            &mut session,
            id,
            &clipboard,
            &revision,
            &selected[1..],
            &[Attribute::Speed],
            KeyframeMode::MaintainTiming
        )
        .unwrap_err()
        .1,
        "LINKED_SYNC"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
}

fn fixture() -> (Session, TimelineId, Vec<String>) {
    let mut session = Session::default();
    let id = session.create_timeline(core::Timeline {
        name: "Clipboard".into(),
        fps: core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![
            core::Track::new(core::TrackKind::Video),
            core::Track::new(core::TrackKind::Audio),
        ],
        markers: vec![],
        master: Default::default(),
    });
    let media = session.add_media(
        "clipboard.mp4".into(),
        core::MediaMeta {
            duration_frames: 48,
            fps: core::Rational::new(24, 1),
            width: 640,
            height: 360,
            has_video: true,
            has_audio: true,
            sample_rate: 48000,
            channels: 2,
            audio_streams: 1,
            file: Default::default(),
        },
    );
    let mut selected = vec![];
    for part in 0..2 {
        for track in 0..2 {
            let clip_id = session.project.alloc_clip_id();
            let mut clip = core::Clip::from_source_range(
                clip_id,
                core::ClipSource::Media(media),
                part * 24,
                (part + 1) * 24,
                10 + part * 24,
                core::Rational::one(),
            );
            clip.linked_group = Some(core::LinkGroupId(9 + part as u64));
            clip.effects
                .transform
                .track_mut(core::TransformParam::PositionX)
                .upsert(6, 20.0, core::Interpolation::Linear);
            clip.effects
                .masks
                .push(core::ClipMask::new(core::MaskShape::Ellipse, (640, 360)));
            session.project.timelines[id].tracks[track].insert_sorted(clip);
            if track == 0 {
                selected.push(clip_id.0.to_string());
            }
        }
    }
    let left = session.project.timelines[id].tracks[0].clips[0].id;
    let right = session.project.timelines[id].tracks[0].clips[1].id;
    session.project.timelines[id].tracks[0]
        .crossings
        .push(core::CrossTransition {
            left_clip: left,
            right_clip: right,
            transition: core::Transition {
                kind: core::TransitionKind::CrossDissolve,
                duration: 12,
                direction: core::PushDirection::Left,
                ease: core::Ease::InOut,
                curve: 0.5,
            },
        });
    (session, id, selected)
}
#[test]
fn clipboard_keeps_effects_links_crossings_and_refuses_any_partial_paste() {
    let (mut session, id, selected) = fixture();
    session.project.timelines[id].tracks[0].locked = true;
    let steps = session.history.position();
    let clipboard = copy(&session, id, &selected).unwrap();
    assert_eq!(clipboard.count(&session), 4);
    assert_eq!(session.history.position(), steps);
    let before = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        paste(&mut session, id, &clipboard, 98).unwrap_err().1,
        "TRACK_LOCKED"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    session.project.timelines[id].tracks[0].locked = false;
    let before = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        paste(&mut session, id, &clipboard, 0).unwrap_err().1,
        "OVERLAP"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    let revision = session.timeline_revision(id);
    paste(&mut session, id, &clipboard, 98).unwrap();
    assert_eq!(session.history.position(), steps + 1);
    let timeline = &session.project.timelines[id];
    assert_eq!(timeline.tracks[0].clips.len(), 4);
    assert_eq!(timeline.tracks[1].clips.len(), 4);
    assert_eq!(timeline.tracks[0].crossings.len(), 2);
    for track in &timeline.tracks {
        for part in 0..2 {
            let original = &track.clips[part];
            let pasted = &track.clips[part + 2];
            assert_ne!(original.id, pasted.id);
            assert_ne!(original.linked_group, pasted.linked_group);
            assert_eq!(pasted.timeline_start, 98 + part as i64 * 24);
            assert_eq!(
                serde_json::to_value(&pasted.effects).unwrap(),
                serde_json::to_value(&original.effects).unwrap()
            );
        }
    }
    assert_eq!(
        timeline.tracks[0].clips[2].linked_group,
        timeline.tracks[1].clips[2].linked_group
    );
    session.history.undo(&mut session.project);
    assert_eq!(session.timeline_revision(id), revision);
}
#[test]
fn paste_adds_missing_tracks_in_one_undo_but_refuses_mismatched_fps_and_epochs() {
    let (mut session, source, selected) = fixture();
    let clipboard = copy(&session, source, &selected).unwrap();
    let target = session.create_timeline(core::Timeline {
        name: "Target".into(),
        fps: core::Rational::new(30, 1),
        resolution: (640, 360),
        tracks: vec![core::Track::new(core::TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let before = serde_json::to_value(&session.project).unwrap();
    assert!(paste(&mut session, target, &clipboard, 0).is_err());
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    session.project.timelines[target].fps = core::Rational::new(24, 1);
    let steps = session.history.position();
    paste(&mut session, target, &clipboard, 0).unwrap();
    assert_eq!(session.history.position(), steps + 1);
    assert_eq!(session.project.timelines[target].tracks.len(), 2);
    session.history.undo(&mut session.project);
    assert_eq!(session.project.timelines[target].tracks.len(), 1);
    assert!(session.project.timelines[target].tracks[0].clips.is_empty());
    session.install_project(core::Project::default(), None);
    assert_eq!(
        paste(&mut session, target, &clipboard, 0).unwrap_err().1,
        "CLIPBOARD_STALE"
    );
}
#[test]
fn copied_compounds_cannot_be_pasted_inside_their_own_child() {
    let (mut session, id, selected) = fixture();
    commands::apply(
        &mut session,
        id,
        &commands::Operation::MakeCompound {
            clip_ids: selected,
            name: "Child".into(),
        },
    )
    .unwrap();
    let outer = session.project.timelines[id].tracks[0].clips[0]
        .id
        .0
        .to_string();
    let clipboard = copy(&session, id, &[outer]).unwrap();
    let child = session
        .project
        .timelines
        .keys()
        .find(|key| *key != id)
        .unwrap();
    let before = serde_json::to_value(&session.project).unwrap();
    assert!(
        paste(&mut session, child, &clipboard, 100)
            .unwrap_err()
            .2
            .contains("cycle")
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
}
