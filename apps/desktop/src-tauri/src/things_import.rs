//! Imports Things 3 into `LifeOS` in the background while the Mac app is open.

use std::{
    env, fmt, fs,
    io::Write as _,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Deserialize;
use serde_json::{Value, json};

const CONVEX_URL: &str = env!("LIFEOS_CONVEX_URL");
const IMPORT_PATH: &str = "planner/things:importRows";
const THINGS_SQL: &str = include_str!("../../../things-sync/things.sql");
const KEYCHAIN_SERVICE: &str = "lifeos-app-things-sync";
const TOKEN_VAR: &str = "LIFEOS_THINGS_SYNC_TOKEN";
const DATABASE_FILES: [&str; 3] = ["main.sqlite", "main.sqlite-wal", "main.sqlite-shm"];
/// Gives the window time to draw before the first import competes for the disk.
const FIRST_RUN_AFTER: Duration = Duration::from_secs(10);
const RUN_EVERY: Duration = Duration::from_secs(5 * 60);
const MESSAGE_CHARS: usize = 300;

#[derive(Debug, Clone, PartialEq)]
enum Outcome {
    Imported(Value),
    Retired { retired_at_ms: f64 },
    Failed(String),
}

/// The Things Worker token, kept out of every log line.
struct Token(String);

impl fmt::Debug for Token {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Token([redacted])")
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum Reply {
    Success {
        value: Imported,
    },
    Error {
        #[serde(rename = "errorMessage")]
        error_message: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Imported {
    Done { value: Value },
    Refused { error: Refusal },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Refusal {
    Retired {
        #[serde(rename = "retiredAt")]
        retired_at: f64,
    },
}

#[derive(Debug)]
struct Scratch(PathBuf);

impl Scratch {
    fn new(prefix: &str) -> std::io::Result<Self> {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_nanos());
        let path = env::temp_dir().join(format!("{prefix}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&path)?;
        Ok(Self(path))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.0) {
            eprintln!(
                "things import: could not remove {}: {error}",
                self.0.display()
            );
        }
    }
}

/// Starts the import loop on its own thread: once shortly after launch, then every five minutes.
pub(crate) fn start() {
    let spawned = thread::Builder::new()
        .name("things-import".into())
        .spawn(run);
    if let Err(error) = spawned {
        eprintln!("things import: could not start: {error}");
    }
}

fn run() {
    let Some(database) = env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library/Group Containers"))
        .and_then(|containers| find_database(&containers))
    else {
        eprintln!("things import: no Things database on this Mac, so nothing to import");
        return;
    };
    thread::sleep(FIRST_RUN_AFTER);
    loop {
        match import_once(&database) {
            Outcome::Imported(report) => eprintln!("things import: imported {report}"),
            Outcome::Retired { retired_at_ms } => {
                eprintln!(
                    "things import: the Things import was retired at {retired_at_ms} ms, so it stops for good"
                );
                return;
            }
            Outcome::Failed(reason) => {
                eprintln!("things import: failed, will retry in five minutes: {reason}");
            }
        }
        thread::sleep(RUN_EVERY);
    }
}

fn find_database(group_containers: &Path) -> Option<PathBuf> {
    fs::read_dir(group_containers)
        .ok()?
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .ends_with(".com.culturedcode.ThingsMac")
        })
        .filter_map(|container| fs::read_dir(container.path()).ok())
        .flat_map(Iterator::flatten)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("ThingsData-")
        })
        .map(|data| data.path().join("Things Database.thingsdatabase"))
        .find(|database| database.join(DATABASE_FILES[0]).is_file())
}

fn import_once(database: &Path) -> Outcome {
    try_import(database).unwrap_or_else(Outcome::Failed)
}

fn try_import(database: &Path) -> Result<Outcome, String> {
    let token = read_token()?;
    let rows = read_rows(database)?;
    let text = post(CONVEX_URL, &request_body(&token, &rows))?;
    Ok(outcome(&text, &token))
}

fn read_rows(database: &Path) -> Result<Value, String> {
    let scratch = Scratch::new("lifeos-things").map_err(|error| error.to_string())?;
    for name in DATABASE_FILES {
        let from = database.join(name);
        if from.is_file() {
            fs::copy(&from, scratch.0.join(name))
                .map_err(|error| format!("could not copy {name}: {error}"))?;
        }
    }
    let output = run_with_stdin(
        Command::new("/usr/bin/sqlite3")
            .arg("-readonly")
            .arg(scratch.0.join(DATABASE_FILES[0])),
        THINGS_SQL,
    )
    .map_err(|stderr| format!("sqlite3 failed: {stderr}"))?;
    serde_json::from_slice(&output).map_err(|error| format!("sqlite3 printed no JSON: {error}"))
}

fn read_token() -> Result<Token, String> {
    if let Some(token) = env::var(TOKEN_VAR).ok().filter(|token| !token.is_empty()) {
        return Ok(Token(token));
    }
    let account = env::var("USER").map_err(|_| "USER is not set".to_owned())?;
    let output = Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            &account,
            "-w",
        ])
        .stderr(Stdio::null())
        .output()
        .map_err(|error| format!("could not run security: {error}"))?;
    let token = String::from_utf8(output.stdout)
        .map(|text| text.trim().to_owned())
        .unwrap_or_default();
    if output.status.success() && !token.is_empty() {
        Ok(Token(token))
    } else {
        Err(format!(
            "no Things Worker token in the Keychain under {KEYCHAIN_SERVICE}"
        ))
    }
}

