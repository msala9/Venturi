use super::*;

struct Fixture {
    root: PathBuf,
    store: Arc<Store>,
}
impl Fixture {
    fn new(entries: usize, bytes: u64) -> Self {
        let root = std::env::temp_dir().join(format!(
            "vv-proxy-cache-test-{}",
            crate::asset_jobs::nonce()
        ));
        let store = Store::open_limits(
            &root,
            Limits {
                entries,
                bytes,
                file: 128,
            },
        )
        .unwrap();
        Self { root, store }
    }
    fn reopen(&self) -> Arc<Store> {
        Store::open_limits(&self.root, self.store.limits).unwrap()
    }
    fn entry(&self, key: &str) -> PathBuf {
        self.root.join(logical_key(key).unwrap())
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn reservation(store: &Arc<Store>, key: &str) -> Reservation {
    match store.acquire(key).unwrap() {
        Acquisition::Write(reservation) => reservation,
        Acquisition::Ready(_) => panic!("Expected a new native proxy reservation"),
    }
}
fn encode(reservation: &Reservation, bytes: &[u8]) {
    let temporary = reservation
        .output()
        .with_extension(format!("tmp-{}.mp4", std::process::id()));
    let mut file = File::options()
        .write(true)
        .truncate(true)
        .open(&temporary)
        .unwrap();
    file.write_all(bytes).unwrap();
    file.sync_all().unwrap();
    drop(file);
    std::fs::rename(temporary, reservation.output()).unwrap();
}
fn ready(store: &Arc<Store>, key: &str) -> Stored {
    let reservation = reservation(store, key);
    encode(&reservation, b"tiny native output fixture");
    reservation.publish().unwrap()
}

#[test]
fn proxy_cache_persists_owned_ready_records_and_exact_hashed_keys_across_managers() {
    let f = Fixture::new(4, 40_000);
    let stored = ready(&f.store, "source-version:medium:metadata");
    let expected_version = stored.version.clone();
    stored.validate().unwrap();
    assert_eq!(stored.bytes, 26);
    assert_eq!(stored.version.split(':').count(), 7);
    let record: serde_json::Value = serde_json::from_slice(
        &std::fs::read(f.entry("source-version:medium:metadata").join(READY)).unwrap(),
    )
    .unwrap();
    assert_eq!(
        record["key"],
        logical_key("source-version:medium:metadata").unwrap()
    );
    assert!(
        !serde_json::to_string(&record)
            .unwrap()
            .contains("source-version")
    );
    drop(stored);
    let reopened = f.reopen();
    let stored = reopened
        .lookup("source-version:medium:metadata")
        .unwrap()
        .unwrap();
    assert_eq!(stored.version, expected_version);
    stored.validate().unwrap();
    assert!(reopened.is_ready("source-version:medium:metadata").unwrap());
    assert!(!reopened.is_ready("other-original:medium:metadata").unwrap());
    assert!(!reopened.is_ready("source-version:high:metadata").unwrap());
    let (bytes, count) = reopened.usage().unwrap();
    assert_eq!(count, 1);
    assert!(bytes > stored.bytes && bytes < 1000);
    assert_eq!(reopened.lookup("").err().unwrap().1, "INVALID_OPERATION");
    assert_eq!(
        reopened.acquire(&"k".repeat(MAX_KEY + 1)).err().unwrap().1,
        "INVALID_OPERATION"
    );
}

#[test]
fn proxy_cache_cross_open_locks_distinguish_busy_catalog_from_missing_and_hold_reader_leases() {
    let f = Fixture::new(1, 10_000);
    let other = f.reopen();
    let pending = reservation(&f.store, "a");
    assert!(other.lookup("a").unwrap().is_none());
    assert!(!other.is_ready("a").unwrap());
    assert_eq!(other.acquire("a").err().unwrap().1, "PROXY_CACHE_BUSY");
    assert_eq!(other.usage().unwrap(), (f.store.reservation_charge(), 1));
    encode(&pending, b"tiny");
    let stored = pending.publish().unwrap();
    let second = other.lookup("a").unwrap().unwrap();
    assert_eq!(other.acquire("b").err().unwrap().1, "PROXY_CACHE_FULL");
    stored.validate().unwrap();
    second.validate().unwrap();
    let catalog = f.store.catalog(true).unwrap();
    assert!(other.lookup("a").unwrap().is_none());
    assert_eq!(other.is_ready("a").err().unwrap().1, "PROXY_CACHE_BUSY");
    drop(catalog);
    assert!(other.is_ready("a").unwrap());
    drop(stored);
    drop(second);
    let pending = reservation(&other, "b");
    assert!(!f.store.is_ready("a").unwrap());
    drop(pending);
}

#[test]
fn proxy_cache_interrupted_reservations_recover_only_on_explicit_acquire() {
    let f = Fixture::new(2, 20_000);
    let pending = reservation(&f.store, "interrupted");
    encode(&pending, b"unfinished but renamed movie");
    drop(pending);
    let before = std::fs::read(f.entry("interrupted").join(INTENT)).unwrap();
    let reopened = f.reopen();
    assert!(reopened.lookup("interrupted").unwrap().is_none());
    assert_eq!(
        std::fs::read(f.entry("interrupted").join(INTENT)).unwrap(),
        before
    );
    assert_eq!(reopened.usage().unwrap(), (f.store.reservation_charge(), 1));
    let replacement = reservation(&reopened, "interrupted");
    assert!(!replacement.output().exists());
    assert_ne!(
        replacement.intent.value.owner,
        serde_json::from_slice::<Intent>(&before).unwrap().owner
    );
    encode(&replacement, b"complete replacement");
    let stored = replacement.publish().unwrap();
    stored.validate().unwrap();
    drop(stored);
    assert!(reopened.is_ready("interrupted").unwrap());
    let pending = reservation(&reopened, "partial");
    let temporary = pending
        .output()
        .with_extension(format!("tmp-{}.mp4", std::process::id()));
    std::fs::write(&temporary, b"partial encoder data").unwrap();
    drop(pending);
    let recovered = reservation(&f.store, "partial");
    assert_eq!(
        std::fs::metadata(
            recovered
                .output()
                .with_extension(format!("tmp-{}.mp4", std::process::id()))
        )
        .unwrap()
        .len(),
        0
    );
}

#[test]
fn proxy_cache_global_count_and_byte_admission_evict_only_idle_owned_entries() {
    for (entries, bytes) in [(1, 10_000), (2, 8320)] {
        let f = Fixture::new(entries, bytes);
        let first = ready(&f.store, "a");
        let other = f.reopen();
        assert_eq!(other.acquire("b").err().unwrap().1, "PROXY_CACHE_FULL");
        first.validate().unwrap();
        drop(first);
        let second = ready(&other, "b");
        assert!(f.store.lookup("a").unwrap().is_none());
        assert!(f.store.is_ready("b").unwrap());
        assert_eq!(f.store.usage().unwrap().1, 1);
        second.validate().unwrap();
    }
}

#[test]
fn proxy_cache_preserves_foreign_or_malformed_entries_and_rejects_path_replacement() {
    let f = Fixture::new(2, 20_000);
    let pending = reservation(&f.store, "a");
    drop(pending);
    let foreign = f.entry("a").join("foreign.txt");
    std::fs::write(&foreign, b"preserve this file").unwrap();
    let before = std::fs::read(f.entry("a").join(INTENT)).unwrap();
    assert_eq!(
        f.store.acquire("a").err().unwrap().1,
        "PROXY_CACHE_RECOVERY_REQUIRED"
    );
    assert_eq!(std::fs::read(&foreign).unwrap(), b"preserve this file");
    assert_eq!(std::fs::read(f.entry("a").join(INTENT)).unwrap(), before);
    std::fs::remove_file(foreign).unwrap();
    let mut malformed: serde_json::Value = serde_json::from_slice(&before).unwrap();
    malformed["foreign"] = true.into();
    std::fs::write(
        f.entry("a").join(INTENT),
        serde_json::to_vec(&malformed).unwrap(),
    )
    .unwrap();
    assert_eq!(
        f.store.acquire("a").err().unwrap().1,
        "PROXY_CACHE_RECOVERY_REQUIRED"
    );
    assert_eq!(
        std::fs::read(f.entry("a").join(INTENT)).unwrap(),
        serde_json::to_vec(&malformed).unwrap()
    );
    let outside = f.root.with_extension("moved");
    std::fs::rename(&f.root, &outside).unwrap();
    std::fs::create_dir(&f.root).unwrap();
    assert_eq!(f.store.check().unwrap_err().1, "SOURCE_CHANGED");
    std::fs::remove_dir_all(&outside).unwrap();
}

#[test]
fn proxy_cache_ready_leases_detect_same_size_rewrites_and_replaced_manifests() {
    let f = Fixture::new(3, 30_000);
    let stored = ready(&f.store, "artifact");
    let movie = f.entry("artifact").join(MOVIE);
    let modified = stored.file.metadata().unwrap().modified().unwrap();
    let mut writer = File::options().write(true).open(&movie).unwrap();
    writer.write_all(b"other native output value!").unwrap();
    writer
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    writer.sync_all().unwrap();
    drop(writer);
    assert_eq!(stored.file.metadata().unwrap().len(), stored.bytes);
    assert_eq!(stored.validate().unwrap_err().1, "SOURCE_CHANGED");
    drop(stored);
    // Isolated stores keep each deliberately corrupted catalog independent.
    let g = Fixture::new(2, 20_000);
    let stored = ready(&g.store, "record");
    let record = g.entry("record").join(READY);
    let bytes = std::fs::read(&record).unwrap();
    let replacement = g.root.join("replacement");
    std::fs::write(&replacement, &bytes).unwrap();
    std::fs::rename(&replacement, &record).unwrap();
    assert!(stored.validate().is_err());
    assert_eq!(std::fs::read(&record).unwrap(), bytes);
    drop(stored);
    let h = Fixture::new(2, 20_000);
    let stored = ready(&h.store, "intent");
    let intent = h.entry("intent").join(INTENT);
    let bytes = std::fs::read(&intent).unwrap();
    let replacement = h.root.join("replacement");
    std::fs::write(&replacement, &bytes).unwrap();
    std::fs::rename(&replacement, &intent).unwrap();
    assert!(stored.validate().is_err());
    assert_eq!(std::fs::read(&intent).unwrap(), bytes);
}
