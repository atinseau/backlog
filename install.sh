#!/usr/bin/env bash
# Install the backlog binary from the latest GitHub Release.
#
#   curl -fsSL https://raw.githubusercontent.com/atinseau/backlog/main/install.sh | bash
#
# Environment:
#   BACKLOG_REPO     owner/name to install from   (default: atinseau/backlog)
#   BACKLOG_VERSION  tag to install, e.g. v1.2.3  (default: latest release)
#   BACKLOG_BIN_DIR  install directory            (default: first writable of
#                    /usr/local/bin, ~/.local/bin)
set -euo pipefail

REPO="${BACKLOG_REPO:-atinseau/backlog}"
VERSION="${BACKLOG_VERSION:-}"

info() { printf '\033[1;34m→\033[0m %s\n' "$1"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required."

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux)  os="linux" ;;
  *)      die "Unsupported OS: $(uname -s). Build from source with 'bun run build'." ;;
esac

case "$(uname -m)" in
  x86_64|amd64)  arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *)             die "Unsupported architecture: $(uname -m)." ;;
esac

asset="backlog-${os}-${arch}"

if [[ -z "$VERSION" ]]; then
  info "Resolving latest release of ${REPO}…"
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep -m1 '"tag_name"' \
    | sed -E 's/.*"tag_name" *: *"([^"]+)".*/\1/')
  [[ -n "$VERSION" ]] || die "Could not determine the latest release. Set BACKLOG_VERSION explicitly."
fi

# Pick an install directory: prefer a system-wide one already on PATH, fall
# back to the per-user location.
if [[ -n "${BACKLOG_BIN_DIR:-}" ]]; then
  bin_dir="$BACKLOG_BIN_DIR"
elif [[ -w /usr/local/bin ]]; then
  bin_dir="/usr/local/bin"
else
  bin_dir="$HOME/.local/bin"
fi
mkdir -p "$bin_dir"

url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

info "Downloading ${asset} (${VERSION})…"
curl -fSL --progress-bar "$url" -o "$tmp/backlog" \
  || die "Download failed: $url"

# Verify against the release checksums when they're published.
if curl -fsSL "https://github.com/${REPO}/releases/download/${VERSION}/SHA256SUMS" -o "$tmp/SHA256SUMS" 2>/dev/null; then
  expected=$(grep " ${asset}\$" "$tmp/SHA256SUMS" | awk '{print $1}' || true)
  if [[ -n "$expected" ]]; then
    if command -v sha256sum >/dev/null 2>&1; then
      actual=$(sha256sum "$tmp/backlog" | awk '{print $1}')
    else
      actual=$(shasum -a 256 "$tmp/backlog" | awk '{print $1}')
    fi
    [[ "$actual" == "$expected" ]] || die "Checksum mismatch for ${asset}."
    info "Checksum verified."
  fi
fi

chmod +x "$tmp/backlog"
mv "$tmp/backlog" "$bin_dir/backlog"

info "Installed backlog ${VERSION} → ${bin_dir}/backlog"

case ":${PATH}:" in
  *":${bin_dir}:"*) "$bin_dir/backlog" --version ;;
  *)
    printf '\n\033[1;33m!\033[0m %s is not on your PATH. Add it:\n' "$bin_dir"
    printf '    export PATH="%s:$PATH"\n' "$bin_dir"
    ;;
esac
