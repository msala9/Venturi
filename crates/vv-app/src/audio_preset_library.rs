use std::{
    collections::HashSet,
    marker::PhantomData,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use vv_core::{CompressorBand, EqBand, Equalizer, MultibandCompressor};

use crate::library::io::{AUDIO_PRESET_FILE, Guard, Kind, MAX_AUDIO_PRESET_BYTES, Record, Target};

const MAX_PRESETS: usize = 256;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Entry<P> {
    pub name: String,
    pub params: P,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Catalog {
    eq_presets: Vec<Entry<Equalizer>>,
    compressor_presets: Vec<Entry<MultibandCompressor>>,
}

pub(crate) trait Parameters: Clone + PartialEq {
    fn entries(catalog: &Catalog) -> &[Entry<Self>];
    fn entries_mut(catalog: &mut Catalog) -> &mut Vec<Entry<Self>>;
    fn validate(&self) -> Result<(), String>;
}

fn bounded(value: f32, (min, max): (f32, f32)) -> Result<(), String> {
    if value.is_finite() && (min..=max).contains(&value) {
        Ok(())
    } else {
        Err("Audio preset parameters are outside the native bounds".into())
    }
}

impl Parameters for Equalizer {
    fn entries(catalog: &Catalog) -> &[Entry<Self>] {
        &catalog.eq_presets
    }
    fn entries_mut(catalog: &mut Catalog) -> &mut Vec<Entry<Self>> {
        &mut catalog.eq_presets
    }
    fn validate(&self) -> Result<(), String> {
        for band in &self.bands {
            bounded(band.freq_hz, EqBand::FREQ_RANGE_HZ)?;
            bounded(band.gain_db, EqBand::GAIN_RANGE_DB)?;
            bounded(band.q, EqBand::Q_RANGE)?;
        }
        Ok(())
    }
}

impl Parameters for MultibandCompressor {
    fn entries(catalog: &Catalog) -> &[Entry<Self>] {
        &catalog.compressor_presets
    }
    fn entries_mut(catalog: &mut Catalog) -> &mut Vec<Entry<Self>> {
        &mut catalog.compressor_presets
    }
    fn validate(&self) -> Result<(), String> {
        for value in self.crossovers_hz {
            bounded(value, Self::CROSSOVER_RANGE_HZ)?;
        }
        if self.crossovers_hz[0] >= self.crossovers_hz[1] {
            return Err("Compressor crossovers must be ascending".into());
        }
        for band in &self.bands {
            for (value, range) in [
                (band.threshold_db, CompressorBand::THRESHOLD_RANGE_DB),
                (band.ratio, CompressorBand::RATIO_RANGE),
                (band.attack_ms, CompressorBand::ATTACK_RANGE_MS),
                (band.release_ms, CompressorBand::RELEASE_RANGE_MS),
                (band.makeup_db, CompressorBand::MAKEUP_RANGE_DB),
            ] {
                bounded(value, range)?;
            }
        }
        Ok(())
    }
}

fn valid_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name != name.trim()
        || name.len() > 256
        || name.chars().any(char::is_control)
    {
        return Err(
            "Audio preset names must be trimmed, 1 to 256 bytes and without control characters"
                .into(),
        );
    }
    Ok(())
}

fn validate_entries<P: Parameters>(entries: &[Entry<P>]) -> Result<(), String> {
    if entries.len() > MAX_PRESETS {
        return Err("At most 256 audio presets per effect kind are supported".into());
    }
    let mut names = HashSet::new();
    for entry in entries {
        valid_name(&entry.name)?;
        if !names.insert(&entry.name) {
            return Err("Audio preset names must be distinct within each effect kind".into());
        }
        entry.params.validate()?;
    }
    Ok(())
}

impl Catalog {
    fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > MAX_AUDIO_PRESET_BYTES {
            return Err("Audio presets exceed 1 MiB".into());
        }
        let data: Self = serde_json::from_slice(bytes).map_err(|e| {
            format!("Audio presets are unreadable; existing data was preserved: {e}")
        })?;
        data.validate()?;
        Ok(data)
    }
    fn validate(&self) -> Result<(), String> {
        validate_entries(&self.eq_presets)?;
        validate_entries(&self.compressor_presets)
    }
    fn bytes(&self) -> Result<String, String> {
        self.validate()?;
        let bytes = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_AUDIO_PRESET_BYTES {
            return Err("Audio presets exceed 1 MiB".into());
        }
        Ok(bytes)
    }
    fn is_empty(&self) -> bool {
        self.eq_presets.is_empty() && self.compressor_presets.is_empty()
    }
}

