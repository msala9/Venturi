use crate::error::{ApiError, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const MAX_BYTES: usize = 256 * 1024;
pub const MAX_FOLDERS: usize = 512;
pub const MAX_DEPTH: usize = 16;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Folder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tree {
    pub version: u32,
    pub folders: Vec<Folder>,
}

impl Default for Tree {
    fn default() -> Self {
        Self {
            version: 1,
            folders: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Removed {
    pub parent: Option<String>,
}

fn identifier(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(ApiError::invalid(
            "Choose an opaque native folder ID within 80 ASCII bytes",
        ));
    }
    Ok(())
}

fn normalized_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 128 || name.chars().any(char::is_control) {
        return Err(ApiError::invalid(
            "Choose a folder name within 128 UTF-8 bytes without control characters",
        ));
    }
    Ok(trimmed.to_owned())
}

pub fn parse(bytes: &[u8]) -> Result<Tree> {
    if bytes.len() > MAX_BYTES {
        return Err(ApiError::invalid("Native folder JSON exceeds 256 KiB"));
    }
    let tree: Tree = serde_json::from_slice(bytes)
        .map_err(|_| ApiError::invalid("Invalid native folder JSON"))?;
    tree.validate()?;
    Ok(tree)
}

impl Tree {
    pub fn validate(&self) -> Result<()> {
        if self.version != 1 || self.folders.len() > MAX_FOLDERS {
            return Err(ApiError::invalid(
                "Choose a native v1 folder tree with at most 512 folders",
            ));
        }
        let mut by_id = HashMap::new();
        for folder in &self.folders {
            identifier(&folder.id)?;
            normalized_name(&folder.name)?;
            if folder.name.len() > 128 {
                return Err(ApiError::invalid("Folder name exceeds 128 UTF-8 bytes"));
            }
            if let Some(parent) = &folder.parent {
                identifier(parent)?;
            }
            if by_id.insert(folder.id.as_str(), folder).is_some() {
                return Err(ApiError::invalid("Native folder IDs must be unique"));
            }
        }
        for folder in &self.folders {
            let mut visited = HashSet::new();
            let mut current = Some(folder.id.as_str());
            while let Some(id) = current {
                if !visited.insert(id) {
                    return Err(ApiError::invalid("Native folder tree contains a cycle"));
                }
                if visited.len() > MAX_DEPTH {
                    return Err(ApiError::invalid("Native folder nesting exceeds 16 levels"));
                }
                let ancestor = by_id
                    .get(id)
                    .ok_or_else(|| ApiError::invalid("Native folder parent is missing"))?;
                current = ancestor.parent.as_deref();
            }
        }
        Ok(())
    }

    pub fn serialize(&self) -> Result<Vec<u8>> {
        self.validate()?;
        let bytes = serde_json::to_vec_pretty(self).map_err(|_| ApiError::io())?;
        if bytes.len() > MAX_BYTES {
            return Err(ApiError::invalid("Native folder JSON exceeds 256 KiB"));
        }
        Ok(bytes)
    }

    pub fn contains(&self, id: &str) -> bool {
        self.folders.iter().any(|folder| folder.id == id)
    }

    pub fn path(&self, id: &str) -> Result<Vec<&Folder>> {
        self.validate()?;
        let mut current = self
            .folders
            .iter()
            .find(|folder| folder.id == id)
            .ok_or_else(ApiError::missing)?;
        let mut path = vec![current];
        while let Some(parent) = &current.parent {
            current = self
                .folders
                .iter()
                .find(|folder| &folder.id == parent)
                .ok_or_else(ApiError::missing)?;
            path.push(current);
        }
        path.reverse();
        Ok(path)
    }

    fn change(&mut self, edit: impl FnOnce(&mut Self) -> Result<bool>) -> Result<bool> {
        self.validate()?;
        let mut trial = self.clone();
        let changed = edit(&mut trial)?;
        trial.validate()?;
        if changed {
            *self = trial;
        }
        Ok(changed)
    }

    pub fn create(&mut self, id: &str, name: &str, parent: Option<&str>) -> Result<bool> {
        identifier(id)?;
        let name = normalized_name(name)?;
        let parent = parent.map(str::to_owned);
        self.change(|trial| {
            if let Some(existing) = trial.folders.iter().find(|folder| folder.id == id) {
                return if existing.name == name && existing.parent == parent {
                    Ok(false)
                } else {
                    Err(ApiError::conflict(
                        "FOLDER_EXISTS",
                        "A different folder already uses this ID",
                    ))
                };
            }
            trial.folders.push(Folder {
                id: id.to_owned(),
                name,
                parent,
            });
            Ok(true)
        })
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<bool> {
        identifier(id)?;
        let name = normalized_name(name)?;
        self.change(|trial| {
            let folder = trial
                .folders
                .iter_mut()
                .find(|folder| folder.id == id)
                .ok_or_else(ApiError::missing)?;
            if folder.name == name {
                return Ok(false);
            }
            folder.name = name;
            Ok(true)
        })
    }

    pub fn move_folder(&mut self, id: &str, parent: Option<&str>) -> Result<bool> {
        identifier(id)?;
        let parent = parent.map(str::to_owned);
        self.change(|trial| {
            let folder = trial
                .folders
                .iter_mut()
                .find(|folder| folder.id == id)
                .ok_or_else(ApiError::missing)?;
            if folder.parent == parent {
                return Ok(false);
            }
            folder.parent = parent;
            Ok(true)
        })
    }

    pub fn remove(&mut self, id: &str) -> Result<Removed> {
        identifier(id)?;
        self.validate()?;
        let mut trial = self.clone();
        let index = trial
            .folders
            .iter()
            .position(|folder| folder.id == id)
            .ok_or_else(ApiError::missing)?;
        let removed = trial.folders.remove(index);
        for folder in &mut trial.folders {
            if folder.parent.as_deref() == Some(id) {
                folder.parent = removed.parent.clone();
            }
        }
        trial.validate()?;
        *self = trial;
        Ok(Removed {
            parent: removed.parent,
        })
    }
}

#[cfg(test)]
#[path = "tests/asset_folders.rs"]
mod tests;
