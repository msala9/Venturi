use super::*;
use vv_core::attributes::{Attribute, KeyframeMode};

fn empty_timeline(session: &mut Session, name: &str, fps: core::Rational) -> TimelineId {
    session.create_timeline(core::Timeline {
        name: name.into(),
        fps,
        resolution: (640, 360),
        tracks: vec![core::Track::new(core::TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    })
}
fn entity_snapshot(project: &core::Project) -> serde_json::Value {
    // Native compound generations are monotonic cache identities, including Undo.
    let media = project
        .media_pool
        .iter()
        .map(|(id, item)| {
            let mut item = item.clone();
            if item.compound.is_some() {
                item.content_hash = 0;
            }
            (id, item)
        })
        .collect::<Vec<_>>();
    serde_json::json!({"timelines":project.timelines.iter().collect::<Vec<_>>(),"media":media,"folders":project.folders.iter().collect::<Vec<_>>()})
}

fn overwrite_solid(
    session: &mut Session,
    id: TimelineId,
    track: usize,
    start: i64,
    length: i64,
    group: Option<core::LinkGroupId>,
) -> core::ClipId {
    let clip_id = session.project.alloc_clip_id();
    let mut clip = core::Clip::from_source_range(
        clip_id,
        core::ClipSource::SolidColor,
        0,
        length,
        start,
        core::Rational::one(),
    );
    clip.linked_group = group;
    clip.effects
        .transform
        .track_mut(core::TransformParam::PositionX)
        .upsert(10, 3.0, core::Interpolation::Linear);
    session.project.timelines[id].tracks[track].insert_sorted(clip);
    clip_id
}

#[test]
fn explicit_clipboard_overwrite_matches_native_split_trim_delete_across_fps_and_one_undo() {
    for fps in [core::Rational::new(24, 1), core::Rational::new(30000, 1001)] {
        for (start, length) in [(0, 100), (0, 30), (25, 10), (30, 50)] {
            let (mut session, source, selected) = fixture();
            session.project.timelines[source].tracks[0].clips[0].linked_group = None;
            session.project.timelines[source].tracks[0].clips[0].freeze = Some(5);
            session.project.timelines[source].tracks[0].clips[0].pitch_correction = true;
            let clipboard = copy(&session, source, &selected[..1]).unwrap();
            let target = empty_timeline(&mut session, "Native overwrite", fps);
            overwrite_solid(&mut session, target, 0, start, length, None);
            session.project.timelines[target]
                .tracks
                .push(core::Track::new(core::TrackKind::Video));
            overwrite_solid(&mut session, target, 1, 0, 200, None);
            session.project.timelines[target].tracks[1].locked = true;
            let before = serde_json::to_value(&session.project).unwrap();
            let timeline_before = serde_json::to_value(&session.project.timelines[target]).unwrap();
            let steps = session.history.position();
            assert_eq!(
                prepare_paste(
                    &session,
                    clipboard.payload.clone(),
                    Some(&clipboard),
                    Some(target),
                    20,
                    false,
                    false
                )
                .err()
                .unwrap()
                .1,
                "OVERLAP"
            );
            assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
            let mut native = session.project.clone();
            let entry = &clipboard.entries[0];
            let mut clip = entry.clip.clone();
            clip.id = native.alloc_clip_id();
            clip.timeline_start = entry.relative_start;
            clip.linked_group = None;
            if entry.timeline_fps != fps {
                let core::ClipSource::Media(media) = clip.source else {
                    unreachable!();
                };
                clip.retime(
                    entry.timeline_fps,
                    fps,
                    core::Rational::conform_rate(fps, native.media_pool[media].meta.fps),
                );
            }
            clip.timeline_start += 20;
            let commands =
                core::insert_overwriting(&mut native, target, vec![(0, clip, None::<u64>)]);
            core::CompositeCommand::new(core::CommandLabel::PasteClips, commands)
                .apply(&mut native);
            let prepared = prepare_paste(
                &session,
                clipboard.payload.clone(),
                Some(&clipboard),
                Some(target),
                20,
                false,
                true,
            )
            .unwrap();
            assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
            let report = prepared.apply(&mut session);
            assert_eq!(report.clips.len(), 1);
            assert!(report.changed);
            assert_eq!(session.history.position(), steps + 1);
            let after = serde_json::to_value(&session.project.timelines[target]).unwrap();
            assert_eq!(
                after,
                serde_json::to_value(&native.timelines[target]).unwrap()
            );
            session.history.undo(&mut session.project);
            assert_eq!(
                serde_json::to_value(&session.project.timelines[target]).unwrap(),
                timeline_before
            );
            session.history.redo(&mut session.project);
            assert_eq!(
                serde_json::to_value(&session.project.timelines[target]).unwrap(),
                after
            );
        }
    }
}

#[test]
fn explicit_clipboard_overwrite_preserves_differing_linked_ends_and_rejects_partial_or_locked_cuts()
{
    let (mut session, source, selected) = fixture();
    let clipboard = copy(&session, source, &selected[..1]).unwrap();
    let target = empty_timeline(&mut session, "Linked overwrite", core::Rational::new(24, 1));
    session.project.timelines[target]
        .tracks
        .push(core::Track::new(core::TrackKind::Audio));
    let group = Some(core::LinkGroupId(77));
    let old_video = overwrite_solid(&mut session, target, 0, 0, 100, group);
    let old_audio = overwrite_solid(&mut session, target, 1, 10, 110, group);
    let before = serde_json::to_value(&session.project.timelines[target]).unwrap();
    let steps = session.history.position();
    let report = prepare_paste(
        &session,
        clipboard.payload.clone(),
        Some(&clipboard),
        Some(target),
        20,
        false,
        true,
    )
    .unwrap()
    .apply(&mut session);
    assert_eq!(session.history.position(), steps + 1);
    assert_eq!(report.clips.len(), 2);
    let timeline = &session.project.timelines[target];
    assert_eq!(
        (
            timeline.clip(0, old_video).unwrap().timeline_start,
            timeline.clip(0, old_video).unwrap().timeline_end()
        ),
        (0, 20)
    );
    assert_eq!(
        (
            timeline.clip(1, old_audio).unwrap().timeline_start,
            timeline.clip(1, old_audio).unwrap().timeline_end()
        ),
        (10, 20)
    );
    let right_video = timeline.tracks[0]
        .clips
        .iter()
        .find(|clip| clip.timeline_start == 44)
        .unwrap();
    let right_audio = timeline.tracks[1]
        .clips
        .iter()
        .find(|clip| clip.timeline_start == 44)
        .unwrap();
    assert_eq!(right_video.timeline_end(), 100);
    assert_eq!(right_audio.timeline_end(), 120);
    assert!(right_video.linked_group.is_some());
    assert_eq!(right_video.linked_group, right_audio.linked_group);
    assert_ne!(right_video.linked_group, group);
    assert_eq!(
        timeline.tracks[0].clips[1].linked_group,
        timeline.tracks[1].clips[1].linked_group
    );
    assert_ne!(
        timeline.tracks[0].clips[1].linked_group,
        right_video.linked_group
    );
    let after = serde_json::to_value(timeline).unwrap();
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[target]).unwrap(),
        before
    );
    session.history.redo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[target]).unwrap(),
        after
    );
    session.history.undo(&mut session.project);
    session.project.timelines[target].tracks[1].locked = true;
    let protected = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        prepare_paste(
            &session,
            clipboard.payload.clone(),
            Some(&clipboard),
            Some(target),
            20,
            false,
            true
        )
        .err()
        .unwrap()
        .1,
        "TRACK_LOCKED"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), protected);
    session.project.timelines[target].tracks[1].locked = false;
    session.project.timelines[source].tracks[0].clips[0].linked_group = None;
    let video_only = copy(&session, source, &selected[..1]).unwrap();
    let protected = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        prepare_paste(
            &session,
            video_only.payload.clone(),
            Some(&video_only),
            Some(target),
            20,
            false,
            true
        )
        .err()
        .unwrap()
        .1,
        "LINKED_OVERWRITE"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), protected);
}

