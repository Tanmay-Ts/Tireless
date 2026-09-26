# Tireless Hand · Level 1 evaluation (draft)

_Generated 2026-09-26T08:52:50.000Z by `qa/report.ts` from `out/findings/*.json` and `out/mutants.json`._

## 1. System design

A deterministic, black-box testing harness (TypeScript + Playwright) that drives the cockpit like an operator, reads independent ground truth from the backend, and judges the UI with rule-based oracles. **No LLM is called inside the test loop**, so runs are repeatable, fast and free.

| Part | What it does |
|---|---|
| **Condition driver** (`driver.ts`) | Puts the system in a known state and changes conditions through the kit's control API: clear faults, reset (every drone on its dock at 100 %), start the simulator (seed 42), take off / land, inject faults (`sim-offline`, `socket-delay`, …). Every call is logged and shown on screen. |
| **Truth observer** (`truth.ts`) | Independent ground truth: our own socket.io client (same handshake and topics as the cockpit) records every telemetry frame with its arrival time and timestamp; `/api/control/state` is polled straight from the simulator (it keeps moving even when the telemetry path is broken); `/api/health` gives the simulator link. |
| **Oracles** (`oracles.ts`) | Zero-LLM checks that compare *meaning*, not pixels or exact strings: UI value vs truth within a tolerance; freshness (when truth is stale, the UI must show a new stale/offline cue compared with a live baseline); reachability (visible, in viewport, not covered via `elementFromPoint`, enabled); cross-panel consistency (status pill vs device list vs simulator); internal consistency (claimed speed vs distance actually moved). Elements are found by test id, then role + name, then visible label/text, and the fallback used is recorded (so a renamed test id does not break the run). |
| **Evidence HUD** (`overlay.ts`) | Injected into the page for the recording: scenario id, brief line, starting state, steps ticking off, the API calls made, a live truth-vs-UI table, red boxes on the failing elements and a verdict banner. It lives in a closed shadow root with `pointer-events:none`, so it can never influence a check. |
| **Device harness** (`device.ts`) | Phone and tablet layouts: the cockpit runs in a frame whose viewport is exactly the device size (so the app's own responsive rules apply), shown next to the evidence panel. Results are cross-checked in real device emulation (touch, high-DPI, mobile browser). |
| **Invariant suite K + mutation runner** (`scenarios/k-invariants.ts`, `mutants.ts`) | Six cockpit rules that hold on the unmodified kit (presence, values vs backend, cross-panel status, no false offline, link loss shown, phone reachability vs the clean build). The runner plants bugs in the cockpit source, runs K on each, reverts, and scores caught / missed / false alarm. This is the net for the judges' mutations. |
| **Runner** (`runner.ts`) | Headed Chromium, real-time video at the viewport size plus a Playwright trace per scenario. A precondition that cannot be met (e.g. fault did not take effect) is reported as SETUP-FAILED, never as a bug. |
| **Reporter** (`report.ts`) | Turns findings JSON into this document: numbered scenarios with Title, Description, Approach, evidence and video link. Findings sharing a root cause are grouped. |

**How they work together:** driver sets a clean, seeded start → truth observer starts recording → runner opens the cockpit and performs the operator workflow → driver injects the changing condition → oracles sample UI and truth every second → HUD shows it live on the recording → verdict + artefacts → reporter.

**Scope and assumptions:** only the cockpit is under test; the control panel is out of scope and never opened. The backend (health, simulator state, socket) is treated as correct and is the reference the screen is compared against; it is also how conditions are set up, so setup works however the cockpit is mutated. Intended backend behaviour is not flagged: for example, Land returns the drone to its dock even though the kit README still says it lands where it is.

**Precision controls:** every scenario first checks the UI is correct while conditions are normal (a control phase), gives the UI a grace period before judging, requires the failure on every judged sample (not a single glitch), and verifies the fault really took effect from truth before judging the UI.

### Precision check: Land returns the drone to its dock: intended, not flagged

Precision check, not a numbered finding. The kit README says Land brings the drone "down where it is", but the backend now flies it back to its dock first (latest kit commit: "return-to-dock landing"). A tester that trusts the README would raise a false alarm. We land Drone 1 mid-flight and check that the cockpit shows what the drone really does.

**How:** The backend is the reference. After Land, the harness samples the cockpit (status pill, altitude, distance from home, battery) and the simulator state every ~0.7 s until the drone is down, checks the status sequence matches (in_flight → landing → standby), values stay within tolerance, and the final state is on the dock. It then compares the three sources: README (lands in place), backend (returned to the dock before descending), cockpit (followed the backend). Docs and backend disagreeing while the cockpit matches the backend is classified INTENDED, never BUG.

**Result: INTENDED: Land returns to the dock: intended behaviour, not flagged.** README says "down where it is"; backend (latest commit: return-to-dock landing) flew 70 m back and landed on the dock in 15.4 s. Cockpit followed it: in_flight → landing → standby, altitude/distance within tolerance in 100 % of 21 samples, final 0.0 m / 0 m.

| source | what it says Land does | result |
|---|---|---|
| Kit README | "Press Land to bring it down where it is" | outdated |
| Latest kit commit | "feat(cockpit): add 2D/3D view toggle, terrain height references and return-to-dock landing" | intended change |
| Backend (simulator state) | flew back 70 m to the dock, descended at 0.0 m from it | returns to dock |
| Cockpit | status in_flight → landing → standby; final 0.0 m / 0 m | matches backend |

**Video:** _<paste Drive link: videos/P1.webm>_

### Precision check: S1 on a fixed cockpit: stale data is flagged, so S1 reports PASS

Precision control for S1. The same scenario, oracle and thresholds, run against a copy of the cockpit patched to show "stale · N s ago" when position data is older than 3 s. If the S1 oracle were simply always red, it would flag this build too. Expected: PASS.

**How:** Deterministic Playwright run, zero LLM calls. Ground truth comes from the backend (/api/health simulator link), our own socket.io client (frame age for drone-1), and /api/control/state polled straight from the simulator (the drone keeps flying). While live, the harness checks the UI matches truth (battery, altitude, speed, distance, status) and records every freshness cue on screen as a baseline. After the fault and a 5 s grace (the cockpit's own heartbeat threshold), it samples the page every second and looks for any NEW cue that data is stale: stale/offline/disconnected/"N s ago" wording, data-state/aria/class markers, dashed-out or dimmed telemetry. Wording is matched by meaning. It also cross-checks the UI against itself (claimed speed vs unchanged distance) and against the simulator (real distance keeps growing). BUG only if every judged sample shows no cue; a precondition that fails (fault not active) is SETUP-FAILED, not a bug.

**Result: PASS: UI flagged stale data after 4.1 s.** Cue: "stale · 4 s ago"

| t after fault | truth: last frame | truth: simulator | UI badge | UI status | UI H-speed | UI dist. | real dist. | new stale cue |
|---|---|---|---|---|---|---|---|---|
| 5.2 s | 5.4 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 110 m | "stale · 5 s ago" |
| 6.2 s | 6.3 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 120 m | "stale · 6 s ago" |
| 7.2 s | 7.3 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 130 m | "stale · 7 s ago" |
| 8.2 s | 8.3 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 140 m | "stale · 8 s ago" |
| 9.2 s | 9.4 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 150 m | "stale · 9 s ago" |
| 10.2 s | 10.3 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 160 m | "stale · 10 s ago" |
| 11.3 s | 11.4 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 175 m | "stale · 11 s ago" |
| 12.2 s | 12.3 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 180 m | "stale · 12 s ago" |

**Video:** _<paste Drive link: videos/S1-fixed.webm>_

### Mutation testing: planted bugs are caught, harmless changes are not flagged

The invariant suite K is the regression net for *new* bugs, such as the judges' mutations. Every check passes on the unmodified kit:

| Check | Must hold |
|---|---|
| K1 Presence | Connection badge, every device row, status pill, all 9 telemetry values (with numbers), map, video tile and map toggles are displayed; every control reachable in the clean build still is (semantic diff against the clean baseline). |
| K2 Values | Battery, altitude, H-speed, distance from home and heading match the latest telemetry frame for the selected drone (2 of 3 samples within tolerance). |
| K3 Cross-panel | Device-list pill, telemetry status pill and backend agree on the flight state. |
| K4 No false offline | While data is live, there is no stale/offline cue anywhere and the connection badge says connected. |
| K5 Link loss shown | `socket-refuse` for 6 s gives a new stale/offline cue within 5 s, which clears after recovery. |
| K6 Phone | At 390 px every control reachable in the clean build at that size still is. |

We planted 7 bugs in the cockpit source (patches in `qa/mutants/`) and added 2 harmless changes. Each build ran through K with a recording.
**Result: 7/7 planted bugs caught, 0 false alarms across 3 clean/harmless builds.** _(run 2026-09-26T08:51:24.095Z)_

| Build | What was changed | Expected | Checks that failed | Outcome | Video |
|---|---|---|---|---|---|
| Unmodified kit | nothing (records the clean baseline) | PASS | none | ✅ correctly passed | _<link: videos/K-clean.webm>_ |
| Connection shown as live when it is down | SocketBadge.tsx: badge text and colour hard-coded to "socket connected" | K5 | K5 | ✅ caught | _<link: videos/K-m1-badge-always-connected.webm>_ |
| Live connection shown as offline | SocketBadge.tsx: shows "socket disconnected" while connected | K4 | K4 | ✅ caught | _<link: videos/K-m2-online-shown-offline.webm>_ |
| Battery 10 % too low | TelemetryPanel.tsx: battery value − 10 | K2 | K2 | ✅ caught | _<link: videos/K-m3-battery-off-by-10.webm>_ |
| Telemetry of the wrong drone | TelemetryPanel.tsx: reads data of drone N+1 for selected drone N | K2 + K3 | K2, K3 | ✅ caught | _<link: videos/K-m4-wrong-drone-telemetry.webm>_ |
| Flying drone shown as landed | TelemetryPanel.tsx: status pill shows "standby" while in_flight | K3 | K3 | ✅ caught | _<link: videos/K-m5-flying-shown-as-landed.webm>_ |
| Connection indicator removed | CockpitPage.tsx: <SocketBadge /> deleted | K1 + K5 | K1, K5 | ✅ caught | _<link: videos/K-m6-connection-badge-removed.webm>_ |
| Device list pushed off-screen on phones | styles.css (< 800 px): side panel translateX(-110vw) | K6 | K6 | ✅ caught | _<link: videos/K-m7-device-list-offscreen-phone.webm>_ |
| Harmless: test ids renamed | testids.ts: socket-status, telemetry-battery, telemetry-hspeed renamed (UI unchanged) | PASS | none | ✅ correctly passed | _<link: videos/K-h1-testids-renamed.webm>_ |
| Harmless: wording changed | "FlytBase Cockpit"→"FlytBase Operations", "Devices"→"Fleet", "socket …"→"link …", "Dist. from home"→"Distance to home" | PASS | none | ✅ correctly passed | _<link: videos/K-h2-wording-change.webm>_ |

## 2. Scenarios

| # | Scenario | Category | Verdict | Root cause |
|---|---|---|---|---|
| 1 | S1 · Stale telemetry shown as live when the simulator link drops | Live data · Network/recovery · Freshness | BUG | `freshness-not-tracked` |
| 2 | S2 · Out-of-order telemetry rendered as current: drone jumps backwards | Live data · Changing network conditions · Telemetry integrity | BUG | `ignores-message-timestamp` |
| 3 | S3 · Map 2D/3D view toggle is covered by the video tile on phones | Responsive · Devices · Map controls | BUG | `mobile-video-tile-overlaps-map-controls` |
| 4 | S4 · Selecting a drone on a phone does not show its telemetry | Responsive · Devices · Operator workflow | BUG | `mobile-side-panel-fixed-220px` |

### 1. Stale telemetry shown as live when the simulator link drops

**Verdict:** BUG · telemetry 12.5 s old, still shown as live
**Category:** Live data · Network/recovery · Freshness · **Root cause key:** `freshness-not-tracked`
**Video:** _<paste Drive link: videos/S1.webm>_

**Description.** An operator watching a drone in flight must be able to tell when the telemetry on screen stops being live. We cut the simulator→backend link (sim-offline) while Drone 1 is in flight. The expected behaviour, per the brief, is that within a few seconds the cockpit shows the data as stale/disconnected (wording, age, greyed values, or an offline status) instead of continuing to present the last values as current.

> Product brief: “makes clear whether information is live, delayed, stale, disconnected or unavailable”

**Approach.** Deterministic Playwright run, zero LLM calls. Ground truth comes from the backend (/api/health simulator link), our own socket.io client (frame age for drone-1), and /api/control/state polled straight from the simulator (the drone keeps flying). While live, the harness checks the UI matches truth (battery, altitude, speed, distance, status) and records every freshness cue on screen as a baseline. After the fault and a 5 s grace (the cockpit's own heartbeat threshold), it samples the page every second and looks for any NEW cue that data is stale: stale/offline/disconnected/"N s ago" wording, data-state/aria/class markers, dashed-out or dimmed telemetry. Wording is matched by meaning. It also cross-checks the UI against itself (claimed speed vs unchanged distance) and against the simulator (real distance keeps growing). BUG only if every judged sample shows no cue; a precondition that fails (fault not active) is SETUP-FAILED, not a bug.

**Starting state.** faults cleared · sim reset (all drones standby at 100 %) · started 1× · SIM_SEED 42 · 1440×900 · drone-1 selected

**Steps (as run, visible on the HUD).**
1. Clean start: clear faults, reset, start sim: ok
2. Open cockpit, select Drone 1 (row found via testid): ok
3. Take off Drone 1, wait for in_flight: ok
4. Control: UI = truth and no stale cue while live (all fields within tolerance, no stale cue): ok
5. Inject sim-offline (30 s window) (/api/health → simulator: disconnected (0.0 s after POST)): ok
6. Grace 5 s: UI may flag staleness (no cue yet): ok
7. Observe: does the UI say data is stale? (no stale cue in 8/8 samples): fail

**API calls.**
- t+0.1s `DELETE /api/control/fault` → 200
- t+0.1s `POST /api/control/sim {"action":"reset"}` → 200
- t+0.1s `POST /api/control/sim {"action":"start","speed":1}` → 200
- t+5.1s `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}` → 200
- t+21.6s `POST /api/control/fault {"kind":"sim-offline","seconds":30}` → 200
- t+45.9s `DELETE /api/control/fault` → 200

**Result.** Simulator disconnected, no data for 12.5 s; cockpit still says "socket connected", "in_flight", 10.0 m/s, distance 65 m (real 185 m). No stale/offline cue in 8/8 samples after a 5 s grace.

| t after fault | truth: last frame | truth: simulator | UI badge | UI status | UI H-speed | UI dist. | real dist. | new stale cue |
|---|---|---|---|---|---|---|---|---|
| 5.3 s | 5.5 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 115 m | none |
| 6.3 s | 6.5 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 125 m | none |
| 7.3 s | 7.5 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 135 m | none |
| 8.3 s | 8.5 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 145 m | none |
| 9.3 s | 9.5 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 155 m | none |
| 10.3 s | 10.5 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 165 m | none |
| 11.3 s | 11.5 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 175 m | none |
| 12.3 s | 12.5 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 185 m | none |

_Evidence: video `videos/S1.webm`, trace `traces/S1.zip` (open with `npx playwright show-trace`), screenshot `shots/S1-verdict.png`. Run 2026-09-26T07:52:27.059Z, 45.9 s, viewport 1440×900, speed 1×._

---

### 2. Out-of-order telemetry rendered as current: drone jumps backwards

**Verdict:** BUG · UI rendered older telemetry over newer: 6 backward jumps
**Category:** Live data · Changing network conditions · Telemetry integrity · **Root cause key:** `ignores-message-timestamp`
**Video:** _<paste Drive link: videos/S2.webm>_

**Description.** Networks deliver telemetry late and occasionally out of order. When a newer position has already been shown, an older one must not replace it: the operator would see the drone jump backwards and read a wrong position, distance and track. We delay the telemetry path by 3 s with jitter (the kit's socket-delay fault) while Drone 1 flies a straight line away from its dock, so its true distance from home only increases. Expected: the cockpit keeps showing the newest data (discarding late, older frames) and makes clear the data is delayed.

> Product brief: “makes clear whether information is live, delayed, stale, disconnected or unavailable”

**Approach.** Deterministic Playwright run, zero LLM calls. A MutationObserver in the page records every value "Dist. from home" displays, with wall-clock time. Our own socket.io client subscribes to the same topics and receives the same frames in the same order as the cockpit, each with the simulator timestamp. Control first: 5 s without the fault, the displayed distance must never decrease. Then socket-delay 3000 ms for 22 s. Every backward step in the UI larger than 2 m is matched to the frame that caused it (same value, arrived within 600 ms) and counts only if that frame's timestamp is older than a frame already delivered. BUG requires at least 2 such matched jumps; if the network produced fewer than 2 out-of-order frames the run is SETUP-FAILED, not PASS.

**Starting state.** faults cleared · sim reset · started 1× · SIM_SEED 42 · 1440×900 · drone-1 selected, flying straight out

**Steps (as run, visible on the HUD).**
1. Clean start: clear faults, reset, start sim: ok
2. Open cockpit, select Drone 1 (row found via testid): ok
3. Take off Drone 1, wait for in_flight: ok
4. Control 5 s: distance only grows (no fault) (12 updates, 0 backward jumps): ok
5. Inject socket-delay 3000 ms (+≤50 % jitter) (GET /api/control/fault lists socket-delay): ok
6. Record every UI update for 22 s: ok
7. Match each backward jump to a late frame (6/6 jumps caused by late frames): fail

**API calls.**
- t+0.1s `DELETE /api/control/fault` → 200
- t+0.1s `POST /api/control/sim {"action":"reset"}` → 200
- t+0.1s `POST /api/control/sim {"action":"start","speed":1}` → 200
- t+5s `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}` → 200
- t+22.9s `POST /api/control/fault {"kind":"socket-delay","value":3000}` → 200
- t+57.7s `DELETE /api/control/fault` → 200

**Result.** With 3000 ms delay + jitter, 6/36 position frames arrived out of order. The cockpit displayed them anyway: distance-from-home went backwards 6× (e.g. 115 → 110 m) while the drone flew straight away from its dock. No "delayed" cue while data was 3.1–4.4 s old.

| t after delay on | UI showed | then UI showed | cause (our socket) |
|---|---|---|---|
| 6.6 s | 115 m | 110 m | frame 500 ms older than one already delivered |
| 8.4 s | 130 m | 125 m | frame 501 ms older than one already delivered |
| 10.7 s | 155 m | 150 m | frame 501 ms older than one already delivered |
| 14.4 s | 195 m | 190 m | frame 501 ms older than one already delivered |
| 18.0 s | 225 m | 220 m | frame 502 ms older than one already delivered |
| 19.5 s | 245 m | 240 m | frame 500 ms older than one already delivered |

**Also observed (reported under its own root cause, not counted again):**
- `freshness-not-tracked`: Data arrived 3.1–4.4 s late with no "delayed" cue anywhere in the cockpit (same root cause as S1).

_Evidence: video `videos/S2.webm`, trace `traces/S2.zip` (open with `npx playwright show-trace`), screenshot `shots/S2-verdict.png`. Run 2026-09-26T07:53:13.390Z, 57.7 s, viewport 1440×900, speed 1×._

---

### 3. Map 2D/3D view toggle is covered by the video tile on phones

**Verdict:** BUG · 2D/3D toggle unusable at 320–412 px
**Category:** Responsive · Devices · Map controls · **Root cause key:** `mobile-video-tile-overlaps-map-controls`
**Video:** _<paste Drive link: videos/S3.webm>_

**Description.** The operator switches the map between 3D and 2D with the 2D/3D toggle at the bottom of the map. The product must work on phones, tablets, laptops and desktops. We open the cockpit at a laptop size and at six tablet/phone sizes and check that every control usable on the laptop can still be seen and pressed. Expected: the map view toggle is visible and pressable at every size.

> Product brief: “Works in modern browsers on phones, tablets, laptops and desktops”

**Approach.** Deterministic Playwright run, zero LLM calls. The cockpit runs in a device frame (an iframe whose CSS viewport is exactly the device size, so the app's own media queries apply) next to the evidence panel. At each size the harness audits every button, link and device row: displayed, inside the viewport or reachable by scrolling, and not covered: document.elementFromPoint() at the control's visible centre must return the control itself. The laptop result is the baseline; anything usable there and unusable elsewhere is flagged, which also catches controls pushed off-screen or hidden by a mutation. The failing control is then tapped like a user (real pointer) and the effect checked through its aria-pressed state, Playwright's own actionability check is recorded, and the result is re-checked in a real iPhone SE emulation context (touch, DPR 2, mobile UA).

**Starting state.** faults cleared · sim reset · started 1× · SIM_SEED 42 · cockpit in a device frame: laptop 1366×768 → 768 → 412 → 390 → 360 → 320 → 375 px

**Steps (as run, visible on the HUD).**
1. Clean start: clear faults, reset, start sim: ok
2. Laptop 1366×768: audit every control (baseline) (7 usable controls on the laptop): ok
3. Laptop control: tap "2D", map switches (aria-pressed="true" after tap, then back to 3D): ok
4. Resize through 6 tablet/phone sizes, audit every control: ok
5. iPhone SE: operator taps "2D" (aria-pressed false → false · Playwright: <div data-state="off" class="video-placeholder" data-testid=): fail
6. Cross-check in emulated iPhone SE (touch, DPR 2) (emulated iPhone SE: covered by div[data-testid=video-player].video-placeholder): fail

**API calls.**
- t+0.1s `DELETE /api/control/fault` → 200
- t+0.1s `POST /api/control/sim {"action":"reset"}` → 200
- t+0.1s `POST /api/control/sim {"action":"start","speed":1}` → 200
- t+39.5s `DELETE /api/control/fault` → 200

**Result.** At phone widths the FPV video tile sits on top of the map view toggle (elementFromPoint hits the tile). Tapping "2D" on an iPhone SE leaves aria-pressed=false: the map cannot be switched. Usable on laptop and iPad. Confirmed in real iPhone SE emulation: covered by div[data-testid=video-player].video-placeholder.

| screen | map view toggle | other controls |
|---|---|---|
| 1366×768 (laptop, baseline) | usable | usable |
| 768×1024 (iPad Mini) | usable | usable |
| 412×915 (Pixel 7) | 2D toggle: covered by div[data-testid=video-player].video-placeholder | usable |
| 390×844 (iPhone 13) | 2D toggle: covered by div[data-testid=video-player].video-placeholder; 3D toggle: covered by div[data-testid=video-player].video-placeholder | usable |
| 360×740 (Galaxy S8) | 2D toggle: covered by div[data-testid=video-player].video-placeholder; 3D toggle: covered by div[data-testid=video-player].video-placeholder | usable |
| 320×568 (Small phone) | 2D toggle: covered by div[data-testid=video-player].video-placeholder; 3D toggle: covered by div[data-testid=video-player].video-placeholder | usable |
| 375×667 (iPhone SE) | 2D toggle: covered by div[data-testid=video-player].video-placeholder; 3D toggle: covered by div[data-testid=video-player].video-placeholder | usable |

_Evidence: video `videos/S3.webm`, trace `traces/S3.zip` (open with `npx playwright show-trace`), screenshot `shots/S3-verdict.png`. Run 2026-09-26T07:54:11.602Z, 39.5 s, viewport 1440×900, speed 1×._

---

### 4. Selecting a drone on a phone does not show its telemetry

**Verdict:** BUG · phone: selecting a drone shows 0/9 telemetry values
**Category:** Responsive · Devices · Operator workflow · **Root cause key:** `mobile-side-panel-fixed-220px`
**Video:** _<paste Drive link: videos/S4.webm>_

**Description.** An operator selects a drone to see how it is doing: status, battery, altitude, speed, distance, next to the map and video. The brief says selecting a drone shows these together, and that the product works on phones. On a laptop this holds. We repeat the same action on phone-sized screens while Drone 1 is flying. Expected: after tapping the drone, its status and key telemetry (battery, altitude, speed) are visible without hunting for them.

> Product brief: “Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together”

**Approach.** Deterministic Playwright run, zero LLM calls. The cockpit runs in a device frame (iframe with the exact device viewport, so the app's media queries apply). After the select action the harness probes the selected row, status pill, all 9 telemetry values, the map and the video: an item counts as visible only if it is inside the viewport, at least 60 % unclipped by any scroll container, and document.elementFromPoint() at its visible centre returns the item itself. Laptop first as the control (everything visible together), then iPhone SE. The operator is then allowed to scroll the side panel with the mouse wheel and visibility is measured again, to state precisely what a phone user can see at once. Repeated on iPhone 13 and Pixel 7, and re-checked in a real iPhone SE emulation context (touch, DPR 2).

**Starting state.** faults cleared · sim reset · started 1× · SIM_SEED 42 · Drone 1 taking off (live data) · cockpit in a device frame: laptop 1366×768, then iPhone SE 375×667

**Steps (as run, visible on the HUD).**
1. Clean start, take off Drone 1 (live values): ok
2. Laptop: select Drone 1, all shown together (control) (status + 9/9 telemetry + map + video visible together): ok
3. iPhone SE: operator taps Drone 1: ok
4. What is visible right after selecting? (0/9 telemetry visible · status pill hidden (0 % in view) · clipped by aside.cockpit-left (375×220 px)): fail
5. Operator scrolls the side panel to find telemetry (9 wheel steps · at most 7/9 values at once): ok
6. What is visible together after scrolling?: fail
7. Cross-check: iPhone 13, Pixel 7, emulated iPhone SE: fail

**API calls.**
- t+0.1s `DELETE /api/control/fault` → 200
- t+0.1s `POST /api/control/sim {"action":"reset"}` → 200
- t+0.1s `POST /api/control/sim {"action":"start","speed":1}` → 200
- t+0.4s `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}` → 200
- t+36.9s `DELETE /api/control/fault` → 200

**Result.** On iPhone SE, after tapping Drone 1 (in flight), its status, battery, altitude and speed are not on screen: they sit below a fixed-height side panel (aside.cockpit-left (375×220 px)) filled by the device list. Scrolling that panel shows at most 7/9 values at once and loses the selected row. Laptop: 9/9 together with map and video. Also on: iPhone 13, Pixel 7, emulated iPhone SE (touch, DPR 2).

| screen | right after selecting Drone 1 | after scrolling the side panel |
|---|---|---|
| Laptop 1366×768 (control) | status visible, 9/9 telemetry, map visible, video visible | not needed |
| iPhone SE 375×667 | status hidden (0 % in view), 0/9 telemetry, map visible, video visible | at most 7/9 at once; selected row scrolled out of view |
| iPhone 13 390×844 | 0/9 telemetry visible, status pill hidden (0 % in view) |  |
| Pixel 7 412×915 | 0/9 telemetry visible, status pill hidden (0 % in view) |  |
| emulated iPhone SE (touch, DPR 2) | 0/9 telemetry visible, status pill hidden (0 % in view) |  |

_Evidence: video `videos/S4.webm`, trace `traces/S4.zip` (open with `npx playwright show-trace`), screenshot `shots/S4-verdict.png`. Run 2026-09-26T07:54:51.578Z, 36.9 s, viewport 1440×900, speed 1×._
