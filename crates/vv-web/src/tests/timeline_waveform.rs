use super::*;
use vv_core::{Clip, ClipId, MediaItem, MediaMeta, Rational, Timeline, Track};

fn fixture() -> (Session, TimelineId, String) {
    let mut session = Session::default();
    let media = session.project.media_pool.insert(MediaItem {
        path: "not-opened/offline.wav".into(),
        meta: MediaMeta {
            duration_frames: 120,
            fps: Rational::new(24, 1),
            width: 0,
            height: 0,
            has_video: false,
            has_audio: true,
            sample_rate: 48_000,
            channels: 2,
            audio_streams: 1,
            file: Default::default(),
        },
        content_hash: 987,
        compound: None,
        folder: None,
    });
    let clip = Clip::from_source_range(
        ClipId(7),
        ClipSource::Media(media),
        12,
        84,
        30,
        Rational::one(),
    );
    let mut track = Track::new(TrackKind::Audio);
    track.locked = true;
    track.clips.push(clip);
    let id = session.create_timeline(Timeline {
        name: "Waveform".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![track],
        markers: vec![],
        master: Default::default(),
    });
    (session, id, "7".into())
}

fn request(id: TimelineId, clips: Vec<String>) -> Request {
    Request {
        query: FrameQuery {
            project_epoch: "wave-reader:1".into(),
            if_generation: "0".into(),
            timeline_id: id.raw().to_string(),
            revision: "current".into(),
            frame: 0,
            width: 640,
        },
        clip_ids: clips,
    }
}

