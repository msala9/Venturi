use super::*;
use crate::{History, MediaItem, MediaMeta, Track};

const ORIGIN: ClipboardOrigin = ClipboardOrigin {
    instance: 7,
    epoch: 1,
};

#[test]
fn copied_entry_introspection_preserves_native_text_and_u64_ids() {
    let project = Project::default();
    let clip = Clip::from_source_range(
        crate::ClipId(9_007_199_254_740_993),
        ClipSource::SolidColor,
        0,
        10,
        0,
        Rational::one(),
    );
    let payload = ClipboardPayload::new(ORIGIN, &project, &[], &[entry(clip)]);
    let text = payload.to_text();
    let decoded = ClipboardPayload::from_text(&text).unwrap().unwrap();
    assert_eq!(decoded.clip_entries().len(), 1);
    assert_eq!(decoded.clip_entries()[0].clip.id.0, 9_007_199_254_740_993);
    assert_eq!(decoded.clip_entries()[0].track_number, 1);
    assert_eq!(decoded.to_text(), text);
    assert!(text.starts_with("venturi-clipboard/1\n"));
}

fn meta() -> MediaMeta {
    MediaMeta {
        duration_frames: 100,
        fps: Rational::new(30, 1),
        width: 64,
        height: 48,
        has_video: true,
        has_audio: false,
        sample_rate: 48_000,
        channels: 2,
        audio_streams: 1,
        file: Default::default(),
    }
}

fn file(path: &str, content_hash: u64) -> MediaItem {
    MediaItem {
        path: path.into(),
        meta: meta(),
        content_hash,
        compound: None,
        folder: None,
    }
}

fn media_clip(project: &mut Project, media: MediaId, start: FrameIdx) -> Clip {
    Clip::from_source_range(
        project.alloc_clip_id(),
        ClipSource::Media(media),
        0,
        10,
        start,
        Rational::one(),
    )
}

fn entry(clip: Clip) -> ClipboardEntry {
    ClipboardEntry {
        track_kind: TrackKind::Video,
        track_number: 1,
        relative_start: clip.timeline_start,
        clip,
        timeline_fps: Rational::new(30, 1),
        link_tag: None,
    }
}

/// A compound clip whose timeline uses `inner`.
fn compound(project: &mut Project, name: &str, inner: MediaId) -> MediaId {
    let mut track = Track::new(TrackKind::Video);
    track.clips = vec![media_clip(project, inner, 0)];
    let timeline = project.timelines.insert(Timeline {
        name: name.into(),
        fps: Rational::new(30, 1),
        resolution: (64, 48),
        tracks: vec![track],
        markers: Vec::new(),
        master: Default::default(),
    });
    let item = project.timeline_item(timeline, &project.timelines[timeline].clone(), None);
    let id = project.media_pool.insert(item);
    project.sync_compound_meta(id);
    id
}

fn paste(payload: ClipboardPayload, project: &mut Project) -> Pasted {
    let text = payload.to_text();
    let payload = ClipboardPayload::from_text(&text)
        .expect("a payload")
        .expect("well formed");
    let mut add = AddEntities::new(crate::CommandLabel::PasteClips);
    let pasted = payload.merge_into(project, &mut add);
    History::default().do_command(project, Box::new(add));
    pasted
}

fn source_of(entry: &ClipboardEntry) -> MediaId {
    match entry.clip.source {
        ClipSource::Media(id) => id,
        _ => panic!("not a media clip"),
    }
}

#[test]
fn foreign_text_is_not_a_payload() {
    assert!(ClipboardPayload::from_text("hello").is_none());
    assert!(ClipboardPayload::from_text("venturi:clip").is_none());
}

#[test]
fn a_newer_version_is_refused() {
    let text = "venturi-clipboard/2\n{}";
    assert!(matches!(
        ClipboardPayload::from_text(text),
        Some(Err(PayloadError::UnsupportedVersion(2)))
    ));
}

