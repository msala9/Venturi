use super::*;
use vv_core::{Clip, ClipSource, MediaItem, MediaMeta, Rational, Timeline, Track, TrackKind};

fn fixture() -> (Session, core::TimelineId, String) {
    let mut session = Session::default();
    let timeline = session.create_timeline(Timeline {
        name: "Slip".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![Track::new(TrackKind::Video), Track::new(TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    });
    let media = session.project.media_pool.insert(MediaItem {
        path: "source.mp4".into(),
        meta: MediaMeta {
            duration_frames: 240,
            fps: Rational::new(48, 1),
            width: 640,
            height: 360,
            has_video: true,
            has_audio: true,
            sample_rate: 48000,
            channels: 2,
            audio_streams: 1,
            file: Default::default(),
        },
        content_hash: 42,
        compound: None,
        folder: None,
    });
    let mut first = None;
    for lane in 0..2 {
        let id = session.project.alloc_clip_id();
        let mut clip = Clip::from_source_range(
            id,
            ClipSource::Media(media),
            12,
            60,
            100,
            Rational::new(1, 2),
        );
        clip.linked_group = Some(core::LinkGroupId(1));
        session.project.timelines[timeline].tracks[lane].insert_sorted(clip);
        first.get_or_insert(id);
    }
    (session, timeline, first.unwrap().0.to_string())
}

#[test]
fn split_view_edges_match_native_slip_on_conformed_linked_clips() {
    let (mut session, timeline, clip) = fixture();
    let preview = detail(&session, timeline, &clip, 0).unwrap();
    assert_eq!(preview["clip_ids"].as_array().unwrap().len(), 2);
    assert_eq!(preview["fps"], json!(Rational::new(48, 1)));
    assert_eq!(preview["preview_available"], true);
    let first = preview["window_start"].as_i64().unwrap();
    let expected = preview["frames"][(2 - first) as usize].clone();
    crate::commands::apply(
        &mut session,
        timeline,
        &crate::commands::Operation::Slip {
            clip_ids: vec![clip.clone()],
            delta_frames: 2,
        },
    )
    .unwrap();
    for lane in &session.project.timelines[timeline].tracks {
        assert_eq!(
            expected,
            json!([2, lane.clips[0].source_in(), lane.clips[0].source_out() - 1])
        );
    }
    session.history.undo(&mut session.project);
    assert_eq!(detail(&session, timeline, &clip, 0).unwrap(), preview);
}

#[test]
fn linked_handles_intersect_and_large_windows_remain_bounded_without_mutations() {
    let (mut session, timeline, clip) = fixture();
    session.project.timelines[timeline].tracks[1].clips[0].source_offset = 1;
    let preview = detail(&session, timeline, &clip, 0).unwrap();
    assert_eq!(preview["min_delta"], -1);
    let before = session.history.position();
    assert!(detail(&session, timeline, &clip, -2).is_err());
    assert_eq!(session.history.position(), before);
    session.project.timelines[timeline].tracks[1].locked = true;
    assert_eq!(
        detail(&session, timeline, &clip, 0).unwrap()["locked"],
        true
    );
    for item in session.project.media_pool.values_mut() {
        if item.compound.is_none() {
            item.meta.duration_frames = 1_000_000_000;
        }
    }
    let far = detail(&session, timeline, &clip, 100_000).unwrap();
    assert_eq!(far["frames"].as_array().unwrap().len(), 65537);
    assert_eq!(far["window_start"], 67232);
    assert_eq!(far["window_end"], 132768);
}
