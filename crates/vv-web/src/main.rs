mod api;
mod audio;
mod audition;
mod autosave;
mod catalog;
mod clipboard;
mod commands;
mod curves;
mod error;
mod eventkeys;
mod export_store;
mod files;
mod host;
mod inspector;
mod keyselection;
mod library;
mod masks;
mod preset_store;
mod presets;
mod preview;
mod program;
mod receipts;
mod recording;
mod resume;
mod reviewmeta;
mod silence;
mod slip;
mod snapshot;
mod source;
mod take;
mod visual;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut listen = "127.0.0.1:8787".parse::<std::net::SocketAddr>()?;
    let mut root = std::path::PathBuf::from("venturi-web-data");
    let mut gpu = None;
    let mut software = false;
    let mut library_url = None;
    let mut presets_root: Option<std::path::PathBuf> = None;
    let mut gpu_lock = std::path::PathBuf::from("/tmp/HALO_BENCHMARK.lock");
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--software-preview" => software = true,
            "--presets-root" => {
                presets_root = Some(
                    args.next()
                        .ok_or("--presets-root requires a directory")?
                        .into(),
                )
            }
            "--library-url" => {
                library_url = Some(
                    args.next()
                        .ok_or("--library-url requires a service origin")?,
                )
            }
            "--gpu-device" => {
                let id = args
                    .next()
                    .ok_or("--gpu-device requires a hex PCI device ID")?;
                gpu = Some(u32::from_str_radix(id.trim_start_matches("0x"), 16)?);
            }
            "--gpu-lock" => gpu_lock = args.next().ok_or("--gpu-lock requires a file path")?.into(),
            "--listen" => listen = args.next().ok_or("--listen requires an address")?.parse()?,
            "--projects-root" => {
                root = args
                    .next()
                    .ok_or("--projects-root requires a directory")?
                    .into()
            }
            "--help" => {
                println!(
                    "vv-web [--listen 127.0.0.1:8787] [--projects-root DIRECTORY] [--gpu-device 0x7551 | --software-preview] [--gpu-lock FILE] [--library-url HTTP_ORIGIN] [--presets-root DIRECTORY]\nOnly loopback addresses are supported. Use the launcher for isolated software preview."
                );
                return Ok(());
            }
            _ => return Err(format!("Unknown argument: {arg}").into()),
        }
    }
    if !listen.ip().is_loopback() {
        return Err("Only loopback listening is supported; use an SSH tunnel".into());
    }
    if software && gpu.is_some() {
        return Err("Choose either AMD GPU or explicit software preview".into());
    }
    if software {
        preview::software_environment()?;
    }
    let listener = tokio::net::TcpListener::bind(listen).await?;
    let listen = listener.local_addr()?;
    let host = if let Some(presets_root) = presets_root {
        host::Host::start_with_presets(&root, &presets_root)?
    } else {
        host::Host::start(&root)?
    };
    let library = library::Library::start(
        library_url.as_deref(),
        host.media_root().await.map_err(|error| error.2)?,
    )
    .map_err(|error| error.2)?;
    let source =
        source::MediaJobs::start_with_exports(host.media_root().await.map_err(|error| error.2)?)?;
    let recordings = recording::Store::new(host.media_root().await.map_err(|error| error.2)?);
    let preview = if software {
        preview::Preview::start_software(&source.software_lock_path())
    } else {
        gpu.map(|id| preview::Preview::start(id, &gpu_lock))
            .unwrap_or_else(preview::Preview::disabled)
    };
    println!("Venturi Web: http://{listen}");
    axum::serve(
        listener,
        api::router(api::AppState {
            host,
            library,
            recordings,
            source,
            silence: silence::Jobs::start(),
            port: listen.port(),
            preview,
        }),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await?;
    Ok(())
}
