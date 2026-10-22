use super::*;
use std::collections::BTreeSet;

fn linear_audio_fixture() -> (Project, TimelineId, Vec<(usize, ClipId)>) {
    let (mut project, timeline) =
        project_with_tracks(&[TrackKind::Audio, TrackKind::Audio, TrackKind::Audio]);
    let first = insert_clip(&mut project, timeline, 0, 10, 20);
    let second = insert_clip(&mut project, timeline, 1, 15, 30);
    insert_clip(&mut project, timeline, 0, 0, 5);
    insert_clip(&mut project, timeline, 1, 50, 10);
    insert_clip(&mut project, timeline, 2, 0, 60);
    let tracks = &mut project.timelines[timeline].tracks;
    tracks[0].mix.gain_db = -3.0;
    tracks[0].mix.pan = -0.4;
    tracks[0].mix.effects = vec![
        AudioEffect::new(AudioEffectKind::Mono),
        AudioEffect {
            enabled: false,
            kind: AudioEffectKind::MultibandCompressor(MultibandCompressor::DEFAULT),
        },
    ];
    tracks[0].armed = true;
    tracks[0].clips[1].effects.gain_db = Keyframed::constant(-2.5);
    tracks[1].mix.gain_db = -9.0;
    tracks[1].mix.pan = 0.6;
    project.timelines[timeline].master.gain_db = -4.0;
    (project, timeline, vec![(0, first), (1, second)])
}

#[test]
fn linear_audio_compound_partial_buses_copy_strips_and_preserve_one_native_undo() {
    let (mut project, timeline, selected) = linear_audio_fixture();
    project.timelines[timeline].tracks[0].muted = true;
    project.timelines[timeline].tracks[1].solo = true;
    let before_timeline = serde_json::to_value(&project.timelines[timeline]).unwrap();
    let plan = plan_linear_audio_compound(&project, timeline, &selected, 48_000).unwrap();
    assert_eq!(plan.compound.audio_track, Some(3));
    assert_eq!(plan.compound.range_start, 10);
    assert_eq!(plan.compound.len, 35);
    assert_eq!(
        plan.compound.nested_timeline.master,
        ChannelStrip::default()
    );
    for (index, &(_, id)) in selected.iter().enumerate() {
        let original = &project.timelines[timeline].tracks[index];
        let child = &plan.compound.nested_timeline.tracks[index];
        assert_eq!(child.mix, original.mix);
        assert_eq!(child.muted, original.muted);
        assert_eq!(child.solo, original.solo);
        assert!(!child.armed);
        let mut expected = original.clip(id).unwrap().clone();
        expected.timeline_start -= 10;
        assert_eq!(
            serde_json::to_value(&child.clips).unwrap(),
            serde_json::to_value(vec![expected]).unwrap()
        );
    }
    let (media, commands) =
        linear_audio_compound_commands(&mut project, timeline, &selected, &plan);
    assert_eq!(commands[0].label(), CommandLabel::AddTrack);
    assert_eq!(commands[1].label(), CommandLabel::SoloTrack);
    // Native command construction reserves IDs before the history step.
    let before = serde_json::to_value(&project).unwrap();
    let mut history = History::default();
    history.do_command(
        &mut project,
        Box::new(CompositeCommand::new(
            CommandLabel::MakeCompoundClip,
            commands,
        )),
    );
    assert_eq!(history.position(), 1);
    let outer = &project.timelines[timeline];
    assert_eq!(outer.tracks.len(), 4);
    let wrapper = &outer.tracks[3];
    assert_eq!(wrapper.kind, TrackKind::Audio);
    assert_eq!(wrapper.mix, ChannelStrip::default());
    assert!(wrapper.solo);
    assert!(!wrapper.muted && !wrapper.locked && !wrapper.armed);
    assert_eq!(wrapper.clips.len(), 1);
    assert!(matches!(wrapper.clips[0].source, ClipSource::Media(id) if id == media));
    for index in 0..3 {
        let mut expected = before_timeline["tracks"][index].clone();
        if index < 2 {
            expected["clips"] =
                serde_json::to_value(project.timelines[timeline].tracks[index].clips.clone())
                    .unwrap();
        }
        assert_eq!(
            serde_json::to_value(&outer.tracks[index]).unwrap(),
            expected
        );
    }
    assert_eq!(outer.tracks[0].clips.len(), 1);
    assert_eq!(outer.tracks[1].clips.len(), 1);
    assert_eq!(
        serde_json::to_value(&outer.master).unwrap(),
        before_timeline["master"]
    );
    let nested = project.media_pool[media].compound.unwrap();
    assert_eq!(
        serde_json::to_value(&project.timelines[nested]).unwrap(),
        serde_json::to_value(&plan.compound.nested_timeline).unwrap()
    );
    let after = serde_json::to_value(&project).unwrap();
    history.undo(&mut project);
    assert_eq!(history.position(), 0);
    assert_eq!(serde_json::to_value(&project).unwrap(), before);
    history.redo(&mut project);
    assert_eq!(serde_json::to_value(&project).unwrap(), after);
}

