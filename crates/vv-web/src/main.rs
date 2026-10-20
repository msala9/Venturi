mod api;
mod commands;
mod error;
mod files;
mod host;
mod snapshot;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut listen = "127.0.0.1:8787".parse::<std::net::SocketAddr>()?;
    let mut root = std::path::PathBuf::from("venturi-web-data");
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--listen" => listen = args.next().ok_or("--listen requires an address")?.parse()?,
            "--projects-root" => {
                root = args
                    .next()
                    .ok_or("--projects-root requires a directory")?
                    .into()
            }
            "--help" => {
                println!(
                    "vv-web [--listen 127.0.0.1:8787] [--projects-root DIRECTORY]\nOnly loopback addresses are supported."
                );
                return Ok(());
            }
            _ => return Err(format!("Unknown argument: {arg}").into()),
        }
    }
    if !listen.ip().is_loopback() {
        return Err("Only loopback listening is supported; use an SSH tunnel".into());
    }
    let listener = tokio::net::TcpListener::bind(listen).await?;
    println!("Venturi Web: http://{listen}");
    axum::serve(
        listener,
        api::router(api::AppState {
            host: host::Host::start(&root)?,
            port: listen.port(),
        }),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await?;
    Ok(())
}
