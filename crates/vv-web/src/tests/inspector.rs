use super::*;
use vv_core::{Id, Rational, Timeline, Track, TrackKind};

#[test]
fn viewer_geometry_uses_native_source_dimensions_instead_of_timeline_dimensions() {
    let (mut session, id, raw) = fixture();
    assert_eq!(
        detail(&session, id, &raw, 100).unwrap()["source_size"],
        json!([640, 360])
    );
    let media = session.project.media_pool.insert(core::MediaItem {
        path: "geometry-source.mp4".into(),
        meta: core::MediaMeta {
            width: 1920,
            height: 800,
            duration_frames: 120,
            fps: Rational::new(24, 1),
            has_video: true,
            has_audio: false,
            sample_rate: 0,
            channels: 0,
            audio_streams: 0,
            file: Default::default(),
        },
        content_hash: 0,
        compound: None,
        folder: None,
    });
    session.project.timelines[id].tracks[0].clips[0].source = ClipSource::Media(media);
    let before = session.timeline_revision(id);
    let position = session.history.position();
    assert_eq!(
        detail(&session, id, &raw, 100).unwrap()["source_size"],
        json!([1920, 800])
    );
    assert_eq!(session.timeline_revision(id), before);
    assert_eq!(session.history.position(), position);
}

#[test]
fn dense_key_pages_expose_every_native_scalar_and_text_key_without_unbounded_summaries() {
    let (mut session, id, raw) = fixture();
    let clip = &mut session.project.timelines[id].tracks[0].clips[0];
    clip.timeline_len = 6000;
    clip.effects.title = Some(Default::default());
    let interpolation = core::Interpolation::Bezier {
        c1: [0.2, 0.1],
        c2: [0.8, 0.9],
    };
    for index in 0..2501 {
        clip.effects
            .transform
            .track_mut(TransformParam::ZoomX)
            .upsert(index * 2, 1.25, interpolation);
        clip.effects.title.as_mut().unwrap().content.upsert(
            index * 2,
            format!("Title {index} α"),
            core::Interpolation::Hold,
        );
    }
    let revision = session.timeline_revision(id);
    let position = session.history.position();
    let mut scalar = Vec::new();
    let mut text = Vec::new();
    for page in 0..10 {
        let detail = detail_page(&session, id, &raw, 12, Some(page)).unwrap();
        assert_eq!(
            detail["key_page"],
            json!({"index":page,"page_size":256,"total_pages":10})
        );
        let zoom = detail["curves"]["tracks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["target"]["param"] == "ZoomX")
            .unwrap();
        assert!(zoom["keys"].as_array().unwrap().len() <= 256);
        scalar.extend(zoom["keys"].as_array().unwrap().iter().cloned());
        let title = detail["event_keys"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["target"]["kind"] == "text")
            .unwrap();
        text.extend(title["keys"].as_array().unwrap().iter().cloned());
        let summary = detail["transform"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["param"] == "ZoomX")
            .unwrap();
        assert_eq!(summary["key_count"], 2501);
        assert_eq!(summary["keyframes"].as_array().unwrap().len(), 16);
        assert_eq!(
            detail["title"]["content"]["keyframes"]
                .as_array()
                .unwrap()
                .len(),
            16
        );
    }
    assert_eq!(scalar.len(), 2501);
    assert_eq!(text.len(), 2501);
    for index in 0..2501 {
        assert_eq!(scalar[index]["source_frame"], json!(index * 2));
        assert_eq!(scalar[index]["interpolation"], json!(interpolation));
        assert_eq!(text[index]["value"], json!(format!("Title {index} α")));
        assert_eq!(text[index]["interpolation"], "Hold");
    }
    assert!(detail_page(&session, id, &raw, 12, Some(10)).is_err());
    assert!(detail_page(&session, id, &raw, 12, Some(usize::MAX)).is_err());
    assert_eq!(session.history.position(), position);
    assert_eq!(session.timeline_revision(id), revision);
    crate::curves::edit(
        &mut session,
        id,
        &raw,
        &crate::curves::Edit {
            target: Target::Transform {
                param: TransformParam::ZoomX,
            },
            previous_source_frame: Some(4400),
            source_frame: 4401,
            value: Some(1.5),
            interpolation,
            link_zoom: false,
        },
    )
    .unwrap();
    assert_eq!(session.history.position(), position + 1);
    session.history.undo(&mut session.project);
    assert_eq!(session.timeline_revision(id), revision);
}
fn fixture() -> (Session, TimelineId, String) {
    let mut session = Session::default();
    let id = session.create_timeline(Timeline {
        name: "Properties".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![Track::new(TrackKind::Video), Track::new(TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    });
    let clip_id = session.project.alloc_clip_id();
    let clip = Clip::from_source_range(
        clip_id,
        ClipSource::SolidColor,
        12,
        60,
        100,
        Rational::one(),
    );
    session.project.timelines[id].tracks[0].insert_sorted(clip);
    (session, id, clip_id.0.to_string())
}

fn selection_fixture() -> (Session, TimelineId, Vec<String>) {
    let (mut session, id, first) = fixture();
    let mut peer = Clip::from_source_range(
        session.project.alloc_clip_id(),
        ClipSource::SolidColor,
        40,
        60,
        200,
        Rational::new(2, 1),
    );
    let second = peer.id.0.to_string();
    peer.freeze = Some(7);
    peer.effects
        .transform
        .track_mut(TransformParam::PositionX)
        .default = 50.0;
    peer.effects
        .transform
        .track_mut(TransformParam::ZoomX)
        .default = 2.0;
    peer.effects
        .transform
        .track_mut(TransformParam::PositionY)
        .upsert(40, 8.0, core::Interpolation::Hold);
    peer.effects
        .transform
        .track_mut(TransformParam::PositionY)
        .upsert(50, 18.0, core::Interpolation::Hold);
    peer.effects.transform.flip = [false, true];
    let primary = &mut session.project.timelines[id].tracks[0].clips[0];
    primary
        .effects
        .transform
        .track_mut(TransformParam::PositionX)
        .default = 5.0;
    primary
        .effects
        .transform
        .track_mut(TransformParam::PositionY)
        .default = 12.0;
    primary
        .effects
        .transform
        .track_mut(TransformParam::AnchorX)
        .default = 2.0;
    session.project.timelines[id]
        .tracks
        .push(Track::new(TrackKind::Video));
    session.project.timelines[id].tracks[2].insert_sorted(peer);
    (session, id, vec![second, first])
}

fn selected_titles() -> (Session, TimelineId, Vec<String>) {
    let (mut session, id, mut ids) = selection_fixture();
    for (track, text) in [(0, "Primary"), (2, "Peer")] {
        let clip = &mut session.project.timelines[id].tracks[track].clips[0];
        clip.source = ClipSource::Text;
        let mut title = core::TitleParams::default();
        title.content.default = text.into();
        title.font_family = text.into();
        title.background.height = if track == 0 { 0.2 } else { 0.7 };
        title.background.width = if track == 0 { 0.1 } else { 0.6 };
        clip.effects.title = Some(title);
    }
    let clip_id = session.project.alloc_clip_id();
    let solid = Clip::from_source_range(clip_id, ClipSource::SolidColor, 0, 50, 0, Rational::one());
    let mut track = Track::new(TrackKind::Video);
    track.insert_sorted(solid);
    session.project.timelines[id].tracks.push(track);
    ids.push(clip_id.0.to_string());
    (session, id, ids)
}

#[test]
fn selected_titles_patch_only_primary_changed_fields_and_background_members_with_own_text_keys_and_one_undo()
 {
    let (mut session, id, ids) = selected_titles();
    let primary = &mut session.project.timelines[id].tracks[0].clips[0];
    let title = primary.effects.title.as_mut().unwrap();
    for (frame, text) in [(12, "Start"), (20, "At playhead"), (30, "End")] {
        title
            .content
            .upsert(frame, text.into(), core::Interpolation::Hold);
    }
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let position = session.history.position();
    let mut background = title_background(&session, id, 0);
    background.width = 0.4;
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::Title {
            patch: Box::new(TitleEdit {
                text: Some("Changed".into()),
                size: Some(120.0),
                font_family: Some("Primary".into()),
                background: Some(background),
                ..Default::default()
            }),
        },
    )
    .unwrap();
    let timeline = &session.project.timelines[id];
    let primary = timeline.tracks[0].clips[0].effects.title.as_ref().unwrap();
    let peer = timeline.tracks[2].clips[0].effects.title.as_ref().unwrap();
    assert_eq!(
        primary.content.keyframe_at(20),
        Some(("Changed".into(), core::Interpolation::Hold))
    );
    assert_eq!(primary.content.keyframe_at(12).unwrap().0, "Start");
    assert_eq!(peer.content.default, "Changed");
    assert!(peer.content.is_constant());
    assert_eq!(peer.font_family, "Peer");
    assert_eq!(peer.size, 120.0);
    assert_eq!(peer.background.width, 0.4);
    assert_eq!(peer.background.height, 0.7);
    assert!(timeline.tracks[3].clips[0].effects.title.is_none());
    assert_eq!(timeline.tracks[2].clips[0].freeze, Some(7));
    assert_eq!(session.history.position(), position + 1);
    let after = serde_json::to_value(timeline).unwrap();
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    session.history.redo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        after
    );
    let generation = session.history.generation();
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::Title {
            patch: Box::new(TitleEdit {
                size: Some(120.0),
                ..Default::default()
            }),
        },
    )
    .unwrap();
    assert_eq!(session.history.generation(), generation);
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::ResetTitle {
            fields: vec![TitleField::BackgroundWidth],
        },
    )
    .unwrap();
    assert_eq!(
        title_background(&session, id, 2).width,
        core::TitleBackground::default().width
    );
    assert_eq!(title_background(&session, id, 2).height, 0.7);
}