#[test]
fn explicit_clipboard_overwrite_adds_missing_tracks_and_restores_native_crossings_with_undo() {
    let (mut session, source, selected) = fixture();
    let pair = copy(&session, source, &selected[..1]).unwrap();
    let missing = empty_timeline(&mut session, "Missing audio", core::Rational::new(30, 1));
    overwrite_solid(&mut session, missing, 0, 0, 120, None);
    let before = serde_json::to_value(&session.project.timelines[missing]).unwrap();
    let steps = session.history.position();
    let report = prepare_paste(
        &session,
        pair.payload.clone(),
        Some(&pair),
        Some(missing),
        20,
        false,
        true,
    )
    .unwrap()
    .apply(&mut session);
    assert_eq!(session.project.timelines[missing].tracks.len(), 2);
    assert_eq!(report.clips.len(), 2);
    assert_eq!(session.history.position(), steps + 1);
    let inserted_video = session.project.timelines[missing].tracks[0]
        .clips
        .iter()
        .find(|clip| report.clips.contains(&clip.id))
        .unwrap();
    assert_eq!(
        (inserted_video.timeline_start, inserted_video.timeline_len),
        (20, 30)
    );
    assert_eq!(
        inserted_video.linked_group,
        session.project.timelines[missing].tracks[1].clips[0].linked_group
    );
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[missing]).unwrap(),
        before
    );
    let clipboard = copy(&session, source, &selected).unwrap();
    let target = empty_timeline(
        &mut session,
        "Crossing overwrite",
        core::Rational::new(24, 1),
    );
    session.project.timelines[target]
        .tracks
        .push(core::Track::new(core::TrackKind::Audio));
    let old_left = overwrite_solid(&mut session, target, 0, 0, 60, None);
    let old_right = overwrite_solid(&mut session, target, 0, 60, 60, None);
    overwrite_solid(&mut session, target, 1, 0, 120, None);
    let mut transition = clipboard.crossings[0].transition.clone();
    transition.kind = core::TransitionKind::Push;
    transition.duration = 8;
    session.project.timelines[target].tracks[0]
        .crossings
        .push(core::CrossTransition {
            left_clip: old_left,
            right_clip: old_right,
            transition,
        });
    let before = serde_json::to_value(&session.project.timelines[target]).unwrap();
    let steps = session.history.position();
    let report = prepare_paste(
        &session,
        clipboard.payload.clone(),
        Some(&clipboard),
        Some(target),
        20,
        false,
        true,
    )
    .unwrap()
    .apply(&mut session);
    assert_eq!(session.history.position(), steps + 1);
    assert_eq!(report.clips.len(), 4);
    let timeline = &session.project.timelines[target];
    for track in &timeline.tracks {
        assert_eq!(
            track
                .clips
                .iter()
                .map(|clip| (clip.timeline_start, clip.timeline_end()))
                .collect::<Vec<_>>(),
            vec![(0, 20), (20, 44), (44, 68), (68, 120)]
        );
    }
    assert_eq!(timeline.tracks[0].crossings.len(), 1);
    let crossing = &timeline.tracks[0].crossings[0];
    assert!(report.clips.contains(&crossing.left_clip));
    assert!(report.clips.contains(&crossing.right_clip));
    assert_eq!(
        serde_json::to_value(&crossing.transition).unwrap(),
        serde_json::to_value(&clipboard.crossings[0].transition).unwrap()
    );
    let after = serde_json::to_value(timeline).unwrap();
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[target]).unwrap(),
        before
    );
    session.history.redo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[target]).unwrap(),
        after
    );
    let trim = empty_timeline(&mut session, "Trim crossing", core::Rational::new(24, 1));
    let left = overwrite_solid(&mut session, trim, 0, 0, 24, None);
    let right = overwrite_solid(&mut session, trim, 0, 24, 56, None);
    session.project.timelines[trim].tracks[0]
        .crossings
        .push(core::CrossTransition {
            left_clip: left,
            right_clip: right,
            transition: clipboard.crossings[0].transition.clone(),
        });
    let before = serde_json::to_value(&session.project.timelines[trim]).unwrap();
    prepare_paste(
        &session,
        pair.payload.clone(),
        Some(&pair),
        Some(trim),
        20,
        false,
        true,
    )
    .unwrap()
    .apply(&mut session);
    assert!(
        session.project.timelines[trim].tracks[0]
            .crossings
            .is_empty()
    );
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[trim]).unwrap(),
        before
    );
    for track in &mut session.project.timelines[source].tracks {
        track.crossings.clear();
        track.clips[1].timeline_start += 12;
    }
    let spaced = copy(&session, source, &selected).unwrap();
    let gap = empty_timeline(
        &mut session,
        "Disjoint overwrite",
        core::Rational::new(24, 1),
    );
    session.project.timelines[gap]
        .tracks
        .push(core::Track::new(core::TrackKind::Audio));
    overwrite_solid(&mut session, gap, 0, 0, 120, None);
    overwrite_solid(&mut session, gap, 1, 0, 120, None);
    let before = serde_json::to_value(&session.project.timelines[gap]).unwrap();
    prepare_paste(
        &session,
        spaced.payload.clone(),
        Some(&spaced),
        Some(gap),
        20,
        false,
        true,
    )
    .unwrap()
    .apply(&mut session);
    for track in &session.project.timelines[gap].tracks {
        assert_eq!(
            track
                .clips
                .iter()
                .map(|clip| (clip.timeline_start, clip.timeline_end()))
                .collect::<Vec<_>>(),
            vec![(0, 20), (20, 44), (44, 56), (56, 80), (80, 120)]
        );
    }
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[gap]).unwrap(),
        before
    );
}

