//! Desktop storage backend for `TauriStorageAdapter` (packages/storage/src/adapters/tauri.ts).
//!
//! SQLite + SQLCipher (rusqlite, bundled, vendored OpenSSL) in the app data dir, file blobs in
//! `<app data>/files`. The database key is a random 256-bit secret in the OS credential store; it
//! is never written to disk by us and never sent to the web view.
//!
//! Wire format: SQL params and row values are JSON; BLOBs are `{"$blob": "<base64>"}` and file
//! bytes are base64 strings (keep in sync with tauri.ts and test/fakes.ts).

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const DB_FILE: &str = "dasignature.db";
const KEYRING_SERVICE: &str = "app.dasignature";
const KEYRING_USER: &str = "database-key";

pub type Result<T> = std::result::Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Where the database key comes from when the web view does not pass one (it normally does not).
pub trait KeySource: Send + Sync {
    fn get_or_create(&self) -> Result<String>;
}

/// The OS credential store via the `keyring` crate.
pub struct OsKeyring;
impl KeySource for OsKeyring {
    fn get_or_create(&self) -> Result<String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(err)?;
        match entry.get_password() {
            Ok(k) => Ok(k),
            Err(keyring::Error::NoEntry) => {
                let k = random_key_hex()?;
                entry.set_password(&k).map_err(err)?;
                Ok(k)
            }
            Err(e) => Err(format!(
                "the OS credential store is unavailable ({e}); DaSignature needs it to protect your data"
            )),
        }
    }
}

pub fn random_key_hex() -> Result<String> {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).map_err(err)?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

fn valid_ref(r: &str) -> bool {
    // uuid (36 chars) plus optional ".ext" (1-8 lowercase alphanumerics); same rule as base.ts.
    let (id, ext) = match r.split_once('.') {
        Some((a, b)) => (a, Some(b)),
        None => (r, None),
    };
    id.len() == 36
        && id
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase() || c == '-')
        && ext.is_none_or(|e| {
            (1..=8).contains(&e.len())
                && e.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        })
}

pub struct Storage {
    dir: PathBuf,
    keys: Box<dyn KeySource>,
    conn: Mutex<Option<Connection>>,
}

impl Storage {
    pub fn new(dir: PathBuf, keys: Box<dyn KeySource>) -> Self {
        Self {
            dir,
            keys,
            conn: Mutex::new(None),
        }
    }

    fn files_dir(&self) -> PathBuf {
        self.dir.join("files")
    }

    pub fn open(&self, key: Option<String>) -> Result<()> {
        let mut guard = self.conn.lock().map_err(err)?;
        if guard.is_some() {
            return Ok(());
        }
        fs::create_dir_all(self.files_dir()).map_err(err)?;
        remove_partial_writes(&self.files_dir());
        let key = match key {
            Some(k) => k,
            None => self.keys.get_or_create()?,
        };
        let conn = Connection::open(self.dir.join(DB_FILE)).map_err(err)?;
        apply_key(&conn, &key)?;
        // Fails with "file is not a database" for a wrong key.
        conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
            r.get::<_, i64>(0)
        })
        .map_err(err)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(err)?;
        *guard = Some(conn);
        Ok(())
    }

    fn with<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let guard = self.conn.lock().map_err(err)?;
        let conn = guard.as_ref().ok_or("storage is not open")?;
        f(conn)
    }

    pub fn exec(&self, sql: &str, params: &[Value]) -> Result<()> {
        self.with(|c| {
            if params.is_empty() {
                c.execute_batch(sql).map_err(err)
            } else {
                let p = params.iter().map(to_sql).collect::<Result<Vec<_>>>()?;
                c.execute(sql, params_from_iter(p)).map(|_| ()).map_err(err)
            }
        })
    }

    pub fn query(&self, sql: &str, params: &[Value]) -> Result<Vec<Value>> {
        self.with(|c| {
            let p = params.iter().map(to_sql).collect::<Result<Vec<_>>>()?;
            let mut stmt = c.prepare(sql).map_err(err)?;
            let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
            let mut rows = stmt.query(params_from_iter(p)).map_err(err)?;
            let mut out = Vec::new();
            while let Some(row) = rows.next().map_err(err)? {
                let mut obj = Map::new();
                for (i, n) in names.iter().enumerate() {
                    obj.insert(n.clone(), from_sql(row.get_ref(i).map_err(err)?));
                }
                out.push(Value::Object(obj));
            }
            Ok(out)
        })
    }

    pub fn put_file(&self, file_ref: &str, data_b64: &str) -> Result<()> {
        // PM #71: new files only ever get opaque names (no extension); legacy `<id>.<ext>`
        // names stay readable/deletable for migration 2.
        if !valid_ref(file_ref) || file_ref.contains('.') {
            return Err(format!("not an opaque file ref: {file_ref}"));
        }
        let bytes = B64.decode(data_b64).map_err(err)?;
        let tmp = self.files_dir().join(format!("{file_ref}.tmp"));
        fs::write(&tmp, bytes).map_err(err)?;
        fs::rename(&tmp, self.files_dir().join(file_ref)).map_err(err)
    }

    pub fn get_file(&self, file_ref: &str) -> Result<Option<String>> {
        if !valid_ref(file_ref) {
            return Err(format!("invalid file ref: {file_ref}"));
        }
        match fs::read(self.files_dir().join(file_ref)) {
            Ok(b) => Ok(Some(B64.encode(b))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(err(e)),
        }
    }

    pub fn delete_file(&self, file_ref: &str) -> Result<()> {
        if !valid_ref(file_ref) {
            return Err(format!("invalid file ref: {file_ref}"));
        }
        match fs::remove_file(self.files_dir().join(file_ref)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(err(e)),
            _ => Ok(()),
        }
    }

    pub fn usage(&self) -> Result<Value> {
        Ok(json!({ "used": dir_size(&self.dir) }))
    }

    pub fn close(&self) -> Result<()> {
        let mut guard = self.conn.lock().map_err(err)?;
        if let Some(c) = guard.take() {
            c.close().map_err(|(_, e)| err(e))?;
        }
        Ok(())
    }
}

