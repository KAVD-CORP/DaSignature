//! DaSignature desktop shell (Tauri 2): storage commands used by `TauriStorageAdapter` (M2), the
//! `SecureKeyStore` commands (M3, secrets.rs) and the shell integration (M8, shell.rs: PDF file
//! association, single instance, native menu, Save dialog).
pub mod secrets;
pub mod shell;
pub mod storage;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if app.state::<shell::Opened>().push(shell::paths_from_args(argv)) {
                shell::notify_opened(app);
            } else if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(shell::Opened::default())
        .menu(|app| shell::build_menu(app))
        .on_menu_event(|app, ev| shell::on_menu(app, ev.id().as_ref()))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(storage::Storage::new(dir, Box::new(storage::OsKeyring)));
            app.manage(secrets::Secrets::new(Box::new(secrets::OsSecrets)));
            app.state::<shell::Opened>()
                .push(shell::paths_from_args(std::env::args()));
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
            shell::opened_files_take,
            shell::opened_file_read,
            shell::save_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building DaSignature");
    app.run(|_app, _event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = _event {
            let paths = urls.into_iter().filter_map(|u| u.to_file_path().ok());
            if _app.state::<shell::Opened>().push(paths) {
                shell::notify_opened(_app);
            }
        }
    });
}
