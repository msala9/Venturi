//! Low-resolution all-intra proxies, generated in the background. On
//! long-GOP sources a scrub has to decode from the previous keyframe on
//! every frame and cannot keep up; in the proxy every frame is a keyframe.
//! Preview only: the export always uses the originals.
//!
//! Global cache keyed by `content_hash`, not next to the project: it serves
//! every project using the same file, even before saving.

use crate::decode::{Chroma, ColorMatrix, Decoder};
use ffmpeg::Dictionary;
use ffmpeg::codec::{self, encoder};
use ffmpeg::format::{self, Pixel};
use ffmpeg::software::scaling::{context::Context as Scaler, flag::Flags};
use ffmpeg::util::color;
use ffmpeg_next as ffmpeg;
use std::{
    ops::Range,
    path::{Path, PathBuf},
};

/// Trade-off between decoding speed and sharpness of the preview. Each
/// quality has its own file, so switching back does not regenerate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ProxyQuality {
    Low,
    #[default]
    Medium,
    High,
}

impl ProxyQuality {
    pub const ALL: [ProxyQuality; 3] =
        [ProxyQuality::Low, ProxyQuality::Medium, ProxyQuality::High];

    /// Key in the settings file: must never be changed.
    pub fn id(self) -> &'static str {
        match self {
            ProxyQuality::Low => "low",
            ProxyQuality::Medium => "medium",
            ProxyQuality::High => "high",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|q| q.id() == id)
    }

    /// Height in proportion, even for 4:2:0. A narrower source is not
    /// enlarged.
    pub fn max_width(self) -> u32 {
        match self {
            ProxyQuality::Low => 640,
            ProxyQuality::Medium => 960,
            ProxyQuality::High => 1920,
        }
    }

    fn crf(self) -> &'static str {
        match self {
            ProxyQuality::Low => "30",
            ProxyQuality::Medium => "26",
            ProxyQuality::High => "21",
        }
    }

    /// Medium keeps the unsuffixed name of the proxies generated before
    /// qualities existed.
    fn file_suffix(self) -> &'static str {
        match self {
            ProxyQuality::Low => "-low",
            ProxyQuality::Medium => "",
            ProxyQuality::High => "-high",
        }
    }
}

pub fn proxies_dir() -> PathBuf {
    crate::cache_dir("proxies")
}

/// Path of the proxy file for this `content_hash`, whether the file exists
/// yet or not — see `proxy_exists`.
pub fn proxy_path_for(content_hash: u64, quality: ProxyQuality) -> PathBuf {
    proxies_dir().join(format!("{content_hash:016x}{}.mp4", quality.file_suffix()))
}

/// One `stat` per call instead of in-memory state: the file is written by
/// another thread, so no synchronization is needed this way.
pub fn proxy_exists(content_hash: u64, quality: ProxyQuality) -> bool {
    proxy_path_for(content_hash, quality).is_file()
}

/// Generates the proxy and writes it atomically (temporary file + `rename`),
/// decoding on the first of `hw` that works.
/// `on_frame(frames_written)` may block (pause); `false` cancels without
/// leaving files on disk.
pub fn generate_proxy(
    source_path: &Path,
    content_hash: u64,
    quality: ProxyQuality,
    hw: &[crate::hw::HwDevice],
    on_frame: impl FnMut(u64) -> bool,
) -> Result<PathBuf, crate::MediaError> {
    let dir = proxies_dir();
    std::fs::create_dir_all(&dir)?;
    generate_proxy_at(
        source_path,
        &proxy_path_for(content_hash, quality),
        quality,
        hw,
        0,
        on_frame,
    )
}

/// The caller owns the destination directory and cache budget.
pub fn generate_proxy_at(
    source_path: &Path,
    final_path: &Path,
    quality: ProxyQuality,
    hw: &[crate::hw::HwDevice],
    software_threads: usize,
    on_frame: impl FnMut(u64) -> bool,
) -> Result<PathBuf, crate::MediaError> {
    generate_proxy_at_width(
        source_path,
        final_path,
        quality,
        quality.max_width(),
        hw,
        software_threads,
        on_frame,
    )
}