#[test]
fn pasted_media_point_to_the_same_files_at_the_root() {
    let mut source = Project::default();
    // Shifts the ids, so they collide with the destination's.
    source.media_pool.insert(file("/src/unused.mp4", 1));
    let a = source.media_pool.insert(file("/footage/a.mp4", 2));
    let clip = media_clip(&mut source, a, 5);
    let payload = ClipboardPayload::new(ORIGIN, &source, &[], &[entry(clip)]);

    let mut dest = Project::default();
    let other = dest.media_pool.insert(file("/dest/other.mp4", 3));
    let folder = dest.folders.insert(crate::MediaFolder {
        name: "F".into(),
        parent: None,
    });
    dest.media_pool.get_mut(other).unwrap().folder = Some(folder);
    let pasted = paste(payload, &mut dest);

    assert_eq!(dest.media_pool.len(), 2);
    let new = source_of(&pasted.clips[0]);
    assert_ne!(new, other);
    let item = &dest.media_pool[new];
    assert_eq!(item.path, std::path::Path::new("/footage/a.mp4"));
    assert_eq!(item.folder, None);
    assert_eq!(pasted.clips[0].relative_start, 5);
}

#[test]
fn a_file_already_in_the_pool_is_reused_by_path_or_content() {
    let mut source = Project::default();
    let a = source.media_pool.insert(file("/footage/a.mp4", 10));
    let b = source.media_pool.insert(file("/old/b.mp4", 20));
    let clips = [
        media_clip(&mut source, a, 0),
        media_clip(&mut source, b, 10),
    ];
    let payload = ClipboardPayload::new(ORIGIN, &source, &[], &clips.map(entry));

    let mut dest = Project::default();
    let dest_a = dest.media_pool.insert(file("/footage/a.mp4", 0));
    let dest_b = dest.media_pool.insert(file("/moved/b.mp4", 20));
    let pasted = paste(payload, &mut dest);

    assert_eq!(dest.media_pool.len(), 2);
    assert_eq!(source_of(&pasted.clips[0]), dest_a);
    assert_eq!(source_of(&pasted.clips[1]), dest_b);
}

#[test]
fn an_unknown_hash_does_not_match_another_unknown_hash() {
    let mut source = Project::default();
    let a = source.media_pool.insert(file("/footage/a.mp4", 0));
    let payload = ClipboardPayload::new(ORIGIN, &source, &[a], &[]);

    let mut dest = Project::default();
    dest.media_pool.insert(file("/footage/z.mp4", 0));
    let pasted = paste(payload, &mut dest);

    assert_eq!(dest.media_pool.len(), 2);
    assert_eq!(
        dest.media_pool[pasted.media[0]].path,
        std::path::Path::new("/footage/a.mp4")
    );
}

#[test]
fn a_compound_clip_brings_its_timeline_and_media_under_a_free_name() {
    let mut source = Project::default();
    let inner = source.media_pool.insert(file("/footage/inner.mp4", 5));
    let nested = compound(&mut source, "Compound Clip 1", inner);
    let clip = media_clip(&mut source, nested, 0);
    let payload = ClipboardPayload::new(ORIGIN, &source, &[], &[entry(clip)]);

    let mut dest = Project::default();
    let own_inner = dest.media_pool.insert(file("/dest/x.mp4", 9));
    compound(&mut dest, "Compound Clip 1", own_inner);
    let pasted = paste(payload, &mut dest);

    let item = &dest.media_pool[source_of(&pasted.clips[0])];
    assert_eq!(item.path, std::path::Path::new("Compound Clip 1 2"));
    let timeline = &dest.timelines[item.compound.expect("a compound clip")];
    assert_eq!(timeline.name, "Compound Clip 1 2");
    let ClipSource::Media(used) = timeline.tracks[0].clips[0].source else {
        panic!("not a media clip");
    };
    assert_eq!(
        dest.media_pool[used].path,
        std::path::Path::new("/footage/inner.mp4")
    );
}

#[test]
fn an_offline_clip_stays_offline() {
    let mut source = Project::default();
    let gone = source.media_pool.insert(file("/footage/gone.mp4", 1));
    let clip = media_clip(&mut source, gone, 0);
    source.media_pool.remove(gone);
    let payload = ClipboardPayload::new(ORIGIN, &source, &[], &[entry(clip)]);

    let mut dest = Project::default();
    dest.media_pool.insert(file("/dest/a.mp4", 2));
    dest.media_pool.insert(file("/dest/b.mp4", 3));
    let pasted = paste(payload, &mut dest);

    assert!(!dest.media_pool.contains_key(source_of(&pasted.clips[0])));
}

