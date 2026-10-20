use crate::{
    error::{ApiError, Result},
    files::Files,
    source::file_identity,
};
use axum::body::{Body, to_bytes};
use rustix::fs::{AtFlags, Mode, OFlags, RenameFlags, openat, renameat_with, unlinkat};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Write},
    os::fd::AsRawFd,
    path::PathBuf,
    sync::Arc,
    time::Duration,
};
use vv_core as core;
use vv_media::audio_file::{AudioFileFormat, write_audio_file};
use vv_session::Session;

pub const MAX_BYTES: usize = 64 * 1024 * 1024;
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    pub project_epoch: String,
    pub client_id: String,
    pub sample_rate: u32,
    pub channels: u16,
    #[serde(default = "wav")]
    pub format: String,
}
fn wav() -> String {
    "wav".into()
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    version: u32,
    id: String,
    pub path_token: String,
    format: String,
    raw_sha256: String,
    encoded_sha256: String,
    sample_rate: u32,
    channels: u16,
    frames: usize,
    source_version: String,
}
fn valid_id(id: &str) -> Result<()> {
    if id.len() != 36
        || !id.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()
            }
        })
    {
        return Err(ApiError::invalid("Invalid recording ID"));
    }
    Ok(())
}
fn format(id: &str) -> Result<AudioFileFormat> {
    AudioFileFormat::from_id(id)
        .ok_or_else(|| ApiError::invalid("Choose a native recording format"))
}
fn open(dir: &File, name: &str) -> Result<File> {
    let fd = openat(
        dir,
        name,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
        Mode::empty(),
    )
    .map_err(|_| ApiError::missing())?;
    let file = File::from(fd);
    if !file.metadata().map_err(|_| ApiError::io())?.is_file() {
        return Err(ApiError::invalid("Recording must be a regular file"));
    }
    Ok(file)
}
fn receipt(dir: &File, id: &str) -> Result<Receipt> {
    valid_id(id)?;
    let file = open(dir, &format!(".Voiceover-{id}.json"))?;
    if file.metadata().map_err(|_| ApiError::io())?.len() > 16 * 1024 {
        return Err(ApiError::invalid("Recording receipt exceeds its limit"));
    }
    let receipt: Receipt = serde_json::from_reader(file.take(16 * 1024 + 1))
        .map_err(|_| ApiError::invalid("Recording receipt is unreadable"))?;
    let format = format(&receipt.format)?;
    if receipt.version != 1
        || receipt.id != id
        || receipt.path_token != format!("Voiceover-{id}.{}", format.extension())
        || [&receipt.raw_sha256, &receipt.encoded_sha256]
            .iter()
            .any(|hash| hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        || !(1..=2).contains(&receipt.channels)
        || !(8000..=192000).contains(&receipt.sample_rate)
        || receipt.frames == 0
        || receipt.frames > MAX_BYTES / (4 * receipt.channels as usize)
        || receipt.frames > 300 * receipt.sample_rate as usize
    {
        return Err(ApiError::invalid(
            "Recording receipt does not match the requested take",
        ));
    }
    Ok(receipt)
}
pub fn recorded_path(dir: &File, id: &str) -> Result<String> {
    let receipt = receipt(dir, id)?;
    let file = open(dir, &receipt.path_token)?;
    if file_identity(&file)? != receipt.source_version {
        return Err(ApiError::conflict(
            "SOURCE_CHANGED",
            "The recorded file changed; import it explicitly from the media picker",
        ));
    }
    Ok(receipt.path_token)
}
#[derive(Clone)]
pub struct Store {
    dir: Arc<File>,
    slot: Arc<tokio::sync::Semaphore>,
}
impl Store {
    pub fn new(dir: File) -> Self {
        Self {
            dir: Arc::new(dir),
            slot: Arc::new(tokio::sync::Semaphore::new(1)),
        }
    }
    pub async fn upload(&self, id: String, query: Query, body: Body) -> Result<Value> {
        valid_id(&id)?;
        if !(8000..=192000).contains(&query.sample_rate)
            || !(1..=2).contains(&query.channels)
            || !format(&query.format)?.is_available()
        {
            return Err(ApiError::invalid(
                "Recording rate, channels or encoder are unavailable",
            ));
        }
        let permit = self.slot.clone().try_acquire_owned().map_err(|_| {
            ApiError::conflict("RECORDING_BUSY", "Another recording upload is in progress")
        })?;
        let bytes = tokio::time::timeout(Duration::from_secs(120), to_bytes(body, MAX_BYTES))
            .await
            .map_err(|_| ApiError::invalid("Recording upload timed out"))?
            .map_err(|_| ApiError::invalid("Recording upload exceeds 64 MiB or was interrupted"))?;
        let dir = self.dir.clone();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            encode(&dir, &id, &query, &bytes)
        })
        .await
        .map_err(|_| ApiError::invalid("Native recording encoding failed"))?
    }
    pub fn get(&self, id: &str) -> Result<Value> {
        let receipt = receipt(&self.dir, id)?;
        recorded_path(&self.dir, id)?;
        serde_json::to_value(receipt).map_err(|_| ApiError::io())
    }
    pub fn asset(&self, id: &str) -> Result<(File, &'static str, String)> {
        let receipt = receipt(&self.dir, id)?;
        recorded_path(&self.dir, id)?;
        let mime = match format(&receipt.format)? {
            AudioFileFormat::Wav => "audio/wav",
            AudioFileFormat::Mp3 => "audio/mpeg",
            AudioFileFormat::Flac => "audio/flac",
            AudioFileFormat::Aac => "audio/mp4",
            AudioFileFormat::Opus | AudioFileFormat::Vorbis => "audio/ogg",
        };
        Ok((
            open(&self.dir, &receipt.path_token)?,
            mime,
            receipt.encoded_sha256,
        ))
    }
}
fn digest(mut file: File) -> Result<String> {
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    let mut bytes = 0;
    loop {
        let count = file.read(&mut buffer).map_err(|_| ApiError::io())?;
        if count == 0 {
            break;
        }
        bytes += count;
        if bytes > MAX_BYTES + 1024 * 1024 {
            return Err(ApiError::invalid("Encoded recording exceeds its limit"));
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn encode(dir: &File, id: &str, query: &Query, bytes: &[u8]) -> Result<Value> {
    let stride = 4 * query.channels as usize;
    if bytes.is_empty()
        || bytes.len() > MAX_BYTES
        || !bytes.len().is_multiple_of(stride)
        || bytes.len() / stride > 300 * query.sample_rate as usize
    {
        return Err(ApiError::invalid(
            "Recording must contain complete PCM frames within five minutes and 64 MiB",
        ));
    }
    let raw_sha256 = format!("{:x}", Sha256::digest(bytes));
    let previous = receipt(dir, id);
    if previous.is_err()
        && rustix::fs::statat(
            dir,
            format!(".Voiceover-{id}.json"),
            AtFlags::SYMLINK_NOFOLLOW,
        )
        .is_ok()
    {
        return Err(ApiError::conflict(
            "FILE_EXISTS",
            "An unreadable recording receipt was preserved",
        ));
    }
    if let Ok(existing) = previous {
        if existing.raw_sha256 != raw_sha256
            || existing.sample_rate != query.sample_rate
            || existing.channels != query.channels
            || existing.format != query.format
        {
            return Err(ApiError::conflict(
                "RECORDING_ID_REUSED",
                "Recording ID already belongs to different captured audio",
            ));
        }
        if recorded_path(dir, id).is_ok() {
            return serde_json::to_value(existing).map_err(|_| ApiError::io());
        }
    }
    let samples = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|bytes| f32::from_le_bytes(*bytes))
        .collect::<Vec<_>>();
    if samples.iter().any(|sample| !sample.is_finite()) {
        return Err(ApiError::invalid("Recording samples must be finite"));
    }
    let format = format(&query.format)?;
    let name = format!("Voiceover-{id}.{}", format.extension());
    let temp = format!(".Voiceover-{id}.tmp");
    let meta_temp = format!(".Voiceover-{id}.json.tmp");
    let result = (|| {
        let output = File::from(
            openat(
                dir,
                temp.as_str(),
                OFlags::RDWR | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| ApiError::io())?,
        );
        let path = PathBuf::from(format!("/proc/self/fd/{}", output.as_raw_fd()));
        write_audio_file(&path, format, &samples, query.sample_rate, query.channels)
            .map_err(|_| ApiError::invalid("The native audio encoder could not save this take"))?;
        output.sync_all().map_err(|_| ApiError::io())?;
        let encoded_sha256 = digest(open(dir, &temp)?)?;
        match renameat_with(
            dir,
            temp.as_str(),
            dir,
            name.as_str(),
            RenameFlags::NOREPLACE,
        ) {
            Ok(()) => {}
            Err(rustix::io::Errno::EXIST) => {
                if digest(open(dir, &name)?)? != encoded_sha256 {
                    return Err(ApiError::conflict(
                        "FILE_EXISTS",
                        "A different recorded file was preserved; recover it from the media picker",
                    ));
                }
            }
            Err(_) => return Err(ApiError::io()),
        }
        let receipt = Receipt {
            version: 1,
            id: id.into(),
            path_token: name.clone(),
            format: query.format.clone(),
            raw_sha256,
            encoded_sha256,
            sample_rate: query.sample_rate,
            channels: query.channels,
            frames: bytes.len() / stride,
            source_version: file_identity(&open(dir, &name)?)?,
        };
        let metadata = File::from(
            openat(
                dir,
                meta_temp.as_str(),
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| ApiError::io())?,
        );
        let mut metadata = metadata;
        serde_json::to_writer(&mut metadata, &receipt).map_err(|_| ApiError::io())?;
        metadata.flush().map_err(|_| ApiError::io())?;
        metadata.sync_all().map_err(|_| ApiError::io())?;
        rustix::fs::renameat(
            dir,
            meta_temp.as_str(),
            dir,
            format!(".Voiceover-{id}.json"),
        )
        .map_err(|_| ApiError::io())?;
        dir.sync_all().map_err(|_| ApiError::io())?;
        serde_json::to_value(receipt).map_err(|_| ApiError::io())
    })();
    let _ = unlinkat(dir, temp.as_str(), AtFlags::empty());
    let _ = unlinkat(dir, meta_temp.as_str(), AtFlags::empty());
    result
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Placement {
    pub recording_id: String,
    pub tracks: Vec<String>,
    pub start_frame: i64,
    #[serde(default)]
    pub latency_frames: i64,
    #[serde(default)]
    pub overwrite: bool,
}
struct Source {
    existing: Option<core::MediaId>,
    path: PathBuf,
    meta: core::MediaMeta,
    hash: u64,
}
pub fn place(
    session: &mut Session,
    files: &Files,
    id: core::TimelineId,
    placement: &Placement,
) -> Result<()> {
    if session.path().is_none() {
        return Err(ApiError::invalid(
            "Save the project before placing a recording",
        ));
    }
    let name = recorded_path(&files.root_file()?, &placement.recording_id)?;
    let (path, meta, hash) = files.prepare_media(&name)?;
    if !meta.has_audio
        || meta.has_video
        || placement.start_frame < 0
        || placement.start_frame > crate::commands::MAX_FRAME
        || !(-240..=240).contains(&placement.latency_frames)
        || placement.tracks.is_empty()
        || placement.tracks.len() > 64
    {
        return Err(ApiError::invalid(
            "Choose armed audio tracks, a valid start and latency correction",
        ));
    }
    let existing = session.media_with_path(&path);
    if existing.is_some_and(|media| {
        session.project.timelines.values().any(|tl| {
            tl.tracks.iter().any(|track| {
                track.clips.iter().any(
                    |clip| matches!(clip.source,core::ClipSource::Media(source) if source==media),
                )
            })
        })
    }) {
        return Err(ApiError::conflict(
            "TAKE_ALREADY_PLACED",
            "This take is already in the project; use the media pool to reuse it",
        ));
    }
    let timeline = &session.project.timelines[id];
    let mut seen = HashSet::new();
    let mut tracks = Vec::new();
    let rate = core::Rational::conform_rate(timeline.fps, meta.fps);
    let mut sample = core::Clip::from_source_range(
        core::ClipId(0),
        core::ClipSource::SolidColor,
        0,
        meta.duration_frames,
        (placement.start_frame - placement.latency_frames).max(0),
        rate,
    );
    let trim = (placement.latency_frames - placement.start_frame).max(0);
    sample.source_offset += trim;
    sample.timeline_len -= trim;
    if sample.timeline_len <= 0 || sample.timeline_end() > crate::commands::MAX_FRAME {
        return Err(ApiError::invalid(
            "Latency correction leaves no audio or exceeds timeline limits",
        ));
    }
    let mut overwritten_groups = HashSet::new();
    for raw in &placement.tracks {
        let index = raw.parse::<usize>().map_err(|_| ApiError::missing())?;
        let track = timeline.tracks.get(index).ok_or_else(ApiError::missing)?;
        if !seen.insert(index)
            || track.kind != core::TrackKind::Audio
            || !track.armed
            || track.locked
        {
            return Err(ApiError::invalid(
                "Every recording target must be a distinct armed, unlocked audio track",
            ));
        }
        for clip in &track.clips {
            if clip.timeline_start < sample.timeline_end()
                && sample.timeline_start < clip.timeline_end()
            {
                if !placement.overwrite {
                    return Err(ApiError::conflict(
                        "OVERLAP",
                        "The take would overwrite audio; choose an empty armed track or explicitly enable overwrite",
                    ));
                }
                overwritten_groups.extend(clip.linked_group);
            }
        }
        tracks.push(index);
    }
    if timeline.tracks.iter().any(|track| {
        track.locked
            && track.clips.iter().any(|clip| {
                clip.linked_group
                    .is_some_and(|group| overwritten_groups.contains(&group))
            })
    }) {
        return Err(ApiError::conflict(
            "TRACK_LOCKED",
            "Overwriting this take would affect a locked linked clip",
        ));
    }
    let mut trial = Session::default();
    trial.project = session.project.clone();
    let source = Source {
        existing,
        path,
        meta,
        hash,
    };
    place_native(&mut trial, id, &source, &tracks, &sample);
    trial.sync_timeline_media(id);
    crate::files::validate_project(&trial.project)?;
    place_native(session, id, &source, &tracks, &sample);
    session.sync_timeline_media(id);
    Ok(())
}
fn place_native(
    session: &mut Session,
    id: core::TimelineId,
    source: &Source,
    tracks: &[usize],
    sample: &core::Clip,
) {
    let mark = session.history.begin_group();
    let media = source.existing.unwrap_or_else(|| {
        let mut entities = core::AddEntities::new(core::CommandLabel::ImportMedia);
        let media = entities.media(
            &mut session.project,
            core::MediaItem {
                path: source.path.clone(),
                meta: source.meta.clone(),
                content_hash: source.hash,
                compound: None,
                folder: None,
            },
        );
        session.apply(Box::new(entities));
        media
    });
    let clips = tracks
        .iter()
        .map(|&track| {
            let mut clip = sample.clone();
            clip.id = session.project.alloc_clip_id();
            clip.source = core::ClipSource::Media(media);
            (track, clip, None::<u64>)
        })
        .collect();
    core::edit::insert_clips(
        &mut session.project,
        &mut session.history,
        id,
        clips,
        core::CommandLabel::RecordVoiceover,
    );
    for &track in tracks {
        session.apply(Box::new(core::SetTrackFlag::new(
            id,
            track,
            core::TrackFlag::Armed,
            false,
        )));
    }
    session
        .history
        .end_group_as(mark, core::CommandLabel::RecordVoiceover);
}

#[cfg(test)]
#[path = "tests/recording.rs"]
mod tests;
