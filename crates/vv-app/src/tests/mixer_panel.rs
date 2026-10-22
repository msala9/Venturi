use super::*;

#[test]
fn shared_audio_preset_apply_uses_one_native_undo_and_preserves_bypass_and_other_inserts() {
    let root = std::env::temp_dir().join(format!(
        "vv-mixer-shared-presets-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut library = AudioPresetLibrary::open(
        root.clone(),
        serde_json::json!({"eq_presets":[],"compressor_presets":[]}),
    );
    let mut voice = vv_core::Equalizer::DEFAULT;
    voice.bands[2].gain_db = -6.0;
    library.bank().save("Voice", &voice).unwrap();
    for channel in [MixerChannel::Master, MixerChannel::Track(0)] {
        let mut session = vv_session::Session::default();
        let chain = vec![
            AudioEffect::new(AudioEffectKind::Mono),
            AudioEffect {
                enabled: false,
                kind: AudioEffectKind::Equalizer(vv_core::Equalizer::DEFAULT),
            },
            AudioEffect::new(AudioEffectKind::MultibandCompressor(
                vv_core::MultibandCompressor::DEFAULT,
            )),
        ];
        let mut track = vv_core::Track::new(TrackKind::Audio);
        track.mix.effects = chain.clone();
        let timeline = session.project.timelines.insert(Timeline {
            name: "Preset apply".into(),
            fps: vv_core::Rational::new(24, 1),
            resolution: (1280, 720),
            tracks: vec![track],
            markers: vec![],
            master: ChannelStrip {
                effects: chain,
                ..Default::default()
            },
        });
        let before = serde_json::to_value(&session.project).unwrap();
        let mut expected = session.project.clone();
        let strip = match channel {
            MixerChannel::Master => &mut expected.timelines[timeline].master,
            MixerChannel::Track(index) => &mut expected.timelines[timeline].tracks[index].mix,
        };
        strip.effects[1].kind = AudioEffectKind::Equalizer(voice.clone());
        let effect = channel_strip(&session.project.timelines[timeline], channel)
            .unwrap()
            .effects[1]
            .clone();
        let value = library
            .bank::<vv_core::Equalizer>()
            .resolve("Voice")
            .unwrap();
        session.apply(effect_parameter_command(
            timeline,
            channel,
            1,
            &effect,
            AudioEffectKind::Equalizer(value),
        ));
        assert_eq!(session.history.generation(), 1);
        let after = serde_json::to_value(&session.project).unwrap();
        assert_eq!(after, serde_json::to_value(&expected).unwrap());
        session.history.undo(&mut session.project);
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
        session.history.redo(&mut session.project);
        assert_eq!(serde_json::to_value(&session.project).unwrap(), after);
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn fader_curve_puts_unity_at_its_mark_and_spans_the_whole_gain_range() {
    assert_eq!(fader_position(0.0), 0.7);
    assert_eq!(fader_position(vv_core::GAIN_DB_MIN), 0.0);
    assert_eq!(fader_position(vv_core::GAIN_DB_MAX), 1.0);
    assert_eq!(fader_position(-1000.0), 0.0, "clamped");
}

#[test]
fn fader_db_inverts_fader_position() {
    for db in [-100.0, -73.5, -30.0, -7.2, 0.0, 4.5, 30.0] {
        assert!((fader_db(fader_position(db)) - db).abs() < 1e-3, "{db}");
    }
}

#[test]
fn pan_reads_as_centre_or_side_percent() {
    assert_eq!(format_pan(0.0), "C");
    assert_eq!(format_pan(0.001), "C");
    assert_eq!(format_pan(-0.3), "L30");
    assert_eq!(format_pan(1.0), "R100");
}

#[test]
fn the_settings_window_follows_the_removal_of_an_effect_above_it() {
    let timeline = <vv_core::TimelineId as vv_core::Id>::from_raw(1);
    let channel = MixerChannel::Track(2);
    let mut state = MixerPanelState::default();
    let remove = |index| StripEdit {
        remove_effect: Some(index),
        ..StripEdit::default()
    };

    state.follow_edit(
        &StripEdit {
            open_settings: Some(2),
            ..StripEdit::default()
        },
        timeline,
        channel,
    );
    state.follow_edit(&remove(3), timeline, channel);
    state.follow_edit(&remove(0), timeline, MixerChannel::Master);
    assert_eq!(state.open_effect, Some((timeline, channel, 2)));
    state.follow_edit(&remove(0), timeline, channel);
    assert_eq!(state.open_effect, Some((timeline, channel, 1)));
    state.follow_edit(&remove(1), timeline, channel);
    assert_eq!(state.open_effect, None);
}

#[test]
fn dropping_in_the_gaps_around_an_effect_leaves_it_where_it_is() {
    assert_eq!(moved_to(1, 1), None);
    assert_eq!(moved_to(1, 2), None);
    assert_eq!(moved_to(1, 0), Some(0));
    assert_eq!(moved_to(0, 3), Some(2), "to the end of three");
    assert_eq!(moved_to(2, 1), Some(1));
}

#[test]
fn the_other_effects_shift_around_a_moved_one() {
    // [a b c d], b to the end: [a c d b].
    let after: Vec<usize> = (0..4).map(|i| index_after_move(i, 1, 3)).collect();
    assert_eq!(after, [0, 3, 1, 2]);
    // [a b c d], d to the front: [d a b c].
    let after: Vec<usize> = (0..4).map(|i| index_after_move(i, 3, 0)).collect();
    assert_eq!(after, [1, 2, 3, 0]);
}
