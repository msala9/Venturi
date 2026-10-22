use super::*;

#[test]
fn native_timeline_gaps_include_leading_and_internal_ranges_only_on_unlocked_lanes() {
    let mut editor = Session::default();
    let id = editor.create_timeline(vv_core::Timeline {
        name: "Native gap metadata".into(),
        fps: vv_core::Rational::new(24, 1),
        resolution: (16, 16),
        tracks: (0..4)
            .map(|_| vv_core::Track::new(vv_core::TrackKind::Video))
            .collect(),
        markers: vec![],
        master: Default::default(),
    });
    for (track, start, length) in [(0, 12, 6), (0, 30, 6), (1, 0, 6), (1, 18, 6), (3, 24, 6)] {
        let mut clip = vv_core::Clip::from_source_range(
            editor.project.alloc_clip_id(),
            vv_core::ClipSource::SolidColor,
            0,
            length,
            start,
            vv_core::Rational::one(),
        );
        clip.audio_stream_index = track + 1;
        editor.project.timelines[id].tracks[track].insert_sorted(clip);
    }
    editor.project.timelines[id].tracks[3].locked = true;
    let before = serde_json::to_value(&editor.project).unwrap();
    let generation = editor.history.generation();
    let position = editor.history.position();
    let revision = editor.timeline_revision(id);
    let snapshot = timeline(&editor, id);
    for (index, track) in snapshot["tracks"].as_array().unwrap().iter().enumerate() {
        for clip in track["clips"].as_array().unwrap() {
            assert_eq!(clip["audio_stream_index"], index + 1);
        }
    }
    assert_eq!(
        timeline(&editor, id)["gaps"],
        json!([
            {"track_id":"0","start_frame":0,"length_frames":12},
            {"track_id":"0","start_frame":18,"length_frames":12},
            {"track_id":"1","start_frame":6,"length_frames":12},
        ])
    );
    assert_eq!(serde_json::to_value(&editor.project).unwrap(), before);
    assert_eq!(editor.history.generation(), generation);
    assert_eq!(editor.history.position(), position);
    assert_eq!(editor.timeline_revision(id), revision);
}

#[test]
fn timeline_export_scales_are_native_dimensions_without_a_preview_width_cap_or_project_mutation() {
    let mut session = Session::default();
    let id = session.create_timeline(vv_core::Timeline {
        name: "Native export dimensions".into(),
        fps: vv_core::Rational::new(30000, 1001),
        resolution: (4096, 2160),
        tracks: vec![],
        markers: vec![],
        master: Default::default(),
    });
    let before = serde_json::to_value(&session.project).unwrap();
    let generation = session.history.generation();
    let value = timeline(&session, id);
    assert_eq!(
        value["export_scales"],
        json!([{"percent":100,"width":4096,"height":2160},{"percent":75,"width":3072,"height":1620},{"percent":50,"width":2048,"height":1080},{"percent":25,"width":1024,"height":540}])
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.generation(), generation);
}

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
