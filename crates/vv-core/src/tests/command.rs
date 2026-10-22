use super::*;
use crate::Id;
use crate::{Rational, Timeline, Track};

fn project() -> (Project, TimelineId) {
    let mut project = Project::default();
    let timeline = project.timelines.insert(Timeline {
        name: "T".into(),
        fps: Rational::new(25, 1),
        resolution: (64, 48),
        tracks: vec![Track::new(TrackKind::Video)],
        markers: Vec::new(),
        master: Default::default(),
    });
    (project, timeline)
}

fn add_track(timeline: TimelineId) -> Box<dyn Command> {
    Box::new(AddTrack::new(timeline, TrackKind::Audio))
}

fn tracks(project: &Project, timeline: TimelineId) -> usize {
    project.timelines[timeline].tracks.len()
}

#[test]
fn joined_commands_are_one_step() {
    let (mut project, tl) = project();
    let mut history = History::default();
    let label = CommandLabel::RemoveMedia;

    let step = history.join(&mut project, None, label, add_track(tl));
    let step = history.join(&mut project, Some(step), label, add_track(tl));
    history.join(&mut project, Some(step), label, add_track(tl));

    assert_eq!(history.position(), 1);
    assert_eq!(history.labels().collect::<Vec<_>>(), vec![label]);
    history.undo(&mut project);
    assert_eq!(tracks(&project, tl), 1);
    history.redo(&mut project);
    assert_eq!(tracks(&project, tl), 4);
}

#[test]
fn each_join_is_a_change() {
    let (mut project, tl) = project();
    let mut history = History::default();

    let step = history.join(&mut project, None, CommandLabel::AddTrack, add_track(tl));
    let generation = history.generation();
    history.join(
        &mut project,
        Some(step),
        CommandLabel::AddTrack,
        add_track(tl),
    );

    assert!(history.generation() > generation);
}

#[test]
fn a_command_in_between_starts_a_new_step() {
    let (mut project, tl) = project();
    let mut history = History::default();

    let step = history.join(&mut project, None, CommandLabel::RemoveMedia, add_track(tl));
    history.do_command(&mut project, add_track(tl));
    history.join(
        &mut project,
        Some(step),
        CommandLabel::RemoveMedia,
        add_track(tl),
    );

    assert_eq!(history.position(), 3);
}

#[test]
fn an_undo_in_between_starts_a_new_step_and_drops_the_redo() {
    let (mut project, tl) = project();
    let mut history = History::default();

    let step = history.join(&mut project, None, CommandLabel::RemoveMedia, add_track(tl));
    history.undo(&mut project);
    history.join(
        &mut project,
        Some(step),
        CommandLabel::RemoveMedia,
        add_track(tl),
    );

    assert_eq!(history.position(), 1);
    assert_eq!(history.labels().count(), 1);
    assert_eq!(tracks(&project, tl), 2);
}

#[test]
fn a_group_closed_around_the_step_ends_it() {
    let (mut project, tl) = project();
    let mut history = History::default();

    let mark = history.begin_group();
    history.do_command(&mut project, add_track(tl));
    let step = history.join(&mut project, None, CommandLabel::RemoveMedia, add_track(tl));
    history.end_group_as(mark, CommandLabel::Gain);
    history.join(
        &mut project,
        Some(step),
        CommandLabel::RemoveMedia,
        add_track(tl),
    );

    assert_eq!(
        history.labels().collect::<Vec<_>>(),
        vec![CommandLabel::Gain, CommandLabel::RemoveMedia]
    );
    history.undo(&mut project);
    assert_eq!(tracks(&project, tl), 3);
}

#[test]
fn only_the_latest_handle_joins() {
    let (mut project, tl) = project();
    let mut history = History::default();

    let first = history.join(&mut project, None, CommandLabel::RemoveMedia, add_track(tl));
    history.join(
        &mut project,
        Some(first),
        CommandLabel::RemoveMedia,
        add_track(tl),
    );
    history.join(
        &mut project,
        Some(first),
        CommandLabel::RemoveMedia,
        add_track(tl),
    );

    assert_eq!(history.position(), 2);
}

#[test]
fn a_joinable_step_never_absorbs_a_plain_composite() {
    let (mut project, tl) = project();
    let mut history = History::default();

    let step = history.join(&mut project, None, CommandLabel::RemoveMedia, add_track(tl));
    history.undo(&mut project);
    history.do_command(
        &mut project,
        Box::new(CompositeCommand::new(
            CommandLabel::Gain,
            vec![add_track(tl)],
        )),
    );
    history.join(
        &mut project,
        Some(step),
        CommandLabel::RemoveMedia,
        add_track(tl),
    );

    assert_eq!(history.position(), 2);
}

