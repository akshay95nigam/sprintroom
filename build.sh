#!/bin/sh
# Builds dist/SprintRoom-Windows.zip: SprintRoom.exe (a Node.js single executable) + README.txt.
#
# Uses official Node.js builds from nodejs.org, verified against their SHA-256 list:
#   - the Windows node.exe that becomes SprintRoom.exe
#   - a Node for this machine to run `--build-sea` (some package-manager builds, such as
#     Homebrew's, ship with single-executable support turned off)
# Both are cached in .cache/. Set NODE_VERSION to build against a different release.
set -e
cd "$(dirname "$0")"
V="v${NODE_VERSION:-26.9.0}"
C=".cache"
mkdir -p "$C"

fetch() { # fetch <path under /dist/$V/> <local file>
  [ -f "$2" ] && return
  [ -f "$C/SHASUMS256-$V.txt" ] || curl -fsSL "https://nodejs.org/dist/$V/SHASUMS256.txt" -o "$C/SHASUMS256-$V.txt"
  curl -fsSL "https://nodejs.org/dist/$V/$1" -o "$2.part"
  want=$(grep " $1\$" "$C/SHASUMS256-$V.txt" | cut -d' ' -f1)
  got=$(shasum -a 256 "$2.part" | cut -d' ' -f1)
  [ -n "$want" ] && [ "$want" = "$got" ] || { echo "Checksum mismatch for $1"; rm -f "$2.part"; exit 1; }
  mv "$2.part" "$2"
}

# Windows runtime that the app is injected into
fetch "win-x64/node.exe" "$C/node-$V-win-x64.exe"
cp "$C/node-$V-win-x64.exe" "$C/node.exe"

# Builder Node for this machine
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) HOST=darwin-arm64 ;; Darwin-x86_64) HOST=darwin-x64 ;;
  Linux-x86_64) HOST=linux-x64 ;; Linux-aarch64) HOST=linux-arm64 ;;
  *) echo "Unsupported build machine: $(uname -sm)"; exit 1 ;;
esac
T="node-$V-$HOST.tar.gz"
fetch "$T" "$C/$T"
[ -x "$C/node-$V-$HOST/bin/node" ] || tar xzf "$C/$T" -C "$C"
NODE="$C/node-$V-$HOST/bin/node"

rm -rf dist && mkdir -p dist/SprintRoom
"$NODE" --build-sea sea-config.json
cp README.txt dist/SprintRoom/README.txt
sed -i.bak 's/$/\r/' dist/SprintRoom/README.txt && rm dist/SprintRoom/README.txt.bak
(cd dist && zip -qr SprintRoom-Windows.zip SprintRoom)
ls -lh dist/SprintRoom/SprintRoom.exe dist/SprintRoom-Windows.zip
