use self::core::ClipId;
use super::*;
use crate::commands::{self, Operation};
use serde_json::{Value, json};

fn fixture(
    fps: core::Rational,
    media_fps: core::Rational,
    first: i64,
    last: i64,
    start: i64,
) -> (Session, TimelineId, ClipId) {
    let mut session = Session::default();
    let media = session.add_media(
        "retime.mp4".into(),
        core::MediaMeta {
            duration_frames: 6000,
            fps: media_fps,
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
    let id = session.create_timeline(core::Timeline {
        name: "Retime".into(),
        fps,
        resolution: (640, 360),
        tracks: vec![
            core::Track::new(core::TrackKind::Video),
            core::Track::new(core::TrackKind::Audio),
            core::Track::new(core::TrackKind::Video),
        ],
        markers: vec![],
        master: Default::default(),
    });
    let clip_id = session.project.alloc_clip_id();
    session.project.timelines[id].tracks[0].insert_sorted(core::Clip::from_source_range(
        clip_id,
        core::ClipSource::Media(media),
        first,
        last,
        start,
        core::Rational::conform_rate(fps, media_fps),
    ));
    session.sync_timeline_media(id);
    (session, id, clip_id)
}

fn basic() -> (Session, TimelineId, ClipId) {
    fixture(
        core::Rational::new(24, 1),
        core::Rational::new(24, 1),
        0,
        48,
        0,
    )
}
fn timeline(session: &Session, id: TimelineId) -> Value {
    serde_json::to_value(&session.project.timelines[id]).unwrap()
}
fn project(session: &Session) -> Value {
    serde_json::to_value(&session.project).unwrap()
}
fn edit(
    session: &mut Session,
    id: TimelineId,
    clip: ClipId,
    end: i64,
    overwrite: bool,
) -> Result<()> {
    commands::apply(
        session,
        id,
        &Operation::RetimeClip {
            clip_id: clip.0.to_string(),
            end_frame: end,
            overwrite,
        },
    )
}
fn linked(
    session: &mut Session,
    id: TimelineId,
    primary: ClipId,
    track: usize,
    first: i64,
    last: i64,
    start: i64,
) -> ClipId {
    let source = session.project.timelines[id]
        .clip(0, primary)
        .unwrap()
        .source
        .clone();
    session.project.timelines[id]
        .clip_mut(0, primary)
        .unwrap()
        .linked_group = Some(core::LinkGroupId(10));
    let clip_id = session.project.alloc_clip_id();
    let mut clip =
        core::Clip::from_source_range(clip_id, source, first, last, start, core::Rational::one());
    clip.linked_group = Some(core::LinkGroupId(10));
    session.project.timelines[id].tracks[track].insert_sorted(clip);
    clip_id
}
fn solid(
    session: &mut Session,
    id: TimelineId,
    track: usize,
    start: i64,
    length: i64,
    group: Option<u64>,
) -> ClipId {
    let clip_id = session.project.alloc_clip_id();
    let mut clip = core::Clip::from_source_range(
        clip_id,
        core::ClipSource::SolidColor,
        0,
        length,
        start,
        core::Rational::one(),
    );
    clip.linked_group = group.map(core::LinkGroupId);
    clip.effects.transition_in = Some(core::Transition {
        kind: core::TransitionKind::Push,
        duration: 3,
        direction: core::PushDirection::Up,
        ease: core::Ease::Out,
        curve: 0.75,
    });
    session.project.timelines[id].tracks[track].insert_sorted(clip);
    clip_id
}

fn short_media(session: &mut Session, id: TimelineId, track: usize, clip: ClipId) {
    let media = session.add_media(
        "short-retime.mp4".into(),
        core::MediaMeta {
            duration_frames: 100,
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
    session.project.timelines[id]
        .clip_mut(track, clip)
        .unwrap()
        .source = core::ClipSource::Media(media);
}

#[test]
fn fractional_conform_and_offset_retime_reaches_exact_odd_end_with_native_ratio_and_undo() {
    let (mut session, id, clip) = fixture(
        core::Rational::new(30000, 1001),
        core::Rational::new(24, 1),
        8,
        88,
        11,
    );
    let original = timeline(&session, id);
    let steps = session.history.position();
    let bounds = metadata(
        &session.project,
        &session.project.timelines[id],
        session.project.timelines[id].clip(0, clip).unwrap(),
    )
    .unwrap();
    assert_eq!(bounds.source_span, 100);
    assert_eq!(bounds.min_length, 1);
    assert_eq!(bounds.max_length, 10000);
    let mut native = session.project.clone();
    core::SetClipSpeed::new(
        id,
        vec![(0, clip)],
        core::Rational::new(100, 73),
        bounds.pitch_correction,
        core::SpeedFit::ResizeTo { from: 111, to: 84 },
    )
    .apply(&mut native);
    edit(&mut session, id, clip, 84, false).unwrap();
    let value = session.project.timelines[id].clip(0, clip).unwrap();
    assert_eq!(value.timeline_end(), 84);
    assert_eq!(value.timeline_start, 11);
    assert_eq!(value.source_in(), 8);
    assert_eq!(value.speed(), core::Rational::new(100, 73));
    assert_eq!(
        timeline(&session, id),
        serde_json::to_value(&native.timelines[id]).unwrap()
    );
    assert_eq!(session.history.position(), steps + 1);
    assert_eq!(
        session.history.labels().last(),
        Some(core::CommandLabel::ClipSpeed)
    );
    let after = timeline(&session, id);
    commands::apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(timeline(&session, id), original);
    commands::apply(&mut session, id, &Operation::Redo).unwrap();
    assert_eq!(timeline(&session, id), after);
}

#[test]
fn linked_equal_and_different_ends_follow_native_speed_and_primary_pitch_without_touching_locked_tracks()
 {
    let (mut session, id, clip) = basic();
    let equal = linked(&mut session, id, clip, 1, 10, 58, 0);
    let different = linked(&mut session, id, clip, 2, 0, 24, 0);
    session.project.timelines[id]
        .clip_mut(0, clip)
        .unwrap()
        .pitch_correction = true;
    session.project.timelines[id]
        .clip_mut(1, equal)
        .unwrap()
        .pitch_correction = false;
    session.project.timelines[id]
        .clip_mut(2, different)
        .unwrap()
        .pitch_correction = false;
    session.project.timelines[id]
        .tracks
        .push(core::Track::new(core::TrackKind::Video));
    solid(&mut session, id, 3, 0, 150, None);
    session.project.timelines[id].tracks[3].locked = true;
    let before = timeline(&session, id);
    let locked = before["tracks"][3].clone();
    edit(&mut session, id, clip, 72, false).unwrap();
    for (track, target, end) in [(0, clip, 72), (1, equal, 72), (2, different, 36)] {
        let value = session.project.timelines[id].clip(track, target).unwrap();
        assert_eq!(value.timeline_end(), end);
        assert_eq!(value.speed(), core::Rational::new(2, 3));
        assert!(value.pitch_correction);
    }
    assert_eq!(timeline(&session, id)["tracks"][3], locked);
    commands::apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(timeline(&session, id), before);
}

#[test]
fn existing_speed_uses_the_native_source_span_and_snapshot_bounds_follow_timeline_capacity() {
    let (mut session, id, clip) = basic();
    session.project.timelines[id]
        .clip_mut(0, clip)
        .unwrap()
        .set_speed(core::Rational::new(2, 1), core::Rational::one());
    assert_eq!(
        session.project.timelines[id]
            .clip(0, clip)
            .unwrap()
            .timeline_len,
        24
    );
    assert_eq!(
        metadata(
            &session.project,
            &session.project.timelines[id],
            session.project.timelines[id].clip(0, clip).unwrap()
        )
        .unwrap()
        .source_span,
        47
    );
    edit(&mut session, id, clip, 35, false).unwrap();
    assert_eq!(
        session.project.timelines[id].clip(0, clip).unwrap().speed(),
        core::Rational::new(47, 35)
    );
    let before = project(&session);
    let steps = session.history.position();
    edit(&mut session, id, clip, 35, false).unwrap();
    assert_eq!(project(&session), before);
    assert_eq!(session.history.position(), steps);
    session.project.timelines[id]
        .clip_mut(0, clip)
        .unwrap()
        .timeline_start = MAX_FRAME - 100;
    let bounds = metadata(
        &session.project,
        &session.project.timelines[id],
        session.project.timelines[id].clip(0, clip).unwrap(),
    )
    .unwrap();
    assert_eq!(bounds.max_length, 100);
}

#[test]
fn no_motion_after_undo_redo_preserves_compound_media_hashes_and_all_project_data() {
    let (mut session, id, clip) = basic();
    edit(&mut session, id, clip, 72, false).unwrap();
    commands::apply(&mut session, id, &Operation::Undo).unwrap();
    commands::apply(&mut session, id, &Operation::Redo).unwrap();
    let before = project(&session);
    let generation = session.history.generation();
    let position = session.history.position();
    edit(&mut session, id, clip, 72, false).unwrap();
    assert_eq!(project(&session), before);
    assert_eq!(session.history.generation(), generation);
    assert_eq!(session.history.position(), position);
}

#[test]
fn frozen_clip_unfreezes_natively_and_an_unreachable_endpoint_is_rejected_atomically() {
    let (mut session, id, clip) = basic();
    session.project.timelines[id]
        .clip_mut(0, clip)
        .unwrap()
        .freeze = Some(12);
    let before = timeline(&session, id);
    edit(&mut session, id, clip, 96, false).unwrap();
    assert_eq!(
        session.project.timelines[id].clip(0, clip).unwrap().freeze,
        None
    );
    commands::apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(timeline(&session, id), before);
    session.project.timelines[id]
        .clip_mut(0, clip)
        .unwrap()
        .timeline_len = 8000;
    let before = project(&session);
    let steps = session.history.position();
    assert!(edit(&mut session, id, clip, 16000, false).is_err());
    assert_eq!(project(&session), before);
    assert_eq!(session.history.position(), steps);
}

#[test]
fn equal_ended_follower_source_cap_rejects_the_whole_group_without_mutation() {
    let (mut session, id, clip) = basic();
    let follower = linked(&mut session, id, clip, 1, 95, 100, 43);
    short_media(&mut session, id, 1, follower);
    let before = project(&session);
    let steps = session.history.position();
    let mut native = session.project.clone();
    core::SetClipSpeed::new(
        id,
        vec![(0, clip), (1, follower)],
        core::Rational::new(1, 2),
        true,
        core::SpeedFit::ResizeTo { from: 48, to: 96 },
    )
    .apply(&mut native);
    assert_eq!(
        native.timelines[id].clip(0, clip).unwrap().timeline_end(),
        96
    );
    assert_eq!(
        native.timelines[id]
            .clip(1, follower)
            .unwrap()
            .timeline_end(),
        53
    );
    assert!(edit(&mut session, id, clip, 96, true).is_err());
    assert_eq!(project(&session), before);
    assert_eq!(session.history.position(), steps);
}

#[test]
fn equal_ended_follower_start_blocks_a_shorter_requested_end_atomically() {
    let (mut session, id, clip) = basic();
    let follower = linked(&mut session, id, clip, 1, 0, 5, 43);
    let before = project(&session);
    let steps = session.history.position();
    assert!(
        session.project.timelines[id]
            .clip(1, follower)
            .unwrap()
            .timeline_start
            > 24
    );
    assert!(edit(&mut session, id, clip, 24, false).is_err());
    assert_eq!(project(&session), before);
    assert_eq!(session.history.position(), steps);
}

#[test]
fn differently_ended_follower_with_unrepresentable_source_after_retime_is_rejected_atomically() {
    let (mut session, id, clip) = fixture(
        core::Rational::new(24, 1),
        core::Rational::new(24, 1),
        0,
        1000,
        0,
    );
    let follower = linked(&mut session, id, clip, 1, 99, 100, 0);
    short_media(&mut session, id, 1, follower);
    let before = project(&session);
    let steps = session.history.position();
    let mut native = session.project.clone();
    core::SetClipSpeed::new(
        id,
        vec![(0, clip), (1, follower)],
        core::Rational::new(100, 1),
        true,
        core::SpeedFit::ResizeTo { from: 1000, to: 10 },
    )
    .apply(&mut native);
    assert_eq!(
        native.timelines[id].clip(1, follower).unwrap().source_in(),
        149
    );
    assert!(edit(&mut session, id, clip, 10, false).is_err());
    assert_eq!(project(&session), before);
    assert_eq!(session.history.position(), steps);
}

#[test]
fn safe_growth_rejects_collision_without_allocator_or_history_changes_and_shrink_leaves_gap() {
    let (mut session, id, clip) = basic();
    let neighbour = solid(&mut session, id, 0, 60, 48, None);
    let before = project(&session);
    let steps = session.history.position();
    assert_eq!(
        edit(&mut session, id, clip, 96, false).unwrap_err().1,
        "OVERLAP"
    );
    assert_eq!(project(&session), before);
    assert_eq!(session.history.position(), steps);
    edit(&mut session, id, clip, 24, false).unwrap();
    assert_eq!(
        session.project.timelines[id]
            .clip(0, clip)
            .unwrap()
            .timeline_end(),
        24
    );
    assert_eq!(
        session.project.timelines[id]
            .clip(0, neighbour)
            .unwrap()
            .timeline_start,
        60
    );
}

#[test]
fn explicit_overwrite_trims_or_deletes_natively_in_one_undo_redo_and_preserves_unrelated_tracks() {
    for length in [24, 96] {
        let (mut session, id, clip) = basic();
        let neighbour = solid(&mut session, id, 0, 60, length, None);
        solid(&mut session, id, 2, 0, 200, None);
        let before = timeline(&session, id);
        let steps = session.history.position();
        edit(&mut session, id, clip, 96, true).unwrap();
        let target = session.project.timelines[id].clip(0, neighbour);
        if length == 24 {
            assert!(target.is_none())
        } else {
            let target = target.unwrap();
            assert_eq!(target.timeline_start, 96);
            assert_eq!(target.timeline_end(), 156);
            assert_eq!(
                serde_json::to_value(&target.effects).unwrap(),
                before["tracks"][0]["clips"][1]["effects"]
            );
        }
        assert_eq!(timeline(&session, id)["tracks"][2], before["tracks"][2]);
        assert_eq!(session.history.position(), steps + 1);
        let after = timeline(&session, id);
        commands::apply(&mut session, id, &Operation::Undo).unwrap();
        assert_eq!(timeline(&session, id), before);
        commands::apply(&mut session, id, &Operation::Redo).unwrap();
        assert_eq!(timeline(&session, id), after);
    }
}

#[test]
fn overwrite_requires_complete_aligned_foreign_linked_groups_and_never_changes_locked_members() {
    for scenario in 0..4 {
        let (mut session, id, clip) = basic();
        linked(&mut session, id, clip, 1, 0, 48, 0);
        let first = solid(&mut session, id, 0, 60, 96, Some(20));
        let second_track = if scenario <= 1 { 2 } else { 1 };
        let second = solid(
            &mut session,
            id,
            second_track,
            if scenario == 2 { 61 } else { 60 },
            96,
            Some(20),
        );
        let source = session.project.timelines[id]
            .clip(0, clip)
            .unwrap()
            .source
            .clone();
        session.project.timelines[id]
            .clip_mut(0, first)
            .unwrap()
            .source = source.clone();
        session.project.timelines[id]
            .clip_mut(second_track, second)
            .unwrap()
            .source = source;
        if scenario == 1 {
            session.project.timelines[id].tracks[2].locked = true;
        }
        let before = project(&session);
        let original = timeline(&session, id);
        let steps = session.history.position();
        let result = edit(&mut session, id, clip, 96, true);
        if scenario < 3 {
            assert!(result.is_err());
            assert_eq!(project(&session), before);
            assert_eq!(session.history.position(), steps);
        } else {
            result.unwrap();
            for (track, target) in [(0, first), (1, second)] {
                assert_eq!(
                    session.project.timelines[id]
                        .clip(track, target)
                        .unwrap()
                        .timeline_start,
                    96
                );
            }
            commands::apply(&mut session, id, &Operation::Undo).unwrap();
            assert_eq!(timeline(&session, id), original);
        }
    }
}

#[test]
fn bounds_nonmedia_bad_metadata_locked_links_and_no_motion_are_atomic() {
    for scenario in 0..8 {
        let (mut session, id, clip) = basic();
        let end = match scenario {
            0 => -1,
            1 => 0,
            2 => 4801,
            3 => MAX_FRAME + 1,
            4 => {
                session.project.timelines[id]
                    .clip_mut(0, clip)
                    .unwrap()
                    .source = core::ClipSource::SolidColor;
                96
            }
            5 => {
                let core::ClipSource::Media(media) =
                    session.project.timelines[id].clip(0, clip).unwrap().source
                else {
                    unreachable!()
                };
                session
                    .project
                    .media_pool
                    .get_mut(media)
                    .unwrap()
                    .meta
                    .fps
                    .den = 0;
                96
            }
            6 => {
                linked(&mut session, id, clip, 1, 0, 48, 0);
                session.project.timelines[id].tracks[1].locked = true;
                96
            }
            _ => {
                linked(&mut session, id, clip, 1, 0, 48, 0);
                session.project.timelines[id].tracks[1].clips[0].source =
                    core::ClipSource::SolidColor;
                96
            }
        };
        let before = project(&session);
        let steps = session.history.position();
        assert!(
            edit(&mut session, id, clip, end, true).is_err(),
            "scenario {scenario}"
        );
        assert_eq!(project(&session), before);
        assert_eq!(session.history.position(), steps);
    }
    let (mut session, id, clip) = basic();
    let before = project(&session);
    let steps = session.history.position();
    edit(&mut session, id, clip, 48, true).unwrap();
    assert_eq!(project(&session), before);
    assert_eq!(session.history.position(), steps);
    let dto: Operation = serde_json::from_value(
        json!({"kind":"retime_clip","clip_id":clip.0.to_string(),"end_frame":96}),
    )
    .unwrap();
    assert!(matches!(
        dto,
        Operation::RetimeClip {
            overwrite: false,
            ..
        }
    ));
    let value = crate::snapshot::timeline(&session, id);
    assert_eq!(value["tracks"][0]["clips"][0]["retime"]["source_span"], 48);
    assert!(
        metadata(
            &session.project,
            &session.project.timelines[id],
            &core::Clip::from_source_range(
                ClipId(999),
                core::ClipSource::SolidColor,
                0,
                48,
                0,
                core::Rational::one()
            )
        )
        .is_none()
    );
}

fn preset(
    session: &mut Session,
    id: TimelineId,
    clip: ClipId,
    percent: f64,
    overwrite: bool,
) -> Result<()> {
    commands::apply(
        session,
        id,
        &Operation::RetimePreset {
            clip_id: clip.0.to_string(),
            percent,
            overwrite,
        },
    )
}
#[test]
fn presets_preserve_exact_native_rationals_including_fractional_fps_and_rounded_lengths() {
    for percent in [
        10.0, 25.0, 50.0, 75.0, 100.0, 125.0, 150.0, 200.0, 400.0, 1000.0,
    ] {
        let (mut session, id, clip) = fixture(
            core::Rational::new(30000, 1001),
            core::Rational::new(24, 1),
            8,
            88,
            11,
        );
        session.project.timelines[id]
            .clip_mut(0, clip)
            .unwrap()
            .pitch_correction = false;
        let mut native = session.project.clone();
        let speed = core::Rational::from_percent(percent);
        core::SetClipSpeed::new(id, vec![(0, clip)], speed, false, core::SpeedFit::Resize)
            .apply(&mut native);
        let before = timeline(&session, id);
        let position = session.history.position();
        preset(&mut session, id, clip, percent, false).unwrap();
        let value = session.project.timelines[id].clip(0, clip).unwrap();
        assert_eq!(value.speed(), speed);
        assert!(!value.pitch_correction);
        assert_eq!(
            timeline(&session, id),
            serde_json::to_value(&native.timelines[id]).unwrap()
        );
        assert_eq!(
            metadata(&session.project, &session.project.timelines[id], value)
                .unwrap()
                .speed_percent,
            speed.as_percent()
        );
        if percent == 150.0 {
            assert_eq!(value.timeline_len, 66);
            assert_eq!(value.speed(), core::Rational::new(3, 2));
        }
        if timeline(&session, id) != before {
            assert_eq!(session.history.position(), position + 1);
            let after = timeline(&session, id);
            commands::apply(&mut session, id, &Operation::Undo).unwrap();
            assert_eq!(timeline(&session, id), before);
            commands::apply(&mut session, id, &Operation::Redo).unwrap();
            assert_eq!(timeline(&session, id), after);
        }
    }
}
#[test]
fn presets_expand_linked_clips_of_different_ends_and_preserve_primary_pitch_in_one_native_command()
{
    let (mut session, id, clip) = basic();
    let follower = linked(&mut session, id, clip, 1, 10, 34, 3);
    session.project.timelines[id]
        .clip_mut(0, clip)
        .unwrap()
        .pitch_correction = false;
    session.project.timelines[id]
        .clip_mut(1, follower)
        .unwrap()
        .pitch_correction = true;
    let before = timeline(&session, id);
    let position = session.history.position();
    let mut native = session.project.clone();
    core::SetClipSpeed::new(
        id,
        vec![(0, clip), (1, follower)],
        core::Rational::new(3, 4),
        false,
        core::SpeedFit::Resize,
    )
    .apply(&mut native);
    preset(&mut session, id, clip, 75.0, false).unwrap();
    assert_eq!(
        timeline(&session, id),
        serde_json::to_value(&native.timelines[id]).unwrap()
    );
    for (track, target) in [(0, clip), (1, follower)] {
        let result = session.project.timelines[id].clip(track, target).unwrap();
        assert_eq!(result.speed(), core::Rational::new(3, 4));
        assert!(!result.pitch_correction);
    }
    assert_eq!(session.history.position(), position + 1);
    let after = timeline(&session, id);
    commands::apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(timeline(&session, id), before);
    commands::apply(&mut session, id, &Operation::Redo).unwrap();
    assert_eq!(timeline(&session, id), after);
}
#[test]
fn same_speed_preset_unfreezes_natively_but_a_full_state_noop_preserves_history_and_project() {
    let (mut session, id, clip) = basic();
    session.project.timelines[id]
        .clip_mut(0, clip)
        .unwrap()
        .freeze = Some(12);
    let before = timeline(&session, id);
    let position = session.history.position();
    preset(&mut session, id, clip, 100.0, false).unwrap();
    assert!(
        session.project.timelines[id]
            .clip(0, clip)
            .unwrap()
            .freeze
            .is_none()
    );
    assert_eq!(session.history.position(), position + 1);
    commands::apply(&mut session, id, &Operation::Undo).unwrap();
    assert_eq!(timeline(&session, id), before);
    commands::apply(&mut session, id, &Operation::Redo).unwrap();
    let before = project(&session);
    let generation = session.history.generation();
    let position = session.history.position();
    preset(&mut session, id, clip, 100.0, true).unwrap();
    assert_eq!(project(&session), before);
    assert_eq!(session.history.generation(), generation);
    assert_eq!(session.history.position(), position);
    let snapshot = crate::snapshot::timeline(&session, id);
    assert_eq!(
        snapshot["tracks"][0]["clips"][0]["retime"]["speed_percent"],
        100.0
    );
}
#[test]
fn preset_overwrite_is_explicit_native_and_atomic_with_undo_redo() {
    for length in [24, 96] {
        let (mut session, id, clip) = basic();
        let neighbour = solid(&mut session, id, 0, 60, length, None);
        let before = project(&session);
        let original = timeline(&session, id);
        let position = session.history.position();
        assert_eq!(
            preset(&mut session, id, clip, 50.0, false).unwrap_err().1,
            "OVERLAP"
        );
        assert_eq!(project(&session), before);
        assert_eq!(session.history.position(), position);
        preset(&mut session, id, clip, 50.0, true).unwrap();
        assert_eq!(
            session.project.timelines[id].clip(0, clip).unwrap().speed(),
            core::Rational::new(1, 2)
        );
        if length == 24 {
            assert!(session.project.timelines[id].clip(0, neighbour).is_none());
        } else {
            assert_eq!(
                session.project.timelines[id]
                    .clip(0, neighbour)
                    .unwrap()
                    .timeline_start,
                96
            );
        }
        assert_eq!(session.history.position(), position + 1);
        let after = timeline(&session, id);
        commands::apply(&mut session, id, &Operation::Undo).unwrap();
        assert_eq!(timeline(&session, id), original);
        commands::apply(&mut session, id, &Operation::Redo).unwrap();
        assert_eq!(timeline(&session, id), after);
    }
}
#[test]
fn preset_refuses_bad_values_metadata_locked_links_and_partial_linked_overwrite_without_mutation() {
    for percent in [
        f64::NAN,
        f64::INFINITY,
        -1.0,
        0.0,
        1.0,
        99.0,
        100.001,
        10_000.0,
    ] {
        let (mut session, id, clip) = basic();
        let before = project(&session);
        let position = session.history.position();
        assert!(preset(&mut session, id, clip, percent, true).is_err());
        assert_eq!(project(&session), before);
        assert_eq!(session.history.position(), position);
    }
    for scenario in 0..7 {
        let (mut session, id, clip) = basic();
        let follower = linked(&mut session, id, clip, 1, 0, 48, 0);
        match scenario {
            0 => session.project.timelines[id].tracks[1].locked = true,
            1 => {
                session.project.timelines[id]
                    .clip_mut(1, follower)
                    .unwrap()
                    .source = core::ClipSource::SolidColor;
            }
            2 => {
                let core::ClipSource::Media(media) = session.project.timelines[id]
                    .clip(1, follower)
                    .unwrap()
                    .source
                else {
                    unreachable!()
                };
                session
                    .project
                    .media_pool
                    .get_mut(media)
                    .unwrap()
                    .meta
                    .fps
                    .den = 0;
            }
            5 => {
                let source = session.project.timelines[id]
                    .clip(1, follower)
                    .unwrap()
                    .source
                    .clone();
                let mut replacement = core::Clip::from_source_range(
                    follower,
                    source,
                    99,
                    100,
                    0,
                    core::Rational::one(),
                );
                replacement.linked_group = Some(core::LinkGroupId(10));
                *session.project.timelines[id].clip_mut(1, follower).unwrap() = replacement;
                short_media(&mut session, id, 1, follower);
            }
            _ => {
                solid(&mut session, id, 0, 60, 96, Some(20));
                solid(
                    &mut session,
                    id,
                    if scenario == 4 { 1 } else { 2 },
                    60,
                    96,
                    Some(20),
                );
                if scenario == 4 {
                    session.project.timelines[id].tracks[1].locked = true;
                }
                if scenario == 6 {
                    session.project.timelines[id].tracks[2].locked = true;
                }
            }
        }
        let before = project(&session);
        let position = session.history.position();
        assert!(
            preset(
                &mut session,
                id,
                clip,
                if scenario == 5 { 1000.0 } else { 50.0 },
                true
            )
            .is_err(),
            "scenario {scenario}"
        );
        assert_eq!(project(&session), before);
        assert_eq!(session.history.position(), position);
    }
    let operation: Operation =
        serde_json::from_value(json!({"kind":"retime_preset","clip_id":"1","percent":150}))
            .unwrap();
    assert!(
        matches!(operation, Operation::RetimePreset { percent, overwrite: false, .. } if percent == 150.0)
    );
    for value in [
        json!({"kind":"retime_preset","clip_id":"1","percent":"150"}),
        json!({"kind":"retime_preset","clip_id":"1"}),
    ] {
        assert!(serde_json::from_value::<Operation>(value).is_err());
    }
}
