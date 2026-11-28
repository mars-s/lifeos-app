use std::{env, fs, path::PathBuf, process::Command};

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
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_widget_bridge();
    }
    tauri_build::build();
}

fn build_widget_bridge() {
    let manifest =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR"));
    let kit = manifest.join("../../../packages/widget-kit/Sources/LifeOSWidgetKit");
    let sources = [
        manifest.join("../widgets/Bridge/Bridge.swift"),
        kit.join("Snapshot.swift"),
        kit.join("Store.swift"),
    ];
    for source in &sources {
        println!("cargo:rerun-if-changed={}", source.display());
    }
    let out = PathBuf::from(env::var("OUT_DIR").expect("cargo sets OUT_DIR"));
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("x86_64") => "x86_64",
        _ => "arm64",
    };
    let status = Command::new("xcrun")
        .args([
            "swiftc",
            "-parse-as-library",
            "-emit-library",
            "-static",
            "-O",
        ])
        .args(["-module-name", "LifeOSWidgetBridge", "-target"])
        .arg(format!("{arch}-apple-macos14.0"))
        .args(&sources)
        .arg("-o")
        .arg(out.join("libLifeOSWidgetBridge.a"))
        .status()
        .expect("xcrun swiftc runs");
    assert!(status.success(), "swiftc could not build the widget bridge");
    let toolchain = Command::new("xcode-select")
        .arg("-p")
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .expect("xcode-select finds Xcode");
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=LifeOSWidgetBridge");
    println!("cargo:rustc-link-lib=framework=WidgetKit");
    println!("cargo:rustc-link-search=native=/usr/lib/swift");
    println!(
        "cargo:rustc-link-search=native={toolchain}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx"
    );
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
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