/// The library copies every file of a compound clip and points the payload
/// at the copies.
#[test]
fn the_files_of_a_payload_include_those_inside_compound_clips() {
    let mut project = Project::default();
    let inner = project.media_pool.insert(file("/media/inner.mp4", 1));
    let outer = compound(&mut project, "Compound Clip 1", inner);
    let mut payload = ClipboardPayload::new(ORIGIN, &project, &[outer], &[]);

    assert_eq!(
        payload
            .media_items()
            .map(|m| m.compound.is_some())
            .collect::<Vec<_>>(),
        vec![true]
    );
    for item in payload.files_mut() {
        item.path = "/library/inner.mp4".into();
    }

    let mut target = Project::default();
    paste(payload, &mut target);
    let paths: Vec<_> = target
        .media_pool
        .values()
        .filter(|m| m.compound.is_none())
        .map(|m| m.path.clone())
        .collect();
    assert_eq!(paths, vec![std::path::PathBuf::from("/library/inner.mp4")]);
}

fn replacement_meta() -> MediaMeta {
    MediaMeta {
        duration_frames: 220,
        fps: Rational::new(60_000, 1001),
        width: 128,
        height: 144,
        has_video: true,
        has_audio: true,
        sample_rate: 44_100,
        channels: 1,
        audio_streams: 3,
        file: crate::MediaFileInfo {
            size_bytes: Some(123_456),
            video_codec: Some("prores".into()),
            audio_codec: Some("pcm_s24le".into()),
            title: Some("Replacement".into()),
            artist: Some("Native relink".into()),
        },
    }
}

#[test]
fn relink_files_replaces_complete_native_metadata_and_preserves_payload_ids_and_serialization() {
    let mut source = Project::default();
    let a = source.media_pool.insert(file("/original/a.mov", 11));
    let b = source.media_pool.insert(file("/original/b.wav", 22));
    let mut payload = ClipboardPayload::new(ORIGIN, &source, &[b, a], &[]);
    let ids = payload.media_ids().to_vec();
    let replacements: Vec<(MediaId, PathBuf, u64, MediaMeta)> = vec![
        (ids[0], "/found/b.wav".into(), 33, replacement_meta()),
        (ids[1], "/found/a.mov".into(), 44, replacement_meta()),
    ];
    let mut expected = payload.project.clone();
    for (id, path, hash, meta) in &replacements {
        crate::SetMediaPath::new(*id, path.clone(), *hash, Some(meta.clone())).apply(&mut expected);
    }
    assert!(payload.relink_files(&replacements));
    assert_eq!(
        ron::to_string(payload.fragment()).unwrap(),
        ron::to_string(&expected).unwrap()
    );
    assert_eq!(payload.origin, ORIGIN);
    assert_eq!(payload.media_ids(), ids.as_slice());
    assert!(!payload.has_clips());
    assert_eq!(
        payload.fragment().media_pool[ids[0]].meta.file,
        replacement_meta().file
    );
    assert_eq!(
        payload.fragment().media_pool[ids[0]]
            .meta
            .audio_stream_count(),
        3
    );
    let text = payload.to_text();
    let decoded = ClipboardPayload::from_text(&text).unwrap().unwrap();
    assert_eq!(decoded.to_text(), text);
    assert_eq!(decoded.media_ids(), ids.as_slice());
}

