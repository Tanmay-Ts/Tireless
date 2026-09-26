#!/usr/bin/env bash
# Assemble the submission bundle into qa/recordings/ and rebuild the portal video + report.
# Usage: FFMPEG=/path/to/ffmpeg bash package.sh
set -euo pipefail
cd "$(dirname "$0")"
FFMPEG="${FFMPEG:-ffmpeg}"

# 1. every recorded run -> mp4, plus the combined portal + all-runs cuts
npx tsx video.ts                      # all of out/videos in ranked order

# 2. refresh the report from the latest findings + matrix
npx tsx report.ts

# 3. copy everything into the committed backup
R=recordings
mkdir -p $R/videos $R/mp4 $R/findings $R/shots
cp -f out/videos/*.webm            $R/videos/
cp -f out/mp4/*.mp4                 $R/mp4/
cp -f out/findings/*.json          $R/findings/
cp -f out/shots/*-verdict.png      $R/shots/ 2>/dev/null || true
cp -f out/mutants.json             $R/
cp -f out/level1-all-scenarios.mp4 $R/ 2>/dev/null || true
cp -f out/level1-all-runs.mp4      $R/ 2>/dev/null || true
cp -f out/report.md                $R/report-cloud.md

echo "packaged -> $R"
ls -la $R/*.mp4
