use super::*;
use vv_core::{Clip, ClipSource, Rational, Timeline, Track, TrackKind};

#[test]
fn project_view_normalization_prunes_removed_ids_clamps_heads_and_never_changes_edit_state() {
    let mut project = Project::default();
    let make = |name: &str| Timeline {
        name: name.into(),
        fps: Rational::new(24, 1),
        resolution: (16, 16),
        tracks: vec![Track::new(TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    };
    let first = project.timelines.insert(make("First"));
    let empty = project.timelines.insert(make("Empty"));
    let clip = Clip::from_source_range(
        project.alloc_clip_id(),
        ClipSource::SolidColor,
        0,
        24,
        12,
        Rational::one(),
    );
    project.timelines[first].tracks[0].insert_sorted(clip);
    let removed = TimelineId::from_raw(999);
    project.view.active_timeline = Some(removed);
    project
        .view
        .playheads
        .extend([(first, 999), (empty, -4), (removed, 12)]);
    let before = json!(project);
    let (view, revision) = snapshot(&project);
    assert_eq!(view["active_timeline"], Value::Null);
    assert_eq!(view["playheads"][first.raw().to_string()], 36);
    assert_eq!(view["playheads"][empty.raw().to_string()], 0);
    assert_eq!(view["playheads"].as_object().unwrap().len(), 2);
    assert_eq!(json!(project), before);
    let updated = record(&project, first, 18);
    project.view = updated;
    assert_eq!(
        snapshot(&project).0["active_timeline"],
        first.raw().to_string()
    );
    assert_ne!(snapshot(&project).1, revision);
    assert_eq!(record(&project, first, i64::MAX).playheads[&first], 36);
    project.view = record(&project, first, 36);
    assert_eq!(
        snapshot(&project).0["playheads"][first.raw().to_string()],
        36
    );
    assert_eq!(record(&project, empty, 0).playheads[&empty], 0);
}

#[test]
fn project_view_request_rejects_extra_fields_and_requires_the_cas_and_ancestor_array() {
    let value = json!({"client_id":"writer","query":{"timeline_id":"0","project_epoch":"e:1","if_generation":"0","revision":"r","frame":0,"width":16},"if_view_revision":"a".repeat(64),"ancestors":[]});
    assert!(
        !serde_json::from_value::<Request>(value.clone())
            .unwrap()
            .persist
    );
    for field in ["client_id", "query", "if_view_revision", "ancestors"] {
        let mut invalid = value.clone();
        invalid.as_object_mut().unwrap().remove(field);
        assert!(
            serde_json::from_value::<Request>(invalid).is_err(),
            "{field}"
        );
    }
    let mut invalid = value;
    invalid["playheads"] = json!({"0":5});
    assert!(serde_json::from_value::<Request>(invalid).is_err());
}
