use super::*;
fn fixture() -> (Session, TimelineId, String) {
    let mut s = Session::default();
    let id = s.create_timeline(core::Timeline {
        name: "Filters".into(),
        fps: core::Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![core::Track::new(core::TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let clip = s.project.alloc_clip_id();
    s.project.timelines[id].tracks[0].insert_sorted(core::Clip::from_source_range(
        clip,
        core::ClipSource::SolidColor,
        0,
        48,
        0,
        core::Rational::one(),
    ));
    (s, id, clip.0.to_string())
}
#[test]
fn native_grade_presets_preserve_unrelated_animation_and_undo_exactly() {
    let (mut s, id, raw) = fixture();
    edit(
        &mut s,
        id,
        &raw,
        &FilterEdit::Add {
            filter: FilterKind::ColorCorrection,
        },
    )
    .unwrap();
    let filters = &mut s.project.timelines[id].tracks[0].clips[0].effects.filters;
    filters[0]
        .grade
        .track_mut(core::GradeParam::ShadowsX)
        .upsert(12, 0.2, core::Interpolation::Hold);
    filters[0]
        .grade
        .track_mut(core::GradeParam::Saturation)
        .upsert(12, 1.3, core::Interpolation::Linear);
    filters.push(core::ClipFilter::new(FilterKind::Exposure));
    let before = filters.clone();
    let position = s.history.position();
    apply_preset(&mut s, id, &raw, "BlackAndWhite").unwrap();
    assert_eq!(s.history.position(), position + 1);
    let current = &s.project.timelines[id].tracks[0].clips[0].effects.filters;
    assert_eq!(
        current[0].grade.track(core::GradeParam::ShadowsX),
        before[0].grade.track(core::GradeParam::ShadowsX)
    );
    assert_eq!(
        current[0].grade.track(core::GradeParam::Saturation),
        &core::Keyframed::constant(0.0)
    );
    assert_eq!(current[1], before[1]);
    let black_white = current.clone();
    apply_preset(&mut s, id, &raw, "Neutral").unwrap();
    assert_eq!(
        s.project.timelines[id].tracks[0].clips[0].effects.filters[0].grade,
        core::GradeTracks::default()
    );
    s.history.undo(&mut s.project);
    assert_eq!(
        s.project.timelines[id].tracks[0].clips[0].effects.filters,
        black_white
    );
    s.history.undo(&mut s.project);
    assert_eq!(
        s.project.timelines[id].tracks[0].clips[0].effects.filters,
        before
    );
    assert!(apply_preset(&mut s, id, &raw, "Unknown").is_err());
    assert_eq!(s.history.position(), position);
    s.project.timelines[id].tracks[0].locked = true;
    assert_eq!(
        apply_preset(&mut s, id, &raw, "Neutral").unwrap_err().1,
        "TRACK_LOCKED"
    );
}
#[test]
fn automatic_grade_values_use_native_source_keys_and_one_atomic_undo() {
    let (mut session, id, raw) = fixture();
    edit(
        &mut session,
        id,
        &raw,
        &FilterEdit::Add {
            filter: FilterKind::ColorCorrection,
        },
    )
    .unwrap();
    session.project.timelines[id].tracks[0].clips[0].source_offset = 7;
    crate::inspector::keyframe(
        &mut session,
        id,
        &raw,
        &crate::inspector::Keyframe {
            target: crate::inspector::Target::Grade {
                param: core::GradeParam::MidtonesLuma,
            },
            timeline_frame: 12,
            value: Some(0.25),
            interpolation: core::Interpolation::Hold,
        },
    )
    .unwrap();
    let before = serde_json::to_value(&session.project).unwrap();
    let history = session.history.position();
    apply_grade_at_frame(
        &mut session,
        id,
        &raw,
        6,
        &[
            GradeValue {
                param: core::GradeParam::MidtonesX,
                value: 0.2,
            },
            GradeValue {
                param: core::GradeParam::MidtonesY,
                value: -0.1,
            },
            GradeValue {
                param: core::GradeParam::ShadowsX,
                value: 0.25,
            },
        ],
    )
    .unwrap();
    assert_eq!(session.history.position(), history + 1);
    let grade = &session.project.timelines[id].tracks[0].clips[0]
        .effects
        .filters[0]
        .grade;
    assert_eq!(grade.track(core::GradeParam::MidtonesX).default, 0.0);
    assert_eq!(grade.track(core::GradeParam::MidtonesX).value_at(13), 0.2);
    assert!(
        grade
            .track(core::GradeParam::MidtonesY)
            .keyframe_at(13)
            .is_some()
    );
    assert_eq!(
        grade.track(core::GradeParam::MidtonesLuma).keyframes(),
        &[(19, 0.25, core::Interpolation::Hold)]
    );
    assert!(grade.track(core::GradeParam::ShadowsX).is_constant());
    assert_eq!(grade.track(core::GradeParam::ShadowsX).default, 0.25);
    session.history.undo(&mut session.project);
    assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
    for values in [
        vec![],
        vec![GradeValue {
            param: core::GradeParam::ShadowsX,
            value: 2.0,
        }],
        vec![
            GradeValue {
                param: core::GradeParam::ShadowsX,
                value: 0.9,
            },
            GradeValue {
                param: core::GradeParam::ShadowsY,
                value: 0.9,
            },
        ],
        vec![
            GradeValue {
                param: core::GradeParam::Saturation,
                value: 1.0,
            },
            GradeValue {
                param: core::GradeParam::Saturation,
                value: 1.0,
            },
        ],
    ] {
        assert!(apply_grade_at_frame(&mut session, id, &raw, 6, &values).is_err());
        assert_eq!(serde_json::to_value(&session.project).unwrap(), before);
        assert_eq!(session.history.position(), history);
    }
    let values = [GradeValue {
        param: core::GradeParam::ShadowsX,
        value: 0.2,
    }];
    assert!(apply_grade_at_frame(&mut session, id, &raw, 48, &values).is_err());
    session.project.timelines[id].tracks[0].locked = true;
    assert_eq!(
        apply_grade_at_frame(&mut session, id, &raw, 6, &values)
            .unwrap_err()
            .1,
        "TRACK_LOCKED"
    );
}
#[test]
fn filter_patches_are_atomic_and_preserve_native_grade_animation() {
    let (mut s, id, clip) = fixture();
    edit(
        &mut s,
        id,
        &clip,
        &FilterEdit::Add {
            filter: FilterKind::Exposure,
        },
    )
    .unwrap();
    let before = s.timeline_revision(id);
    let invalid = FilterPatch {
        enabled: Some(false),
        amount: Some(1.0),
        radius: Some(10.0),
        ..Default::default()
    };
    assert!(
        edit(
            &mut s,
            id,
            &clip,
            &FilterEdit::Set {
                filter: FilterKind::Exposure,
                patch: Box::new(invalid)
            }
        )
        .is_err()
    );
    assert_eq!(s.timeline_revision(id), before);
    edit(
        &mut s,
        id,
        &clip,
        &FilterEdit::Add {
            filter: FilterKind::ColorCorrection,
        },
    )
    .unwrap();
    crate::inspector::keyframe(
        &mut s,
        id,
        &clip,
        &crate::inspector::Keyframe {
            target: crate::inspector::Target::Grade {
                param: core::GradeParam::MidtonesLuma,
            },
            timeline_frame: 12,
            value: Some(0.25),
            interpolation: core::Interpolation::Linear,
        },
    )
    .unwrap();
    let patch = FilterPatch {
        grade: vec![
            GradeValue {
                param: core::GradeParam::ShadowsX,
                value: 0.25,
            },
            GradeValue {
                param: core::GradeParam::ShadowsY,
                value: 0.25,
            },
        ],
        ..Default::default()
    };
    let position = s.history.position();
    edit(
        &mut s,
        id,
        &clip,
        &FilterEdit::Set {
            filter: FilterKind::ColorCorrection,
            patch: Box::new(patch),
        },
    )
    .unwrap();
    assert_eq!(s.history.position(), position + 1);
    let filter = &s.project.timelines[id].tracks[0].clips[0].effects.filters[1];
    assert_eq!(filter.grade.track(core::GradeParam::ShadowsX).default, 0.25);
    assert_eq!(
        filter
            .grade
            .track(core::GradeParam::MidtonesLuma)
            .keyframes()[0]
            .0,
        12
    );
    let invalid = FilterPatch {
        grade: vec![
            GradeValue {
                param: core::GradeParam::ShadowsX,
                value: 1.0,
            },
            GradeValue {
                param: core::GradeParam::ShadowsY,
                value: 1.0,
            },
        ],
        ..Default::default()
    };
    let before = s.timeline_revision(id);
    assert!(
        edit(
            &mut s,
            id,
            &clip,
            &FilterEdit::Set {
                filter: FilterKind::ColorCorrection,
                patch: Box::new(invalid)
            }
        )
        .is_err()
    );
    assert_eq!(s.timeline_revision(id), before);
}
#[test]
fn native_filter_order_remove_undo_and_track_lock_are_respected() {
    let (mut s, id, clip) = fixture();
    for filter in [FilterKind::Exposure, FilterKind::GaussianBlur] {
        edit(&mut s, id, &clip, &FilterEdit::Add { filter }).unwrap();
    }
    edit(
        &mut s,
        id,
        &clip,
        &FilterEdit::Move {
            filter: FilterKind::GaussianBlur,
            to_index: 0,
        },
    )
    .unwrap();
    let before = s.timeline_revision(id);
    assert_eq!(
        s.project.timelines[id].tracks[0].clips[0].effects.filters[0].kind,
        FilterKind::GaussianBlur
    );
    edit(
        &mut s,
        id,
        &clip,
        &FilterEdit::Remove {
            filter: FilterKind::Exposure,
        },
    )
    .unwrap();
    s.history.undo(&mut s.project);
    assert_eq!(s.timeline_revision(id), before);
    s.project.timelines[id].tracks[0].locked = true;
    assert_eq!(
        edit(
            &mut s,
            id,
            &clip,
            &FilterEdit::Remove {
                filter: FilterKind::Exposure
            }
        )
        .unwrap_err()
        .1,
        "TRACK_LOCKED"
    );
}