#[test]
fn linear_audio_compound_solo_gating_includes_muted_and_external_solo_buses() {
    for (first_solo, first_muted, second_solo, external_solo) in [
        (false, false, false, false),
        (false, false, false, true),
        (true, false, false, false),
        (true, true, false, false),
        (true, true, false, true),
        (true, true, true, true),
    ] {
        let (mut project, timeline, selected) = linear_audio_fixture();
        project.timelines[timeline].tracks[0].solo = first_solo;
        project.timelines[timeline].tracks[0].muted = first_muted;
        project.timelines[timeline].tracks[1].solo = second_solo;
        project.timelines[timeline].tracks[2].solo = external_solo;
        let audible_before: BTreeSet<_> = project.timelines[timeline]
            .audible_tracks()
            .map(|(index, _)| index)
            .collect();
        let plan = plan_linear_audio_compound(&project, timeline, &selected, 48_000).unwrap();
        let (_, commands) =
            linear_audio_compound_commands(&mut project, timeline, &selected, &plan);
        let mut command = CompositeCommand::new(CommandLabel::MakeCompoundClip, commands);
        command.apply(&mut project);
        let outer = &project.timelines[timeline];
        let audible_after: BTreeSet<_> = outer.audible_tracks().map(|(index, _)| index).collect();
        assert_eq!(outer.tracks[3].solo, first_solo || second_solo);
        assert!(!outer.tracks[3].muted);
        for index in 0..3 {
            assert_eq!(
                audible_before.contains(&index),
                audible_after.contains(&index)
            );
        }
        let audible_child: BTreeSet<_> = if audible_after.contains(&3) {
            plan.compound
                .nested_timeline
                .audible_tracks()
                .map(|(index, _)| index)
                .collect()
        } else {
            BTreeSet::new()
        };
        assert_eq!(
            audible_child,
            audible_before
                .into_iter()
                .filter(|index| *index < 2)
                .collect()
        );
    }
}

#[test]
fn linear_audio_compound_checks_rational_sample_origin_without_allocating() {
    let (mut project, timeline, selected) = linear_audio_fixture();
    project.timelines[timeline].fps = Rational::new(30_000, 1001);
    for (index, &(_, id)) in selected.iter().enumerate() {
        project.timelines[timeline].tracks[index]
            .clip_mut(id)
            .unwrap()
            .timeline_start = if index == 0 { 1 } else { 6 };
    }
    let before = serde_json::to_value(&project).unwrap();
    assert_eq!(
        plan_linear_audio_compound(&project, timeline, &selected, 48_000).err(),
        Some("Linear audio compound origin is not sample-aligned")
    );
    assert_eq!(serde_json::to_value(&project).unwrap(), before);
    project.timelines[timeline].tracks[0]
        .clip_mut(selected[0].1)
        .unwrap()
        .timeline_start = 5;
    let plan = plan_linear_audio_compound(&project, timeline, &selected, 48_000).unwrap();
    assert_eq!(plan.compound.range_start, 5);
    assert_eq!(
        plan.compound.nested_timeline.tracks[1].clips[0].timeline_start,
        1
    );
    assert!(plan_linear_audio_compound(&project, timeline, &selected, 0).is_err());
    project.timelines[timeline].fps = Rational { num: 0, den: 1 };
    assert!(plan_linear_audio_compound(&project, timeline, &selected, 48_000).is_err());
    project.timelines[timeline].fps = Rational { num: 25, den: 0 };
    assert!(plan_linear_audio_compound(&project, timeline, &selected, 48_000).is_err());
}