fn title_background(session: &Session, id: TimelineId, track: usize) -> core::TitleBackground {
    session.project.timelines[id].tracks[track].clips[0]
        .effects
        .title
        .as_ref()
        .unwrap()
        .background
        .clone()
}

#[test]
fn selected_title_diamonds_toggle_each_peers_own_presence_while_solid_diamonds_follow_primary_and_preserve_own_colors()
 {
    let (mut session, id, ids) = selected_titles();
    session.project.timelines[id].tracks[0].clips[0]
        .effects
        .title
        .as_mut()
        .unwrap()
        .content
        .upsert(20, "Own primary".into(), core::Interpolation::Hold);
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    selected_edit(&mut session, id, &ids, 108, InspectorEdit::ToggleTextKey {}).unwrap();
    assert!(
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .title
            .as_ref()
            .unwrap()
            .content
            .keyframe_at(20)
            .is_none()
    );
    assert_eq!(
        session.project.timelines[id].tracks[2].clips[0]
            .effects
            .title
            .as_ref()
            .unwrap()
            .content
            .keyframe_at(40),
        Some(("Peer".into(), core::Interpolation::Hold))
    );
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    let (mut session, id, ids) = selection_fixture();
    let red = core::Rgba {
        r: 0.8,
        g: 0.1,
        b: 0.2,
        a: 0.5,
    };
    let green = core::Rgba {
        r: 0.1,
        g: 0.7,
        b: 0.2,
        a: 0.8,
    };
    session.project.timelines[id].tracks[0].clips[0]
        .effects
        .color = Some(core::Keyframed::constant(red));
    session.project.timelines[id].tracks[2].clips[0]
        .effects
        .color = Some(core::Keyframed::constant(green));
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::ToggleColorKey {},
    )
    .unwrap();
    for (track, frame, value) in [(0, 20, red), (2, 40, green)] {
        assert_eq!(
            session.project.timelines[id].tracks[track].clips[0]
                .effects
                .color
                .as_ref()
                .unwrap()
                .keyframe_at(frame),
            Some((value, core::Interpolation::Linear))
        );
    }
    let target = core::Rgba {
        r: 0.3,
        g: 0.4,
        b: 0.9,
        a: 0.6,
    };
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::SolidColor { value: target },
    )
    .unwrap();
    assert_eq!(
        session.project.timelines[id].tracks[2].clips[0]
            .effects
            .color
            .as_ref()
            .unwrap()
            .default,
        green
    );
    assert_eq!(
        session.project.timelines[id].tracks[2].clips[0]
            .effects
            .color
            .as_ref()
            .unwrap()
            .value_at(40),
        target
    );
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::ToggleColorKey {},
    )
    .unwrap();
    for (track, frame) in [(0, 20), (2, 40)] {
        assert!(
            session.project.timelines[id].tracks[track].clips[0]
                .effects
                .color
                .as_ref()
                .unwrap()
                .keyframe_at(frame)
                .is_none()
        );
    }
}

#[test]
fn selected_filters_preserve_peer_stack_and_unchanged_axes_using_native_default_or_own_clock_key_then_reset_undo_redo()
 {
    let (mut session, id, ids) = selected_titles();
    let kind = core::FilterKind::DropShadow;
    let mut first = core::ClipFilter::new(kind);
    first.radius.default = 5.0;
    first.offset[0].default = 1.0;
    first.offset[1].default = 2.0;
    let mut peer = core::ClipFilter::new(kind);
    peer.radius.default = 17.0;
    peer.offset[0].default = 70.0;
    peer.offset[1].upsert(35, 8.0, core::Interpolation::Hold);
    session.project.timelines[id].tracks[0].clips[0]
        .effects
        .filters = vec![first];
    session.project.timelines[id].tracks[2].clips[0]
        .effects
        .filters = vec![core::ClipFilter::new(core::FilterKind::Exposure), peer];
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let position = session.history.position();
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::Filter {
            filter: kind,
            patch: Box::new(crate::visual::FilterPatch {
                radius: Some(5.0),
                offset: Some([1.0, 10.0]),
                ..Default::default()
            }),
        },
    )
    .unwrap();
    let peer = &session.project.timelines[id].tracks[2].clips[0]
        .effects
        .filters;
    assert_eq!(peer[0].kind, core::FilterKind::Exposure);
    assert_eq!(peer[1].radius.default, 17.0);
    assert_eq!(peer[1].offset[0].default, 70.0);
    assert_eq!(
        peer[1].offset[1].keyframe_at(40),
        Some((10.0, core::Interpolation::Linear))
    );
    assert_eq!(
        peer[1].offset[1].keyframe_at(35),
        Some((8.0, core::Interpolation::Hold))
    );
    assert!(
        session.project.timelines[id].tracks[3].clips[0]
            .effects
            .filters
            .is_empty()
    );
    assert_eq!(session.history.position(), position + 1);
    let changed = serde_json::to_value(&session.project.timelines[id]).unwrap();
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    session.history.redo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        changed
    );
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::ResetFilter {
            filter: kind,
            params: vec![FilterParameter::Offset { axis: 1 }],
            reset_enabled: false,
            reset_color: false,
            reset_grade: false,
        },
    )
    .unwrap();
    let filters = &session.project.timelines[id].tracks[2].clips[0]
        .effects
        .filters;
    assert!(filters[1].offset[1].is_constant());
    assert_eq!(filters[1].offset[0].default, 70.0);
    assert_eq!(filters[1].radius.default, 17.0);
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::FilterPresence {
            filter: kind,
            enabled: true,
        },
    )
    .unwrap();
    assert_eq!(
        session.project.timelines[id].tracks[3].clips[0]
            .effects
            .filters
            .len(),
        1
    );
    assert_eq!(
        session.project.timelines[id].tracks[2].clips[0]
            .effects
            .filters[1]
            .radius
            .default,
        17.0
    );
}

#[test]
fn selected_filter_enum_and_grade_keys_follow_native_rows_and_presets_without_overwriting_other_filters()
 {
    let (mut session, id, ids) = selection_fixture();
    for track in [0, 2] {
        let clip = &mut session.project.timelines[id].tracks[track].clips[0];
        let mut blur = core::ClipFilter::new(core::FilterKind::GaussianBlur);
        blur.direction.default = if track == 0 {
            core::BlurDirection::Horizontal
        } else {
            core::BlurDirection::Vertical
        };
        clip.effects.filters = vec![
            blur,
            core::ClipFilter::new(core::FilterKind::ColorCorrection),
        ];
    }
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::ToggleFilterKeys {
            filter: core::FilterKind::GaussianBlur,
            params: vec![FilterParameter::Direction {}],
        },
    )
    .unwrap();
    for (track, frame, value) in [
        (0, 20, core::BlurDirection::Horizontal),
        (2, 40, core::BlurDirection::Vertical),
    ] {
        assert_eq!(
            session.project.timelines[id].tracks[track].clips[0]
                .effects
                .filters[0]
                .direction
                .keyframe_at(frame),
            Some((value, core::Interpolation::Linear))
        );
    }
    let peer = &mut session.project.timelines[id].tracks[2].clips[0]
        .effects
        .filters[1];
    peer.grade
        .track_mut(core::GradeParam::ShadowsX)
        .upsert(35, 0.1, core::Interpolation::Hold);
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::Filter {
            filter: core::FilterKind::ColorCorrection,
            patch: Box::new(crate::visual::FilterPatch {
                grade: vec![crate::visual::GradeValue {
                    param: core::GradeParam::ShadowsY,
                    value: 0.2,
                }],
                ..Default::default()
            }),
        },
    )
    .unwrap();
    let peer = &session.project.timelines[id].tracks[2].clips[0]
        .effects
        .filters[1];
    assert!(
        peer.grade
            .track(core::GradeParam::ShadowsY)
            .keyframe_at(40)
            .is_some()
    );
    assert!(
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .filters[1]
            .grade
            .track(core::GradeParam::ShadowsY)
            .is_constant()
    );
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::GradePreset {
            preset: "BlackAndWhite".into(),
        },
    )
    .unwrap();
    let peer = &session.project.timelines[id].tracks[2].clips[0]
        .effects
        .filters;
    assert_eq!(
        peer[1].grade.track(core::GradeParam::Saturation).default,
        0.0
    );
    assert!(
        peer[1]
            .grade
            .track(core::GradeParam::ShadowsY)
            .keyframe_at(40)
            .is_some()
    );
    assert!(peer[0].direction.keyframe_at(40).is_some());
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::GradePreset {
            preset: "Neutral".into(),
        },
    )
    .unwrap();
    assert!(
        session.project.timelines[id].tracks[2].clips[0]
            .effects
            .filters[1]
            .grade
            .track(core::GradeParam::ShadowsY)
            .is_constant()
    );
}

