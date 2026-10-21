use crate::{
    error::{ApiError, Result},
    files::Files,
};
use rustix::fs::{AtFlags, Mode, OFlags, RenameFlags, openat, unlinkat};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{Read, Write},
};

const NAME: &str = ".venturi-last-project.json";
#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Saved {
    version: u32,
    project_token: String,
    sha256: String,
}
fn read(files: &Files) -> Result<Option<Saved>> {
    let dir = files.root_file()?;
    let fd = match openat(
        &dir,
        NAME,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
        Mode::empty(),
    ) {
        Ok(fd) => fd,
        Err(rustix::io::Errno::NOENT) => return Ok(None),
        Err(_) => {
            return Err(ApiError::invalid(
                "Automatic reopen metadata is unavailable; it was preserved",
            ));
        }
    };
    let file = File::from(fd);
    let metadata = file.metadata().map_err(|_| ApiError::io())?;
    if !metadata.is_file() || metadata.len() > 4096 {
        return Err(ApiError::invalid(
            "Automatic reopen metadata is unsupported; it was preserved",
        ));
    }
    let mut bytes = vec![];
    file.take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| ApiError::io())?;
    if bytes.len() > 4096 {
        return Err(ApiError::invalid(
            "Automatic reopen metadata exceeds 4 KiB; it was preserved",
        ));
    }
    let saved: Saved = serde_json::from_slice(&bytes).map_err(|_| {
        ApiError::invalid("Automatic reopen metadata is unreadable; it was preserved")
    })?;
    if saved.version != 1
        || !saved.project_token.ends_with(".vvproj")
        || saved.sha256.len() != 64
        || !saved
            .sha256
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err(ApiError::invalid(
            "Automatic reopen metadata is unsupported; it was preserved",
        ));
    }
    files.path(&saved.project_token)?;
    Ok(Some(saved))
}
pub fn restore(files: &Files) -> Result<Option<(vv_core::Project, String)>> {
    read(files)?
        .map(|saved| {
            files
                .load_matching(&saved.project_token, &saved.sha256)
                .map(|project| (project, saved.project_token))
        })
        .transpose()
}
pub fn remember(files: &Files, name: &str) -> Result<()> {
    let sha256 = files
        .saved_fingerprint(name)
        .ok_or_else(|| ApiError::invalid("The saved project has no current fingerprint"))?;
    let saved = Saved {
        version: 1,
        project_token: name.into(),
        sha256,
    };
    let previous = read(files)?;
    if previous.as_ref() == Some(&saved) {
        return Ok(());
    }
    let dir = files.root_file()?;
    let temp = format!(
        ".venturi-resume-{}-{}.tmp",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let fd = openat(
        &dir,
        temp.as_str(),
        OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::RUSR | Mode::WUSR,
    )
    .map_err(|_| ApiError::io())?;
    let result = (|| {
        let mut file = File::from(fd);
        let bytes = serde_json::to_vec(&saved).map_err(|_| ApiError::io())?;
        file.write_all(&bytes).map_err(|_| ApiError::io())?;
        file.sync_all().map_err(|_| ApiError::io())?;
        if previous.is_none() {
            rustix::fs::renameat_with(&dir, temp.as_str(), &dir, NAME, RenameFlags::NOREPLACE)
                .map_err(|_| ApiError::io())?;
        } else {
            if read(files)?.as_ref() != previous.as_ref() {
                return Err(ApiError::conflict(
                    "SAVE_CONFLICT",
                    "Automatic reopen metadata changed; it was preserved",
                ));
            }
            rustix::fs::renameat(&dir, temp.as_str(), &dir, NAME).map_err(|_| ApiError::io())?;
        }
        dir.sync_all().map_err(|_| ApiError::io())
    })();
    let _ = unlinkat(&dir, temp.as_str(), AtFlags::empty());
    result
}

#[cfg(test)]
#[path = "tests/resume.rs"]
mod tests;
