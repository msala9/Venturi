use super::*;

#[test]
fn media_stream_counts_use_native_metadata_without_mutating_legacy_projects() {
    let mut editor = Session::default();
    for (has_audio, audio_streams) in [(true, 2), (true, 0), (false, 4)] {
        editor.project.media_pool.insert(vv_core::MediaItem {
            path: "offline.wav".into(),
            meta: vv_core::MediaMeta {
                duration_frames: 24,
                fps: vv_core::Rational::new(24, 1),
                width: 0,
                height: 0,
                has_video: false,
                has_audio,
                sample_rate: 48000,
                channels: 1,
                audio_streams,
                file: Default::default(),
            },
            content_hash: 0,
            compound: None,
            folder: None,
        });
    }
    let before = serde_json::to_value(&editor.project).unwrap();
    let snapshot = session(&editor, "stream-count-test");
    let counts: Vec<_> = snapshot["media"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["audio_stream_count"].as_u64().unwrap())
        .collect();
    assert_eq!(counts, [2, 1, 0]);
    assert_eq!(serde_json::to_value(&editor.project).unwrap(), before);
    assert_eq!(editor.history.position(), 0);
}

#[test]
fn transition_creation_defaults_match_native_payloads_at_fractional_low_and_high_fps_without_mutation()
 {
    for (fps, standard, smooth) in [
        (vv_core::Rational::new(24, 1), 11, 4),
        (vv_core::Rational::new(30000, 1001), 13, 5),
        (vv_core::Rational::new(60000, 1001), 27, 10),
        (vv_core::Rational::new(25, 2), 6, 2),
        (vv_core::Rational::new(10, 1), 5, 2),
        (vv_core::Rational::new(1, 1000), 1, 1),
        (vv_core::Rational::new(240, 1), 108, 38),
    ] {
        let mut editor = Session::default();
        let id = editor.create_timeline(vv_core::Timeline {
            name: "Native transition defaults".into(),
            fps,
            resolution: (640, 360),
            tracks: vec![vv_core::Track::new(vv_core::TrackKind::Video)],
            markers: vec![],
            master: Default::default(),
        });
        let before = serde_json::to_value(&editor.project).unwrap();
        let history = editor.history.position();
        let snapshot = timeline(&editor, id);
        assert_eq!(
            snapshot["transition_defaults"],
            json!([
                {"kind":"Push","duration":standard,"direction":"Right","ease":"InOut","curve":0.5},
                {"kind":"CrossDissolve","duration":standard,"direction":"Right","ease":"None","curve":0.5},
                {"kind":"SmoothCut","duration":smooth,"direction":"Right","ease":"None","curve":0.5},
            ]),
            "fps {fps:?}"
        );
        let defaults: Vec<vv_core::Transition> =
            serde_json::from_value(snapshot["transition_defaults"].clone()).unwrap();
        for transition in defaults {
            assert_eq!(
                transition.ease,
                vv_core::Transition::default_ease(transition.kind)
            );
            assert!(transition.duration >= 1);
        }
        assert_eq!(serde_json::to_value(&editor.project).unwrap(), before);
        assert_eq!(editor.history.position(), history);
    }
}