#[test]
fn selected_content_actions_refuse_bad_primary_later_targets_and_invalid_rows_atomically_with_strict_dtos()
 {
    for case in 0..8 {
        let (mut session, id, mut ids) = selected_titles();
        let kind = core::FilterKind::DropShadow;
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .filters = vec![
            core::ClipFilter::new(kind),
            core::ClipFilter::new(core::FilterKind::Exposure),
        ];
        session.project.timelines[id].tracks[2].clips[0]
            .effects
            .filters = vec![core::ClipFilter::new(kind)];
        let edit = match case {
            0 => {
                session.project.timelines[id].tracks[2].locked = true;
                InspectorEdit::Title {
                    patch: Box::new(TitleEdit {
                        size: Some(120.0),
                        ..Default::default()
                    }),
                }
            }
            1 => {
                session.project.timelines[id].tracks[2].kind = TrackKind::Audio;
                InspectorEdit::ToggleTextKey {}
            }
            2 => {
                ids.push(format!("0{}", ids[0]));
                InspectorEdit::ToggleTextKey {}
            }
            3 => InspectorEdit::FilterMove {
                filter: kind,
                to_index: 1,
            },
            4 => InspectorEdit::ToggleFilterKeys {
                filter: kind,
                params: vec![FilterParameter::Offset { axis: 2 }],
            },
            5 => InspectorEdit::Title {
                patch: Box::new(TitleEdit {
                    size: Some(f32::NAN),
                    ..Default::default()
                }),
            },
            6 => InspectorEdit::SolidColor {
                value: core::Rgba::WHITE,
            },
            _ => InspectorEdit::Filter {
                filter: kind,
                patch: Box::new(crate::visual::FilterPatch {
                    amount: Some(101.0),
                    ..Default::default()
                }),
            },
        };
        let before = serde_json::to_value(&session.project).unwrap();
        let generation = session.history.generation();
        assert!(
            selected_edit(&mut session, id, &ids, 108, edit).is_err(),
            "case {case}"
        );
        assert_eq!(
            serde_json::to_value(&session.project).unwrap(),
            before,
            "case {case}"
        );
        assert_eq!(session.history.generation(), generation);
    }
    for value in [
        json!({"action":"toggle_text_key","extra":1}),
        json!({"action":"toggle_color_key","value":null}),
        json!({"action":"filter","filter":"Exposure","patch":{"unknown":1}}),
        json!({"action":"toggle_filter_keys","filter":"BoxBlur","params":[{"kind":"radius","extra":true}]}),
    ] {
        assert!(
            serde_json::from_value::<InspectorEdit>(value.clone()).is_err(),
            "{value}"
        );
    }
}

#[test]
fn selected_content_metadata_exposes_dense_native_key_neighbors_and_unclamped_clock_with_inclusive_out_navigation()
 {
    let (mut session, id, ids) = selected_titles();
    let clip = &mut session.project.timelines[id].tracks[0].clips[0];
    clip.effects.color = Some(core::Keyframed::constant(core::Rgba::WHITE));
    clip.effects.filters = vec![core::ClipFilter::new(core::FilterKind::GaussianBlur)];
    for frame in 0..80 {
        clip.effects.title.as_mut().unwrap().content.upsert(
            frame,
            format!("Frame {frame}"),
            core::Interpolation::Hold,
        );
        clip.effects.color.as_mut().unwrap().upsert(
            frame,
            core::Rgba::WHITE,
            core::Interpolation::Linear,
        );
        clip.effects.filters[0]
            .radius
            .upsert(frame, frame as f32, core::Interpolation::Linear);
        clip.effects.filters[0].direction.upsert(
            frame,
            core::BlurDirection::Both,
            core::Interpolation::Hold,
        );
    }
    let raw = &ids[1];
    let before = serde_json::to_value(&session.project).unwrap();
    let generation = session.history.generation();
    let value = detail(&session, id, raw, 140).unwrap();
    for info in [
        &value["title"]["content"]["keyframe_info"],
        &value["filters"]["stack"][0]["radius"]["keyframe_info"],
        &value["filters"]["stack"][0]["direction_info"]["keyframe_info"],
    ] {
        assert_eq!(info["on_keyframe"], true);
        assert_eq!(info["previous_frame"], 139);
        assert_eq!(info["next_frame"], 141);
    }
    let past = detail(&session, id, raw, 500).unwrap();
    let clip = &session.project.timelines[id].tracks[0].clips[0];
    assert_eq!(
        past["keyframe_clock"]["source_frame"],
        clip.source_frame_at(500)
    );
    assert_ne!(past["keyframe_clock"]["source_frame"], past["source_frame"]);
    let out = keyframe_navigation(&session, id, raw, 1_000_000).unwrap();
    assert_eq!(out["source_frame"], clip.source_out());
    assert_eq!(
        out["timeline_frame"],
        clip.timeline_frame_at(clip.source_out())
    );
    assert_eq!(past["keyframe_clock"]["ticks"].as_array().unwrap().len(), 9);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.generation(), generation);
}

#[test]
fn selected_title_shadow_filters_only_titles_and_solid_metadata_never_exposes_controls_for_other_sources()
 {
    let (mut session, id, ids) = selected_titles();
    let primary_id = ids[1].clone();
    session.project.timelines[id].tracks[0].clips[0]
        .effects
        .color = Some(core::Keyframed::constant(core::Rgba::WHITE));
    assert!(detail(&session, id, &primary_id, 108).unwrap()["color_info"].is_null());
    let solid_id = ids[2].clone();
    let solid = detail(&session, id, &solid_id, 108).unwrap();
    assert_eq!(
        solid["color_info"]["value"],
        json!(core::edit::DEFAULT_SOLID_COLOR)
    );
    assert_eq!(solid["color_info"]["keyframe_info"]["on_keyframe"], false);
    let mut existing = core::ClipFilter::new(core::FilterKind::DropShadow);
    existing.enabled = false;
    existing.radius.default = 23.0;
    session.project.timelines[id].tracks[2].clips[0]
        .effects
        .filters
        .push(existing.clone());
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let position = session.history.position();
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::TitleShadow { enabled: true },
    )
    .unwrap();
    assert_eq!(session.history.position(), position + 1);
    assert_eq!(
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .filters
            .len(),
        1
    );
    assert_eq!(
        session.project.timelines[id].tracks[2].clips[0]
            .effects
            .filters,
        vec![existing]
    );
    assert!(
        session.project.timelines[id].tracks[3].clips[0]
            .effects
            .filters
            .is_empty()
    );
    let generation = session.history.generation();
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::TitleShadow { enabled: true },
    )
    .unwrap();
    assert_eq!(session.history.generation(), generation);
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
    session.history.redo(&mut session.project);
    let before = serde_json::to_value(&session.project).unwrap();
    let generation = session.history.generation();
    assert!(
        selected_edit(
            &mut session,
            id,
            &[solid_id],
            108,
            InspectorEdit::TitleShadow { enabled: true }
        )
        .is_err()
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.generation(), generation);
    assert!(
        serde_json::from_value::<InspectorEdit>(
            json!({"action":"title_shadow","enabled":true,"extra":1})
        )
        .is_err()
    );
}

fn selected_edit(
    session: &mut Session,
    id: TimelineId,
    ids: &[String],
    frame: i64,
    edit: InspectorEdit,
) -> Result<()> {
    crate::commands::apply(
        session,
        id,
        &crate::commands::Operation::EditInspectorSelection {
            clip_ids: ids.to_vec(),
            timeline_frame: frame,
            edit,
        },
    )
}

