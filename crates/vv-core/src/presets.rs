use crate::{CompressorBand, EqBand, EqShape, Equalizer, MultibandCompressor};

/// Built-in presets: translation key and settings.
pub fn equalizer_presets() -> [(&'static str, Equalizer); 7] {
    let band = |shape, freq_hz, gain_db, q| EqBand {
        enabled: true,
        shape,
        freq_hz,
        gain_db,
        q,
    };
    let preset = |changes: &[(usize, EqBand)]| {
        let mut eq = Equalizer::DEFAULT;
        for &(index, band) in changes {
            eq.bands[index] = band;
        }
        eq
    };
    let q = EqBand::Q_DEFAULT;
    [
        ("mixer.eq_preset_flat", Equalizer::DEFAULT),
        (
            "mixer.eq_preset_voice",
            preset(&[
                (0, band(EqShape::HighPass, 80.0, 0.0, q)),
                (1, band(EqShape::LowShelf, 150.0, -2.0, q)),
                (2, band(EqShape::Peak, 300.0, -3.0, 1.0)),
                (3, band(EqShape::Peak, 3000.0, 3.0, 1.0)),
                (4, band(EqShape::HighShelf, 10_000.0, 2.0, q)),
            ]),
        ),
        (
            "mixer.eq_preset_warm",
            preset(&[
                (1, band(EqShape::LowShelf, 200.0, 3.0, q)),
                (3, band(EqShape::Peak, 3000.0, -1.5, 0.8)),
                (4, band(EqShape::HighShelf, 8000.0, -2.0, q)),
            ]),
        ),
        (
            "mixer.eq_preset_bright",
            preset(&[
                (0, band(EqShape::HighPass, 40.0, 0.0, q)),
                (3, band(EqShape::Peak, 4000.0, 1.5, 0.8)),
                (4, band(EqShape::HighShelf, 10_000.0, 4.0, q)),
            ]),
        ),
        (
            "mixer.eq_preset_mud",
            preset(&[
                (0, band(EqShape::HighPass, 60.0, 0.0, q)),
                (2, band(EqShape::Peak, 350.0, -5.0, 1.4)),
            ]),
        ),
        (
            "mixer.eq_preset_rumble",
            preset(&[(0, band(EqShape::HighPass, 100.0, 0.0, q))]),
        ),
        (
            "mixer.eq_preset_telephone",
            preset(&[
                (0, band(EqShape::HighPass, 400.0, 0.0, q)),
                (3, band(EqShape::Peak, 1500.0, 4.0, 1.0)),
                (5, band(EqShape::LowPass, 3400.0, 0.0, q)),
            ]),
        ),
    ]
}

/// Built-in presets: translation key and settings.
pub fn compressor_presets() -> [(&'static str, MultibandCompressor); 7] {
    let band = |threshold_db, ratio, attack_ms, release_ms, makeup_db| CompressorBand {
        threshold_db,
        ratio,
        attack_ms,
        release_ms,
        makeup_db,
    };
    let bypass = band(0.0, 1.0, 10.0, 150.0, 0.0);
    let preset = |crossovers_hz, bands| MultibandCompressor {
        crossovers_hz,
        bands,
    };
    [
        ("mixer.preset_default", MultibandCompressor::DEFAULT),
        (
            "mixer.preset_glue",
            preset([150.0, 3000.0], [band(-26.0, 2.0, 30.0, 250.0, 2.0); 3]),
        ),
        (
            "mixer.preset_voice",
            preset(
                [200.0, 5000.0],
                [
                    band(-26.0, 3.0, 15.0, 150.0, -2.0),
                    band(-28.0, 3.0, 8.0, 120.0, 4.0),
                    band(-26.0, 2.0, 3.0, 80.0, 2.0),
                ],
            ),
        ),
        (
            "mixer.preset_deesser",
            preset(
                [1000.0, 6000.0],
                [bypass, bypass, band(-18.0, 6.0, 0.5, 40.0, 0.0)],
            ),
        ),
        (
            "mixer.preset_low_end",
            preset(
                [120.0, 2000.0],
                [band(-26.0, 4.0, 20.0, 200.0, 0.0), bypass, bypass],
            ),
        ),
        (
            "mixer.preset_broadcast",
            preset(
                [200.0, 3000.0],
                [
                    band(-28.0, 4.0, 5.0, 120.0, 10.5),
                    band(-28.0, 4.0, 5.0, 120.0, 8.5),
                    band(-28.0, 4.0, 5.0, 120.0, 7.5),
                ],
            ),
        ),
        (
            "mixer.preset_master",
            preset(
                [120.0, 5000.0],
                [
                    band(-26.0, 2.0, 30.0, 200.0, 3.0),
                    band(-26.0, 2.0, 20.0, 180.0, 3.0),
                    band(-26.0, 2.0, 10.0, 120.0, 3.0),
                ],
            ),
        ),
    ]
}