#[test]
fn relink_files_uses_native_fractional_conform_keyframes_and_crop_and_invalidates_only_compound_ancestors()
 {
    use crate::{ClipFilter, FilterKind, Interpolation, LinkGroupId, TransformParam};

    let mut source = Project::default();
    let media = source.media_pool.insert(file("/original/a.mov", 11));
    source.media_pool.get_mut(media).unwrap().meta.fps = Rational::new(30_000, 1001);
    let other = source.media_pool.insert(file("/original/other.mov", 22));
    let inner = compound(&mut source, "Inner", media);
    let inner_timeline = source.media_pool[inner].compound.unwrap();
    let fps = Rational::new(24_000, 1001);
    let mut clip = Clip::from_source_range(
        source.alloc_clip_id(),
        ClipSource::Media(media),
        3,
        93,
        11,
        Rational::conform_rate(fps, source.media_pool[media].meta.fps),
    );
    clip.linked_group = Some(LinkGroupId(44));
    clip.fade_in = 3;
    clip.audio_stream_index = 0;
    clip.effects.gain_db.upsert(11, -6.0, Interpolation::Linear);
    clip.effects
        .transform
        .track_mut(TransformParam::CropLeft)
        .default = 3.0;
    clip.effects
        .transform
        .track_mut(TransformParam::CropTop)
        .upsert(13, 2.0, Interpolation::EaseIn);
    clip.effects
        .transform
        .track_mut(TransformParam::Opacity)
        .default = 42.0;
    let mut exposure = ClipFilter::new(FilterKind::Exposure);
    exposure.enabled = false;
    exposure.amount.upsert(9, 0.75, Interpolation::Hold);
    clip.effects.filters.push(exposure);
    source.timelines[inner_timeline].fps = fps;
    source.timelines[inner_timeline].tracks[0].clips = vec![clip];
    source.sync_compound_meta(inner);
    let untouched = compound(&mut source, "Unchanged", other);
    let outer = compound(&mut source, "Outer", inner);
    let outer_timeline = source.media_pool[outer].compound.unwrap();
    let sibling = media_clip(&mut source, untouched, 30);
    source.timelines[outer_timeline].tracks[0]
        .clips
        .push(sibling);
    source.sync_compound_meta(outer);
    let mut payload = ClipboardPayload::new(ORIGIN, &source, &[outer], &[]);
    let find = |path: &str| {
        payload
            .project
            .media_pool
            .iter()
            .find(|(_, item)| item.path == std::path::Path::new(path))
            .unwrap()
            .0
    };
    let (media, inner, outer, untouched) = (
        find("/original/a.mov"),
        find("Inner"),
        find("Outer"),
        find("Unchanged"),
    );
    let before = payload.project.clone();
    let root_ids = payload.media_ids().to_vec();
    let mut expected = before.clone();
    assert!(expected.reserve_compound_generations(2));
    let new_meta = replacement_meta();
    crate::SetMediaPath::new(media, "/found/a.mov".into(), 99, Some(new_meta.clone()))
        .apply(&mut expected);
    expected.sync_compound_meta(inner);
    expected.sync_compound_meta(outer);

    assert!(payload.relink_files(&[(media, "/found/a.mov".into(), 99, new_meta.clone())]));
    assert_eq!(
        ron::to_string(payload.fragment()).unwrap(),
        ron::to_string(&expected).unwrap()
    );
    assert_eq!(payload.media_ids(), root_ids.as_slice());
    assert_eq!(payload.origin, ORIGIN);
    assert_eq!(
        ron::to_string(&payload.project.media_pool[untouched]).unwrap(),
        ron::to_string(&before.media_pool[untouched]).unwrap()
    );
    for id in [inner, outer] {
        assert_ne!(
            payload.project.media_pool[id].content_hash,
            before.media_pool[id].content_hash
        );
        let timeline = payload.project.media_pool[id].compound.unwrap();
        assert_eq!(
            ron::to_string(&payload.project.media_pool[id].meta).unwrap(),
            ron::to_string(&payload.project.timelines[timeline].compound_meta()).unwrap()
        );
    }
    let timeline = payload.project.media_pool[inner].compound.unwrap();
    let clip = &payload.project.timelines[timeline].tracks[0].clips[0];
    let old_clip = &before.timelines[timeline].tracks[0].clips[0];
    assert_eq!(clip.id, old_clip.id);
    assert!(matches!(clip.source, ClipSource::Media(id) if id == media));
    assert_eq!(clip.linked_group, old_clip.linked_group);
    assert_eq!(clip.timeline_len, old_clip.timeline_len);
    assert_eq!(clip.rate(), Rational::conform_rate(fps, new_meta.fps));
    assert_eq!(clip.effects.gain_db.keyframes()[0].0, 22);
    assert_eq!(
        clip.effects
            .transform
            .track(TransformParam::CropLeft)
            .default,
        6.0
    );
    assert_eq!(
        clip.effects
            .transform
            .track(TransformParam::CropTop)
            .keyframes()[0],
        (26, 6.0, Interpolation::EaseIn)
    );
    assert_eq!(
        clip.effects
            .transform
            .track(TransformParam::Opacity)
            .default,
        42.0
    );
    assert!(!clip.effects.filters[0].enabled);
    assert_eq!(
        clip.effects.filters[0].amount.keyframes()[0],
        (18, 0.75, Interpolation::Hold)
    );
    let decoded = ClipboardPayload::from_text(&payload.to_text())
        .unwrap()
        .unwrap();
    assert_eq!(decoded.to_text(), payload.to_text());
}