#[test]
fn an_explicit_label_renames_a_group_of_one_step() {
    let (mut project, tl) = project();
    let mut history = History::default();

    let mark = history.begin_group();
    history.do_command(&mut project, add_track(tl));
    history.end_group_as(mark, CommandLabel::InsertClips);

    assert_eq!(
        history.labels().collect::<Vec<_>>(),
        vec![CommandLabel::InsertClips]
    );
    history.undo(&mut project);
    assert_eq!(tracks(&project, tl), 1);
}

#[test]
fn mixer_params_set_track_and_master_and_undo() {
    let (mut project, tl) = project();
    let mut history = History::default();
    let set = |channel, param, value| Box::new(SetMixerParam::new(tl, channel, param, value));
    history.do_command(
        &mut project,
        set(MixerChannel::Track(0), MixerParam::GainDb, -6.0),
    );
    history.do_command(
        &mut project,
        set(MixerChannel::Master, MixerParam::GainDb, 1000.0),
    );
    history.do_command(
        &mut project,
        set(MixerChannel::Track(0), MixerParam::Pan, -3.0),
    );

    let timeline = &project.timelines[tl];
    assert_eq!(timeline.tracks[0].mix.gain_db, -6.0);
    assert_eq!(timeline.master.gain_db, crate::GAIN_DB_MAX, "clamped");
    assert_eq!(timeline.tracks[0].mix.pan, -1.0, "clamped");

    for _ in 0..3 {
        history.undo(&mut project);
    }
    let timeline = &project.timelines[tl];
    assert_eq!(timeline.tracks[0].mix, ChannelStrip::default());
    assert_eq!(timeline.master, ChannelStrip::default());
}

#[test]
fn a_track_saved_without_mixer_settings_loads_at_unity_gain() {
    let mut value = serde_json::to_value(Track::new(TrackKind::Audio)).unwrap();
    value.as_object_mut().unwrap().remove("mix");
    let track: Track = serde_json::from_value(value).unwrap();
    assert_eq!(track.mix, ChannelStrip::default());
}

#[test]
fn audio_effects_are_added_edited_and_removed_with_undo() {
    let (mut project, tl) = project();
    let mut history = History::default();
    let channel = MixerChannel::Master;
    let normalize = |target_db| {
        AudioEffect::new(crate::AudioEffectKind::Normalize {
            target_db,
            mode: Default::default(),
            set_level: Default::default(),
        })
    };
    let effects = |project: &Project| project.timelines[tl].master.effects.clone();

    history.do_command(
        &mut project,
        Box::new(AddAudioEffect::new(tl, channel, normalize(-1.0))),
    );
    history.do_command(
        &mut project,
        Box::new(AddAudioEffect::new(tl, channel, normalize(-3.0))),
    );
    let off = AudioEffect {
        enabled: false,
        ..normalize(-1.0)
    };
    let label = CommandLabel::ToggleAudioEffect;
    history.do_command(
        &mut project,
        Box::new(SetAudioEffect::new(tl, channel, 0, off.clone(), label)),
    );
    history.do_command(
        &mut project,
        Box::new(RemoveAudioEffect::new(tl, channel, 1)),
    );
    assert_eq!(effects(&project), [off]);
    assert_eq!(history.labels().nth(2), Some(label));

    history.undo(&mut project);
    history.undo(&mut project);
    assert_eq!(effects(&project), [normalize(-1.0), normalize(-3.0)]);
    history.undo(&mut project);
    history.undo(&mut project);
    assert!(effects(&project).is_empty());
}

#[test]
fn moving_an_audio_effect_reorders_the_chain_and_undoes() {
    let (mut project, tl) = project();
    let channel = MixerChannel::Track(0);
    let normalize = |target_db| {
        AudioEffect::new(crate::AudioEffectKind::Normalize {
            target_db,
            mode: Default::default(),
            set_level: Default::default(),
        })
    };
    project.timelines[tl].tracks[0].mix.effects =
        vec![normalize(-1.0), normalize(-2.0), normalize(-3.0)];
    let targets = |project: &Project| -> Vec<f32> {
        project.timelines[tl].tracks[0]
            .mix
            .effects
            .iter()
            .map(|e| match e.kind {
                crate::AudioEffectKind::Normalize { target_db, .. } => target_db,
                crate::AudioEffectKind::MultibandCompressor(_)
                | crate::AudioEffectKind::Mono
                | crate::AudioEffectKind::Equalizer(_) => f32::NAN,
            })
            .collect()
    };
    let mut history = History::default();

    history.do_command(
        &mut project,
        Box::new(MoveAudioEffect::new(tl, channel, 0, 2)),
    );
    assert_eq!(targets(&project), [-2.0, -3.0, -1.0]);
    history.do_command(
        &mut project,
        Box::new(MoveAudioEffect::new(tl, channel, 2, 1)),
    );
    assert_eq!(targets(&project), [-2.0, -1.0, -3.0]);
    history.undo(&mut project);
    history.undo(&mut project);
    assert_eq!(targets(&project), [-1.0, -2.0, -3.0]);
}

