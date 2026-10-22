//! User library shared by all projects, in `$XDG_DATA_HOME/venturi/library`:
//! assets (pool items, their files copied in) and attribute presets, one
//! JSON file each so they can be synced or handed around one by one, and the
//! folders the assets are sorted in.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;

use serde::{Deserialize, Serialize};
use vv_core::clipboard::{ClipboardOrigin, ClipboardPayload};
use vv_core::{Clip, MediaItem, Project, Rational};
use vv_session::MediaTree;

use crate::paste_attributes::{Attribute, KeyframeAnchor, TimelineFormat};
use crate::settings::Shortcut;

const VERSION: u32 = 1;

#[path = "library_io.rs"]
pub(crate) mod io;
use io::{Guard, Kind, Record, Target};
type CatalogRecords = BTreeMap<String, Record>;
type AssetCatalog = (Vec<Asset>, Vec<LibraryFolder>, CatalogRecords);
type PresetCatalog = (Vec<(String, AttributePreset)>, CatalogRecords);

#[derive(Serialize, Deserialize)]
struct AssetFile {
    version: u32,
    name: String,
    #[serde(default)]
    folder: Option<String>,
    /// `ClipboardPayload::to_text`: it already carries compound clips with
    /// their nested timelines.
    payload: String,
}

#[derive(Clone)]
pub(crate) struct Asset {
    pub id: String,
    pub name: String,
    pub folder: Option<String>,
    pub payload: ClipboardPayload,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct LibraryFolder {
    pub id: String,
    pub name: String,
    pub parent: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct FoldersFile {
    version: u32,
    folders: Vec<LibraryFolder>,
}

impl Asset {
    pub fn item(&self) -> Option<&MediaItem> {
        self.payload.media_items().next()
    }

    /// Whether a file it needs, also inside a compound clip, is gone.
    pub fn is_offline(&self) -> bool {
        self.payload.files().any(|f| !f.path.is_file())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct AttributePreset {
    pub version: u32,
    pub name: String,
    pub attributes: Vec<Attribute>,
    pub anchor: KeyframeAnchor,
    /// Added after the target's filters instead of replacing them.
    #[serde(default)]
    pub append_filters: bool,
    /// Applies the preset to the selected clips; unique among presets.
    #[serde(default)]
    pub shortcut: Option<Shortcut>,
    pub fps: Rational,
    pub resolution: (u32, u32),
    pub video: Option<Clip>,
    pub audio: Option<Clip>,
}

impl AttributePreset {
    pub fn new(
        name: String,
        format: TimelineFormat,
        video: Option<Clip>,
        audio: Option<Clip>,
    ) -> Self {
        Self {
            version: VERSION,
            name,
            attributes: Vec::new(),
            anchor: KeyframeAnchor::Start,
            append_filters: false,
            shortcut: None,
            fps: format.fps,
            resolution: format.resolution,
            video,
            audio,
        }
    }

    pub fn format(&self) -> TimelineFormat {
        TimelineFormat {
            fps: self.fps,
            resolution: self.resolution,
        }
    }
}

/// An asset whose files are still being copied.
struct PendingAsset {
    name: String,
    /// `Ok(None)`: the file was already there, nothing added.
    done: mpsc::Receiver<Result<Option<PreparedAsset>, String>>,
}

struct PreparedAsset {
    asset: Asset,
    record: Option<Record>,
}

#[derive(Default)]
pub(crate) struct Library {
    /// `None`: no home directory, the library is in memory only.
    root: Option<PathBuf>,
    pub assets: Vec<Asset>,
    pub folders: Vec<LibraryFolder>,
    pub presets: Vec<(String, AttributePreset)>,
    pending: Vec<PendingAsset>,
    records: BTreeMap<String, Record>,
    loaded: bool,
    error: Option<String>,
}

impl Library {
    pub fn default_root() -> Option<PathBuf> {
        if let Some(path) = std::env::var_os("VENTURI_LIBRARY_ROOT").filter(|path| !path.is_empty())
        {
            // A relative override must fail visibly in open(), never select another library.
            return Some(PathBuf::from(path));
        }
        let data = std::env::var_os("XDG_DATA_HOME")
            .filter(|d| !d.is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share"))
            })?;
        Some(data.join("venturi").join("library"))
    }

    /// Unreadable entries are skipped with a message, never fatal.
    pub fn open(root: PathBuf) -> Self {
        let mut library = Self {
            root: Some(root),
            ..Default::default()
        };
        if let Err(error) = library.refresh() {
            library.error = Some(error);
        }
        library
    }

    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    pub fn refresh(&mut self) -> Result<(), String> {
        let result = (|| {
            let Some(root) = &self.root else {
                return Ok(());
            };
            if !root.is_absolute() {
                return Err("VENTURI_LIBRARY_ROOT must be an absolute directory".into());
            }
            let assets_guard = Guard::snapshot(root, Kind::Assets)?;
            let presets_guard = Guard::snapshot(&root.join("presets"), Kind::Presets)?;
            let (assets, folders, mut records) = read_assets(&assets_guard)?;
            let (presets, preset_records) = read_presets(&presets_guard)?;
            records.extend(preset_records);
            self.root = Some(root.canonicalize().map_err(|e| e.to_string())?);
            self.assets = assets;
            self.folders = folders;
            self.presets = presets;
            self.records = records;
            self.loaded = true;
            Ok(())
        })();
        self.error = result.as_ref().err().cloned();
        result
    }

    fn writable(&self) -> Result<(), String> {
        if self.root.is_some() && !self.loaded {
            return Err(self
                .error
                .clone()
                .unwrap_or_else(|| "Refresh the library before editing".into()));
        }
        Ok(())
    }

    fn change_assets(
        &mut self,
        ids: &[String],
        check_folders: bool,
        change: impl FnOnce(&mut Vec<Asset>, &mut Vec<LibraryFolder>) -> Result<(), String>,
    ) -> Result<(), String> {
        self.writable()?;
        let Some(root) = &self.root else {
            let (mut assets, mut folders) = (self.assets.clone(), self.folders.clone());
            change(&mut assets, &mut folders)?;
            assets.sort_by_cached_key(|a| a.name.to_lowercase());
            self.assets = assets;
            self.folders = folders;
            return Ok(());
        };
        let guard = Guard::write(root, Kind::Assets)?;
        let (mut assets, mut folders, records) = read_assets(&guard)?;
        if check_folders && self.records.get("folders.json") != records.get("folders.json") {
            return Err("Library folders changed; refresh before editing".into());
        }
        for id in ids {
            let name = format!("assets/{id}.json");
            if self.records.get(&name) != records.get(&name) {
                return Err("Library asset changed; refresh before editing".into());
            }
        }
        let before: BTreeMap<_, _> = assets
            .iter()
            .map(|asset| Ok((asset.id.clone(), asset_text(asset)?)))
            .collect::<Result<_, String>>()?;
        let old_folders = folders.clone();
        change(&mut assets, &mut folders)?;
        let mut targets = Vec::new();
        for asset in &assets {
            let after = asset_text(asset)?;
            if before.get(&asset.id) != Some(&after) {
                let path = format!("assets/{}.json", asset.id);
                targets.push(Target {
                    before: records.get(&path).cloned(),
                    path,
                    after: Some(after),
                });
            }
        }
        for id in before
            .keys()
            .filter(|id| !assets.iter().any(|asset| &asset.id == *id))
        {
            let path = format!("assets/{id}.json");
            targets.push(Target {
                before: records.get(&path).cloned(),
                path,
                after: None,
            });
        }
        if folders != old_folders {
            targets.push(Target {
                path: "folders.json".into(),
                before: records.get("folders.json").cloned(),
                after: Some(
                    serde_json::to_string_pretty(&FoldersFile {
                        version: VERSION,
                        folders,
                    })
                    .map_err(|e| e.to_string())?,
                ),
            });
        }
        guard.commit(targets)?;
        let (assets, folders, records) = read_assets(&guard)?;
        self.assets = assets;
        self.folders = folders;
        self.records.retain(|name, _| name.starts_with("presets/"));
        self.records.extend(records);
        self.error = None;
        Ok(())
    }

    fn change_presets(
        &mut self,
        id: &str,
        change: impl FnOnce(&mut Vec<(String, AttributePreset)>) -> Result<(), String>,
    ) -> Result<(), String> {
        self.writable()?;
        let Some(root) = &self.root else {
            let mut presets = self.presets.clone();
            change(&mut presets)?;
            presets.sort_by_cached_key(|(_, preset)| preset.name.to_lowercase());
            self.presets = presets;
            return Ok(());
        };
        let guard = Guard::write(&root.join("presets"), Kind::Presets)?;
        let (mut presets, records) = read_presets(&guard)?;
        let name = format!("presets/{id}.json");
        if self.records.get(&name) != records.get(&name) {
            return Err("Library preset changed; refresh before editing".into());
        }
        let before: BTreeMap<_, _> = presets
            .iter()
            .map(|(id, preset)| {
                Ok((
                    id.clone(),
                    serde_json::to_string_pretty(preset).map_err(|e| e.to_string())?,
                ))
            })
            .collect::<Result<_, String>>()?;
        change(&mut presets)?;
        let mut targets = Vec::new();
        for (id, preset) in &presets {
            let after = serde_json::to_string_pretty(preset).map_err(|e| e.to_string())?;
            if before.get(id) != Some(&after) {
                targets.push(Target {
                    path: format!("{id}.json"),
                    before: records.get(&format!("presets/{id}.json")).cloned(),
                    after: Some(after),
                });
            }
        }
        for id in before
            .keys()
            .filter(|id| !presets.iter().any(|(present, _)| present == *id))
        {
            targets.push(Target {
                path: format!("{id}.json"),
                before: records.get(&format!("presets/{id}.json")).cloned(),
                after: None,
            });
        }
        guard.commit(targets)?;
        let (presets, records) = read_presets(&guard)?;
        self.presets = presets;
        self.records.retain(|name, _| !name.starts_with("presets/"));
        self.records.extend(records);
        self.error = None;
        Ok(())
    }

    /// Names of the assets still copying their files.
    pub fn pending(&self) -> impl Iterator<Item = &str> {
        self.pending.iter().map(|p| p.name.as_str())
    }

    /// Copies the files of `payload` into the library in the background.
    pub fn add_asset(&mut self, name: String, folder: Option<String>, payload: ClipboardPayload) {
        let (tx, done) = mpsc::channel();
        if let Err(error) = self.writable() {
            let _ = tx.send(Err(error));
            self.pending.push(PendingAsset { name, done });
            return;
        }
        let root = self.root.clone();
        let asset = Asset {
            id: new_id(),
            name: name.clone(),
            folder,
            payload,
        };
        std::thread::spawn(move || {
            let result = match root {
                Some(root) => store_prepared_asset(&root, asset),
                None => Ok(PreparedAsset {
                    asset,
                    record: None,
                }),
            };
            let _ = tx.send(result.map(Some));
        });
        self.pending.push(PendingAsset { name, done });
    }

    /// Each media file of `tree` becomes an asset in `parent`, its folders
    /// library folders: one with the same name and place as an existing
    /// one is merged into it, and a file already in its folder is skipped.
    /// Probed and copied in the background, one file at a time.
    pub fn import_tree(
        &mut self,
        tree: MediaTree,
        parent: Option<String>,
        origin: ClipboardOrigin,
    ) -> Result<(), String> {
        self.writable()?;
        let mut ids: Vec<String> = Vec::with_capacity(tree.folders.len());
        for (name, inside) in tree.folders {
            let parent = inside.map(|i| ids[i].clone()).or_else(|| parent.clone());
            let existing = self
                .folders
                .iter()
                .find(|f| f.parent == parent && f.name == name)
                .map(|f| f.id.clone());
            let id = match existing {
                Some(id) => id,
                None => self.add_folder(name, parent)?,
            };
            ids.push(id);
        }
        let present: Vec<(u64, Option<String>)> = self
            .assets
            .iter()
            .filter_map(|a| Some((a.item()?.content_hash, a.folder.clone())))
            .collect();
        let mut jobs = Vec::with_capacity(tree.files.len());
        for (path, inside) in tree.files {
            let (tx, done) = mpsc::channel();
            self.pending.push(PendingAsset {
                name: vv_session::file_label(&path),
                done,
            });
            let folder = inside.map(|i| ids[i].clone()).or_else(|| parent.clone());
            jobs.push((path, folder, tx));
        }
        let root = self.root.clone();
        std::thread::spawn(move || {
            for (path, folder, tx) in jobs {
                let result = file_asset(&path, folder, origin).and_then(|asset| {
                    let hash = asset.item().map(|i| i.content_hash);
                    if present
                        .iter()
                        .any(|(h, f)| Some(*h) == hash && *f == asset.folder)
                    {
                        return Ok(None);
                    }
                    match &root {
                        Some(root) => store_prepared_asset(root, asset).map(Some),
                        None => Ok(Some(PreparedAsset {
                            asset,
                            record: None,
                        })),
                    }
                });
                let _ = tx.send(result);
            }
        });
        Ok(())
    }

    /// Collects the finished copies; returns the errors.
    pub fn poll(&mut self) -> Vec<String> {
        let mut errors = Vec::new();
        let mut i = 0;
        while i < self.pending.len() {
            match self.pending[i].done.try_recv() {
                Ok(result) => {
                    let pending = self.pending.remove(i);
                    match result {
                        Ok(Some(prepared)) => {
                            if let Some(record) = prepared.record {
                                self.records
                                    .insert(format!("assets/{}.json", prepared.asset.id), record);
                            }
                            self.insert_asset(prepared.asset);
                        }
                        Ok(None) => {}
                        Err(e) => errors.push(format!("{}: {e}", pending.name)),
                    }
                }
                Err(mpsc::TryRecvError::Empty) => i += 1,
                Err(mpsc::TryRecvError::Disconnected) => {
                    self.pending.remove(i);
                }
            }
        }
        errors
    }

    fn insert_asset(&mut self, asset: Asset) {
        self.assets.retain(|existing| existing.id != asset.id);
        let at = self
            .assets
            .partition_point(|a| a.name.to_lowercase() <= asset.name.to_lowercase());
        self.assets.insert(at, asset);
    }

    pub fn rename_asset(&mut self, id: &str, name: String) -> Result<(), String> {
        self.change_assets(&[id.into()], false, |assets, _| {
            if let Some(asset) = assets.iter_mut().find(|a| a.id == id) {
                asset.name = name;
            }
            Ok(())
        })
    }

    pub fn move_assets(&mut self, ids: &[String], folder: Option<String>) -> Result<(), String> {
        self.change_assets(ids, true, |assets, folders| {
            valid_parent(folders, folder.as_deref())?;
            for asset in assets.iter_mut().filter(|asset| ids.contains(&asset.id)) {
                asset.folder = folder.clone();
            }
            Ok(())
        })
    }

    pub fn media_dir(&self) -> Option<PathBuf> {
        self.root.as_ref().map(|root| root.join("media"))
    }

    /// Looks for the missing files of the asset under `base_dir`, by name,
    /// and copies them in. Returns how many are still missing.
    pub fn relink_asset(&mut self, id: &str, base_dir: &Path) -> Result<usize, String> {
        let Some(media_dir) = self.media_dir() else {
            return Ok(0);
        };
        let mut missing = 0;
        self.change_assets(&[id.into()], false, |assets, _| {
            let Some(asset) = assets.iter_mut().find(|a| a.id == id) else {
                return Ok(());
            };
            for item in asset.payload.files_mut() {
                if item.path.is_file() {
                    continue;
                }
                match find_file(base_dir, &original_name(&item.path)?) {
                    Some(found) => {
                        item.path = copy_to_media(&media_dir, &found, item.content_hash)?
                    }
                    None => missing += 1,
                }
            }
            Ok(())
        })?;
        Ok(missing)
    }

    pub fn folder(&self, id: &str) -> Option<&LibraryFolder> {
        self.folders.iter().find(|f| f.id == id)
    }

    pub fn add_folder(&mut self, name: String, parent: Option<String>) -> Result<String, String> {
        let id = new_id();
        self.change_assets(&[], true, |_, folders| {
            valid_parent(folders, parent.as_deref())?;
            folders.push(LibraryFolder {
                id: id.clone(),
                name,
                parent,
            });
            Ok(())
        })?;
        Ok(id)
    }

    pub fn rename_folder(&mut self, id: &str, name: String) -> Result<(), String> {
        self.change_assets(&[], true, |_, folders| {
            if let Some(folder) = folders.iter_mut().find(|f| f.id == id) {
                folder.name = name;
            }
            Ok(())
        })
    }

    /// The caller checks that `parent` is not inside `id`.
    pub fn move_folder(&mut self, id: &str, parent: Option<String>) -> Result<(), String> {
        self.change_assets(&[], true, |_, folders| {
            valid_parent(folders, parent.as_deref())?;
            let mut ancestor = parent.as_deref();
            for _ in 0..=folders.len() {
                match ancestor {
                    Some(inside) if inside == id => {
                        return Err("A library folder cannot contain itself".into());
                    }
                    Some(inside) => {
                        ancestor = folders
                            .iter()
                            .find(|f| f.id == inside)
                            .and_then(|f| f.parent.as_deref())
                    }
                    None => break,
                }
            }
            if ancestor.is_some() {
                return Err("Library folder cycle".into());
            }
            if let Some(folder) = folders.iter_mut().find(|f| f.id == id) {
                folder.parent = parent;
            }
            Ok(())
        })
    }

    /// As in the project's pool, its content moves up one level.
    pub fn remove_folder(&mut self, id: &str) -> Result<(), String> {
        self.change_assets(&[], true, |assets, folders| {
            let Some(index) = folders.iter().position(|f| f.id == id) else {
                return Ok(());
            };
            let removed = folders.remove(index);
            for folder in folders {
                if folder.parent.as_deref() == Some(id) {
                    folder.parent = removed.parent.clone();
                }
            }
            for asset in assets
                .iter_mut()
                .filter(|a| a.folder.as_deref() == Some(id))
            {
                asset.folder = removed.parent.clone();
            }
            Ok(())
        })
    }

    /// Also deletes the copied files no other asset uses.
    pub fn remove_asset(&mut self, id: &str) -> Result<(), String> {
        self.writable()?;
        let Some(root) = &self.root else {
            self.assets.retain(|a| a.id != id);
            return Ok(());
        };
        let guard = Guard::write(root, Kind::Assets)?;
        let (mut assets, folders, records) = read_assets(&guard)?;
        let path = format!("assets/{id}.json");
        if self.records.get(&path) != records.get(&path) {
            return Err("Library asset changed; refresh before deleting".into());
        }
        let Some(index) = assets.iter().position(|a| a.id == id) else {
            return Ok(());
        };
        let removed = assets.remove(index);
        let references = retained_media(&guard, root, id);
        guard.commit(vec![Target {
            path,
            before: records.get(&format!("assets/{id}.json")).cloned(),
            after: None,
        }])?;
        if let Ok(references) = references {
            for item in removed.payload.files() {
                if !references.contains(&item.path) {
                    // An unrecognized managed path is retained rather than guessed or followed.
                    let _ = remove_managed_media(root, &item.path);
                }
            }
        }
        let (_, _, records) = read_assets(&guard)?;
        self.assets = assets;
        self.folders = folders;
        self.records.retain(|name, _| name.starts_with("presets/"));
        self.records.extend(records);
        Ok(())
    }

    pub fn preset(&self, id: &str) -> Option<&AttributePreset> {
        self.presets.iter().find(|(i, _)| i == id).map(|(_, p)| p)
    }

    /// Id of the preset whose shortcut was pressed.
    pub fn preset_pressed(&self, input: &egui::InputState) -> Option<String> {
        self.presets
            .iter()
            .find(|(_, p)| p.shortcut.is_some_and(|s| s.pressed(input)))
            .map(|(id, _)| id.clone())
    }

    pub fn add_preset(&mut self, preset: AttributePreset) -> Result<String, String> {
        let id = new_id();
        self.change_presets(&id, |presets| {
            clear_shortcut(presets, &id, preset.shortcut);
            presets.push((id.clone(), preset));
            Ok(())
        })?;
        Ok(id)
    }

    /// Changes a preset and saves it. A shortcut taken by this preset is
    /// taken away from the others.
    pub fn update_preset(
        &mut self,
        id: &str,
        change: impl FnOnce(&mut AttributePreset),
    ) -> Result<(), String> {
        self.change_presets(id, |presets| {
            let Some(index) = presets.iter().position(|(i, _)| i == id) else {
                return Ok(());
            };
            change(&mut presets[index].1);
            let shortcut = presets[index].1.shortcut;
            clear_shortcut(presets, id, shortcut);
            Ok(())
        })
    }

    pub fn remove_preset(&mut self, id: &str) -> Result<(), String> {
        self.change_presets(id, |presets| {
            presets.retain(|(i, _)| i != id);
            Ok(())
        })
    }
}

/// Copies each file into `media/`. A missing file fails the whole asset:
/// stored, it would only come back offline.
/// An asset of the media file at `path`, not copied yet.
fn asset_text(asset: &Asset) -> Result<String, String> {
    serde_json::to_string_pretty(&AssetFile {
        version: VERSION,
        name: asset.name.clone(),
        folder: asset.folder.clone(),
        payload: asset.payload.to_text(),
    })
    .map_err(|e| e.to_string())
}

fn read_assets(guard: &Guard) -> Result<AssetCatalog, String> {
    let mut records = BTreeMap::new();
    let folders = if let Some(record) = guard.read("folders.json")? {
        let file: FoldersFile = serde_json::from_str(&record.bytes)
            .map_err(|_| "Invalid native library folders; existing file was preserved")?;
        if file.version != VERSION {
            return Err("Unsupported native library folders version".into());
        }
        records.insert("folders.json".into(), record);
        file.folders
    } else {
        Vec::new()
    };
    let mut assets = Vec::new();
    for (name, record) in guard.records(false)? {
        let id = name.strip_suffix(".json").unwrap();
        if let Some(file) = parse::<AssetFile>(id, &record.bytes)
            && let Some(Ok(payload)) = ClipboardPayload::from_text(&file.payload)
        {
            assets.push(Asset {
                id: id.into(),
                name: file.name,
                folder: file.folder,
                payload,
            });
        }
        records.insert(format!("assets/{name}"), record);
    }
    assets.sort_by_cached_key(|a| a.name.to_lowercase());
    Ok((assets, folders, records))
}

fn read_presets(guard: &Guard) -> Result<PresetCatalog, String> {
    let mut records = BTreeMap::new();
    let mut presets = Vec::new();
    for (name, record) in guard.records(false)? {
        let id = name.strip_suffix(".json").unwrap();
        if let Some(preset) = parse(id, &record.bytes) {
            presets.push((id.into(), preset));
        }
        records.insert(format!("presets/{name}"), record);
    }
    presets.sort_by_cached_key(|(_, p): &(String, AttributePreset)| p.name.to_lowercase());
    Ok((presets, records))
}

fn valid_parent(folders: &[LibraryFolder], id: Option<&str>) -> Result<(), String> {
    if id.is_some_and(|id| !folders.iter().any(|folder| folder.id == id)) {
        return Err("Library destination folder changed; refresh before editing".into());
    }
    Ok(())
}

fn clear_shortcut(presets: &mut [(String, AttributePreset)], id: &str, shortcut: Option<Shortcut>) {
    if let Some(shortcut) = shortcut {
        for (other_id, preset) in presets {
            if other_id != id && preset.shortcut == Some(shortcut) {
                preset.shortcut = None;
            }
        }
    }
}

fn retained_media(
    guard: &Guard,
    root: &Path,
    removed: &str,
) -> Result<std::collections::HashSet<PathBuf>, String> {
    let mut references = std::collections::HashSet::new();
    for (name, record) in guard.records(true)? {
        if name == format!("{removed}.json") {
            continue;
        }
        let file: AssetFile = serde_json::from_str(&record.bytes)
            .map_err(|_| "Uncertain library media references")?;
        if file.version != VERSION {
            return Err("Unsupported retained asset references".into());
        }
        let payload = ClipboardPayload::from_text(&file.payload)
            .and_then(Result::ok)
            .ok_or("Unreadable retained asset references")?;
        for item in payload.files() {
            io::validate_media_reference(root, &item.path)?;
            references.insert(item.path.clone());
        }
    }
    Ok(references)
}

fn remove_managed_media(root: &Path, path: &Path) -> Result<(), String> {
    io::remove_media(root, path)
}

fn file_asset(
    path: &Path,
    folder: Option<String>,
    origin: ClipboardOrigin,
) -> Result<Asset, String> {
    let meta = vv_media::probe_media(path).map_err(|e| e.to_string())?;
    let mut project = Project::default();
    let id = project.media_pool.insert(MediaItem {
        path: path.to_path_buf(),
        meta,
        // `0` only if the file vanished meanwhile: the copy then fails anyway.
        content_hash: vv_media::content_fingerprint(path).unwrap_or(0),
        compound: None,
        folder: None,
    });
    Ok(Asset {
        id: new_id(),
        name: vv_session::file_label(path),
        folder,
        payload: ClipboardPayload::new(origin, &project, &[id], &[]),
    })
}

fn store_prepared_asset(root: &Path, mut asset: Asset) -> Result<PreparedAsset, String> {
    let guard = Guard::write(root, Kind::Assets)?;
    let (_, folders, _) = read_assets(&guard)?;
    valid_parent(&folders, asset.folder.as_deref())?;
    let media_dir = root.join("media");
    for item in asset.payload.files_mut() {
        if !item.path.is_file() {
            return Err(t!("library.file_missing", path = item.path.display()).into_owned());
        }
        if !item.path.starts_with(&media_dir) {
            item.path = copy_to_media(&media_dir, &item.path, item.content_hash)?;
        } else {
            io::validate_media_reference(root, &item.path)?;
        }
    }
    let path = format!("assets/{}.json", asset.id);
    let after = asset_text(&asset)?;
    let before = guard.read(&path)?;
    if before.as_ref().is_some_and(|before| before.bytes != after) {
        return Err("An existing native asset was preserved".into());
    }
    guard.commit(vec![Target {
        path: path.clone(),
        before,
        after: Some(after),
    }])?;
    let record = guard
        .read(&path)?
        .ok_or("Native asset publication needs refresh")?;
    Ok(PreparedAsset {
        asset,
        record: Some(record),
    })
}

#[cfg(test)]
fn store_asset(root: &Path, asset: Asset) -> Result<Asset, String> {
    store_prepared_asset(root, asset).map(|prepared| prepared.asset)
}

/// Into `media/<content hash>/`, so two assets sharing a file share the
/// copy and the file keeps its name.
fn copy_to_media(media_dir: &Path, src: &Path, content_hash: u64) -> Result<PathBuf, String> {
    io::copy_media(
        media_dir.parent().ok_or("Missing native library root")?,
        src,
        content_hash,
        &original_name(src)?,
    )
}

/// Through a temporary name: a copy cut short must not look done.
/// `progress` gets the bytes of each chunk and returns `false` to stop.
fn copy_file(src: &Path, dest: &Path, progress: &dyn Fn(u64) -> bool) -> Result<(), String> {
    use std::io::{Read, Write};
    let mut partial_name = dest.file_name().unwrap_or_default().to_owned();
    partial_name.push(".partial");
    let partial = dest.with_file_name(partial_name);
    let src_error = |e: std::io::Error| format!("{}: {e}", src.display());
    let dest_error = |e: std::io::Error| format!("{}: {e}", partial.display());
    let mut reader = std::fs::File::open(src).map_err(src_error)?;
    let mut writer = std::fs::File::create(&partial).map_err(dest_error)?;
    let mut buffer = vec![0; 1 << 20];
    loop {
        let read = reader.read(&mut buffer).map_err(src_error)?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read]).map_err(dest_error)?;
        if !progress(read as u64) {
            drop(writer);
            let _ = std::fs::remove_file(&partial);
            return Err(format!("{}: cancelled", src.display()));
        }
    }
    drop(writer);
    std::fs::rename(&partial, dest).map_err(|e| e.to_string())
}

/// The file name without the `<content hash>-` prefix the first library
/// copies were given.
fn original_name(path: &Path) -> Result<String, String> {
    let name = path
        .file_name()
        .ok_or_else(|| format!("{}: not a file", path.display()))?
        .to_string_lossy();
    let hashed = name.len() > 17
        && name.as_bytes()[16] == b'-'
        && name[..16].bytes().all(|b| b.is_ascii_hexdigit());
    Ok(if hashed { &name[17..] } else { &name }.to_owned())
}

/// A copy of a library file in `dir`, for a project: an identical file
/// already there is reused, a different one with the same name gets
/// " (2)", " (3)", ... appended. `progress` as in `copy_file`.
pub(crate) fn copy_for_project(
    src: &Path,
    dir: &Path,
    progress: &dyn Fn(u64) -> bool,
) -> Result<PathBuf, String> {
    let name = original_name(src)?;
    let size = std::fs::metadata(src)
        .map_err(|e| format!("{}: {e}", src.display()))?
        .len();
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem.to_owned(), format!(".{ext}")),
        _ => (name.clone(), String::new()),
    };
    for n in 1.. {
        let dest = match n {
            1 => dir.join(&name),
            n => dir.join(format!("{stem} ({n}){ext}")),
        };
        match std::fs::metadata(&dest) {
            Ok(meta) if meta.len() == size => return Ok(dest),
            Ok(_) => continue,
            Err(_) => {
                copy_file(src, &dest, progress)?;
                return Ok(dest);
            }
        }
    }
    unreachable!("infinite candidates")
}

/// The first file named `name` under `dir`, at any depth.
fn find_file(dir: &Path, name: &str) -> Option<PathBuf> {
    let mut dirs = vec![dir.to_owned()];
    while let Some(dir) = dirs.pop() {
        for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                dirs.push(path);
            } else if kind.is_file() && entry.file_name().to_string_lossy() == name {
                return Some(path);
            }
        }
    }
    None
}

/// Entries written by a newer Venturi are skipped, not misread.
fn parse<T: serde::de::DeserializeOwned>(id: &str, text: &str) -> Option<T> {
    #[derive(Deserialize)]
    struct Versioned {
        version: u32,
    }
    match serde_json::from_str::<Versioned>(text) {
        Ok(v) if v.version > VERSION => {
            eprintln!("library entry {id}: version {} is newer", v.version);
            return None;
        }
        Err(e) => {
            eprintln!("library entry {id}: {e}");
            return None;
        }
        Ok(_) => {}
    }
    serde_json::from_str(text)
        .map_err(|e| eprintln!("library entry {id}: {e}"))
        .ok()
}

fn new_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos() as u64);
    format!("{nanos:x}-{:x}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

#[cfg(test)]
#[path = "tests/library.rs"]
mod tests;
