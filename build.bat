@echo off
rem Build script for AB Download Manager Legacy XPI
rem Usage: build.bat [additional args passed to build_xpi.py]

setlocal

rem Call the Python packager; ensure output directory is the repo root (current dir)
if "%~1"=="" (
    python tools\build_xpi.py --src src --out .
) else (
    python tools\build_xpi.py --src src --out . %*
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Build failed with exit code %ERRORLEVEL%.
    endlocal
    exit /b %ERRORLEVEL%
)

echo.
echo Build succeeded.
endlocal
exit /b 0
