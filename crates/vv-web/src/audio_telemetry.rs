use crate::error::{ApiError, Result};
use rustix::fs::{
    AtFlags, FlockOperation, Mode, OFlags, RenameFlags, openat, renameat_with, unlinkat,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs::File,
    io::{Read, Write},
    ops::Range,
    os::unix::fs::{FileExt, MetadataExt},
    path::{Path, PathBuf},
};
use vv_audio::{
    mixer::{MixSnapshot, PROJECT_SAMPLE_RATE},
    spectrum::{SpectrumTap, magnitudes_db},
};
use vv_core::{AudioEffectKind, MixerChannel, Timeline, TrackKind};

pub const MAX_BYTES: u64 = 32 * 1024 * 1024;
const META_BYTES: u64 = 64 * 1024;
const MAX_PAGE: u32 = 64;
const MAX_ACTIVITY_PAGE: u64 = 16;
const MAX_JSON: usize = 2 * 1024 * 1024;
const BANDS: usize = 128;
const BIN: u64 = vv_session::audio_render::OBSERVER_FRAMES;
const MAX_INSERTS: usize = vv_session::audio_render::MAX_OBSERVER_INSERTS;
const BINARY: &str = "audio-telemetry.bin";
const MANIFEST: &str = "audio-telemetry.json";
const BINARY_TEMP: &str = ".audio-telemetry.bin.partial";
const MANIFEST_TEMP: &str = ".audio-telemetry.json.partial";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Insert {
    channel: String,
    index: usize,
    kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    compressor: Option<vv_core::MultibandCompressor>,
}
impl Insert {
    fn native(&self) -> MixerChannel {
        if self.channel == "master" {
            MixerChannel::Master
        } else {
            MixerChannel::Track(self.channel.parse().expect("validated telemetry track"))
        }
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    version: u32,
    state: String,
    reason: Option<String>,
    sample_rate: u32,
    bin_frames: u64,
    start_sample: u64,
    end_sample: u64,
    first_bin_sample: Option<u64>,
    bin_count: u64,
    channels: Vec<String>,
    inserts: Vec<Insert>,
    inserts_available: bool,
    inserts_error: Option<String>,
    record_bytes: u64,
    binary_identity: Option<String>,
}
fn unavailable() -> ApiError {
    ApiError::conflict(
        "TELEMETRY_UNAVAILABLE",
        "Program audio telemetry is unavailable or changed",
    )
}
fn valid_channel(channel: &str) -> bool {
    channel == "master"
        || channel
            .parse::<usize>()
            .is_ok_and(|index| index < 128 && index.to_string() == channel)
}
fn directory(path: &Path) -> Result<File> {
    rustix::fs::open(
        path,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map(File::from)
    .map_err(|_| unavailable())
}
fn open(dir: &File, name: &str, write: bool) -> Result<File> {
    let flags = if write {
        OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL
    } else {
        OFlags::RDONLY
    };
    let file = File::from(
        openat(
            dir,
            name,
            flags | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR,
        )
        .map_err(|_| unavailable())?,
    );
    if !file.metadata().map_err(|_| unavailable())?.is_file() {
        return Err(unavailable());
    }
    rustix::fs::flock(
        &file,
        if write {
            FlockOperation::NonBlockingLockExclusive
        } else {
            FlockOperation::NonBlockingLockShared
        },
    )
    .map_err(|_| unavailable())?;
    Ok(file)
}
fn same(left: &File, right: &File) -> bool {
    left.metadata()
        .and_then(|a| {
            right
                .metadata()
                .map(|b| a.dev() == b.dev() && a.ino() == b.ino())
        })
        .unwrap_or(false)
}
fn remove_owned(dir: &File, name: &str, owned: &File) {
    if let Ok(fd) = openat(
        dir,
        name,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    ) {
        let live = File::from(fd);
        if same(owned, &live) {
            let _ = unlinkat(dir, name, AtFlags::empty());
        }
    }
}
fn record_bytes(channels: usize, inserts: usize) -> u64 {
    16 + (channels as u64 * 2 + BANDS as u64 + 1 + inserts as u64 * (2 * BANDS + 7) as u64) * 4
}
fn frequencies() -> Vec<f32> {
    (0..BANDS)
        .map(|index| 20.0 * 1000.0_f32.powf((index as f32 + 0.5) / BANDS as f32))
        .collect()
}
fn compact(values: &[f32]) -> Vec<f32> {
    let mut out = vec![-200.0_f32; BANDS];
    for (index, &value) in values.iter().enumerate().skip(1) {
        let hz =
            index as f32 * PROJECT_SAMPLE_RATE as f32 / vv_audio::spectrum::SPECTRUM_SIZE as f32;
        if (20.0..=20000.0).contains(&hz) {
            let band = ((hz / 20.0).ln() / 1000.0_f32.ln() * BANDS as f32).floor() as usize;
            let bin = &mut out[band.min(BANDS - 1)];
            *bin = bin.max(value);
        }
    }
    out
}
fn number(bytes: &mut Vec<u8>, value: f32) -> Result<()> {
    if !value.is_finite() {
        return Err(unavailable());
    }
    bytes.extend_from_slice(&value.to_le_bytes());
    Ok(())
}

pub struct Recorder {
    root: PathBuf,
    dir: File,
    file: Option<File>,
    manifest_file: Option<File>,
    meta: Manifest,
    master: SpectrumTap,
    insert_written: Vec<usize>,
    last_input_end: Option<u64>,
    last_end: Option<u64>,
    published_binary: bool,
    committed: bool,
}
impl Recorder {
    pub fn new(directory_path: &Path, timeline: &Timeline, range: Range<u64>) -> Result<Self> {
        if range.start >= range.end
            || range.end - range.start > 300 * u64::from(PROJECT_SAMPLE_RATE)
            || timeline.tracks.len() > 128
        {
            return Err(ApiError::invalid(
                "Telemetry requires a bounded Program audio window",
            ));
        }
        let dir = directory(directory_path)?;
        let channels: Vec<_> = timeline
            .tracks
            .iter()
            .enumerate()
            .filter(|(_, track)| track.kind == TrackKind::Audio)
            .map(|(index, _)| index.to_string())
            .chain(["master".to_string()])
            .collect();
        let mut inserts = Vec::new();
        let insert_count = timeline
            .tracks
            .iter()
            .map(|track| &track.mix)
            .chain([&timeline.master])
            .flat_map(|strip| &strip.effects)
            .filter(|effect| {
                effect.enabled
                    && matches!(
                        effect.kind,
                        AudioEffectKind::Equalizer(_) | AudioEffectKind::MultibandCompressor(_)
                    )
            })
            .count();
        for (channel, strip) in timeline
            .tracks
            .iter()
            .enumerate()
            .filter(|(_, track)| track.kind == TrackKind::Audio)
            .map(|(index, track)| (index.to_string(), &track.mix))
            .chain([("master".into(), &timeline.master)])
        {
            for (index, effect) in strip.effects.iter().enumerate() {
                let kind = match effect.kind {
                    AudioEffectKind::Equalizer(_) => "Equalizer",
                    AudioEffectKind::MultibandCompressor(_) => "MultibandCompressor",
                    _ => continue,
                };
                if effect.enabled && insert_count <= MAX_INSERTS {
                    inserts.push(Insert {
                        channel: channel.clone(),
                        index,
                        kind: kind.into(),
                        compressor: match &effect.kind {
                            AudioEffectKind::MultibandCompressor(params) => Some(params.clone()),
                            _ => None,
                        },
                    });
                }
            }
        }
        let max_bins = (range.end - range.start).div_ceil(BIN) + 1;
        let mut inserts_error = None;
        if insert_count > MAX_INSERTS
            || record_bytes(channels.len(), inserts.len()).saturating_mul(max_bins)
                > MAX_BYTES - META_BYTES
        {
            inserts.clear();
            inserts_error=Some("All insert telemetry is unavailable because its configured density exceeds the bounded sidecar budget".into());
        }
        let size = record_bytes(channels.len(), inserts.len());
        if size.saturating_mul(max_bins) > MAX_BYTES - META_BYTES {
            return Err(unavailable());
        }
        let stat = rustix::fs::fstatvfs(&dir).map_err(|_| unavailable())?;
        if stat.f_bavail.saturating_mul(stat.f_frsize) < 512 * 1024 * 1024 + size * max_bins {
            return Err(unavailable());
        }
        let file = open(&dir, BINARY_TEMP, true)?;
        let insert_written = vec![0; inserts.len()];
        Ok(Self {
            root: directory_path.into(),
            dir,
            file: Some(file),
            manifest_file: None,
            meta: Manifest {
                version: 1,
                state: "available".into(),
                reason: None,
                sample_rate: PROJECT_SAMPLE_RATE,
                bin_frames: BIN,
                start_sample: range.start,
                end_sample: range.end,
                first_bin_sample: None,
                bin_count: 0,
                channels,
                inserts,
                inserts_available: inserts_error.is_none(),
                inserts_error,
                record_bytes: size,
                binary_identity: None,
            },
            master: SpectrumTap::default(),
            insert_written,
            last_input_end: None,
            last_end: None,
            published_binary: false,
            committed: false,
        })
    }
    fn disable(&mut self) {
        self.meta.state = "unavailable".into();
        self.meta.reason = Some(
            "Native telemetry could not be recorded within its resource and identity bounds".into(),
        );
    }
    pub fn observe(&mut self, range: Range<u64>, pcm: &[f32], snapshot: &MixSnapshot) {
        if self.meta.state != "available" {
            return;
        }
        if range.start >= range.end
            || range.end - range.start > BIN
            || range.end > self.meta.end_sample
            || self
                .last_input_end
                .is_some_and(|previous| previous != range.start)
            || self.last_input_end.is_none() && range.start > self.meta.start_sample
            || pcm.len() != (range.end - range.start) as usize * 2
            || snapshot.sample_rate != PROJECT_SAMPLE_RATE
            || snapshot.channels != 2
            || pcm.iter().any(|sample| !sample.is_finite())
        {
            self.disable();
            return;
        }
        self.last_input_end = Some(range.end);
        self.master.record_post(pcm, 2);
        if range.end <= self.meta.start_sample {
            for (index, insert) in self.meta.inserts.iter().enumerate() {
                self.insert_written[index] = snapshot
                    .meters
                    .spectrum(insert.native(), insert.index)
                    .map_or(0, |tap| tap.written());
            }
            return;
        }
        if self.append(range, pcm, snapshot).is_err() {
            self.disable();
        }
    }
    fn append(&mut self, range: Range<u64>, pcm: &[f32], snapshot: &MixSnapshot) -> Result<()> {
        let first = self.meta.first_bin_sample.unwrap_or(range.start);
        let expected = first
            .checked_add(
                self.meta
                    .bin_count
                    .checked_mul(BIN)
                    .ok_or_else(unavailable)?,
            )
            .ok_or_else(unavailable)?;
        if range.start != expected
            || range.start >= range.end
            || range.end - range.start > BIN
            || range.end <= self.meta.start_sample
            || range.end > self.meta.end_sample
            || range.start.saturating_add(BIN) <= self.meta.start_sample
            || pcm.len() != (range.end - range.start) as usize * 2
            || snapshot.sample_rate != PROJECT_SAMPLE_RATE
            || snapshot.channels != 2
            || pcm.iter().any(|sample| !sample.is_finite())
            || self
                .meta
                .record_bytes
                .saturating_mul(self.meta.bin_count + 1)
                > MAX_BYTES - META_BYTES
        {
            return Err(unavailable());
        }
        let mut bytes = Vec::with_capacity(self.meta.record_bytes as usize);
        bytes.extend_from_slice(&range.start.to_le_bytes());
        bytes.extend_from_slice(&range.end.to_le_bytes());
        for channel in &self.meta.channels {
            let (left, right) = if channel == "master" {
                snapshot.meters.master().take()
            } else {
                snapshot
                    .meters
                    .track(channel.parse().map_err(|_| unavailable())?)
                    .map_or((0.0, 0.0), |peak| peak.take())
            };
            if left < 0.0 || right < 0.0 {
                return Err(unavailable());
            }
            number(&mut bytes, left)?;
            number(&mut bytes, right)?;
        }
        let spectrum = magnitudes_db(&self.master.read().1);
        for value in compact(&spectrum) {
            number(&mut bytes, value)?;
        }
        let peak = spectrum
            .iter()
            .enumerate()
            .skip(1)
            .max_by(|(_, a), (_, b)| a.total_cmp(b))
            .filter(|(_, value)| **value > -120.0)
            .map_or(-1.0, |(index, _)| {
                index as f32 * PROJECT_SAMPLE_RATE as f32 / vv_audio::spectrum::SPECTRUM_SIZE as f32
            });
        number(&mut bytes, peak)?;
        for (index, insert) in self.meta.inserts.iter().enumerate() {
            let candidate = snapshot.meters.spectrum(insert.native(), insert.index);
            let written = candidate.map_or(0, |tap| tap.written());
            let tap = candidate.filter(|_| written > self.insert_written[index]);
            self.insert_written[index] = written;
            number(&mut bytes, if tap.is_some() { 1.0 } else { 0.0 })?;
            if let Some(tap) = tap {
                let (before, after) = tap.read();
                for values in [before, after] {
                    for value in compact(&magnitudes_db(&values)) {
                        number(&mut bytes, value)?;
                    }
                }
            } else {
                for _ in 0..2 * BANDS {
                    number(&mut bytes, -200.0)?;
                }
            }
            let bands = snapshot
                .meters
                .band_meter(insert.native(), insert.index)
                .map(|meter| meter.take());
            for value in bands.map_or([0.0; 6], |bands| {
                [
                    bands.level[0],
                    bands.level[1],
                    bands.level[2],
                    bands.reduction_db[0],
                    bands.reduction_db[1],
                    bands.reduction_db[2],
                ]
            }) {
                number(&mut bytes, value)?;
            }
        }
        if bytes.len() as u64 != self.meta.record_bytes {
            return Err(unavailable());
        }
        let stat = rustix::fs::fstatvfs(&self.dir).map_err(|_| unavailable())?;
        if stat.f_bavail.saturating_mul(stat.f_frsize) < 512 * 1024 * 1024 + self.meta.record_bytes
        {
            return Err(unavailable());
        }
        self.file
            .as_mut()
            .ok_or_else(unavailable)?
            .write_all(&bytes)
            .map_err(|_| unavailable())?;
        self.meta.first_bin_sample = Some(first);
        self.meta.bin_count += 1;
        self.last_end = Some(range.end);
        Ok(())
    }
    pub fn finish(mut self) -> Result<()> {
        if !same(&self.dir, &directory(&self.root)?) {
            return Err(unavailable());
        }
        if self.meta.bin_count == 0 || self.last_end != Some(self.meta.end_sample) {
            self.disable();
        }
        if self.meta.state == "available" {
            let file = self.file.as_ref().ok_or_else(unavailable)?;
            file.sync_all().map_err(|_| unavailable())?;
            let live = File::from(
                openat(
                    &self.dir,
                    BINARY_TEMP,
                    OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
                    Mode::empty(),
                )
                .map_err(|_| unavailable())?,
            );
            if !same(file, &live) {
                return Err(unavailable());
            }
            renameat_with(
                &self.dir,
                BINARY_TEMP,
                &self.dir,
                BINARY,
                RenameFlags::NOREPLACE,
            )
            .map_err(|_| unavailable())?;
            self.published_binary = true;
            self.meta.binary_identity = Some(crate::asset_store::stable_identity(file)?);
        } else if let Some(file) = &self.file {
            remove_owned(&self.dir, BINARY_TEMP, file);
            self.meta.bin_count = 0;
            self.meta.first_bin_sample = None;
        }
        let bytes = serde_json::to_vec(&self.meta).map_err(|_| unavailable())?;
        if bytes.len() as u64 > META_BYTES {
            return Err(unavailable());
        }
        self.manifest_file = Some(open(&self.dir, MANIFEST_TEMP, true)?);
        let file = self.manifest_file.as_mut().unwrap();
        file.write_all(&bytes).map_err(|_| unavailable())?;
        file.sync_all().map_err(|_| unavailable())?;
        renameat_with(
            &self.dir,
            MANIFEST_TEMP,
            &self.dir,
            MANIFEST,
            RenameFlags::NOREPLACE,
        )
        .map_err(|_| unavailable())?;
        self.dir.sync_all().map_err(|_| unavailable())?;
        self.committed = true;
        Ok(())
    }
}
impl Drop for Recorder {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        if let Some(file) = &self.file {
            remove_owned(
                &self.dir,
                if self.published_binary {
                    BINARY
                } else {
                    BINARY_TEMP
                },
                file,
            );
        }
        if let Some(file) = &self.manifest_file {
            remove_owned(&self.dir, MANIFEST_TEMP, file);
            remove_owned(&self.dir, MANIFEST, file);
        }
    }
}

fn load(path: &Path) -> Result<(Manifest, File, Option<File>)> {
    let dir = directory(path)?;
    let mut file = open(&dir, MANIFEST, false)?;
    if file.metadata().map_err(|_| unavailable())?.len() > META_BYTES {
        return Err(unavailable());
    }
    let identity = crate::asset_store::stable_identity(&file)?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(META_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| unavailable())?;
    if bytes.len() as u64 > META_BYTES || crate::asset_store::stable_identity(&file)? != identity {
        return Err(unavailable());
    }
    let meta: Manifest = serde_json::from_slice(&bytes).map_err(|_| unavailable())?;
    let mut seen = std::collections::HashSet::new();
    let mut insert_ids = std::collections::HashSet::new();
    if meta.version != 1
        || meta.sample_rate != PROJECT_SAMPLE_RATE
        || meta.bin_frames != BIN
        || meta.start_sample >= meta.end_sample
        || meta.end_sample - meta.start_sample > 300 * u64::from(PROJECT_SAMPLE_RATE)
        || meta.channels.is_empty()
        || meta.channels.len() > 129
        || meta.channels.last().map(String::as_str) != Some("master")
        || meta
            .channels
            .iter()
            .any(|channel| !seen.insert(channel) || !valid_channel(channel))
        || meta.inserts.len() > MAX_INSERTS
        || meta.record_bytes != record_bytes(meta.channels.len(), meta.inserts.len())
        || meta.record_bytes.saturating_mul(meta.bin_count) > MAX_BYTES - META_BYTES
        || meta.inserts.iter().any(|insert| {
            !meta.channels.contains(&insert.channel)
                || !insert_ids.insert((&insert.channel, insert.index))
                || insert.index >= 32
                || !["Equalizer", "MultibandCompressor"].contains(&insert.kind.as_str())
                || insert.compressor.as_ref().is_some_and(|params| {
                    insert.kind != "MultibandCompressor"
                        || crate::audio::validate(&[vv_core::AudioEffect::new(
                            AudioEffectKind::MultibandCompressor(params.clone()),
                        )])
                        .is_err()
                })
        })
    {
        return Err(unavailable());
    }
    if meta.state == "unavailable" {
        return Ok((meta, file, None));
    }
    if meta.state != "available"
        || meta.bin_count == 0
        || meta.bin_count > (meta.end_sample - meta.start_sample).div_ceil(BIN) + 1
    {
        return Err(unavailable());
    }
    let first = meta.first_bin_sample.ok_or_else(unavailable)?;
    if first > meta.start_sample
        || first.saturating_add(BIN) <= meta.start_sample
        || (meta.end_sample - first).div_ceil(BIN) != meta.bin_count
    {
        return Err(unavailable());
    }
    let data = open(&dir, BINARY, false)?;
    let identity = crate::asset_store::stable_identity(&data)?;
    if data.metadata().map_err(|_| unavailable())?.len() != meta.record_bytes * meta.bin_count
        || meta.binary_identity.as_deref() != Some(identity.as_str())
    {
        return Err(unavailable());
    }
    Ok((meta, file, Some(data)))
}
fn metadata(meta: &Manifest) -> Value {
    json!({"state":meta.state,"reason":meta.reason,"sample_rate":meta.sample_rate,"bin_frames":meta.bin_frames,"start_sample":meta.start_sample,"end_sample":meta.end_sample,"first_bin_sample":meta.first_bin_sample,"bin_count":meta.bin_count,"inserts_available":meta.inserts_available,"inserts_error":meta.inserts_error,"inserts":meta.inserts,"spectrum_hz":frequencies(),"spectrum_kind":"native_fft_band_maximum","spectrum_frames":vv_audio::spectrum::SPECTRUM_SIZE})
}
pub fn descriptor(directory: &Path) -> Result<Value> {
    let (meta, _manifest, _binary) = load(directory)?;
    Ok(metadata(&meta))
}
pub fn read(
    directory: &Path,
    from_bin: u64,
    limit: u32,
    insert: Option<&crate::audition::InsertQuery>,
) -> Result<Value> {
    if !(1..=MAX_PAGE).contains(&limit) {
        return Err(ApiError::invalid("Read between 1 and 64 telemetry bins"));
    }
    let (meta, _manifest, binary) = load(directory)?;
    if meta.state != "available" {
        return Err(unavailable());
    }
    if from_bin > meta.bin_count {
        return Err(ApiError::invalid(
            "Telemetry page is outside this Program window",
        ));
    }
    let selected = if meta.inserts_available {
        insert
            .map(|query| {
                meta.inserts
                    .iter()
                    .position(|value| value.channel == query.channel && value.index == query.index)
                    .ok_or_else(|| {
                        ApiError::invalid("Select a recorded native EQ or compressor insert")
                    })
            })
            .transpose()?
    } else {
        None
    };
    let binary = binary.ok_or_else(unavailable)?;
    let mut count = (meta.bin_count - from_bin).min(u64::from(limit));
    if selected.is_some_and(|index| meta.inserts[index].compressor.is_some()) {
        // Native 241-point curves share the existing bounded JSON page.
        count = count.min(MAX_ACTIVITY_PAGE);
    }
    let mut bytes = vec![0; meta.record_bytes as usize * count as usize];
    binary
        .read_exact_at(&mut bytes, from_bin * meta.record_bytes)
        .map_err(|_| unavailable())?;
    let mut bins = Vec::new();
    for (index, record) in bytes.chunks_exact(meta.record_bytes as usize).enumerate() {
        let start = u64::from_le_bytes(record[..8].try_into().unwrap());
        let end = u64::from_le_bytes(record[8..16].try_into().unwrap());
        let expected = meta.first_bin_sample.unwrap() + (from_bin + index as u64) * BIN;
        if start != expected || end != start.saturating_add(BIN).min(meta.end_sample) {
            return Err(unavailable());
        }
        let mut values = record[16..]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|value| f32::from_le_bytes(*value));
        let mut take = || {
            values
                .next()
                .filter(|value| value.is_finite())
                .ok_or_else(unavailable)
        };
        let mut channels = Vec::new();
        for channel in &meta.channels {
            let peak = [take()?, take()?];
            if peak.iter().any(|value| *value < 0.0) {
                return Err(unavailable());
            }
            channels.push(json!({"channel":channel,"peak":peak,"db":peak.map(|value|(value>0.0).then(||20.0*value.log10())),"clipped":peak.map(|value|value>1.0)}));
        }
        let spectrum = (0..BANDS).map(|_| take()).collect::<Result<Vec<_>>>()?;
        let peak_hz = take()?;
        let mut effect = Value::Null;
        for (index, entry) in meta.inserts.iter().enumerate() {
            let active = take()?;
            if active != 0.0 && active != 1.0 {
                return Err(unavailable());
            }
            let before = (0..BANDS).map(|_| take()).collect::<Result<Vec<_>>>()?;
            let after = (0..BANDS).map(|_| take()).collect::<Result<Vec<_>>>()?;
            let level = [take()?, take()?, take()?];
            let reduction = [take()?, take()?, take()?];
            if level.iter().chain(&reduction).any(|value| *value < 0.0) {
                return Err(unavailable());
            }
            if selected == Some(index) {
                effect = json!({"channel":entry.channel,"index":entry.index,"kind":entry.kind,"inactive":active==0.0,"before_db":before,"after_db":after,"band_level":level,"reduction_db":reduction});
                let response = entry
                    .compressor
                    .as_ref()
                    .map(|params| {
                        crate::audio::compressor_activity_response(
                            params,
                            if active == 0.0 { [0.0; 3] } else { reduction },
                        )
                    })
                    .transpose()?;
                effect["response"] = json!(response);
                effect["response_error"] = json!(
                    (entry.kind == "MultibandCompressor" && entry.compressor.is_none()).then_some(
                        "This prepared window predates native compressor response metadata"
                    )
                );
            }
        }
        bins.push(json!({"start_sample":start,"end_sample":end,"channels":channels,"master_spectrum_db":spectrum,"master_peak_hz":(peak_hz>=0.0).then_some(peak_hz),"insert":effect}));
    }
    let identity = crate::asset_store::stable_identity(&binary)?;
    if meta.binary_identity.as_deref() != Some(identity.as_str()) {
        return Err(unavailable());
    }
    let mut result = metadata(&meta);
    result["from_bin"] = json!(from_bin);
    result["next_bin"] = json!((from_bin + count < meta.bin_count).then_some(from_bin + count));
    result["bins"] = json!(bins);
    if serde_json::to_vec(&result)
        .map_err(|_| unavailable())?
        .len()
        > MAX_JSON
    {
        return Err(ApiError::invalid(
            "Telemetry page exceeds 2 MiB; request fewer bins",
        ));
    }
    Ok(result)
}

#[cfg(test)]
#[path = "tests/audio_telemetry.rs"]
mod tests;