#[test]
fn linear_audio_compound_rejects_rounded_sample_tail_truncation_at_aligned_origin() {
    let (mut project, timeline) = project_with_tracks(&[TrackKind::Audio, TrackKind::Audio]);
    project.timelines[timeline].fps = Rational::new(30_000, 1001);
    let first = insert_clip(&mut project, timeline, 0, 5, 4);
    let second = insert_clip(&mut project, timeline, 1, 6, 3);
    let selected = [(0, first), (1, second)];
    let before = serde_json::to_value(&project).unwrap();
    assert_eq!(
        plan_linear_audio_compound(&project, timeline, &selected, 48_000).err(),
        Some("Linear audio compound would truncate a source sample tail")
    );
    assert_eq!(serde_json::to_value(&project).unwrap(), before);
    project.timelines[timeline].tracks[0]
        .clip_mut(first)
        .unwrap()
        .timeline_len = 5;
    project.timelines[timeline].tracks[1]
        .clip_mut(second)
        .unwrap()
        .timeline_len = 4;
    let plan = plan_linear_audio_compound(&project, timeline, &selected, 48_000).unwrap();
    assert_eq!(plan.compound.range_start, 5);
    assert_eq!(plan.compound.len, 5);
    project.timelines[timeline].fps = Rational::new(240, 1);
    let first_clip = project.timelines[timeline].tracks[0]
        .clip_mut(first)
        .unwrap();
    first_clip.timeline_start = 4;
    first_clip.timeline_len = 4;
    let second_clip = project.timelines[timeline].tracks[1]
        .clip_mut(second)
        .unwrap();
    second_clip.timeline_start = 6;
    second_clip.timeline_len = 2;
    assert_eq!(
        plan_linear_audio_compound(&project, timeline, &selected, 44_100).err(),
        Some("Linear audio compound would truncate a source sample tail")
    );
}

#[test]
fn linear_audio_compound_rejects_enabled_non_linear_inserts_and_nonfinite_bypasses() {
    let (mut project, timeline, selected) = linear_audio_fixture();
    for kind in [
        AudioEffectKind::Equalizer(Equalizer::DEFAULT),
        AudioEffectKind::MultibandCompressor(MultibandCompressor::DEFAULT),
        AudioEffectKind::Normalize {
            target_db: -1.0,
            mode: NormalizeMode::SamplePeak,
            set_level: SetLevel::Relative,
        },
    ] {
        project.timelines[timeline].tracks[1].mix.effects = vec![AudioEffect::new(kind)];
        let before = serde_json::to_value(&project).unwrap();
        assert_eq!(
            plan_linear_audio_compound(&project, timeline, &selected, 48_000).err(),
            Some("Linear audio compound supports only Mono or bypassed bus inserts")
        );
        assert_eq!(serde_json::to_value(&project).unwrap(), before);
        project.timelines[timeline].tracks[1].mix.effects[0].enabled = false;
        assert!(plan_linear_audio_compound(&project, timeline, &selected, 48_000).is_ok());
    }
    let mut eq = Equalizer::DEFAULT;
    eq.bands[0].q = f32::NAN;
    let mut compressor = MultibandCompressor::DEFAULT;
    compressor.bands[2].release_ms = f32::INFINITY;
    for kind in [
        AudioEffectKind::Equalizer(eq),
        AudioEffectKind::MultibandCompressor(compressor),
        AudioEffectKind::Normalize {
            target_db: f32::NAN,
            mode: NormalizeMode::Loudness,
            set_level: SetLevel::Independent,
        },
    ] {
        project.timelines[timeline].tracks[1].mix.effects = vec![AudioEffect {
            enabled: false,
            kind,
        }];
        assert_eq!(
            plan_linear_audio_compound(&project, timeline, &selected, 48_000).err(),
            Some("Linear audio compound requires finite bus settings")
        );
    }
    project.timelines[timeline].tracks[1].mix.effects.clear();
    project.timelines[timeline].tracks[1].mix.pan = f32::INFINITY;
    assert!(plan_linear_audio_compound(&project, timeline, &selected, 48_000).is_err());
    project.timelines[timeline].tracks[1].mix.pan = 0.0;
    project.timelines[timeline].tracks[1].mix.gain_db = f32::NAN;
    assert!(plan_linear_audio_compound(&project, timeline, &selected, 48_000).is_err());
}

