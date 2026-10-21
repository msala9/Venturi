use super::*;

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
