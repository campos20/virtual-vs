//! The `vvsfs://` protocol: synchronous file access for the webview.
//!
//! The mobile app's storage layer (`src/storage`) is written against
//! `expo-file-system`, whose API is partly synchronous (`file.exists`,
//! `textSync()`, settings read at startup). Tauri commands are asynchronous,
//! but a synchronous XMLHttpRequest to a custom protocol is not, so the
//! desktop build's `expo-file-system` replacement (`desktop/web/shims`) talks
//! to this handler and the mobile storage code runs unchanged.
//!
//! The protocol is only reachable from this app's own webview. Requests are
//! `<op>?path=...` with the payload (if any) as the body. Errors come back as
//! HTTP 500 with a plain-text message, which the shim rethrows.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use serde_json::json;
use tauri::http::{Request, Response};

/// Where `Paths.document` and `Paths.cache` point.
#[derive(Clone, Debug)]
pub struct Roots {
    pub document: PathBuf,
    pub cache: PathBuf,
}

static ROOTS: OnceLock<Roots> = OnceLock::new();
static HANDLES: OnceLock<Mutex<HashMap<u32, File>>> = OnceLock::new();
static NEXT_HANDLE: AtomicU32 = AtomicU32::new(1);

pub fn init(roots: Roots) {
    let _ = fs::create_dir_all(&roots.document);
    let _ = fs::create_dir_all(&roots.cache);
    let _ = ROOTS.set(roots);
}

fn handles() -> std::sync::MutexGuard<'static, HashMap<u32, File>> {
    HANDLES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Stat {
    exists: bool,
    is_directory: bool,
    size: Option<u64>,
    modification_time: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    name: String,
    is_directory: bool,
}

enum Reply {
    Json(serde_json::Value),
    Bytes(Vec<u8>),
    Empty,
}

fn query(request: &Request<Vec<u8>>) -> HashMap<String, String> {
    request
        .uri()
        .query()
        .unwrap_or("")
        .split('&')
        .filter(|pair| !pair.is_empty())
        .filter_map(|pair| {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            Some((percent_decode(k)?, percent_decode(v)?))
        })
        .collect()
}

/// Decodes `%XX` escapes (UTF-8) and `+` is left as-is - the shim encodes
/// with `encodeURIComponent`, which never produces `+` for spaces.
fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = input.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn param<'a>(q: &'a HashMap<String, String>, key: &str) -> Result<&'a str, String> {
    q.get(key)
        .map(String::as_str)
        .ok_or_else(|| format!("missing parameter {key}"))
}

fn flag(q: &HashMap<String, String>, key: &str) -> bool {
    q.get(key).is_some_and(|v| v == "1" || v == "true")
}

fn path_param(q: &HashMap<String, String>, key: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(param(q, key)?);
    if !path.is_absolute() {
        return Err(format!("{} is not an absolute path", path.display()));
    }
    Ok(path)
}

fn io_err(action: &str, path: &Path, e: std::io::Error) -> String {
    format!("{action} {}: {e}", path.display())
}

fn stat(path: &Path) -> Stat {
    match fs::metadata(path) {
        Ok(meta) => Stat {
            exists: true,
            is_directory: meta.is_dir(),
            size: if meta.is_dir() {
                None
            } else {
                Some(meta.len())
            },
            modification_time: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64() * 1000.0),
        },
        Err(_) => Stat {
            exists: false,
            is_directory: false,
            size: None,
            modification_time: None,
        },
    }
}

fn copy_recursive(from: &Path, to: &Path) -> Result<(), String> {
    if from.is_dir() {
        fs::create_dir_all(to).map_err(|e| io_err("Could not create", to, e))?;
        for entry in fs::read_dir(from).map_err(|e| io_err("Could not list", from, e))? {
            let entry = entry.map_err(|e| io_err("Could not list", from, e))?;
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(from, to)
            .map(|_| ())
            .map_err(|e| io_err("Could not copy", from, e))
    }
}

fn delete(path: &Path) -> Result<(), String> {
    let result = if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    result.map_err(|e| io_err("Could not delete", path, e))
}

/// Writes through a temporary file and a rename, so a crash mid-write never
/// leaves a truncated manifest or settings file behind.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".vvs-tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, bytes).map_err(|e| io_err("Could not write", path, e))?;
    fs::rename(&tmp, path).map_err(|e| io_err("Could not replace", path, e))
}