#[test]
fn linear_audio_compound_refuses_missing_duplicate_and_invalid_clip_ranges() {
    let (mut project, timeline, selected) = linear_audio_fixture();
    let before = serde_json::to_value(&project).unwrap();
    for invalid in [
        vec![],
        vec![selected[0], selected[0]],
        vec![(3, selected[0].1)],
        vec![(1, selected[0].1)],
    ] {
        assert!(plan_linear_audio_compound(&project, timeline, &invalid, 48_000).is_err());
        assert_eq!(serde_json::to_value(&project).unwrap(), before);
    }
    project.timelines[timeline].tracks[0]
        .clip_mut(selected[0].1)
        .unwrap()
        .timeline_start = -1;
    assert!(plan_linear_audio_compound(&project, timeline, &selected, 48_000).is_err());
    project.timelines[timeline].tracks[0]
        .clip_mut(selected[0].1)
        .unwrap()
        .timeline_start = i64::MAX;
    assert!(plan_linear_audio_compound(&project, timeline, &selected, 48_000).is_err());
}

#[test]
fn linear_audio_compound_opt_in_does_not_change_legacy_gain_or_track_placement() {
    let (mut project, timeline, selected) = linear_audio_fixture();
    project.timelines[timeline].tracks[0].muted = true;
    project.timelines[timeline].tracks[0].solo = true;
    let legacy = plan_compound_clip(&project, timeline, &selected).unwrap();
    assert_eq!(legacy.audio_track, Some(0));
    assert_eq!(
        legacy.nested_timeline.tracks[0].mix,
        ChannelStrip::default()
    );
    assert_eq!(legacy.nested_timeline.tracks[1].mix.gain_db, -6.0);
    assert_eq!(legacy.nested_timeline.tracks[1].mix.pan, 0.0);
    assert!(!legacy.nested_timeline.tracks[0].muted);
    assert!(!legacy.nested_timeline.tracks[0].solo);
    let (_, commands) = compound_clip_commands(&mut project, timeline, &selected, &legacy);
    assert_eq!(commands[0].label(), CommandLabel::MakeCompoundClip);
    let mut command = CompositeCommand::new(CommandLabel::MakeCompoundClip, commands);
    command.apply(&mut project);
    assert_eq!(project.timelines[timeline].tracks.len(), 3);
    assert_eq!(project.timelines[timeline].tracks[0].clips.len(), 2);
}

fn project_with_tracks(kinds: &[TrackKind]) -> (Project, TimelineId) {
    let mut project = Project::default();
    let timeline = project.timelines.insert(Timeline {
        name: "Timeline 1".into(),
        fps: Rational::new(25, 1),
        resolution: (1920, 1080),
        tracks: kinds.iter().map(|k| Track::new(*k)).collect(),
        markers: Vec::new(),
        master: Default::default(),
    });
    (project, timeline)
}

fn insert_clip(
    project: &mut Project,
    timeline: TimelineId,
    track_index: usize,
    start: FrameIdx,
    len: FrameIdx,
) -> ClipId {
    let clip = Clip::from_source_range(
        project.alloc_clip_id(),
        ClipSource::SolidColor,
        0,
        len,
        start,
        Rational::one(),
    );
    let id = clip.id;
    project.timelines[timeline].tracks[track_index].insert_sorted(clip);
    id
}

