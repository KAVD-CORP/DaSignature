//! DaSignature desktop shell (Tauri 2). Milestone 2 adds the storage commands used by
//! `TauriStorageAdapter`, Milestone 3 the `SecureKeyStore` commands (secrets.rs); menus and file
//! associations land in Milestone 8.
pub mod secrets;
pub mod storage;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(storage::Storage::new(dir, Box::new(storage::OsKeyring)));
            app.manage(secrets::Secrets::new(Box::new(secrets::OsSecrets)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            storage::storage_open,
            storage::storage_exec,
            storage::storage_query,
            storage::storage_put_file,
            storage::storage_get_file,
            storage::storage_delete_file,
            storage::storage_usage,
            storage::storage_close,
            secrets::secure_key_get_or_create,
            secrets::secure_key_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DaSignature");
}