#[test]
fn foreign_nested_clipboard_uses_native_reuse_remaps_u64_ids_and_one_complete_undo() {
    let (mut source, child, _) = fixture();
    for track in &mut source.project.timelines[child].tracks {
        track.crossings.clear();
        track.clips.truncate(1);
    }
    source.project.timelines[child].tracks[0].clips[0].id = core::ClipId(9_007_199_254_740_993);
    let child_media = source
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(child))
        .unwrap()
        .0;
    let source_file = source
        .project
        .media_pool
        .values()
        .find(|item| item.compound.is_none())
        .unwrap()
        .clone();
    let root = empty_timeline(&mut source, "Root", core::Rational::new(24, 1));
    let wrapper = core::Clip::from_source_range(
        source.project.alloc_clip_id(),
        core::ClipSource::Media(child_media),
        0,
        24,
        0,
        core::Rational::one(),
    );
    let wrapper_id = wrapper.id;
    source.project.timelines[root].tracks[0].clips.push(wrapper);
    source.project.sync_compound_meta(child_media);
    let clipboard = copy_with_origin(
        &source,
        root,
        &[wrapper_id.0.to_string()],
        ClipboardOrigin {
            instance: 7,
            epoch: source.epoch(),
        },
    )
    .unwrap();
    let payload = ClipboardPayload::from_text(clipboard.text())
        .unwrap()
        .unwrap();
    let unchanged = serde_json::to_value(&source.project).unwrap();
    assert!(
        prepare_paste(
            &source,
            payload.clone(),
            Some(&clipboard),
            Some(child),
            100,
            false,
            false
        )
        .is_err()
    );
    assert_eq!(serde_json::to_value(&source.project).unwrap(), unchanged);
    let media_count = source.project.media_pool.len();
    let timeline_count = source.project.timelines.len();
    prepare_paste(
        &source,
        payload.clone(),
        Some(&clipboard),
        Some(root),
        48,
        false,
        false,
    )
    .unwrap()
    .apply(&mut source);
    assert_eq!(source.project.media_pool.len(), media_count);
    assert_eq!(source.project.timelines.len(), timeline_count);
    assert!(
        matches!(source.project.timelines[root].tracks[0].clips[1].source,core::ClipSource::Media(id) if id==child_media)
    );
    let mut target = Session::default();
    let reused = target.project.media_pool.insert(source_file);
    let timeline = empty_timeline(&mut target, "Destination", core::Rational::new(30, 1));
    let before = entity_snapshot(&target.project);
    let steps = target.history.position();
    let prepared = prepare_paste(&target, payload, None, Some(timeline), 30, false, false).unwrap();
    assert_eq!(entity_snapshot(&target.project), before);
    let report = prepared.apply(&mut target);
    assert!(report.changed);
    assert_eq!(report.clips.len(), 1);
    assert!(report.media.is_empty());
    assert_eq!(target.history.position(), steps + 1);
    let pasted = &target.project.timelines[timeline].tracks[0].clips[0];
    assert_eq!((pasted.timeline_start, pasted.timeline_len), (30, 30));
    let core::ClipSource::Media(media) = pasted.source else {
        panic!("Expected compound");
    };
    let nested = target.project.media_pool[media].compound.unwrap();
    assert_ne!(nested, timeline);
    let native_child = &target.project.timelines[nested];
    assert_ne!(native_child.tracks[0].clips[0].id.0, 9_007_199_254_740_993);
    assert!(
        matches!(native_child.tracks[0].clips[0].source,core::ClipSource::Media(id) if id==reused)
    );
    assert_eq!(
        native_child.tracks[0].clips[0]
            .effects
            .transform
            .track(core::TransformParam::PositionX)
            .keyframes()[0]
            .1,
        20.0
    );
    let after = entity_snapshot(&target.project);
    commands::history(&mut target, &commands::Operation::Undo).unwrap();
    assert_eq!(entity_snapshot(&target.project), before);
    commands::history(&mut target, &commands::Operation::Redo).unwrap();
    assert_eq!(entity_snapshot(&target.project), after);
}