#[test]
fn a_compound_plan_preserves_crossing_transitions_between_selected_clips() {
    let (mut project, id) = project_with_tracks(&[TrackKind::Video]);
    let left = insert_clip(&mut project, id, 0, 0, 24);
    let right = insert_clip(&mut project, id, 0, 24, 24);
    project.timelines[id].tracks[0]
        .crossings
        .push(CrossTransition {
            left_clip: left,
            right_clip: right,
            transition: Transition {
                kind: TransitionKind::CrossDissolve,
                duration: 12,
                direction: PushDirection::Left,
                ease: Ease::InOut,
                curve: 0.5,
            },
        });
    let plan = plan_compound_clip(&project, id, &[(0, left), (0, right)]).unwrap();
    assert_eq!(plan.nested_timeline.tracks[0].crossings.len(), 1);
    let crossing = &plan.nested_timeline.tracks[0].crossings[0];
    assert_eq!((crossing.left_clip, crossing.right_clip), (left, right));
    assert_eq!(crossing.transition.duration, 12);
}

/// Inserts into the pool a compound clip referencing `plan`, as the real
/// caller (main.rs) would before running `compound_clip_commands`.
fn insert_compound_media(project: &mut Project, plan: &CompoundPlan) -> MediaId {
    let nested = project.timelines.insert(Timeline {
        name: plan.nested_timeline.name.clone(),
        fps: plan.nested_timeline.fps,
        resolution: plan.nested_timeline.resolution,
        tracks: plan.nested_timeline.tracks.clone(),
        markers: Vec::new(),
        master: Default::default(),
    });
    let path = project.alloc_compound_name().into();
    let content_hash = project.alloc_compound_generation();
    project.media_pool.insert(MediaItem {
        path,
        meta: MediaMeta {
            duration_frames: plan.len,
            fps: plan.nested_timeline.fps,
            width: plan.nested_timeline.resolution.0,
            height: plan.nested_timeline.resolution.1,
            has_video: plan.has_video,
            has_audio: plan.has_audio,
            sample_rate: 48_000,
            channels: 2,
            audio_streams: 1,
            file: Default::default(),
        },
        content_hash,
        compound: Some(nested),
        folder: None,
    })
}

#[test]
fn plan_rebases_clips_into_the_nested_timeline_preserving_relative_track_order() {
    let (mut project, timeline) = project_with_tracks(&[TrackKind::Video, TrackKind::Audio]);
    let video_id = insert_clip(&mut project, timeline, 0, 10, 30);
    let audio_id = insert_clip(&mut project, timeline, 1, 20, 30);

    let plan = plan_compound_clip(&project, timeline, &[(0, video_id), (1, audio_id)]).unwrap();

    assert_eq!(plan.range_start, 10);
    assert_eq!(plan.len, 40); // up to 50 (end of the audio clip), from 10
    assert!(plan.has_video && plan.has_audio);
    assert_eq!(plan.video_track, Some(0));
    assert_eq!(plan.audio_track, Some(1));

    assert_eq!(plan.nested_timeline.tracks.len(), 2);
    assert_eq!(plan.nested_timeline.tracks[0].kind, TrackKind::Video);
    assert_eq!(plan.nested_timeline.tracks[0].clips[0].timeline_start, 0);
    assert_eq!(plan.nested_timeline.tracks[1].kind, TrackKind::Audio);
    assert_eq!(plan.nested_timeline.tracks[1].clips[0].timeline_start, 10);
}

#[test]
fn plan_folds_multiple_video_tracks_into_a_single_result_clip_on_the_bottommost() {
    let (mut project, timeline) = project_with_tracks(&[TrackKind::Video, TrackKind::Video]);
    let bottom = insert_clip(&mut project, timeline, 0, 0, 20);
    let top = insert_clip(&mut project, timeline, 1, 10, 20);

    let plan = plan_compound_clip(&project, timeline, &[(0, bottom), (1, top)]).unwrap();

    assert!(plan.has_video);
    assert!(!plan.has_audio);
    assert_eq!(
        plan.video_track,
        Some(0),
        "the lowest of the tracks involved"
    );
    assert_eq!(plan.audio_track, None);
    assert_eq!(
        plan.nested_timeline.tracks.len(),
        2,
        "one nested track per video track involved"
    );
}

