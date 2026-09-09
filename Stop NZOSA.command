#!/bin/sh
#  Run this to stop NZOSA.
#
#  NZOSA keeps running in the background after its window closes. Closing the
#  browser tab does not stop it; the app is still there when you open
#  http://127.0.0.1:3210 again.

# Found by the port it serves rather than by a saved process id: a stale id
# after a crash would point at nothing, or at whatever has since been given
# that number.
pids=$(lsof -ti tcp:3210 -sTCP:LISTEN 2>/dev/null)

if [ -z "$pids" ]; then
  echo "NZOSA was not running."
else
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null
  sleep 1
  still=$(lsof -ti tcp:3210 -sTCP:LISTEN 2>/dev/null)
  # shellcheck disable=SC2086
  [ -n "$still" ] && kill -9 $still 2>/dev/null
  echo "NZOSA stopped."
fi

sleep 2