pub fn generate_proxy_at_width(
    source_path: &Path,
    final_path: &Path,
    quality: ProxyQuality,
    max_width: u32,
    hw: &[crate::hw::HwDevice],
    software_threads: usize,
    mut on_frame: impl FnMut(u64) -> bool,
) -> Result<PathBuf, crate::MediaError> {
    crate::probe::ensure_init();

    // Low: runs alongside the playback, whose decoders come first.
    let mut decoder = if software_threads > 0 {
        Decoder::open_software_bounded(source_path, software_threads)?
    } else {
        Decoder::open_with(source_path, hw, crate::hw::HwPriority::Low)?
    };
    // Real dimensions and color metadata from the first decoded frame, as
    // in the preview path.
    let Some((_, first_frame)) = decoder.next_frame()? else {
        return Err(crate::MediaError::NoStream(format!(
            "no decodable frame in {}",
            source_path.display()
        )));
    };
    let (src_w, src_h) = (first_frame.width, first_frame.height);
    let (dst_w, dst_h) = scaled_dimensions(src_w, src_h, max_width.clamp(2, 8192));

    let tmp_path = final_path.with_extension(format!("tmp-{}.mp4", std::process::id()));

    let written = (|| {
        let mut enc = ProxyEncoder::new(
            &tmp_path,
            dst_w,
            dst_h,
            quality,
            decoder.fps(),
            first_frame.matrix,
            first_frame.full_range,
            software_threads,
        )?;
        enc.write_frame(&first_frame)?;
        let mut frames = 1u64;
        if !on_frame(frames) {
            return Err(crate::MediaError::Cancelled);
        }
        while let Some((_, frame)) = decoder.next_frame()? {
            enc.write_frame(&frame)?;
            frames += 1;
            if !on_frame(frames) {
                return Err(crate::MediaError::Cancelled);
            }
        }
        enc.finish()
    })();
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(e);
    }

    std::fs::rename(&tmp_path, final_path)?;
    Ok(final_path.to_owned())
}

pub(crate) fn validate_range(
    range: &Range<vv_core::FrameIdx>,
    fps: vv_core::Rational,
    duration: vv_core::FrameIdx,
) -> Result<(), crate::MediaError> {
    if fps.num <= 0
        || fps.den <= 0
        || range.start < 0
        || range.end <= range.start
        || range.end > duration
        || i128::from(range.end - range.start) * i128::from(fps.den) > 60 * i128::from(fps.num)
    {
        return Err(range_error(
            "Source range must be nonempty, within the source and at most 60 seconds",
        ));
    }
    Ok(())
}

pub(crate) fn range_error(message: &str) -> crate::MediaError {
    std::io::Error::new(std::io::ErrorKind::InvalidInput, message).into()
}

/// A bounded CPU proxy whose source-frame range becomes a zero-based movie.
pub fn generate_proxy_range_at(
    source_path: &Path,
    final_path: &Path,
    quality: ProxyQuality,
    range: Range<vv_core::FrameIdx>,
    software_threads: usize,
    on_frame: impl FnMut(u64) -> bool,
) -> Result<PathBuf, crate::MediaError> {
    generate_proxy_range_at_width(
        source_path,
        final_path,
        quality,
        quality.max_width(),
        range,
        software_threads,
        on_frame,
    )
}