#[test]
fn deleting_a_compound_clip_frees_its_name_and_its_nested_timeline() {
    let (mut project, timeline) = project_with_tracks(&[TrackKind::Video]);
    let id = insert_clip(&mut project, timeline, 0, 0, 20);
    let plan = plan_compound_clip(&project, timeline, &[(0, id)]).unwrap();
    let media = insert_compound_media(&mut project, &plan);
    assert_eq!(
        project.media_pool[media].path.to_str(),
        Some("Compound Clip 1")
    );

    let mut history = History::default();
    history.do_command(&mut project, Box::new(command::RemoveMedia::new(media)));
    assert_eq!(
        project.timelines.len(),
        1,
        "the nested timeline goes away with the media"
    );

    let again = insert_compound_media(&mut project, &plan);
    assert_eq!(
        project.media_pool[again].path.to_str(),
        Some("Compound Clip 1")
    );
}

#[test]
fn undoing_the_deletion_of_a_compound_clip_restores_its_nested_timeline() {
    let (mut project, timeline) = project_with_tracks(&[TrackKind::Video]);
    let id = insert_clip(&mut project, timeline, 0, 0, 20);
    let plan = plan_compound_clip(&project, timeline, &[(0, id)]).unwrap();
    let media = insert_compound_media(&mut project, &plan);

    let mut history = History::default();
    history.do_command(&mut project, Box::new(command::RemoveMedia::new(media)));
    history.undo(&mut project);

    assert_eq!(project.media_pool.len(), 1);
    let nested = project
        .media_pool
        .values()
        .next()
        .unwrap()
        .compound
        .unwrap();
    assert!(project.timelines.contains_key(nested));
}

#[test]
fn plan_returns_none_for_an_empty_selection() {
    let (project, timeline) = project_with_tracks(&[TrackKind::Video]);
    assert!(plan_compound_clip(&project, timeline, &[]).is_none());
}

#[test]
fn compound_clip_commands_replace_selection_with_linked_result_and_undo_restores_it() {
    let (mut project, timeline) = project_with_tracks(&[TrackKind::Video, TrackKind::Audio]);
    let video_id = insert_clip(&mut project, timeline, 0, 10, 30);
    let audio_id = insert_clip(&mut project, timeline, 1, 20, 30);
    let selection = vec![(0, video_id), (1, audio_id)];

    let plan = plan_compound_clip(&project, timeline, &selection).unwrap();
    let (media_id, commands) = compound_clip_commands(&mut project, timeline, &selection, &plan);

    let mut history = History::default();
    history.do_command(
        &mut project,
        Box::new(CompositeCommand::new(
            CommandLabel::MakeCompoundClip,
            commands,
        )),
    );

    let video_track = &project.timelines[timeline].tracks[0];
    assert_eq!(video_track.clips.len(), 1);
    assert!(matches!(video_track.clips[0].source, ClipSource::Media(id) if id == media_id));
    assert_eq!(video_track.clips[0].timeline_start, 10);
    assert_eq!(video_track.clips[0].timeline_len, 40);

    let audio_track = &project.timelines[timeline].tracks[1];
    assert_eq!(audio_track.clips.len(), 1);
    assert!(matches!(audio_track.clips[0].source, ClipSource::Media(id) if id == media_id));
    let group = video_track.clips[0]
        .linked_group
        .expect("video linked to the audio");
    assert_eq!(audio_track.clips[0].linked_group, Some(group));

    assert_eq!(project.media_pool.len(), 1);
    assert_eq!(project.timelines.len(), 2);

    history.undo(&mut project);
    assert_eq!(project.timelines[timeline].tracks[0].clips.len(), 1);
    assert_eq!(project.timelines[timeline].tracks[0].clips[0].id, video_id);
    assert_eq!(
        project.timelines[timeline].tracks[0].clips[0].timeline_start,
        10
    );
    assert_eq!(project.timelines[timeline].tracks[1].clips[0].id, audio_id);
    assert!(project.media_pool.is_empty());
    assert_eq!(project.timelines.len(), 1, "the nested timeline goes too");

    history.redo(&mut project);
    let nested = project.media_pool[media_id].compound.unwrap();
    assert_eq!(
        project.timelines[nested].tracks.len(),
        plan.nested_timeline.tracks.len()
    );
}

