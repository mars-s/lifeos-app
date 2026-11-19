//! Calls `LifeOS` functions on Convex as the Mac Worker, with its token from the Keychain.

use std::{
    env, fmt,
    io::Write as _,
    process::{Command, Output, Stdio},
    thread,
};

use serde::{Deserialize, de::DeserializeOwned};
use serde_json::Value;

pub(crate) const CONVEX_URL: &str = env!("LIFEOS_CONVEX_URL");
const KEYCHAIN_SERVICE: &str = "lifeos-app-things-sync";
const TOKEN_VAR: &str = "LIFEOS_THINGS_SYNC_TOKEN";
const MESSAGE_CHARS: usize = 300;

/// The Mac Worker token, kept out of every log line.
pub(crate) struct Token(String);

impl Token {
    pub(crate) fn new(secret: String) -> Self {
        Self(secret)
    }

    pub(crate) fn secret(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Token {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Token([redacted])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Function {
    Action,
    Mutation,
}

impl Function {
    fn endpoint(self) -> &'static str {
        match self {
            Self::Action => "action",
            Self::Mutation => "mutation",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum Reply<T> {
    Success {
        value: T,
    },
    Error {
        #[serde(rename = "errorMessage")]
        error_message: String,
    },
}

pub(crate) fn read_token() -> Result<Token, String> {
    if let Some(token) = token_from_env() {
        return Ok(Token::new(token));
    }
    let output = find_token(&["-w"])?;
    let token = String::from_utf8(output.stdout)
        .map(|text| text.trim().to_owned())
        .unwrap_or_default();
    if output.status.success() && !token.is_empty() {
        Ok(Token::new(token))
    } else {
        Err(format!(
            "no Worker token in the Keychain under {KEYCHAIN_SERVICE}"
        ))
    }
}

/// Whether this Mac holds a Worker token at all. It reads no secret, so macOS never prompts.
pub(crate) fn token_stored() -> bool {
    token_from_env().is_some() || find_token(&[]).is_ok_and(|output| output.status.success())
}

fn token_from_env() -> Option<String> {
    env::var(TOKEN_VAR).ok().filter(|token| !token.is_empty())
}

fn find_token(extra: &[&str]) -> Result<Output, String> {
    let account = env::var("USER").map_err(|_| "USER is not set".to_owned())?;
    Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a"])
        .arg(&account)
        .args(extra)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|error| format!("could not run security: {error}"))
}

/// Sends one function call and returns its value, or why it failed, with the token redacted.
pub(crate) fn call<T: DeserializeOwned>(
    convex_url: &str,
    function: Function,
    body: &Value,
    token: &Token,
) -> Result<T, String> {
    let text = post(convex_url, function, body).map_err(|reason| redact(&reason, token))?;
    reply(&text, token)
}

pub(crate) fn post(convex_url: &str, function: Function, body: &Value) -> Result<String, String> {
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
            &format!("{convex_url}/api/{}", function.endpoint()),
        ]),
        &body.to_string(),
    )
    .map_err(|stderr| format!("could not reach Convex: {stderr}"))?;
    String::from_utf8(output).map_err(|error| error.to_string())
}

pub(crate) fn reply<T: DeserializeOwned>(text: &str, token: &Token) -> Result<T, String> {
    match serde_json::from_str::<Reply<T>>(text) {
        Ok(Reply::Success { value }) => Ok(value),
        Ok(Reply::Error { error_message }) => Err(redact(first_line(&error_message), token)),
        Err(error) => Err(redact(
            &format!("Convex sent an unexpected reply ({error}): {text}"),
            token,
        )),
    }
}

pub(crate) fn run_with_stdin(command: &mut Command, input: &str) -> Result<Vec<u8>, String> {
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
pub(crate) mod tests {
    use std::{
        io::{BufRead as _, BufReader, Read as _, Write as _},
        net::TcpListener,
        thread::{self, JoinHandle},
    };

    use serde_json::{Value, json};

    use super::{Function, Token, call, reply};

    /// Serves one request on a local port with `reply`, and hands back its request line and body.
    pub(crate) fn one_request_server(
        reply: &'static str,
    ) -> (String, JoinHandle<(String, Vec<u8>)>) {
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
            write!(
                reader.get_mut(),
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}",
                reply.len()
            )
            .expect("the reply");
            (head[0].clone(), body)
        });
        (url, server)
    }

    #[test]
    fn a_mutation_goes_to_the_mutation_endpoint_and_its_value_comes_back() {
        let (url, server) =
            one_request_server(r#"{"status":"success","value":{"ok":true,"value":{"n":3}}}"#);
        let token = Token::new("secret".into());
        let sent = json!({ "path": "calendar/sync:applyWindow", "args": { "token": "secret" } });
        let value: Value =
            call(&url, Function::Mutation, &sent, &token).expect("curl reaches the local server");
        let (request_line, body) = server.join().expect("the server thread");
        assert_eq!(request_line, "POST /api/mutation HTTP/1.1", "the endpoint");
        let received: Value = serde_json::from_slice(&body).expect("a JSON body");
        assert_eq!(received, sent, "the body arrives unchanged");
        assert_eq!(
            value,
            json!({ "ok": true, "value": { "n": 3 } }),
            "the value"
        );
    }

    #[test]
    fn a_convex_error_reads_plainly_without_the_token() {
        let text = r#"{"status":"error","errorMessage":"[Request ID: 4b95] Server Error\nArgumentValidationError: Object {token: \"hunter2\"} is wrong\n\nObject: {token: \"hunter2\"}"}"#;
        assert_eq!(
            reply::<Value>(text, &Token::new("hunter2".into())),
            Err(r#"ArgumentValidationError: Object {token: "[token]"} is wrong"#.into()),
            "the first line, redacted"
        );
    }

    #[test]
    fn an_unknown_reply_fails_and_names_it() {
        let Err(reason) = reply::<Value>("<html>502</html>", &Token::new("secret".into())) else {
            panic!("an HTML page is not a reply");
        };
        assert!(
            reason.contains("<html>502</html>"),
            "names the reply: {reason}"
        );
    }

    #[test]
    fn the_token_never_prints() {
        assert_eq!(
            format!("{:?}", Token::new("hunter2".into())),
            "Token([redacted])",
            "the Debug form"
        );
    }
}
