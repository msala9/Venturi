use crate::error::{ApiError, Result};
use serde_json::{Value, json};
use vv_core::{self as core, Command, Timeline, TimelineId};
use vv_session::Session;

fn locate(timeline: &Timeline, value: &str) -> Result<core::MixerChannel> {
    if value == "master" {
        return Ok(core::MixerChannel::Master);
    }
    let index = value.parse::<usize>().map_err(|_| ApiError::missing())?;
    let track = timeline.tracks.get(index).ok_or_else(ApiError::missing)?;
    if track.kind != core::TrackKind::Audio {
        return Err(ApiError::invalid("Select an audio mixer track"));
    }
    Ok(core::MixerChannel::Track(index))
}
pub fn channel(timeline: &Timeline, value: &str) -> Result<core::MixerChannel> {
    let channel = locate(timeline, value)?;
    if matches!(channel,core::MixerChannel::Track(index) if timeline.tracks[index].locked) {
        return Err(ApiError::conflict(
            "TRACK_LOCKED",
            "The audio track is locked",
        ));
    }
    Ok(channel)
}
pub fn eq_response(timeline: &Timeline, value: &str, index: usize) -> Result<Value> {
    let strip = match locate(timeline, value)? {
        core::MixerChannel::Master => &timeline.master,
        core::MixerChannel::Track(index) => &timeline.tracks[index].mix,
    };
    let effect = strip.effects.get(index).ok_or_else(ApiError::missing)?;
    let core::AudioEffectKind::Equalizer(params) = &effect.kind else {
        return Err(ApiError::invalid("This insert is not an equalizer"));
    };
    let rate = vv_audio::mixer::PROJECT_SAMPLE_RATE;
    let response = vv_audio::eq::EqResponse::new(params, rate);
    let points: Vec<_> = (0..128)
        .map(|i| {
            let frequency = 20.0_f32 * 1000.0_f32.powf(i as f32 / 127.0);
            [
                frequency,
                if effect.enabled {
                    response.gain_db(frequency)
                } else {
                    0.0
                },
            ]
        })
        .collect();
    Ok(json!({"sample_rate":rate,"points":points,"enabled":effect.enabled}))
}
fn bounded(value: f32, range: (f32, f32)) -> Result<()> {
    if !value.is_finite() || !(range.0..=range.1).contains(&value) {
        return Err(ApiError::invalid(
            "Audio effect parameter is outside its native range",
        ));
    }
    Ok(())
}
pub fn validate(effects: &[core::AudioEffect]) -> Result<()> {
    if effects.len() > 32 {
        return Err(ApiError::invalid("At most 32 audio inserts are supported"));
    }
    for effect in effects {
        match &effect.kind {
            core::AudioEffectKind::Mono => {}
            core::AudioEffectKind::Normalize {
                target_db, mode, ..
            } => {
                let range = mode.target_range();
                bounded(*target_db, (*range.start(), *range.end()))?;
            }
            core::AudioEffectKind::Equalizer(eq) => {
                for band in &eq.bands {
                    bounded(band.freq_hz, core::EqBand::FREQ_RANGE_HZ)?;
                    bounded(band.gain_db, core::EqBand::GAIN_RANGE_DB)?;
                    bounded(band.q, core::EqBand::Q_RANGE)?;
                }
            }
            core::AudioEffectKind::MultibandCompressor(compressor) => {
                for frequency in compressor.crossovers_hz {
                    bounded(frequency, core::MultibandCompressor::CROSSOVER_RANGE_HZ)?;
                }
                if compressor.crossovers_hz[0] >= compressor.crossovers_hz[1] {
                    return Err(ApiError::invalid("Compressor crossovers must be ascending"));
                }
                for band in &compressor.bands {
                    for (value, range) in [
                        (band.threshold_db, core::CompressorBand::THRESHOLD_RANGE_DB),
                        (band.ratio, core::CompressorBand::RATIO_RANGE),
                        (band.attack_ms, core::CompressorBand::ATTACK_RANGE_MS),
                        (band.release_ms, core::CompressorBand::RELEASE_RANGE_MS),
                        (band.makeup_db, core::CompressorBand::MAKEUP_RANGE_DB),
                    ] {
                        bounded(value, range)?;
                    }
                }
            }
        }
    }
    Ok(())
}
pub fn set_effects(
    session: &mut Session,
    id: TimelineId,
    raw: &str,
    effects: &[core::AudioEffect],
) -> Result<()> {
    let lane = &session.project.timelines[id];
    let channel = channel(lane, raw)?;
    validate(effects)?;
    let old = match channel {
        core::MixerChannel::Track(index) => lane.tracks[index].mix.effects.len(),
        core::MixerChannel::Master => lane.master.effects.len(),
    };
    let mut commands: Vec<Box<dyn Command>> = (0..old)
        .rev()
        .map(|index| Box::new(core::RemoveAudioEffect::new(id, channel, index)) as Box<dyn Command>)
        .collect();
    commands.extend(effects.iter().map(|effect| {
        Box::new(core::AddAudioEffect::new(id, channel, effect.clone())) as Box<dyn Command>
    }));
    if commands.is_empty() {
        return Err(ApiError::invalid("Audio chain is already empty"));
    }
    session.apply(Box::new(core::CompositeCommand::new(
        core::CommandLabel::EditAudioEffect,
        commands,
    )));
    Ok(())
}
pub fn catalog() -> Value {
    let mut defaults = serde_json::Map::new();
    for kind in core::AudioEffectKind::ALL {
        let key = match kind {
            core::AudioEffectKind::Mono => "Mono",
            core::AudioEffectKind::Equalizer(_) => "Equalizer",
            core::AudioEffectKind::MultibandCompressor(_) => "MultibandCompressor",
            core::AudioEffectKind::Normalize { .. } => "Normalize",
        };
        defaults.insert(key.into(), json!(core::AudioEffect::new(kind)));
    }
    json!({"defaults":defaults,"eq":{"freq_hz":core::EqBand::FREQ_RANGE_HZ,"gain_db":core::EqBand::GAIN_RANGE_DB,"q":core::EqBand::Q_RANGE,"shapes":core::EqShape::ALL},"compressor":{"crossovers_hz":core::MultibandCompressor::CROSSOVER_RANGE_HZ,"threshold_db":core::CompressorBand::THRESHOLD_RANGE_DB,"ratio":core::CompressorBand::RATIO_RANGE,"attack_ms":core::CompressorBand::ATTACK_RANGE_MS,"release_ms":core::CompressorBand::RELEASE_RANGE_MS,"makeup_db":core::CompressorBand::MAKEUP_RANGE_DB},"normalization":core::NormalizeMode::ALL.map(|mode|{let range=mode.target_range();json!({"mode":mode,"range":[range.start(),range.end()],"default":mode.default_target()})})})
}

#[cfg(test)]
#[path = "tests/audio.rs"]
mod tests;
