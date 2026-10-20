use super::*;

#[test]
fn native_audio_presets_keep_bypass_chain_order_and_one_undo() {
    let mut s = Session::default();
    let id = s.create_timeline(Timeline {
        name: "Preset".into(),
        fps: core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![core::Track::new(core::TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    });
    let mut effects = vec![
        core::AudioEffect::new(core::AudioEffectKind::Equalizer(core::Equalizer::DEFAULT)),
        core::AudioEffect::new(core::AudioEffectKind::Mono),
        core::AudioEffect::new(core::AudioEffectKind::MultibandCompressor(
            core::MultibandCompressor::DEFAULT,
        )),
    ];
    effects[0].enabled = false;
    s.project.timelines[id].tracks[0].mix.effects = effects.clone();
    s.project.timelines[id].master.effects = effects.clone();
    let position = s.history.position();
    apply_preset(&mut s, id, "0", 0, "mixer.eq_preset_voice").unwrap();
    let after = &s.project.timelines[id].tracks[0].mix.effects;
    assert!(!after[0].enabled);
    assert_eq!(&after[1..], &effects[1..]);
    assert_eq!(
        after[0].kind,
        core::AudioEffectKind::Equalizer(core::presets::equalizer_presets()[1].1.clone())
    );
    assert_eq!(s.history.position(), position + 1);
    s.history.undo(&mut s.project);
    assert_eq!(s.project.timelines[id].tracks[0].mix.effects, effects);
    apply_preset(&mut s, id, "master", 2, "mixer.preset_voice").unwrap();
    assert_eq!(
        s.project.timelines[id].master.effects[2].kind,
        core::AudioEffectKind::MultibandCompressor(
            core::presets::compressor_presets()[2].1.clone()
        )
    );
    s.history.undo(&mut s.project);
    assert_eq!(s.project.timelines[id].master.effects, effects);
    for (index, key) in [
        (0, "unknown"),
        (0, "mixer.preset_voice"),
        (1, "mixer.eq_preset_voice"),
        (99, "mixer.eq_preset_voice"),
    ] {
        assert!(apply_preset(&mut s, id, "0", index, key).is_err());
        assert_eq!(s.project.timelines[id].tracks[0].mix.effects, effects);
        assert_eq!(s.history.position(), position);
    }
    s.project.timelines[id].tracks[0].locked = true;
    assert_eq!(
        apply_preset(&mut s, id, "0", 0, "mixer.eq_preset_voice")
            .unwrap_err()
            .1,
        "TRACK_LOCKED"
    );
    for (_, eq) in core::presets::equalizer_presets() {
        validate(&[core::AudioEffect::new(core::AudioEffectKind::Equalizer(eq))]).unwrap();
    }
    for (_, compressor) in core::presets::compressor_presets() {
        validate(&[core::AudioEffect::new(
            core::AudioEffectKind::MultibandCompressor(compressor),
        )])
        .unwrap();
    }
    assert_eq!(
        catalog()["presets"]["Equalizer"].as_array().unwrap().len(),
        7
    );
}

#[test]
fn every_native_audio_default_is_valid_and_nonfinite_or_unordered_values_are_refused() {
    let effects: Vec<_> = core::AudioEffectKind::ALL
        .into_iter()
        .map(core::AudioEffect::new)
        .collect();
    validate(&effects).unwrap();
    assert_eq!(catalog()["defaults"].as_object().unwrap().len(), 4);
    let mut eq = core::Equalizer::DEFAULT;
    eq.bands[2].q = f32::NAN;
    assert!(validate(&[core::AudioEffect::new(core::AudioEffectKind::Equalizer(eq))]).is_err());
    let mut compressor = core::MultibandCompressor::DEFAULT;
    compressor.crossovers_hz = [2000.0, 200.0];
    assert!(
        validate(&[core::AudioEffect::new(
            core::AudioEffectKind::MultibandCompressor(compressor)
        )])
        .is_err()
    );
    assert!(
        validate(&[core::AudioEffect::new(core::AudioEffectKind::Normalize {
            target_db: 1.0,
            mode: core::NormalizeMode::SamplePeak,
            set_level: core::SetLevel::Relative
        })])
        .is_err()
    );
}

#[test]
fn whole_audio_chain_replacement_is_atomic_ordered_and_reversible() {
    let mut s = Session::default();
    let id = s.create_timeline(Timeline {
        name: "Mix".into(),
        fps: core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![core::Track::new(core::TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    });
    let mono = core::AudioEffect::new(core::AudioEffectKind::Mono);
    set_effects(&mut s, id, "0", std::slice::from_ref(&mono)).unwrap();
    let before = s.timeline_revision(id);
    let position = s.history.position();
    let next = vec![
        core::AudioEffect::new(core::AudioEffectKind::Equalizer(core::Equalizer::DEFAULT)),
        mono,
    ];
    set_effects(&mut s, id, "0", &next).unwrap();
    assert_eq!(s.history.position(), position + 1);
    assert_eq!(s.project.timelines[id].tracks[0].mix.effects, next);
    s.history.undo(&mut s.project);
    assert_eq!(s.timeline_revision(id), before);
    let mut invalid = next.clone();
    if let core::AudioEffectKind::Equalizer(eq) = &mut invalid[0].kind {
        eq.bands[0].freq_hz = 0.0;
    }
    assert!(set_effects(&mut s, id, "0", &invalid).is_err());
    assert_eq!(s.timeline_revision(id), before);
    s.project.timelines[id].tracks[0].locked = true;
    assert_eq!(
        set_effects(&mut s, id, "0", &next).unwrap_err().1,
        "TRACK_LOCKED"
    );
    set_effects(&mut s, id, "master", &next).unwrap();
    assert_eq!(s.project.timelines[id].master.effects, next);
}

#[test]
fn eq_graph_uses_native_response_and_bypass_returns_a_flat_curve() {
    let mut timeline = Timeline {
        name: "EQ".into(),
        fps: core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![],
        markers: vec![],
        master: Default::default(),
    };
    let mut eq = core::Equalizer::DEFAULT;
    eq.bands[2].gain_db = 6.0;
    timeline
        .master
        .effects
        .push(core::AudioEffect::new(core::AudioEffectKind::Equalizer(eq)));
    let response = eq_response(&timeline, "master", 0).unwrap();
    let points = response["points"].as_array().unwrap();
    assert_eq!(points.len(), 128);
    assert_eq!(response["sample_rate"], 48000);
    assert!(points.iter().any(|point| point[1].as_f64().unwrap() > 5.9));
    timeline.master.effects[0].enabled = false;
    assert!(
        eq_response(&timeline, "master", 0).unwrap()["points"]
            .as_array()
            .unwrap()
            .iter()
            .all(|point| point[1] == 0.0)
    );
    assert!(eq_response(&timeline, "master", 1).is_err());
}
