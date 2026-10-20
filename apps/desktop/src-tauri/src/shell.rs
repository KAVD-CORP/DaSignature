//! Desktop shell integration (M8): PDF file association / "Open with", the native menu, and a
//! native Save dialog for exports. The webview hears about menu items and newly opened files via
//! DOM CustomEvents (`dasig-menu`, `dasig-open`), so the UI never imports Tauri (SPEC Sec 4).
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Runtime, State, WebviewWindow};

/// Files handed to the app by the OS (argv, second instance, macOS Opened events) that the UI has
/// not taken yet, plus every path ever handed over (the only paths `opened_file_read` may read).
#[derive(Default)]
pub struct Opened {
    pending: Mutex<Vec<PathBuf>>,
    allowed: Mutex<Vec<PathBuf>>,
}

impl Opened {
    pub fn push(&self, paths: impl IntoIterator<Item = PathBuf>) -> bool {
        let mut any = false;
        for p in paths {
            let is_pdf = p
                .extension()
                .map(|e| e.eq_ignore_ascii_case("pdf"))
                .unwrap_or(false);
            if !is_pdf || !p.is_file() {
                continue;
            }
            self.allowed.lock().unwrap().push(p.clone());
            self.pending.lock().unwrap().push(p);
            any = true;
        }
        any
    }
    pub fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.pending.lock().unwrap())
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect()
    }
    pub fn may_read(&self, p: &PathBuf) -> bool {
        self.allowed.lock().unwrap().iter().any(|a| a == p)
    }
}

/// argv minus the program name and flags.
pub fn paths_from_args(args: impl IntoIterator<Item = String>) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .collect()
}

fn dispatch<R: Runtime>(win: &WebviewWindow<R>, event: &str, detail: &str) {
    let js = format!(
        "window.dispatchEvent(new CustomEvent({}, {{ detail: {} }}))",
        serde_json::to_string(event).unwrap(),
        serde_json::to_string(detail).unwrap()
    );
    let _ = win.eval(&js);
}

pub fn notify_opened<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_focus();
        dispatch(&win, "dasig-open", "");
    }
}

pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let file = Submenu::with_items(
        app,
        "&File",
        true,
        &[
            &MenuItem::with_id(app, "open", "&Open PDF…", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "export", "&Export signed PDF…", true, Some("CmdOrCtrl+E"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "&Settings", true, Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("&Quit"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "&Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let go = Submenu::with_items(
        app,
        "&Go",
        true,
        &[
            &MenuItem::with_id(app, "library", "&Documents", true, Some("CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, "signatures", "&Signatures", true, Some("CmdOrCtrl+2"))?,
        ],
    )?;
    let help = Submenu::with_items(
        app,
        "&Help",
        true,
        &[&MenuItem::with_id(app, "about", "&About DaSignature", true, None::<&str>)?],
    )?;
    Menu::with_items(app, &[&file, &edit, &go, &help])
}

pub fn on_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if let Some(win) = app.get_webview_window("main") {
        dispatch(&win, "dasig-menu", id);
    }
}

#[tauri::command]
pub fn opened_files_take(state: State<'_, Opened>) -> Vec<String> {
    state.take()
}

/// Reads a file the OS handed to the app (never an arbitrary path), as base64.
#[tauri::command]
pub async fn opened_file_read(state: State<'_, Opened>, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !state.may_read(&p) {
        return Err("not an opened file".into());
    }
    std::fs::read(&p)
        .map(|b| STANDARD.encode(b))
        .map_err(|e| e.to_string())
}

/// Native Save dialog; returns the chosen file name, or None when cancelled.
#[tauri::command]
pub async fn save_file<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    data: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    let ext = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("pdf")
        .to_ascii_lowercase();
    let picked = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter(ext.to_uppercase(), &[ext.as_str()])
        .blocking_save_file();
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(Some(
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or(name),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_skip_program_and_flags() {
        let v = paths_from_args(["app".into(), "--flag".into(), "/x/a.pdf".into()]);
        assert_eq!(v, vec![PathBuf::from("/x/a.pdf")]);
    }

    #[test]
    fn only_existing_pdfs_are_accepted_and_readable() {
        let dir = tempfile::tempdir().unwrap();
        let pdf = dir.path().join("a.PDF");
        std::fs::write(&pdf, b"%PDF-1.7").unwrap();
        let txt = dir.path().join("b.txt");
        std::fs::write(&txt, b"x").unwrap();
        let o = Opened::default();
        assert!(o.push([pdf.clone(), txt.clone(), dir.path().join("missing.pdf")]));
        assert_eq!(o.take(), vec![pdf.to_string_lossy().into_owned()]);
        assert!(o.take().is_empty());
        assert!(o.may_read(&pdf));
        assert!(!o.may_read(&txt));
    }
}
