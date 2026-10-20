use std::{path::PathBuf, time::Instant};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let source = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Provide a synthetic source path")?,
    );
    let hash = vv_media::content_fingerprint(&source)?;
    let input = vv_media::probe_media(&source)?;
    let started = Instant::now();
    let mut frames = 0;
    let output = vv_media::proxy::generate_proxy(
        &source,
        hash,
        vv_media::proxy::ProxyQuality::Medium,
        &[],
        |count| {
            frames = count;
            true
        },
    )?;
    let elapsed = started.elapsed();
    let proxy = vv_media::probe_media(&output)?;
    println!(
        "{}",
        serde_json::json!({
            "decoder": "CPU, explicit empty hardware preference",
            "input_audio": input.has_audio,
            "proxy_audio": proxy.has_audio,
            "proxy_width": proxy.width,
            "proxy_height": proxy.height,
            "frames": frames,
            "generation_ms": elapsed.as_secs_f64() * 1000.0,
            "bytes": std::fs::metadata(&output)?.len(),
            "path": output,
        })
    );
    Ok(())
}
