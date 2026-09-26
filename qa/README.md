# Tireless QA harness (Level 1)

Deterministic, black-box UI testing for the FlytBase cockpit kit
([FlytBaseAILabs/flytbase-ahc-swe-qa-hackathon](https://github.com/FlytBaseAILabs/flytbase-ahc-swe-qa-hackathon)).
Playwright drives the cockpit like an operator. Ground truth comes from the kit's own API and socket, and
rule-based oracles judge the UI. **No LLM calls happen inside the test loop.** Every scenario records a
**real-time** video with an evidence HUD burned in, plus a Playwright trace.

## Scope and assumptions

- **Only the cockpit is under test** (`:4010`, or `:5173` in npm mode). The control panel (`:4000/dashboard`) is out of scope, as confirmed by the organizers. The harness never opens or clicks it.
- **The backend is correct and is the reference.** `/api/health`, `/api/control/state` and our own socket client are ground truth. When the cockpit disagrees with them, that is a cockpit bug.
- **Conditions are set through the control API** (reset, start, takeoff, faults), as the kit's AGENTS.md recommends for scripting. This keeps working however the cockpit is mutated.
- **Intended backend behaviour is never flagged.** For example, Land returns the drone to its dock (latest kit commit) even though the kit README still says it lands where it is. The oracles follow the backend, not the docs.

## Run it

```bash
# 1. kit running (Docker: cockpit :4010, or npm mode: cockpit :5173), backend on :4000
# 2. harness
cd qa
npm install
npx playwright install chromium        # once, if you do not already have Playwright's Chromium
cp .env.example .env                   # set COCKPIT_URL=http://localhost:5173 in npm mode
npm run s1                             # headed; video → out/videos/S1.webm, trace → out/traces/S1.zip
npm run scenario -- S2 S3 S4           # or: npm run scenario -- all
npm run report                         # out/report.md + out/findings.json (also written after every run)
npx playwright show-trace out/traces/S1.zip
```

### Recording on a Windows laptop (PowerShell)

The laptop records **only S1–S4 and P1** (`npm run record`). The mutation runs (`K-*`) and the S1 fixed-cockpit control (`S1-fixed`) were recorded in the cloud and are committed in `qa/recordings/` (webm + mp4, findings, `mutants.json`). `npm run report` and `npm run video` pick them up automatically, so the laptop does not need `KIT_DIR` or `npm run mutants`.

**1. Start the kit** (in the kit folder; production images are lighter on 8 GB RAM):

```powershell
docker compose -f docker-compose.yml up --build -d
Invoke-RestMethod http://localhost:4000/api/health
```

Wait until the health call shows `simulator : connected`. If the map is black, set `MAP_TILES=osm` in the kit's `.env` and run the `up` command again.

**2. Set up the harness** (once, in the `qa` folder):

```powershell
cd qa
npm install
npx playwright install chromium
Copy-Item .env.example .env
winget install Gyan.FFmpeg
```

Close PowerShell and open a new window after installing ffmpeg, so it is on `PATH`. `.env` needs no change for Docker (the cockpit is on :4010). In npm mode, set `COCKPIT_URL=http://localhost:5173`.

**3. Record S1–S4 and P1** (about 4 minutes; a Chromium window opens, do not touch it; it may be larger than the screen, which does not affect the recording):

```powershell
npm run record
```

**4. Make the upload files:**

```powershell
npm run video -- S1 S2 S3 S4 P1 S1-fixed K-clean K-m3-battery-off-by-10 K-m7-device-list-offscreen-phone K-h2-wording-change
```

This writes one mp4 per run in `out\mp4\` and `out\level1-all-scenarios.mp4` with those runs back to back (ids not recorded locally come from `qa\recordings\videos\`). To include every run, list them all: the ids are the file names in `out\videos\` and `qa\recordings\videos\`.

**5. Draft the write-up:**

```powershell
npm run report
```

Open `out\report.md`. Upload the mp4s to Drive with "Anyone with the link" access, test the links in an incognito window, and paste them over the `<paste Drive link …>` placeholders.

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
| `device.ts` | Phone/tablet harness: the cockpit runs in an iframe with the exact device viewport (the app's media queries apply), shown scaled beside the HUD. `crossCheckOnDevice()` repeats a check in real Playwright device emulation (touch, DPR, mobile UA). |
| `scenarios/` | One file per scenario. `common.ts` holds the shared operator steps (clean start, open, select, take off). |
| `mutants/` | Planted bugs and harmless changes as `git diff` patches against the kit, plus `index.ts` (what each patch changes and which K check must catch it). `control-fix-stale.patch` is S1's precision control (a fixed cockpit must PASS). |
| `mutants.ts` | Mutation runner: applies each patch to `KIT_DIR`, runs the invariant suite K (recorded), reverts, and scores it as caught / missed / false alarm. |
| `scenarios/k-invariants.ts` | Invariant suite K1–K6. It passes on the unmodified kit and is the regression net for new bugs. K1/K6 compare against `baseline/clean-invariants.json`, which is recorded by the clean run. |
| `scenarios/p1-land-returns-to-dock.ts` | Precision check: Land returns to the dock (the backend behaviour, from the latest kit commit) even though the README says otherwise. The result is INTENDED, not BUG. |
| `video.ts` | Converts webm to mp4 and joins them into `level1-all-scenarios.mp4` (real time). |

## S1: stale data shown as live

1. Clean start, open the cockpit, select Drone 1, take off, wait for `in_flight`.
2. **Control (live):** battery, altitude, H-speed, distance and status must match truth within tolerance, and no stale cue may be on screen. This catches the reverse mutation (online shown as offline) and value mutations. The on-screen cues are recorded as the baseline.
3. `POST /api/control/fault {kind:'sim-offline', seconds:30}`, confirmed by `/api/health` → `simulator: disconnected`. The fault outlasts the recording, so the verdict frames still show the broken state. It is cleared afterwards.
4. **Grace:** 5 s (`GRACE_MS`, matching the cockpit's own 5 s heartbeat threshold). Samples are taken but not judged.
5. **Judged:** for 8 s, at 1 Hz, look for any *new* cue vs the baseline: stale/offline/disconnected/unknown/"N s ago" wording, `data-state`/aria/class markers, dashed-out values, or dimmed telemetry. The video tile is excluded.
6. **BUG** only if every judged sample has no cue. **PASS** if a cue appears within grace + 1.5 s.

Precision check: `git -C <kit> apply qa/mutants/control-fix-stale.patch`, run `npm run s1` (expect PASS), then `git -C <kit> apply -R ...`.

## S2: out-of-order telemetry rendered as current

The drone flies a straight line away from its dock, so the real distance only grows. A MutationObserver records every value "Dist. from home" displays. Control: 5 s with no fault and no backward step. Then `socket-delay 3000` for 22 s. Every UI backward step of more than 2 m is matched to the frame that caused it (same value, arrived within 600 ms on our socket) and counts only if that frame is older than one already delivered. BUG requires at least 2 matched jumps. Fewer than 2 out-of-order frames = SETUP-FAILED.

## S3: map 2D/3D toggle covered on phones

The laptop is the baseline: every button, link and row is audited. The same audit runs at 768 / 412 / 390 / 360 / 320 / 375 px. A control usable on the laptop must stay displayed, in view (or scroll-reachable) and uncovered (`elementFromPoint` hits it). Then a real tap on "2D" is checked via `aria-pressed`, Playwright's "intercepts pointer events" error is recorded, and the result is cross-checked in an emulated iPhone SE.

## S4: telemetry not shown after selecting a drone on a phone

Laptop control: status plus 9/9 telemetry, map and video are all visible together. On iPhone SE, after tapping Drone 1, the same items are probed (in view, at least 60 % unclipped by scroll boxes, not covered). The operator then scrolls the side panel with the mouse wheel, and the report states what is visible at once. Repeated on iPhone 13, Pixel 7 and an emulated iPhone SE.

Known limit: the map is a Cesium canvas, so a stale cue drawn only on the map (a dock billboard) cannot be seen by the DOM scan.
