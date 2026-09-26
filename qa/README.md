# Tireless QA harness (Level 1)

Deterministic, black-box UI testing for the FlytBase cockpit kit
([FlytBaseAILabs/flytbase-ahc-swe-qa-hackathon](https://github.com/FlytBaseAILabs/flytbase-ahc-swe-qa-hackathon)).
Playwright drives the cockpit like an operator. Ground truth comes from the kit's own API and socket, and
rule-based oracles judge the UI. **No LLM calls happen inside the test loop.** Every scenario records a
**real-time** video with an evidence HUD burned in, plus a Playwright trace.

## Run it

```bash
# 1. kit running (Docker: cockpit :4010, or npm mode: cockpit :5173), backend on :4000
# 2. harness
cd qa
npm install
npx playwright install chromium        # once, if you do not already have Playwright's Chromium
cp .env.example .env                   # set COCKPIT_URL=http://localhost:5173 in npm mode
npm run s1                             # headed; video → out/videos/S1.webm, trace → out/traces/S1.zip
npm run report                         # out/report.md + out/findings.json (also written after every run)
npx playwright show-trace out/traces/S1.zip
```

`HEADED=0` runs headless (the video is still recorded). Each scenario resets the simulator itself, so
nothing else needs to run between scenarios. Keep the control panel closed while recording so its
clicks cannot interfere.

## Files

| File | Role |
|---|---|
| `driver.ts` | Control API (docs/reference.md): `cleanStart()` = clear faults, reset, start; `takeoff`/`land` via `POST /api/control/command`; `fault({kind, seconds, value})` checks the fault is listed as active; `health()`, `snapshot()`, `devices()`. |
| `truth.ts` | Our own socket.io client (`auth {'org-id':'flytbase'}`, `Subscribe {topic}`, events named by topic) recording every frame and its arrival time, plus polling of `/api/control/state` (straight from the simulator over HTTP) and `/api/health`. Provides `freshness()`, `homeDistanceM()`, `speedMps()` and `reorders()`. |
| `oracles.ts` | Zero-LLM checks: `locate` (testid → role → label → text, records the fallback used), `compareNum` (UI vs truth with a tolerance), `freshnessScan` + `newIndicators` (stale cues compared with a live baseline, matched by meaning), `reachability` (visible, in viewport, not covered via `elementFromPoint`, enabled), `crossPanel`, `motionContradiction`. |
| `overlay.ts` | Evidence HUD. It sits in a closed shadow root with `pointer-events:none` and `aria-hidden`, so it can never affect a check. |
| `runner.ts` | Scenario lifecycle: video at viewport size, trace, HUD, verdict banner held for 6 s, artefacts, finding JSON. A precondition that fails gives SETUP-FAILED, never BUG. |
| `report.ts` | Findings → `out/report.md`: system design plus numbered scenarios (Title / Description / Approach / steps / API calls / evidence table / video placeholder), grouped by root cause. |
| `scenarios/` | One file per scenario. |
| `mutants/` | Patches for the kit used as controls. `control-fix-stale.patch` makes the cockpit flag stale data; S1 must then report PASS. |

## S1: stale data shown as live

1. Clean start, open the cockpit, select Drone 1, take off, wait for `in_flight`.
2. **Control (live):** battery, altitude, H-speed, distance and status must match truth within tolerance, and no stale cue may be on screen. This catches the reverse mutation (online shown as offline) and value mutations. The on-screen cues are recorded as the baseline.
3. `POST /api/control/fault {kind:'sim-offline', seconds:30}`, confirmed by `/api/health` → `simulator: disconnected`. The fault outlasts the recording, so the verdict frames still show the broken state. It is cleared afterwards.
4. **Grace:** 5 s (`GRACE_MS`, matching the cockpit's own 5 s heartbeat threshold). Samples are taken but not judged.
5. **Judged:** for 8 s, at 1 Hz, look for any *new* cue vs the baseline: stale/offline/disconnected/unknown/"N s ago" wording, `data-state`/aria/class markers, dashed-out values, or dimmed telemetry. The video tile is excluded.
6. **BUG** only if every judged sample has no cue. **PASS** if a cue appears within grace + 1.5 s.

Precision check: `git -C <kit> apply qa/mutants/control-fix-stale.patch`, run `npm run s1` (expect PASS), then `git -C <kit> apply -R ...`.

Known limit: the map is a Cesium canvas, so a stale cue drawn only on the map (a dock billboard) cannot be seen by the DOM scan.
