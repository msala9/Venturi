use super::*;
use vv_core::{
    Clip, ClipSource, CommandLabel, MediaItem, MediaMeta, Rational, Timeline, Track, TrackKind,
};

fn fixture() -> (
    Session,
    Files,
    std::path::PathBuf,
    MediaId,
    core::TimelineId,
) {
    let root = std::env::temp_dir().join(format!(
        "vv-web-catalog-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let files = Files::new(&root).unwrap();
    let mut session = Session::default();
    session.set_path(Some(root.join("test.vvproj")));
    let id = session.create_timeline(Timeline {
        name: "Media".into(),
        fps: Rational::new(24, 1),
        resolution: (640, 360),
        tracks: vec![Track::new(TrackKind::Audio)],
        markers: vec![],
        master: Default::default(),
    });
    let media = session.project.media_pool.insert(MediaItem {
        path: root.join("missing.wav"),
        meta: MediaMeta {
            duration_frames: 48,
            fps: Rational::new(24, 1),
            width: 0,
            height: 0,
            has_video: false,
            has_audio: true,
            sample_rate: 48000,
            channels: 1,
            audio_streams: 1,
            file: Default::default(),
        },
        content_hash: 10,
        compound: None,
        folder: None,
    });
    let clip = session.project.alloc_clip_id();
    session.project.timelines[id].tracks[0].insert_sorted(Clip::from_source_range(
        clip,
        ClipSource::Media(media),
        0,
        24,
        0,
        Rational::one(),
    ));
    (session, files, root, media, id)
}

fn wav(path: &std::path::Path, seconds: u32) {
    let samples = 48000 * seconds;
    let mut bytes = Vec::new();
    bytes.extend(b"RIFF");
    bytes.extend((36 + samples * 2).to_le_bytes());
    bytes.extend(b"WAVEfmt ");
    bytes.extend(16u32.to_le_bytes());
    bytes.extend(1u16.to_le_bytes());
    bytes.extend(1u16.to_le_bytes());
    bytes.extend(48000u32.to_le_bytes());
    bytes.extend(96000u32.to_le_bytes());
    bytes.extend(2u16.to_le_bytes());
    bytes.extend(16u16.to_le_bytes());
    bytes.extend(b"data");
    bytes.extend((samples * 2).to_le_bytes());
    bytes.resize(44 + (samples * 2) as usize, 0);
    std::fs::write(path, bytes).unwrap();
}

fn apply_prepared_relink(session: &mut Session, files: &Files, items: Vec<Relink>) -> Result<()> {
    let replacements = items
        .into_iter()
        .map(|item| {
            let id = MediaId::from_raw(item.media_id.parse().map_err(|_| ApiError::missing())?);
            let (path, meta, content_hash) = files.prepare_media(&item.path_token)?;
            Ok((
                id,
                crate::asset_jobs::PreparedMedia {
                    path_token: item.path_token,
                    path,
                    meta,
                    content_hash,
                },
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    if let Some(command) = prepared_relink(session, &replacements)? {
        session.apply(command);
    }
    Ok(())
}

#[test]
fn folder_hierarchy_moves_and_deletion_restore_native_membership_in_one_undo() {
    let (mut s, files, root, media, _) = fixture();
    edit(
        &mut s,
        &files,
        &Edit::NewFolder {
            name: "Scene".into(),
            parent: None,
        },
    )
    .unwrap();
    let a = s.project.folders.keys().next().unwrap();
    edit(
        &mut s,
        &files,
        &Edit::NewFolder {
            name: "Takes".into(),
            parent: Some(a.raw().to_string()),
        },
    )
    .unwrap();
    let b = s.project.folders.keys().find(|id| *id != a).unwrap();
    let before = serde_json::to_value(&s.project).unwrap();
    let position = s.history.position();
    assert!(
        edit(
            &mut s,
            &files,
            &Edit::MoveFolder {
                folder: a.raw().to_string(),
                parent: Some(b.raw().to_string())
            }
        )
        .is_err()
    );
    assert_eq!(s.history.position(), position);
    assert_eq!(serde_json::to_value(&s.project).unwrap(), before);
    edit(
        &mut s,
        &files,
        &Edit::MoveMedia {
            media_ids: vec![media.raw().to_string()],
            folder: Some(b.raw().to_string()),
        },
    )
    .unwrap();
    edit(
        &mut s,
        &files,
        &Edit::DeleteFolder {
            folder: b.raw().to_string(),
        },
    )
    .unwrap();
    assert_eq!(s.project.media_pool[media].folder, Some(a));
    s.history.undo(&mut s.project);
    assert_eq!(s.project.media_pool[media].folder, Some(b));
    s.history.redo(&mut s.project);
    assert_eq!(s.project.media_pool[media].folder, Some(a));
    assert_eq!(s.history.labels().last(), Some(CommandLabel::DeleteFolder));
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn relink_preserves_ids_and_keys_refuses_partial_batches_and_undo_restores_offline_media() {
    let (mut s, files, root, media, timeline) = fixture();
    wav(&root.join("replacement.wav"), 2);
    s.project.timelines[timeline].tracks[0].clips[0]
        .effects
        .gain_db
        .upsert(12, -6.0, core::Interpolation::EaseIn);
    let original = serde_json::to_value(&s.project).unwrap();
    let position = s.history.position();
    let item = Relink {
        media_id: media.raw().to_string(),
        path_token: "replacement.wav".into(),
    };
    assert!(
        apply_prepared_relink(
            &mut s,
            &files,
            vec![
                item.clone(),
                Relink {
                    media_id: "99999".into(),
                    path_token: "replacement.wav".into()
                }
            ]
        )
        .is_err()
    );
    assert_eq!(serde_json::to_value(&s.project).unwrap(), original);
    assert_eq!(s.history.position(), position);
    assert_eq!(
        edit(
            &mut s,
            &files,
            &Edit::Relink {
                items: vec![item.clone()]
            }
        )
        .unwrap_err()
        .1,
        "MEDIA_IMPORT_PREPARATION_REQUIRED"
    );
    let (path, meta, content_hash) = files.prepare_media(&item.path_token).unwrap();
    let replacement = crate::asset_jobs::PreparedMedia {
        path_token: item.path_token.clone(),
        path,
        meta,
        content_hash,
    };
    let command = prepared_relink(&s, &[(media, replacement.clone())])
        .unwrap()
        .unwrap();
    s.apply(command);
    assert_eq!(s.history.position(), position + 1);
    assert_eq!(
        s.project.media_pool[media].path,
        root.join("replacement.wav")
    );
    assert_eq!(
        s.project.timelines[timeline].tracks[0].clips[0]
            .effects
            .gain_db
            .keyframes()[0]
            .1,
        -6.0
    );
    s.history.undo(&mut s.project);
    assert_eq!(serde_json::to_value(&s.project).unwrap(), original);
    s.project.timelines[timeline].tracks[0].locked = true;
    assert_eq!(
        prepared_relink(&s, &[(media, replacement)])
            .err()
            .unwrap()
            .1,
        "TRACK_LOCKED"
    );
    assert!(
        edit(
            &mut s,
            &files,
            &Edit::RemoveMedia {
                media_ids: vec![media.raw().to_string()]
            }
        )
        .is_err()
    );
    assert!(root.join("replacement.wav").exists());
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn removal_keeps_offline_clips_and_source_files_and_symlink_relink_is_refused() {
    let (mut s, files, root, media, timeline) = fixture();
    wav(&root.join("source.wav"), 2);
    std::os::unix::fs::symlink(root.join("source.wav"), root.join("link.wav")).unwrap();
    assert!(
        apply_prepared_relink(
            &mut s,
            &files,
            vec![Relink {
                media_id: media.raw().to_string(),
                path_token: "link.wav".into()
            }]
        )
        .is_err()
    );
    edit(
        &mut s,
        &files,
        &Edit::RemoveMedia {
            media_ids: vec![media.raw().to_string()],
        },
    )
    .unwrap();
    assert!(!s.project.media_pool.contains_key(media));
    assert!(
        matches!(s.project.timelines[timeline].tracks[0].clips[0].source, ClipSource::Media(id) if id == media)
    );
    assert!(root.join("source.wav").exists());
    s.history.undo(&mut s.project);
    assert!(s.project.media_pool.contains_key(media));
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn relink_rejects_short_sources_path_escapes_and_duplicates_without_losing_existing_edits() {
    let (mut s, files, root, media, timeline) = fixture();
    wav(&root.join("short.wav"), 1);
    let (_, meta) = files.probe("short.wav").unwrap();
    s.project.media_pool[media].meta.duration_frames = meta.duration_frames + 48;
    s.project.timelines[timeline].tracks[0].clips[0].timeline_len = meta.duration_frames + 1;
    let original = serde_json::to_value(&s.project).unwrap();
    let position = s.history.position();
    for items in [
        vec![Relink {
            media_id: media.raw().to_string(),
            path_token: "short.wav".into(),
        }],
        vec![Relink {
            media_id: media.raw().to_string(),
            path_token: "../short.wav".into(),
        }],
        vec![
            Relink {
                media_id: media.raw().to_string(),
                path_token: "short.wav".into()
            };
            2
        ],
    ] {
        assert!(apply_prepared_relink(&mut s, &files, items).is_err());
        assert_eq!(serde_json::to_value(&s.project).unwrap(), original);
        assert_eq!(s.history.position(), position);
    }
    drop(files);
    std::fs::remove_dir_all(root).unwrap();
}
