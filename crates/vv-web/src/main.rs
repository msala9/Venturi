mod api;
mod audio;
mod catalog;
mod clipboard;
mod commands;
mod curves;
mod error;
mod files;
mod host;
mod inspector;
mod masks;
mod preview;
mod program;
mod snapshot;
mod source;
mod visual;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut listen = "127.0.0.1:8787".parse::<std::net::SocketAddr>()?;
    let mut root = std::path::PathBuf::from("venturi-web-data");
    let mut gpu = None;
    let mut software = false;
    let mut gpu_lock = std::path::PathBuf::from("/tmp/HALO_BENCHMARK.lock");
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--software-preview" => software = true,
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
                    "vv-web [--listen 127.0.0.1:8787] [--projects-root DIRECTORY] [--gpu-device 0x7551 | --software-preview] [--gpu-lock FILE]\nOnly loopback addresses are supported. Use the launcher for isolated software preview."
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
    let host = host::Host::start(&root)?;
    let source = source::MediaJobs::start()?;
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
            source,
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
