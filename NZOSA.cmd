@echo off
rem  Double-click this file to start NZOSA.
rem
rem  It installs what is needed the first time, builds the app, starts it in the
rem  background, opens your browser, and closes this window.
rem
rem  The app keeps running after this window closes. To stop it, double-click
rem  "Stop NZOSA.cmd" beside this file.
rem
rem  Nothing here uploads anything. The app runs on your own machine.
rem
rem  Do not rename this to something beginning with the word "Start": cmd reads
rem  `Start NZOSA.cmd` as the START builtin plus a filename, and launches it
rem  in a detached window instead of running it here.

setlocal
cd /d "%~dp0"
title NZOSA

where node >nul 2>nul
if errorlevel 1 goto :noNode

rem  Already running? Then there is nothing to start: open the browser at it and
rem  stop. Without this a second double-click tried to start a second server,
rem  which did nothing useful -- it could not even write its log, because the
rem  first one still had the file open -- and the browser never reopened.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:3210/' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } } catch {}; exit 1"
if not errorlevel 1 (
  echo NZOSA is already running. Opening it.
  start "" "http://127.0.0.1:3210/"
  goto :end
)

if not exist "node_modules\" (
  echo First run: installing what NZOSA needs.
  echo This takes a minute or two, and only happens once.
  echo.
  call npm install --no-fund --no-audit
  if errorlevel 1 goto :failed
  echo.
)

rem  Always build. Skipping it when dist already existed meant an update was
rem  never compiled: `npm run dev` rebuilds the web bundle but not packages/core.
rem  With nothing to do this takes about a second.
echo Building the app...
call npm run build
if errorlevel 1 goto :failed
echo.

echo Starting NZOSA...

rem  Start the server as its own process with no window of its own, so this
rem  window can close without taking the app down with it. Start-Process is
rem  used rather than `start /b`, which leaves the child attached to this
rem  console and kills it on exit.
rem
rem  Output goes to a log beside the app: with no window there is nowhere else
rem  for it to go, and something has to say what happened when it will not start.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c npm run dev --workspace @nzosa/web -- --open > \"%~dp0nzosa-log.txt\" 2>&1' -WindowStyle Hidden -WorkingDirectory '%~dp0'"

rem  Wait for it to answer before closing this window. If it never does, the
rem  window stays open and says so -- closing on a failure would leave nothing
rem  at all to look at.
echo Waiting for it to be ready...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$log='%~dp0nzosa-log.txt'; $deadline=(Get-Date).AddSeconds(40); while((Get-Date) -lt $deadline){ try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:3210/' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } } catch {} if(Test-Path $log){ $t=Get-Content $log -Raw -ErrorAction SilentlyContinue; if($t -match 'already open in another NZOSA|EADDRINUSE|^Error:|Cannot find module'){ exit 2 } } Start-Sleep -Milliseconds 500 }; exit 1"
if errorlevel 2 goto :saidWhy
if errorlevel 1 goto :noStart

rem  Running, browser opening. Nothing left for this window to do.
goto :end

rem  It said why. Show that rather than guessing at a cause, and say the one
rem  thing a person can do about the commonest of them.
:saidWhy
echo.
echo NZOSA could not start. It said:
echo.
type "%~dp0nzosa-log.txt" 2>nul
echo.
echo If it says the books are already open, close the other NZOSA window
echo and run this again.
echo.
pause
exit /b 1

:noStart
echo.
echo NZOSA did not start. What it printed is in nzosa-log.txt beside this file.
echo.
echo Nothing is listening on port 3210, and it printed nothing to explain it.
echo.
type "%~dp0nzosa-log.txt" 2>nul
echo.
pause
exit /b 1

:noNode
echo.
echo NZOSA needs Node.js, and it is not installed on this computer.
echo.
echo   1. Go to  https://nodejs.org
echo   2. Download the version marked LTS
echo   3. Install it, accepting the defaults
echo   4. Run this file again
echo.
pause
exit /b 1

:failed
echo.
echo Something went wrong. The messages above say what.
echo.
echo If it mentions the network, check your connection and try again.
echo Otherwise, send those messages to whoever set this up for you.
echo.
pause
exit /b 1

:end
endlocal