fn run(op: &str, q: &HashMap<String, String>, body: &[u8]) -> Result<Reply, String> {
    match op {
        "paths" => {
            let roots = ROOTS.get().ok_or("file system not initialised")?;
            Ok(Reply::Json(json!({
                "document": roots.document,
                "cache": roots.cache,
            })))
        }
        "stat" => Ok(Reply::Json(
            serde_json::to_value(stat(&path_param(q, "path")?)).unwrap_or_default(),
        )),
        "list" => {
            let path = path_param(q, "path")?;
            let mut entries: Vec<Entry> = fs::read_dir(&path)
                .map_err(|e| io_err("Could not list", &path, e))?
                .filter_map(Result::ok)
                .map(|entry| Entry {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    is_directory: entry.path().is_dir(),
                })
                // Leftovers from an interrupted atomic write are not files
                // the app ever created on purpose.
                .filter(|entry| !entry.name.ends_with(".vvs-tmp"))
                .collect();
            entries.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(Reply::Json(
                serde_json::to_value(entries).unwrap_or_default(),
            ))
        }
        "read" => {
            let path = path_param(q, "path")?;
            fs::read(&path)
                .map(Reply::Bytes)
                .map_err(|e| io_err("Could not read", &path, e))
        }
        "write" => {
            let path = path_param(q, "path")?;
            if flag(q, "append") {
                let mut file = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)
                    .map_err(|e| io_err("Could not open", &path, e))?;
                file.write_all(body)
                    .map_err(|e| io_err("Could not write", &path, e))?;
            } else {
                write_atomic(&path, body)?;
            }
            Ok(Reply::Empty)
        }
        "mkdir" => {
            let path = path_param(q, "path")?;
            if path.is_dir() {
                if flag(q, "idempotent") || flag(q, "overwrite") {
                    return Ok(Reply::Empty);
                }
                return Err(format!("{} already exists", path.display()));
            }
            let result = if flag(q, "intermediates") {
                fs::create_dir_all(&path)
            } else {
                fs::create_dir(&path)
            };
            result
                .map(|_| Reply::Empty)
                .map_err(|e| io_err("Could not create", &path, e))
        }
        "create-file" => {
            let path = path_param(q, "path")?;
            if path.exists() && !flag(q, "overwrite") {
                return Err(format!("{} already exists", path.display()));
            }
            if flag(q, "intermediates") {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| io_err("Could not create", parent, e))?;
                }
            }
            File::create(&path)
                .map(|_| Reply::Empty)
                .map_err(|e| io_err("Could not create", &path, e))
        }
        "delete" => {
            delete(&path_param(q, "path")?)?;
            Ok(Reply::Empty)
        }
        "copy" => {
            let (from, to) = (path_param(q, "from")?, path_param(q, "to")?);
            if to.exists() && !flag(q, "overwrite") {
                return Err(format!("{} already exists", to.display()));
            }
            copy_recursive(&from, &to)?;
            Ok(Reply::Empty)
        }
        "move" => {
            let (from, to) = (path_param(q, "from")?, path_param(q, "to")?);
            if to.exists() && !flag(q, "overwrite") {
                return Err(format!("{} already exists", to.display()));
            }
            // rename fails across volumes; fall back to copy + delete.
            if fs::rename(&from, &to).is_err() {
                copy_recursive(&from, &to)?;
                delete(&from)?;
            }
            Ok(Reply::Empty)
        }
        "open" => {
            let path = path_param(q, "path")?;
            let mode = param(q, "mode")?;
            let mut options = OpenOptions::new();
            match mode {
                "r" => options.read(true),
                "w" => options.write(true).create(true),
                "rw" => options.read(true).write(true).create(true),
                "wa" => options.append(true).create(true),
                "wt" => options.write(true).create(true).truncate(true),
                other => return Err(format!("unknown file mode {other}")),
            };
            let file = options
                .open(&path)
                .map_err(|e| io_err("Could not open", &path, e))?;
            let size = file.metadata().map(|m| m.len()).ok();
            let id = NEXT_HANDLE.fetch_add(1, Ordering::Relaxed);
            handles().insert(id, file);
            Ok(Reply::Json(json!({ "handle": id, "size": size })))
        }
        "handle-read" | "handle-write" | "handle-seek" | "handle-info" | "handle-close" => {
            let id: u32 = param(q, "handle")?.parse().map_err(|_| "bad handle")?;
            let mut table = handles();
            if op == "handle-close" {
                table.remove(&id);
                return Ok(Reply::Empty);
            }
            let file = table.get_mut(&id).ok_or("file handle is closed")?;
            match op {
                "handle-read" => {
                    let length: usize = param(q, "length")?.parse().map_err(|_| "bad length")?;
                    let mut buffer = Vec::with_capacity(length);
                    file.take(length as u64)
                        .read_to_end(&mut buffer)
                        .map_err(|e| format!("Read failed: {e}"))?;
                    Ok(Reply::Bytes(buffer))
                }
                "handle-write" => {
                    file.write_all(body)
                        .map_err(|e| format!("Write failed: {e}"))?;
                    Ok(Reply::Empty)
                }
                "handle-seek" => {
                    let offset: u64 = param(q, "offset")?.parse().map_err(|_| "bad offset")?;
                    file.seek(SeekFrom::Start(offset))
                        .map_err(|e| format!("Seek failed: {e}"))?;
                    Ok(Reply::Empty)
                }
                _ => {
                    let offset = file
                        .stream_position()
                        .map_err(|e| format!("Seek failed: {e}"))?;
                    let size = file.metadata().map(|m| m.len()).ok();
                    Ok(Reply::Json(json!({ "offset": offset, "size": size })))
                }
            }
        }
        other => Err(format!("unknown operation {other}")),
    }
}