#[test]
fn selected_inspector_uses_native_primary_delta_own_clamped_clocks_and_one_undo_without_touching_unchanged_axes()
 {
    use TransformParam as P;
    let (mut session, id, ids) = selection_fixture();
    let original = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let position = session.history.position();
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::Transform {
            parameters: vec![
                Parameter {
                    param: P::PositionX,
                    value: 15.0,
                },
                Parameter {
                    param: P::PositionY,
                    value: 100.0,
                },
                Parameter {
                    param: P::AnchorX,
                    value: 8.0,
                },
                Parameter {
                    param: P::ZoomX,
                    value: 1.0,
                },
            ],
        },
    )
    .unwrap();
    let tl = &session.project.timelines[id];
    let first = &tl.tracks[0].clips[0];
    let peer = &tl.tracks[2].clips[0];
    assert_eq!(first.source_frame_at(108), 20);
    assert_eq!(peer.source_frame_at(peer.timeline_start), 40);
    assert_eq!(first.effects.transform.track(P::PositionX).default, 15.0);
    assert_eq!(peer.effects.transform.track(P::PositionX).default, 60.0);
    assert_eq!(peer.effects.transform.track(P::PositionY).default, 0.0);
    assert_eq!(
        peer.effects.transform.track(P::PositionY).keyframe_at(40),
        Some((96.0, core::Interpolation::Linear))
    );
    assert_eq!(
        peer.effects.transform.track(P::PositionY).keyframe_at(50),
        Some((18.0, core::Interpolation::Hold))
    );
    assert_eq!(first.effects.transform.track(P::AnchorX).default, 8.0);
    assert_eq!(peer.effects.transform.track(P::AnchorX).default, 8.0);
    assert_eq!(peer.effects.transform.track(P::ZoomX).default, 2.0);
    assert_eq!(peer.freeze, Some(7));
    assert_eq!(session.history.position(), position + 1);
    let changed = serde_json::to_value(&session.project.timelines[id]).unwrap();
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        original
    );
    let project = serde_json::to_value(&session.project).unwrap();
    let generation = session.history.generation();
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::Transform {
            parameters: vec![Parameter {
                param: P::PositionX,
                value: 5.0,
            }],
        },
    )
    .unwrap();
    assert_eq!(session.history.generation(), generation);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), project);
    session.history.redo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        changed
    );
}

#[test]
fn selected_inspector_row_diamond_uses_primary_any_axis_and_preserves_peer_values_and_interpolation_on_undo()
 {
    use TransformParam as P;
    let (mut session, id, ids) = selection_fixture();
    let original = serde_json::to_value(&session.project.timelines[id]).unwrap();
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::ToggleTransformKeys {
            params: vec![P::PositionX, P::PositionY],
        },
    )
    .unwrap();
    let first = &session.project.timelines[id].tracks[0].clips[0];
    let peer = &session.project.timelines[id].tracks[2].clips[0];
    for (clip, frame, values) in [(first, 20, [5.0, 12.0]), (peer, 40, [50.0, 8.0])] {
        for (param, value) in [P::PositionX, P::PositionY].into_iter().zip(values) {
            assert_eq!(
                clip.effects.transform.track(param).keyframe_at(frame),
                Some((value, core::Interpolation::Linear))
            );
        }
    }
    let pinned = serde_json::to_value(&session.project.timelines[id]).unwrap();
    session.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform
        .track_mut(P::PositionY)
        .remove_at(20);
    let mixed = serde_json::to_value(&session.project.timelines[id]).unwrap();
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::ToggleTransformKeys {
            params: vec![P::PositionX, P::PositionY],
        },
    )
    .unwrap();
    for (track, frame) in [(0, 20), (2, 40)] {
        for param in [P::PositionX, P::PositionY] {
            assert!(
                session.project.timelines[id].tracks[track].clips[0]
                    .effects
                    .transform
                    .track(param)
                    .keyframe_at(frame)
                    .is_none()
            );
        }
    }
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        mixed
    );
    session.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform
        .track_mut(P::PositionY)
        .upsert(20, 12.0, core::Interpolation::Linear);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        pinned
    );
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        original
    );
    selected_edit(
        &mut session,
        id,
        &ids,
        500,
        InspectorEdit::ToggleTransformKeys {
            params: vec![P::Rotation],
        },
    )
    .unwrap();
    for track in [0, 2] {
        let clip = &session.project.timelines[id].tracks[track].clips[0];
        let frame = clip.source_frame_at(clip.timeline_end() - 1);
        assert!(
            clip.effects
                .transform
                .track(P::Rotation)
                .keyframe_at(frame)
                .is_some()
        );
    }
}

#[test]
fn selected_inspector_flip_and_resets_preserve_unrelated_axes_and_restore_exact_tracks() {
    use TransformParam as P;
    let (mut session, id, ids) = selection_fixture();
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::Flip {
            axis: 0,
            enabled: true,
        },
    )
    .unwrap();
    assert_eq!(
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .transform
            .flip,
        [true, false]
    );
    assert_eq!(
        session.project.timelines[id].tracks[2].clips[0]
            .effects
            .transform
            .flip,
        [true, true]
    );
    let generation = session.history.generation();
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::Flip {
            axis: 1,
            enabled: false,
        },
    )
    .unwrap();
    assert_eq!(session.history.generation(), generation);
    assert_eq!(
        session.project.timelines[id].tracks[2].clips[0]
            .effects
            .transform
            .flip,
        [true, true]
    );
    let original = serde_json::to_value(&session.project.timelines[id]).unwrap();
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::ResetTransform {
            params: vec![P::PositionX, P::PositionY],
            reset_flip: true,
        },
    )
    .unwrap();
    for track in [0, 2] {
        let transform = &session.project.timelines[id].tracks[track].clips[0]
            .effects
            .transform;
        assert_eq!(transform.flip, [false, false]);
        for param in [P::PositionX, P::PositionY] {
            assert!(transform.track(param).is_constant());
            assert_eq!(transform.track(param).default, 0.0);
        }
    }
    assert_eq!(
        session.project.timelines[id].tracks[2].clips[0]
            .effects
            .transform
            .track(P::ZoomX)
            .default,
        2.0
    );
    let reset = serde_json::to_value(&session.project.timelines[id]).unwrap();
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        original
    );
    session.history.redo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        reset
    );
    let position = session.history.position();
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::ResetTransform {
            params: vec![P::PositionX, P::PositionY],
            reset_flip: true,
        },
    )
    .unwrap();
    assert_eq!(session.history.position(), position + 1);
    for track in [0, 2] {
        let effects = &mut session.project.timelines[id].tracks[track].clips[0].effects;
        effects
            .transform
            .track_mut(P::Opacity)
            .upsert(40, 30.0, core::Interpolation::Hold);
        effects.blend_mode = core::BlendMode::Screen;
        effects.matte = Some(core::MatteMode::Luma);
    }
    let before = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let position = session.history.position();
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::ResetCompositing {},
    )
    .unwrap();
    assert_eq!(session.history.position(), position + 1);
    assert_eq!(
        session.history.labels().last(),
        Some(core::CommandLabel::BlendMode)
    );
    for track in [0, 2] {
        let effects = &session.project.timelines[id].tracks[track].clips[0].effects;
        assert!(effects.transform.track(P::Opacity).is_constant());
        assert_eq!(effects.transform.track(P::Opacity).default, 100.0);
        assert_eq!(effects.blend_mode, core::BlendMode::Normal);
        assert_eq!(effects.matte, None);
    }
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        before
    );
}

#[test]
fn selected_inspector_gain_uses_audio_primary_and_own_values_for_keys_then_native_reset() {
    let (mut session, id, ids) = selection_fixture();
    for track in [0, 2] {
        session.project.timelines[id].tracks[track].kind = TrackKind::Audio;
    }
    session.project.timelines[id].tracks[0].clips[0]
        .effects
        .gain_db
        .default = -4.0;
    session.project.timelines[id].tracks[2].clips[0]
        .effects
        .gain_db
        .upsert(40, -9.0, core::Interpolation::Hold);
    let original = serde_json::to_value(&session.project.timelines[id]).unwrap();
    selected_edit(&mut session, id, &ids, 108, InspectorEdit::ToggleGainKey {}).unwrap();
    assert_eq!(
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .gain_db
            .keyframe_at(20),
        Some((-4.0, core::Interpolation::Linear))
    );
    assert_eq!(
        session.project.timelines[id].tracks[2].clips[0]
            .effects
            .gain_db
            .keyframe_at(40),
        Some((-9.0, core::Interpolation::Linear))
    );
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        original
    );
    selected_edit(
        &mut session,
        id,
        &ids,
        108,
        InspectorEdit::Gain { value: -12.0 },
    )
    .unwrap();
    assert_eq!(
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .gain_db
            .default,
        -12.0
    );
    assert_eq!(
        session.project.timelines[id].tracks[2].clips[0]
            .effects
            .gain_db
            .default,
        0.0
    );
    assert_eq!(
        session.project.timelines[id].tracks[2].clips[0]
            .effects
            .gain_db
            .keyframe_at(40),
        Some((-12.0, core::Interpolation::Linear))
    );
    selected_edit(&mut session, id, &ids, 108, InspectorEdit::ResetGain {}).unwrap();
    for track in [0, 2] {
        let values = &session.project.timelines[id].tracks[track].clips[0]
            .effects
            .gain_db;
        assert!(values.is_constant());
        assert_eq!(values.default, 0.0);
    }
}

