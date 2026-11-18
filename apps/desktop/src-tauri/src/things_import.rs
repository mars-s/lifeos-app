//! Imports Things 3 into `LifeOS` in the background while the Mac app is open.

use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Deserialize;
use serde_json::{Value, json};

use crate::convex::{self, CONVEX_URL, Function, Token};

const IMPORT_PATH: &str = "planner/things:importRows";
const THINGS_SQL: &str = include_str!("../../../things-sync/things.sql");
const DATABASE_FILES: [&str; 3] = ["main.sqlite", "main.sqlite-wal", "main.sqlite-shm"];
/// Gives the window time to draw before the first import competes for the disk.
const FIRST_RUN_AFTER: Duration = Duration::from_secs(10);
const RUN_EVERY: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone, PartialEq)]
enum Outcome {
    Imported(Value),
    Retired { retired_at_ms: f64 },
    Failed(String),
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
    let token = convex::read_token()?;
    let rows = read_rows(database)?;
    let text = convex::post(CONVEX_URL, Function::Action, &request_body(&token, &rows))?;
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
    let output = convex::run_with_stdin(
        Command::new("/usr/bin/sqlite3")
            .arg("-readonly")
            .arg(scratch.0.join(DATABASE_FILES[0])),
        THINGS_SQL,
    )
    .map_err(|stderr| format!("sqlite3 failed: {stderr}"))?;
    serde_json::from_slice(&output).map_err(|error| format!("sqlite3 printed no JSON: {error}"))
}

fn request_body(token: &Token, rows: &Value) -> Value {
    json!({
        "path": IMPORT_PATH,
        "args": { "token": token.secret(), "rows": rows },
        "format": "json",
    })
}

fn outcome(text: &str, token: &Token) -> Outcome {
    match convex::reply::<Imported>(text, token) {
        Ok(Imported::Done { value }) => Outcome::Imported(value),
        Ok(Imported::Refused {
            error: Refusal::Retired { retired_at },
        }) => Outcome::Retired {
            retired_at_ms: retired_at,
        },
        Err(reason) => Outcome::Failed(reason),
    }
}

#[cfg(test)]
mod tests {
    use std::{env, fs, path::PathBuf};

    use serde_json::{Value, json};

    use super::{Outcome, Scratch, find_database, outcome, read_rows, request_body};
    use crate::convex::{self, Function, Token, tests::one_request_server};

    #[test]
    fn posts_the_request_to_the_action_endpoint_and_reads_the_reply() {
        let (url, server) =
            one_request_server(r#"{"status":"success","value":{"ok":true,"value":{"tasks":3}}}"#);
        let token = Token::new("secret".into());
        let sent = request_body(&token, &json!({ "items": [] }));
        let text =
            convex::post(&url, Function::Action, &sent).expect("curl reaches the local server");
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
        let body = request_body(&Token::new("secret".into()), &rows);
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
            outcome(text, &Token::new("secret".into())),
            Outcome::Imported(json!({ "tasks": 12 })),
            "an import report"
        );
    }

    #[test]
    fn a_retired_import_says_when() {
        let text = r#"{"status":"success","value":{"ok":false,"error":{"kind":"retired","retiredAt":1763460000000}}}"#;
        assert_eq!(
            outcome(text, &Token::new("secret".into())),
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
            outcome(text, &Token::new("hunter2".into())),
            Outcome::Failed(
                r#"ArgumentValidationError: Object {token: "[token]"} is wrong"#.into()
            ),
            "the first line, redacted"
        );
    }

    #[test]
    fn an_unknown_reply_fails() {
        let Outcome::Failed(reason) = outcome("<html>502</html>", &Token::new("secret".into()))
        else {
            panic!("an HTML page is not a reply");
        };
        assert!(
            reason.contains("<html>502</html>"),
            "names the reply: {reason}"
        );
    }
}
