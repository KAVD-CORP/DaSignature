/// Empty Tauri 2 shell (Milestone 1). Commands, menus and file associations land in Milestone 8.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running DaSignature");
}
