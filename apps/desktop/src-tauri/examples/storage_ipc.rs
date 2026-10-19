//! Test-only bridge (not bundled into the app): runs the real desktop storage backend
//! (rusqlite + SQLCipher, src/storage.rs) behind a JSON-lines protocol on stdin/stdout, so the
//! TypeScript TauriStorageAdapter and QA's contract suites can drive it from Node.
//!
//! Request:  {"id": 1, "cmd": "storage_exec", "args": {...same args as the Tauri command...}}
//! Response: {"id": 1, "ok": true, "result": ...} or {"id": 1, "ok": false, "error": "..."}
//!
//! Usage: storage_ipc <data-dir>. The key comes from the request (`storage_open` {key}); without
//! one this bridge refuses to open (there is no OS credential store in CI).
use dasignature_lib::storage::{KeySource, Result, Storage};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

struct NoKeyring;
impl KeySource for NoKeyring {
    fn get_or_create(&self) -> Result<String> {
        Err("storage_ipc: pass the key to storage_open".into())
    }
}

fn s(v: &Value, k: &str) -> String {
    v.get(k)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}
fn params(v: &Value) -> Vec<Value> {
    v.get("params")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn main() {
    let dir = std::env::args()
        .nth(1)
        .expect("usage: storage_ipc <data-dir>");
    let st = Storage::new(dir.into(), Box::new(NoKeyring));
    let stdin = io::stdin();
    let mut out = io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let req: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                let _ = writeln!(
                    out,
                    "{}",
                    json!({ "id": null, "ok": false, "error": e.to_string() })
                );
                continue;
            }
        };
        let a = req.get("args").cloned().unwrap_or(Value::Null);
        let r: Result<Value> = match s(&req, "cmd").as_str() {
            "storage_open" => st
                .open(a.get("key").and_then(Value::as_str).map(String::from))
                .map(|_| Value::Null),
            "storage_exec" => st.exec(&s(&a, "sql"), &params(&a)).map(|_| Value::Null),
            "storage_query" => st.query(&s(&a, "sql"), &params(&a)).map(Value::Array),
            "storage_put_file" => st
                .put_file(&s(&a, "fileRef"), &s(&a, "data"))
                .map(|_| Value::Null),
            "storage_get_file" => st
                .get_file(&s(&a, "fileRef"))
                .map(|o| o.map_or(Value::Null, Value::String)),
            "storage_delete_file" => st.delete_file(&s(&a, "fileRef")).map(|_| Value::Null),
            "storage_usage" => st.usage(),
            "storage_close" => st.close().map(|_| Value::Null),
            other => Err(format!("unknown command {other}")),
        };
        let resp = match r {
            Ok(v) => json!({ "id": req["id"], "ok": true, "result": v }),
            Err(e) => json!({ "id": req["id"], "ok": false, "error": e }),
        };
        let _ = writeln!(out, "{resp}");
        let _ = out.flush();
    }
}
