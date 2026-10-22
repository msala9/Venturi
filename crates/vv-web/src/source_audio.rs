use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    ops::{ControlFlow, Range},
    path::Path,
    sync::Arc,
};
use vv_audio::{
    SampleBlocks,
    mixer::{
        Channel, ClipInput, MixClip, MixSnapshot, MixState, mix_range_from, remix_channels_into,
    },
};
use vv_core::{ClipId, Keyframed, MediaMeta, Rational};
use vv_media::MediaError;

const MAX_PCM_BYTES: u64 = 256 * 1024 * 1024;
const MAX_CHUNK_SAMPLES: usize = 64 * 1024 * 1024;
const MAX_REMAPPED_CHUNK_SAMPLES: usize = 2 * 1024 * 1024;
const RATE: u32 = 48_000;
const CHANNELS: u16 = 2;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioMode {
    #[default]
    Selected,
    All,
}
fn invalid(message: &str) -> MediaError {
    MediaError::NoStream(message.into())
}
pub fn selection(meta: &MediaMeta, mode: AudioMode, index: u32) -> Result<Vec<usize>, MediaError> {
    let index = usize::try_from(index).map_err(|_| invalid("Invalid source audio ordinal"))?;
    let count = meta.audio_stream_count();
    if mode == AudioMode::All && index != 0 {
        return Err(invalid(
            "All-stream audio cannot select an individual ordinal",
        ));
    }
    if !meta.has_audio {
        return if index == 0 {
            Ok(Vec::new())
        } else {
            Err(invalid("Source has no audio"))
        };
    }
    if index >= count {
        return Err(invalid("The selected source audio stream is unavailable"));
    }
    Ok(match mode {
        AudioMode::Selected => vec![index],
        AudioMode::All => (0..count).collect(),
    })
}
pub fn sample_bounds(range: Range<i64>, fps: Rational) -> Result<Range<u64>, MediaError> {
    if range.start < 0 || range.end <= range.start || fps.num <= 0 || fps.den <= 0 {
        return Err(invalid("Invalid native source audio range"));
    }
    let sample = |frame: i64| {
        let numerator = i128::from(frame)
            .checked_mul(i128::from(fps.den))?
            .checked_mul(i128::from(RATE))?;
        u64::try_from(numerator.checked_add(i128::from(fps.num) / 2)? / i128::from(fps.num)).ok()
    };
    let start =
        sample(range.start).ok_or_else(|| invalid("Source audio sample position overflow"))?;
    let end = sample(range.end).ok_or_else(|| invalid("Source audio sample position overflow"))?;
    if end <= start || end - start > 600 * u64::from(RATE) {
        return Err(invalid(
            "Source audio mix exceeds its ten-minute range budget",
        ));
    }
    Ok(start..end)
}
pub fn working_bytes(streams: usize, bounds: &Range<u64>) -> Result<u64, MediaError> {
    let frames = bounds
        .end
        .checked_sub(bounds.start)
        .filter(|&frames| frames > 0 && frames <= 600 * u64::from(RATE))
        .ok_or_else(|| invalid("Invalid source audio sample range"))?;
    if streams == 0 {
        return Err(invalid("Source audio mix has no streams"));
    }
    let count =
        u64::try_from(streams).map_err(|_| invalid("Source audio stream count overflow"))?;
    let bytes = frames
        .checked_mul(u64::from(CHANNELS) * 4)
        .and_then(|bytes| bytes.checked_mul(count.checked_add(1)?))
        .and_then(|bytes| bytes.checked_add(count.checked_mul(1024 * 1024)?))
        .filter(|&bytes| bytes <= MAX_PCM_BYTES)
        .ok_or_else(|| invalid("Source audio mix exceeds its aggregate PCM budget"))?;
    Ok(bytes)
}
fn place(
    samples: &mut [f32],
    bounds: &Range<u64>,
    at: u64,
    chunk: &[f32],
) -> Result<(), MediaError> {
    if !chunk.len().is_multiple_of(usize::from(CHANNELS)) {
        return Err(invalid("Invalid remapped source audio chunk"));
    }
    let end = at
        .checked_add((chunk.len() / usize::from(CHANNELS)) as u64)
        .ok_or_else(|| invalid("Source audio chunk position overflow"))?;
    let from = at.max(bounds.start);
    let to = end.min(bounds.end);
    if from < to {
        let input =
            usize::try_from(from - at).map_err(|_| invalid("Source audio offset overflow"))? * 2;
        let output = usize::try_from(from - bounds.start)
            .map_err(|_| invalid("Source audio offset overflow"))?
            * 2;
        let count =
            usize::try_from(to - from).map_err(|_| invalid("Source audio count overflow"))? * 2;
        samples[output..output + count].copy_from_slice(&chunk[input..input + count]);
    }
    Ok(())
}
fn mix(
    windows: Vec<Vec<f32>>,
    bounds: Range<u64>,
    fps: Rational,
    mut keep_running: impl FnMut() -> bool,
) -> Result<Vec<f32>, MediaError> {
    let length = ((bounds.end - bounds.start) * u64::from(CHANNELS)) as usize;
    let clips = windows
        .into_iter()
        .map(|samples| MixClip {
            clip: ClipId(0),
            start: bounds.start,
            len: bounds.end - bounds.start,
            source_offset: bounds.start,
            step: 1.0,
            input: ClipInput::Blocks(SampleBlocks::contiguous(
                Arc::new(samples),
                bounds.start,
                CHANNELS,
            )),
            gain_db: Keyframed::constant(0.0),
            track: 0,
            clip_fps: fps.as_f64(),
            media_offset: bounds.start,
            media_step: 1.0,
            fade_in: 0,
            fade_out: 0,
        })
        .collect();
    let snapshot = MixSnapshot::new(RATE, CHANNELS, clips, Vec::new(), Channel::UNITY);
    let mut state = MixState::new(&snapshot);
    let mut output = vec![0.0; length];
    for (index, chunk) in output.chunks_mut(8192 * 2).enumerate() {
        if !keep_running() {
            return Err(MediaError::Cancelled);
        }
        mix_range_from(
            &snapshot,
            &mut state,
            bounds.start + index as u64 * 8192,
            chunk,
        );
    }
    Ok(output)
}
pub fn render(
    path: &Path,
    streams: &[usize],
    bounds: Range<u64>,
    fps: Rational,
    mut keep_running: impl FnMut() -> bool,
) -> Result<Vec<f32>, MediaError> {
    working_bytes(streams.len(), &bounds)?;
    if fps.num <= 0
        || fps.den <= 0
        || streams.iter().copied().collect::<HashSet<_>>().len() != streams.len()
    {
        return Err(invalid("Invalid source audio selection"));
    }
    if !keep_running() {
        return Err(MediaError::Cancelled);
    }
    let length = usize::try_from((bounds.end - bounds.start) * u64::from(CHANNELS))
        .map_err(|_| invalid("Source audio buffer overflow"))?;
    let mut windows = vec![vec![0.0; length]; streams.len()];
    let mut channels = vec![None; streams.len()];
    let mut completed = vec![false; streams.len()];
    let mut remapped = Vec::new();
    let mut failed = None;
    let mut cancelled = false;
    let formats = vv_media::decode_audio_streams_from(
        path,
        streams,
        RATE,
        bounds.start,
        |slot, count, at, chunk| {
            if !keep_running() {
                cancelled = true;
                return ControlFlow::Break(());
            }
            if slot >= windows.len()
                || count == 0
                || chunk.len() > MAX_CHUNK_SAMPLES
                || !chunk.len().is_multiple_of(usize::from(count))
                || channels[slot].is_some_and(|previous| previous != count)
            {
                failed = Some(invalid(
                    "Source audio format changed or exceeded its chunk budget",
                ));
                return ControlFlow::Break(());
            }
            channels[slot] = Some(count);
            if chunk.len() / usize::from(count) > MAX_REMAPPED_CHUNK_SAMPLES / usize::from(CHANNELS)
            {
                failed = Some(invalid("Remapped source audio exceeds its chunk budget"));
                return ControlFlow::Break(());
            }
            remapped.clear();
            remix_channels_into(chunk, count, CHANNELS, &mut remapped);
            if let Err(error) = place(&mut windows[slot], &bounds, at, &remapped) {
                failed = Some(error);
                return ControlFlow::Break(());
            }
            completed[slot] |=
                at.saturating_add((chunk.len() / usize::from(count)) as u64) >= bounds.end;
            if completed.iter().all(|&done| done) {
                ControlFlow::Break(())
            } else {
                ControlFlow::Continue(())
            }
        },
    )?;
    if cancelled || !keep_running() {
        return Err(MediaError::Cancelled);
    }
    if let Some(error) = failed {
        return Err(error);
    }
    if formats.len() != streams.len()
        || formats
            .iter()
            .any(|format| !matches!(format, Some((RATE, count)) if *count > 0))
    {
        return Err(invalid("A requested source audio stream is unavailable"));
    }
    drop(remapped);
    let output = mix(windows, bounds, fps, &mut keep_running)?;
    if !keep_running() {
        return Err(MediaError::Cancelled);
    }
    Ok(output)
}

#[cfg(test)]
#[path = "tests/source_audio.rs"]
mod tests;
