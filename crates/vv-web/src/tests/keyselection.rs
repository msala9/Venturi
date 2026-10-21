use super::*;
use vv_core::{ClipSource, Interpolation, Keyframed, Rational, Timeline, Track, TrackKind};

fn fixture() -> (Session, TimelineId, String) {
    let mut s = Session::default();
    let id = s.create_timeline(Timeline {
        name: "Cross parameter keys".into(),
        fps: Rational::new(24, 1),
        resolution: (64, 36),
        tracks: vec![Track::new(TrackKind::Video), Track::new(TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    });
    let raw = s.project.alloc_clip_id();
    let mut clip = Clip::from_source_range(raw, ClipSource::SolidColor, 0, 96, 0, Rational::one());
    for param in [
        TransformParam::ZoomX,
        TransformParam::ZoomY,
        TransformParam::Opacity,
    ] {
        clip.effects
            .transform
            .track_mut(param)
            .upsert(10, 1.0, Interpolation::EaseIn);
    }
    clip.effects.color = Some(Keyframed::constant(core::Rgba::WHITE));
    clip.effects
        .color
        .as_mut()
        .unwrap()
        .upsert(12, core::Rgba::BLACK, Interpolation::Hold);
    clip.effects.title = Some(Default::default());
    clip.effects.title.as_mut().unwrap().content.upsert(
        14,
        "<literal> α".into(),
        Interpolation::Hold,
    );
    let mut blur = core::ClipFilter::new(core::FilterKind::GaussianBlur);
    blur.direction
        .upsert(16, core::BlurDirection::Vertical, Interpolation::EaseOut);
    clip.effects.filters.push(blur);
    s.project.timelines[id].tracks[0].insert_sorted(clip);
    (s, id, raw.0.to_string())
}
fn selection() -> Edit {
    Edit {
        picks: vec![
            Pick {
                target: Target::Scalar(inspector::Target::Transform {
                    param: TransformParam::ZoomX,
                }),
                source_frame: 10,
            },
            Pick {
                target: Target::Scalar(inspector::Target::Transform {
                    param: TransformParam::Opacity,
                }),
                source_frame: 10,
            },
            Pick {
                target: Target::Value(eventkeys::Target::Color),
                source_frame: 12,
            },
            Pick {
                target: Target::Value(eventkeys::Target::Text),
                source_frame: 14,
            },
            Pick {
                target: Target::Value(eventkeys::Target::Direction {
                    filter: core::FilterKind::GaussianBlur,
                }),
                source_frame: 16,
            },
        ],
        link_zoom: true,
        action: Action::Move {
            delta_source_frames: 2,
        },
    }
}
#[test]
fn mixed_targets_and_zoom_twins_use_native_commands_and_restore_exactly_in_one_undo() {
    let (mut s, id, raw) = fixture();
    let before = serde_json::to_value(&s.project).unwrap();
    let position = s.history.position();
    let mut request = selection();
    edit(&mut s, id, &raw, &request).unwrap();
    assert_eq!(s.history.position(), position + 1);
    let clip = inspector::find(&s, id, &raw).unwrap().2;
    for param in [
        TransformParam::ZoomX,
        TransformParam::ZoomY,
        TransformParam::Opacity,
    ] {
        assert_eq!(
            clip.effects.transform.track(param).keyframes(),
            &[(12, 1.0, Interpolation::EaseIn)]
        );
    }
    assert_eq!(
        clip.effects.color.as_ref().unwrap().keyframes(),
        &[(14, core::Rgba::BLACK, Interpolation::Hold)]
    );
    assert_eq!(
        clip.effects.title.as_ref().unwrap().content.keyframes()[0].0,
        16
    );
    assert_eq!(
        clip.effects.title.as_ref().unwrap().content.keyframes()[0].1,
        "<literal> α"
    );
    assert_eq!(clip.effects.filters[0].direction.keyframes()[0].0, 18);
    s.history.undo(&mut s.project);
    assert_eq!(serde_json::to_value(&s.project).unwrap(), before);
    request.action = Action::Interpolation {
        interpolation: Interpolation::Bezier {
            c1: [0.2, -0.1],
            c2: [0.8, 1.1],
        },
    };
    edit(&mut s, id, &raw, &request).unwrap();
    let clip = inspector::find(&s, id, &raw).unwrap().2;
    assert_eq!(
        clip.effects
            .transform
            .track(TransformParam::ZoomY)
            .keyframes()[0]
            .2,
        Interpolation::Bezier {
            c1: [0.2, -0.1],
            c2: [0.8, 1.1]
        }
    );
    assert!(matches!(
        clip.effects.title.as_ref().unwrap().content.keyframes()[0].2,
        Interpolation::Bezier { .. }
    ));
    s.history.undo(&mut s.project);
    assert_eq!(serde_json::to_value(&s.project).unwrap(), before);
    request.action = Action::Delete;
    edit(&mut s, id, &raw, &request).unwrap();
    let clip = inspector::find(&s, id, &raw).unwrap().2;
    assert!(
        clip.effects
            .transform
            .track(TransformParam::ZoomY)
            .keyframes()
            .is_empty()
    );
    assert!(clip.effects.color.as_ref().unwrap().keyframes().is_empty());
    assert!(
        clip.effects
            .title
            .as_ref()
            .unwrap()
            .content
            .keyframes()
            .is_empty()
    );
    assert!(clip.effects.filters[0].direction.keyframes().is_empty());
    assert_eq!(s.project.timelines[id].tracks[0].clips.len(), 1);
    s.history.undo(&mut s.project);
    assert_eq!(serde_json::to_value(&s.project).unwrap(), before);
}
#[test]
fn mixed_selection_rejects_collisions_missing_keys_locks_overflow_and_invalid_controls_atomically()
{
    for case in 0..9 {
        let (mut s, id, raw) = fixture();
        let mut request = selection();
        match case {
            0 => s.project.timelines[id].tracks[0].clips[0]
                .effects
                .transform
                .track_mut(TransformParam::ZoomY)
                .upsert(12, 3.0, Interpolation::Hold),
            1 => request.picks[4].source_frame = 17,
            2 => request.picks.push(request.picks[0].clone()),
            3 => {
                request.action = Action::Move {
                    delta_source_frames: i64::MAX,
                }
            }
            4 => {
                request.action = Action::Move {
                    delta_source_frames: -17,
                }
            }
            5 => s.project.timelines[id].tracks[0].locked = true,
            6 => {
                request.action = Action::Interpolation {
                    interpolation: Interpolation::Bezier {
                        c1: [f32::NAN, 0.0],
                        c2: [0.8, 1.0],
                    },
                }
            }
            7 => request.picks.clear(),
            _ => {
                request.picks[0].target = Target::Scalar(inspector::Target::FilterOffset {
                    filter: core::FilterKind::GaussianBlur,
                    axis: 2,
                })
            }
        }
        let before = serde_json::to_value(&s.project).unwrap();
        let position = s.history.position();
        assert!(edit(&mut s, id, &raw, &request).is_err(), "case {case}");
        assert_eq!(s.history.position(), position, "case {case}");
        assert_eq!(
            serde_json::to_value(&s.project).unwrap(),
            before,
            "case {case}"
        );
    }
}
#[test]
fn zoom_link_ignores_missing_twins_and_zero_delta_has_no_history_step() {
    let (mut s, id, raw) = fixture();
    let mut request = selection();
    s.project.timelines[id].tracks[0].clips[0]
        .effects
        .transform
        .track_mut(TransformParam::ZoomY)
        .remove_at(10);
    request.picks.truncate(1);
    request.action = Action::Move {
        delta_source_frames: 0,
    };
    let position = s.history.position();
    edit(&mut s, id, &raw, &request).unwrap();
    assert_eq!(s.history.position(), position);
    request.action = Action::Move {
        delta_source_frames: 2,
    };
    edit(&mut s, id, &raw, &request).unwrap();
    assert!(
        s.project.timelines[id].tracks[0].clips[0]
            .effects
            .transform
            .track(TransformParam::ZoomY)
            .keyframes()
            .is_empty()
    );
    let serialized = serde_json::to_string(&request).unwrap();
    let decoded: Edit = serde_json::from_str(&serialized).unwrap();
    assert_eq!(decoded.picks.len(), 1);
    let invalid = serialized.replace("\"link_zoom\":true", "\"link_zoom\":true,\"unexpected\":1");
    assert!(serde_json::from_str::<Edit>(&invalid).is_err());
}

#[test]
fn every_advertised_scalar_target_and_mixed_values_share_one_native_move() {
    let (mut s, id, raw) = fixture();
    for kind in [
        core::FilterKind::ColorCorrection,
        core::FilterKind::Exposure,
        core::FilterKind::BoxBlur,
        core::FilterKind::DropShadow,
    ] {
        s.project.timelines[id].tracks[0].clips[0]
            .effects
            .filters
            .push(core::ClipFilter::new(kind));
    }
    crate::masks::edit(
        &mut s,
        id,
        &raw,
        &crate::masks::MaskEdit::Add {
            shape: core::MaskShape::Rectangle,
        },
    )
    .unwrap();
    let detail = curves::detail(&s, id, &s.project.timelines[id].tracks[0].clips[0], 0);
    let mut picks = Vec::new();
    for row in detail["tracks"].as_array().unwrap() {
        let target: inspector::Target = serde_json::from_value(row["target"].clone()).unwrap();
        curves::edit(
            &mut s,
            id,
            &raw,
            &curves::Edit {
                target: target.clone(),
                previous_source_frame: None,
                source_frame: 20,
                value: Some(row["default"].as_f64().unwrap() as f32),
                interpolation: Interpolation::EaseOut,
            },
        )
        .unwrap();
        picks.push(Pick {
            target: Target::Scalar(target),
            source_frame: 20,
        });
    }
    assert!(picks.len() > 40);
    let before = serde_json::to_value(&s.project).unwrap();
    let position = s.history.position();
    edit(
        &mut s,
        id,
        &raw,
        &Edit {
            picks,
            link_zoom: true,
            action: Action::Move {
                delta_source_frames: 2,
            },
        },
    )
    .unwrap();
    assert_eq!(s.history.position(), position + 1);
    let moved = curves::detail(&s, id, &s.project.timelines[id].tracks[0].clips[0], 0);
    for row in moved["tracks"].as_array().unwrap() {
        assert!(
            row["keys"]
                .as_array()
                .unwrap()
                .iter()
                .any(|key| key["source_frame"] == 22)
        );
    }
    s.history.undo(&mut s.project);
    assert_eq!(serde_json::to_value(&s.project).unwrap(), before);
}