#[derive(Default)]
pub(crate) struct AudioPresetLibrary {
    root: Option<PathBuf>,
    data: Catalog,
    record: Option<Record>,
    loaded: bool,
    error: Option<String>,
    legacy: Option<Result<Catalog, String>>,
    empty_candidate: bool,
}

impl AudioPresetLibrary {
    pub fn open(root: PathBuf, legacy: serde_json::Value) -> Self {
        let legacy = (|| {
            if ["eq_presets", "compressor_presets"].iter().any(|key| {
                legacy
                    .get(key)
                    .and_then(serde_json::Value::as_array)
                    .is_some_and(|entries| entries.len() > MAX_PRESETS)
            }) {
                return Err(
                    "At most 256 legacy audio presets per effect kind can be imported".into(),
                );
            }
            let data: Catalog = serde_json::from_value(legacy).map_err(|e| {
                format!("Legacy audio presets are unreadable; they were preserved in Settings: {e}")
            })?;
            data.bytes()?;
            Ok(data)
        })();
        let mut library = Self {
            root: Some(root),
            legacy: Some(legacy),
            ..Self::default()
        };
        let _ = library.refresh();
        library
    }
    fn root(&self) -> Result<&Path, String> {
        self.root
            .as_deref()
            .filter(|path| path.is_absolute())
            .ok_or_else(|| "The shared audio preset library needs an absolute library root".into())
    }
    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }
    pub fn legacy_error(&self) -> Option<&str> {
        self.legacy
            .as_ref()
            .and_then(|legacy| legacy.as_ref().err())
            .map(String::as_str)
    }
    pub fn can_start_empty(&self) -> bool {
        self.empty_candidate
    }
    pub fn legacy_available(&self) -> bool {
        self.legacy.as_ref().is_some_and(|legacy| match legacy {
            Ok(data) => !data.is_empty(),
            Err(_) => true,
        })
    }
    fn finish<T>(&mut self, result: Result<T, String>) -> Result<T, String> {
        self.error = result.as_ref().err().cloned();
        result
    }
    pub fn refresh(&mut self) -> Result<(), String> {
        let mut absent = false;
        let result = (|| {
            let guard = Guard::snapshot(self.root()?, Kind::AudioPresets)?;
            let mut record = guard.read(AUDIO_PRESET_FILE)?;
            absent = record.is_none();
            let data = if let Some(raw) = &record {
                Catalog::parse(raw.bytes.as_bytes())?
            } else {
                let legacy = self
                    .legacy
                    .as_ref()
                    .ok_or("Legacy audio presets are unavailable")?
                    .as_ref()
                    .map_err(Clone::clone)?
                    .clone();
                if legacy.is_empty() {
                    legacy
                } else {
                    drop(guard);
                    let writer = Guard::write(self.root()?, Kind::AudioPresets)?;
                    record = writer.read(AUDIO_PRESET_FILE)?;
                    if let Some(raw) = &record {
                        Catalog::parse(raw.bytes.as_bytes())?
                    } else {
                        writer.commit(vec![Target {
                            path: AUDIO_PRESET_FILE.into(),
                            before: None,
                            after: Some(legacy.bytes()?),
                        }])?;
                        record = writer.read(AUDIO_PRESET_FILE)?;
                        legacy
                    }
                }
            };
            Ok((data, record))
        })();
        self.empty_candidate = absent && self.legacy_error().is_some();
        let (data, record) = self.finish(result)?;
        self.data = data;
        self.record = record;
        self.loaded = true;
        self.empty_candidate = false;
        Ok(())
    }
    pub fn start_empty(&mut self) -> Result<(), String> {
        let result = (|| {
            if !self.empty_candidate {
                return Err("Refresh first; an empty catalog can only be created after observing an absent shared file and invalid legacy presets".into());
            }
            let guard = Guard::write(self.root()?, Kind::AudioPresets)?;
            if guard.read(AUDIO_PRESET_FILE)?.is_some() {
                return Err("The shared audio preset catalog now exists; retain the legacy data and Refresh".into());
            }
            let data = Catalog::default();
            guard.commit(vec![Target {
                path: AUDIO_PRESET_FILE.into(),
                before: None,
                after: Some(data.bytes()?),
            }])?;
            Ok((data, guard.read(AUDIO_PRESET_FILE)?))
        })();
        let (data, record) = self.finish(result)?;
        self.data = data;
        self.record = record;
        self.loaded = true;
        self.empty_candidate = false;
        Ok(())
    }
    fn current(&self, guard: &Guard) -> Result<(), String> {
        if !self.loaded || guard.read(AUDIO_PRESET_FILE)? != self.record {
            return Err(
                "Audio presets changed or have not loaded; retain the draft and Refresh".into(),
            );
        }
        Ok(())
    }
    fn publish(&mut self, guard: &Guard, data: Catalog) -> Result<(), String> {
        guard.commit(vec![Target {
            path: AUDIO_PRESET_FILE.into(),
            before: self.record.clone(),
            after: Some(data.bytes()?),
        }])?;
        let record = guard.read(AUDIO_PRESET_FILE)?;
        self.data = data;
        self.record = record;
        Ok(())
    }
    pub fn bank<P: Parameters>(&mut self) -> PresetBank<'_, P> {
        PresetBank {
            library: self,
            _params: PhantomData,
        }
    }
    pub fn import_legacy(&mut self) -> Result<(), String> {
        let result = (|| {
            let legacy = self
                .legacy
                .as_ref()
                .ok_or("Legacy audio presets are unavailable")?
                .as_ref()
                .map_err(Clone::clone)?
                .clone();
            let guard = Guard::write(self.root()?, Kind::AudioPresets)?;
            self.current(&guard)?;
            let mut data = self.data.clone();
            merge(&mut data.eq_presets, &legacy.eq_presets)?;
            merge(&mut data.compressor_presets, &legacy.compressor_presets)?;
            if data.eq_presets == self.data.eq_presets
                && data.compressor_presets == self.data.compressor_presets
            {
                return Ok(());
            }
            self.publish(&guard, data)
        })();
        self.finish(result)
    }
}