#[test]
fn native_pool_clipboard_selects_current_ids_and_foreign_reuse_is_a_true_noop() {
    let (mut session, id, selected) = fixture();
    let file = session
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound.is_none())
        .unwrap()
        .0;
    let clipboard = copy_media(
        &session,
        &[file.raw().to_string()],
        ClipboardOrigin {
            instance: 8,
            epoch: session.epoch(),
        },
    )
    .unwrap();
    assert_eq!(clipboard.count(&session), 0);
    assert_eq!(clipboard.media_count(), 1);
    assert!(clipboard.revision(&session).is_some());
    let payload = ClipboardPayload::from_text(clipboard.text())
        .unwrap()
        .unwrap();
    assert!(clipboard.matches_payload(&session, &payload));
    let before = serde_json::to_value(&session.project).unwrap();
    let steps = session.history.position();
    let report = prepare_paste(
        &session,
        payload.clone(),
        Some(&clipboard),
        None,
        0,
        true,
        false,
    )
    .unwrap()
    .apply(&mut session);
    assert_eq!(report.media, vec![file]);
    assert!(!report.changed);
    let implicit = prepare_paste(
        &session,
        payload.clone(),
        Some(&clipboard),
        Some(id),
        0,
        false,
        true,
    )
    .unwrap()
    .apply(&mut session);
    assert_eq!(implicit.media, vec![file]);
    assert!(!implicit.changed);
    let report = prepare_paste(&session, payload.clone(), None, None, 0, true, false)
        .unwrap()
        .apply(&mut session);
    assert_eq!(report.media, vec![file]);
    assert!(!report.changed);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), steps);
    let mut altered = payload;
    altered.files_mut().next().unwrap().content_hash = 999;
    assert!(!clipboard.matches_payload(&session, &altered));
    let clips = copy(&session, id, &selected).unwrap();
    let report = prepare_paste(
        &session,
        ClipboardPayload::from_text(clips.text()).unwrap().unwrap(),
        None,
        None,
        0,
        true,
        false,
    )
    .unwrap()
    .apply(&mut session);
    assert!(!report.changed);
    assert!(report.media.is_empty());
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    let mut dangling = clips.entries[0].clone();
    dangling.clip.source = core::ClipSource::Media(core::MediaId::from_raw(999));
    let mixed = ClipboardPayload::new(
        ClipboardOrigin {
            instance: 123,
            epoch: session.epoch(),
        },
        &session.project,
        &[file],
        &[dangling],
    );
    let report = prepare_paste(&session, mixed, None, None, 0, true, false)
        .unwrap()
        .apply(&mut session);
    assert!(!report.changed);
    assert_eq!(report.media, vec![file]);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    session.install_project(core::Project::default(), None);
    assert!(!clipboard.is_current(&session));
    assert!(clipboard.revision(&session).is_some());
    assert!(!clipboard.matches_payload(&session, &altered));
    assert!(clipboard.same_project_media_ids(&session).is_empty());
    let report = prepare_paste(
        &session,
        ClipboardPayload::from_text(clipboard.text())
            .unwrap()
            .unwrap(),
        Some(&clipboard),
        None,
        0,
        true,
        false,
    )
    .unwrap()
    .apply(&mut session);
    assert!(report.changed);
    assert_eq!(report.media.len(), 1);
    assert_eq!(
        session.project.media_pool[report.media[0]].path,
        std::path::Path::new("clipboard.mp4")
    );
}

#[test]
fn cut_requires_exact_published_snapshot_and_unlocked_linked_selection() {
    let (mut session, id, selected) = fixture();
    let clipboard = copy(&session, id, &selected[..1]).unwrap();
    let revision = clipboard.revision(&session).unwrap().to_owned();
    let text = clipboard.text().to_owned();
    let steps = session.history.position();
    session.project.timelines[id].tracks[1].locked = true;
    let before = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        cut(&mut session, id, &selected[..1], &revision, &clipboard)
            .unwrap_err()
            .1,
        "TRACK_LOCKED"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(clipboard.text(), text);
    session.project.timelines[id].tracks[1].locked = false;
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    assert_eq!(
        cut(&mut session, id, &selected[1..], &revision, &clipboard)
            .unwrap_err()
            .1,
        "CLIPBOARD_STALE"
    );
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    cut(&mut session, id, &selected[..1], &revision, &clipboard).unwrap();
    assert_eq!(session.history.position(), steps + 1);
    for track in &session.project.timelines[id].tracks {
        assert_eq!(track.clips.len(), 1);
        assert_eq!(track.clips[0].timeline_start, 34);
    }
    assert_eq!(clipboard.count(&session), 2);
    assert_eq!(clipboard.text(), text);
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    session.project.timelines[id].tracks[0].clips[0].fade_in = 2;
    let modified = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        cut(&mut session, id, &selected[..1], &revision, &clipboard)
            .unwrap_err()
            .1,
        "CLIPBOARD_STALE"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), modified);
}

