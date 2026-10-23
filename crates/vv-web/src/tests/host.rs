use super::*;

#[test]
fn marked_source_placement_uses_a_ready_file_bound_job_and_replays_receipts_before_revalidation() {
    use vv_core::Id;
    let (root, mut editor, media) = native_asset_fixture("source-placement");
    let timeline = editor.session.project.timelines.iter().next().unwrap().0;
    let path = editor.session.project.media_pool[media].path.clone();
    let sources = crate::source::MediaJobs::start().unwrap();
    let spec = || SourceSpec {
        file: std::fs::File::open(&path).unwrap(),
        epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
        media_id: media.raw().to_string(),
        meta: editor.session.project.media_pool[media].meta.clone(),
    };
    let job = sources
        .prepare_audio(spec(), "low", None, crate::source_audio::AudioMode::All, 0)
        .unwrap();
    let job_id = job["id"].as_str().unwrap().to_owned();
    let version = job["source_version"].as_str().unwrap().to_owned();
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let state = sources.status(&job_id, &spec(), false).unwrap();
        if state["state"] == "ready" {
            break;
        }
        assert!(
            !matches!(state["state"].as_str(), Some("failed" | "canceled")),
            "{state}"
        );
        assert!(
            Instant::now() < deadline,
            "Tiny Source preparation timed out: {state}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    let operation = Operation::PlaceSource {
        media_id: media.raw().to_string(),
        job_id: job_id.clone(),
        source_version: version,
        source_in: 0,
        source_out: 1,
        start_frame: 96,
        target: commands::AssetDropTarget::NewAudioTrack {},
        streams: commands::SourceStreams::All,
        overwrite: false,
    };
    let before = json!(editor.session.project.timelines[timeline]);
    let position = editor.session.history.position();
    let mutation = request(&editor, operation.clone(), "source-place", Some(timeline));
    let ack = editor
        .handle(Action::SourcePlacementMutation(
            timeline.raw().to_string(),
            mutation.clone(),
            sources.clone(),
        ))
        .unwrap();
    assert_eq!(ack["timeline_id"], timeline.raw().to_string());
    assert_eq!(ack["clip_ids"].as_array().unwrap().len(), 1);
    assert_eq!(editor.session.history.position(), position + 1);
    let mut expected_redone = editor.session.project.clone();
    let undo = request(&editor, Operation::Undo, "source-undo", Some(timeline));
    editor
        .mutation(Some(timeline.raw().to_string()), undo)
        .unwrap();
    assert_eq!(json!(editor.session.project.timelines[timeline]), before);
    let redo = request(&editor, Operation::Redo, "source-redo", Some(timeline));
    editor
        .mutation(Some(timeline.raw().to_string()), redo)
        .unwrap();
    // Native history refreshes compound cache generations on both Undo and Redo.
    for _ in 0..2 {
        let compounds: Vec<_> = expected_redone
            .media_pool
            .iter()
            .filter_map(|(id, item)| item.compound.map(|_| id))
            .collect();
        for media in compounds {
            expected_redone.sync_compound_meta(media);
        }
    }
    assert_eq!(json!(editor.session.project), json!(expected_redone));
    let after = json!(editor.session.project);
    std::fs::write(&path, b"source changed after successful placement").unwrap();
    assert_eq!(
        editor
            .handle(Action::SourcePlacementMutation(
                timeline.raw().to_string(),
                mutation,
                sources.clone()
            ))
            .unwrap(),
        ack
    );
    assert_eq!(json!(editor.session.project), after);
    let current = request(&editor, operation.clone(), "source-changed", Some(timeline));
    assert_eq!(
        editor
            .handle(Action::SourcePlacementMutation(
                timeline.raw().to_string(),
                current,
                sources.clone()
            ))
            .unwrap_err()
            .1,
        "SOURCE_CHANGED"
    );
    let bypass = request(&editor, operation, "source-bypass", Some(timeline));
    assert_eq!(
        editor
            .mutation(Some(timeline.raw().to_string()), bypass)
            .unwrap_err()
            .1,
        "SOURCE_PREPARATION_REQUIRED"
    );
    assert_eq!(json!(editor.session.project), after);
    assert_eq!(editor.session.history.position(), position + 1);
    drop(sources);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_set_placement_imports_once_with_one_undo_and_reuses_edited_compounds() {
    use vv_core::{Clip, ClipSource, Id};
    let (root, mut source, media) = native_asset_fixture("drop-set");
    let child = source.session.create_timeline(Timeline {
        name: "Audio child".into(),
        fps: Rational::new(24, 1),
        resolution: (16, 16),
        tracks: vec![Track::new(TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    });
    let clip = source.session.project.alloc_clip_id();
    source.session.project.timelines[child].tracks[0].insert_sorted(Clip::from_source_range(
        clip,
        ClipSource::Media(media),
        0,
        2,
        0,
        Rational::one(),
    ));
    source.session.sync_timeline_media(child);
    let compound = source
        .session
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(child))
        .unwrap()
        .0;
    let compound_revision = native_publish(&mut source, compound, "drop-compound");
    let audio_revision = native_publish(&mut source, media, "drop-audio");
    let references = vec![
        crate::asset_store::ImportRef {
            asset_id: "drop-compound".into(),
            revision: compound_revision,
        },
        crate::asset_store::ImportRef {
            asset_id: "drop-audio".into(),
            revision: audio_revision,
        },
    ];
    let target = root.join("destination");
    let mut editor =
        Editor::with_libraries(&target, &target.join(".presets"), &root.join(".assets")).unwrap();
    let command = request(
        &editor,
        Operation::NewProject {
            name: "destination".into(),
        },
        "drop-project",
        None,
    );
    editor.mutation(None, command).unwrap();
    let timeline = editor.session.project.timelines.keys().next().unwrap();
    let job = native_prepare(
        &mut editor,
        NativeAssetAction::ImportSet {
            assets: references.clone(),
        },
    );
    let ready = native_wait(&mut editor, &job);
    assert_eq!(ready["result"]["file_count"], 1);
    let operation = Operation::PlaceNativeAssets {
        job_id: job["id"].as_str().unwrap().into(),
        assets: references.clone(),
        start_frame: 10,
        target: commands::AssetDropTarget::NewAudioTrack {},
        overwrite: false,
    };
    let before = editor.session.project.clone();
    let position = editor.session.history.position();
    let mut locked = request(&editor, operation.clone(), "drop-locked", Some(timeline));
    if let Operation::PlaceNativeAssets { target, .. } = &mut locked.operation {
        *target = commands::AssetDropTarget::Track {
            track_id: "0".into(),
        };
    }
    editor.session.project.timelines[timeline].tracks[0].locked = true;
    let locked_project = ron::to_string(&editor.session.project).unwrap();
    locked.if_revision = Some(editor.session.timeline_revision(timeline));
    assert_eq!(
        editor
            .mutation(Some(timeline.raw().to_string()), locked)
            .unwrap_err()
            .1,
        "TRACK_LOCKED"
    );
    assert_eq!(
        ron::to_string(&editor.session.project).unwrap(),
        locked_project
    );
    assert_eq!(editor.session.history.position(), position);
    assert!(editor.asset_imports.is_empty());
    editor.session.project.timelines[timeline].tracks[0].locked = false;
    let command = request(&editor, operation, "drop-first", Some(timeline));
    let ack = editor
        .mutation(Some(timeline.raw().to_string()), command.clone())
        .unwrap();
    assert_eq!(ack["timeline_id"], timeline.raw().to_string());
    assert_eq!(ack["media_ids"].as_array().unwrap().len(), 2);
    assert_eq!(ack["clip_ids"].as_array().unwrap().len(), 2);
    assert_eq!(editor.session.history.position(), position + 1);
    let after = editor.session.project.clone();
    assert_eq!(
        editor
            .mutation(Some(timeline.raw().to_string()), command)
            .unwrap(),
        ack
    );
    assert_eq!(editor.session.history.position(), position + 1);
    editor.session.history.undo(&mut editor.session.project);
    // Native command Undo leaves the separately synchronized target cache at its post-edit value.
    let mut expected = before.clone();
    for (media_id, item) in expected.media_pool.iter_mut() {
        if item.compound == Some(timeline) {
            item.content_hash = after.media_pool[media_id].content_hash;
            item.meta = after.media_pool[media_id].meta.clone();
        }
    }
    let before_allocations = serde_json::to_value(&before).unwrap();
    let after_allocations = serde_json::to_value(&after).unwrap();
    let mut expected = serde_json::to_value(&expected).unwrap();
    // Native import/drop reserves IDs and compound generations permanently, including across Undo.
    for (field, additional) in [("media_pool", 2), ("timelines", 1), ("folders", 0)] {
        assert_eq!(
            after_allocations[field]["next"].as_u64().unwrap(),
            before_allocations[field]["next"].as_u64().unwrap() + additional
        );
        expected[field]["next"] = after_allocations[field]["next"].clone();
    }
    for (field, additional) in [
        ("next_clip_id", 3),
        ("next_link_group_id", 0),
        ("next_compound_id", 0),
        ("next_compound_generation", 2),
    ] {
        assert_eq!(
            after_allocations[field].as_u64().unwrap(),
            before_allocations[field].as_u64().unwrap() + additional
        );
        expected[field] = after_allocations[field].clone();
    }
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        expected
    );
    editor.session.history.redo(&mut editor.session.project);
    assert_eq!(
        ron::to_string(&editor.session.project).unwrap(),
        ron::to_string(&after).unwrap()
    );
    let imported =
        vv_core::MediaId::from_raw(ack["media_ids"][0].as_str().unwrap().parse().unwrap());
    editor.session.apply(Box::new(vv_core::RenameTimeline::new(
        imported,
        "Edited child".into(),
    )));
    let imported_child = editor.session.project.media_pool[imported]
        .compound
        .unwrap();
    let video = vv_core::edit::add_track(
        &mut editor.session.project,
        &mut editor.session.history,
        imported_child,
        TrackKind::Video,
    );
    vv_core::edit::insert_generator(
        &mut editor.session.project,
        &mut editor.session.history,
        imported_child,
        vv_core::edit::Generator::SolidColor,
        video,
        0,
        Some(48),
    );
    editor.session.sync_timeline_media(imported_child);
    let generation = editor.session.history.generation();
    let epoch = format!("{}:{}", editor.epoch, editor.session.epoch());
    let effective = editor
        .handle(Action::NativeAssetItem(
            "drop-compound".into(),
            NativeAssetItemQuery {
                project_epoch: epoch.clone(),
                archived: false,
            },
        ))
        .unwrap();
    assert_eq!(effective["placement"]["items"][0]["source_out"], 48);
    assert_eq!(effective["placement"]["items"][0]["has_video"], true);
    assert_eq!(effective["placement"]["items"][0]["has_audio"], true);
    assert_eq!(effective["placement"]["generation"], generation.to_string());
    assert_eq!(effective["placement"]["project_epoch"], epoch);
    let page = editor
        .handle(Action::NativeAssetList(
            0,
            crate::asset_store::Query {
                project_epoch: epoch,
                ..Default::default()
            },
        ))
        .unwrap();
    assert_eq!(page["placement_generation"], generation.to_string());
    assert_eq!(
        page["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == "drop-compound")
            .unwrap()["placement"],
        effective["placement"]
    );
    assert_eq!(editor.session.history.generation(), generation);
    assert_eq!(
        editor.assets.item("drop-compound", false).unwrap()["placement"]["items"][0]["has_video"],
        false
    );
    let count = editor.session.project.timelines.len();
    let job = native_prepare(
        &mut editor,
        NativeAssetAction::ImportSet {
            assets: references.clone(),
        },
    );
    native_wait(&mut editor, &job);
    let operation = Operation::PlaceNativeAssets {
        job_id: job["id"].as_str().unwrap().into(),
        assets: references,
        start_frame: 100,
        target: commands::AssetDropTarget::Track {
            track_id: "1".into(),
        },
        overwrite: false,
    };
    let command = request(&editor, operation, "drop-reuse", Some(timeline));
    let reused = editor
        .mutation(Some(timeline.raw().to_string()), command)
        .unwrap();
    assert_eq!(reused["media_ids"], ack["media_ids"]);
    assert_eq!(editor.session.project.timelines.len(), count);
    assert_eq!(reused["clip_ids"].as_array().unwrap().len(), 3);
    assert_eq!(
        editor.session.project.timelines[editor.session.project.media_pool[imported]
            .compound
            .unwrap()]
        .name,
        "Edited child"
    );
    drop(editor);
    drop(source);
    std::fs::remove_dir_all(root).unwrap();
}

fn take_editor() -> (
    std::path::PathBuf,
    Editor,
    vv_core::TimelineId,
    crate::take::Preview,
) {
    use vv_core::{Clip, ClipSource, Id};
    let (root, mut editor, old) = native_asset_fixture("take-worker");
    std::fs::copy(root.join("capture.wav"), root.join("candidate.wav")).unwrap();
    let (path, meta) = editor.files.probe("candidate.wav").unwrap();
    let media = editor.session.add_media(path, meta);
    let id = editor.session.project.timelines.keys().next().unwrap();
    let clip_id = editor.session.project.alloc_clip_id();
    let rate = Rational::conform_rate(
        editor.session.project.timelines[id].fps,
        editor.session.project.media_pool[old].meta.fps,
    );
    let track = editor.session.project.timelines[id]
        .tracks
        .iter_mut()
        .find(|track| track.kind == TrackKind::Audio)
        .unwrap();
    track.insert_sorted(Clip::from_source_range(
        clip_id,
        ClipSource::Media(old),
        0,
        1,
        0,
        rate,
    ));
    editor.session.sync_timeline_media(id);
    editor.session.save_to(&root.join("takes.vvproj")).unwrap();
    let preview = crate::take::Preview {
        query: project_view_request(&editor, id, 0, false).query,
        replacement: crate::take::Replacement {
            clip_id: clip_id.0.to_string(),
            media_id: media.raw().to_string(),
            source_in: 0,
            duration: vv_core::take::DurationPolicy::Preserve,
            links: vv_core::take::LinkPolicy::ReplaceLinked,
            attributes: vv_core::take::AttributePolicy::Preserve,
            audio_streams: vv_core::take::AudioStreamPolicy::Preserve,
            frozen: vv_core::take::FrozenPolicy::Reject,
            source_version: None,
        },
    };
    (root, editor, id, preview)
}

#[tokio::test]
async fn take_worker_capacity_keeps_session_available_and_completed_replay_needs_no_source() {
    use vv_core::Id;
    let (root, editor, timeline, preview) = take_editor();
    let mut command = request(
        &editor,
        Operation::ReplaceTake {
            replacement: preview.replacement.clone(),
        },
        "replace-take-worker",
        Some(timeline),
    );
    let before = editor.snapshot();
    let host = Host::run(editor).unwrap();
    let permit = host.2.clone().try_acquire_owned().unwrap();
    assert_eq!(
        host.take_plan(preview.clone()).await.unwrap_err().1,
        "TAKE_BUSY"
    );
    assert_eq!(host.call(Action::Session).await.unwrap(), before);
    drop(permit);
    let plan = host.take_plan(preview).await.unwrap();
    assert_eq!(host.call(Action::Session).await.unwrap(), before);
    let Operation::ReplaceTake { replacement } = &mut command.operation else {
        unreachable!()
    };
    replacement.source_version = Some(plan["source_version"].as_str().unwrap().into());
    let receipt = host
        .timeline_mutation(timeline.raw().to_string(), command.clone())
        .await
        .unwrap();
    let after = host.call(Action::Session).await.unwrap();
    assert_ne!(after["generation"], before["generation"]);
    std::fs::rename(root.join("candidate.wav"), root.join("candidate.offline")).unwrap();
    let offline = host.call(Action::Session).await.unwrap();
    let permit = host.2.clone().try_acquire_owned().unwrap();
    assert_eq!(
        host.timeline_mutation(timeline.raw().to_string(), command.clone())
            .await
            .unwrap(),
        receipt
    );
    command.if_generation.push_str("-changed");
    assert_eq!(
        host.timeline_mutation(timeline.raw().to_string(), command)
            .await
            .unwrap_err()
            .1,
        "COMMAND_ID_REUSED"
    );
    assert_eq!(host.call(Action::Session).await.unwrap(), offline);
    drop(permit);
    drop(host);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn take_worker_result_cannot_apply_after_timeline_revision_changes() {
    use vv_core::Id;
    let (root, mut editor, timeline, preview) = take_editor();
    let task = crate::take::Task::new(
        &editor.session,
        &editor.files,
        timeline,
        &preview.replacement,
        false,
    )
    .unwrap();
    let verified = task
        .run(&std::sync::atomic::AtomicBool::new(false))
        .unwrap();
    let rename = request(
        &editor,
        Operation::RenameTimeline {
            name: "Changed during verification".into(),
        },
        "take-worker-race",
        Some(timeline),
    );
    editor
        .mutation(Some(timeline.raw().to_string()), rename)
        .unwrap();
    let before = editor.snapshot();
    let project = json!(editor.session.project);
    assert_eq!(
        editor
            .handle(Action::TakePlan(preview, verified))
            .unwrap_err()
            .1,
        "REVISION_CONFLICT"
    );
    assert_eq!(editor.snapshot(), before);
    assert_eq!(json!(editor.session.project), project);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn source_browser_capacity_does_not_block_the_editor_and_releases_after_rejected_snapshot() {
    let root =
        std::env::temp_dir().join(format!("vv-source-capacity-{}", crate::asset_jobs::nonce()));
    let host = Host::start(&root).unwrap();
    let before = host.call(Action::Session).await.unwrap();
    let query = crate::files::SourcesQuery {
        project_epoch: before["project_epoch"].as_str().unwrap().into(),
        directory_token: String::new(),
        page: 0,
    };
    let permit = host.1.clone().try_acquire_owned().unwrap();
    assert_eq!(
        host.source_browser(query.clone()).await.unwrap_err().1,
        "SOURCE_BROWSER_BUSY"
    );
    assert_eq!(host.call(Action::Session).await.unwrap(), before);
    drop(permit);
    let mut stale = query.clone();
    stale.project_epoch = "stale".into();
    assert_eq!(
        host.source_browser(stale).await.unwrap_err().1,
        "REVISION_CONFLICT"
    );
    assert!(host.source_browser(query).await.is_ok());
    assert_eq!(host.call(Action::Session).await.unwrap(), before);
    drop(host);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn inspector_selection_is_read_only_and_rejects_stale_snapshot_identity() {
    use vv_core::{Clip, ClipSource};
    let root =
        std::env::temp_dir().join(format!("vv-selection-host-{}", crate::asset_jobs::nonce()));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "Selection".into(),
        },
        "selection-create",
        None,
    );
    editor.mutation(None, create).unwrap();
    let id = editor.session.project.timelines.keys().next().unwrap();
    let raw = editor.session.project.alloc_clip_id();
    editor.session.project.timelines[id].tracks[0].insert_sorted(Clip::from_source_range(
        raw,
        ClipSource::SolidColor,
        10,
        106,
        24,
        Rational::new(1, 2),
    ));
    editor.lease = None;
    editor.lease("other-writer").unwrap();
    let before = editor.snapshot();
    let project = json!(editor.session.project);
    let receipts = editor.completed.len();
    let query = project_view_request(&editor, id, 400, false).query;
    let response = editor
        .handle(Action::InspectorSelection(crate::selection::Request {
            query: query.clone(),
            clip_ids: vec![raw.0.to_string()],
        }))
        .unwrap();
    assert_eq!(response["query"], json!(query));
    assert_eq!(response["rows"][0]["source_frame"], 104);
    assert_eq!(editor.snapshot(), before);
    assert_eq!(json!(editor.session.project), project);
    assert_eq!(editor.completed.len(), receipts);
    assert_eq!(editor.lease.as_ref().unwrap().0, "other-writer");
    for case in 0..4 {
        let mut stale = query.clone();
        match case {
            0 => stale.project_epoch.push_str("-old"),
            1 => stale.if_generation = "99".into(),
            2 => stale.revision.push_str("-old"),
            _ => stale.frame = -1,
        }
        assert!(
            editor
                .handle(Action::InspectorSelection(crate::selection::Request {
                    query: stale,
                    clip_ids: vec![raw.0.to_string()]
                }))
                .is_err()
        );
    }
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn duplicate_receipt_returns_only_native_copies_and_replay_keeps_the_same_ids() {
    use vv_core::Id;
    let root =
        std::env::temp_dir().join(format!("vv-duplicate-host-{}", crate::asset_jobs::nonce()));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "Duplicate".into(),
        },
        "duplicate-create",
        None,
    );
    editor.mutation(None, create).unwrap();
    let id = editor.session.project.timelines.keys().next().unwrap();
    let add = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 48,
        },
        "duplicate-base",
        Some(id),
    );
    editor.mutation(Some(id.raw().to_string()), add).unwrap();
    let original = editor.session.project.timelines[id].tracks[0].clips[0].id;
    let operation = serde_json::from_value(json!({"kind":"move_clips","new_video_tracks":0,"new_audio_tracks":0,"duplicate":true,"overwrite":true,"moves":[{"clip_id":original.0.to_string(),"to_track":{"kind":"existing","track_id":"0"},"to_start_frame":12}]})).unwrap();
    let request = request(&editor, operation, "duplicate-selection", Some(id));
    let position = editor.session.history.position();
    let first = editor
        .mutation(Some(id.raw().to_string()), request.clone())
        .unwrap();
    let copies = first["clip_ids"].as_array().unwrap();
    assert_eq!(copies.len(), 1);
    let copied = copies[0].as_str().unwrap();
    assert_ne!(copied, original.0.to_string());
    let clip = editor.session.project.timelines[id].tracks[0]
        .clips
        .iter()
        .find(|clip| clip.id.0.to_string() == copied)
        .unwrap();
    assert_eq!((clip.timeline_start, clip.timeline_len), (12, 48));
    assert_eq!(editor.session.history.position(), position + 1);
    let after = json!(editor.session.project);
    let replay = editor
        .mutation(Some(id.raw().to_string()), request)
        .unwrap();
    assert_eq!(first, replay);
    assert_eq!(json!(editor.session.project), after);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

fn project_view_request(
    editor: &Editor,
    id: vv_core::TimelineId,
    frame: i64,
    persist: bool,
) -> crate::project_view::Request {
    use vv_core::Id;
    crate::project_view::Request {
        client_id: "test-client".into(),
        query: FrameQuery {
            timeline_id: id.raw().to_string(),
            project_epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
            if_generation: editor.session.history.generation().to_string(),
            revision: editor.session.timeline_revision(id),
            frame,
            width: 16,
        },
        if_view_revision: crate::project_view::snapshot(&editor.session.project).1,
        ancestors: vec![],
        persist,
    }
}

#[test]
fn project_view_flush_is_native_metadata_only_and_dirty_edits_wait_for_explicit_save() {
    use vv_core::Id;
    let root = std::env::temp_dir().join(format!(
        "vv-project-view-host-{}",
        crate::asset_jobs::nonce()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "View".into(),
        },
        "view-create",
        None,
    );
    editor.mutation(None, create).unwrap();
    let id = editor.session.project.timelines.keys().next().unwrap();
    let add = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 24,
        },
        "view-clip",
        Some(id),
    );
    editor.mutation(Some(id.raw().to_string()), add).unwrap();
    let save = request(&editor, Operation::Save, "view-baseline", None);
    editor.mutation(None, save).unwrap();
    let before = editor.snapshot();
    let before_project = json!(editor.session.project);
    let receipts = editor.completed.len();
    let view_request = project_view_request(&editor, id, 12, true);
    let first = editor.handle(Action::ProjectView(view_request)).unwrap();
    assert_eq!(first["persisted"], true);
    assert_eq!(first["saved"], true);
    assert_eq!(first["view"]["active_timeline"], id.raw().to_string());
    assert_eq!(first["view"]["playheads"][id.raw().to_string()], 12);
    let after = editor.snapshot();
    for field in ["generation", "history", "unsaved", "timelines", "media"] {
        assert_eq!(after[field], before[field], "{field}");
    }
    let mut project = json!(editor.session.project);
    project["view"] = before_project["view"].clone();
    assert_eq!(project, before_project);
    assert_eq!(editor.completed.len(), receipts);
    let path = root.join("View.vvproj");
    let identity = crate::source::file_identity(&std::fs::File::open(&path).unwrap()).unwrap();
    let same = project_view_request(&editor, id, 12, true);
    let second = editor.handle(Action::ProjectView(same)).unwrap();
    assert_eq!(second["saved"], false);
    assert_eq!(
        crate::source::file_identity(&std::fs::File::open(&path).unwrap()).unwrap(),
        identity
    );
    let saved_bytes = std::fs::read(&path).unwrap();
    let add = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 24,
            length_frames: 24,
        },
        "view-dirty-clip",
        Some(id),
    );
    editor.mutation(Some(id.raw().to_string()), add).unwrap();
    let dirty = editor.snapshot();
    let remember = project_view_request(&editor, id, 30, true);
    let ack = editor.handle(Action::ProjectView(remember)).unwrap();
    assert_eq!(ack["saved"], false);
    assert_eq!(ack["persisted"], false);
    assert_eq!(std::fs::read(&path).unwrap(), saved_bytes);
    let after = editor.snapshot();
    for field in ["generation", "history", "unsaved", "timelines", "media"] {
        assert_eq!(after[field], dirty[field], "{field}");
    }
    let save = request(&editor, Operation::Save, "view-explicit-save", None);
    editor.mutation(None, save).unwrap();
    let same = project_view_request(&editor, id, 30, true);
    assert_eq!(
        editor.handle(Action::ProjectView(same)).unwrap()["saved"],
        false
    );
    let remember = project_view_request(&editor, id, 44, false);
    editor.handle(Action::ProjectView(remember)).unwrap();
    let copy = request(
        &editor,
        Operation::SaveAs {
            name: "View_copy".into(),
        },
        "view-copy",
        None,
    );
    editor.mutation(None, copy).unwrap();
    let same = project_view_request(&editor, id, 44, true);
    assert_eq!(
        editor.handle(Action::ProjectView(same)).unwrap()["saved"],
        false
    );
    drop(editor);
    let mut reopened = Editor::new(&root).unwrap();
    assert_eq!(
        reopened.snapshot()["view"]["playheads"][id.raw().to_string()],
        44
    );
    let open = request(
        &reopened,
        Operation::OpenProject {
            path_token: "View.vvproj".into(),
        },
        "view-open",
        None,
    );
    reopened.mutation(None, open).unwrap();
    let same = project_view_request(&reopened, id, 30, true);
    assert_eq!(
        reopened.handle(Action::ProjectView(same)).unwrap()["saved"],
        false
    );
    drop(reopened);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn project_view_rejects_foreign_writer_stale_cas_and_external_file_changes_without_mutation() {
    let root = std::env::temp_dir().join(format!(
        "vv-project-view-conflict-{}",
        crate::asset_jobs::nonce()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "View_conflict".into(),
        },
        "view-conflict-create",
        None,
    );
    editor.mutation(None, create).unwrap();
    let id = editor.session.project.timelines.keys().next().unwrap();
    let initial = project_view_request(&editor, id, 10, false);
    editor.handle(Action::ProjectView(initial)).unwrap();
    let before = editor.snapshot();
    let model = json!(editor.session.project);
    let bytes = std::fs::read(root.join("View_conflict.vvproj")).unwrap();
    for field in [
        "writer",
        "view",
        "epoch",
        "generation",
        "timeline",
        "frame",
        "width",
    ] {
        let mut invalid = project_view_request(&editor, id, 15, true);
        match field {
            "writer" => invalid.client_id = "foreign-writer".into(),
            "view" => invalid.if_view_revision = "f".repeat(64),
            "epoch" => invalid.query.project_epoch = "stale".into(),
            "generation" => invalid.query.if_generation = "999".into(),
            "timeline" => invalid.query.timeline_id = "999".into(),
            "frame" => invalid.query.frame = -1,
            _ => invalid.query.width = 0,
        }
        assert!(
            editor.handle(Action::ProjectView(invalid)).is_err(),
            "{field}"
        );
        assert_eq!(editor.snapshot(), before);
        assert_eq!(json!(editor.session.project), model);
    }
    assert_eq!(
        std::fs::read(root.join("View_conflict.vvproj")).unwrap(),
        bytes
    );
    // A changed view on an empty timeline still clamps to frame zero; select another native root to force a real view change.
    let other = editor.session.create_timeline(Timeline {
        name: "Other".into(),
        fps: Rational::new(24, 1),
        resolution: (16, 16),
        tracks: vec![Track::new(TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let save = request(&editor, Operation::Save, "view-conflict-baseline", None);
    editor.mutation(None, save).unwrap();
    let before = json!(editor.session.project);
    let saved_view = editor.persisted_view.clone();
    std::fs::write(root.join("View_conflict.vvproj"), b"foreign file preserved").unwrap();
    let conflict = project_view_request(&editor, other, 0, true);
    assert_eq!(
        editor.handle(Action::ProjectView(conflict)).unwrap_err().1,
        "SAVE_CONFLICT"
    );
    assert_eq!(json!(editor.session.project), before);
    assert_eq!(editor.persisted_view, saved_view);
    assert_eq!(
        std::fs::read(root.join("View_conflict.vvproj")).unwrap(),
        b"foreign file preserved"
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn project_view_nested_roots_use_native_inverse_clocks_fallbacks_and_every_parent_revision() {
    use vv_core::{Clip, ClipSource, Id};
    for fallback in [false, true] {
        let root = std::env::temp_dir().join(format!(
            "vv-project-view-nested-{}",
            crate::asset_jobs::nonce()
        ));
        let mut editor = Editor::new(&root).unwrap();
        let make = |name: &str, fps| Timeline {
            name: name.into(),
            fps,
            resolution: (16, 16),
            tracks: vec![Track::new(TrackKind::Video)],
            markers: vec![],
            master: Default::default(),
        };
        let outer = editor
            .session
            .create_timeline(make("Root", Rational::new(24, 1)));
        let child = editor
            .session
            .create_timeline(make("Child", Rational::new(30, 1)));
        let inner = editor
            .session
            .create_timeline(make("Inner", Rational::new(60, 1)));
        let solid = Clip::from_source_range(
            editor.session.project.alloc_clip_id(),
            ClipSource::SolidColor,
            0,
            120,
            0,
            Rational::one(),
        );
        editor.session.project.timelines[inner].tracks[0].insert_sorted(solid);
        let child_media = editor
            .session
            .project
            .media_pool
            .iter()
            .find(|(_, item)| item.compound == Some(child))
            .unwrap()
            .0;
        let inner_media = editor
            .session
            .project
            .media_pool
            .iter()
            .find(|(_, item)| item.compound == Some(inner))
            .unwrap()
            .0;
        let outer_clip = editor.session.project.alloc_clip_id();
        let child_clip = editor.session.project.alloc_clip_id();
        let mut wrapper = Clip::from_source_range(
            outer_clip,
            ClipSource::Media(child_media),
            30,
            90,
            12,
            Rational::new(4, 5),
        );
        if fallback {
            wrapper.freeze = Some(30);
        }
        editor.session.project.timelines[outer].tracks[0].insert_sorted(wrapper);
        editor.session.project.timelines[child].tracks[0].insert_sorted(Clip::from_source_range(
            child_clip,
            ClipSource::Media(inner_media),
            20,
            80,
            20,
            Rational::new(1, 2),
        ));
        let ancestors = vec![
            crate::compound_navigation::Ancestor {
                timeline_id: outer.raw().to_string(),
                revision: editor.session.timeline_revision(outer),
                clip_id: Some(outer_clip.0.to_string()),
                entry_playhead: 17,
            },
            crate::compound_navigation::Ancestor {
                timeline_id: child.raw().to_string(),
                revision: editor.session.timeline_revision(child),
                clip_id: Some(child_clip.0.to_string()),
                entry_playhead: 21,
            },
        ];
        let generation = editor.session.history.generation();
        let position = editor.session.history.position();
        let timelines = json!(editor.session.project.timelines);
        let mut remember = project_view_request(&editor, inner, 60, true);
        remember.ancestors = ancestors.clone();
        let result = editor.handle(Action::ProjectView(remember)).unwrap();
        assert_eq!(result["view"]["active_timeline"], outer.raw().to_string());
        assert_eq!(
            result["view"]["playheads"][outer.raw().to_string()],
            if fallback { 17 } else { 20 }
        );
        assert_eq!(result["view"]["playheads"].as_object().unwrap().len(), 1);
        assert_eq!(result["persisted"], false);
        assert_eq!(editor.session.history.generation(), generation);
        assert_eq!(editor.session.history.position(), position);
        assert_eq!(json!(editor.session.project.timelines), timelines);
        editor.session.apply(Box::new(vv_core::MoveClips::new(
            child,
            vec![(child_clip, 0, 0, 21)],
        )));
        let before = json!(editor.session.project);
        let mut stale = project_view_request(&editor, inner, 60, false);
        stale.ancestors = ancestors;
        assert_eq!(
            editor.handle(Action::ProjectView(stale)).unwrap_err().1,
            "REVISION_CONFLICT"
        );
        assert_eq!(json!(editor.session.project), before);
        drop(editor);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn public_slip_manifest_uses_the_same_pinned_file_version_as_source_windows_without_editing() {
    use vv_core::{Clip, ClipSource, Id, MediaItem, MediaMeta};
    let root = std::env::temp_dir().join(format!(
        "vv-slip-version-host-{}",
        crate::asset_jobs::nonce()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let path = root.join("source.png");
    let bytes = clipboard_image_bytes();
    std::fs::write(&path, &bytes).unwrap();
    // Seed cached movie metadata: this regression exercises FD binding, not decoding.
    let meta = MediaMeta {
        duration_frames: 1_000_000,
        fps: Rational::new(30_000, 1001),
        width: 16,
        height: 16,
        has_video: true,
        has_audio: false,
        sample_rate: 0,
        channels: 0,
        audio_streams: 0,
        file: Default::default(),
    };
    let media = editor.session.project.media_pool.insert(MediaItem {
        path: path.clone(),
        meta: meta.clone(),
        content_hash: 42,
        compound: None,
        folder: None,
    });
    let timeline = editor.session.create_timeline(Timeline {
        name: "Slip FD binding".into(),
        fps: Rational::new(24_000, 1001),
        resolution: (16, 16),
        tracks: vec![Track::new(TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let clip = editor.session.project.alloc_clip_id();
    editor.session.project.timelines[timeline].tracks[0]
        .clips
        .push(Clip::from_source_range(
            clip,
            ClipSource::Media(media),
            30_000,
            30_060,
            12,
            Rational::new(4, 5),
        ));
    editor.session.sync_timeline_media(timeline);
    let query = FrameQuery {
        timeline_id: timeline.raw().to_string(),
        project_epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
        if_generation: editor.session.history.generation().to_string(),
        revision: editor.session.timeline_revision(timeline),
        frame: 12,
        width: 16,
    };
    let baseline = editor.snapshot();
    let project = json!(editor.session.project);
    let position = editor.session.history.position();
    let generation = editor.session.history.generation();
    let receipts = editor.completed.len();
    let first = editor
        .handle(Action::SlipDetail(clip.0.to_string(), 0, query.clone()))
        .unwrap();
    assert_eq!(first["preview_available"], true);
    assert_eq!(first["total_frames"], meta.duration_frames);
    assert_ne!(first["source_version"], "42");
    let pin = |editor: &mut Editor| {
        let (reply, mut result) = oneshot::channel();
        editor
            .handle(Action::SourceSnapshot(
                media.raw().to_string(),
                SourceQuery {
                    project_epoch: query.project_epoch.clone(),
                },
                reply,
            ))
            .unwrap();
        result.try_recv().unwrap().unwrap()
    };
    let old = pin(&mut editor);
    let old_version = crate::source::source_version(&old.file).unwrap();
    assert_eq!(first["source_version"], old_version);
    assert_eq!(first["fps"], json!(old.meta.fps));
    assert_eq!(first["total_frames"], old.meta.duration_frames);
    let modified = old.file.metadata().unwrap().modified().unwrap();
    let replacement = root.join("replacement.png");
    std::fs::write(&replacement, &bytes).unwrap();
    std::fs::File::options()
        .write(true)
        .open(&replacement)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    std::fs::rename(&replacement, &path).unwrap();
    let fresh = pin(&mut editor);
    let fresh_version = crate::source::source_version(&fresh.file).unwrap();
    assert_ne!(fresh_version, old_version);
    assert_ne!(
        crate::source::source_version(&old.file).unwrap(),
        old_version
    );
    assert_eq!(
        old.file.metadata().unwrap().len(),
        fresh.file.metadata().unwrap().len()
    );
    assert_eq!(
        old.file.metadata().unwrap().modified().unwrap(),
        fresh.file.metadata().unwrap().modified().unwrap()
    );
    assert_eq!(json!(fresh.meta), json!(old.meta));
    let second = editor
        .handle(Action::SlipDetail(clip.0.to_string(), 0, query))
        .unwrap();
    assert_eq!(second["source_version"], fresh_version);
    assert_ne!(second["source_version"], first["source_version"]);
    assert_eq!(second["frames"], first["frames"]);
    assert_eq!(editor.snapshot(), baseline);
    assert_eq!(json!(editor.session.project), project);
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(editor.session.history.generation(), generation);
    assert_eq!(editor.completed.len(), receipts);
    drop(fresh);
    drop(old);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn saved_audio_presets_are_library_only_retry_safe_and_apply_with_one_native_undo() {
    use crate::audio_presets::{Edit, Kind};
    use vv_core::{AudioEffect, AudioEffectKind, Equalizer, Id};
    let root = std::env::temp_dir().join(format!(
        "vv-audio-preset-host-{}",
        crate::asset_jobs::nonce()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "Audio_parameters".into(),
        },
        "audio-preset-project",
        None,
    );
    editor.mutation(None, create).unwrap();
    let id = editor.session.project.timelines.keys().next().unwrap();
    let route = Some(id.raw().to_string());
    let mut eq = AudioEffect::new(AudioEffectKind::Equalizer(Equalizer::DEFAULT));
    eq.enabled = false;
    let effects = vec![
        AudioEffect::new(AudioEffectKind::Mono),
        eq,
        AudioEffect::new(AudioEffectKind::Mono),
    ];
    let chain = request(
        &editor,
        Operation::SetAudioEffects {
            channel: "master".into(),
            effects,
        },
        "audio-preset-chain",
        Some(id),
    );
    editor.mutation(route.clone(), chain).unwrap();
    let save = request(&editor, Operation::Save, "audio-preset-baseline-save", None);
    editor.mutation(None, save).unwrap();
    let baseline = editor.snapshot();
    let epoch = baseline["project_epoch"].as_str().unwrap().to_owned();
    let catalog = editor
        .handle(Action::AudioPresets(SourceQuery {
            project_epoch: epoch.clone(),
        }))
        .unwrap();
    let mut parameters = Equalizer::DEFAULT;
    parameters.bands[2].gain_db = -3.5;
    parameters.bands[2].q = 1.7;
    let store = request(
        &editor,
        Operation::EditAudioPresetLibrary {
            edit: Edit::Save {
                name: "  Personal voice  ".into(),
                revision: catalog["revision"].as_str().unwrap().into(),
                parameters: AudioEffectKind::Equalizer(parameters.clone()),
            },
        },
        "audio-preset-store",
        None,
    );
    let acknowledged = editor.mutation(None, store.clone()).unwrap();
    assert_eq!(editor.mutation(None, store.clone()).unwrap(), acknowledged);
    assert_eq!(editor.snapshot(), baseline);
    let catalog = editor
        .handle(Action::AudioPresets(SourceQuery {
            project_epoch: epoch.clone(),
        }))
        .unwrap();
    assert_eq!(catalog["eq_presets"][0]["name"], "Personal voice");
    assert_eq!(catalog["eq_presets"][0]["params"], json!(parameters));
    let apply = |revision: String| Operation::ApplySavedAudioPreset {
        channel: "master".into(),
        index: 1,
        preset_kind: Kind::Equalizer,
        name: "Personal voice".into(),
        revision,
    };
    let stale = request(
        &editor,
        apply("0".repeat(64)),
        "audio-preset-stale",
        Some(id),
    );
    assert_eq!(
        editor.mutation(route.clone(), stale).unwrap_err().1,
        "AUDIO_PRESETS_CHANGED"
    );
    assert_eq!(editor.snapshot(), baseline);
    let before = json!(editor.session.project.timelines[id]);
    let position = editor.session.history.position();
    let change = request(
        &editor,
        apply(catalog["revision"].as_str().unwrap().into()),
        "audio-preset-apply",
        Some(id),
    );
    let ack = editor.mutation(route.clone(), change.clone()).unwrap();
    assert_eq!(editor.mutation(route.clone(), change).unwrap(), ack);
    assert_eq!(editor.session.history.position(), position + 1);
    let mut expected: Timeline = serde_json::from_value(before.clone()).unwrap();
    expected.master.effects[1].kind = AudioEffectKind::Equalizer(parameters);
    assert_eq!(json!(editor.session.project.timelines[id]), json!(expected));
    assert!(!editor.session.project.timelines[id].master.effects[1].enabled);
    let undo = request(&editor, Operation::Undo, "audio-preset-undo", None);
    editor.mutation(None, undo).unwrap();
    assert_eq!(json!(editor.session.project.timelines[id]), before);
    let redo = request(&editor, Operation::Redo, "audio-preset-redo", None);
    editor.mutation(None, redo).unwrap();
    assert_eq!(json!(editor.session.project.timelines[id]), json!(expected));
    let save = request(&editor, Operation::Save, "audio-preset-applied-save", None);
    editor.mutation(None, save).unwrap();
    let revision = catalog["revision"].clone();
    drop(editor);
    let mut reopened = Editor::new(&root).unwrap();
    assert_eq!(
        json!(reopened.session.project.timelines[id]),
        json!(expected)
    );
    let epoch = reopened.snapshot()["project_epoch"]
        .as_str()
        .unwrap()
        .to_owned();
    let catalog = reopened
        .handle(Action::AudioPresets(SourceQuery {
            project_epoch: epoch,
        }))
        .unwrap();
    assert_eq!(catalog["revision"], revision);
    let mut restored_receipt = reopened.mutation(None, store).unwrap();
    assert_eq!(restored_receipt["server_restarted"], true);
    restored_receipt
        .as_object_mut()
        .unwrap()
        .remove("server_restarted");
    assert_eq!(restored_receipt, acknowledged);
    assert_eq!(reopened.audio_presets.list().unwrap()["revision"], revision);
    let missing = reopened.handle(Action::AudioPresets(SourceQuery {
        project_epoch: "old-project".into(),
    }));
    assert_eq!(missing.unwrap_err().1, "REVISION_CONFLICT");
    drop(reopened);
    std::fs::remove_dir_all(root).unwrap();
}

fn clipboard_image_bytes() -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 16, 16);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&vec![127; 16 * 16 * 4])
            .unwrap();
    }
    bytes
}

fn clipboard_image_pool(project: &vv_core::Project) -> Value {
    let items = project
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
    json!(items)
}

#[test]
fn bitmap_clipboard_add_is_named_nonoverwriting_retry_safe_and_preserves_its_file_after_undo() {
    use std::io::Read;
    let root = std::env::temp_dir().join(format!(
        "vv-clipboard-image-host-{}",
        crate::asset_jobs::nonce()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let query = |editor: &Editor| ClipboardImageQuery {
        project_epoch: editor.snapshot()["project_epoch"].as_str().unwrap().into(),
        if_generation: editor.snapshot()["generation"].as_str().unwrap().into(),
    };
    assert!(
        editor
            .handle(Action::CheckClipboardImage(query(&editor)))
            .is_err()
    );
    let create = request(
        &editor,
        Operation::NewProject {
            name: "Clipboard_image".into(),
        },
        "image-project",
        None,
    );
    editor.mutation(None, create).unwrap();
    let before = editor.snapshot();
    let before_pool = clipboard_image_pool(&editor.session.project);
    let bytes = clipboard_image_bytes();
    let job = editor
        .handle(Action::PrepareClipboardImage(
            query(&editor),
            "image/png".into(),
            bytes.clone(),
        ))
        .unwrap();
    let ready = native_wait(&mut editor, &job);
    assert_eq!(ready["state"], "ready");
    assert_eq!(editor.snapshot(), before);
    assert!(!root.join("Pasted Images/First image.png").exists());
    let mut stale = query(&editor);
    stale.if_generation = "wrong-generation".into();
    assert!(editor.handle(Action::CheckClipboardImage(stale)).is_err());
    let position = editor.session.history.position();
    let paste = request(
        &editor,
        Operation::ImportClipboardImage {
            job_id: job["id"].as_str().unwrap().into(),
            name: " First image ".into(),
        },
        "image-add",
        None,
    );
    let ack = editor.mutation(None, paste.clone()).unwrap();
    assert_eq!(editor.mutation(None, paste).unwrap(), ack);
    assert_eq!(ack["media_ids"].as_array().unwrap().len(), 1);
    assert_eq!(ack["errors"], json!([]));
    assert_eq!(editor.session.history.position(), position + 1);
    let path = root.join("Pasted Images/First image.png");
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    let media = editor
        .session
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.path == path)
        .unwrap()
        .1;
    assert_eq!(
        media.content_hash,
        vv_media::content_fingerprint(&path).unwrap()
    );
    assert_eq!((media.meta.width, media.meta.height), (16, 16));
    let mut reopened_bytes = Vec::new();
    editor
        .files
        .media_file(&path)
        .unwrap()
        .read_to_end(&mut reopened_bytes)
        .unwrap();
    assert_eq!(reopened_bytes, bytes);
    let after = clipboard_image_pool(&editor.session.project);
    let undo = request(&editor, Operation::Undo, "image-undo", None);
    editor.mutation(None, undo).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    assert_eq!(clipboard_image_pool(&editor.session.project), before_pool);
    let redo = request(&editor, Operation::Redo, "image-redo", None);
    editor.mutation(None, redo).unwrap();
    assert_eq!(clipboard_image_pool(&editor.session.project), after);
    let save = request(&editor, Operation::Save, "image-save", None);
    editor.mutation(None, save).unwrap();
    drop(editor);
    let reopened = Editor::new(&root).unwrap();
    assert_eq!(clipboard_image_pool(&reopened.session.project), after);
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    drop(reopened);
    std::fs::remove_dir_all(root).unwrap();
}

fn prepare_clipboard_fixture(editor: &mut Editor, text: Option<String>, to_pool: bool) -> Value {
    let snapshot = editor.snapshot();
    let job = editor
        .handle(Action::PrepareClipboard(ClipboardRequest {
            project_epoch: snapshot["project_epoch"].as_str().unwrap().into(),
            if_generation: snapshot["generation"].as_str().unwrap().into(),
            text,
            to_pool,
        }))
        .unwrap();
    native_wait(editor, &job)
}

#[test]
fn prepared_clipboard_requires_explicit_overwrite_and_retries_as_one_native_undo() {
    let root = std::env::temp_dir().join(format!(
        "vv-clipboard-overwrite-host-{}",
        crate::asset_jobs::nonce()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "Clipboard_overwrite".into(),
        },
        "overwrite-project",
        None,
    );
    editor.mutation(None, create).unwrap();
    let id = editor.session.project.timelines.keys().next().unwrap();
    let path = Some(vv_core::Id::raw(id).to_string());
    let add = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 24,
        },
        "overwrite-solid",
        Some(id),
    );
    editor.mutation(path.clone(), add).unwrap();
    let clip = editor.session.project.timelines[id].tracks[0].clips[0]
        .id
        .0
        .to_string();
    let copy = request(
        &editor,
        Operation::CopyClips {
            clip_ids: vec![clip],
        },
        "overwrite-copy",
        Some(id),
    );
    editor.mutation(path, copy).unwrap();
    let job = prepare_clipboard_fixture(&mut editor, None, false);
    let before = serde_json::to_value(&editor.session.project.timelines[id]).unwrap();
    let position = editor.session.history.position();
    let operation = Operation::PastePreparedClipboard {
        job_id: job["id"].as_str().unwrap().into(),
        to_pool: false,
        overwrite: false,
        timeline_id: Some(vv_core::Id::raw(id).to_string()),
        timeline_revision: Some(editor.session.timeline_revision(id)),
        frame: 6,
    };
    let refused = request(&editor, operation.clone(), "overwrite-refused", None);
    assert!(editor.mutation(None, refused).is_err());
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(
        serde_json::to_value(&editor.session.project.timelines[id]).unwrap(),
        before
    );
    let mut operation = operation;
    if let Operation::PastePreparedClipboard { overwrite, .. } = &mut operation {
        *overwrite = true;
    }
    let paste = request(&editor, operation, "overwrite-accepted", None);
    let ack = editor.mutation(None, paste.clone()).unwrap();
    assert_eq!(ack["changed"], true);
    assert_eq!(editor.mutation(None, paste).unwrap(), ack);
    assert_eq!(editor.session.history.position(), position + 1);
    let clips = &editor.session.project.timelines[id].tracks[0].clips;
    assert_eq!(clips.len(), 2);
    assert_eq!((clips[0].timeline_start, clips[0].timeline_len), (0, 6));
    assert_eq!((clips[1].timeline_start, clips[1].timeline_len), (6, 24));
    let undo = request(&editor, Operation::Undo, "overwrite-undo", None);
    editor.mutation(None, undo).unwrap();
    assert_eq!(
        serde_json::to_value(&editor.session.project.timelines[id]).unwrap(),
        before
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_clipboard_text_survives_project_change_and_prepared_paste_is_one_retry_safe_undo() {
    let root = std::env::temp_dir().join(format!(
        "vv-clipboard-project-host-{}",
        crate::asset_jobs::nonce()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "Clipboard_source".into(),
        },
        "cb-source",
        None,
    );
    editor.mutation(None, create).unwrap();
    let old = editor.session.project.timelines.keys().next().unwrap();
    let path = Some(vv_core::Id::raw(old).to_string());
    let add = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 24,
        },
        "cb-add",
        Some(old),
    );
    editor.mutation(path.clone(), add).unwrap();
    let clip = editor.session.project.timelines[old].tracks[0].clips[0]
        .id
        .0
        .to_string();
    let copy = request(
        &editor,
        Operation::CopyClips {
            clip_ids: vec![clip],
        },
        "cb-copy",
        Some(old),
    );
    let ack = editor.mutation(path, copy).unwrap();
    let initial = editor.snapshot();
    let revision = ack["clipboard_revision"].as_str().unwrap().to_owned();
    let value = editor
        .handle(Action::Clipboard(ClipboardQuery {
            project_epoch: initial["project_epoch"].as_str().unwrap().into(),
            if_generation: initial["generation"].as_str().unwrap().into(),
            clipboard_revision: revision.clone(),
        }))
        .unwrap();
    assert!(
        value["text"]
            .as_str()
            .unwrap()
            .starts_with("venturi-clipboard/1\n")
    );
    let save = request(&editor, Operation::Save, "cb-save", None);
    editor.mutation(None, save).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "Clipboard_target".into(),
        },
        "cb-target",
        None,
    );
    editor.mutation(None, create).unwrap();
    assert_eq!(editor.snapshot()["clipboard_count"], 1);
    assert_eq!(editor.snapshot()["clipboard_revision"], revision);
    assert_eq!(editor.snapshot()["clipboard_current_project"], false);
    let target = editor.session.project.timelines.keys().next().unwrap();
    let before = serde_json::to_value(&editor.session.project.timelines[target]).unwrap();
    let ready = prepare_clipboard_fixture(
        &mut editor,
        Some(value["text"].as_str().unwrap().into()),
        false,
    );
    let paste = request(
        &editor,
        Operation::PastePreparedClipboard {
            job_id: ready["id"].as_str().unwrap().into(),
            to_pool: false,
            overwrite: false,
            timeline_id: Some(vv_core::Id::raw(target).to_string()),
            timeline_revision: Some(editor.session.timeline_revision(target)),
            frame: 12,
        },
        "cb-paste",
        None,
    );
    let position = editor.session.history.position();
    let ack = editor.mutation(None, paste.clone()).unwrap();
    assert_eq!(ack["changed"], true);
    assert_eq!(ack["clip_ids"].as_array().unwrap().len(), 1);
    assert_eq!(editor.mutation(None, paste).unwrap(), ack);
    assert_eq!(editor.session.history.position(), position + 1);
    let after = serde_json::to_value(&editor.session.project.timelines[target]).unwrap();
    assert_eq!(
        editor.session.project.timelines[target].tracks[0].clips[0].timeline_start,
        12
    );
    let undo = request(&editor, Operation::Undo, "cb-undo", None);
    editor.mutation(None, undo).unwrap();
    assert_eq!(
        serde_json::to_value(&editor.session.project.timelines[target]).unwrap(),
        before
    );
    let redo = request(&editor, Operation::Redo, "cb-redo", None);
    editor.mutation(None, redo).unwrap();
    assert_eq!(
        serde_json::to_value(&editor.session.project.timelines[target]).unwrap(),
        after
    );
    let stale = editor
        .handle(Action::Clipboard(ClipboardQuery {
            project_epoch: editor.snapshot()["project_epoch"].as_str().unwrap().into(),
            if_generation: editor.snapshot()["generation"].as_str().unwrap().into(),
            clipboard_revision: "wrong-copy".into(),
        }))
        .unwrap_err();
    assert_eq!(stale.1, "CLIPBOARD_STALE");
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn clipboard_pool_copy_noop_and_cut_refusals_preserve_native_data_and_canceled_jobs_never_apply() {
    let root = std::env::temp_dir().join(format!(
        "vv-clipboard-cut-host-{}",
        crate::asset_jobs::nonce()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "Clipboard_cut".into(),
        },
        "cb-cut-project",
        None,
    );
    editor.mutation(None, create).unwrap();
    let id = editor.session.project.timelines.keys().next().unwrap();
    let path = Some(vv_core::Id::raw(id).to_string());
    let add = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 24,
        },
        "cb-cut-add",
        Some(id),
    );
    editor.mutation(path.clone(), add).unwrap();
    let media = editor
        .session
        .project
        .media_pool
        .iter()
        .find(|(_, m)| m.compound == Some(id))
        .unwrap()
        .0;
    let copy = request(
        &editor,
        Operation::CopyMedia {
            media_ids: vec![vv_core::Id::raw(media).to_string()],
        },
        "cb-pool-copy",
        None,
    );
    let ack = editor.mutation(None, copy).unwrap();
    assert!(ack["clipboard_revision"].is_string());
    assert_eq!(editor.snapshot()["clipboard_media_count"], 1);
    let job = prepare_clipboard_fixture(&mut editor, None, true);
    let position = editor.session.history.position();
    let paste = request(
        &editor,
        Operation::PastePreparedClipboard {
            job_id: job["id"].as_str().unwrap().into(),
            to_pool: true,
            overwrite: false,
            timeline_id: None,
            timeline_revision: None,
            frame: 0,
        },
        "cb-pool-paste",
        None,
    );
    let mut invalid = paste.clone();
    invalid.command_id = "cb-pool-overwrite".into();
    if let Operation::PastePreparedClipboard { overwrite, .. } = &mut invalid.operation {
        *overwrite = true;
    }
    assert!(editor.mutation(None, invalid).is_err());
    assert_eq!(editor.session.history.position(), position);
    let ack = editor.mutation(None, paste).unwrap();
    assert_eq!(ack["changed"], false);
    assert_eq!(
        ack["media_ids"],
        json!([vv_core::Id::raw(media).to_string()])
    );
    assert_eq!(editor.session.history.position(), position);
    let clip = editor.session.project.timelines[id].tracks[0].clips[0]
        .id
        .0
        .to_string();
    let copy = request(
        &editor,
        Operation::CopyClips {
            clip_ids: vec![clip.clone()],
        },
        "cb-cut-copy",
        Some(id),
    );
    let ack = editor.mutation(path.clone(), copy).unwrap();
    let revision = ack["clipboard_revision"].as_str().unwrap().to_owned();
    editor.session.project.timelines[id].tracks[0].locked = true;
    let before = serde_json::to_value(&editor.session.project).unwrap();
    let cut = request(
        &editor,
        Operation::CutClips {
            clip_ids: vec![clip.clone()],
            clipboard_revision: revision.clone(),
        },
        "cb-cut-locked",
        Some(id),
    );
    assert_eq!(
        editor.mutation(path.clone(), cut).unwrap_err().1,
        "TRACK_LOCKED"
    );
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        before
    );
    editor.session.project.timelines[id].tracks[0].locked = false;
    let cut = request(
        &editor,
        Operation::CutClips {
            clip_ids: vec![clip],
            clipboard_revision: revision,
        },
        "cb-cut-ok",
        Some(id),
    );
    let ack = editor.mutation(path.clone(), cut.clone()).unwrap();
    assert_eq!(editor.mutation(path, cut).unwrap(), ack);
    assert_eq!(editor.session.history.position(), position + 1);
    assert!(
        editor.session.project.timelines[id].tracks[0]
            .clips
            .is_empty()
    );
    let job = prepare_clipboard_fixture(&mut editor, None, false);
    let epoch = job["project_epoch"].as_str().unwrap().to_owned();
    let wrong = editor
        .handle(Action::OtioImportStatus(
            job["id"].as_str().unwrap().into(),
            SourceQuery {
                project_epoch: epoch.clone(),
            },
            false,
        ))
        .unwrap_err();
    assert_eq!(wrong.0, axum::http::StatusCode::NOT_FOUND);
    editor
        .handle(Action::ClipboardStatus(
            job["id"].as_str().unwrap().into(),
            SourceQuery {
                project_epoch: epoch,
            },
            true,
        ))
        .unwrap();
    let before = serde_json::to_value(&editor.session.project).unwrap();
    let paste = request(
        &editor,
        Operation::PastePreparedClipboard {
            job_id: job["id"].as_str().unwrap().into(),
            to_pool: false,
            overwrite: false,
            timeline_id: Some(vv_core::Id::raw(id).to_string()),
            timeline_revision: Some(editor.session.timeline_revision(id)),
            frame: 48,
        },
        "cb-canceled-paste",
        None,
    );
    assert!(editor.mutation(None, paste).is_err());
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        before
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

fn prepared_otio_fixture(editor: &mut Editor, root: &std::path::Path, token: &str) -> Value {
    let mut source = Session::default();
    let id = source.create_timeline(Timeline {
        name: "Source".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![Track::new(TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    std::fs::write(
        root.join(token),
        serde_json::to_vec(&vv_core::otio::timeline_to_otio(&source.project, id, None)).unwrap(),
    )
    .unwrap();
    let job = editor
        .handle(Action::PrepareOtio(OtioImportRequest {
            project_epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
            if_generation: editor.session.history.generation().to_string(),
            path_token: token.into(),
        }))
        .unwrap();
    native_wait(editor, &job)
}

#[test]
fn prepared_otio_merge_accepts_untitled_dirty_session_and_is_single_undo_retry_safe() {
    let root = std::env::temp_dir().join(format!("vv-otio-merge-{}", crate::asset_jobs::nonce()));
    let mut editor = Editor::new(&root).unwrap();
    let old = editor.session.create_timeline(Timeline {
        name: "Unsaved existing".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![Track::new(TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    });
    let before = serde_json::to_value(&editor.session.project.timelines[old]).unwrap();
    let old_position = editor.snapshot()["history"]["position"].as_u64().unwrap();
    let ready = prepared_otio_fixture(&mut editor, &root, "merge.otio");
    let command = request(
        &editor,
        Operation::ImportPreparedOtio {
            job_id: ready["id"].as_str().unwrap().into(),
            name: "Imported".into(),
            reuse_existing: false,
        },
        "merge-current",
        None,
    );
    let receipt = editor.mutation(None, command.clone()).unwrap();
    assert_eq!(receipt["timeline_ids"].as_array().unwrap().len(), 1);
    assert_eq!(editor.snapshot()["history"]["position"], old_position + 1);
    assert!(editor.session.path().is_none());
    assert_eq!(
        serde_json::to_value(&editor.session.project.timelines[old]).unwrap(),
        before
    );
    assert_eq!(editor.mutation(None, command.clone()).unwrap(), receipt);
    let changed = Mutation {
        operation: Operation::ImportPreparedOtio {
            job_id: ready["id"].as_str().unwrap().into(),
            name: "Other".into(),
            reuse_existing: false,
        },
        ..command
    };
    assert_eq!(
        editor.mutation(None, changed).unwrap_err().1,
        "COMMAND_ID_REUSED"
    );
    let applied = serde_json::to_value(&editor.session.project.timelines).unwrap();
    let undo = request(&editor, Operation::Undo, "merge-undo", None);
    editor.mutation(None, undo).unwrap();
    assert_eq!(editor.session.project.timelines.len(), 1);
    assert_eq!(
        serde_json::to_value(&editor.session.project.timelines[old]).unwrap(),
        before
    );
    let redo = request(&editor, Operation::Redo, "merge-redo", None);
    editor.mutation(None, redo).unwrap();
    assert_eq!(
        serde_json::to_value(&editor.session.project.timelines).unwrap(),
        applied
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn prepared_otio_changed_input_cancel_wrong_kind_and_generation_never_mutate_session() {
    let root = std::env::temp_dir().join(format!("vv-otio-guards-{}", crate::asset_jobs::nonce()));
    let mut editor = Editor::new(&root).unwrap();
    let ready = prepared_otio_fixture(&mut editor, &root, "changed.otio");
    let job = ready["id"].as_str().unwrap().to_owned();
    let epoch = ready["project_epoch"].as_str().unwrap().to_owned();
    assert_eq!(
        editor
            .handle(Action::MediaImportStatus(
                job.clone(),
                SourceQuery {
                    project_epoch: epoch.clone()
                },
                true
            ))
            .unwrap_err()
            .1,
        "NOT_FOUND"
    );
    assert_eq!(
        editor.asset_jobs.status(&job, &epoch, false).unwrap()["state"],
        "ready"
    );
    let before = ron::to_string(&editor.session.project).unwrap();
    let bytes = std::fs::read(root.join("changed.otio")).unwrap();
    std::fs::write(root.join("changed.otio"), [bytes.as_slice(), b" "].concat()).unwrap();
    let command = request(
        &editor,
        Operation::ImportPreparedOtio {
            job_id: job,
            name: "Changed".into(),
            reuse_existing: true,
        },
        "changed-otio",
        None,
    );
    assert_eq!(
        editor.mutation(None, command).unwrap_err().1,
        "SOURCE_CHANGED"
    );
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), before);
    let ready = prepared_otio_fixture(&mut editor, &root, "canceled.otio");
    let job = ready["id"].as_str().unwrap().to_owned();
    editor
        .handle(Action::OtioImportStatus(
            job.clone(),
            SourceQuery {
                project_epoch: epoch.clone(),
            },
            true,
        ))
        .unwrap();
    let command = request(
        &editor,
        Operation::ImportPreparedOtio {
            job_id: job,
            name: "Canceled".into(),
            reuse_existing: false,
        },
        "canceled-otio",
        None,
    );
    assert!(editor.mutation(None, command).is_err());
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), before);
    let ready = prepared_otio_fixture(&mut editor, &root, "stale.otio");
    let command = request(
        &editor,
        Operation::ImportPreparedOtio {
            job_id: ready["id"].as_str().unwrap().into(),
            name: "Stale".into(),
            reuse_existing: false,
        },
        "stale-otio",
        None,
    );
    editor.session.create_timeline(Timeline {
        name: "New edit".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![],
        markers: vec![],
        master: Default::default(),
    });
    let current = ron::to_string(&editor.session.project).unwrap();
    assert_eq!(
        editor.mutation(None, command).unwrap_err().1,
        "REVISION_CONFLICT"
    );
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), current);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn legacy_otio_save_failure_preserves_failed_job_and_cached_outcome() {
    let root = std::env::temp_dir().join(format!(
        "vv-otio-save-failure-{}",
        crate::asset_jobs::nonce()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let new = request(
        &editor,
        Operation::NewProject {
            name: "existing".into(),
        },
        "otio-existing-new",
        None,
    );
    editor.mutation(None, new).unwrap();
    prepared_otio_fixture(&mut editor, &root, "legacy.otio");
    let command = request(
        &editor,
        Operation::ImportOtio {
            path_token: "legacy.otio".into(),
            name: "existing".into(),
        },
        "otio-existing-save",
        None,
    );
    let NativeEditPreparation::Pending(guard) =
        editor.prepare_legacy_media_import(command.clone()).unwrap()
    else {
        panic!("Expected preparation");
    };
    let status = guard.jobs.status(&guard.job, &guard.epoch, false).unwrap();
    native_wait(&mut editor, &status);
    let jobs = guard.jobs.clone();
    let job = guard.job.clone();
    let epoch = guard.epoch.clone();
    let before = editor.snapshot();
    let host = Host::run(editor).unwrap();
    assert_eq!(
        host.finish_media_import(command.clone(), guard)
            .await
            .unwrap_err()
            .1,
        "FILE_EXISTS"
    );
    assert_eq!(jobs.status(&job, &epoch, false).unwrap()["state"], "failed");
    assert_eq!(
        host.project_mutation(command).await.unwrap_err().1,
        "FILE_EXISTS"
    );
    let after = host.call(Action::Session).await.unwrap();
    assert_eq!(after["history"], before["history"]);
    assert_eq!(after["project_epoch"], before["project_epoch"]);
    drop(host);
    drop(jobs);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn large_import_receipts_retire_the_cache_by_bytes_before_new_preparation() {
    let (root, mut editor, _) = native_asset_fixture("receipt-byte-budget");
    let epoch = editor.command_epoch;
    for index in 0..16 {
        editor.completed.insert(
            format!("large-{index}"),
            (
                [0; 32],
                Ok(json!({"status":"applied","errors":"x".repeat(1024*1024-1024)})),
            ),
        );
    }
    assert!(editor.completed.len() < MAX_RECEIPTS);
    assert_eq!(
        editor.native_command_capacity().unwrap_err().1,
        "COMMAND_EPOCH_EXPIRED"
    );
    assert!(editor.completed.is_empty());
    assert_eq!(editor.command_epoch, epoch + 1);
    editor.native_command_capacity().unwrap();
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn concurrent_legacy_import_owners_return_the_same_applied_or_failed_actor_outcome() {
    for succeeds in [true, false] {
        let (root, mut editor, _) = native_asset_fixture(if succeeds {
            "replay-applied"
        } else {
            "replay-failed"
        });
        if succeeds {
            std::fs::copy(root.join("capture.wav"), root.join("replay.wav")).unwrap();
        } else {
            std::fs::write(root.join("replay.wav"), b"invalid media").unwrap();
        }
        let command = request(
            &editor,
            Operation::ImportMedia {
                path_token: "replay.wav".into(),
            },
            "concurrent-import",
            None,
        );
        let NativeEditPreparation::Pending(mut first) =
            editor.prepare_legacy_media_import(command.clone()).unwrap()
        else {
            panic!("Expected the first preparation");
        };
        let status = first.jobs.status(&first.job, &first.epoch, false).unwrap();
        native_wait(&mut editor, &status);
        let NativeEditPreparation::Pending(second) =
            editor.prepare_legacy_media_import(command.clone()).unwrap()
        else {
            panic!("Expected a shared second preparation");
        };
        assert_eq!(first.job, second.job);
        // Both requests own the job before the first actor commit; the second polls later.
        let original = editor.mutation(None, command.clone());
        if succeeds {
            first.armed = false;
            assert_eq!(
                first.jobs.status(&first.job, &first.epoch, false).unwrap()["state"],
                "applied"
            );
        }
        drop(first);
        let expected = editor.snapshot();
        let host = Host::run(editor).unwrap();
        let replay = host.finish_media_import(command.clone(), second).await;
        match (&original, replay) {
            (Ok(receipt), Ok(replayed)) => assert_eq!(&replayed, receipt),
            (Err(error), Err(replayed)) => {
                assert_eq!(replayed.0, error.0);
                assert_eq!(replayed.1, error.1);
                assert_eq!(replayed.2, error.2);
                assert_eq!(replayed.0, axum::http::StatusCode::UNPROCESSABLE_ENTITY);
            }
            (original, replayed) => {
                panic!("Concurrent import outcome changed: {original:?} -> {replayed:?}")
            }
        }
        let retry = host.project_mutation(command).await;
        match (original, retry) {
            (Ok(receipt), Ok(replayed)) => assert_eq!(replayed, receipt),
            (Err(error), Err(replayed)) => {
                assert_eq!(replayed.0, error.0);
                assert_eq!(replayed.1, error.1);
                assert_eq!(replayed.2, error.2);
            }
            (original, replayed) => {
                panic!("Known import outcome changed: {original:?} -> {replayed:?}")
            }
        }
        let after = host.call(Action::Session).await.unwrap();
        assert_eq!(after["history"], expected["history"]);
        assert_eq!(after["media"], expected["media"]);
        assert_eq!(after["generation"], expected["generation"]);
        drop(host);
        std::fs::remove_dir_all(root).unwrap();
    }
}

fn prepare_import_batch(editor: &mut Editor, tokens: &[&str]) -> Value {
    let job = editor
        .handle(Action::PrepareMediaImport(MediaImportRequest {
            project_epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
            if_generation: editor.session.history.generation().to_string(),
            path_tokens: tokens.iter().map(|token| (*token).to_owned()).collect(),
        }))
        .unwrap();
    native_wait(editor, &job)
}
#[test]
fn prepared_media_import_preserves_order_partial_errors_native_hashes_and_one_undo() {
    use vv_core::Id;
    let (root, mut editor, existing) = native_asset_fixture("batch");
    let wav = std::fs::read(root.join("capture.wav")).unwrap();
    std::fs::write(root.join("first.wav"), &wav).unwrap();
    std::fs::write(root.join("second.wav"), &wav).unwrap();
    std::fs::write(root.join("bad.wav"), b"not media").unwrap();
    let position = editor.session.history.position();
    let generation = editor.session.history.generation();
    let ready = prepare_import_batch(
        &mut editor,
        &[
            "second.wav",
            "bad.wav",
            "capture.wav",
            "first.wav",
            "second.wav",
        ],
    );
    assert_eq!(ready["kind"], "media_import");
    assert_eq!(ready["progress"], json!({"completed":4,"total":4}));
    assert_eq!(
        ready["result"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["path_token"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["second.wav", "capture.wav", "first.wav"]
    );
    assert_eq!(ready["result"]["errors"][0]["path_token"], "bad.wav");
    assert_eq!(editor.session.history.generation(), generation);
    let command = request(
        &editor,
        Operation::ImportPreparedMedia {
            job_id: ready["id"].as_str().unwrap().into(),
        },
        "batch-import",
        None,
    );
    let receipt = editor.mutation(None, command.clone()).unwrap();
    let ids = receipt["media_ids"].as_array().unwrap();
    assert_eq!(ids.len(), 3);
    assert_eq!(ids[1], existing.raw().to_string());
    assert_eq!(receipt["errors"], ready["result"]["errors"]);
    assert_eq!(editor.session.history.position(), position + 1);
    let imported = ids
        .iter()
        .map(|id| vv_core::MediaId::from_raw(id.as_str().unwrap().parse().unwrap()))
        .collect::<Vec<_>>();
    for (id, name) in [(imported[0], "second.wav"), (imported[2], "first.wav")] {
        let item = &editor.session.project.media_pool[id];
        assert_eq!(item.path, root.join(name));
        assert_eq!(
            item.content_hash,
            vv_media::content_fingerprint(&root.join(name)).unwrap()
        );
    }
    assert_eq!(editor.mutation(None, command).unwrap(), receipt);
    assert_eq!(editor.session.history.position(), position + 1);
    let undo = request(&editor, Operation::Undo, "undo-batch", None);
    editor.mutation(None, undo).unwrap();
    assert!(editor.session.project.media_pool.contains_key(existing));
    assert!(!editor.session.project.media_pool.contains_key(imported[0]));
    assert!(!editor.session.project.media_pool.contains_key(imported[2]));
    let redo = request(&editor, Operation::Redo, "redo-batch", None);
    editor.mutation(None, redo).unwrap();
    assert!(
        imported
            .iter()
            .all(|id| editor.session.project.media_pool.contains_key(*id))
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn prepared_media_import_refuses_canceled_changed_and_stale_batches_before_native_allocation() {
    let (root, mut editor, _) = native_asset_fixture("batch-guards");
    let wav = std::fs::read(root.join("capture.wav")).unwrap();
    std::fs::write(root.join("guard.wav"), &wav).unwrap();
    let ready = prepare_import_batch(&mut editor, &["guard.wav"]);
    let command = request(
        &editor,
        Operation::ImportPreparedMedia {
            job_id: ready["id"].as_str().unwrap().into(),
        },
        "canceled-batch",
        None,
    );
    let before = ron::to_string(&editor.session.project).unwrap();
    let position = editor.session.history.position();
    editor.lease = Some(("another-browser".into(), Instant::now()));
    assert_eq!(
        editor.mutation(None, command.clone()).unwrap_err().1,
        "READ_ONLY"
    );
    editor.lease = None;
    editor
        .handle(Action::MediaImportStatus(
            ready["id"].as_str().unwrap().into(),
            SourceQuery {
                project_epoch: command.project_epoch.clone(),
            },
            true,
        ))
        .unwrap();
    assert!(editor.mutation(None, command).is_err());
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), before);
    assert_eq!(editor.session.history.position(), position);
    let ready = prepare_import_batch(&mut editor, &["guard.wav"]);
    let command = request(
        &editor,
        Operation::ImportPreparedMedia {
            job_id: ready["id"].as_str().unwrap().into(),
        },
        "changed-batch",
        None,
    );
    let mut changed = wav.clone();
    changed.push(0);
    std::fs::write(root.join("guard.wav"), changed).unwrap();
    assert_eq!(
        editor.mutation(None, command).unwrap_err().1,
        "SOURCE_CHANGED"
    );
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), before);
    std::fs::write(root.join("guard.wav"), &wav).unwrap();
    let ready = prepare_import_batch(&mut editor, &["guard.wav"]);
    let stale = request(
        &editor,
        Operation::ImportPreparedMedia {
            job_id: ready["id"].as_str().unwrap().into(),
        },
        "stale-batch",
        None,
    );
    let create = request(
        &editor,
        Operation::NewTimeline {
            name: "Changed".into(),
            fps: Rational::new(24, 1),
            resolution: [640, 360],
        },
        "timeline-before-batch",
        None,
    );
    editor.mutation(None, create).unwrap();
    let changed = ron::to_string(&editor.session.project).unwrap();
    assert_eq!(
        editor.mutation(None, stale).unwrap_err().1,
        "REVISION_CONFLICT"
    );
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), changed);
    let save = request(&editor, Operation::Save, "save-before-batch-switch", None);
    editor.mutation(None, save).unwrap();
    let ready = prepare_import_batch(&mut editor, &["guard.wav"]);
    let old_epoch = ready["project_epoch"].as_str().unwrap().to_owned();
    let switch = request(
        &editor,
        Operation::NewProject {
            name: "new-batch-project".into(),
        },
        "switch-batch-project",
        None,
    );
    editor.mutation(None, switch).unwrap();
    let canceled = editor
        .handle(Action::MediaImportStatus(
            ready["id"].as_str().unwrap().into(),
            SourceQuery {
                project_epoch: old_epoch,
            },
            true,
        ))
        .unwrap();
    assert_eq!(canceled["state"], "canceled");
    assert!(
        editor
            .session
            .project
            .media_pool
            .values()
            .all(|item| item.compound.is_some())
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

fn folder_editor() -> (std::path::PathBuf, Editor) {
    let root = std::env::temp_dir().join(format!(
        "vv-folder-command-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let editor = Editor::new(&root).unwrap();
    (root, editor)
}
fn folder_request(editor: &Editor, id: &str, name: &str) -> Mutation {
    request(
        editor,
        Operation::EditNativeAssetLibrary {
            edit: crate::asset_store::Edit::CreateFolder {
                folders_revision: editor.assets.folders().unwrap()["folders_revision"]
                    .as_str()
                    .unwrap()
                    .into(),
                name: name.into(),
                parent: None,
            },
        },
        id,
        None,
    )
}
fn folder_prepare(editor: &mut Editor, request: Mutation) -> NativeEditGuard {
    let NativeEditPreparation::Pending(guard) = editor.prepare_native_edit(request).unwrap() else {
        panic!("Expected a new folder preparation");
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let status = guard.jobs.status(&guard.job, &guard.epoch, false).unwrap();
        match status["state"].as_str().unwrap() {
            "ready" => return guard,
            "failed" | "canceled" => panic!("Folder preparation failed: {status}"),
            _ => {
                assert!(Instant::now() < deadline, "Folder preparation timed out");
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }
}

#[test]
fn native_folder_commit_has_one_durable_receipt_without_project_or_recovery_mutation() {
    let (root, mut editor) = folder_editor();
    let project = ron::to_string(&editor.session.project).unwrap();
    let generation = editor.session.history.generation();
    let position = editor.session.history.position();
    let command = folder_request(&editor, "create-folder", "Shared takes");
    let mut guard = folder_prepare(&mut editor, command.clone());
    let pending = editor.lookup("create-folder").unwrap();
    assert_eq!(pending["status"], "preparing");
    assert_eq!(pending["job_id"], guard.job);
    let receipt = editor.mutation(None, command.clone()).unwrap();
    guard.armed = false;
    assert_eq!(receipt["library_durable"], true);
    assert_eq!(receipt["receipt_persisted"], true);
    assert_eq!(
        receipt["durability"],
        json!({"state":"volatile","recovery_revision":null})
    );
    assert_eq!(
        receipt["command_epoch"],
        command.command_epoch.as_deref().unwrap()
    );
    let folders = std::fs::read(root.join(".assets/folders.json")).unwrap();
    let log = std::fs::read(root.join(".venturi-command-receipts.jsonl")).unwrap();
    assert!(
        matches!(editor.prepare_native_edit(command.clone()).unwrap(),NativeEditPreparation::Complete(value) if value==receipt)
    );
    assert_eq!(editor.mutation(None, command.clone()).unwrap(), receipt);
    assert_eq!(editor.lookup("create-folder").unwrap(), receipt);
    assert_eq!(
        std::fs::read(root.join(".assets/folders.json")).unwrap(),
        folders
    );
    assert_eq!(
        std::fs::read(root.join(".venturi-command-receipts.jsonl")).unwrap(),
        log
    );
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), project);
    assert_eq!(editor.session.history.generation(), generation);
    assert_eq!(editor.session.history.position(), position);
    assert!(editor.native_edits.is_empty());
    assert!(
        editor
            .assets
            .completion("create-folder", &editor.asset_binding)
            .unwrap()
            .is_none()
    );
    let mut changed = command;
    changed.client_id = "different-client".into();
    assert_eq!(
        editor.prepare_native_edit(changed).err().unwrap().1,
        "COMMAND_ID_REUSED"
    );
    drop(guard);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_folder_completion_is_harvested_on_restart_before_a_retry_or_unknown_lookup() {
    let (root, mut editor) = folder_editor();
    let command = folder_request(&editor, "crash-folder", "Recovered");
    let mut guard = folder_prepare(&mut editor, command.clone());
    let fingerprint = editor.native_edits["crash-folder"].fingerprint;
    let Operation::EditNativeAssetLibrary { edit } = &command.operation else {
        unreachable!()
    };
    guard
        .jobs
        .commit_edit(
            &command.command_id,
            fingerprint,
            &command.project_epoch,
            &command.if_generation,
            edit,
        )
        .unwrap();
    guard.armed = false;
    assert!(
        editor
            .assets
            .completion("crash-folder", "foreign-root-binding")
            .unwrap()
            .is_none()
    );
    assert!(
        editor
            .assets
            .completion("crash-folder", &editor.asset_binding)
            .unwrap()
            .is_some()
    );
    assert!(
        editor
            .receipts
            .as_ref()
            .unwrap()
            .recorded("crash-folder")
            .is_none()
    );
    let folders = std::fs::read(root.join(".assets/folders.json")).unwrap();
    drop(guard);
    drop(editor);
    let mut restarted = Editor::new(&root).unwrap();
    let receipt = restarted.lookup("crash-folder").unwrap();
    assert_eq!(receipt["status"], "applied");
    assert_eq!(receipt["server_restarted"], true);
    assert_eq!(receipt["receipt_persisted"], true);
    assert_eq!(receipt["durability"]["state"], "volatile");
    assert_eq!(restarted.mutation(None, command.clone()).unwrap(), receipt);
    assert_eq!(
        std::fs::read(root.join(".assets/folders.json")).unwrap(),
        folders
    );
    assert!(
        restarted
            .assets
            .completion("crash-folder", &restarted.asset_binding)
            .unwrap()
            .is_none()
    );
    let log = std::fs::read(root.join(".venturi-command-receipts.jsonl")).unwrap();
    assert_eq!(log.iter().filter(|byte| **byte == b'\n').count(), 1);
    let mut changed = command;
    changed.operation = Operation::EditNativeAssetLibrary {
        edit: crate::asset_store::Edit::CreateFolder {
            folders_revision: "absent".into(),
            name: "Other".into(),
            parent: None,
        },
    };
    assert_eq!(
        restarted.prepare_native_edit(changed).err().unwrap().1,
        "COMMAND_ID_REUSED"
    );
    drop(restarted);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn canceled_folder_preparations_keep_command_identity_without_exhausting_the_pending_map() {
    let (root, mut editor) = folder_editor();
    let command = folder_request(&editor, "canceled-folder", "Canceled");
    let guard = folder_prepare(&mut editor, command.clone());
    drop(guard);
    editor.prune_native_edits();
    assert!(editor.native_edits.is_empty());
    assert!(!root.join(".assets/folders.json").exists());
    let mut changed = command;
    changed.client_id = "changed-client".into();
    assert_eq!(
        editor.prepare_native_edit(changed).err().unwrap().1,
        "COMMAND_ID_REUSED"
    );
    // Evicted worker records still retain request identity until normal receipt retirement.
    for index in 0..64 {
        editor.native_edits.insert(
            format!("evicted-{index}"),
            PendingNativeEdit {
                fingerprint: [index as u8; 32],
                job: format!("missing-job-{index}"),
                epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
            },
        );
    }
    editor.prune_native_edits();
    assert!(editor.native_edits.is_empty());
    assert!(editor.completed.contains_key("evicted-63"));
    let next = folder_request(&editor, "after-cancellation", "Usable");
    let mut guard = folder_prepare(&mut editor, next.clone());
    editor.mutation(None, next).unwrap();
    guard.armed = false;
    assert_eq!(
        editor.assets.folders().unwrap()["folders"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    drop(guard);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn prepared_folder_commit_cannot_cross_receipt_epoch_retirement() {
    let (root, mut editor) = folder_editor();
    let command = folder_request(&editor, "retired-folder", "Not committed");
    let guard = folder_prepare(&mut editor, command.clone());
    let original_epoch = editor.command_epoch;
    for index in 0..MAX_RECEIPTS {
        editor.completed.insert(
            format!("older-{index}"),
            ([0; 32], Ok(json!({"status":"applied"}))),
        );
    }
    assert_eq!(
        editor.mutation(None, command).unwrap_err().1,
        "COMMAND_EPOCH_EXPIRED"
    );
    assert_eq!(editor.command_epoch, original_epoch + 1);
    assert!(!root.join(".assets/folders.json").exists());
    drop(guard);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_folder_readers_are_lease_free_cas_bound_and_preserve_unknown_native_membership() {
    let root = std::env::temp_dir().join(format!(
        "vv-native-folder-host-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let epoch = editor.snapshot()["project_epoch"]
        .as_str()
        .unwrap()
        .to_owned();
    editor.lease = Some(("another-browser".into(), Instant::now()));
    let project = ron::to_string(&editor.session.project).unwrap();
    let generation = editor.session.history.generation();
    let position = editor.session.history.position();
    let receipts = editor.completed.len();
    let folders = editor
        .handle(Action::NativeAssetFolders(SourceQuery {
            project_epoch: epoch.clone(),
        }))
        .unwrap();
    assert_eq!(
        folders,
        json!({"project_epoch":epoch,"version":1,"folders_revision":"absent","folders":[]})
    );
    let tree = json!({"version":1,"folders":[{"id":"parent","name":"Parent","parent":null},{"id":"child","name":"Child","parent":"parent"}]});
    std::fs::write(
        root.join(".assets/folders.json"),
        serde_json::to_vec(&tree).unwrap(),
    )
    .unwrap();
    let folders = editor
        .handle(Action::NativeAssetFolders(SourceQuery {
            project_epoch: epoch.clone(),
        }))
        .unwrap();
    let revision = folders["folders_revision"].as_str().unwrap().to_owned();
    assert_ne!(revision, "absent");
    assert_eq!(folders["folders"], tree["folders"]);
    let mut native = Session::default();
    let id = native.create_timeline(Timeline {
        name: "Native empty compound".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![],
        markers: vec![],
        master: Default::default(),
    });
    let media = native
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(id))
        .unwrap()
        .0;
    let mut asset = crate::asset_payload::capture(
        &native,
        media,
        "Unknown native folder",
        vv_core::clipboard::ClipboardOrigin {
            instance: 1,
            epoch: native.epoch(),
        },
    )
    .unwrap();
    asset.folder = Some("imported-orphan".into());
    editor.assets.create("orphan-asset", &asset).unwrap();
    let listed = editor
        .handle(Action::NativeAssetList(
            0,
            crate::asset_store::Query {
                project_epoch: epoch.clone(),
                folder: Some(String::new()),
                folders_revision: Some(revision.clone()),
                ..Default::default()
            },
        ))
        .unwrap();
    assert_eq!(listed["items"][0]["folder"], "imported-orphan");
    assert!(listed["items"][0]["effective_folder"].is_null());
    let loaded = editor.assets.item("orphan-asset", false).unwrap();
    assert_eq!(loaded["folder"], "imported-orphan");
    assert!(loaded["effective_folder"].is_null());
    let child = editor
        .handle(Action::NativeAssetList(
            0,
            crate::asset_store::Query {
                project_epoch: epoch.clone(),
                folder: Some("child".into()),
                folders_revision: Some(revision.clone()),
                ..Default::default()
            },
        ))
        .unwrap();
    assert!(child["items"].as_array().unwrap().is_empty());
    assert_eq!(child["total"], listed["total"]);
    assert_eq!(child["pages"], listed["pages"]);
    for (folder, folders_revision) in [
        (Some(String::new()), None),
        (Some("child".into()), Some("stale".into())),
        (Some("unknown".into()), Some(revision)),
    ] {
        assert!(
            editor
                .handle(Action::NativeAssetList(
                    0,
                    crate::asset_store::Query {
                        project_epoch: epoch.clone(),
                        folder,
                        folders_revision,
                        ..Default::default()
                    }
                ))
                .is_err()
        );
    }
    assert_eq!(
        editor
            .handle(Action::NativeAssetFolders(SourceQuery {
                project_epoch: "stale".into()
            }))
            .unwrap_err()
            .1,
        "REVISION_CONFLICT"
    );
    let malformed = b"not native folders JSON";
    std::fs::write(root.join(".assets/folders.json"), malformed).unwrap();
    assert!(
        editor
            .handle(Action::NativeAssetFolders(SourceQuery {
                project_epoch: epoch.clone()
            }))
            .is_err()
    );
    assert_eq!(
        std::fs::read(root.join(".assets/folders.json")).unwrap(),
        malformed
    );
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), project);
    assert_eq!(editor.session.history.generation(), generation);
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(editor.completed.len(), receipts);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

fn native_asset_fixture(label: &str) -> (std::path::PathBuf, Editor, vv_core::MediaId) {
    let root = std::env::temp_dir().join(format!(
        "vv-native-assets-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "assets".into(),
        },
        "asset-project",
        None,
    );
    editor.mutation(None, create).unwrap();
    let samples = 800u32;
    let bytes = samples * 2;
    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + bytes).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&8000u32.to_le_bytes());
    wav.extend_from_slice(&16000u32.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&bytes.to_le_bytes());
    wav.resize(44 + bytes as usize, 0);
    std::fs::write(root.join("capture.wav"), wav).unwrap();
    let (path, meta) = editor.files.probe("capture.wav").unwrap();
    let media = editor.session.add_media(path, meta);
    (root, editor, media)
}
fn native_prepare(editor: &mut Editor, action: NativeAssetAction) -> Value {
    editor
        .handle(Action::PrepareNativeAsset(NativeAssetRequest {
            project_epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
            if_generation: editor.session.history.generation().to_string(),
            action,
        }))
        .unwrap()
}
fn native_wait(editor: &mut Editor, job: &Value) -> Value {
    let id = job["id"].as_str().unwrap().to_owned();
    let epoch = job["project_epoch"].as_str().unwrap().to_owned();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let value = editor
            .handle(Action::NativeAssetStatus(
                id.clone(),
                SourceQuery {
                    project_epoch: epoch.clone(),
                },
                false,
            ))
            .unwrap();
        match value["state"].as_str().unwrap() {
            "ready" => return value,
            "failed" | "canceled" => panic!("Native asset job failed: {value}"),
            _ => {
                assert!(
                    Instant::now() < deadline,
                    "Native asset preparation timed out"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }
}
fn native_publish(editor: &mut Editor, media: vv_core::MediaId, id: &str) -> String {
    use vv_core::Id;
    let job = native_prepare(
        editor,
        NativeAssetAction::Capture {
            media_id: media.raw().to_string(),
            name: "Shared native take".into(),
        },
    );
    native_wait(editor, &job);
    let publish = request(
        editor,
        Operation::PublishNativeAsset {
            job_id: job["id"].as_str().unwrap().into(),
        },
        id,
        None,
    );
    editor.mutation(None, publish).unwrap();
    editor.assets.item(id, false).unwrap()["revision"]
        .as_str()
        .unwrap()
        .into()
}
fn native_import(editor: &mut Editor, id: &str, revision: &str, command: &str) -> Value {
    let job = native_prepare(
        editor,
        NativeAssetAction::Import {
            asset_id: id.into(),
            revision: revision.into(),
        },
    );
    native_wait(editor, &job);
    let import = request(
        editor,
        Operation::ImportNativeAsset {
            job_id: job["id"].as_str().unwrap().into(),
            asset_id: id.into(),
            revision: revision.into(),
        },
        command,
        None,
    );
    editor.mutation(None, import).unwrap()
}

#[test]
fn native_asset_capture_publish_is_lease_free_until_durable_library_write_and_has_no_history_step()
{
    use vv_core::Id;
    let (root, mut editor, media) = native_asset_fixture("publication");
    let position = editor.session.history.position();
    let generation = editor.session.history.generation();
    editor.lease = Some(("another-browser".into(), Instant::now()));
    let job = native_prepare(
        &mut editor,
        NativeAssetAction::Capture {
            media_id: media.raw().to_string(),
            name: "Native source".into(),
        },
    );
    let ready = native_wait(&mut editor, &job);
    assert!(ready["result"]["asset_id"].is_null());
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(editor.session.history.generation(), generation);
    let publish = request(
        &editor,
        Operation::PublishNativeAsset {
            job_id: job["id"].as_str().unwrap().into(),
        },
        "publish-native",
        None,
    );
    assert_eq!(
        editor.mutation(None, publish.clone()).unwrap_err().1,
        "READ_ONLY"
    );
    editor.lease = None;
    let receipt = editor.mutation(None, publish.clone()).unwrap();
    let bytes = editor.assets.export("publish-native").unwrap();
    assert_eq!(editor.mutation(None, publish.clone()).unwrap(), receipt);
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(editor.session.history.generation(), generation);
    assert!(receipt.get("media_ids").is_none());
    let asset = crate::asset_payload::parse(&bytes).unwrap();
    let payload = crate::asset_payload::decode(&asset).unwrap();
    assert_eq!(payload.media_ids().len(), 1);
    assert!(
        payload
            .files()
            .all(|item| item.path.starts_with(root.join(".assets/media")))
    );
    drop(editor);
    let mut editor = Editor::new(&root).unwrap();
    let mut restarted_receipt = receipt.clone();
    restarted_receipt["server_restarted"] = json!(true);
    assert_eq!(editor.mutation(None, publish).unwrap(), restarted_receipt);
    assert_eq!(editor.assets.export("publish-native").unwrap(), bytes);
    let old_status = editor.handle(Action::NativeAssetStatus(
        job["id"].as_str().unwrap().into(),
        SourceQuery {
            project_epoch: editor.snapshot()["project_epoch"].as_str().unwrap().into(),
        },
        false,
    ));
    assert!(old_status.is_err());
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_import_is_one_undo_and_redo_then_cached_reuse_preserves_an_edited_child() {
    use vv_core::{Clip, ClipId, ClipSource, Id};
    let (root, mut source, media) = native_asset_fixture("compound");
    let child = source.session.create_timeline(Timeline {
        name: "Native nested take".into(),
        fps: Rational::new(30, 1),
        resolution: (640, 360),
        tracks: vec![Track::new(TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    });
    source.session.project.timelines[child].tracks[0]
        .clips
        .push(Clip::from_source_range(
            ClipId(9007199254740993),
            ClipSource::Media(media),
            0,
            2,
            0,
            Rational::one(),
        ));
    let compound = source
        .session
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(child))
        .unwrap()
        .0;
    let revision = native_publish(&mut source, compound, "compound-asset");
    let target = root.join("target");
    let mut editor =
        Editor::with_libraries(&target, &target.join(".presets"), &root.join(".assets")).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "destination".into(),
        },
        "destination-project",
        None,
    );
    editor.mutation(None, create).unwrap();
    let position = editor.session.history.position();
    let media_before = editor.session.project.media_pool.len();
    let timelines_before = editor.session.project.timelines.len();
    let imported = native_import(&mut editor, "compound-asset", &revision, "import-compound");
    assert_eq!(editor.session.history.position(), position + 1);
    assert_eq!(editor.session.project.media_pool.len(), media_before + 2);
    assert_eq!(editor.session.project.timelines.len(), timelines_before + 1);
    let selected =
        vv_core::MediaId::from_raw(imported["media_ids"][0].as_str().unwrap().parse().unwrap());
    assert!(
        editor.session.project.media_pool[selected]
            .compound
            .is_some()
    );
    assert!(
        editor
            .session
            .project
            .media_pool
            .values()
            .filter(|item| item.compound.is_none())
            .all(|item| item.path.parent() == Some(target.as_path()))
    );
    let undo = request(&editor, Operation::Undo, "undo-native-import", None);
    editor.mutation(None, undo).unwrap();
    assert!(!editor.session.project.media_pool.contains_key(selected));
    assert_eq!(editor.session.project.timelines.len(), timelines_before);
    let redo = request(&editor, Operation::Redo, "redo-native-import", None);
    editor.mutation(None, redo).unwrap();
    assert!(editor.session.project.media_pool.contains_key(selected));
    editor.session.apply(Box::new(vv_core::RenameTimeline::new(
        selected,
        "Edited imported child".into(),
    )));
    let position = editor.session.history.position();
    let generation = editor.session.history.generation();
    let reused = native_import(&mut editor, "compound-asset", &revision, "reuse-compound");
    assert_eq!(reused["media_ids"], imported["media_ids"]);
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(editor.session.history.generation(), generation);
    let nested = editor.session.project.media_pool[selected]
        .compound
        .unwrap();
    assert_eq!(
        editor.session.project.timelines[nested].name,
        "Edited imported child"
    );
    drop(editor);
    drop(source);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_cache_invalidates_after_undo_removes_imported_ids() {
    let (root, mut source, media) = native_asset_fixture("cache-undo");
    let revision = native_publish(&mut source, media, "audio-asset");
    let target = root.join("target");
    let mut editor =
        Editor::with_libraries(&target, &target.join(".presets"), &root.join(".assets")).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "destination".into(),
        },
        "destination-project",
        None,
    );
    editor.mutation(None, create).unwrap();
    let first = native_import(&mut editor, "audio-asset", &revision, "first-import");
    let position = editor.session.history.position();
    let undo = request(&editor, Operation::Undo, "undo-import", None);
    editor.mutation(None, undo).unwrap();
    let imported = native_import(&mut editor, "audio-asset", &revision, "import-again");
    assert_ne!(imported["media_ids"], first["media_ids"]);
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(editor.session.history.labels().count(), position);
    drop(editor);
    drop(source);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_preparation_and_import_refuse_stale_context_forged_jobs_and_wrong_routes() {
    use vv_core::Id;
    let (root, mut editor, media) = native_asset_fixture("guards");
    let epoch = editor.snapshot()["project_epoch"]
        .as_str()
        .unwrap()
        .to_owned();
    let generation = editor.session.history.generation().to_string();
    let position = editor.session.history.position();
    for (project_epoch, if_generation) in [
        ("stale".to_owned(), generation.clone()),
        (epoch.clone(), "999".into()),
    ] {
        assert!(
            editor
                .handle(Action::PrepareNativeAsset(NativeAssetRequest {
                    project_epoch,
                    if_generation,
                    action: NativeAssetAction::Capture {
                        media_id: media.raw().to_string(),
                        name: "Rejected".into()
                    }
                }))
                .is_err()
        );
    }
    let missing = request(
        &editor,
        Operation::ImportNativeAsset {
            job_id: "forged".into(),
            asset_id: "asset".into(),
            revision: "0".repeat(64),
        },
        "forged-import",
        None,
    );
    assert!(editor.mutation(None, missing).is_err());
    assert_eq!(editor.session.history.position(), position);
    let job = native_prepare(
        &mut editor,
        NativeAssetAction::Capture {
            media_id: media.raw().to_string(),
            name: "Bound snapshot".into(),
        },
    );
    native_wait(&mut editor, &job);
    let timeline = editor.session.project.timelines.keys().next().unwrap();
    let timeline_request = request(
        &editor,
        Operation::PublishNativeAsset {
            job_id: job["id"].as_str().unwrap().into(),
        },
        "wrong-timeline-route",
        Some(timeline),
    );
    assert!(
        editor
            .mutation(Some(timeline.raw().to_string()), timeline_request)
            .is_err()
    );
    editor.session.create_timeline(Timeline {
        name: "Change generation".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![],
        markers: vec![],
        master: Default::default(),
    });
    let publish = request(
        &editor,
        Operation::PublishNativeAsset {
            job_id: job["id"].as_str().unwrap().into(),
        },
        "stale-publication",
        None,
    );
    assert_eq!(
        editor.mutation(None, publish).unwrap_err().1,
        "ASSET_CONTEXT_CHANGED"
    );
    assert!(editor.assets.item("stale-publication", false).is_err());
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_capture_counts_all_dependencies_before_opening_any_source_file() {
    use vv_core::{Clip, ClipId, ClipSource, Id, MediaItem};
    let (root, mut editor, media) = native_asset_fixture("file-count");
    let meta = editor.session.project.media_pool[media].meta.clone();
    let mut track = Track::new(TrackKind::Audio);
    for index in 0..65u64 {
        let file = editor.session.project.media_pool.insert(MediaItem {
            path: root.join(format!("not-created-{index}.wav")),
            meta: meta.clone(),
            content_hash: index + 1,
            compound: None,
            folder: None,
        });
        track.clips.push(Clip::from_source_range(
            ClipId(index + 1),
            ClipSource::Media(file),
            0,
            1,
            index as i64,
            Rational::one(),
        ));
    }
    let timeline = editor.session.create_timeline(Timeline {
        name: "Too many dependencies".into(),
        fps: Rational::new(30, 1),
        resolution: (640, 360),
        tracks: vec![track],
        markers: vec![],
        master: Default::default(),
    });
    let compound = editor
        .session
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(timeline))
        .unwrap()
        .0;
    let generation = editor.session.history.generation();
    let error = editor
        .handle(Action::PrepareNativeAsset(NativeAssetRequest {
            project_epoch: editor.snapshot()["project_epoch"].as_str().unwrap().into(),
            if_generation: generation.to_string(),
            action: NativeAssetAction::Capture {
                media_id: compound.raw().to_string(),
                name: "Refused before source IO".into(),
            },
        }))
        .unwrap_err();
    assert_eq!(error.1, "INVALID_OPERATION");
    assert!(error.2.contains("64 source files"));
    assert_eq!(editor.session.history.generation(), generation);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_invalid_payload_and_destination_limits_preserve_project_history_and_allocators() {
    use vv_core::{Clip, ClipId, ClipSource};
    let (root, mut source, _) = native_asset_fixture("atomic-import");
    let mut track = Track::new(TrackKind::Video);
    track.clips.push(Clip::from_source_range(
        ClipId(1),
        ClipSource::SolidColor,
        0,
        24,
        0,
        Rational::one(),
    ));
    let child = source.session.create_timeline(Timeline {
        name: "Generated native asset".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![track],
        markers: vec![],
        master: Default::default(),
    });
    let media = source
        .session
        .project
        .media_pool
        .iter()
        .find(|(_, item)| item.compound == Some(child))
        .unwrap()
        .0;
    let revision = native_publish(&mut source, media, "generated-asset");
    let target = root.join("target");
    let mut editor =
        Editor::with_libraries(&target, &target.join(".presets"), &root.join(".assets")).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "destination".into(),
        },
        "destination-project",
        None,
    );
    editor.mutation(None, create).unwrap();
    for index in 1..64 {
        editor.session.create_timeline(Timeline {
            name: format!("Existing {index}"),
            fps: Rational::new(24, 1),
            resolution: (640, 360),
            tracks: vec![],
            markers: vec![],
            master: Default::default(),
        });
    }
    let job = native_prepare(
        &mut editor,
        NativeAssetAction::Import {
            asset_id: "generated-asset".into(),
            revision: revision.clone(),
        },
    );
    native_wait(&mut editor, &job);
    let project = ron::to_string(&editor.session.project).unwrap();
    let generation = editor.session.history.generation();
    let position = editor.session.history.position();
    let import = request(
        &editor,
        Operation::ImportNativeAsset {
            job_id: job["id"].as_str().unwrap().into(),
            asset_id: "generated-asset".into(),
            revision,
        },
        "refused-project-size",
        None,
    );
    assert_eq!(
        editor.mutation(None, import).unwrap_err().1,
        "INVALID_OPERATION"
    );
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), project);
    assert_eq!(editor.session.history.generation(), generation);
    assert_eq!(editor.session.history.position(), position);
    assert!(editor.asset_imports.is_empty());
    let bad=br#"{"version":1,"name":"Malformed","folder":null,"payload":"venturi-clipboard/1\nnot a native project"}"#;
    std::fs::write(root.join(".assets/assets/malformed.json"), bad).unwrap();
    let bad_revision = format!("{:x}", Sha256::digest(bad));
    let prepared = editor.handle(Action::PrepareNativeAsset(NativeAssetRequest {
        project_epoch: editor.snapshot()["project_epoch"].as_str().unwrap().into(),
        if_generation: generation.to_string(),
        action: NativeAssetAction::Import {
            asset_id: "malformed".into(),
            revision: bad_revision,
        },
    }));
    assert!(prepared.is_err());
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), project);
    assert_eq!(editor.session.history.position(), position);
    drop(editor);
    drop(source);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_asset_project_switch_cancels_obsolete_jobs_and_accepts_exact_old_cancel_without_history()
{
    use vv_core::Id;
    let (root, mut editor, media) = native_asset_fixture("obsolete-project");
    let revision = native_publish(&mut editor, media, "published-before-switch");
    let published = editor.assets.export("published-before-switch").unwrap();
    let job = native_prepare(
        &mut editor,
        NativeAssetAction::Capture {
            media_id: media.raw().to_string(),
            name: "Unpublished old project".into(),
        },
    );
    native_wait(&mut editor, &job);
    let old_epoch = job["project_epoch"].as_str().unwrap().to_owned();
    let id = job["id"].as_str().unwrap().to_owned();
    let save = request(&editor, Operation::Save, "save-before-switch", None);
    editor.mutation(None, save).unwrap();
    let switch = request(
        &editor,
        Operation::NewProject {
            name: "next".into(),
        },
        "switch-project",
        None,
    );
    editor.mutation(None, switch).unwrap();
    assert_ne!(editor.snapshot()["project_epoch"], old_epoch);
    let project = ron::to_string(&editor.session.project).unwrap();
    let position = editor.session.history.position();
    let generation = editor.session.history.generation();
    let receipts = editor.completed.len();
    assert_eq!(
        editor
            .handle(Action::NativeAssetStatus(
                id.clone(),
                SourceQuery {
                    project_epoch: old_epoch.clone()
                },
                false
            ))
            .unwrap_err()
            .1,
        "REVISION_CONFLICT"
    );
    let canceled = editor
        .handle(Action::NativeAssetStatus(
            id.clone(),
            SourceQuery {
                project_epoch: old_epoch.clone(),
            },
            true,
        ))
        .unwrap();
    assert_eq!(canceled["state"], "canceled");
    assert_eq!(canceled["project_epoch"], old_epoch);
    assert!(canceled["result"].is_null());
    for (job_id, epoch) in [
        (id.clone(), "wrong-project".into()),
        ("foreign-job".into(), old_epoch.clone()),
        (
            id.clone(),
            editor.snapshot()["project_epoch"].as_str().unwrap().into(),
        ),
    ] {
        assert_eq!(
            editor
                .handle(Action::NativeAssetStatus(
                    job_id,
                    SourceQuery {
                        project_epoch: epoch
                    },
                    true
                ))
                .unwrap_err()
                .1,
            "NOT_FOUND"
        );
    }
    assert_eq!(ron::to_string(&editor.session.project).unwrap(), project);
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(editor.session.history.generation(), generation);
    assert_eq!(editor.completed.len(), receipts);
    let publish = request(
        &editor,
        Operation::PublishNativeAsset { job_id: id },
        "refused-old-job",
        None,
    );
    assert!(editor.mutation(None, publish).is_err());
    assert!(editor.assets.item("refused-old-job", false).is_err());
    assert_eq!(
        editor.assets.export("published-before-switch").unwrap(),
        published
    );
    assert_eq!(
        editor
            .assets
            .item("published-before-switch", false)
            .unwrap()["revision"],
        revision
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn compound_navigation_is_a_lease_free_reader_with_raw_frames_and_complete_parent_cas() {
    use crate::compound_navigation::{Ancestor, Navigation, Request as NavigationRequest};
    use vv_core::{Clip, ClipId, ClipSource, Id};
    let root = std::env::temp_dir().join(format!(
        "vv-navigation-host-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let make = |name: &str| Timeline {
        name: name.into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![Track::new(TrackKind::Video)],
        markers: vec![],
        master: Default::default(),
    };
    let parent = editor.session.create_timeline(make("Parent"));
    let child = editor.session.create_timeline(make("Child"));
    editor.session.project.timelines[child].tracks[0]
        .clips
        .push(Clip::from_source_range(
            ClipId(1),
            ClipSource::SolidColor,
            0,
            100,
            0,
            Rational::one(),
        ));
    let media = editor
        .session
        .project
        .media_pool
        .iter()
        .find(|(_, m)| m.compound == Some(child))
        .unwrap()
        .0;
    let clip = ClipId(9007199254740993);
    editor.session.project.timelines[parent].tracks[0]
        .clips
        .push(Clip::from_source_range(
            clip,
            ClipSource::Media(media),
            0,
            60,
            10,
            Rational::one(),
        ));
    editor.session.project.timelines[parent].tracks[0].locked = true;
    editor.lease = Some(("foreign-writer".into(), Instant::now()));
    let query = |editor: &Editor, id: vv_core::TimelineId, frame| FrameQuery {
        timeline_id: id.raw().to_string(),
        project_epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
        if_generation: editor.session.history.generation().to_string(),
        revision: editor.session.timeline_revision(id),
        frame,
        width: 320,
    };
    let before = serde_json::to_value(&editor.session.project).unwrap();
    let generation = editor.session.history.generation();
    let position = editor.session.history.position();
    let epoch = editor.command_epoch;
    let receipts = editor.completed.len();
    let source = query(&editor, parent, 10_000);
    assert!(
        editor.handle(Action::CheckFrame(source.clone())).is_err(),
        "Normal frame previews retain their content range restriction"
    );
    let request = NavigationRequest {
        query: source.clone(),
        action: Navigation::Enter {
            clip_ids: vec![clip.0.to_string()],
        },
    };
    let result = editor
        .handle(Action::CompoundNavigation(request.clone()))
        .unwrap();
    assert_eq!(result["frame"], 59);
    assert_eq!(result["source_frame"], 10_000);
    assert_eq!(result["timeline_id"], child.raw().to_string());
    for field in ["epoch", "generation", "revision", "width"] {
        let mut invalid = request.clone();
        match field {
            "epoch" => invalid.query.project_epoch = "stale".into(),
            "generation" => invalid.query.if_generation = "999".into(),
            "revision" => invalid.query.revision = "stale".into(),
            _ => invalid.query.width = 0,
        }
        assert!(
            editor.handle(Action::CompoundNavigation(invalid)).is_err(),
            "{field}"
        );
    }
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        before
    );
    assert_eq!(editor.session.history.generation(), generation);
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(editor.command_epoch, epoch);
    assert_eq!(editor.completed.len(), receipts);
    assert_eq!(editor.lease.as_ref().unwrap().0, "foreign-writer");
    let ancestor = Ancestor {
        timeline_id: parent.raw().to_string(),
        revision: editor.session.timeline_revision(parent),
        clip_id: Some(clip.0.to_string()),
        entry_playhead: 10_000,
    };
    let mut replacement = editor.session.project.timelines[parent].tracks[0].clips[0].clone();
    replacement.timeline_len = 50;
    editor.session.apply(Box::new(vv_core::SetClipValue::new(
        parent,
        0,
        clip,
        vv_core::CommandLabel::ReplaceTake,
        replacement,
        |clip: &mut Clip| clip,
    )));
    let exit = NavigationRequest {
        query: query(&editor, child, 20),
        action: Navigation::Exit {
            ancestors: vec![ancestor],
        },
    };
    let changed = serde_json::to_value(&editor.session.project).unwrap();
    assert_eq!(
        editor
            .handle(Action::CompoundNavigation(exit))
            .unwrap_err()
            .1,
        "REVISION_CONFLICT"
    );
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        changed
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn acknowledged_edits_have_a_synchronous_recovery_checkpoint_and_restart_receipt_without_replay() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-durable-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "durable".into(),
        },
        "durable-new",
        None,
    );
    let saved = editor.mutation(None, create).unwrap();
    assert_eq!(saved["durability"]["state"], "saved");
    let original = std::fs::read(root.join("durable.vvproj")).unwrap();
    let id = editor.session.project.timelines.keys().next().unwrap();
    let path = Some(vv_core::Id::raw(id).to_string());
    let add = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 48,
        },
        "durable-add",
        Some(id),
    );
    let ack = editor.mutation(path.clone(), add.clone()).unwrap();
    assert_eq!(ack["durability"]["state"], "recovery");
    assert_eq!(ack["receipt_persisted"], true);
    let revision = ack["durability"]["recovery_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    let expected = serde_json::to_value(&editor.session.project).unwrap();
    drop(editor);
    let mut editor = Editor::new(&root).unwrap();
    assert_eq!(editor.autosave.info()["state"], "pending");
    assert_eq!(editor.autosave.info()["revision"], revision);
    let mut recovered_ack = ack;
    recovered_ack["server_restarted"] = json!(true);
    assert_eq!(
        editor.handle(Action::Lookup("durable-add".into())).unwrap(),
        recovered_ack
    );
    assert_eq!(
        editor.mutation(path.clone(), add.clone()).unwrap(),
        recovered_ack
    );
    assert!(
        editor.session.project.timelines[id].tracks[0]
            .clips
            .is_empty()
    );
    let mut changed = add.clone();
    changed.operation = Operation::Undo;
    assert_eq!(
        editor.mutation(path.clone(), changed).unwrap_err().1,
        "COMMAND_ID_REUSED"
    );
    let mut unknown = add;
    unknown.command_id = "unrecorded-old-command".into();
    assert_eq!(
        editor.mutation(path, unknown).unwrap_err().1,
        "REVISION_CONFLICT"
    );
    editor
        .autosave
        .recover(&editor.files, &mut editor.session, &revision, "Kept", true)
        .unwrap();
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        expected
    );
    assert_eq!(
        std::fs::read(root.join("durable.vvproj")).unwrap(),
        original
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn incomplete_receipts_preserve_recovery_and_report_unavailable_persistence_without_failed_edits() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-torn-receipt-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let bytes = b"{interrupted-write";
    std::fs::write(root.join(".venturi-command-receipts.jsonl"), bytes).unwrap();
    let mut editor = Editor::new(&root).unwrap();
    assert!(editor.persistence_notice.is_some());
    let create = request(
        &editor,
        Operation::NewProject {
            name: "still_usable".into(),
        },
        "unavailable-new",
        None,
    );
    let ack = editor.mutation(None, create).unwrap();
    assert_eq!(ack["status"], "applied");
    assert_eq!(ack["receipt_persisted"], false);
    assert_eq!(
        std::fs::read(root.join(".venturi-command-receipts.jsonl")).unwrap(),
        bytes
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn receipt_rotation_keeps_editing_state_and_rejects_evicted_commands_even_without_a_history_change()
{
    let root = std::env::temp_dir().join(format!(
        "vv-web-receipts-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let mut create = request(
        &editor,
        Operation::NewProject {
            name: "rotation".into(),
        },
        "rotate-new",
        None,
    );
    create.command_epoch = None;
    editor.mutation(None, create).unwrap();
    let id = editor.session.project.timelines.keys().next().unwrap();
    let path = Some(vv_core::Id::raw(id).to_string());
    let add = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 48,
        },
        "rotate-add",
        Some(id),
    );
    editor.mutation(path.clone(), add).unwrap();
    let before = serde_json::to_value(&editor.session.project).unwrap();
    let generation = editor.session.history.generation();
    let position = editor.session.history.position();
    let project_epoch = editor.snapshot()["project_epoch"].clone();
    let oldest = request(
        &editor,
        Operation::CopyClips {
            clip_ids: vec!["0".into()],
        },
        "rotate-oldest",
        Some(id),
    );
    editor.mutation(path.clone(), oldest.clone()).unwrap();
    let mut boundary = None;
    for index in 0..5000 {
        let request = request(
            &editor,
            Operation::CopyClips {
                clip_ids: vec!["0".into()],
            },
            &format!("rotate-copy-{index}"),
            Some(id),
        );
        let epoch = editor.command_epoch;
        let result = editor.mutation(path.clone(), request.clone()).unwrap();
        if epoch != editor.command_epoch {
            boundary = Some((request, result));
        }
        assert!(editor.completed.len() <= MAX_RECEIPTS);
    }
    assert_eq!(editor.command_epoch, 1);
    assert_eq!(editor.session.history.generation(), generation);
    assert_eq!(editor.session.history.position(), position);
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        before
    );
    assert_eq!(editor.snapshot()["project_epoch"], project_epoch);
    assert_eq!(editor.snapshot()["clipboard_count"], 1);
    assert!(editor.session.has_unsaved_changes());
    assert_eq!(
        editor.mutation(path.clone(), oldest).unwrap_err().1,
        "COMMAND_EPOCH_EXPIRED"
    );
    let (record, result) = boundary.unwrap();
    assert_eq!(result["command_epoch"], "1");
    assert_eq!(
        editor.mutation(path.clone(), record.clone()).unwrap(),
        result
    );
    let mut reused = record;
    reused.operation = Operation::Undo;
    assert_eq!(
        editor.mutation(path, reused).unwrap_err().1,
        "COMMAND_ID_REUSED"
    );
    assert_eq!(editor.session.history.position(), position);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn unsupported_reopen_metadata_does_not_turn_a_successful_native_save_into_a_failed_command() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-resume-metadata-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    let future = b"{\"version\":2,\"future\":true}";
    std::fs::write(root.join(".venturi-last-project.json"), future).unwrap();
    let mut editor = Editor::new(&root).unwrap();
    assert!(editor.persistence_notice.is_some());
    let new = request(
        &editor,
        Operation::NewProject {
            name: "preserved".into(),
        },
        "resume-future-new",
        None,
    );
    assert_eq!(editor.mutation(None, new).unwrap()["status"], "applied");
    let save = request(&editor, Operation::Save, "resume-future-save", None);
    assert_eq!(editor.mutation(None, save).unwrap()["status"], "applied");
    assert!(!editor.session.has_unsaved_changes());
    assert!(editor.persistence_notice.is_some());
    assert!(root.join("preserved.vvproj").is_file());
    assert_eq!(
        std::fs::read(root.join(".venturi-last-project.json")).unwrap(),
        future
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn reopening_a_host_restores_only_the_last_saved_native_project_and_preserves_metadata_failures() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-host-resume-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let new = request(
        &editor,
        Operation::NewProject {
            name: "last_saved".into(),
        },
        "resume-new",
        None,
    );
    editor.mutation(None, new).unwrap();
    let timeline = editor.session.project.timelines.keys().next().unwrap();
    let edit = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 24,
        },
        "resume-edit",
        Some(timeline),
    );
    editor
        .mutation(Some(vv_core::Id::raw(timeline).to_string()), edit)
        .unwrap();
    let save = request(&editor, Operation::Save, "resume-save", None);
    editor.mutation(None, save).unwrap();
    let expected = serde_json::to_value(&editor.session.project).unwrap();
    drop(editor);
    let editor = Editor::new(&root).unwrap();
    assert!(!editor.session.has_unsaved_changes());
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        expected
    );
    assert_eq!(editor.snapshot()["project_name"], "last_saved.vvproj");
    assert!(editor.persistence_notice.is_none());
    drop(editor);
    std::fs::write(root.join("last_saved.vvproj"), b"external edit").unwrap();
    let mut editor = Editor::new(&root).unwrap();
    assert!(editor.session.path().is_none());
    assert!(editor.persistence_notice.is_some());
    let new = request(
        &editor,
        Operation::NewProject {
            name: "new_project".into(),
        },
        "resume-new-after-change",
        None,
    );
    editor.mutation(None, new).unwrap();
    assert!(editor.persistence_notice.is_none());
    assert_eq!(
        std::fs::read(root.join("last_saved.vvproj")).unwrap(),
        b"external edit"
    );
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}
fn request(
    editor: &Editor,
    operation: Operation,
    id: &str,
    timeline: Option<vv_core::TimelineId>,
) -> Mutation {
    Mutation {
        command_id: id.into(),
        client_id: "test-client".into(),
        command_epoch: Some(editor.command_epoch.to_string()),
        project_epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
        if_generation: editor.session.history.generation().to_string(),
        if_revision: timeline.map(|id| editor.session.timeline_revision(id)),
        operation,
    }
}

#[test]
fn external_save_conflicts_retain_dirty_native_edits_and_allow_a_retry_safe_save_as() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-save-conflict-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let new = request(
        &editor,
        Operation::NewProject {
            name: "original".into(),
        },
        "conflict-new",
        None,
    );
    editor.mutation(None, new).unwrap();
    let timeline = editor.session.project.timelines.keys().next().unwrap();
    let edit = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 24,
        },
        "conflict-edit",
        Some(timeline),
    );
    editor
        .mutation(Some(vv_core::Id::raw(timeline).to_string()), edit)
        .unwrap();
    let memory = serde_json::to_value(&editor.session.project).unwrap();
    let steps = editor.session.history.position();
    std::fs::write(root.join("original.vvproj"), b"external edit preserved").unwrap();
    let save = request(&editor, Operation::Save, "conflict-save", None);
    assert_eq!(
        editor.mutation(None, save.clone()).unwrap_err().1,
        "SAVE_CONFLICT"
    );
    assert_eq!(editor.mutation(None, save).unwrap_err().1, "SAVE_CONFLICT");
    assert!(editor.session.has_unsaved_changes());
    assert_eq!(editor.session.history.position(), steps);
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        memory
    );
    let copy = request(
        &editor,
        Operation::SaveAs {
            name: "preserved".into(),
        },
        "conflict-copy",
        None,
    );
    let reply = editor.mutation(None, copy.clone()).unwrap();
    assert_eq!(editor.mutation(None, copy).unwrap(), reply);
    assert!(!editor.session.has_unsaved_changes());
    assert_eq!(
        editor.files.load("preserved.vvproj").unwrap().timelines[timeline].tracks[0]
            .clips
            .len(),
        1
    );
    assert_eq!(
        std::fs::read(root.join("original.vvproj")).unwrap(),
        b"external edit preserved"
    );
    assert!(!root.join("original.vvproj.bak").exists());
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn recovering_a_backup_creates_a_retry_safe_copy_and_never_overwrites_the_original() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-recover-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let new = request(
        &editor,
        Operation::NewProject {
            name: "original".into(),
        },
        "recover-new",
        None,
    );
    editor.mutation(None, new).unwrap();
    let timeline = editor.session.project.timelines.keys().next().unwrap();
    let add = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 24,
        },
        "recover-edit",
        Some(timeline),
    );
    editor
        .mutation(Some(vv_core::Id::raw(timeline).to_string()), add)
        .unwrap();
    let dirty = request(
        &editor,
        Operation::RecoverBackup {
            path_token: "original.vvproj.bak".into(),
            name: "recovered".into(),
        },
        "recover-dirty",
        None,
    );
    assert_eq!(
        editor.mutation(None, dirty).unwrap_err().1,
        "UNSAVED_CHANGES"
    );
    assert!(!root.join("recovered.vvproj").exists());
    let save = request(&editor, Operation::Save, "recover-save", None);
    editor.mutation(None, save).unwrap();
    let backup = std::fs::read(root.join("original.vvproj.bak")).unwrap();
    std::fs::write(root.join("original.vvproj"), b"damaged current file").unwrap();
    let before = serde_json::to_value(&editor.session.project).unwrap();
    let epoch = editor.session.epoch();
    let duplicate = request(
        &editor,
        Operation::RecoverBackup {
            path_token: "original.vvproj.bak".into(),
            name: "original".into(),
        },
        "recover-existing",
        None,
    );
    assert_eq!(
        editor.mutation(None, duplicate).unwrap_err().1,
        "FILE_EXISTS"
    );
    assert_eq!(editor.session.epoch(), epoch);
    assert_eq!(
        serde_json::to_value(&editor.session.project).unwrap(),
        before
    );
    let recover = request(
        &editor,
        Operation::RecoverBackup {
            path_token: "original.vvproj.bak".into(),
            name: "recovered".into(),
        },
        "recover-copy",
        None,
    );
    editor.mutation(None, recover.clone()).unwrap();
    let recovered_epoch = editor.session.epoch();
    editor.mutation(None, recover).unwrap();
    assert_eq!(editor.session.epoch(), recovered_epoch);
    assert_ne!(epoch, recovered_epoch);
    assert_eq!(editor.session.project.timelines[timeline].total_frames(), 0);
    assert!(!editor.session.has_unsaved_changes());
    assert_eq!(
        editor.session.path().unwrap().file_name().unwrap(),
        "recovered.vvproj"
    );
    assert_eq!(
        std::fs::read(root.join("original.vvproj")).unwrap(),
        b"damaged current file"
    );
    assert_eq!(
        std::fs::read(root.join("original.vvproj.bak")).unwrap(),
        backup
    );
    assert!(editor.files.load("recovered.vvproj").is_ok());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn review_commands_are_retry_safe_copy_on_save_as_and_refuse_an_old_project_namespace() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-review-host-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "original".into(),
        },
        "review-project",
        None,
    );
    editor.mutation(None, create).unwrap();
    let edit = request(
        &editor,
        Operation::EditReview {
            project_token: "original.vvproj".into(),
            revision: "absent".into(),
            edit: crate::reviewmeta::Edit::NewShot {
                id: "arrival".into(),
                name: "Arrival".into(),
            },
        },
        "review-shot",
        None,
    );
    editor.mutation(None, edit.clone()).unwrap();
    let bytes = std::fs::read(root.join("original.vvproj.review.json")).unwrap();
    editor.mutation(None, edit).unwrap();
    assert_eq!(
        std::fs::read(root.join("original.vvproj.review.json")).unwrap(),
        bytes
    );
    assert_eq!(editor.session.history.position(), 0);
    let copy = request(
        &editor,
        Operation::SaveAs {
            name: "copy".into(),
        },
        "review-copy",
        None,
    );
    editor.mutation(None, copy).unwrap();
    assert_eq!(
        std::fs::read(root.join("copy.vvproj.review.json")).unwrap(),
        bytes
    );
    let current = crate::reviewmeta::read(&editor.files, &editor.session).unwrap();
    let wrong = request(
        &editor,
        Operation::EditReview {
            project_token: "original.vvproj".into(),
            revision: current["revision"].as_str().unwrap().into(),
            edit: crate::reviewmeta::Edit::DeleteShot {
                id: "arrival".into(),
            },
        },
        "review-old-namespace",
        None,
    );
    assert_eq!(
        editor.mutation(None, wrong).unwrap_err().1,
        "REVISION_CONFLICT"
    );
    assert_eq!(
        std::fs::read(root.join("copy.vvproj.review.json")).unwrap(),
        bytes
    );
    let orphan = root.join("orphan.vvproj.review.json");
    std::fs::write(&orphan, &bytes).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "orphan".into(),
        },
        "review-preserve-orphan",
        None,
    );
    assert_eq!(editor.mutation(None, create).unwrap_err().1, "FILE_EXISTS");
    assert!(!root.join("orphan.vvproj").exists());
    assert_eq!(std::fs::read(orphan).unwrap(), bytes);
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn otio_import_is_a_new_no_replace_project_with_epoch_and_retry_guards() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-otio-host-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let new = request(
        &editor,
        Operation::NewProject {
            name: "original".into(),
        },
        "otio-new",
        None,
    );
    editor.mutation(None, new).unwrap();
    let id = editor.session.project.timelines.keys().next().unwrap();
    let value = vv_core::otio::timeline_to_otio(&editor.session.project, id, None);
    std::fs::write(
        root.join("source.otio"),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    let import = request(
        &editor,
        Operation::ImportOtio {
            path_token: "source.otio".into(),
            name: "imported".into(),
        },
        "otio-import",
        None,
    );
    let NativeEditPreparation::Pending(mut guard) =
        editor.prepare_legacy_media_import(import.clone()).unwrap()
    else {
        panic!("Expected OTIO preparation");
    };
    let status = guard.jobs.status(&guard.job, &guard.epoch, false).unwrap();
    native_wait(&mut editor, &status);
    editor.mutation(None, import.clone()).unwrap();
    guard.armed = false;
    let epoch = editor.session.epoch();
    editor.mutation(None, import).unwrap();
    assert_eq!(editor.session.epoch(), epoch);
    assert!(root.join("imported.vvproj").is_file());
    assert!(root.join("original.vvproj").is_file());
    let duplicate = request(
        &editor,
        Operation::ImportOtio {
            path_token: "source.otio".into(),
            name: "original".into(),
        },
        "otio-existing",
        None,
    );
    let NativeEditPreparation::Pending(duplicate_guard) = editor
        .prepare_legacy_media_import(duplicate.clone())
        .unwrap()
    else {
        panic!("Expected OTIO preparation");
    };
    let status = duplicate_guard
        .jobs
        .status(&duplicate_guard.job, &duplicate_guard.epoch, false)
        .unwrap();
    native_wait(&mut editor, &status);
    assert_eq!(
        editor.mutation(None, duplicate.clone()).unwrap_err().1,
        "FILE_EXISTS"
    );
    assert_eq!(
        editor
            .prepare_legacy_media_import(duplicate)
            .err()
            .unwrap()
            .1,
        "FILE_EXISTS"
    );
    assert_eq!(
        duplicate_guard
            .jobs
            .status(&duplicate_guard.job, &duplicate_guard.epoch, false)
            .unwrap()["state"],
        "failed"
    );
    assert_eq!(editor.session.epoch(), epoch);
    let id = editor.session.project.timelines.keys().next().unwrap();
    let change = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 24,
        },
        "otio-dirty",
        Some(id),
    );
    editor
        .mutation(Some(vv_core::Id::raw(id).to_string()), change)
        .unwrap();
    let dirty = request(
        &editor,
        Operation::ImportOtio {
            path_token: "source.otio".into(),
            name: "discard".into(),
        },
        "otio-unsaved",
        None,
    );
    assert_eq!(
        editor.mutation(None, dirty).unwrap_err().1,
        "UNSAVED_CHANGES"
    );
    assert!(!root.join("discard.vvproj").exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn clipboard_bridge_is_retry_safe_and_copy_does_not_create_an_undo_step() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-clipboard-host-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "copy".into(),
        },
        "clipboard-new",
        None,
    );
    editor.mutation(None, create).unwrap();
    let id = editor.session.project.timelines.keys().next().unwrap();
    let path = Some(vv_core::Id::raw(id).to_string());
    let insert = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 24,
        },
        "clipboard-solid",
        Some(id),
    );
    editor.mutation(path.clone(), insert).unwrap();
    let clip = editor.session.project.timelines[id].tracks[0].clips[0]
        .id
        .0
        .to_string();
    let steps = editor.session.history.position();
    let copy = request(
        &editor,
        Operation::CopyClips {
            clip_ids: vec![clip],
        },
        "clipboard-copy",
        Some(id),
    );
    editor.mutation(path.clone(), copy.clone()).unwrap();
    editor.mutation(path.clone(), copy).unwrap();
    assert_eq!(editor.snapshot()["clipboard_count"], 1);
    assert_eq!(editor.session.history.position(), steps);
    let paste = request(
        &editor,
        Operation::PasteClips { frame: 48 },
        "clipboard-paste",
        Some(id),
    );
    editor.mutation(path.clone(), paste.clone()).unwrap();
    editor.mutation(path, paste).unwrap();
    assert_eq!(editor.session.history.position(), steps + 1);
    assert_eq!(
        editor.session.project.timelines[id].tracks[0].clips.len(),
        2
    );
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn retries_epochs_revisions_and_writer_lease() {
    let root = std::env::temp_dir().join(format!(
        "vv-web-host-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut editor = Editor::new(&root).unwrap();
    let create = request(
        &editor,
        Operation::NewProject {
            name: "test".into(),
        },
        "new",
        None,
    );
    editor.mutation(None, create.clone()).unwrap();
    editor.mutation(None, create).unwrap();
    assert_eq!(editor.session.epoch(), 1);
    let id = editor.session.project.timelines.keys().next().unwrap();
    let path = Some(vv_core::Id::raw(id).to_string());
    let add = request(
        &editor,
        Operation::AddSolid {
            track: "0".into(),
            start_frame: 0,
            length_frames: 48,
        },
        "add",
        Some(id),
    );
    let mut stale = add.clone();
    stale.command_id = "stale".into();
    editor.mutation(path.clone(), add.clone()).unwrap();
    let steps = editor.session.history.position();
    editor.mutation(path.clone(), add.clone()).unwrap();
    assert_eq!(editor.session.history.position(), steps);
    assert_eq!(
        editor.mutation(path.clone(), stale).unwrap_err().1,
        "REVISION_CONFLICT"
    );
    let mut reused = add;
    reused.operation = Operation::Undo;
    assert_eq!(
        editor.mutation(path.clone(), reused).unwrap_err().1,
        "COMMAND_ID_REUSED"
    );
    let mut other = request(&editor, Operation::Undo, "other", Some(id));
    other.client_id = "other-client".into();
    assert_eq!(
        editor.mutation(path.clone(), other).unwrap_err().1,
        "READ_ONLY"
    );
    let save = request(&editor, Operation::Save, "save", None);
    editor.mutation(None, save).unwrap();
    let reopen = request(
        &editor,
        Operation::OpenProject {
            path_token: "test.vvproj".into(),
        },
        "open",
        None,
    );
    editor.mutation(None, reopen).unwrap();
    assert_eq!(editor.session.epoch(), 2);
    assert_eq!(
        editor.session.project.timelines[id].tracks[0].clips.len(),
        1
    );
    let change = request(
        &editor,
        Operation::AddTrack { audio: false },
        "history-track",
        Some(id),
    );
    editor.mutation(path.clone(), change).unwrap();
    let jump = request(
        &editor,
        Operation::HistoryJump { position: 0 },
        "history-jump",
        None,
    );
    editor.mutation(None, jump.clone()).unwrap();
    editor.mutation(None, jump).unwrap();
    assert_eq!(editor.session.project.timelines[id].tracks.len(), 2);
    let redo = request(&editor, Operation::Redo, "history-redo", None);
    editor.mutation(None, redo).unwrap();
    assert_eq!(editor.session.project.timelines[id].tracks.len(), 3);
    let original = std::fs::read(root.join("test.vvproj")).unwrap();
    let save_as = request(
        &editor,
        Operation::SaveAs {
            name: "copy".into(),
        },
        "save-copy",
        None,
    );
    editor.mutation(None, save_as.clone()).unwrap();
    editor.mutation(None, save_as).unwrap();
    assert!(root.join("copy.vvproj").exists());
    assert_eq!(std::fs::read(root.join("test.vvproj")).unwrap(), original);
    let conflict = request(
        &editor,
        Operation::SaveAs {
            name: "test".into(),
        },
        "save-copy-conflict",
        None,
    );
    assert_eq!(
        editor.mutation(None, conflict).unwrap_err().1,
        "FILE_EXISTS"
    );
    assert_eq!(editor.session.path().unwrap(), root.join("copy.vvproj"));
    let new_timeline = request(
        &editor,
        Operation::NewTimeline {
            name: "Other rate".into(),
            fps: Rational::new(30000, 1001),
            resolution: [1280, 720],
        },
        "new-timeline",
        None,
    );
    editor.mutation(None, new_timeline).unwrap();
    assert_eq!(editor.session.project.timelines.len(), 2);
    let other = editor
        .session
        .project
        .timelines
        .values()
        .find(|t| t.name == "Other rate")
        .unwrap();
    assert_eq!(other.fps, Rational::new(30000, 1001));
    assert_eq!(other.resolution, (1280, 720));
    let invalid = request(
        &editor,
        Operation::NewTimeline {
            name: "Bad".into(),
            fps: Rational { num: 0, den: 1 },
            resolution: [0, 720],
        },
        "bad-timeline",
        None,
    );
    assert!(editor.mutation(None, invalid).is_err());
    assert_eq!(editor.session.project.timelines.len(), 2);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn keyframe_ruler_navigation_is_revision_bound_read_only_and_can_map_the_exclusive_clip_end() {
    use vv_core::{Clip, ClipId, ClipSource, Id};
    let root =
        std::env::temp_dir().join(format!("vv-keyclock-host-{}", crate::asset_jobs::nonce()));
    let mut editor = Editor::new(&root).unwrap();
    let mut track = Track::new(TrackKind::Video);
    let mut clip = Clip::from_source_range(
        ClipId(1),
        ClipSource::SolidColor,
        100,
        160,
        12,
        Rational::one(),
    );
    clip.freeze = Some(100);
    track.clips.push(clip);
    let timeline = editor.session.create_timeline(Timeline {
        name: "Native key ruler".into(),
        fps: Rational::new(24, 1),
        resolution: (64, 64),
        tracks: vec![track],
        markers: vec![],
        master: Default::default(),
    });
    let query = FrameQuery {
        timeline_id: timeline.raw().to_string(),
        project_epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
        if_generation: editor.session.history.generation().to_string(),
        revision: editor.session.timeline_revision(timeline),
        frame: 72,
        width: 64,
    };
    let before = editor.snapshot();
    let project = json!(editor.session.project);
    let receipts = editor.completed.len();
    let navigate = |query: FrameQuery, source_frame| {
        Action::KeyframeNavigation(
            "1".into(),
            KeyframeNavigationRequest {
                query,
                source_frame,
            },
        )
    };
    let value = editor.handle(navigate(query.clone(), 120)).unwrap();
    assert_eq!(
        value,
        json!({"clip_id":"1","source_frame":120,"timeline_frame":32,"project_epoch":query.project_epoch,"generation":query.if_generation,"timeline_id":query.timeline_id,"revision":query.revision})
    );
    assert_eq!(
        editor.handle(navigate(query.clone(), 999)).unwrap()["timeline_frame"],
        72
    );
    assert_eq!(
        editor.handle(navigate(query.clone(), 0)).unwrap()["timeline_frame"],
        12
    );
    assert!(editor.handle(Action::CheckFrame(query.clone())).is_err());
    let clock = editor
        .handle(Action::ClipDetail("1".into(), query.clone(), None))
        .unwrap();
    assert_eq!(clock["keyframe_clock"]["source_frame"], 160);
    for field in [
        "epoch",
        "generation",
        "revision",
        "timeline",
        "width",
        "frame",
    ] {
        let mut stale = query.clone();
        match field {
            "epoch" => stale.project_epoch.push('x'),
            "generation" => stale.if_generation = "999".into(),
            "revision" => stale.revision.push('x'),
            "timeline" => stale.timeline_id = "999".into(),
            "width" => stale.width = 0,
            _ => stale.frame = -1,
        }
        assert!(editor.handle(navigate(stale, 120)).is_err(), "{field}");
    }
    assert!(editor.handle(navigate(query.clone(), -1)).is_err());
    let mut within = query;
    within.frame = 12;
    let detail = editor
        .handle(Action::ClipDetail("1".into(), within.clone(), None))
        .unwrap();
    assert_eq!(detail["timeline_id"], within.timeline_id);
    assert_eq!(editor.snapshot(), before);
    assert_eq!(json!(editor.session.project), project);
    assert_eq!(editor.completed.len(), receipts);
    assert!(editor.lease.is_none());
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn curve_viewport_is_a_revision_bound_reader_even_on_locked_clips_and_past_content() {
    use vv_core::{Clip, ClipId, ClipSource, Id, Interpolation, TransformParam};
    let root = std::env::temp_dir().join(format!("vv-curve-reader-{}", crate::asset_jobs::nonce()));
    let mut editor = Editor::new(&root).unwrap();
    let mut track = Track::new(TrackKind::Video);
    track.locked = true;
    let raw = "9007199254740993";
    let mut clip = Clip::from_source_range(
        ClipId(raw.parse().unwrap()),
        ClipSource::SolidColor,
        100,
        160,
        12,
        Rational::one(),
    );
    clip.effects
        .transform
        .track_mut(TransformParam::Opacity)
        .upsert(100, 20.0, Interpolation::Linear);
    clip.effects
        .transform
        .track_mut(TransformParam::Opacity)
        .upsert(160, 80.0, Interpolation::Hold);
    track.clips.push(clip);
    let timeline = editor.session.create_timeline(Timeline {
        name: "Curve reader".into(),
        fps: Rational::new(24, 1),
        resolution: (64, 64),
        tracks: vec![track],
        markers: vec![],
        master: Default::default(),
    });
    let query = FrameQuery {
        timeline_id: timeline.raw().to_string(),
        project_epoch: format!("{}:{}", editor.epoch, editor.session.epoch()),
        if_generation: editor.session.history.generation().to_string(),
        revision: editor.session.timeline_revision(timeline),
        frame: 10000,
        width: 64,
    };
    let request = |query| crate::curves::ViewportRequest {
        query,
        target: crate::inspector::Target::Transform {
            param: TransformParam::Opacity,
        },
        source_start: 100,
        source_end: 160,
        points: 3,
    };
    let before = editor.snapshot();
    let project = json!(editor.session.project);
    let receipts = editor.completed.len();
    let value = editor
        .handle(Action::CurveViewport(raw.into(), request(query.clone())))
        .unwrap();
    assert_eq!(
        value,
        json!({"project_epoch":query.project_epoch,"generation":query.if_generation,
        "timeline_id":query.timeline_id,"revision":query.revision,"clip_id":raw,
        "target":{"kind":"transform","param":"Opacity"},"source_start":100,"source_end":160,
        "points":3,"samples":[[100.0,20.0],[130.0,50.0],[160.0,80.0]]})
    );
    for field in [
        "epoch",
        "generation",
        "revision",
        "timeline",
        "width",
        "frame",
    ] {
        let mut stale = query.clone();
        match field {
            "epoch" => stale.project_epoch.push('x'),
            "generation" => stale.if_generation = "999".into(),
            "revision" => stale.revision.push('x'),
            "timeline" => stale.timeline_id = "999".into(),
            "width" => stale.width = 0,
            _ => stale.frame = -1,
        }
        assert!(
            editor
                .handle(Action::CurveViewport(raw.into(), request(stale)))
                .is_err(),
            "{field}"
        );
    }
    assert!(
        editor
            .handle(Action::CurveViewport("999".into(), request(query)))
            .is_err()
    );
    assert_eq!(editor.snapshot(), before);
    assert_eq!(json!(editor.session.project), project);
    assert_eq!(editor.completed.len(), receipts);
    assert!(editor.lease.is_none());
    drop(editor);
    std::fs::remove_dir_all(root).unwrap();
}