#[test]
fn the_processing_precision_is_an_undoable_step() {
    let (mut project, _) = project();
    let mut history = History::default();
    history.do_command(
        &mut project,
        Box::new(SetProcessingPrecision::new(ProcessingPrecision::Standard)),
    );
    assert_eq!(project.precision, ProcessingPrecision::Standard);
    history.undo(&mut project);
    assert_eq!(project.precision, ProcessingPrecision::High);
    history.redo(&mut project);
    assert_eq!(project.precision, ProcessingPrecision::Standard);
}

fn room_clip(project: &mut Project, start: FrameIdx, end: FrameIdx) -> Clip {
    Clip::from_source_range(
        project.alloc_clip_id(),
        ClipSource::Media(MediaId::from_raw(0)),
        start + 10,
        end + 10,
        start,
        Rational::one(),
    )
}

fn room_bounds(project: &Project, timeline: TimelineId, track: usize) -> Vec<(FrameIdx, FrameIdx)> {
    project.timelines[timeline].tracks[track]
        .clips
        .iter()
        .map(|clip| (clip.timeline_start, clip.timeline_end()))
        .collect()
}

#[test]
fn make_room_subtracts_every_interval_from_planned_halves() {
    let cases = [
        (vec![(20, 30), (40, 50)], vec![(0, 20), (30, 40), (50, 100)]),
        (vec![(40, 50), (20, 30)], vec![(0, 20), (30, 40), (50, 100)]),
        (vec![(20, 30), (30, 40)], vec![(0, 20), (40, 100)]),
        (vec![(20, 30), (10, 50)], vec![(0, 10), (50, 100)]),
        (vec![(20, 60), (40, 50)], vec![(0, 20), (60, 100)]),
        (vec![(20, 30), (0, 100)], vec![]),
    ];
    for (cuts, expected) in cases {
        let (mut project, timeline) = project();
        let original = room_clip(&mut project, 0, 100);
        project.timelines[timeline].tracks[0].insert_sorted(original);
        let before = serde_json::to_value(&project.timelines[timeline]).unwrap();
        let ranges: Vec<_> = cuts.iter().map(|&(start, end)| (0, start, end)).collect();
        let mut commands = Vec::new();
        make_room_for_ranges(&mut project, timeline, &ranges, &[], &mut commands);
        assert_eq!(
            serde_json::to_value(&project.timelines[timeline]).unwrap(),
            before
        );
        let mut history = History::default();
        history.do_command(
            &mut project,
            Box::new(CompositeCommand::new(CommandLabel::PasteClips, commands)),
        );
        assert_eq!(room_bounds(&project, timeline, 0), expected, "{cuts:?}");
        for clip in &project.timelines[timeline].tracks[0].clips {
            assert_eq!(clip.source_offset, clip.timeline_start + 10);
        }
        let after = serde_json::to_value(&project.timelines[timeline]).unwrap();
        history.undo(&mut project);
        assert_eq!(
            serde_json::to_value(&project.timelines[timeline]).unwrap(),
            before
        );
        history.redo(&mut project);
        assert_eq!(
            serde_json::to_value(&project.timelines[timeline]).unwrap(),
            after
        );
    }
}