#[test]
fn selected_inspector_rejects_later_invalid_target_and_malformed_edits_without_any_mutation() {
    use TransformParam as P;
    for case in 0..11 {
        let (mut session, id, mut ids) = selection_fixture();
        let mut frame = 108;
        let edit = match case {
            0 => {
                session.project.timelines[id].tracks[2].locked = true;
                InspectorEdit::Flip {
                    axis: 0,
                    enabled: true,
                }
            }
            1 => {
                session.project.timelines[id].tracks[2].kind = TrackKind::Audio;
                InspectorEdit::Flip {
                    axis: 0,
                    enabled: true,
                }
            }
            2 => {
                ids.push(format!("0{}", ids[1]));
                InspectorEdit::Flip {
                    axis: 0,
                    enabled: true,
                }
            }
            3 => InspectorEdit::Transform {
                parameters: vec![
                    Parameter {
                        param: P::PositionX,
                        value: 15.0,
                    },
                    Parameter {
                        param: P::PositionX,
                        value: 20.0,
                    },
                ],
            },
            4 => InspectorEdit::Flip {
                axis: 2,
                enabled: true,
            },
            5 => {
                frame = -1;
                InspectorEdit::ResetCompositing {}
            }
            6 => InspectorEdit::ResetTransform {
                params: vec![],
                reset_flip: false,
            },
            7 => {
                session.project.timelines[id].tracks[2].clips[0]
                    .effects
                    .transform
                    .track_mut(P::PositionX)
                    .default = 999_999.0;
                InspectorEdit::Transform {
                    parameters: vec![Parameter {
                        param: P::PositionX,
                        value: 7.0,
                    }],
                }
            }
            8 => {
                session.project.timelines[id].tracks[2].clips[0]
                    .effects
                    .transform
                    .track_mut(P::CropRight)
                    .default = 600.0;
                InspectorEdit::Transform {
                    parameters: vec![Parameter {
                        param: P::CropLeft,
                        value: 50.0,
                    }],
                }
            }
            9 => InspectorEdit::Transform {
                parameters: vec![Parameter {
                    param: P::PositionX,
                    value: f32::NAN,
                }],
            },
            _ => {
                session.project.timelines[id].tracks[0].clips[0]
                    .effects
                    .transform
                    .track_mut(P::CropLeft)
                    .upsert(20, 0.0, core::Interpolation::Linear);
                let peer = &mut session.project.timelines[id].tracks[2].clips[0];
                peer.effects.transform.track_mut(P::CropRight).default = 600.0;
                for (frame, value) in [(30, 50.0), (40, 0.0), (50, 50.0)] {
                    peer.effects.transform.track_mut(P::CropLeft).upsert(
                        frame,
                        value,
                        core::Interpolation::Linear,
                    );
                }
                InspectorEdit::ToggleTransformKeys {
                    params: vec![P::CropLeft],
                }
            }
        };
        let before = serde_json::to_value(&session.project).unwrap();
        let position = session.history.position();
        let generation = session.history.generation();
        assert!(
            selected_edit(&mut session, id, &ids, frame, edit).is_err(),
            "case {case}"
        );
        assert_eq!(
            serde_json::to_value(&session.project).unwrap(),
            before,
            "case {case}"
        );
        assert_eq!(session.history.position(), position);
        assert_eq!(session.history.generation(), generation);
    }
    for value in [
        json!({"action":"toggle_gain_key","value":1}),
        json!({"action":"reset_gain","extra":true}),
        json!({"action":"reset_compositing","params":[]}),
        json!({"action":"flip","axis":"horizontal","enabled":true}),
        json!({"action":"gain","value":1,"extra":false}),
    ] {
        assert!(
            serde_json::from_value::<InspectorEdit>(value.clone()).is_err(),
            "{value}"
        );
    }
}

#[test]
fn inspector_key_flags_use_actual_current_keys_after_the_truncated_summary() {
    let (mut session, id, raw) = fixture();
    let clip = &mut session.project.timelines[id].tracks[0].clips[0];
    *clip = Clip::from_source_range(
        clip.id,
        ClipSource::SolidColor,
        12,
        60,
        100,
        Rational::new(2, 1),
    );
    clip.freeze = Some(7);
    for frame in 12..50 {
        clip.effects
            .transform
            .track_mut(TransformParam::Opacity)
            .upsert(frame, 80.0, core::Interpolation::Hold);
        clip.effects
            .gain_db
            .upsert(frame, -3.0, core::Interpolation::Hold);
    }
    for frame in [10, 100] {
        clip.effects
            .transform
            .track_mut(TransformParam::Opacity)
            .upsert(frame, 70.0, core::Interpolation::Hold);
        clip.effects
            .gain_db
            .upsert(frame, -2.0, core::Interpolation::Hold);
    }
    let current = detail(&session, id, &raw, 160).unwrap();
    assert_eq!(current["source_frame"], 42);
    let opacity = current["transform"]
        .as_array()
        .unwrap()
        .iter()
        .find(|value| value["param"] == "Opacity")
        .unwrap();
    assert_eq!(opacity["keyframes"].as_array().unwrap().len(), 16);
    assert_eq!(opacity["on_keyframe"], true);
    assert_eq!(current["gain"]["on_keyframe"], true);
    assert_eq!(
        opacity["keyframe_info"],
        json!({"on_keyframe":true,"previous_frame":158,"next_frame":162})
    );
    assert_eq!(current["gain"]["keyframe_info"], opacity["keyframe_info"]);
    let first = detail(&session, id, &raw, 0).unwrap();
    assert_eq!(
        first["gain"]["keyframe_info"],
        json!({"on_keyframe":true,"previous_frame":null,"next_frame":102})
    );
    let last = detail(&session, id, &raw, 1_000).unwrap();
    assert_eq!(
        last["gain"]["keyframe_info"],
        json!({"on_keyframe":false,"previous_frame":174,"next_frame":null})
    );
}

fn batch_compositing_fixture() -> (Session, TimelineId, Vec<String>, String) {
    let (mut session, timeline, solid) = fixture();
    session.project.timelines[timeline]
        .tracks
        .extend([Track::new(TrackKind::Video), Track::new(TrackKind::Video)]);
    let mut selected = vec![solid];
    for (track, source, start) in [(2, ClipSource::Text, 12), (3, ClipSource::Adjustment, 24)] {
        let mut clip = Clip::from_source_range(
            session.project.alloc_clip_id(),
            source,
            4,
            28,
            start,
            Rational::one(),
        );
        if matches!(clip.source, ClipSource::Text) {
            clip.effects.title = Some(core::TitleParams::default());
        }
        clip.fade_in = 2;
        clip.effects
            .transform
            .track_mut(TransformParam::PositionX)
            .upsert(5, 8.0, core::Interpolation::Linear);
        selected.push(clip.id.0.to_string());
        session.project.timelines[timeline].tracks[track].insert_sorted(clip);
    }
    let group = session.project.alloc_link_group_id();
    session.project.timelines[timeline].tracks[0].clips[0].linked_group = Some(group);
    let mut audio = Clip::from_source_range(
        session.project.alloc_clip_id(),
        ClipSource::Media(core::MediaId::from_raw(999)),
        7,
        55,
        100,
        Rational::one(),
    );
    audio.linked_group = Some(group);
    audio.effects.gain_db.default = -6.0;
    let peer = audio.id.0.to_string();
    session.project.timelines[timeline].tracks[1].insert_sorted(audio);
    session.project.timelines[timeline].tracks[1].locked = true;
    (session, timeline, selected, peer)
}