fn merge<P: Parameters>(target: &mut Vec<Entry<P>>, incoming: &[Entry<P>]) -> Result<(), String> {
    for entry in incoming {
        if let Some(existing) = target.iter().find(|old| old.name == entry.name) {
            if existing.params != entry.params {
                return Err(format!(
                    "Legacy audio preset '{}' conflicts; rename it before importing",
                    entry.name
                ));
            }
        } else {
            target.push(entry.clone());
        }
    }
    Ok(())
}

pub(crate) struct PresetBank<'a, P> {
    library: &'a mut AudioPresetLibrary,
    _params: PhantomData<P>,
}

impl<P: Parameters> PresetBank<'_, P> {
    pub fn entries(&self) -> &[Entry<P>] {
        P::entries(&self.library.data)
    }
    pub fn error(&self) -> Option<&str> {
        self.library.error()
    }
    pub fn legacy_error(&self) -> Option<&str> {
        self.library.legacy_error()
    }
    pub fn can_start_empty(&self) -> bool {
        self.library.can_start_empty()
    }
    pub fn start_empty(&mut self) -> Result<(), String> {
        self.library.start_empty()
    }
    pub fn refresh(&mut self) -> Result<(), String> {
        self.library.refresh()
    }
    pub fn legacy_available(&self) -> bool {
        self.library.legacy_available()
    }
    pub fn import_legacy(&mut self) -> Result<(), String> {
        self.library.import_legacy()
    }
    pub fn resolve(&mut self, name: &str) -> Result<P, String> {
        let result = (|| {
            valid_name(name)?;
            let guard = Guard::snapshot(self.library.root()?, Kind::AudioPresets)?;
            self.library.current(&guard)?;
            self.entries()
                .iter()
                .find(|entry| entry.name == name)
                .map(|entry| entry.params.clone())
                .ok_or_else(|| "Audio preset no longer exists; Refresh".into())
        })();
        self.library.finish(result)
    }
    pub fn save(&mut self, name: &str, params: &P) -> Result<(), String> {
        let result = (|| {
            valid_name(name)?;
            params.validate()?;
            let guard = Guard::write(self.library.root()?, Kind::AudioPresets)?;
            self.library.current(&guard)?;
            let mut data = self.library.data.clone();
            let entries = P::entries_mut(&mut data);
            if let Some(entry) = entries.iter_mut().find(|entry| entry.name == name) {
                if entry.params == *params {
                    return Ok(());
                }
                entry.params = params.clone();
            } else {
                entries.push(Entry {
                    name: name.into(),
                    params: params.clone(),
                });
            }
            self.library.publish(&guard, data)
        })();
        self.library.finish(result)
    }
    pub fn delete(&mut self, name: &str) -> Result<(), String> {
        let result = (|| {
            valid_name(name)?;
            let guard = Guard::write(self.library.root()?, Kind::AudioPresets)?;
            self.library.current(&guard)?;
            let mut data = self.library.data.clone();
            let entries = P::entries_mut(&mut data);
            let index = entries
                .iter()
                .position(|entry| entry.name == name)
                .ok_or("Audio preset no longer exists; Refresh")?;
            entries.remove(index);
            self.library.publish(&guard, data)
        })();
        self.library.finish(result)
    }
}

#[cfg(test)]
#[path = "tests/audio_preset_library.rs"]
mod tests;