fn request_body(token: &Token, rows: &Value) -> Value {
    json!({
        "path": IMPORT_PATH,
        "args": { "token": token.0, "rows": rows },
        "format": "json",
    })
}

fn post(convex_url: &str, body: &Value) -> Result<String, String> {
    let output = run_with_stdin(
        Command::new("/usr/bin/curl").args([
            "--silent",
            "--show-error",
            "--connect-timeout",
            "10",
            "--max-time",
            "120",
            "--header",
            "Content-Type: application/json",
            "--header",
            "Expect:",
            "--data-binary",
            "@-",
            &format!("{convex_url}/api/action"),
        ]),
        &body.to_string(),
    )
    .map_err(|stderr| format!("could not reach Convex: {stderr}"))?;
    String::from_utf8(output).map_err(|error| error.to_string())
}

fn run_with_stdin(command: &mut Command, input: &str) -> Result<Vec<u8>, String> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let stdin = child.stdin.take();
    let (written, output) = thread::scope(|scope| {
        let writer = stdin.map(|mut stdin| scope.spawn(move || stdin.write_all(input.as_bytes())));
        let output = child.wait_with_output();
        (writer.map(thread::ScopedJoinHandle::join), output)
    });
    let Output {
        status,
        stdout,
        stderr,
    } = output.map_err(|error| error.to_string())?;
    if !status.success() {
        return Err(String::from_utf8_lossy(&stderr).trim().to_owned());
    }
    match written {
        Some(Ok(Err(error))) => Err(error.to_string()),
        Some(Err(_)) => Err("the stdin writer panicked".to_owned()),
        Some(Ok(Ok(()))) | None => Ok(stdout),
    }
}

fn outcome(text: &str, token: &Token) -> Outcome {
    match serde_json::from_str::<Reply>(text) {
        Ok(Reply::Success {
            value: Imported::Done { value },
        }) => Outcome::Imported(value),
        Ok(Reply::Success {
            value:
                Imported::Refused {
                    error: Refusal::Retired { retired_at },
                },
        }) => Outcome::Retired {
            retired_at_ms: retired_at,
        },
        Ok(Reply::Error { error_message }) => {
            Outcome::Failed(redact(first_line(&error_message), token))
        }
        Err(error) => Outcome::Failed(redact(
            &format!("Convex sent an unexpected reply ({error}): {text}"),
            token,
        )),
    }
}

fn first_line(message: &str) -> &str {
    message
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with("[Request ID:"))
        .unwrap_or("Convex did not say why")
}