pub fn generate_proxy_range_at_width(
    source_path: &Path,
    final_path: &Path,
    quality: ProxyQuality,
    max_width: u32,
    range: Range<vv_core::FrameIdx>,
    software_threads: usize,
    mut on_frame: impl FnMut(u64) -> bool,
) -> Result<PathBuf, crate::MediaError> {
    if !on_frame(0) {
        return Err(crate::MediaError::Cancelled);
    }
    let meta = crate::probe_media(source_path)?;
    validate_range(&range, meta.fps, meta.duration_frames)?;
    let threads = software_threads.clamp(1, 4);
    let mut decoder = Decoder::open_software_bounded(source_path, threads)?;
    decoder.seek_to_time(range.start as f64 * f64::from(meta.fps.den) / f64::from(meta.fps.num))?;
    let tmp_path = final_path.with_extension(format!("tmp-{}.mp4", std::process::id()));
    let written = (|| {
        let mut encoder = None;
        let mut frames = 0u64;
        while range.start + (frames as i64) < range.end {
            if !on_frame(frames) {
                return Err(crate::MediaError::Cancelled);
            }
            let Some((index, frame)) = decoder.next_frame()? else {
                return Err(range_error("Source ended before the requested range"));
            };
            let expected = range.start + frames as i64;
            if index < expected {
                continue;
            }
            if encoder.is_none() {
                let (width, height) =
                    scaled_dimensions(frame.width, frame.height, max_width.clamp(2, 8192));
                encoder = Some(ProxyEncoder::new(
                    &tmp_path,
                    width,
                    height,
                    quality,
                    decoder.fps(),
                    frame.matrix,
                    frame.full_range,
                    threads,
                )?);
            }
            // Native export holds the first available picture before its PTS.
            while range.start + (frames as i64) <= index
                && range.start + (frames as i64) < range.end
            {
                if !on_frame(frames) {
                    return Err(crate::MediaError::Cancelled);
                }
                encoder.as_mut().unwrap().write_frame(&frame)?;
                frames += 1;
            }
        }
        encoder
            .ok_or_else(|| range_error("Source range contains no video frames"))?
            .finish()?;
        if !on_frame(frames) {
            return Err(crate::MediaError::Cancelled);
        }
        Ok(())
    })();
    if let Err(error) = written {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(error);
    }
    std::fs::rename(&tmp_path, final_path)?;
    Ok(final_path.to_owned())
}

/// Dimensions scaled preserving the aspect ratio, width at most `max_w`,
/// both even (required by YUV420P). A source already narrower than `max_w`
/// stays at its native resolution.
fn scaled_dimensions(src_w: u32, src_h: u32, max_w: u32) -> (u32, u32) {
    if src_w <= max_w {
        return (even(src_w), even(src_h));
    }
    let ratio = max_w as f64 / src_w as f64;
    (even(max_w), even((src_h as f64 * ratio).round() as u32))
}

fn even(x: u32) -> u32 {
    let x = x.max(2);
    if x.is_multiple_of(2) { x } else { x + 1 }
}

fn to_ffmpeg_space(matrix: ColorMatrix) -> color::Space {
    match matrix {
        ColorMatrix::Bt601 => color::Space::SMPTE170M,
        ColorMatrix::Bt709 => color::Space::BT709,
        ColorMatrix::Bt2020 => color::Space::BT2020NCL,
    }
}

fn to_ffmpeg_range(full_range: bool) -> color::Range {
    if full_range {
        color::Range::JPEG
    } else {
        color::Range::MPEG
    }
}

/// Proxy encoder: video only (preview audio comes from the originals),
/// tuned for speed and not quality. Opposite goals to the export `Encoder`,
/// hence not shared.
struct ProxyEncoder {
    octx: format::context::Output,
    encoder: encoder::Video,
    /// Built for the format of the frames, which changes if the decoder
    /// falls back from HW (NV12) to software (planar).
    scaler: Option<Scaler>,
    dst_size: (u32, u32),
    stream_index: usize,
    time_base: ffmpeg::Rational,
    ost_time_base: ffmpeg::Rational,
    next_pts: i64,
}

