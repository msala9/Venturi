use super::*;
use crate::{
    ClipFilter, FilterKind, History, Interpolation, LinkGroupId, MediaItem, MediaMeta, Timeline,
    Track, TransformParam,
};

fn setup() -> (Project, Request, ClipId) {
    let mut project = Project::default();
    let timeline = project.timelines.insert(Timeline {
        name: "Takes".into(),
        fps: Rational::new(25, 1),
        resolution: (1920, 1080),
        tracks: vec![Track::new(TrackKind::Video), Track::new(TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    });
    let old = project.media_pool.insert(MediaItem {
        path: "old.mp4".into(),
        meta: MediaMeta {
            duration_frames: 200,
            fps: Rational::new(25, 1),
            width: 1920,
            height: 1080,
            has_video: true,
            has_audio: true,
            sample_rate: 48000,
            channels: 2,
            audio_streams: 1,
            file: Default::default(),
        },
        content_hash: 7,
        compound: None,
        folder: None,
    });
    let mut next = project.media_pool[old].clone();
    next.path = "new.mp4".into();
    next.meta.fps = Rational::new(50, 1);
    next.meta.width = 3840;
    next.meta.height = 2160;
    next.meta.duration_frames = 400;
    next.content_hash = 8;
    let media = project.media_pool.insert(next);
    let mut clip = Clip::from_source_range(
        project.alloc_clip_id(),
        ClipSource::Media(old),
        10,
        60,
        100,
        Rational::one(),
    );
    clip.linked_group = Some(LinkGroupId(42));
    clip.effects
        .transform
        .track_mut(TransformParam::Opacity)
        .upsert(10, 1.0, Interpolation::Linear);
    clip.effects
        .transform
        .track_mut(TransformParam::Opacity)
        .upsert(30, 0.6, Interpolation::Linear);
    clip.effects
        .transform
        .track_mut(TransformParam::Opacity)
        .upsert(60, 0.1, Interpolation::Linear);
    clip.effects
        .transform
        .track_mut(TransformParam::CropLeft)
        .default = 20.0;
    clip.fade_in = 8;
    let anchor = clip.id;
    project.timelines[timeline].tracks[0]
        .clips
        .push(clip.clone());
    clip.id = project.alloc_clip_id();
    let linked = clip.id;
    project.timelines[timeline].tracks[1].clips.push(clip);
    (
        project,
        Request {
            timeline,
            clip: anchor,
            media,
            source_in: 20,
            duration: DurationPolicy::Preserve,
            links: LinkPolicy::ReplaceLinked,
            attributes: AttributePolicy::Preserve,
        },
        linked,
    )
}
fn value(project: &Project) -> serde_json::Value {
    serde_json::to_value(project).unwrap()
}

#[test]
fn replacing_linked_takes_keeps_timing_ids_animation_crop_and_unrelated_uses_with_one_undo() {
    let (mut project, mut request, linked) = setup();
    request.source_in = 40;
    let mut unrelated = project.timelines[request.timeline].tracks[0].clips[0].clone();
    unrelated.id = project.alloc_clip_id();
    unrelated.timeline_start = 200;
    unrelated.linked_group = None;
    let untouched = serde_json::to_value(&unrelated).unwrap();
    let unrelated_id = unrelated.id;
    project.timelines[request.timeline].tracks[0]
        .clips
        .push(unrelated);
    let before = value(&project);
    let selected = project.timelines[request.timeline].tracks[0].clips[0].clone();
    let plan = plan(&project, &request).unwrap();
    assert_eq!(plan.changes.len(), 2);
    assert_eq!(value(&project), before);
    let mut history = History::default();
    history.do_command(&mut project, Box::new(plan.into_command()));
    assert_eq!(history.position(), 1);
    assert_eq!(
        history.labels().collect::<Vec<_>>(),
        [CommandLabel::ReplaceTake]
    );
    for (track, id) in [(0, request.clip), (1, linked)] {
        let clip = project.timelines[request.timeline].clip(track, id).unwrap();
        assert!(matches!(clip.source,ClipSource::Media(id) if id==request.media));
        assert_eq!(
            (clip.timeline_start, clip.timeline_len, clip.source_in()),
            (100, 50, 40)
        );
        assert_eq!(clip.speed(), Rational::one());
        for frame in [100, 110, 120, 149] {
            assert_eq!(
                clip.effects
                    .transform
                    .value_at(clip.source_frame_at(frame))
                    .opacity,
                selected
                    .effects
                    .transform
                    .value_at(selected.source_frame_at(frame))
                    .opacity
            );
        }
        assert_eq!(
            clip.effects
                .transform
                .track(TransformParam::CropLeft)
                .default,
            40.0
        );
        assert_eq!(clip.fade_in, 8);
        assert_eq!(clip.linked_group, selected.linked_group);
    }
    assert_eq!(project.media_pool.len(), 2);
    assert_eq!(
        serde_json::to_value(
            project.timelines[request.timeline]
                .clip(0, unrelated_id)
                .unwrap()
        )
        .unwrap(),
        untouched
    );
    let replaced = value(&project);
    history.undo(&mut project);
    assert_eq!(value(&project), before);
    history.redo(&mut project);
    assert_eq!(value(&project), replaced);
}

#[test]
fn a_short_take_requires_explicit_shortening_and_never_ripples_the_following_edit() {
    let (mut project, mut request, _) = setup();
    project.media_pool[request.media].meta.duration_frames = 30;
    let mut next = project.timelines[request.timeline].tracks[0].clips[0].clone();
    next.id = project.alloc_clip_id();
    next.timeline_start = 150;
    next.linked_group = None;
    let next_id = next.id;
    project.timelines[request.timeline].tracks[0]
        .clips
        .push(next);
    project.timelines[request.timeline].tracks[0]
        .crossings
        .push(crate::CrossTransition {
            left_clip: request.clip,
            right_clip: next_id,
            transition: crate::Transition {
                kind: crate::TransitionKind::CrossDissolve,
                duration: 10,
                direction: crate::PushDirection::Left,
                ease: crate::Ease::None,
                curve: 0.5,
            },
        });
    let before = value(&project);
    assert_eq!(plan(&project, &request).unwrap_err(), Error::TooShort);
    assert_eq!(value(&project), before);
    request.duration = DurationPolicy::Shorten;
    let replacement = plan(&project, &request).unwrap();
    assert_eq!(replacement.removed_crossings, 1);
    assert!(replacement.changes.iter().all(|change| change.length == 5));
    let mut history = History::default();
    history.do_command(&mut project, Box::new(replacement.into_command()));
    let track = &project.timelines[request.timeline].tracks[0];
    assert_eq!(track.clip(next_id).unwrap().timeline_start, 150);
    assert!(track.crossings.is_empty());
    assert_eq!(track.clip(request.clip).unwrap().fade_in, 5);
    history.undo(&mut project);
    assert_eq!(value(&project), before);
}

#[test]
fn locked_linked_tracks_refuse_atomically_and_selected_only_is_an_explicit_policy() {
    let (mut project, mut request, linked) = setup();
    project.timelines[request.timeline].tracks[1].locked = true;
    let before = value(&project);
    assert_eq!(plan(&project, &request).unwrap_err(), Error::Locked);
    assert_eq!(value(&project), before);
    request.links = LinkPolicy::SelectedOnly;
    let command = plan(&project, &request).unwrap().into_command();
    let old_audio =
        serde_json::to_value(project.timelines[request.timeline].clip(1, linked).unwrap()).unwrap();
    let mut history = History::default();
    history.do_command(&mut project, Box::new(command));
    assert_eq!(
        serde_json::to_value(project.timelines[request.timeline].clip(1, linked).unwrap()).unwrap(),
        old_audio
    );
    history.undo(&mut project);
    assert_eq!(value(&project), before);
}

#[test]
fn stream_range_freeze_compound_and_mixed_link_errors_leave_the_project_untouched() {
    let (mut project, mut request, _) = setup();
    project.media_pool[request.media].meta.has_audio = false;
    let before = value(&project);
    assert_eq!(plan(&project, &request).unwrap_err(), Error::Stream);
    assert_eq!(value(&project), before);
    project.media_pool[request.media].meta.has_audio = true;
    request.source_in = -1;
    assert_eq!(plan(&project, &request).unwrap_err(), Error::SourceStart);
    request.source_in = 20;
    project.timelines[request.timeline].tracks[0].clips[0].freeze = Some(10);
    assert_eq!(plan(&project, &request).unwrap_err(), Error::Frozen);
    project.timelines[request.timeline].tracks[0].clips[0].freeze = None;
    project.timelines[request.timeline].tracks[1].clips[0].source =
        ClipSource::Media(request.media);
    assert_eq!(plan(&project, &request).unwrap_err(), Error::LinkedSource);
    request.links = LinkPolicy::SelectedOnly;
    assert!(plan(&project, &request).is_ok());
    project.media_pool[request.media].compound = Some(request.timeline);
    assert_eq!(plan(&project, &request).unwrap_err(), Error::Compound);
}

#[test]
fn replacing_trimmed_linked_audio_preserves_sync_and_refuses_an_unavailable_leading_range() {
    let (mut project, mut request, linked) = setup();
    let audio = project.timelines[request.timeline]
        .clip_mut(1, linked)
        .unwrap();
    audio.source_offset = 0;
    audio.timeline_start = 90;
    audio.timeline_len = 60;
    request.source_in = 0;
    let before = value(&project);
    assert_eq!(plan(&project, &request).unwrap_err(), Error::SourceStart);
    assert_eq!(value(&project), before);
    request.source_in = 40;
    let command = plan(&project, &request).unwrap().into_command();
    let mut history = History::default();
    history.do_command(&mut project, Box::new(command));
    let video = project.timelines[request.timeline]
        .clip(0, request.clip)
        .unwrap();
    let audio = project.timelines[request.timeline].clip(1, linked).unwrap();
    for frame in [100, 120, 149] {
        assert_eq!(video.source_frame_at(frame), audio.source_frame_at(frame));
    }
    history.undo(&mut project);
    assert_eq!(value(&project), before);
    project.media_pool[request.media].meta.fps = Rational::new(0, 1);
    assert_eq!(plan(&project, &request).unwrap_err(), Error::Timing);
}

#[test]
fn replacing_a_25_fps_take_on_a_24_fps_edit_with_50_fps_keeps_each_key_on_its_edit_frame() {
    let (mut project, mut request, _) = setup();
    request.source_in = 0;
    project.timelines[request.timeline].fps = Rational::new(24, 1);
    for track in &mut project.timelines[request.timeline].tracks {
        for clip in &mut track.clips {
            clip.timeline_start = 12;
            clip.timeline_len = 72;
            clip.conform(Rational::new(24, 25));
            clip.effects
                .transform
                .track_mut(TransformParam::Opacity)
                .upsert(84, 0.2, Interpolation::EaseInOut);
        }
    }
    let original = project.timelines[request.timeline].tracks[0].clips[0].clone();
    let before = value(&project);
    let command = plan(&project, &request).unwrap().into_command();
    let mut history = History::default();
    history.do_command(&mut project, Box::new(command));
    let replacement = &project.timelines[request.timeline].tracks[0].clips[0];
    for ((old_frame, old_value, old_interpolation), (new_frame, new_value, new_interpolation)) in
        original
            .effects
            .transform
            .track(TransformParam::Opacity)
            .keyframes()
            .iter()
            .zip(
                replacement
                    .effects
                    .transform
                    .track(TransformParam::Opacity)
                    .keyframes(),
            )
    {
        let edit_frame = original.timeline_frame_at(*old_frame);
        assert_eq!(replacement.timeline_frame_at(*new_frame), edit_frame);
        assert_eq!(old_value, new_value);
        assert_eq!(old_interpolation, new_interpolation);
        assert_eq!(
            replacement
                .effects
                .transform
                .value_at(replacement.source_frame_at(edit_frame))
                .opacity,
            *old_value
        );
    }
    history.undo(&mut project);
    assert_eq!(value(&project), before);
}

#[test]
fn lower_fps_key_collisions_are_reported_for_the_confirmation_preview() {
    let (mut project, mut request, _) = setup();
    request.source_in = 0;
    project.media_pool[request.media].meta.fps = Rational::new(12, 1);
    let track = project.timelines[request.timeline].tracks[0].clips[0]
        .effects
        .transform
        .track_mut(TransformParam::Opacity);
    track.upsert(31, 0.5, Interpolation::Linear);
    track.upsert(32, 0.4, Interpolation::Linear);
    let before = value(&project);
    let planned = plan(&project, &request).unwrap();
    assert_eq!(planned.merged_keys, 1);
    assert_eq!(value(&project), before);
    request.attributes = AttributePolicy::Reset;
    assert_eq!(plan(&project, &request).unwrap().merged_keys, 0);
}

#[test]
fn source_start_remapping_and_attribute_reset_keep_existing_speed_and_clip_flags_explicit() {
    let (mut project, mut request, _) = setup();
    request.links = LinkPolicy::SelectedOnly;
    request.attributes = AttributePolicy::Reset;
    let clip = &mut project.timelines[request.timeline].tracks[0].clips[0];
    clip.set_speed(Rational::new(2, 1), Rational::one());
    clip.disabled = true;
    clip.effects
        .filters
        .push(ClipFilter::new(FilterKind::GaussianBlur));
    let old_len = clip.timeline_len;
    let before = value(&project);
    let replacement = plan(&project, &request).unwrap();
    let mut history = History::default();
    history.do_command(&mut project, Box::new(replacement.into_command()));
    let clip = &project.timelines[request.timeline].tracks[0].clips[0];
    assert_eq!(clip.speed(), Rational::new(2, 1));
    assert_eq!(clip.timeline_len, old_len);
    assert!(clip.disabled);
    assert_eq!(clip.fade_in, 0);
    assert!(clip.effects.filters.is_empty());
    assert!(
        clip.effects
            .transform
            .track(TransformParam::Opacity)
            .keyframes()
            .is_empty()
    );
    assert_eq!(
        clip.effects
            .transform
            .track(TransformParam::CropLeft)
            .default,
        0.0
    );
    history.undo(&mut project);
    assert_eq!(value(&project), before);
}
