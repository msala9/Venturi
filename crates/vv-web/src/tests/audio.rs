use super::*;

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