#[test]
fn overwrite_multiple_linked_ranges_relinks_halves_and_restores_native_crossings() {
    let (mut project, timeline) = project();
    project.timelines[timeline]
        .tracks
        .push(Track::new(TrackKind::Audio));
    let group = project.alloc_link_group_id();
    let mut original = room_clip(&mut project, 0, 100);
    original.linked_group = Some(group);
    original.freeze = Some(17);
    original.fade_in = 7;
    original.fade_out = 9;
    original.effects.gain_db = Keyframed::constant(-3.0);
    let mut audio = original.clone();
    audio.id = project.alloc_clip_id();
    audio.audio_stream_index = 2;
    let tail = room_clip(&mut project, 100, 120);
    project.timelines[timeline].tracks[0]
        .crossings
        .push(CrossTransition {
            left_clip: original.id,
            right_clip: tail.id,
            transition: Transition {
                kind: crate::TransitionKind::Push,
                duration: 10,
                direction: crate::PushDirection::Right,
                ease: crate::Ease::None,
                curve: 0.0,
            },
        });
    project.timelines[timeline].tracks[0].insert_sorted(original);
    project.timelines[timeline].tracks[0].insert_sorted(tail);
    project.timelines[timeline].tracks[1].insert_sorted(audio);
    let before = serde_json::to_value(&project.timelines[timeline]).unwrap();
    let mut incoming = Vec::new();
    for (key, (start, end)) in [(20, 30), (40, 50)].into_iter().enumerate() {
        for track in 0..2 {
            incoming.push((track, room_clip(&mut project, start, end), Some(key)));
        }
    }
    let commands = insert_overwriting(&mut project, timeline, incoming);
    let mut history = History::default();
    history.do_command(
        &mut project,
        Box::new(CompositeCommand::new(CommandLabel::PasteClips, commands)),
    );
    assert_eq!(history.position(), 1);
    assert!(project.timelines[timeline].tracks[0].crossings.is_empty());
    for track in 0..2 {
        let clips = &project.timelines[timeline].tracks[track].clips;
        assert!(
            clips
                .windows(2)
                .all(|pair| pair[0].timeline_end() <= pair[1].timeline_start)
        );
        for start in [0, 30, 50] {
            let clip = clips
                .iter()
                .find(|clip| clip.timeline_start == start)
                .unwrap();
            assert_eq!(clip.freeze, Some(17));
            assert_eq!(clip.source_offset, start + 10);
            assert_eq!(clip.effects.gain_db, Keyframed::constant(-3.0));
            assert_eq!(clip.audio_stream_index, if track == 1 { 2 } else { 0 });
        }
    }
    let groups: Vec<_> = [0, 20, 30, 40, 50]
        .into_iter()
        .map(|start| {
            let video = project.timelines[timeline].tracks[0]
                .clips
                .iter()
                .find(|clip| clip.timeline_start == start)
                .unwrap();
            let audio = project.timelines[timeline].tracks[1]
                .clips
                .iter()
                .find(|clip| clip.timeline_start == start)
                .unwrap();
            assert!(video.linked_group.is_some());
            assert_eq!(video.linked_group, audio.linked_group);
            video.linked_group.unwrap()
        })
        .collect();
    assert_eq!(
        groups
            .iter()
            .map(|group| group.0)
            .collect::<BTreeSet<_>>()
            .len(),
        groups.len()
    );
    let after = serde_json::to_value(&project.timelines[timeline]).unwrap();
    history.undo(&mut project);
    assert_eq!(
        serde_json::to_value(&project.timelines[timeline]).unwrap(),
        before
    );
    history.redo(&mut project);
    assert_eq!(
        serde_json::to_value(&project.timelines[timeline]).unwrap(),
        after
    );
}

#[test]
fn make_room_preserves_excluded_and_nonintersecting_linked_members() {
    let (mut project, timeline) = project();
    project.timelines[timeline]
        .tracks
        .extend([Track::new(TrackKind::Audio), Track::new(TrackKind::Audio)]);
    let group = project.alloc_link_group_id();
    let mut excluded_id = None;
    for (track, start, end) in [(0, 0, 100), (1, 200, 300), (2, 0, 100)] {
        let mut clip = room_clip(&mut project, start, end);
        clip.linked_group = Some(group);
        if track == 2 {
            excluded_id = Some(clip.id);
        }
        project.timelines[timeline].tracks[track].locked = track != 0;
        project.timelines[timeline].tracks[track].insert_sorted(clip);
    }
    let before = serde_json::to_value(&project.timelines[timeline]).unwrap();
    let mut commands = Vec::new();
    make_room_for_ranges(
        &mut project,
        timeline,
        &[(0, 20, 30), (1, 20, 30), (2, 20, 30), (0, 40, 50)],
        &[(2, excluded_id.unwrap())],
        &mut commands,
    );
    let mut history = History::default();
    history.do_command(
        &mut project,
        Box::new(CompositeCommand::new(CommandLabel::PasteClips, commands)),
    );
    assert_eq!(
        room_bounds(&project, timeline, 0),
        [(0, 20), (30, 40), (50, 100)]
    );
    for track in 1..3 {
        assert_eq!(
            serde_json::to_value(&project.timelines[timeline].tracks[track]).unwrap(),
            before["tracks"][track]
        );
    }
    history.undo(&mut project);
    assert_eq!(
        serde_json::to_value(&project.timelines[timeline]).unwrap(),
        before
    );
}
