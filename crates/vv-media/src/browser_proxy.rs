use crate::{
    MediaError,
    audio_file::{AudioFileFormat, write_audio_file},
    proxy::ProxyQuality,
};
use ffmpeg_next as ffmpeg;
use std::{
    ops::{ControlFlow, Range},
    path::Path,
};

const MAX_AUDIO_SAMPLES: usize = 64 * 1024 * 1024;

/// CPU-only source proxy with the first audio stream. The caller owns `directory`.
pub fn generate(
    source: &Path,
    directory: &Path,
    quality: ProxyQuality,
    mut keep_running: impl FnMut(u64) -> bool,
) -> Result<(), MediaError> {
    let video = directory.join("video.mp4");
    let audio = directory.join("audio.m4a");
    let output = directory.join("source.mp4");
    let meta = crate::probe_media(source)?;
    if meta.has_video {
        crate::proxy::generate_proxy_at(source, &video, quality, &[], 2, &mut keep_running)?;
    }
    if meta.has_audio {
        let mut samples = Vec::new();
        let mut stopped = false;
        let formats = crate::decode_audio_streams_streaming(source, &[0], None, |_, _, chunk| {
            if samples.len() + chunk.len() > MAX_AUDIO_SAMPLES || !keep_running(0) {
                stopped = true;
                return ControlFlow::Break(());
            }
            samples.extend_from_slice(chunk);
            ControlFlow::Continue(())
        })?;
        if stopped {
            return Err(MediaError::Cancelled);
        }
        let (rate, channels) =
            formats[0].ok_or_else(|| MediaError::NoStream("Missing source audio".into()))?;
        write_audio_file(&audio, AudioFileFormat::Aac, &samples, rate, channels)?;
    }
    if !keep_running(0) {
        return Err(MediaError::Cancelled);
    }
    match (meta.has_video, meta.has_audio) {
        (true, true) => mux(&video, &audio, &output, || keep_running(0))?,
        (true, false) => {
            std::fs::rename(&video, &output)?;
        }
        (false, true) => {
            std::fs::rename(&audio, &output)?;
        }
        _ => {
            return Err(MediaError::NoStream(
                "Source has no playable streams".into(),
            ));
        }
    }
    Ok(())
}

/// Uses the same stream-origin normalization as the full-file browser proxy.
pub fn generate_range(
    source: &Path,
    directory: &Path,
    quality: ProxyQuality,
    range: Range<vv_core::FrameIdx>,
    mut keep_running: impl FnMut(u64) -> bool,
) -> Result<(), MediaError> {
    if !keep_running(0) {
        return Err(MediaError::Cancelled);
    }
    let meta = crate::probe_media(source)?;
    crate::proxy::validate_range(&range, meta.fps, meta.duration_frames)?;
    let video = directory.join("video.mp4");
    let audio = directory.join("audio.m4a");
    let output = directory.join("source.mp4");
    if meta.has_video {
        crate::proxy::generate_proxy_range_at(
            source,
            &video,
            quality,
            range.clone(),
            2,
            &mut keep_running,
        )?;
    }
    if meta.has_audio {
        let bounds = audio_sample_range(&range, meta.fps)?;
        let mut samples = Vec::new();
        let mut channels = None;
        let mut cancelled = false;
        let mut failure = None;
        let formats = crate::decode_audio_streams_from(
            source,
            &[0],
            48_000,
            bounds.start,
            |_, count, at, chunk| {
                if !keep_running(0) {
                    cancelled = true;
                    return ControlFlow::Break(());
                }
                if channels.is_some_and(|previous| previous != count) {
                    failure = Some(crate::proxy::range_error(
                        "Source audio channel count changed",
                    ));
                    return ControlFlow::Break(());
                }
                channels = Some(count);
                if let Err(error) = copy_audio_window(&mut samples, count, &bounds, at, chunk) {
                    failure = Some(error);
                    return ControlFlow::Break(());
                }
                if at.saturating_add((chunk.len() / usize::from(count.max(1))) as u64) >= bounds.end
                {
                    ControlFlow::Break(())
                } else {
                    ControlFlow::Continue(())
                }
            },
        )?;
        if cancelled {
            return Err(MediaError::Cancelled);
        }
        if let Some(error) = failure {
            return Err(error);
        }
        let (_, count) =
            formats[0].ok_or_else(|| MediaError::NoStream("Missing source audio".into()))?;
        copy_audio_window(&mut samples, count, &bounds, bounds.end, &[])?;
        if !keep_running(0) {
            return Err(MediaError::Cancelled);
        }
        write_audio_file(&audio, AudioFileFormat::Aac, &samples, 48_000, count)?;
    }
    let staging = directory.join(format!("source.tmp-{}.mp4", std::process::id()));
    let publish = (|| {
        if !keep_running(0) {
            return Err(MediaError::Cancelled);
        }
        match (meta.has_video, meta.has_audio) {
            (true, true) => mux(&video, &audio, &staging, || keep_running(0))?,
            (true, false) => std::fs::rename(&video, &staging)?,
            (false, true) => std::fs::rename(&audio, &staging)?,
            _ => {
                return Err(MediaError::NoStream(
                    "Source has no playable streams".into(),
                ));
            }
        }
        if !keep_running(0) {
            return Err(MediaError::Cancelled);
        }
        std::fs::rename(&staging, &output)?;
        Ok(())
    })();
    if publish.is_err() {
        let _ = std::fs::remove_file(&staging);
    }
    publish
}

