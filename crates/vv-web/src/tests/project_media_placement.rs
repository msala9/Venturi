use super::*;
use crate::commands::AssetDropTarget;
use serde_json::json;
use vv_core::{self as core, ClipSource, CommandLabel, Rational, Timeline, Track, TrackKind, edit};

struct Fixture {
    root: PathBuf,
    files: Files,
    session: Session,
    timeline: TimelineId,
    child: TimelineId,
    still: MediaId,
    compound: MediaId,
    video: MediaId,
    audio: MediaId,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "vv-project-placement-{label}-{}",
            crate::asset_jobs::nonce()
        ));
        let files = Files::new(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let mut session = Session::default();
        let timeline = session.create_timeline(Timeline {
            name: "Destination".into(),
            fps: Rational::new(24, 1),
            resolution: (16, 16),
            tracks: vec![Track::new(TrackKind::Video), Track::new(TrackKind::Audio)],
            markers: vec![],
            master: Default::default(),
        });
        let child = session.create_timeline(Timeline {
            name: "Existing child".into(),
            fps: Rational::new(24, 1),
            resolution: (16, 16),
            tracks: vec![Track::new(TrackKind::Video)],
            markers: vec![],
            master: Default::default(),
        });
        edit::insert_generator(
            &mut session.project,
            &mut session.history,
            child,
            edit::Generator::SolidColor,
            0,
            0,
            Some(12),
        );
        session.sync_timeline_media(child);
        let compound = session
            .project
            .media_pool
            .iter()
            .find(|(_, item)| item.compound == Some(child))
            .unwrap()
            .0;
        let mut add = |name: &str, duration, fps, video, audio, streams| {
            let path = root.join(name);
            // Placement uses trusted project metadata, without decoding or Source jobs.
            std::fs::write(&path, b"existing project source").unwrap();
            session.project.media_pool.insert(core::MediaItem {
                path,
                meta: core::MediaMeta {
                    duration_frames: duration,
                    fps,
                    width: if video { 16 } else { 0 },
                    height: if video { 16 } else { 0 },
                    has_video: video,
                    has_audio: audio,
                    sample_rate: if audio { 48000 } else { 0 },
                    channels: if audio { 2 } else { 0 },
                    audio_streams: streams,
                    file: Default::default(),
                },
                content_hash: 1,
                compound: None,
                folder: None,
            })
        };
        let still = add(
            "still.png",
            core::IMAGE_DURATION_FRAMES,
            Rational::new(24, 1),
            true,
            false,
            0,
        );
        let video = add("video.mp4", 30, Rational::new(30, 1), true, true, 2);
        let audio = add("audio.wav", 12, Rational::new(24, 1), false, true, 1);
        Self {
            root,
            files,
            session,
            timeline,
            child,
            still,
            compound,
            video,
            audio,
        }
    }

    fn operation(
        &self,
        ids: &[MediaId],
        start: i64,
        target: AssetDropTarget,
        overwrite: bool,
    ) -> Operation {
        Operation::PlaceProjectMedia {
            media_ids: ids.iter().map(|id| id.raw().to_string()).collect(),
            start_frame: start,
            target,
            overwrite,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn project_pool_batch_matches_native_panel_order_still_compound_streams_and_one_undo() {
    let mut f = Fixture::new("native");
    let selected = [f.still, f.compound, f.video, f.audio];
    let operation = f.operation(&selected, 96, AssetDropTarget::NewAudioTrack {}, false);
    let before = f.session.project.clone();
    let mut oracle = Session::default();
    oracle.project = before.clone();
    let mark = oracle.history.begin_group();
    let extra = edit::add_track(
        &mut oracle.project,
        &mut oracle.history,
        f.timeline,
        TrackKind::Audio,
    );
    let mut cursor = 96;
    let mut expected = Vec::new();
    for media in selected {
        let meta = oracle.project.media_pool[media].meta.clone();
        let out = if meta.is_image() {
            (meta.fps.as_f64() * 5.0).round() as i64
        } else {
            meta.duration_frames
        };
        expected.extend(
            edit::insert_media(
                &mut oracle.project,
                &mut oracle.history,
                f.timeline,
                edit::MediaInsert {
                    media_id: media,
                    source_in: 0,
                    source_out: out,
                    video: meta.has_video,
                    audio: meta.has_audio,
                },
                cursor,
                edit::TargetTracks {
                    video: Some(0),
                    extra_audio: Some(extra),
                },
            )
            .unwrap(),
        );
        cursor += Rational::conform_rate(Rational::new(24, 1), meta.fps).scale_round(out);
    }
    oracle.history.end_group_as(mark, CommandLabel::InsertClips);
    let position = f.session.history.position();
    let inserted = place(&mut f.session, &f.files, f.timeline, &operation).unwrap();
    assert_eq!(
        inserted,
        expected
            .iter()
            .map(|(_, clip)| clip.0.to_string())
            .collect::<Vec<_>>()
    );
    assert_eq!(inserted.len(), 6);
    assert_eq!(cursor, 264);
    assert_eq!(f.session.project.timelines[f.timeline].tracks.len(), 3);
    assert_eq!(f.session.history.position(), position + 1);
    assert_eq!(json!(f.session.project), json!(oracle.project));
    let video = &f.session.project.timelines[f.timeline].tracks[0].clips;
    assert_eq!(
        video
            .iter()
            .map(|clip| (clip.timeline_start, clip.timeline_len))
            .collect::<Vec<_>>(),
        vec![(96, 120), (216, 12), (228, 24)]
    );
    assert!(matches!(video[1].source, ClipSource::Media(media) if media == f.compound));
    let timeline = &f.session.project.timelines[f.timeline];
    assert_eq!(timeline.tracks[extra].clips[0].audio_stream_index, 0);
    assert_eq!(timeline.tracks[1].clips[0].audio_stream_index, 1);
    assert_eq!(
        video[2].linked_group,
        timeline.tracks[extra].clips[0].linked_group
    );
    assert_ne!(
        video[2].linked_group,
        timeline.tracks[extra].clips[1].linked_group
    );
    let after = json!(f.session.project);
    f.session.history.undo(&mut f.session.project);
    oracle.history.undo(&mut oracle.project);
    assert_eq!(json!(f.session.project), json!(oracle.project));
    assert_eq!(
        json!(f.session.project.timelines[f.timeline]),
        json!(before.timelines[f.timeline])
    );
    f.session.history.redo(&mut f.session.project);
    assert_eq!(json!(f.session.project), after);
    for name in ["still.png", "video.mp4", "audio.wav"] {
        assert_eq!(
            std::fs::read(f.root.join(name)).unwrap(),
            b"existing project source"
        );
    }
}

#[test]
fn project_pool_placement_uses_current_compound_metadata_and_refuses_cycles_offline_and_locked_targets()
 {
    let mut f = Fixture::new("guards");
    edit::insert_generator(
        &mut f.session.project,
        &mut f.session.history,
        f.child,
        edit::Generator::SolidColor,
        0,
        12,
        Some(12),
    );
    f.session.sync_timeline_media(f.child);
    let operation = f.operation(
        &[f.compound],
        96,
        AssetDropTarget::Track {
            track_id: "0".into(),
        },
        false,
    );
    place(&mut f.session, &f.files, f.timeline, &operation).unwrap();
    assert_eq!(
        f.session.project.timelines[f.timeline].tracks[0].clips[0].timeline_len,
        24
    );
    f.session.sync_timeline_media(f.timeline);
    let own = f
        .session
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(f.timeline))
        .unwrap()
        .0;
    let before = json!(f.session.project);
    let position = f.session.history.position();
    let cycle = f.operation(
        &[f.audio, own],
        200,
        AssetDropTarget::NewVideoTrack {},
        false,
    );
    assert!(place(&mut f.session, &f.files, f.timeline, &cycle).is_err());
    let overlap = f.operation(
        &[f.still],
        96,
        AssetDropTarget::Track {
            track_id: "0".into(),
        },
        false,
    );
    assert_eq!(
        place(&mut f.session, &f.files, f.timeline, &overlap)
            .unwrap_err()
            .1,
        "OVERLAP"
    );
    f.session.project.timelines[f.timeline].tracks[1].locked = true;
    let locked = f.operation(
        &[f.video],
        200,
        AssetDropTarget::Track {
            track_id: "1".into(),
        },
        false,
    );
    assert_eq!(
        place(&mut f.session, &f.files, f.timeline, &locked)
            .unwrap_err()
            .1,
        "TRACK_LOCKED"
    );
    f.session.project.timelines[f.timeline].tracks[1].locked = false;
    std::fs::remove_file(f.root.join("audio.wav")).unwrap();
    let offline = f.operation(
        &[f.still, f.compound, f.audio],
        200,
        AssetDropTarget::NewVideoTrack {},
        false,
    );
    assert_eq!(
        place(&mut f.session, &f.files, f.timeline, &offline)
            .unwrap_err()
            .1,
        "SOURCE_OFFLINE"
    );
    assert_eq!(json!(f.session.project), before);
    assert_eq!(f.session.history.position(), position);
}

#[test]
fn project_pool_placement_validates_unique_ids_aggregate_limits_and_source_witnesses_without_edits()
{
    let mut f = Fixture::new("limits");
    let operation = f.operation(
        &[f.video],
        0,
        AssetDropTarget::Track {
            track_id: "0".into(),
        },
        false,
    );
    let before = json!(f.session.project);
    let position = f.session.history.position();
    assert_eq!(
        commands::apply(&mut f.session, f.timeline, &operation)
            .unwrap_err()
            .1,
        "PROJECT_MEDIA_PLACEMENT_REQUIRED"
    );
    for ids in [
        vec![],
        vec![f.video.raw().to_string(); 2],
        vec![format!("0{}", f.video.raw())],
        vec![f.video.raw().to_string(); 257],
        vec!["+1".into()],
        vec!["18446744073709551615".into()],
    ] {
        let mut value = json!(operation);
        value["media_ids"] = json!(ids);
        let invalid = serde_json::from_value(value).unwrap();
        assert!(place(&mut f.session, &f.files, f.timeline, &invalid).is_err());
    }
    let selected = sources(&f.session, &f.files, &[f.video.raw().to_string()]).unwrap();
    let path = f.root.join("video.mp4");
    let metadata = std::fs::metadata(&path).unwrap();
    std::fs::write(&path, b"changed! project source").unwrap();
    std::fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(metadata.modified().unwrap()))
        .unwrap();
    assert_eq!(std::fs::metadata(&path).unwrap().len(), metadata.len());
    assert_eq!(
        unchanged(&f.files, &selected.witnesses).unwrap_err().1,
        "SOURCE_CHANGED"
    );
    assert_eq!(json!(f.session.project), before);
    assert_eq!(f.session.history.position(), position);
    let mut ids = Vec::new();
    for _ in 0..33 {
        let mut item = f.session.project.media_pool[f.video].clone();
        item.meta.audio_streams = 128;
        ids.push(f.session.project.media_pool.insert(item));
    }
    let large = f.operation(&ids, 0, AssetDropTarget::NewVideoTrack {}, false);
    let before = json!(f.session.project);
    assert_eq!(
        place(&mut f.session, &f.files, f.timeline, &large)
            .unwrap_err()
            .2,
        "A project media placement supports at most 4096 new clips"
    );
    assert_eq!(json!(f.session.project), before);
    let value = json!(operation);
    assert!(value.get("overwrite").is_none());
    for field in ["unexpected", "source_in", "job_id"] {
        let mut bad = value.clone();
        bad[field] = json!(0);
        assert!(serde_json::from_value::<Operation>(bad).is_err());
    }
}
