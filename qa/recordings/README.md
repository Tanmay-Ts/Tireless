# Cloud recordings (backup)

Recorded on 2026-09-26 in the Claude Code cloud container against the unmodified kit
(npm mode, cockpit on :5173), headed Chromium under Xvfb, real time (nothing sped up).
Two cosmetic differences from a laptop run: the map has no tiles (no internet map
access in the container, so the globe is plain blue), and the video tile says "off"
(no MediaMTX service). No check depends on either.

| Folder / file | What |
|---|---|
| `videos/*.webm` | Original Playwright recordings (1440×900, 25 fps) |
| `mp4/*.mp4` | Same recordings as H.264 mp4, ready to upload |
| `level1-all-scenarios.mp4` | Portal cut, 7:20: S1–S4, P1, S1-fixed, K-clean, K-m3, K-m7, K-h2 |
| `level1-all-runs.mp4` | Every run back to back, 12:05 |
| `findings/*.json`, `mutants.json` | Results behind the report (`npm run report` falls back to these) |
| `shots/*-verdict.png` | Verdict frame of each run |
| `report-cloud.md` | Report as generated in the cloud |

Runs: S1–S4 (bugs in the unmodified kit), P1 (Land returns to dock: INTENDED), S1-fixed
(S1 on a stale-flagging cockpit: PASS), K-clean + K-m1…m7 (planted bugs: 7/7 caught) +
K-h1/h2 (harmless changes: no false alarm).