fn at(value: &Value, frame: i64) -> f32 {
    if value["kind"] == "constant" {
        return value["linear"].as_f64().unwrap() as f32;
    }
    value["runs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|run| run[0].as_i64().unwrap() <= frame && frame < run[1].as_i64().unwrap())
        .unwrap()[2]
        .as_f64()
        .unwrap() as f32
}

#[test]
fn timeline_waveform_native_keyed_gain_matches_all_frames_and_clipping() {
    for interpolation in [
        Interpolation::Linear,
        Interpolation::Hold,
        Interpolation::EaseIn,
        Interpolation::EaseOut,
        Interpolation::EaseInOut,
        Interpolation::Bezier {
            c1: [0.2, 1.8],
            c2: [0.8, -0.3],
        },
    ] {
        let (mut session, id, raw) = fixture();
        let gain = &mut session.project.timelines[id].tracks[0].clips[0]
            .effects
            .gain_db;
        gain.upsert(20, -12.0, interpolation);
        gain.upsert(80, 12.0, Interpolation::Hold);
        gain.upsert(100, -6.0, Interpolation::Linear);
        let before = json!(session.project);
        let position = session.history.position();
        let value = presentation(&session, id, &request(id, vec![raw])).unwrap();
        let row = &value["clips"][0];
        assert_eq!(row["state"], "ready");
        assert_eq!(row["content_hash"], "987");
        assert_eq!(row["coverage"], json!([0, 122]));
        for frame in 0..122 {
            let native = vv_audio::mixer::db_to_linear(
                session.project.timelines[id].tracks[0].clips[0]
                    .effects
                    .gain_db
                    .value_at(frame),
            );
            assert_eq!(
                at(&row["gain"], frame).to_bits(),
                native.to_bits(),
                "{interpolation:?} frame {frame}"
            );
        }
        assert!(
            0.5 * at(&row["gain"], 80) > 1.0,
            "the supplied native multiplier exposes clipping"
        );
        assert_eq!(json!(session.project), before);
        assert_eq!(session.history.position(), position);
    }
}

#[test]
fn timeline_waveform_native_clock_preserves_fractional_conform_and_source_end() {
    for timeline_fps in [Rational::new(24, 1), Rational::new(30000, 1001)] {
        for media_fps in [Rational::new(24, 1), Rational::new(48, 1)] {
            for speed in [Rational::new(1, 2), Rational::one(), Rational::new(2, 1)] {
                let (mut session, id, raw) = fixture();
                session.project.timelines[id].fps = timeline_fps;
                let media = match session.project.timelines[id].tracks[0].clips[0].source {
                    ClipSource::Media(media) => media,
                    _ => unreachable!(),
                };
                session.project.media_pool[media].meta.fps = media_fps;
                let clip = &mut session.project.timelines[id].tracks[0].clips[0];
                clip.set_speed(speed, Rational::conform_rate(timeline_fps, media_fps));
                let value = presentation(&session, id, &request(id, vec![raw])).unwrap();
                let clock = &value["clips"][0]["clock"];
                let ratio = |name: &str| {
                    clock[name]["num"].as_f64().unwrap() / clock[name]["den"].as_f64().unwrap()
                };
                let clip = &session.project.timelines[id].tracks[0].clips[0];
                for frame in [
                    clip.timeline_start - 10,
                    clip.timeline_start,
                    clip.timeline_end() - 1,
                    clip.timeline_end() + 20,
                ] {
                    let decoded = (frame - clip.timeline_start
                        + clock["source_offset_frames"].as_i64().unwrap())
                        as f64
                        * ratio("speed")
                        / ratio("timeline_fps");
                    assert_eq!(decoded, clip.media_secs_at(frame, timeline_fps.as_f64()));
                    assert_eq!(
                        (decoded * ratio("media_fps")).floor(),
                        (clip.media_secs_at(frame, timeline_fps.as_f64()) * media_fps.as_f64())
                            .floor()
                    );
                }
            }
        }
    }
}

#[test]
fn timeline_waveform_long_constant_tails_and_hold_spans_do_not_scan_source_frames() {
    let (mut session, id, raw) = fixture();
    let media = match session.project.timelines[id].tracks[0].clips[0].source {
        ClipSource::Media(media) => media,
        _ => unreachable!(),
    };
    session.project.media_pool[media].meta.duration_frames = crate::commands::MAX_FRAME;
    let mut budget = Budget {
        scan: 0,
        runs: 10,
        bytes: MAX_BYTES,
    };
    let track = &mut session.project.timelines[id].tracks[0].clips[0]
        .effects
        .gain_db;
    track.default = -6.0;
    assert_eq!(
        gain(track, crate::commands::MAX_FRAME + 2, &mut budget).unwrap()["kind"],
        "constant"
    );
    track.upsert(100, -6.0, Interpolation::Hold);
    track.upsert(crate::commands::MAX_FRAME - 100, 6.0, Interpolation::Hold);
    let value = presentation(&session, id, &request(id, vec![raw])).unwrap();
    let gain = &value["clips"][0]["gain"];
    assert_eq!(value["clips"][0]["state"], "ready");
    assert_eq!(gain["runs"].as_array().unwrap().len(), 2);
    assert_eq!(at(gain, 0), vv_audio::mixer::db_to_linear(-6.0));
    assert_eq!(
        at(gain, crate::commands::MAX_FRAME + 1),
        vv_audio::mixer::db_to_linear(6.0)
    );
}

#[test]
fn timeline_waveform_budget_is_explicit_bounded_and_does_not_hide_other_constant_clips() {
    let (mut session, id, raw) = fixture();
    let media = match session.project.timelines[id].tracks[0].clips[0].source {
        ClipSource::Media(media) => media,
        _ => unreachable!(),
    };
    session.project.media_pool[media].meta.duration_frames = 1_000_000;
    let clip = &mut session.project.timelines[id].tracks[0].clips[0];
    clip.effects.gain_db.upsert(0, -12.0, Interpolation::Linear);
    clip.effects
        .gain_db
        .upsert(999_999, 12.0, Interpolation::Linear);
    let mut constant = clip.clone();
    constant.id = ClipId(8);
    constant.effects.gain_db = Keyframed::constant(-3.0);
    session.project.timelines[id].tracks[0].clips.push(constant);
    let before = json!(session.project);
    let value = presentation(&session, id, &request(id, vec![raw, "8".into()])).unwrap();
    assert_eq!(value["clips"][0]["state"], "unavailable");
    assert_eq!(value["clips"][0]["reason"], "gain_lookup_budget");
    assert!(value["clips"][0]["gain"].is_null());
    assert_eq!(value["clips"][1]["state"], "ready");
    assert!(serde_json::to_vec(&value).unwrap().len() < MAX_BYTES);
    assert_eq!(json!(session.project), before);
    let mut dense = Keyframed::constant(0.0);
    dense.upsert(0, -100.0, Interpolation::Linear);
    dense.upsert(MAX_SCAN as i64, 30.0, Interpolation::Linear);
    let mut budget = Budget {
        scan: MAX_SCAN,
        runs: MAX_RUNS,
        bytes: MAX_BYTES,
    };
    assert!(
        gain(&dense, 100_000, &mut budget).is_none(),
        "distinct run quota is independent of frame scan quota"
    );
}

#[test]
fn timeline_waveform_exhausted_animated_run_budget_preserves_constant_gain() {
    let (mut session, id, raw) = fixture();
    let media = match session.project.timelines[id].tracks[0].clips[0].source {
        ClipSource::Media(media) => media,
        _ => unreachable!(),
    };
    session.project.media_pool[media].meta.duration_frames = MAX_RUNS as i64 - 2;
    let clip = &mut session.project.timelines[id].tracks[0].clips[0];
    clip.effects.gain_db.upsert(0, -12.0, Interpolation::Linear);
    clip.effects
        .gain_db
        .upsert(MAX_RUNS as i64 - 1, 12.0, Interpolation::Linear);
    let mut constant = clip.clone();
    constant.id = ClipId(8);
    constant.effects.gain_db = Keyframed::constant(-6.0);
    session.project.timelines[id].tracks[0].clips.push(constant);
    let value = presentation(&session, id, &request(id, vec![raw, "8".into()])).unwrap();
    assert_eq!(value["clips"][0]["state"], "ready");
    assert_eq!(
        value["clips"][0]["gain"]["runs"].as_array().unwrap().len(),
        MAX_RUNS
    );
    assert_eq!(value["clips"][1]["state"], "ready");
    assert_eq!(
        value["clips"][1]["gain"],
        json!({"kind":"constant","linear":vv_audio::mixer::db_to_linear(-6.0)})
    );
    assert!(serde_json::to_vec(&value).unwrap().len() <= MAX_BYTES);
    let mut budget = Budget {
        scan: 0,
        runs: 0,
        bytes: 0,
    };
    assert_eq!(
        gain(
            &Keyframed::constant(-6.0),
            crate::commands::MAX_FRAME + 2,
            &mut budget
        )
        .unwrap()["kind"],
        "constant"
    );
}

#[test]
fn timeline_waveform_targets_are_ordered_unique_audio_media_and_invalid_or_frozen_is_hidden() {
    let (mut session, id, raw) = fixture();
    let mut other = session.project.timelines[id].tracks[0].clips[0].clone();
    other.id = ClipId(8);
    session.project.timelines[id].tracks[0].clips.push(other);
    let value = presentation(&session, id, &request(id, vec!["8".into(), raw.clone()])).unwrap();
    assert_eq!(value["clips"][0]["clip_id"], "8");
    for ids in [
        vec![],
        vec![raw.clone(), raw.clone()],
        vec!["999".into()],
        vec![raw.clone(); 65],
    ] {
        assert!(presentation(&session, id, &request(id, ids)).is_err());
    }
    session.project.timelines[id].tracks[0].clips[0].freeze = Some(20);
    let value = presentation(&session, id, &request(id, vec![raw.clone()])).unwrap();
    assert_eq!(value["clips"][0]["state"], "hidden");
    assert_eq!(value["clips"][0]["reason"], "frozen");
    session.project.timelines[id].tracks[0].clips[0].freeze = None;
    session.project.timelines[id].tracks[0].clips[0].audio_stream_index = 1;
    let value = presentation(&session, id, &request(id, vec![raw.clone()])).unwrap();
    assert_eq!(value["clips"][0]["reason"], "invalid_media");
    session.project.timelines[id].tracks[0].kind = TrackKind::Video;
    assert!(presentation(&session, id, &request(id, vec![raw.clone()])).is_err());
    session.project.timelines[id].tracks[0].kind = TrackKind::Audio;
    session.project.timelines[id].tracks[0].clips[0].source = ClipSource::SolidColor;
    assert!(presentation(&session, id, &request(id, vec![raw])).is_err());
    let mut malformed = json!({"query":request(id, vec![]).query,"clip_ids":["7"],"extra":true});
    assert!(serde_json::from_value::<Request>(malformed.clone()).is_err());
    malformed.as_object_mut().unwrap().remove("extra");
    malformed["query"]["extra"] = json!(true);
    assert!(serde_json::from_value::<Request>(malformed).is_err());
}
