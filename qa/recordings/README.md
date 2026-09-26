# Cloud recordings (submission backup)

Recorded 2026-09-26 in the Claude Code cloud container against the kit (npm mode,
cockpit :5173), headed Chromium under Xvfb, **real time — nothing sped up**.

Environment note: the container had no internet map tiles (Cesium globe renders
plain) and no live video stream (MediaMTX not running, so the video tile reads
"off"). Neither affects the telemetry/socket/fault/responsive/security checks; see
the report's system-design "Recording environment" line and the gen-01 note.

| Path | What |
|---|---|
| `videos/*.webm` | Every run (1440x900, 25 fps): S1-S4, P1, S1-fixed, K-clean, K-m1..m8, K-h1/h2, K-gen-01..05 |
| `mp4/*.mp4` | Same runs as H.264 mp4, upload-ready |
| `level1-all-scenarios.mp4` | Portal cut (~10.5 min): S1-S4, P1, S1-fixed, K-clean, the 5 agent-generated, one XSS seed, one harmless |
| `level1-all-runs.mp4` | Every run back to back (~17 min) |
| `findings/*.json`, `mutants.json` | Data behind the report (`npm run report` falls back to these) |
| `shots/*-verdict.png` | Verdict frame of each run |
| `report-cloud.md` | The report as generated here |

Results: 11/13 injected mutations caught (8/8 seed, 3/5 agent-generated), 0 false
alarms across clean + 2 harmless builds. The two agent-generated misses (video
shown off when live; telemetry clipped on a phone) are reported honestly in the
report — both are cases an invariant cannot cover because the unmodified kit
already lacks live video / hides phone telemetry (real bug S4).

The 5 agent-generated mutations were authored by a separate Claude subagent with
no access to `qa/`. `qa/mutator.ts` is the external-LLM version (OpenAI/Gemini/NIM),
not runnable in this container because outbound egress to those APIs is blocked.
