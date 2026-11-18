use std::{env, fs, path::PathBuf};

const URL_VAR: &str = "LIFEOS_CONVEX_URL";
const WEB_VAR: &str = "WAKU_PUBLIC_CONVEX_URL";

fn main() {
    let web_env =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR"))
            .join("../../web/.env.local");
    println!("cargo:rerun-if-env-changed={URL_VAR}");
    println!("cargo:rerun-if-changed={}", web_env.display());
    let url = env::var(URL_VAR)
        .ok()
        .filter(|url| !url.is_empty())
        .or_else(|| {
            fs::read_to_string(&web_env)
                .ok()
                .as_deref()
                .and_then(web_url)
        })
        .unwrap_or_else(|| {
            panic!(
                "No Convex URL to build in. Set {URL_VAR}, or {WEB_VAR} in {}.",
                web_env.display()
            )
        });
    println!("cargo:rustc-env={URL_VAR}={url}");
    tauri_build::build();
}

fn web_url(text: &str) -> Option<String> {
    text.lines()
        .find_map(|line| {
            line.trim()
                .strip_prefix(WEB_VAR)?
                .trim_start()
                .strip_prefix('=')
        })
        .map(|value| value.trim().trim_matches('"').to_owned())
        .filter(|value| !value.is_empty())
}