fn redact(message: &str, token: &Token) -> String {
    message
        .replace(&token.0, "[token]")
        .chars()
        .take(MESSAGE_CHARS)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        io::{BufRead as _, BufReader, Read as _, Write as _},
        net::TcpListener,
        path::PathBuf,
        thread,
    };

    use serde_json::{Value, json};

    use super::{Outcome, Scratch, Token, find_database, outcome, post, read_rows, request_body};

    #[test]
    fn posts_the_request_to_the_action_endpoint_and_reads_the_reply() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a local port");
        let url = format!("http://{}", listener.local_addr().expect("an address"));
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("one request");
            let mut reader = BufReader::new(stream);
            let mut head = Vec::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).expect("a header line");
                if line.trim().is_empty() {
                    break;
                }
                head.push(line.trim().to_owned());
            }
            let length: usize = head
                .iter()
                .find_map(|line| {
                    line.to_lowercase()
                        .strip_prefix("content-length:")
                        .map(|n| n.trim().to_owned())
                })
                .expect("a content length")
                .parse()
                .expect("a number");
            let mut body = vec![0; length];
            reader.read_exact(&mut body).expect("the body");
            let reply = r#"{"status":"success","value":{"ok":true,"value":{"tasks":3}}}"#;
            write!(
                reader.get_mut(),
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}",
                reply.len()
            )
            .expect("the reply");
            (head[0].clone(), body)
        });
        let token = Token("secret".into());
        let sent = request_body(&token, &json!({ "items": [] }));
        let text = post(&url, &sent).expect("curl reaches the local server");
        let (request_line, body) = server.join().expect("the server thread");
        assert_eq!(request_line, "POST /api/action HTTP/1.1", "the endpoint");
        let received: Value = serde_json::from_slice(&body).expect("a JSON body");
        assert_eq!(received, sent, "the body arrives unchanged");
        assert_eq!(
            outcome(&text, &token),
            Outcome::Imported(json!({ "tasks": 3 })),
            "the reply"
        );
    }

    #[test]
    #[ignore = "reads the Things database on this Mac"]
    fn reads_a_copy_of_the_real_things_database() {
        let home = env::var_os("HOME").expect("HOME is set");
        let containers = PathBuf::from(home).join("Library/Group Containers");
        let database = find_database(&containers).expect("Things is installed");
        let rows = read_rows(&database).expect("sqlite3 reads the copy");
        for table in ["areas", "tags", "items", "checklistItems"] {
            let count = rows[table].as_array().map(Vec::len);
            println!("{table}: {count:?}");
            assert!(count.is_some(), "{table} is a list");
        }
    }

    #[test]
    fn finds_the_things_database_among_other_containers() {
        let root = Scratch::new("lifeos-things-test").expect("a temp dir");
        let database = root.0.join(
            "JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-0CZBJ/Things Database.thingsdatabase",
        );
        fs::create_dir_all(&database).expect("the fake database folder");
        fs::write(database.join("main.sqlite"), b"").expect("the fake database");
        fs::create_dir_all(root.0.join("group.com.apple.notes/ThingsData-X"))
            .expect("an unrelated container");
        assert_eq!(
            find_database(&root.0),
            Some(database),
            "the Things database folder"
        );
    }

    #[test]
    fn a_folder_without_main_sqlite_is_not_a_database() {
        let root = Scratch::new("lifeos-things-test").expect("a temp dir");
        fs::create_dir_all(
            root.0
                .join("X.com.culturedcode.ThingsMac/ThingsData-1/Things Database.thingsdatabase"),
        )
        .expect("an empty database folder");
        assert_eq!(find_database(&root.0), None, "no main.sqlite");
        assert_eq!(
            find_database(&root.0.join("missing")),
            None,
            "no Group Containers folder"
        );
    }

    #[test]
    fn the_request_names_the_action_and_carries_the_rows() {
        let rows = json!({ "areas": [], "items": [{ "uuid": "A1" }] });
        let body = request_body(&Token("secret".into()), &rows);
        assert_eq!(
            body,
            json!({
                "path": "planner/things:importRows",
                "args": { "token": "secret", "rows": rows },
                "format": "json",
            }),
            "the Convex action request"
        );
    }

    #[test]
    fn a_finished_import_gives_its_report() {
        let text = r#"{"status":"success","value":{"ok":true,"value":{"tasks":12}}}"#;
        assert_eq!(
            outcome(text, &Token("secret".into())),
            Outcome::Imported(json!({ "tasks": 12 })),
            "an import report"
        );
    }

    #[test]
    fn a_retired_import_says_when() {
        let text = r#"{"status":"success","value":{"ok":false,"error":{"kind":"retired","retiredAt":1763460000000}}}"#;
        assert_eq!(
            outcome(text, &Token("secret".into())),
            Outcome::Retired {
                retired_at_ms: 1_763_460_000_000.0
            },
            "a retired import"
        );
    }

    #[test]
    fn a_convex_error_reads_plainly_without_the_token() {
        let text = r#"{"status":"error","errorMessage":"[Request ID: 4b95] Server Error\nArgumentValidationError: Object {token: \"hunter2\"} is wrong\n\nObject: {token: \"hunter2\"}"}"#;
        assert_eq!(
            outcome(text, &Token("hunter2".into())),
            Outcome::Failed(
                r#"ArgumentValidationError: Object {token: "[token]"} is wrong"#.into()
            ),
            "the first line, redacted"
        );
    }

    #[test]
    fn an_unknown_reply_fails() {
        let Outcome::Failed(reason) = outcome("<html>502</html>", &Token("secret".into())) else {
            panic!("an HTML page is not a reply");
        };
        assert!(
            reason.contains("<html>502</html>"),
            "names the reply: {reason}"
        );
    }
}
