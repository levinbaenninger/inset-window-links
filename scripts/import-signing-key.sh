#!/usr/bin/env bash
# Imports the shared signing certificate into a throwaway keychain and points sign-mac.mjs at it.
# Reads MAC_SIGNING_P12_BASE64 and MAC_SIGNING_P12_PASSWORD; writes INSET_SIGNING_KEYCHAIN to $GITHUB_ENV.
set -euo pipefail

: "${MAC_SIGNING_P12_BASE64:?MAC_SIGNING_P12_BASE64 is not set, so release builds would be signed ad hoc and could not update signed installs}"
: "${MAC_SIGNING_P12_PASSWORD:?MAC_SIGNING_P12_PASSWORD is not set}"

dir="${RUNNER_TEMP:-$(mktemp -d)}"
keychain="$dir/inset-signing.keychain-db"
p12="$dir/inset-signing.p12"
password="$(openssl rand -hex 24)"

printf '%s' "$MAC_SIGNING_P12_BASE64" | base64 --decode >"$p12"
trap 'rm -f "$p12"' EXIT

security create-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$password" "$keychain"
security import "$p12" -k "$keychain" -P "$MAC_SIGNING_P12_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
# codesign finds identities only in keychains on the search list, even when given --keychain.
# shellcheck disable=SC2046
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')

echo "INSET_SIGNING_KEYCHAIN=$keychain" >>"${GITHUB_ENV:-/dev/stdout}"