#[test]
fn batch_compositing_changes_only_explicit_video_targets_as_one_native_undo() {
    let (mut session, timeline, selected, peer) = batch_compositing_fixture();
    let before = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    let generation = session.history.generation();
    let patch = Properties {
        blend: Some(core::BlendMode::Screen),
        matte: Some("AlphaInverted".into()),
        ..Default::default()
    };
    let mut expected = session.project.clone();
    for raw in &selected {
        let (track, id, _) = find(&session, timeline, raw).unwrap();
        let clip = expected.timelines[timeline].clip_mut(track, id).unwrap();
        clip.effects.blend_mode = core::BlendMode::Screen;
        clip.effects.matte = Some(core::MatteMode::AlphaInverted);
    }
    properties_batch(&mut session, timeline, &selected, &patch).unwrap();
    assert_eq!(session.history.position(), position + 1);
    assert_eq!(session.history.generation(), generation + 1);
    assert_eq!(
        session.history.labels().last(),
        Some(CommandLabel::Transform)
    );
    assert_eq!(
        serde_json::to_value(&session.project).unwrap(),
        serde_json::to_value(&expected).unwrap()
    );
    assert_eq!(
        find(&session, timeline, &peer)
            .unwrap()
            .2
            .effects
            .blend_mode,
        core::BlendMode::Normal
    );
    let after = serde_json::to_value(&session.project).unwrap();
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    session.history.redo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), after);
    let clear = Properties {
        matte: Some("None".into()),
        ..Default::default()
    };
    properties_batch(&mut session, timeline, &selected, &clear).unwrap();
    for raw in &selected {
        let (_, _, clip) = find(&session, timeline, raw).unwrap();
        assert_eq!(clip.effects.matte, None);
        assert_eq!(clip.effects.blend_mode, core::BlendMode::Screen);
    }
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), after);
}

#[test]
fn batch_compositing_rejects_invalid_targets_and_unrelated_properties_atomically() {
    let (mut session, timeline, selected, peer) = batch_compositing_fixture();
    let patch = Properties {
        blend: Some(core::BlendMode::Multiply),
        ..Default::default()
    };
    let mut assert_refused = |ids: &[String], patch: &Properties| {
        let before = serde_json::to_value(&session.project).unwrap();
        let generation = session.history.generation();
        let position = session.history.position();
        assert!(properties_batch(&mut session, timeline, ids, patch).is_err());
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
        assert_eq!(session.history.generation(), generation);
        assert_eq!(session.history.position(), position);
    };
    for invalid in [
        vec![],
        vec![selected[0].clone(); 4097],
        vec![selected[0].clone(), selected[0].clone()],
        vec![selected[0].clone(), format!("0{}", selected[0])],
        vec![selected[0].clone(), "18446744073709551615".into()],
        vec![selected[0].clone(), "not-an-id".into()],
        vec![selected[0].clone(), peer.clone()],
    ] {
        assert_refused(&invalid, &patch);
    }
    for value in [
        json!({}),
        json!({"matte":"alpha"}),
        json!({"blend":"Screen","transform":[{"param":"PositionX","value":1.0}]}),
        json!({"blend":"Screen","flip":[false,true]}),
        json!({"blend":"Screen","gain_db":-3.0}),
        json!({"blend":"Screen","color":{"r":1.0,"g":0.0,"b":0.0,"a":1.0}}),
        json!({"blend":"Screen","fade_in":0}),
        json!({"blend":"Screen","fade_out":0}),
        json!({"blend":"Screen","title":{}}),
    ] {
        assert_refused(
            &selected,
            &serde_json::from_value::<Properties>(value).unwrap(),
        );
    }
    session.project.timelines[timeline].tracks[2].locked = true;
    let before = serde_json::to_value(&session.project).unwrap();
    let generation = session.history.generation();
    assert_eq!(
        properties_batch(&mut session, timeline, &selected, &patch)
            .unwrap_err()
            .1,
        "TRACK_LOCKED"
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    assert_eq!(session.history.generation(), generation);
    session.project.timelines[timeline].tracks[1].locked = false;
    let before = serde_json::to_value(&session.project).unwrap();
    assert!(
        properties_batch(&mut session, timeline, &[selected[0].clone(), peer], &patch).is_err()
    );
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
}

#[test]
fn batch_compositing_dto_preserves_native_enum_and_unknown_field_validation() {
    for value in [
        json!({"kind":"set_properties_batch","clip_ids":["0"],"patch":{"blend":"screen"}}),
        json!({"kind":"set_properties_batch","clip_ids":["0"],"patch":{"blend":"Screen","unknown":true}}),
        json!({"kind":"set_properties_batch","clip_ids":["0"],"patch":{"blend":"Screen"},"unknown":true}),
        json!({"kind":"set_properties_batch","clip_ids":[0],"patch":{"matte":"None"}}),
    ] {
        assert!(serde_json::from_value::<crate::commands::Operation>(value).is_err());
    }
    assert!(
        serde_json::from_value::<crate::commands::Operation>(
            json!({"kind":"set_properties","clip_id":"0","patch":{"blend":"Screen"}})
        )
        .is_ok()
    );
}
#[test]
fn viewer_transform_mixes_defaults_and_animated_keys_as_one_native_undo() {
    let (mut session, id, raw) = fixture();
    session.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform
        .track_mut(TransformParam::PositionY)
        .upsert(20, 5.0, core::Interpolation::Hold);
    let original = serde_json::to_value(&session.project.timelines[id]).unwrap();
    let position = session.history.position();
    crate::commands::apply(
        &mut session,
        id,
        &crate::commands::Operation::EditViewerTransform {
            clip_id: raw.clone(),
            timeline_frame: 108,
            transform: vec![
                Parameter {
                    param: TransformParam::PositionY,
                    value: 15.0,
                },
                Parameter {
                    param: TransformParam::PositionX,
                    value: 30.0,
                },
            ],
        },
    )
    .unwrap();
    let transform = &session.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform;
    assert_eq!(transform.track(TransformParam::PositionX).default, 30.0);
    assert!(transform.track(TransformParam::PositionX).is_constant());
    assert_eq!(transform.track(TransformParam::PositionY).default, 0.0);
    assert_eq!(
        transform.track(TransformParam::PositionY).keyframe_at(20),
        Some((15.0, core::Interpolation::Linear))
    );
    assert_eq!(session.history.position(), position + 1);
    session.history.undo(&mut session.project);
    assert_eq!(
        serde_json::to_value(&session.project.timelines[id]).unwrap(),
        original
    );
    session.history.redo(&mut session.project);
    assert_eq!(
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .transform
            .value_at(20)
            .position,
        [30.0, 15.0]
    );
}

#[test]
fn viewer_transform_replaces_existing_interpolation_with_desktop_linear_and_undo_restores_it() {
    for interpolation in [
        core::Interpolation::Hold,
        core::Interpolation::Bezier {
            c1: [0.2, 0.1],
            c2: [0.8, 0.9],
        },
    ] {
        let (mut session, id, raw) = fixture();
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .transform
            .track_mut(TransformParam::ZoomX)
            .upsert(20, 2.0, interpolation);
        let original = serde_json::to_value(&session.project).unwrap();
        viewer_transform(
            &mut session,
            id,
            &raw,
            108,
            &[Parameter {
                param: TransformParam::ZoomX,
                value: 1.5,
            }],
        )
        .unwrap();
        let track = session.project.timelines[id].tracks[0].clips[0]
            .effects
            .transform
            .track(TransformParam::ZoomX);
        assert_eq!(track.keyframes().len(), 1);
        assert_eq!(
            track.keyframe_at(20),
            Some((1.5, core::Interpolation::Linear))
        );
        session.history.undo(&mut session.project);
        assert_eq!(serde_json::to_value(&session.project).unwrap(), original);
    }
}

#[test]
fn viewer_transform_adds_keys_using_native_offset_rate_mapping_even_with_a_frozen_picture() {
    for (rate, expected) in [
        (Rational::one(), 20),
        (Rational::new(2, 1), 10),
        (Rational::new(1, 2), 40),
    ] {
        let (mut session, id, raw) = fixture();
        let clip = &mut session.project.timelines[id].tracks[0].clips[0];
        clip.conform(rate);
        clip.freeze = Some(3);
        clip.effects
            .transform
            .track_mut(TransformParam::Rotation)
            .upsert(0, 0.0, core::Interpolation::Hold);
        clip.effects
            .transform
            .track_mut(TransformParam::Rotation)
            .upsert(100, 0.0, core::Interpolation::Hold);
        assert_eq!(clip.source_frame_at(108), expected);
        assert_eq!(clip.picture_frame_at(108), 3);
        let original = serde_json::to_value(&session.project).unwrap();
        viewer_transform(
            &mut session,
            id,
            &raw,
            108,
            &[Parameter {
                param: TransformParam::Rotation,
                value: 45.0,
            }],
        )
        .unwrap();
        let clip = &session.project.timelines[id].tracks[0].clips[0];
        let track = clip.effects.transform.track(TransformParam::Rotation);
        assert_eq!(
            track.keyframe_at(expected),
            Some((45.0, core::Interpolation::Linear))
        );
        assert_eq!(track.keyframe_at(3), None);
        assert_eq!(clip.freeze, Some(3));
        session.history.undo(&mut session.project);
        assert_eq!(serde_json::to_value(&session.project).unwrap(), original);
    }
}

#[test]
fn viewer_transform_noop_preserves_history_and_existing_interpolation() {
    let (mut session, id, raw) = fixture();
    let transform = &mut session.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform;
    transform.track_mut(TransformParam::PositionX).default = 1_000_000.0;
    transform
        .track_mut(TransformParam::ZoomX)
        .upsert(20, 1.25, core::Interpolation::Hold);
    let original = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    viewer_transform(
        &mut session,
        id,
        &raw,
        108,
        &[
            Parameter {
                param: TransformParam::PositionX,
                value: 1_000_000.0,
            },
            Parameter {
                param: TransformParam::ZoomX,
                value: 1.25,
            },
        ],
    )
    .unwrap();
    assert_eq!(session.history.position(), position);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), original);
}

