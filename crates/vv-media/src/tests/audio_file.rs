use super::*;

/// One second of a 440 Hz tone, stereo, at `rate`.
fn tone(rate: u32) -> Vec<f32> {
    (0..rate)
        .flat_map(|i| {
            let s = (2.0 * std::f32::consts::PI * 440.0 * i as f32 / rate as f32).sin() * 0.5;
            [s, s]
        })
        .collect()
}

#[test]
fn every_available_format_writes_a_file_that_reads_back_at_its_length() {
    let dir = std::env::temp_dir().join(format!("vv-audio-file-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let available = AudioFileFormat::available();
    assert!(available.contains(&AudioFileFormat::Wav));
    for format in available {
        // 44.1 kHz: Opus has to resample to 48 kHz.
        let path = dir.join(format!("take.{}", format.extension()));
        write_audio_file(&path, format, &tone(44_100), 44_100, 2).unwrap();
        let meta = crate::probe_media(&path).unwrap();
        assert!(meta.has_audio && !meta.has_video, "{format:?}");
        let decoded = crate::decode_audio_track(&path, 0).unwrap().unwrap();
        let frames = decoded.samples.len() as f64 / decoded.channels as f64;
        let secs = frames / decoded.sample_rate as f64;
        assert!((secs - 1.0).abs() < 0.08, "{format:?}: {secs} s");
        let peak = decoded.samples.iter().fold(0f32, |p, s| p.max(s.abs()));
        assert!((0.4..0.6).contains(&peak), "{format:?}: peak {peak}");
    }
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_unavailable_choice_falls_back_to_mp3_then_wav() {
    let fallback = if AudioFileFormat::Mp3.is_available() {
        AudioFileFormat::Mp3
    } else {
        AudioFileFormat::Wav
    };
    assert_eq!(AudioFileFormat::resolve(None), fallback);
    assert_eq!(
        AudioFileFormat::resolve(Some(AudioFileFormat::Wav)),
        AudioFileFormat::Wav
    );
    for format in AudioFileFormat::ALL {
        assert_eq!(AudioFileFormat::from_id(format.id()), Some(format));
    }
}

#[test]
fn variable_size_pcm_preserves_every_recorded_sample_without_a_padded_tail() {
    let dir = std::env::temp_dir().join(format!(
        "vv-pcm-exact-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    for channels in [1, 2] {
        let samples: Vec<f32> = (0..(4096 + 17) * channels as usize)
            .map(|i| (i as f32 * 0.01).sin() * 0.25)
            .collect();
        let path = dir.join(format!("exact-{channels}.wav"));
        write_audio_file(&path, AudioFileFormat::Wav, &samples, 48000, channels).unwrap();
        let decoded = crate::decode_audio_track(&path, 0).unwrap().unwrap();
        assert_eq!(decoded.sample_rate, 48000);
        assert_eq!(decoded.channels, channels);
        assert_eq!(decoded.samples, samples);
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(target_os = "linux")]
#[test]
fn explicit_audio_format_writes_to_an_existing_descriptor_without_a_filename_extension() {
    use std::os::fd::AsRawFd;
    let path = std::env::temp_dir().join(format!(
        "vv-audio-descriptor-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&path)
        .unwrap();
    let samples: Vec<_> = (0..4817).map(|n| (n as f32 * 0.02).sin() * 0.2).collect();
    write_audio_file(
        &std::path::PathBuf::from(format!("/proc/self/fd/{}", file.as_raw_fd())),
        AudioFileFormat::Wav,
        &samples,
        48000,
        1,
    )
    .unwrap();
    let audio = crate::decode_audio_track(&path, 0).unwrap().unwrap();
    assert_eq!(audio.samples, samples);
    assert_eq!(audio.sample_rate, 48000);
    drop(file);
    std::fs::remove_file(path).unwrap();
}
