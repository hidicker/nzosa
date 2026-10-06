#!/usr/bin/env bash
# Upload the built app and the online demo to the hosting's Web Disk, then
# check the site serves what was built.
#
# For the "Deploy website" GitHub Action; runs on any machine with bash and
# curl. The logins come from the environment -- WEBDISK_APP_USER,
# WEBDISK_DEMO_USER and WEBDISK_PASSWORD -- and are never printed, and never
# written in this public repository. TARGET is "app", "demo" or "both".
#
# The app and the demo are separate Web Disk accounts, each rooted at its own
# folder, so a path here is relative to that folder.
set -euo pipefail

BASE="${WEBDISK_BASE:-https://nbparagliding.nz:2078}"
TARGET="${TARGET:-both}"
: "${WEBDISK_PASSWORD:?WEBDISK_PASSWORD is not set}"

send_folder() {
  local user="$1" folder="$2" site="$3"
  [ -d "$folder" ] || { echo "Nothing built at $folder" >&2; exit 1; }
  # A test build's output must never reach the site.
  rm -rf "$folder/_irdtest"

  # Folders first, so each file has somewhere to go. A folder already there
  # answers with an error, which is fine.
  while IFS= read -r dir; do
    curl -sS -o /dev/null -X MKCOL -u "$user:$WEBDISK_PASSWORD" "$BASE/${dir#"$folder"/}" || true
  done < <(find "$folder" -mindepth 1 -type d | sort)

  local count=0
  while IFS= read -r file; do
    curl -sS --fail --retry 4 --retry-delay 3 --retry-all-errors -o /dev/null \
      -u "$user:$WEBDISK_PASSWORD" -T "$file" "$BASE/${file#"$folder"/}"
    count=$((count + 1))
  done < <(find "$folder" -type f | sort)
  echo "$site: uploaded $count files"

  # What the site now serves, against what was built. Asked with a throwaway
  # query so no cache answers for it.
  local bad=0
  for name in app.js styles.css index.html; do
    local built served
    built=$(sha256sum "$folder/$name" | cut -d' ' -f1)
    served=$(curl -sS --fail -H 'Cache-Control: no-cache' "$site/$name?v=$RANDOM$RANDOM" | sha256sum | cut -d' ' -f1)
    if [ "$built" = "$served" ]; then
      echo "  $name matches"
    else
      echo "  $name DIFFERS" >&2
      bad=1
    fi
  done
  return $bad
}

if [ "$TARGET" = "app" ] || [ "$TARGET" = "both" ]; then
  send_folder "${WEBDISK_APP_USER:?WEBDISK_APP_USER is not set}" "apps/web/dist" "https://nbparagliding.nz/nzosa"
fi
if [ "$TARGET" = "demo" ] || [ "$TARGET" = "both" ]; then
  send_folder "${WEBDISK_DEMO_USER:?WEBDISK_DEMO_USER is not set}" "online-demo" "https://nbparagliding.nz/nzosa_demo"
fi