fn audio_sample_range(
    range: &Range<vv_core::FrameIdx>,
    fps: vv_core::Rational,
) -> Result<Range<u64>, MediaError> {
    if range.start < 0 || range.end <= range.start || fps.num <= 0 || fps.den <= 0 {
        return Err(crate::proxy::range_error("Invalid source audio range"));
    }
    let sample = |frame: i64| {
        let numerator = i128::from(frame)
            .checked_mul(i128::from(fps.den))?
            .checked_mul(48_000)?;
        u64::try_from(numerator.checked_add(i128::from(fps.num) / 2)? / i128::from(fps.num)).ok()
    };
    let start = sample(range.start)
        .ok_or_else(|| crate::proxy::range_error("Source sample position overflow"))?;
    let end = sample(range.end)
        .ok_or_else(|| crate::proxy::range_error("Source sample position overflow"))?;
    if end <= start || end - start > 60 * 48_000 {
        return Err(crate::proxy::range_error(
            "Source audio window exceeds 60 seconds",
        ));
    }
    Ok(start..end)
}

fn copy_audio_window(
    samples: &mut Vec<f32>,
    channels: u16,
    bounds: &Range<u64>,
    at: u64,
    chunk: &[f32],
) -> Result<(), MediaError> {
    let channels = usize::from(channels);
    let frames = bounds
        .end
        .checked_sub(bounds.start)
        .filter(|&frames| frames > 0 && frames <= 60 * 48_000)
        .ok_or_else(|| crate::proxy::range_error("Invalid source sample window"))?;
    let length = usize::try_from(frames)
        .ok()
        .and_then(|frames| frames.checked_mul(channels))
        .filter(|&length| channels > 0 && length <= MAX_AUDIO_SAMPLES)
        .ok_or_else(|| {
            crate::proxy::range_error("Source audio window exceeds its sample budget")
        })?;
    if !chunk.len().is_multiple_of(channels) || (!samples.is_empty() && samples.len() != length) {
        return Err(crate::proxy::range_error("Invalid source audio chunk"));
    }
    let end = at
        .checked_add((chunk.len() / channels) as u64)
        .ok_or_else(|| crate::proxy::range_error("Source audio chunk position overflow"))?;
    if samples.is_empty() {
        samples.resize(length, 0.0);
    }
    let from = at.max(bounds.start);
    let to = end.min(bounds.end);
    if from < to {
        let input = (from - at) as usize * channels;
        let output = (from - bounds.start) as usize * channels;
        let count = (to - from) as usize * channels;
        samples[output..output + count].copy_from_slice(&chunk[input..input + count]);
    }
    Ok(())
}

fn next_packet(
    input: &mut ffmpeg::format::context::Input,
    index: usize,
) -> Result<Option<ffmpeg::Packet>, MediaError> {
    loop {
        let mut packet = ffmpeg::Packet::empty();
        match packet.read(input) {
            Ok(()) if packet.stream() == index => return Ok(Some(packet)),
            Ok(()) => {}
            Err(ffmpeg::Error::Eof) => return Ok(None),
            Err(error) => return Err(error.into()),
        }
    }
}

fn mux(
    video: &Path,
    audio: &Path,
    output: &Path,
    mut keep_running: impl FnMut() -> bool,
) -> Result<(), MediaError> {
    let mut inputs = [ffmpeg::format::input(video)?, ffmpeg::format::input(audio)?];
    let mut out = ffmpeg::format::output(output)?;
    let mut indices = [0; 2];
    let mut times = [ffmpeg::Rational::new(1, 1); 2];
    for (i, input) in inputs.iter().enumerate() {
        let kind = if i == 0 {
            ffmpeg::media::Type::Video
        } else {
            ffmpeg::media::Type::Audio
        };
        let stream = input
            .streams()
            .best(kind)
            .ok_or(ffmpeg::Error::StreamNotFound)?;
        indices[i] = stream.index();
        times[i] = stream.time_base();
        out.add_stream(ffmpeg::encoder::find(ffmpeg::codec::Id::None))?
            .set_parameters(stream.parameters());
    }
    let mut options = ffmpeg::Dictionary::new();
    options.set("movflags", "+faststart");
    out.write_header_with(options)?;
    let mut pending = [
        next_packet(&mut inputs[0], indices[0])?,
        next_packet(&mut inputs[1], indices[1])?,
    ];
    while pending.iter().any(Option::is_some) {
        if !keep_running() {
            return Err(MediaError::Cancelled);
        }
        let time = |i: usize| {
            pending[i]
                .as_ref()
                .map(|p| p.dts().or(p.pts()).unwrap_or(0) as f64 * f64::from(times[i]))
                .unwrap_or(f64::INFINITY)
        };
        let i = usize::from(time(1) < time(0));
        let mut packet = pending[i].take().unwrap();
        packet.rescale_ts(times[i], out.stream(i).unwrap().time_base());
        packet.set_stream(i);
        packet.set_position(-1);
        packet.write_interleaved(&mut out)?;
        pending[i] = next_packet(&mut inputs[i], indices[i])?;
    }
    out.write_trailer()?;
    Ok(())
}

#[cfg(test)]
#[path = "tests/browser_proxy.rs"]
mod tests;
