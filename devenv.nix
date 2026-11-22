{ pkgs, inputs, ... }:

let
  rustBin = inputs.rust-overlay.lib.mkRustBin { } pkgs.buildPackages;
  rustToolchain = rustBin.stable."1.95.0".minimal.override {
    extensions = [ "clippy" "rustfmt" "rust-analyzer" "rust-src" ];
  };
in
{
  stdenv = pkgs.stdenvNoCC;
  apple.sdk = null;
  languages.c.enable = false;

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    lsp.enable = false;
    pnpm = {
      enable = true;
      package = pkgs.pnpm_10;
    };
  };

  languages.rust = {
    enable = true;
    lsp.enable = false;
    toolchainPackage = pkgs.symlinkJoin {
      name = "rust-${rustToolchain.version}-system-linker";
      paths = [ rustToolchain ];
      postBuild = "rm -r $out/nix-support";
    };
  };

  packages = [
    pkgs.cocoapods
    pkgs.uv
    pkgs.gh
    pkgs.jq
  ];

  env = {
    LANG = "en_US.UTF-8";
    LC_ALL = "en_US.UTF-8";
  };

  enterShell = ''
    unset MACOSX_DEPLOYMENT_TARGET
    case "''${DEVELOPER_DIR-}" in /nix/store/*) unset DEVELOPER_DIR ;; esac
    case "''${SDKROOT-}" in /nix/store/*) unset SDKROOT ;; esac
  '';

  scripts.doctor.exec = ''
    for tool in node pnpm cargo rustc cc xcodebuild xcrun pod uv gh git; do
      printf '%-10s %s\n' "$tool" "$(command -v "$tool" || echo MISSING)"
    done
    node --version
    want="$(jq -r '.packageManager' "$DEVENV_ROOT/package.json")"
    have="pnpm@$(cd "$DEVENV_ROOT" && pnpm --version)"
    echo "packageManager $want, running $have"
    [ "$want" = "$have" ] || echo "WARNING: pnpm is not the packageManager version"
    rustc --version
    pod --version
    xcodebuild -version
    echo "xcode-select -p: $(xcode-select -p)"
    env | grep -E '^(CC|CXX|LD|AR|NM|SDKROOT|DEVELOPER_DIR|MACOSX_DEPLOYMENT_TARGET|NIX_CC|NIX_LDFLAGS|CI)=' || echo "no Nix compiler or SDK variables set"
  '';

  processes = {
    web.exec = ''exec pnpm --filter @lifeos/web dev --port "''${LIFEOS_WEB_PORT:-3000}"'';

    metro = {
      exec = ''exec pnpm --filter @lifeos/mobile start --dev-client --port "''${LIFEOS_METRO_PORT:-8081}"'';
      start.enable = false;
    };

    convex = {
      exec = "exec pnpm --filter @lifeos/backend dev";
      start.enable = false;
    };
  };
}