/// A crash during put_file can leave `<ref>.tmp`; the real file was never replaced, so drop it.
fn remove_partial_writes(dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.flatten() {
            if e.file_name().to_string_lossy().ends_with(".tmp") {
                let _ = fs::remove_file(e.path());
            }
        }
    }
}

fn apply_key(conn: &Connection, key: &str) -> Result<()> {
    let is_raw = key.len() == 64 && key.chars().all(|c| c.is_ascii_hexdigit());
    if is_raw {
        // A raw 256-bit key: SQLCipher skips its passphrase KDF.
        conn.execute_batch(&format!("PRAGMA key = \"x'{key}'\";"))
            .map_err(err)
    } else {
        conn.pragma_update(None, "key", key).map_err(err)
    }
}

fn dir_size(p: &Path) -> u64 {
    let Ok(rd) = fs::read_dir(p) else { return 0 };
    rd.flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

fn to_sql(v: &Value) -> Result<SqlValue> {
    Ok(match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().ok_or("bad number")?),
        },
        Value::String(s) => SqlValue::Text(s.clone()),
        Value::Object(o) => match o.get("$blob") {
            Some(Value::String(b)) => SqlValue::Blob(B64.decode(b).map_err(err)?),
            _ => return Err("unsupported object parameter".into()),
        },
        Value::Array(_) => return Err("unsupported array parameter".into()),
    })
}

fn from_sql(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => json!({ "$blob": B64.encode(b) }),
    }
}

/* ------------------------------ Tauri commands ------------------------------ */

type St<'a> = tauri::State<'a, Storage>;

#[tauri::command]
pub async fn storage_open(state: St<'_>, key: Option<String>) -> Result<()> {
    state.open(key)
}
#[tauri::command]
pub async fn storage_exec(state: St<'_>, sql: String, params: Vec<Value>) -> Result<()> {
    state.exec(&sql, &params)
}
#[tauri::command]
pub async fn storage_query(state: St<'_>, sql: String, params: Vec<Value>) -> Result<Vec<Value>> {
    state.query(&sql, &params)
}
#[tauri::command]
pub async fn storage_put_file(state: St<'_>, file_ref: String, data: String) -> Result<()> {
    state.put_file(&file_ref, &data)
}
#[tauri::command]
pub async fn storage_get_file(state: St<'_>, file_ref: String) -> Result<Option<String>> {
    state.get_file(&file_ref)
}
#[tauri::command]
pub async fn storage_delete_file(state: St<'_>, file_ref: String) -> Result<()> {
    state.delete_file(&file_ref)
}
#[tauri::command]
pub async fn storage_usage(state: St<'_>) -> Result<Value> {
    state.usage()
}
#[tauri::command]
pub async fn storage_close(state: St<'_>) -> Result<()> {
    state.close()
}

#[cfg(test)]
mod tests {
    //! ENC-01 (desktop): the database file on disk is SQLCipher ciphertext.
    use super::*;

    struct FixedKey(String);
    impl KeySource for FixedKey {
        fn get_or_create(&self) -> Result<String> {
            Ok(self.0.clone())
        }
    }

    const MARKER: &str = "ENC01-MARKER-Confidential-Lease";

    fn fill(dir: &Path, key: &str) {
        let s = Storage::new(dir.to_path_buf(), Box::new(FixedKey(key.into())));
        s.open(None).unwrap();
        s.exec(
            "CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
            &[],
        )
        .unwrap();
        for i in 0..200 {
            s.exec(
                "INSERT INTO documents VALUES (?, ?)",
                &[json!(format!("id{i}")), json!(MARKER)],
            )
            .unwrap();
        }
        s.close().unwrap();
    }