#[test]
fn viewer_crop_rejects_erased_source_axes_using_evaluated_opposite_sides_without_partial_edits() {
    let (mut session, id, raw) = fixture();
    session.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform
        .track_mut(TransformParam::CropRight)
        .upsert(20, 100.0, core::Interpolation::Hold);
    let original = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    let revision = session.timeline_revision(id);
    for crop in [
        vec![Parameter {
            param: TransformParam::CropLeft,
            value: 640.0,
        }],
        vec![Parameter {
            param: TransformParam::CropLeft,
            value: 540.0,
        }],
        vec![Parameter {
            param: TransformParam::CropTop,
            value: 360.0,
        }],
        vec![
            Parameter {
                param: TransformParam::CropLeft,
                value: 400.0,
            },
            Parameter {
                param: TransformParam::CropRight,
                value: 240.0,
            },
        ],
        vec![
            Parameter {
                param: TransformParam::CropTop,
                value: 200.0,
            },
            Parameter {
                param: TransformParam::CropBottom,
                value: 160.0,
            },
        ],
    ] {
        let mut parameters = vec![Parameter {
            param: TransformParam::PositionX,
            value: 40.0,
        }];
        parameters.extend(crop);
        assert!(viewer_transform(&mut session, id, &raw, 108, &parameters).is_err());
        assert_eq!(serde_json::to_value(&session.project).unwrap(), original);
        assert_eq!(session.history.position(), position);
        assert_eq!(session.timeline_revision(id), revision);
    }
}

#[test]
fn viewer_crop_validates_joint_result_and_allows_one_source_pixel_on_each_axis() {
    let (mut session, id, raw) = fixture();
    let transform = &mut session.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform;
    transform
        .track_mut(TransformParam::CropRight)
        .upsert(20, 500.0, core::Interpolation::Hold);
    transform.track_mut(TransformParam::CropBottom).default = 300.0;
    let original = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    viewer_transform(
        &mut session,
        id,
        &raw,
        108,
        &[
            Parameter {
                param: TransformParam::CropLeft,
                value: 400.0,
            },
            Parameter {
                param: TransformParam::CropTop,
                value: 200.0,
            },
            Parameter {
                param: TransformParam::CropRight,
                value: 239.0,
            },
            Parameter {
                param: TransformParam::CropBottom,
                value: 159.0,
            },
        ],
    )
    .unwrap();
    let transform = &session.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform;
    assert_eq!(transform.value_at(20).crop, [400.0, 200.0, 239.0, 159.0]);
    assert_eq!(
        transform.track(TransformParam::CropRight).keyframe_at(20),
        Some((239.0, core::Interpolation::Linear))
    );
    assert_eq!(session.history.position(), position + 1);
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), original);
}

#[test]
fn viewer_transform_validates_every_axis_frame_and_track_before_mutation() {
    let (mut session, id, raw) = fixture();
    let original = serde_json::to_value(&session.project).unwrap();
    let position = session.history.position();
    for parameters in [
        vec![],
        vec![
            Parameter {
                param: TransformParam::PositionX,
                value: 5.0
            };
            12
        ],
        vec![
            Parameter {
                param: TransformParam::PositionX,
                value: 5.0,
            },
            Parameter {
                param: TransformParam::PositionX,
                value: 10.0,
            },
        ],
        vec![
            Parameter {
                param: TransformParam::PositionX,
                value: 5.0,
            },
            Parameter {
                param: TransformParam::Opacity,
                value: 50.0,
            },
        ],
        vec![
            Parameter {
                param: TransformParam::PositionX,
                value: 5.0,
            },
            Parameter {
                param: TransformParam::CropSoftness,
                value: 1.0,
            },
        ],
        vec![
            Parameter {
                param: TransformParam::PositionX,
                value: 5.0,
            },
            Parameter {
                param: TransformParam::ZoomY,
                value: f32::NAN,
            },
        ],
        vec![
            Parameter {
                param: TransformParam::PositionX,
                value: 5.0,
            },
            Parameter {
                param: TransformParam::ZoomY,
                value: f32::INFINITY,
            },
        ],
        vec![
            Parameter {
                param: TransformParam::PositionX,
                value: 5.0,
            },
            Parameter {
                param: TransformParam::ZoomY,
                value: 21.0,
            },
        ],
    ] {
        assert!(viewer_transform(&mut session, id, &raw, 108, &parameters).is_err());
        assert_eq!(session.history.position(), position);
        assert_eq!(serde_json::to_value(&session.project).unwrap(), original);
    }
    let parameters = [Parameter {
        param: TransformParam::PositionX,
        value: 5.0,
    }];
    for frame in [99, 148, i64::MAX] {
        assert!(viewer_transform(&mut session, id, &raw, frame, &parameters).is_err());
    }
    session.project.timelines[id].tracks[0].locked = true;
    assert_eq!(
        viewer_transform(&mut session, id, &raw, 108, &parameters)
            .unwrap_err()
            .1,
        "TRACK_LOCKED"
    );
    session.project.timelines[id].tracks[0].locked = false;
    let clip = session.project.timelines[id].tracks[0].clips.remove(0);
    session.project.timelines[id].tracks[1].insert_sorted(clip);
    let audio = serde_json::to_value(&session.project).unwrap();
    assert!(viewer_transform(&mut session, id, &raw, 108, &parameters).is_err());
    assert_eq!(session.history.position(), position);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), audio);
}
#[test]
fn properties_validate_every_field_before_mutation_and_undo_as_one_step() {
    let (mut session, id, clip) = fixture();
    let position = session.history.position();
    let original = serde_json::to_value(&session.project).unwrap();
    let mut patch = Properties {
        transform: vec![Parameter {
            param: TransformParam::PositionX,
            value: 30.0,
        }],
        fade_in: Some(1000),
        ..Default::default()
    };
    assert!(properties(&mut session, id, &clip, &patch).is_err());
    assert_eq!(serde_json::to_value(&session.project).unwrap(), original);
    assert_eq!(session.history.position(), position);
    patch.fade_in = Some(8);
    patch.blend = Some(core::BlendMode::Multiply);
    patch.matte = Some("Luma".into());
    properties(&mut session, id, &clip, &patch).unwrap();
    assert_eq!(session.history.position(), position + 1);
    let detail = detail(&session, id, &clip, 108).unwrap();
    assert_eq!(detail["transform"][2]["default"], 30.0);
    assert_eq!(detail["blend"], "Multiply");
    assert_eq!(detail["matte"], "Luma");
    assert_eq!(detail["fade_in"], 8);
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), original);
    session.history.redo(&mut session.project);
    session.project.timelines[id].tracks[0].locked = true;
    assert_eq!(
        properties(&mut session, id, &clip, &patch).unwrap_err().1,
        "TRACK_LOCKED"
    );
}
#[test]
fn keyframes_map_timeline_to_native_source_frames_and_restore_interpolation() {
    let (mut session, id, clip) = fixture();
    let edit = |frame, value| Keyframe {
        target: Target::Transform {
            param: TransformParam::Opacity,
        },
        timeline_frame: frame,
        value,
        interpolation: core::Interpolation::EaseInOut,
    };
    keyframe(&mut session, id, &clip, &edit(108, Some(50.0))).unwrap();
    let values = detail(&session, id, &clip, 108).unwrap();
    assert_eq!(values["source_frame"], 20);
    assert_eq!(
        values["transform"][12]["keyframes"][0],
        json!([20, 50.0, "EaseInOut"])
    );
    let before = session.history.position();
    assert!(keyframe(&mut session, id, &clip, &edit(99, Some(50.0))).is_err());
    assert!(keyframe(&mut session, id, &clip, &edit(108, Some(101.0))).is_err());
    assert_eq!(session.history.position(), before);
    keyframe(&mut session, id, &clip, &edit(108, None)).unwrap();
    assert_eq!(
        detail(&session, id, &clip, 108).unwrap()["transform"][12]["keyframes"],
        json!([])
    );
    session.history.undo(&mut session.project);
    assert_eq!(
        detail(&session, id, &clip, 108).unwrap()["transform"][12]["keyframes"][0][2],
        "EaseInOut"
    );
}

