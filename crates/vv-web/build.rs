use flate2::{Compression, GzBuilder};
use std::{
    env, fs,
    io::{self, Write},
    path::{Component, Path, PathBuf},
};

fn checked_type(path: &Path) -> io::Result<fs::FileType> {
    let kind = fs::symlink_metadata(path)?.file_type();
    if kind.is_symlink() || !(kind.is_file() || kind.is_dir()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Unsafe embedded asset input: {}", path.display()),
        ));
    }
    Ok(kind)
}

fn watch(path: &Path) {
    println!("cargo:rerun-if-changed={}", path.display());
}

fn compress(web: &Path, relative: &Path, output: &Path) -> io::Result<()> {
    if relative
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Embedded asset paths must stay relative to web",
        ));
    }
    let source = web.join(relative);
    if !checked_type(&source)?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "Embedded asset must be a regular file: {}",
                source.display()
            ),
        ));
    }
    watch(&source);
    let bytes = fs::read(&source)?;
    let mut encoder = GzBuilder::new()
        .mtime(0)
        .operating_system(255)
        .write(Vec::new(), Compression::best());
    encoder.write_all(&bytes)?;
    let compressed = encoder.finish()?;
    let mut destination = output.join(relative).into_os_string();
    destination.push(".gz");
    let destination = PathBuf::from(destination);
    fs::create_dir_all(destination.parent().unwrap())?;
    fs::write(destination, compressed)
}

fn walk(web: &Path, relative: &Path, output: &Path) -> io::Result<()> {
    let directory = web.join(relative);
    if !checked_type(&directory)?.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "Embedded asset directory is missing: {}",
                directory.display()
            ),
        ));
    }
    watch(&directory);
    let mut entries = fs::read_dir(&directory)?.collect::<io::Result<Vec<_>>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let name = entry.file_name();
        let safe_name = name.to_str().is_some_and(|name| {
            !name.is_empty()
                && name != "."
                && name != ".."
                && !name
                    .chars()
                    .any(|c| c.is_control() || matches!(c, '/' | '\\'))
        });
        if !safe_name {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Embedded asset names must be safe UTF-8 path components",
            ));
        }
        let child = relative.join(name);
        let path = web.join(&child);
        let kind = checked_type(&path)?;
        if kind.is_dir() {
            walk(web, &child, output)?;
        } else if matches!(
            path.extension().and_then(|value| value.to_str()),
            Some("html" | "js" | "css")
        ) {
            compress(web, &child, output)?;
        } else {
            watch(&path);
        }
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").ok_or("Missing manifest directory")?);
    let repository = manifest
        .parent()
        .and_then(Path::parent)
        .ok_or("Invalid crate directory")?;
    let web = repository.join("web");
    if !checked_type(&web)?.is_dir() {
        return Err("The embedded web root must be a directory".into());
    }
    let output =
        PathBuf::from(env::var_os("OUT_DIR").ok_or("Missing build output directory")?).join("web");
    compress(&web, Path::new("index.html"), &output)?;
    for directory in ["js", "style"] {
        walk(&web, Path::new(directory), &output)?;
    }
    Ok(())
}