#[test]
fn relink_files_invalid_requests_and_copied_clip_entries_are_atomic() {
    let mut source = Project::default();
    let media = source.media_pool.insert(file("/original/a.mov", 11));
    let root = compound(&mut source, "Root", media);
    let payload = ClipboardPayload::new(ORIGIN, &source, &[root], &[]);
    let file_id = payload
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound.is_none())
        .unwrap()
        .0;
    let root_id = payload.media_ids()[0];
    let mut allocation = payload.project.media_pool.clone();
    let missing = allocation.alloc();
    for ids in [
        vec![file_id, missing],
        vec![file_id, file_id],
        vec![file_id, root_id],
    ] {
        let mut candidate = payload.clone();
        let before = candidate.to_text();
        let replacements: Vec<_> = ids
            .into_iter()
            .map(|id| (id, "/found/a.mov".into(), 99, replacement_meta()))
            .collect();
        assert!(!candidate.relink_files(&replacements));
        assert_eq!(candidate.to_text(), before);
    }
    let mut empty = payload.clone();
    assert!(empty.relink_files(&[]));
    assert_eq!(empty.to_text(), payload.to_text());
    let copied = media_clip(&mut source, media, 0);
    let mut with_clips = ClipboardPayload::new(ORIGIN, &source, &[], &[entry(copied)]);
    let id = source_of(&with_clips.clip_entries()[0]);
    let before = with_clips.to_text();
    assert!(!with_clips.relink_files(&[(id, "/found/a.mov".into(), 99, replacement_meta())]));
    assert_eq!(with_clips.to_text(), before);
}

#[test]
fn relink_files_rebases_copied_compound_generations_and_ignores_real_file_hashes() {
    let mut source = Project::default();
    let media = source.media_pool.insert(file("/original/a.mov", u64::MAX));
    let mut track = Track::new(TrackKind::Video);
    track.clips.push(media_clip(&mut source, media, 0));
    let timeline = source.timelines.insert(Timeline {
        name: "Root".into(),
        fps: Rational::new(30, 1),
        resolution: (64, 48),
        tracks: vec![track],
        markers: Vec::new(),
        master: Default::default(),
    });
    let root = source.insert_timeline_item(timeline, None);
    assert_eq!(source.media_pool[root].content_hash, 1);
    let mut payload = ClipboardPayload::new(ORIGIN, &source, &[root], &[]);
    let root = payload.media_ids()[0];
    let file = payload
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound.is_none())
        .unwrap()
        .0;
    assert!(payload.relink_files(&[(file, "/found/a.mov".into(), 99, replacement_meta())]));
    assert_eq!(payload.project.media_pool[root].content_hash, 2);
    assert_eq!(payload.project.media_pool[file].content_hash, 99);
    assert!(payload.relink_files(&[(file, "/found/again.mov".into(), 100, replacement_meta())]));
    assert_eq!(payload.project.media_pool[root].content_hash, 3);
    let decoded = ClipboardPayload::from_text(&payload.to_text())
        .unwrap()
        .unwrap();
    assert_eq!(decoded.to_text(), payload.to_text());
}

#[test]
fn relink_files_preflights_the_full_compound_generation_reservation_before_mutation() {
    let mut source = Project::default();
    let file = source.media_pool.insert(file("/original/a.mov", 11));
    let inner = compound(&mut source, "Inner", file);
    let outer = compound(&mut source, "Outer", inner);
    let payload = ClipboardPayload::new(ORIGIN, &source, &[outer], &[]);
    for maximum in [u64::MAX - 1, u64::MAX] {
        let mut candidate = payload.clone();
        let outer = candidate.media_ids()[0];
        candidate
            .project
            .media_pool
            .get_mut(outer)
            .unwrap()
            .content_hash = maximum;
        let file = candidate
            .project
            .media_pool
            .iter()
            .find(|(_, item)| item.compound.is_none())
            .unwrap()
            .0;
        let before = candidate.to_text();
        assert!(!candidate.relink_files(&[(file, "/found/a.mov".into(), 99, replacement_meta())]));
        assert_eq!(candidate.to_text(), before);
        assert!(candidate.relink_files(&[]));
        assert_eq!(candidate.to_text(), before);
    }
}