    #[test]
    fn enc01_database_file_is_not_plain_sqlite() {
        let dir = tempfile::tempdir().unwrap();
        let key = random_key_hex().unwrap();
        fill(dir.path(), &key);
        let raw = fs::read(dir.path().join(DB_FILE)).unwrap();
        assert!(raw.len() > 4096);
        assert!(
            !raw.starts_with(b"SQLite format 3\0"),
            "header must not be plaintext SQLite"
        );
        let has = |needle: &[u8]| raw.windows(needle.len()).any(|w| w == needle);
        assert!(
            !has(MARKER.as_bytes()),
            "marker string found in the database file"
        );
        assert!(!has(b"CREATE TABLE"), "schema found in the database file");
        // The key is not on disk (neither hex nor raw bytes) anywhere in the data dir.
        let key_bytes: Vec<u8> = (0..32)
            .map(|i| u8::from_str_radix(&key[i * 2..i * 2 + 2], 16).unwrap())
            .collect();
        for entry in fs::read_dir(dir.path()).unwrap().flatten() {
            if entry.path().is_file() {
                let b = fs::read(entry.path()).unwrap();
                assert!(!b.windows(64).any(|w| w == key.as_bytes()));
                assert!(!b.windows(32).any(|w| w == key_bytes.as_slice()));
            }
        }
    }

    #[test]
    fn enc01_unreadable_without_or_with_wrong_key() {
        let dir = tempfile::tempdir().unwrap();
        fill(dir.path(), &random_key_hex().unwrap());
        // No key: plain SQLite cannot read it.
        let c = Connection::open(dir.path().join(DB_FILE)).unwrap();
        let e = c.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
            r.get::<_, i64>(0)
        });
        assert!(e.unwrap_err().to_string().contains("not a database"));
        drop(c);
        // Wrong key: open() fails.
        let s = Storage::new(
            dir.path().to_path_buf(),
            Box::new(FixedKey(random_key_hex().unwrap())),
        );
        assert!(s.open(None).unwrap_err().contains("not a database"));
        // The sqlite3 CLI (if installed) cannot read it either.
        if let Ok(out) = std::process::Command::new("sqlite3")
            .arg(dir.path().join(DB_FILE))
            .arg("SELECT count(*) FROM sqlite_master;")
            .output()
        {
            assert!(
                !out.status.success(),
                "sqlite3 CLI read the encrypted database"
            );
        }
    }

    #[test]
    fn round_trip_with_right_key_and_wire_format() {
        let dir = tempfile::tempdir().unwrap();
        let key = random_key_hex().unwrap();
        fill(dir.path(), &key);
        let s = Storage::new(dir.path().to_path_buf(), Box::new(FixedKey(key)));
        s.open(None).unwrap();
        let rows = s
            .query("SELECT title FROM documents WHERE id = ?", &[json!("id7")])
            .unwrap();
        assert_eq!(rows, vec![json!({ "title": MARKER })]);
        s.exec("CREATE TABLE b (v BLOB, n REAL, i INTEGER, z TEXT)", &[])
            .unwrap();
        s.exec(
            "INSERT INTO b VALUES (?, ?, ?, ?)",
            &[
                json!({ "$blob": B64.encode([0u8, 1, 255]) }),
                json!(1.5),
                json!(true),
                Value::Null,
            ],
        )
        .unwrap();
        let rows = s.query("SELECT * FROM b", &[]).unwrap();
        assert_eq!(
            rows,
            vec![json!({ "v": { "$blob": "AAH/" }, "n": 1.5, "i": 1, "z": null })]
        );
        let r = "0190a000-0000-7000-8000-000000000001";
        s.put_file(r, &B64.encode(b"bytes")).unwrap();
        // PM #71: no new file can get an extension; a legacy name is still readable.
        let legacy = "0190a000-0000-7000-8000-000000000002.pdf";
        assert!(s.put_file(legacy, &B64.encode(b"x")).is_err());
        fs::write(dir.path().join("files").join(legacy), b"old").unwrap();
        assert_eq!(s.get_file(legacy).unwrap(), Some(B64.encode(b"old")));
        s.delete_file(legacy).unwrap();
        assert_eq!(s.get_file(r).unwrap(), Some(B64.encode(b"bytes")));
        s.delete_file(r).unwrap();
        assert_eq!(s.get_file(r).unwrap(), None);
        assert!(s.get_file("../../etc/passwd").is_err());
        assert!(s.usage().unwrap()["used"].as_u64().unwrap() > 0);
        // Foreign keys are on.
        assert_eq!(
            s.query("PRAGMA foreign_keys", &[]).unwrap(),
            vec![json!({ "foreign_keys": 1 })]
        );
        s.close().unwrap();
    }
}
