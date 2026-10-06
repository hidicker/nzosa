#!/bin/sh
#  Double-click this file to start NZOSA (macOS), or run it on Linux.
#
#  It installs what is needed the first time, builds the app, starts it, and
#  opens your browser. After the first run it takes a couple of seconds.
#
#  Nothing here uploads anything. The app runs on your own machine.

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  cat <<'MESSAGE'

NZOSA needs Node.js, and it is not installed on this computer.

  1. Go to  https://nodejs.org
  2. Download the version marked LTS
  3. Install it, accepting the defaults
  4. Run this file again

MESSAGE
  read -r _ 2>/dev/null
  exit 1
fi

fail() {
  cat <<'MESSAGE'

Something went wrong. The messages above say what.

If it mentions the network, check your connection and try again.
Otherwise, send those messages to whoever set this up for you.

MESSAGE
  read -r _ 2>/dev/null
  exit 1
}

if [ ! -d node_modules ]; then
  echo "First run: installing what NZOSA needs."
  echo "This takes a minute or two, and only happens once."
  echo
  npm install --no-fund --no-audit || fail
  echo
fi

# Always build. Skipping it when dist already existed meant an update was never
# compiled: `npm run dev` rebuilds the web bundle but not packages/core. With
# nothing to do this takes about a second.
echo "Building the app..."
npm run build || fail
echo

echo "Starting NZOSA..."

# Detached, with its own output going to a log, so this window can close
# without taking the app down with it. nohup and the disown-by-exiting are what
# survive the terminal closing.
nohup npm run dev --workspace @nzosa/web -- --open > nzosa-log.txt 2>&1 &

# Wait for it to answer before letting the window go. If it never does, say so
# rather than closing on a failure and leaving nothing to look at.
ready=""
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null --max-time 2 http://127.0.0.1:3210/ 2>/dev/null; then
    ready="yes"
    break
  fi
  sleep 1
done

if [ -z "$ready" ]; then
  echo
  echo "NZOSA did not start. What it printed is in nzosa-log.txt beside this file."
  echo "The usual cause is another program already using port 3210."
  echo
  cat nzosa-log.txt 2>/dev/null
  echo
  read -r _ 2>/dev/null
  exit 1
fi

echo "NZOSA is running. To stop it, run \"Stop NZOSA.command\" beside this file."
# macOS closes the window on exit when Terminal is set to; otherwise it says
# the process completed and can be closed.
exit 0