#[test]
fn foreign_offline_clipboard_stays_offline_and_rejections_do_not_allocate() {
    let (mut source, id, selected) = fixture();
    for track in &mut source.project.timelines[id].tracks {
        track.crossings.clear();
        track.clips.truncate(1);
    }
    let media = source
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound.is_none())
        .unwrap()
        .0;
    source.project.media_pool.remove(media);
    let clipboard = copy(&source, id, &selected[..1]).unwrap();
    let mut target = Session::default();
    let timeline = empty_timeline(&mut target, "Offline", core::Rational::new(24, 1));
    let steps = target.history.position();
    target.project.timelines[timeline].tracks[0].locked = true;
    let before = serde_json::to_value(&target.project).unwrap();
    assert_eq!(
        prepare_paste(
            &target,
            clipboard.payload.clone(),
            None,
            Some(timeline),
            0,
            false,
            false
        )
        .err()
        .unwrap()
        .1,
        "TRACK_LOCKED"
    );
    assert_eq!(serde_json::to_value(&target.project).unwrap(), before);
    assert_eq!(target.history.position(), steps);
    target.project.timelines[timeline].tracks[0].locked = false;
    let report = prepare_paste(
        &target,
        clipboard.payload.clone(),
        None,
        Some(timeline),
        0,
        false,
        false,
    )
    .unwrap()
    .apply(&mut target);
    assert_eq!(report.clips.len(), 2);
    for track in &target.project.timelines[timeline].tracks {
        assert!(
            matches!(track.clips[0].source,core::ClipSource::Media(id) if !target.project.media_pool.contains_key(id))
        );
    }
    let before = serde_json::to_value(&target.project).unwrap();
    assert_eq!(
        prepare_paste(
            &target,
            clipboard.payload.clone(),
            None,
            Some(timeline),
            0,
            false,
            false
        )
        .err()
        .unwrap()
        .1,
        "OVERLAP"
    );
    assert_eq!(serde_json::to_value(&target.project).unwrap(), before);
    assert_eq!(
        paste(&mut source, id, &clipboard, 100).unwrap_err().1,
        "INVALID_OPERATION"
    );
}

#[test]
fn property_paste_across_fps_and_project_uses_native_source_frames_without_id_collision_skip() {
    for mode in [KeyframeMode::MaintainTiming, KeyframeMode::StretchToFit] {
        for foreign in [false, true] {
            let (mut session, source, selected) = fixture();
            session.project.timelines[source].tracks[0].clips[0].fade_in = 3;
            session.project.timelines[source].tracks[0].clips[0].fade_out = 7;
            let clipboard = copy(&session, source, &selected[..1]).unwrap();
            let source_clip = clipboard
                .entries
                .iter()
                .find(|entry| entry.track_kind == core::TrackKind::Video)
                .unwrap()
                .clip
                .clone();
            let source_item = session
                .project
                .media_pool
                .values()
                .find(|item| item.compound.is_none())
                .unwrap()
                .clone();
            if foreign {
                session.install_project(core::Project::default(), None);
            }
            let target = empty_timeline(
                &mut session,
                "Different FPS",
                core::Rational::new(30000, 1001),
            );
            let media = session.project.media_pool.insert(source_item);
            let target_id = if foreign {
                source_clip.id
            } else {
                session.project.alloc_clip_id()
            };
            let mut target_clip = core::Clip::from_source_range(
                target_id,
                core::ClipSource::Media(media),
                20,
                32,
                100,
                core::Rational::new(1250, 1001),
            );
            target_clip.freeze = Some(22);
            session.project.timelines[target].tracks[0]
                .clips
                .push(target_clip.clone());
            let attributes = [Attribute::Position, Attribute::Masks, Attribute::Fades];
            let mut expected = target_clip.clone();
            core::attributes::merge(
                &source_clip,
                &target_clip,
                &attributes.into_iter().collect(),
                &core::attributes::Conversion::paste(&source_clip, &target_clip, mode),
            )
            .apply_to(&mut expected);
            let before = serde_json::to_value(&session.project.timelines[target]).unwrap();
            let steps = session.history.position();
            let revision = clipboard.revision(&session).unwrap().to_owned();
            paste_attributes(
                &mut session,
                target,
                &clipboard,
                &revision,
                &[target_id.0.to_string()],
                &attributes,
                mode,
            )
            .unwrap();
            assert_eq!(session.history.position(), steps + 1);
            let actual = &session.project.timelines[target].tracks[0].clips[0];
            assert_eq!(
                serde_json::to_value(actual).unwrap(),
                serde_json::to_value(expected).unwrap()
            );
            assert_eq!(
                (
                    actual.timeline_start,
                    actual.timeline_len,
                    actual.source_offset,
                    actual.freeze
                ),
                (
                    target_clip.timeline_start,
                    target_clip.timeline_len,
                    target_clip.source_offset,
                    target_clip.freeze
                )
            );
            let after = serde_json::to_value(&session.project.timelines[target]).unwrap();
            session.history.undo(&mut session.project);
            assert_eq!(
                serde_json::to_value(&session.project.timelines[target]).unwrap(),
                before
            );
            session.history.redo(&mut session.project);
            assert_eq!(
                serde_json::to_value(&session.project.timelines[target]).unwrap(),
                after
            );
        }
    }
}

