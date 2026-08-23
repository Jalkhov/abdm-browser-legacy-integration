#!/bin/bash
# Build script for AB Download Manager Legacy XPI
# Usage: ./build.sh [additional args passed to build_xpi.py]

# Call the Python packager; ensure output directory is the repo root (current dir)
if [ $# -eq 0 ]; then
    python3 tools/build_xpi.py --src src --out .
else
    python3 tools/build_xpi.py --src src --out . "$@"
fi

if [ $? -ne 0 ]; then
    echo
    echo "Build failed with exit code $?."
    exit $?
fi

echo
echo "Build succeeded."
exit 0