/// Entry point for `register_uri_scheme_protocol`. Never panics: any panic
/// in an operation becomes an error response instead of taking the app (and
/// whatever is playing) down.
pub fn handle(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let op = request.uri().path().trim_start_matches('/').to_string();
    let q = query(&request);
    let body = request.body();
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&op, &q, body)))
        .unwrap_or_else(|_| Err(format!("internal error in {op}")));

    let builder = Response::builder().header("Access-Control-Allow-Origin", "*");
    let response = match outcome {
        Ok(Reply::Json(value)) => builder
            .status(200)
            .header("Content-Type", "application/json")
            .body(value.to_string().into_bytes()),
        Ok(Reply::Bytes(bytes)) => builder
            .status(200)
            .header("Content-Type", "application/octet-stream")
            .body(bytes),
        Ok(Reply::Empty) => builder.status(204).body(Vec::new()),
        Err(message) => builder
            .status(500)
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(message.into_bytes()),
    };
    response.unwrap_or_else(|_| Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(path_and_query: &str, body: &[u8]) -> Request<Vec<u8>> {
        Request::builder()
            .uri(format!("vvsfs://localhost/{path_and_query}"))
            .body(body.to_vec())
            .unwrap()
    }

    fn enc(path: &Path) -> String {
        path.to_string_lossy()
            .bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    (b as char).to_string()
                }
                _ => format!("%{b:02X}"),
            })
            .collect()
    }

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "vvsfs-test-{}-{}",
            std::process::id(),
            NEXT_HANDLE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn json_of(response: Response<Vec<u8>>) -> serde_json::Value {
        assert_eq!(
            response.status(),
            200,
            "{}",
            String::from_utf8_lossy(response.body())
        );
        serde_json::from_slice(response.body()).unwrap()
    }

    #[test]
    fn write_read_stat_list_delete() {
        let dir = temp_dir();
        let file = dir.join("ação song.json"); // non-ASCII + space survive encoding
        assert_eq!(
            handle(req(&format!("write?path={}", enc(&file)), b"{\"a\":1}")).status(),
            204
        );
        let read = handle(req(&format!("read?path={}", enc(&file)), b""));
        assert_eq!(read.body(), b"{\"a\":1}");
        let st = json_of(handle(req(&format!("stat?path={}", enc(&file)), b"")));
        assert_eq!(st["exists"], true);
        assert_eq!(st["size"], 7);
        let list = json_of(handle(req(&format!("list?path={}", enc(&dir)), b"")));
        assert_eq!(list[0]["name"], "ação song.json");
        assert_eq!(
            handle(req(&format!("delete?path={}", enc(&dir)), b"")).status(),
            204
        );
        assert!(!dir.exists());
    }

    #[test]
    fn handles_stream_bytes_with_offsets() {
        let dir = temp_dir();
        let file = dir.join("bundle.bin");
        let opened = json_of(handle(req(
            &format!("open?path={}&mode=wt", enc(&file)),
            b"",
        )));
        let h = opened["handle"].as_u64().unwrap();
        handle(req(
            &format!("handle-write?handle={h}"),
            &[1, 2, 3, 4, 5, 255],
        ));
        handle(req(&format!("handle-close?handle={h}"), b""));

        let opened = json_of(handle(req(
            &format!("open?path={}&mode=r", enc(&file)),
            b"",
        )));
        let h = opened["handle"].as_u64().unwrap();
        assert_eq!(opened["size"], 6);
        handle(req(&format!("handle-seek?handle={h}&offset=3"), b""));
        let chunk = handle(req(&format!("handle-read?handle={h}&length=10"), b""));
        assert_eq!(chunk.body(), &[4, 5, 255]);
        let info = json_of(handle(req(&format!("handle-info?handle={h}"), b"")));
        assert_eq!(info["offset"], 6);
        handle(req(&format!("handle-close?handle={h}"), b""));
        let closed = handle(req(&format!("handle-read?handle={h}&length=1"), b""));
        assert_eq!(closed.status(), 500);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn errors_are_responses_not_panics() {
        assert_eq!(handle(req("read?path=relative/path", b"")).status(), 500);
        assert_eq!(handle(req("nonsense", b"")).status(), 500);
        let missing = std::env::temp_dir().join("vvsfs-definitely-missing/x");
        assert_eq!(
            handle(req(&format!("read?path={}", enc(&missing)), b"")).status(),
            500
        );
    }

    #[test]
    fn mkdir_copy_move_and_atomic_write() {
        let dir = temp_dir();
        let nested = dir.join("a/b");
        assert_eq!(
            handle(req(&format!("mkdir?path={}", enc(&nested)), b"")).status(),
            500
        );
        assert_eq!(
            handle(req(
                &format!("mkdir?path={}&intermediates=1", enc(&nested)),
                b""
            ))
            .status(),
            204
        );
        assert_eq!(
            handle(req(
                &format!("mkdir?path={}&idempotent=1", enc(&nested)),
                b""
            ))
            .status(),
            204
        );
        let src = nested.join("x.wav");
        fs::write(&src, b"audio").unwrap();
        let copy = dir.join("y.wav");
        handle(req(
            &format!("copy?from={}&to={}", enc(&src), enc(&copy)),
            b"",
        ));
        assert_eq!(fs::read(&copy).unwrap(), b"audio");
        assert_eq!(
            handle(req(
                &format!("copy?from={}&to={}", enc(&src), enc(&copy)),
                b""
            ))
            .status(),
            500
        );
        let moved = dir.join("z.wav");
        handle(req(
            &format!("move?from={}&to={}", enc(&copy), enc(&moved)),
            b"",
        ));
        assert!(!copy.exists() && moved.exists());
        // An overwrite leaves no temp file behind.
        handle(req(&format!("write?path={}", enc(&moved)), b"new"));
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert!(names
            .iter()
            .all(|n| !n.to_string_lossy().ends_with(".vvs-tmp")));
        fs::remove_dir_all(dir).ok();
    }
}