#[test]
fn selected_properties_use_native_mapping_per_kind_and_one_complete_undo() {
    let (mut session, id, selected) = fixture();
    let timeline = &mut session.project.timelines[id];
    timeline.tracks[0].clips[0]
        .effects
        .transform
        .track_mut(core::TransformParam::Opacity)
        .upsert(5, 42.0, core::Interpolation::EaseInOut);
    timeline.tracks[1].clips[0].effects.gain_db.default = 6.0;
    timeline.tracks[0].clips[1]
        .effects
        .transform
        .track_mut(core::TransformParam::PositionX)
        .default = 3.0;
    timeline.tracks[1].clips[1].effects.gain_db.default = -3.0;
    let clipboard = copy(&session, id, &selected[..1]).unwrap();
    let revision = clipboard.revision(&session).unwrap().to_owned();
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let steps = session.history.position();
    paste_attributes(
        &mut session,
        id,
        &clipboard,
        &revision,
        &selected[1..],
        &[Attribute::Opacity, Attribute::Volume],
        KeyframeMode::MaintainTiming,
    )
    .unwrap();
    assert_eq!(session.history.position(), steps + 1);
    let timeline = &session.project.timelines[id];
    let video = &timeline.tracks[0].clips[1];
    assert_eq!(
        video
            .effects
            .transform
            .track(core::TransformParam::Opacity)
            .keyframes()[0],
        (29, 42.0, core::Interpolation::EaseInOut)
    );
    assert_eq!(
        video
            .effects
            .transform
            .track(core::TransformParam::PositionX)
            .default,
        3.0
    );
    assert_eq!(timeline.tracks[1].clips[1].effects.gain_db.default, 6.0);
    assert_eq!((video.timeline_start, video.timeline_len), (34, 24));
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
}

#[test]
fn property_paste_refuses_stale_clipboards_and_whole_locked_groups_without_partial_changes() {
    let (mut session, id, selected) = fixture();
    let steps = session.history.position();
    let clipboard = copy(&session, id, &selected[..1]).unwrap();
    let revision = clipboard.revision(&session).unwrap().to_owned();
    let before = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        paste_attributes(
            &mut session,
            id,
            &clipboard,
            "changed",
            &selected[1..],
            &[Attribute::Masks],
            KeyframeMode::StretchToFit
        )
        .unwrap_err()
        .1,
        "CLIPBOARD_STALE"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    session.project.timelines[id].tracks[1].locked = true;
    let before = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        paste_attributes(
            &mut session,
            id,
            &clipboard,
            &revision,
            &selected[1..],
            &[Attribute::Masks],
            KeyframeMode::StretchToFit
        )
        .unwrap_err()
        .1,
        "TRACK_LOCKED"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), steps);
}

#[test]
fn pasted_speed_uses_native_linked_ripple_and_undo_restores_following_clips() {
    let (mut session, id, selected) = fixture();
    let after_id = session.project.alloc_clip_id();
    let timeline = &mut session.project.timelines[id];
    for track in &mut timeline.tracks {
        track.crossings.clear();
        track.clips[0].set_speed(core::Rational::new(2, 1), core::Rational::one());
        track.clips[0].pitch_correction = true;
    }
    timeline.tracks[0].insert_sorted(core::Clip::from_source_range(
        after_id,
        core::ClipSource::SolidColor,
        0,
        10,
        60,
        core::Rational::one(),
    ));
    let clipboard = copy(&session, id, &selected[..1]).unwrap();
    let revision = clipboard.revision(&session).unwrap().to_owned();
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    paste_attributes(
        &mut session,
        id,
        &clipboard,
        &revision,
        &selected[1..],
        &[Attribute::Speed],
        KeyframeMode::MaintainTiming,
    )
    .unwrap();
    let timeline = &session.project.timelines[id];
    for track in &timeline.tracks {
        let target = &track.clips[1];
        assert_eq!(
            (target.speed(), target.pitch_correction, target.timeline_len),
            (core::Rational::new(2, 1), true, 12)
        );
    }
    assert_eq!(timeline.clip(0, after_id).unwrap().timeline_start, 48);
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
}
#[test]
fn pasted_speed_refuses_ripple_that_would_separate_a_locked_downstream_link() {
    let (mut session, id, selected) = fixture();
    let video = session.project.alloc_clip_id();
    let audio = session.project.alloc_clip_id();
    let timeline = &mut session.project.timelines[id];
    for track in &mut timeline.tracks {
        track.crossings.clear();
        track.clips[0].set_speed(core::Rational::new(2, 1), core::Rational::one());
    }
    let mut following = core::Clip::from_source_range(
        video,
        core::ClipSource::SolidColor,
        0,
        10,
        60,
        core::Rational::one(),
    );
    following.linked_group = Some(core::LinkGroupId(100));
    timeline.tracks[0].insert_sorted(following.clone());
    following.id = audio;
    let mut locked = core::Track::new(core::TrackKind::Audio);
    locked.locked = true;
    locked.insert_sorted(following);
    timeline.tracks.push(locked);
    let clipboard = copy(&session, id, &selected[..1]).unwrap();
    let revision = clipboard.revision(&session).unwrap().to_owned();
    let before = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        paste_attributes(
            &mut session,
            id,
            &clipboard,
            &revision,
            &selected[1..],
            &[Attribute::Speed],
            KeyframeMode::MaintainTiming
        )
        .unwrap_err()
        .1,
        "LINKED_SYNC"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
}

