use crate::{
    MediaError,
    audio_file::{AudioFileFormat, write_audio_file},
    proxy::ProxyQuality,
};
use ffmpeg_next as ffmpeg;
use std::{ops::ControlFlow, path::Path};

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