impl ProxyEncoder {
    #[allow(clippy::too_many_arguments)]
    fn new(
        path: &Path,
        dst_w: u32,
        dst_h: u32,
        quality: ProxyQuality,
        fps: vv_core::Rational,
        matrix: ColorMatrix,
        full_range: bool,
        threads: usize,
    ) -> Result<Self, crate::MediaError> {
        let mut octx = format::output(path)?;
        let global_header = octx.format().flags().contains(format::Flags::GLOBAL_HEADER);

        let codec = encoder::find(codec::Id::H264)
            .ok_or_else(|| crate::MediaError::NoStream("H264 encoder not available".into()))?;
        let ost = octx.add_stream(codec)?;
        let stream_index = ost.index();

        let time_base = ffmpeg::Rational::new(fps.den, fps.num);
        let mut ctx = codec::context::Context::new_with_codec(codec)
            .encoder()
            .video()?;
        ctx.set_width(dst_w);
        ctx.set_height(dst_h);
        ctx.set_format(Pixel::YUV420P);
        ctx.set_time_base(time_base);
        ctx.set_frame_rate(Some(ffmpeg::Rational::new(fps.num, fps.den)));
        ctx.set_colorspace(to_ffmpeg_space(matrix));
        ctx.set_color_range(to_ffmpeg_range(full_range));
        if global_header {
            ctx.set_flags(codec::Flags::GLOBAL_HEADER);
        }

        let mut opts = Dictionary::new();
        // Fast to encode and decode; the quality is enough for scrubbing.
        opts.set("preset", "veryfast");
        opts.set("crf", quality.crf());
        // All-intra: the whole point of the proxy.
        opts.set("g", "1");
        opts.set("keyint_min", "1");
        opts.set("sc_threshold", "0");
        if threads > 0 {
            opts.set("threads", &threads.to_string());
        }

        let encoder = ctx.open_with(opts)?;
        let mut ost = ost;
        ost.set_parameters(&encoder);

        octx.write_header()?;
        let ost_time_base = octx.stream(stream_index).unwrap().time_base();

        Ok(Self {
            octx,
            encoder,
            scaler: None,
            dst_size: (dst_w, dst_h),
            stream_index,
            time_base,
            ost_time_base,
            next_pts: 0,
        })
    }

    fn write_frame(&mut self, frame: &crate::decode::FrameYuv420) -> Result<(), crate::MediaError> {
        let format = match frame.chroma {
            Chroma::Planar { .. } => Pixel::YUV420P,
            Chroma::Interleaved(_) => Pixel::NV12,
        };
        let mut src = ffmpeg::frame::Video::new(format, frame.width, frame.height);
        crate::encode::fill_plane(&mut src, 0, &frame.y, frame.width as usize);
        let chroma_width = frame.chroma_width as usize;
        match &frame.chroma {
            Chroma::Planar { u, v } => {
                crate::encode::fill_plane(&mut src, 1, u, chroma_width);
                crate::encode::fill_plane(&mut src, 2, v, chroma_width);
            }
            Chroma::Interleaved(uv) => crate::encode::fill_plane(&mut src, 1, uv, 2 * chroma_width),
        }

        let fits = self.scaler.as_ref().is_some_and(|s| {
            let input = s.input();
            (input.format, input.width, input.height) == (format, frame.width, frame.height)
        });
        if !fits {
            let (dst_w, dst_h) = self.dst_size;
            self.scaler = Some(Scaler::get(
                format,
                frame.width,
                frame.height,
                Pixel::YUV420P,
                dst_w,
                dst_h,
                Flags::BILINEAR,
            )?);
        }
        let mut scaled = ffmpeg::frame::Video::empty();
        self.scaler.as_mut().unwrap().run(&src, &mut scaled)?;
        scaled.set_pts(Some(self.next_pts));
        scaled.set_kind(ffmpeg::picture::Type::None);
        self.next_pts += 1;

        self.encoder.send_frame(&scaled)?;
        self.drain_packets()
    }

    fn drain_packets(&mut self) -> Result<(), crate::MediaError> {
        crate::encode::drain_packets(
            &mut self.octx,
            &mut self.encoder,
            self.stream_index,
            self.time_base,
            self.ost_time_base,
        )
    }
    fn finish(mut self) -> Result<(), crate::MediaError> {
        self.encoder.send_eof()?;
        self.drain_packets()?;
        self.octx.write_trailer()?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "tests/proxy.rs"]
mod tests;