fn compound_media_for(project: &mut Project, nested: TimelineId) -> MediaId {
    project.media_pool.insert(MediaItem {
        path: "Compound".into(),
        meta: MediaMeta {
            duration_frames: 10,
            fps: Rational::new(25, 1),
            width: 1920,
            height: 1080,
            has_video: true,
            has_audio: false,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            file: Default::default(),
        },
        content_hash: 1,
        compound: Some(nested),
        folder: None,
    })
}

#[test]
fn would_create_a_cycle_catches_importing_a_timeline_into_itself() {
    let mut project = Project::default();
    let timeline = project.timelines.insert(Timeline {
        name: "T".into(),
        fps: Rational::new(25, 1),
        resolution: (1920, 1080),
        tracks: vec![],
        markers: Vec::new(),
        master: Default::default(),
    });
    let media = compound_media_for(&mut project, timeline);

    assert!(
        project.would_create_a_cycle(media, timeline),
        "T inside itself"
    );
}

#[test]
fn would_create_a_cycle_catches_an_indirect_cycle_through_a_nested_compound_clip() {
    let mut project = Project::default();
    let a = project.timelines.insert(Timeline {
        name: "A".into(),
        fps: Rational::new(25, 1),
        resolution: (1920, 1080),
        tracks: vec![],
        markers: Vec::new(),
        master: Default::default(),
    });
    let b = project.timelines.insert(Timeline {
        name: "B".into(),
        fps: Rational::new(25, 1),
        resolution: (1920, 1080),
        tracks: vec![],
        markers: Vec::new(),
        master: Default::default(),
    });
    let media_a = compound_media_for(&mut project, a);
    let media_b = compound_media_for(&mut project, b);
    // B already contains a clip referencing A: importing B inside A
    // would close the cycle A -> B -> A.
    project.timelines[b].tracks.push(Track {
        kind: TrackKind::Video,
        clips: vec![Clip::from_source_range(
            ClipId(1),
            ClipSource::Media(media_a),
            0,
            10,
            0,
            Rational::one(),
        )],
        muted: false,
        solo: false,
        locked: false,
        crossings: Vec::new(),
        mix: Default::default(),
        armed: Default::default(),
    });

    assert!(project.would_create_a_cycle(media_b, a), "A -> B -> A");
    assert!(
        !project.would_create_a_cycle(media_a, b),
        "B -> A not yet a cycle on B"
    );
}

#[test]
fn would_create_a_cycle_is_false_for_unrelated_timelines() {
    let mut project = Project::default();
    let a = project.timelines.insert(Timeline {
        name: "A".into(),
        fps: Rational::new(25, 1),
        resolution: (1920, 1080),
        tracks: vec![],
        markers: Vec::new(),
        master: Default::default(),
    });
    let b = project.timelines.insert(Timeline {
        name: "B".into(),
        fps: Rational::new(25, 1),
        resolution: (1920, 1080),
        tracks: vec![],
        markers: Vec::new(),
        master: Default::default(),
    });
    let media_a = compound_media_for(&mut project, a);

    assert!(!project.would_create_a_cycle(media_a, b));
}

#[test]
fn plan_keeps_the_nested_track_gains_relative_to_the_host_track() {
    let (mut project, timeline) = project_with_tracks(&[TrackKind::Audio, TrackKind::Audio]);
    project.timelines[timeline].tracks[0].mix.gain_db = -6.0;
    project.timelines[timeline].tracks[1].mix.gain_db = 3.0;
    let low = insert_clip(&mut project, timeline, 0, 0, 20);
    let high = insert_clip(&mut project, timeline, 1, 0, 20);

    let plan = plan_compound_clip(&project, timeline, &[(0, low), (1, high)]).unwrap();

    assert_eq!(plan.audio_track, Some(0));
    let gains: Vec<f32> = plan
        .nested_timeline
        .tracks
        .iter()
        .map(|t| t.mix.gain_db)
        .collect();
    assert_eq!(gains, [0.0, 9.0]);
}
