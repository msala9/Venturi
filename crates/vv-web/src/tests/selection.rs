use super::*;
use vv_core::{Clip, Rational, Timeline, Track};

fn fixture() -> (Session, TimelineId, Vec<String>) {
    let mut session = Session::default();
    let audio = session.project.alloc_clip_id();
    let video = session.project.alloc_clip_id();
    let frozen = session.project.alloc_clip_id();
    let mut tracks = vec![Track::new(TrackKind::Audio), Track::new(TrackKind::Video)];
    tracks[0].insert_sorted(Clip::from_source_range(
        audio,
        ClipSource::SolidColor,
        5,
        101,
        0,
        Rational::one(),
    ));
    tracks[1].insert_sorted(Clip::from_source_range(
        video,
        ClipSource::Text,
        10,
        106,
        24,
        Rational::new(1, 2),
    ));
    let mut hold = Clip::from_source_range(
        frozen,
        ClipSource::SolidColor,
        20,
        116,
        100,
        Rational::one(),
    );
    hold.freeze = Some(77);
    tracks[1].insert_sorted(hold);
    tracks[1].locked = true;
    let id = session.create_timeline(Timeline {
        name: "Selection".into(),
        fps: Rational::new(24, 1),
        resolution: (64, 36),
        tracks,
        markers: vec![],
        master: Default::default(),
    });
    (
        session,
        id,
        vec![
            audio.0.to_string(),
            frozen.0.to_string(),
            video.0.to_string(),
        ],
    )
}

#[test]
fn selection_uses_native_clamped_editor_clocks_even_on_frozen_clips_in_video_then_audio_order() {
    let (session, id, ids) = fixture();
    let before = serde_json::to_value(&session.project).unwrap();
    let history = session.history.position();
    let early = rows(&session, id, 0, &ids).unwrap();
    assert_eq!(
        early
            .iter()
            .map(|row| row["clip_id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec![ids[2].as_str(), ids[1].as_str(), ids[0].as_str()]
    );
    assert_eq!(
        early
            .iter()
            .map(|row| row["source_frame"].as_i64().unwrap())
            .collect::<Vec<_>>(),
        vec![10, 20, 5]
    );
    assert_eq!(early[0]["locked"], true);
    assert_eq!(early[2]["kind"], "audio");
    let middle = rows(&session, id, 30, &ids).unwrap();
    assert_eq!(middle[0]["source_frame"], 22);
    let late = rows(&session, id, 400, &ids).unwrap();
    assert_eq!(late[0]["source_frame"], 104);
    assert_eq!(late[1]["source_frame"], 115);
    assert_eq!(late[2]["source_frame"], 100);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), history);
}

#[test]
fn selection_rejects_missing_duplicate_and_excessive_targets_without_partial_rows() {
    let (session, id, ids) = fixture();
    for selection in [
        vec![],
        vec![ids[0].clone(), format!("0{}", ids[0])],
        vec![ids[0].clone(), "999999".into()],
        vec!["not-a-clip".into()],
        vec![ids[0].clone(); 2049],
    ] {
        assert!(rows(&session, id, 0, &selection).is_err());
    }
}
