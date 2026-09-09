@echo off
rem  Double-click this file to stop NZOSA.
rem
rem  NZOSA runs in the background with no window, so this is how it is stopped.
rem  Closing the browser tab does not stop it; the app is still there when you
rem  open http://127.0.0.1:3210 again.

setlocal
title Stop NZOSA

rem  Found by the port it serves rather than by a saved process id: a stale id
rem  file after a crash would point at nothing, or worse at something else that
rem  has since been given the same number.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$c=Get-NetTCPConnection -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue; if($c){ $c | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; Write-Host 'NZOSA stopped.' } else { Write-Host 'NZOSA was not running.' }"

echo.
rem  Not `timeout`, which is a different program on a PATH that has a Unix
rem  one earlier. PowerShell is already required above.
powershell -NoProfile -Command "Start-Sleep -Seconds 3"
endlocal
