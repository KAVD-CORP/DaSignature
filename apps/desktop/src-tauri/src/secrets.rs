//! Desktop `SecureKeyStore` backend (packages/storage/src/adapters/tauri.ts `TauriSecureKeyStore`).
//!
//! Small named secrets (e.g. `dasig.dek`, the column data-encryption key) live in the OS credential
//! store (Keychain, Windows Credential Manager, Secret Service) via the `keyring` crate, never on
//! disk. They are returned base64-encoded. The SQLCipher database key is separate (storage.rs) and
//! never leaves Rust.

use base64::{engine::general_purpose::STANDARD as B64, Engine};

use crate::storage::Result;

const SERVICE: &str = "app.dasignature";
pub const SECRET_BYTES: usize = 32;

/// Where secrets live. The OS keyring in the app; a map in tests.
pub trait SecretBackend: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>>;
    fn set(&self, account: &str, value: &str) -> Result<()>;
    fn delete(&self, account: &str) -> Result<()>;
}

pub struct OsSecrets;
impl SecretBackend for OsSecrets {
    fn get(&self, account: &str) -> Result<Option<String>> {
        let e = keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())?;
        match e.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!(
                "the OS credential store is unavailable ({e}); DaSignature needs it to protect your data"
            )),
        }
    }
    fn set(&self, account: &str, value: &str) -> Result<()> {
        keyring::Entry::new(SERVICE, account)
            .and_then(|e| e.set_password(value))
            .map_err(|e| e.to_string())
    }
    fn delete(&self, account: &str) -> Result<()> {
        match keyring::Entry::new(SERVICE, account).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

pub struct Secrets {
    backend: Box<dyn SecretBackend>,
}

fn account(name: &str) -> Result<String> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'));
    if !ok {
        return Err(format!("invalid secret name: {name}"));
    }
    // Namespaced so it can never collide with the database key entry ("database-key").
    Ok(format!("secret:{name}"))
}

impl Secrets {
    pub fn new(backend: Box<dyn SecretBackend>) -> Self {
        Self { backend }
    }

    /// The base64 32-byte secret under `name`, generated with the OS RNG on first use.
    pub fn get_or_create(&self, name: &str) -> Result<String> {
        let acc = account(name)?;
        if let Some(v) = self.backend.get(&acc)? {
            match B64.decode(&v) {
                Ok(b) if b.len() == SECRET_BYTES => return Ok(v),
                _ => return Err(format!("stored secret {name} is malformed")),
            }
        }
        let mut b = [0u8; SECRET_BYTES];
        getrandom::fill(&mut b).map_err(|e| e.to_string())?;
        let v = B64.encode(b);
        self.backend.set(&acc, &v)?;
        Ok(v)
    }

    pub fn delete(&self, name: &str) -> Result<()> {
        self.backend.delete(&account(name)?)
    }
}

#[tauri::command]
pub async fn secure_key_get_or_create(
    state: tauri::State<'_, Secrets>,
    name: String,
) -> Result<String> {
    state.get_or_create(&name)
}

#[tauri::command]
pub async fn secure_key_delete(state: tauri::State<'_, Secrets>, name: String) -> Result<()> {
    state.delete(&name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MapSecrets(Mutex<HashMap<String, String>>);
    impl SecretBackend for MapSecrets {
        fn get(&self, a: &str) -> Result<Option<String>> {
            Ok(self.0.lock().unwrap().get(a).cloned())
        }
        fn set(&self, a: &str, v: &str) -> Result<()> {
            self.0.lock().unwrap().insert(a.into(), v.into());
            Ok(())
        }
        fn delete(&self, a: &str) -> Result<()> {
            self.0.lock().unwrap().remove(a);
            Ok(())
        }
    }

    #[test]
    fn creates_once_returns_the_same_secret_and_deletes() {
        let s = Secrets::new(Box::new(MapSecrets::default()));
        let a = s.get_or_create("dasig.dek").unwrap();
        assert_eq!(B64.decode(&a).unwrap().len(), 32);
        assert_eq!(s.get_or_create("dasig.dek").unwrap(), a);
        assert_ne!(s.get_or_create("other").unwrap(), a);
        s.delete("dasig.dek").unwrap();
        assert_ne!(s.get_or_create("dasig.dek").unwrap(), a);
    }

    #[test]
    fn rejects_bad_names_and_malformed_values() {
        let b = MapSecrets::default();
        b.set("secret:bad", "not-base64-32").unwrap();
        let s = Secrets::new(Box::new(b));
        for n in ["", "../x", "Database-Key", "a b", &"x".repeat(65)] {
            assert!(s.get_or_create(n).is_err(), "{n}");
        }
        assert!(s.get_or_create("bad").is_err());
        // Never collides with the SQLCipher key entry.
        assert_eq!(account("database-key").unwrap(), "secret:database-key");
    }
}