#[test]
fn transitions_validate_adjacency_duration_and_restore_native_crossings() {
    let (mut s, id, clip) = fixture();
    let value = core::Transition {
        kind: core::TransitionKind::CrossDissolve,
        duration: 12,
        direction: core::PushDirection::Left,
        ease: core::Ease::None,
        curve: 0.5,
    };
    assert!(
        transition(
            &mut s,
            id,
            &clip,
            TransitionSlot::CutAfter,
            &Some(value.clone())
        )
        .is_err()
    );
    let right = s.project.alloc_clip_id();
    s.project.timelines[id].tracks[0].insert_sorted(Clip::from_source_range(
        right,
        ClipSource::SolidColor,
        0,
        24,
        148,
        Rational::one(),
    ));
    let before = s.timeline_revision(id);
    transition(
        &mut s,
        id,
        &clip,
        TransitionSlot::CutAfter,
        &Some(value.clone()),
    )
    .unwrap();
    let crossing = &s.project.timelines[id].tracks[0].crossings[0];
    assert_eq!(crossing.right_clip, right);
    assert_eq!(crossing.transition.duration, 12);
    s.history.undo(&mut s.project);
    assert_eq!(s.timeline_revision(id), before);
    let mut invalid = value.clone();
    invalid.duration = 49;
    assert!(transition(&mut s, id, &clip, TransitionSlot::CutAfter, &Some(invalid)).is_err());
    transition(&mut s, id, &clip, TransitionSlot::In, &Some(value)).unwrap();
    assert_eq!(
        detail(&s, id, &clip, 108).unwrap()["transitions"]["in"]["kind"],
        "CrossDissolve"
    );
    transition(&mut s, id, &clip, TransitionSlot::In, &None).unwrap();
    assert!(detail(&s, id, &clip, 108).unwrap()["transitions"]["in"].is_null());
}

fn transition_noop_state(session: &Session, id: TimelineId) -> Value {
    use sha2::{Digest, Sha256};
    json!({"project_sha256":format!("{:x}",Sha256::digest(serde_json::to_vec(&session.project).unwrap())),
        "generation":session.history.generation(),"revision":session.timeline_revision(id),"unsaved":session.has_unsaved_changes(),
        "position":session.history.position(),"labels":session.history.labels().map(|label|format!("{label:?}")).collect::<Vec<_>>()})
}

#[test]
fn identical_or_absent_transitions_preserve_project_hash_history_and_redo_after_native_undo_redo() {
    use crate::commands::{Operation, apply};
    for slot in [
        TransitionSlot::In,
        TransitionSlot::Out,
        TransitionSlot::CutAfter,
    ] {
        let (mut session, id, raw) = fixture();
        let right = session.project.alloc_clip_id();
        session.project.timelines[id].tracks[0].insert_sorted(Clip::from_source_range(
            right,
            ClipSource::SolidColor,
            0,
            24,
            148,
            Rational::one(),
        ));
        session.sync_timeline_media(id);
        let value = core::Transition {
            kind: core::TransitionKind::Push,
            duration: 13,
            direction: core::PushDirection::Up,
            ease: core::Ease::Out,
            curve: 0.75,
        };
        let operation = |transition| Operation::SetTransition {
            clip_id: raw.clone(),
            slot,
            transition,
        };
        let before = transition_noop_state(&session, id);
        apply(&mut session, id, &operation(None)).unwrap();
        assert_eq!(transition_noop_state(&session, id), before);
        let steps = session.history.position();
        apply(&mut session, id, &operation(Some(value.clone()))).unwrap();
        assert_eq!(session.history.position(), steps + 1);
        let installed = transition_noop_state(&session, id);
        apply(&mut session, id, &operation(Some(value.clone()))).unwrap();
        assert_eq!(transition_noop_state(&session, id), installed);
        apply(&mut session, id, &Operation::Undo).unwrap();
        let undone = transition_noop_state(&session, id);
        apply(&mut session, id, &operation(None)).unwrap();
        assert_eq!(transition_noop_state(&session, id), undone);
        apply(&mut session, id, &Operation::Redo).unwrap();
        let redone = transition_noop_state(&session, id);
        apply(&mut session, id, &operation(Some(value.clone()))).unwrap();
        assert_eq!(transition_noop_state(&session, id), redone);
        apply(&mut session, id, &operation(None)).unwrap();
        apply(&mut session, id, &Operation::Undo).unwrap();
        let removal_undone = transition_noop_state(&session, id);
        apply(&mut session, id, &operation(Some(value))).unwrap();
        assert_eq!(transition_noop_state(&session, id), removal_undone);
        apply(&mut session, id, &Operation::Redo).unwrap();
        let removal_redone = transition_noop_state(&session, id);
        apply(&mut session, id, &operation(None)).unwrap();
        assert_eq!(transition_noop_state(&session, id), removal_redone);
    }
}

#[test]
fn transition_noop_does_not_bypass_slot_lock_shape_duration_or_curve_validation() {
    use crate::commands::{Operation, apply};
    for scenario in 0..7 {
        let (mut session, id, raw) = fixture();
        let mut value = core::Transition {
            kind: core::TransitionKind::CrossDissolve,
            duration: 12,
            direction: core::PushDirection::Right,
            ease: core::Ease::None,
            curve: 0.5,
        };
        match scenario {
            0 => {}
            1 => session.project.timelines[id].tracks[0].locked = true,
            2 => session.project.timelines[id].tracks[0].kind = TrackKind::Audio,
            3 => session.project.timelines[id].tracks[0].clips[0].source = ClipSource::Adjustment,
            4 => value.duration = 49,
            5 => value.curve = 1.1,
            _ => session.project.timelines[id].tracks[0].locked = true,
        }
        let transition = (scenario >= 4).then_some(value);
        session.project.timelines[id].tracks[0].clips[0]
            .effects
            .transition_in = transition.clone();
        let before = transition_noop_state(&session, id);
        assert!(
            apply(
                &mut session,
                id,
                &Operation::SetTransition {
                    clip_id: raw,
                    slot: if scenario == 0 {
                        TransitionSlot::CutAfter
                    } else {
                        TransitionSlot::In
                    },
                    transition
                }
            )
            .is_err(),
            "scenario {scenario}"
        );
        assert_eq!(
            transition_noop_state(&session, id),
            before,
            "scenario {scenario}"
        );
    }
}

#[test]
fn title_edits_preserve_animation_and_validate_before_atomic_apply() {
    let (mut s, id, raw) = fixture();
    let clip = &mut s.project.timelines[id].tracks[0].clips[0];
    clip.source = ClipSource::Text;
    clip.effects.title = Some(core::TitleParams::default());
    clip.effects.title.as_mut().unwrap().content.upsert(
        20,
        "Animated title".into(),
        core::Interpolation::Hold,
    );
    let before = s.timeline_revision(id);
    let mut patch = Properties {
        title: Some(TitleEdit {
            text: Some("New default".into()),
            size: Some(80.0),
            font_weight: Some(700),
            ..Default::default()
        }),
        ..Default::default()
    };
    properties(&mut s, id, &raw, &patch).unwrap();
    let current = detail(&s, id, &raw, 108).unwrap();
    assert_eq!(current["title"]["content"]["default"], "New default");
    assert_eq!(
        current["title"]["content"]["keyframes"][0][1],
        "Animated title"
    );
    assert_eq!(current["title"]["size"], 80.0);
    s.history.undo(&mut s.project);
    assert_eq!(s.timeline_revision(id), before);
    patch.title.as_mut().unwrap().size = Some(f32::INFINITY);
    assert!(properties(&mut s, id, &raw, &patch).is_err());
    assert_eq!(s.timeline_revision(id), before);
}

#[test]
fn joint_keyframes_validate_the_entire_gesture_before_creating_one_history_step() {
    let (mut s, id, clip) = fixture();
    let before = s.timeline_revision(id);
    let position = s.history.position();
    let edit = |param, value| Keyframe {
        target: Target::Transform { param },
        timeline_frame: 108,
        value: Some(value),
        interpolation: core::Interpolation::Linear,
    };
    assert!(
        keyframes(
            &mut s,
            id,
            &clip,
            &[
                edit(TransformParam::PositionX, 20.0),
                edit(TransformParam::Opacity, 101.0)
            ]
        )
        .is_err()
    );
    assert_eq!(s.timeline_revision(id), before);
    assert_eq!(s.history.position(), position);
    keyframes(
        &mut s,
        id,
        &clip,
        &[
            edit(TransformParam::PositionX, 20.0),
            edit(TransformParam::Opacity, 50.0),
        ],
    )
    .unwrap();
    assert_eq!(s.history.position(), position + 1);
    s.history.undo(&mut s.project);
    assert_eq!(s.timeline_revision(id), before);
}