fn fixture() -> (Session, TimelineId, Vec<String>) {
    let mut session = Session::default();
    let id = session.create_timeline(core::Timeline {
        name: "Clipboard".into(),
        fps: core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![
            core::Track::new(core::TrackKind::Video),
            core::Track::new(core::TrackKind::Audio),
        ],
        markers: vec![],
        master: Default::default(),
    });
    let media = session.add_media(
        "clipboard.mp4".into(),
        core::MediaMeta {
            duration_frames: 48,
            fps: core::Rational::new(24, 1),
            width: 640,
            height: 360,
            has_video: true,
            has_audio: true,
            sample_rate: 48000,
            channels: 2,
            audio_streams: 1,
            file: Default::default(),
        },
    );
    let mut selected = vec![];
    for part in 0..2 {
        for track in 0..2 {
            let clip_id = session.project.alloc_clip_id();
            let mut clip = core::Clip::from_source_range(
                clip_id,
                core::ClipSource::Media(media),
                part * 24,
                (part + 1) * 24,
                10 + part * 24,
                core::Rational::one(),
            );
            clip.linked_group = Some(core::LinkGroupId(9 + part as u64));
            clip.effects
                .transform
                .track_mut(core::TransformParam::PositionX)
                .upsert(6, 20.0, core::Interpolation::Linear);
            clip.effects
                .masks
                .push(core::ClipMask::new(core::MaskShape::Ellipse, (640, 360)));
            session.project.timelines[id].tracks[track].insert_sorted(clip);
            if track == 0 {
                selected.push(clip_id.0.to_string());
            }
        }
    }
    let left = session.project.timelines[id].tracks[0].clips[0].id;
    let right = session.project.timelines[id].tracks[0].clips[1].id;
    session.project.timelines[id].tracks[0]
        .crossings
        .push(core::CrossTransition {
            left_clip: left,
            right_clip: right,
            transition: core::Transition {
                kind: core::TransitionKind::CrossDissolve,
                duration: 12,
                direction: core::PushDirection::Left,
                ease: core::Ease::InOut,
                curve: 0.5,
            },
        });
    (session, id, selected)
}
#[test]
fn clipboard_keeps_effects_links_crossings_and_refuses_any_partial_paste() {
    let (mut session, id, selected) = fixture();
    session.project.timelines[id].tracks[0].locked = true;
    let steps = session.history.position();
    let clipboard = copy(&session, id, &selected).unwrap();
    assert_eq!(clipboard.count(&session), 4);
    assert_eq!(session.history.position(), steps);
    let before = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        paste(&mut session, id, &clipboard, 98).unwrap_err().1,
        "TRACK_LOCKED"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    session.project.timelines[id].tracks[0].locked = false;
    let before = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        paste(&mut session, id, &clipboard, 0).unwrap_err().1,
        "OVERLAP"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    let revision = session.timeline_revision(id);
    paste(&mut session, id, &clipboard, 98).unwrap();
    assert_eq!(session.history.position(), steps + 1);
    let timeline = &session.project.timelines[id];
    assert_eq!(timeline.tracks[0].clips.len(), 4);
    assert_eq!(timeline.tracks[1].clips.len(), 4);
    assert_eq!(timeline.tracks[0].crossings.len(), 2);
    for track in &timeline.tracks {
        for part in 0..2 {
            let original = &track.clips[part];
            let pasted = &track.clips[part + 2];
            assert_ne!(original.id, pasted.id);
            assert_ne!(original.linked_group, pasted.linked_group);
            assert_eq!(pasted.timeline_start, 98 + part as i64 * 24);
            assert_eq!(
                serde_json::to_value(&pasted.effects).unwrap(),
                serde_json::to_value(&original.effects).unwrap()
            );
        }
    }
    assert_eq!(
        timeline.tracks[0].clips[2].linked_group,
        timeline.tracks[1].clips[2].linked_group
    );
    session.history.undo(&mut session.project);
    assert_eq!(session.timeline_revision(id), revision);
}
#[test]
fn paste_conforms_fps_and_crossings_with_missing_tracks_in_one_undo_but_refuses_old_epochs() {
    let (mut session, source, selected) = fixture();
    let clipboard = copy(&session, source, &selected).unwrap();
    let target = session.create_timeline(core::Timeline {
        name: "Target".into(),
        fps: core::Rational::new(30, 1),
        resolution: (640, 360),
        tracks: vec![core::Track::new(core::TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let steps = session.history.position();
    paste(&mut session, target, &clipboard, 0).unwrap();
    assert_eq!(session.history.position(), steps + 1);
    assert_eq!(session.project.timelines[target].tracks.len(), 2);
    let timeline = &session.project.timelines[target];
    for track in &timeline.tracks {
        assert_eq!(
            track
                .clips
                .iter()
                .map(|clip| (
                    clip.timeline_start,
                    clip.timeline_len,
                    clip.source_in(),
                    clip.source_out()
                ))
                .collect::<Vec<_>>(),
            [(0, 30, 0, 24), (30, 30, 24, 48)]
        );
        assert_eq!(track.clips[0].rate(), core::Rational::new(5, 4));
        assert_eq!(track.clips[1].rate(), core::Rational::new(5, 4));
    }
    assert_eq!(timeline.tracks[0].crossings[0].transition.duration, 15);
    assert_eq!(
        timeline.tracks[0].clips[0].linked_group,
        timeline.tracks[1].clips[0].linked_group
    );
    let pasted = serde_json::to_value(timeline).unwrap();
    session.history.undo(&mut session.project);
    assert_eq!(session.project.timelines[target].tracks.len(), 1);
    assert!(session.project.timelines[target].tracks[0].clips.is_empty());
    session.history.redo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[target]).unwrap(),
        pasted
    );
    session.install_project(core::Project::default(), None);
    assert_eq!(
        paste(&mut session, target, &clipboard, 0).unwrap_err().1,
        "CLIPBOARD_STALE"
    );
}
#[test]
fn fractional_paste_uses_the_native_relative_clock_for_frozen_speed_effects_and_generators() {
    for (from, to) in [
        (core::Rational::new(24000, 1001), core::Rational::new(30, 1)),
        (core::Rational::new(30, 1), core::Rational::new(24000, 1001)),
    ] {
        let (mut session, source, selected) = fixture();
        session.project.timelines[source].fps = from;
        let media = match session.project.timelines[source].tracks[0].clips[0].source {
            core::ClipSource::Media(media) => media,
            _ => unreachable!(),
        };
        session.project.media_pool[media].meta.duration_frames = 24000;
        session.project.media_pool[media].meta.fps = core::Rational::new(30000, 1001);
        for track in &mut session.project.timelines[source].tracks {
            track.crossings.clear();
            track.clips.truncate(1);
            let clip = &mut track.clips[0];
            let effects = clip.effects.clone();
            let group = clip.linked_group;
            *clip = core::Clip::from_source_range(
                clip.id,
                clip.source.clone(),
                101,
                401,
                37,
                core::Rational::conform_rate(from, core::Rational::new(30000, 1001)),
            );
            clip.set_speed(
                core::Rational::new(3, 2),
                core::Rational::conform_rate(from, core::Rational::new(30000, 1001)),
            );
            clip.freeze = Some(117);
            clip.pitch_correction = true;
            clip.fade_in = 3;
            clip.fade_out = 5;
            clip.effects = effects;
            clip.linked_group = group;
        }
        let generator_id = session.project.alloc_clip_id();
        let mut generator = core::Clip::from_source_range(
            generator_id,
            core::ClipSource::SolidColor,
            0,
            49,
            53,
            core::Rational::one(),
        );
        generator
            .effects
            .transform
            .track_mut(core::TransformParam::Opacity)
            .upsert(17, 42.0, core::Interpolation::EaseInOut);
        let generator_track = session.project.timelines[source].tracks.len();
        session.project.timelines[source]
            .tracks
            .push(core::Track::new(core::TrackKind::Video));
        session.project.timelines[source].tracks[generator_track]
            .clips
            .push(generator);
        let clipboard = copy(
            &session,
            source,
            &[selected[0].clone(), generator_id.0.to_string()],
        )
        .unwrap();
        let target = session.create_timeline(core::Timeline {
            name: "Fractional destination".into(),
            fps: to,
            resolution: (1280, 720),
            tracks: vec![],
            markers: vec![],
            master: Default::default(),
        });
        let before = serde_json::to_value(&session.project.timelines[target]).unwrap();
        let steps = session.history.position();
        paste(&mut session, target, &clipboard, 91).unwrap();
        assert_eq!(session.history.position(), steps + 1);
        for entry in &clipboard.entries {
            let index = session.project.timelines[target]
                .track_of_kind_numbered(entry.track_kind, entry.track_number)
                .unwrap();
            let actual = &session.project.timelines[target].tracks[index].clips[0];
            let mut native = entry.clip.clone();
            native.timeline_start = entry.relative_start;
            native.linked_group = None;
            let conform = match native.source {
                core::ClipSource::Media(media) => {
                    core::Rational::conform_rate(to, session.project.media_pool[media].meta.fps)
                }
                _ => native.conform_rate(),
            };
            native.retime(from, to, conform);
            native.timeline_start += 91;
            native.id = actual.id;
            native.linked_group = actual.linked_group;
            assert_eq!(
                serde_json::to_value(actual).unwrap(),
                serde_json::to_value(&native).unwrap()
            );
            assert_eq!(
                serde_json::to_value(&actual.effects).unwrap(),
                serde_json::to_value(&entry.clip.effects).unwrap()
            );
            if matches!(actual.source, core::ClipSource::Media(_)) {
                assert_eq!(actual.speed(), core::Rational::new(3, 2));
                assert_eq!(actual.freeze, Some(117));
                assert!(actual.pitch_correction);
                assert_eq!(actual.picture_frame_at(actual.timeline_start), 117);
                assert_eq!(actual.picture_frame_at(actual.timeline_end() - 1), 117);
            }
        }
        let tracks = &session.project.timelines[target].tracks;
        let linked = tracks
            .iter()
            .filter_map(|track| track.clips[0].linked_group)
            .collect::<Vec<_>>();
        assert_eq!(linked.len(), 2);
        assert_eq!(linked[0], linked[1]);
        session.history.undo(&mut session.project);
        assert_eq!(
            serde_json::to_value(&session.project.timelines[target]).unwrap(),
            before
        );
    }
}
#[test]
fn cross_fps_overlap_and_locked_tracks_refuse_the_whole_native_trial_before_allocating() {
    let (mut session, source, selected) = fixture();
    let clipboard = copy(&session, source, &selected).unwrap();
    let blocker = core::Clip::from_source_range(
        session.project.alloc_clip_id(),
        core::ClipSource::SolidColor,
        0,
        1,
        100,
        core::Rational::one(),
    );
    let mut video = core::Track::new(core::TrackKind::Video);
    video.clips.push(blocker);
    let target = session.create_timeline(core::Timeline {
        name: "Occupied fractional destination".into(),
        fps: core::Rational::new(30000, 1001),
        resolution: (640, 360),
        tracks: vec![video],
        markers: vec![],
        master: Default::default(),
    });
    let before = serde_json::to_value(&session.project).unwrap();
    let steps = session.history.position();
    assert_eq!(
        paste(&mut session, target, &clipboard, 50).unwrap_err().1,
        "OVERLAP"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), steps);
    session.project.timelines[target].tracks[0].locked = true;
    let before = serde_json::to_value(&session.project).unwrap();
    assert_eq!(
        paste(&mut session, target, &clipboard, 150).unwrap_err().1,
        "TRACK_LOCKED"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.position(), steps);
}
#[test]
fn copied_compounds_cannot_be_pasted_inside_their_own_child() {
    let (mut session, id, selected) = fixture();
    commands::apply(
        &mut session,
        id,
        &commands::Operation::MakeCompound {
            clip_ids: selected,
            name: "Child".into(),
        },
    )
    .unwrap();
    let outer = session.project.timelines[id].tracks[0].clips[0]
        .id
        .0
        .to_string();
    let clipboard = copy(&session, id, &[outer]).unwrap();
    let child = session
        .project
        .timelines
        .keys()
        .find(|key| *key != id)
        .unwrap();
    let before = serde_json::to_value(&session.project).unwrap();
    assert!(
        paste(&mut session, child, &clipboard, 100)
            .unwrap_err()
            .2
            .contains("cycle")
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
}
