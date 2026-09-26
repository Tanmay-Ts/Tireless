# Tireless Hand · Level 1 evaluation

**Team:** {{TEAM_NAME}}

**Evaluation setup (host's note):** the hosts do not inject mutations during evaluation. Each team's system must include its own agent that inserts mutations into the product; the testing system then has to catch them, and each identification is a submitted scenario. Bugs our system found in the original kit are listed separately (scenarios 11–14).

**Summary:** 14 numbered scenarios: 10 caught mutations (3/5 agent-generated, 8/8 seed; the one bug both sets produced is counted once) and 4 real bugs in the original kit. 0 false alarms on the clean kit and two harmless changes. The agent's 2 misses are reported honestly in their own section.

**Videos:** every numbered scenario is in one real-time recording, the Video link of this submission (`level1-all-scenarios.mp4`), 13:05 long; each scenario states where it starts. Each run is also available as its own file in the repository (`submission/videos/`).

## 1. System design

Two cooperating parts: a **mutation agent** that injects realistic Level-1 bugs into the cockpit, and a deterministic **QA system** that catches them blind. No LLM runs inside the test loop, so every judged run is repeatable.

```
 mutation agent                                  QA system (deterministic, 0 LLM calls in the loop)
 reads cockpit source + product brief            driver.ts  -> clean start, takeoff/land, faults, add/remove drone
   | proposes JSON search/replace                truth.ts   -> own socket.io client + REST polling = ground truth
   | + answer key (category, file,               oracles.ts -> value vs truth, freshness, reachability,
   v   brief line, expected impact)                           cross-panel, control audit, XSS scan
 qa/mutants/generated/<id>.patch  -- apply -->  cockpit  -->  invariant suite K1-K7, recorded (video + trace)
 qa/mutants/generated/<id>.json (answer key)                  |
   +-------------- compared ONLY after the run ------------> mutants.ts: caught / missed / false alarm
```

| Part | What it does |
|---|---|
| **Mutation agent** | Reads the cockpit source and the brief and proposes realistic mutations as search/replace edits, each with an **answer key** (category, file, what it breaks, brief line, expected impact). **For this submission the role was played by a separate Claude subagent that was given only the cockpit `frontend/` source, the brief lines and the Level-1 categories, with no access to the QA code (`qa/`).** `qa/mutator.ts` is the external-LLM version of the same agent (OpenAI / Gemini / NVIDIA NIM); it was **not run here**, because this environment blocks outbound access to those APIs. Every proposed edit is validated (search text occurs exactly once, mutated file still parses) and saved as a git patch so runs replay deterministically. |
| **Condition driver** (`driver.ts`) | Puts the cockpit in a known state through the kit's control API: clear faults, reset (seed 42), start, takeoff/land, inject faults, add/remove a drone. |
| **Truth observer** (`truth.ts`) | Independent ground truth: our own socket.io client (same handshake and topics as the cockpit) records every telemetry frame with arrival time and timestamp; `/api/control/state` and `/api/health` are polled from the backend. |
| **Oracles** (`oracles.ts`) | Zero-LLM checks that compare meaning, not pixels: value vs truth within a tolerance, freshness vs a live baseline, reachability (inside the viewport, not covered via `elementFromPoint`, enabled), cross-panel consistency, a whole-page control audit, and an XSS scan. Elements are located by test id, then role, then visible text, and the fallback used is recorded. |
| **Invariant suite K1–K7** | Seven checks that pass on the unmodified kit and must fail when a bug is present: the blind detector (table below). It never reads the answer keys. |
| **Blind scorer** (`mutants.ts`) | Applies each mutation, runs K1–K7 with a recording, reverts, and only then compares the failing checks with the answer key: caught / missed / false alarm. |
| **Real-bug scenarios** (`scenarios/s1…s4`) | Workflow scenarios with fault injection and device sizes that found four defects in the original kit. |
| **Evidence HUD** (`overlay.ts`) | Injected into the page for every recording: scenario, brief line, starting state, steps ticking off, the API calls, a live truth-vs-UI table, red boxes on failing elements, verdict banner. Closed shadow root with `pointer-events:none`, so it never affects a check. |

| Check | Holds on the unmodified kit |
|---|---|
| K1 Presence | Connection badge, every device row, status pill, all 9 telemetry values (with numbers), map, video tile and both map-view toggles are displayed; every control reachable in the clean build still is. |
| K2 Values | Battery, altitude, H-speed, distance from home and heading match the latest telemetry frame for the selected drone. |
| K3 Cross-panel | Device-list pill, telemetry status pill and backend agree on the flight state. |
| K4 No false offline | While data is live, no stale/offline cue is on screen and the connection badge says connected. |
| K5 Link loss shown | Refusing the socket for 6 s produces a new stale/offline cue within 5 s that clears on recovery. |
| K6 Phone | At 390×844 every control reachable in the clean build at that size still is. |
| K7 Security | A drone name containing HTML is shown as text and runs no script. |

**Rule learned from the misses:** a check can only catch mutations if the original kit already passes it. Anything the kit already gets wrong (see scenarios 11–14) cannot be an invariant.

**Recording environment:** runs were recorded in real time in a cloud container that lacked two things the kit normally has: internet **map tiles** (the globe renders plain; no check depends on map pixels, since the map is a canvas and K1 only asserts the map container is present) and a **live video stream** (the video tile reads “off”; this is the reason for the video-liveness gap explained under Misses). Telemetry, socket, faults, responsive layout and security are fully exercised.

## 2. Scenarios

| # | Scenario | Category | Type | Detected by / verdict | Video |
|---|---|---|---|---|---|
| 1 | H-Speed wired to vertical speed: a cruising drone reads 0 m/s | Telemetry | agent mutation | caught by K2 | portal video (this submission's Video link), from 00:00 |
| 2 | Drone name rendered as raw HTML: a name can run script in the cockpit | Security and permissions | agent mutation | caught by K7 | portal video (this submission's Video link), from 00:49 |
| 3 | Video tile removed: selecting a drone shows no video panel | Visual UI · Video and media | agent mutation | caught by K1 | portal video (this submission's Video link), from 01:35 |
| 4 | Connection badge stuck on “connected” while the link is down | Network and recovery | seed mutation | caught by K5 | portal video (this submission's Video link), from 02:21 |
| 5 | Live connection shown as “disconnected” | Visual UI | seed mutation | caught by K4 | portal video (this submission's Video link), from 03:07 |
| 6 | Battery shown 10 % lower than the drone reports | Telemetry | seed mutation | caught by K2 | portal video (this submission's Video link), from 03:54 |
| 7 | Telemetry panel shows another drone's data | Telemetry | seed mutation | caught by K2 + K3 | portal video (this submission's Video link), from 04:44 |
| 8 | Flying drone's status pill says “standby” | Visual UI | seed mutation | caught by K3 | portal video (this submission's Video link), from 05:43 |
| 9 | Connection indicator removed from the cockpit | Visual UI · Network and recovery | seed mutation | caught by K1 + K5 | portal video (this submission's Video link), from 06:32 |
| 10 | Device list pushed off-screen on phones | Responsive UI | seed mutation | caught by K6 | portal video (this submission's Video link), from 07:18 |
| 11 | Stale telemetry shown as live when the simulator link drops | Telemetry · Network and recovery | real bug in the original kit | BUG | portal video (this submission's Video link), from 08:08 |
| 12 | Out-of-order telemetry rendered as current: drone jumps backwards | Telemetry · Network and recovery | real bug in the original kit | BUG | portal video (this submission's Video link), from 08:53 |
| 13 | Map 2D/3D view toggle is covered by the video tile on phones | Responsive UI | real bug in the original kit | BUG | portal video (this submission's Video link), from 09:48 |
| 14 | Selecting a drone on a phone does not show its telemetry | Responsive UI | real bug in the original kit | BUG | portal video (this submission's Video link), from 10:23 |
| — | Live video shown as “off” | Video and media | agent mutation | missed (see Misses) | [recording in the repository](https://github.com/Tanmay-Ts/Tireless/blob/claude/flytbase-testing-harness-iwr6ar/submission/videos/K-gen-01-video-live-shown-off.mp4) |
| — | Phone side panel made unscrollable | Responsive UI | agent mutation | missed (see Misses) | [recording in the repository](https://github.com/Tanmay-Ts/Tireless/blob/claude/flytbase-testing-harness-iwr6ar/submission/videos/K-gen-04-left-panel-clipped-phone.mp4) |

### 1. H-Speed wired to vertical speed: a cruising drone reads 0 m/s

**Category:** Telemetry · **Injected by:** mutation agent (separate Claude subagent) · **Detected by:** K2

**Description.** What is tested: whether the cockpit notices this change. **Broken:** The mutation agent rewired the H-Speed readout in `TelemetryPanel.tsx` to the vertical-speed field. **Expected by the operator:** An operator watching Drone 1 cruise at 10 m/s expects H-Speed to read about 10 m/s. **Why it matters:** Speed is how the operator predicts where the drone will be next; a drone that looks stationary while it flies away is an operational hazard.

> Product brief: “Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together”

**Starting state.** Faults cleared · simulator reset (every drone standby on its dock at 100 %) · started at 1× · SIM_SEED 42 · cockpit at 1440×900 (K6 at 390×844) · Drone 1 selected and taken off · mutation `qa/mutants/generated/gen-02-hspeed-wrong-source.patch` applied to the kit.

**Steps.**
1. With the kit running and `KIT_DIR` set in `qa/.env`, run `cd qa` then `npm run mutants -- gen-02`. The runner applies `qa/mutants/generated/gen-02-hspeed-wrong-source.patch` with `git apply`, runs the checks with a recording, then reverts it (`git apply -R`).
2. Clean start: `DELETE /api/control/fault`, `POST /api/control/sim {"action":"reset"}`, `POST /api/control/sim {"action":"start","speed":1}`.
3. Open the cockpit, click Drone 1 in the device list, `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}`, wait for `in_flight`.
4. Run K1–K7 in order (K5 refuses the socket for 6 s; K6 re-opens the cockpit at 390×844; K7 adds and later removes an HTML-named drone).

**Approach.** K2 (values) compares battery, altitude, H-speed, distance from home and heading on screen with the latest telemetry frame our own socket client received for the same drone (tolerances ±1.5 %, ±2 m, ±1 m/s, ±12 m, ±3°); a field fails when 2 of 3 samples are off. The checks never read the mutation's answer key; it is compared only after the run.

**Result.** K2 failed: H-Speed 0.0 m/s vs 10.0. K1, K3, K4, K5, K6, K7 passed.

**Video:** portal video (this submission's Video link), from 00:00

---

### 2. Drone name rendered as raw HTML: a name can run script in the cockpit

**Category:** Security and permissions · **Injected by:** mutation agent (separate Claude subagent) · **Detected by:** K7

**Description.** What is tested: whether the cockpit notices this change. **Broken:** The drone name in the device list (`DeviceList.tsx`) is rendered with `dangerouslySetInnerHTML` instead of as text. **Expected by the operator:** A drone name is displayed exactly as typed, whatever characters it contains, and never executes. **Why it matters:** Anyone who can name a drone can run script in every operator's cockpit (stored XSS) and act with the operator's session.

The same bug was produced independently by the mutation agent (gen-03) and by the hand-written seed set (m8, `qa/mutants/m8-xss-drone-name.patch`); it is counted once. Both runs were caught by K7.

> Level 1: “Static UI and basic security testing” · What should be tested: **Security and permissions**

**Starting state.** Faults cleared · simulator reset (every drone standby on its dock at 100 %) · started at 1× · SIM_SEED 42 · cockpit at 1440×900 (K6 at 390×844) · Drone 1 selected and taken off · mutation `qa/mutants/generated/gen-03-device-name-raw-html.patch` applied to the kit.

**Steps.**
1. With the kit running and `KIT_DIR` set in `qa/.env`, run `cd qa` then `npm run mutants -- gen-03`. The runner applies `qa/mutants/generated/gen-03-device-name-raw-html.patch` with `git apply`, runs the checks with a recording, then reverts it (`git apply -R`).
2. Clean start: `DELETE /api/control/fault`, `POST /api/control/sim {"action":"reset"}`, `POST /api/control/sim {"action":"start","speed":1}`.
3. Open the cockpit, click Drone 1 in the device list, `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}`, wait for `in_flight`.
4. Run K1–K7 in order (K5 refuses the socket for 6 s; K6 re-opens the cockpit at 390×844; K7 adds and later removes an HTML-named drone).

**Approach.** K7 (security) adds a drone named `<img src=x onerror=…><i data-xss>MARKER</i>` through `POST /api/control/drones` and requires the cockpit to show it as text: no `onerror` execution, no dialog, no injected element. The checks never read the mutation's answer key; it is compared only after the run.

**Result.** K7 failed: HTML in name executed: onerror ran 1×, injected <img> element, injected element from name. K1, K2, K3, K4, K5, K6 passed. Seed m8 run: caught by K7.

**Video:** portal video (this submission's Video link), from 00:49 · seed m8 run: [recording in the repository](https://github.com/Tanmay-Ts/Tireless/blob/claude/flytbase-testing-harness-iwr6ar/submission/videos/K-m8-xss-drone-name.mp4)

---

### 3. Video tile removed: selecting a drone shows no video panel

**Category:** Visual UI · Video and media · **Injected by:** mutation agent (separate Claude subagent) · **Detected by:** K1

**Description.** What is tested: whether the cockpit notices this change. **Broken:** The mutation agent removed `<VideoTile />` from `CockpitPage.tsx`. **Expected by the operator:** Selecting a drone shows its video tile (feed and its state) next to the telemetry. **Why it matters:** The operator loses the drone's camera view and any indication of whether video is available.

> Product brief: “Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together”

**Starting state.** Faults cleared · simulator reset (every drone standby on its dock at 100 %) · started at 1× · SIM_SEED 42 · cockpit at 1440×900 (K6 at 390×844) · Drone 1 selected and taken off · mutation `qa/mutants/generated/gen-05-video-tile-removed.patch` applied to the kit.

**Steps.**
1. With the kit running and `KIT_DIR` set in `qa/.env`, run `cd qa` then `npm run mutants -- gen-05`. The runner applies `qa/mutants/generated/gen-05-video-tile-removed.patch` with `git apply`, runs the checks with a recording, then reverts it (`git apply -R`).
2. Clean start: `DELETE /api/control/fault`, `POST /api/control/sim {"action":"reset"}`, `POST /api/control/sim {"action":"start","speed":1}`.
3. Open the cockpit, click Drone 1 in the device list, `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}`, wait for `in_flight`.
4. Run K1–K7 in order (K5 refuses the socket for 6 s; K6 re-opens the cockpit at 390×844; K7 adds and later removes an HTML-named drone).

**Approach.** K1 (presence) probes every element the brief needs — connection badge, device rows, status pill, the nine telemetry values (with numbers), map, video tile, map toggles — for real visibility (inside the viewport, not covered: `elementFromPoint` hits the element), and diffs every interactive control against the saved clean-build baseline. The checks never read the mutation's answer key; it is compared only after the run.

**Result.** K1 failed: video tile: not found by testid, role or text. K2, K3, K4, K5, K6, K7 passed.

**Video:** portal video (this submission's Video link), from 01:35

---

### 4. Connection badge stuck on “connected” while the link is down

**Category:** Network and recovery · **Injected by:** seed set (written during development) · **Detected by:** K5

**Description.** What is tested: whether the cockpit notices this change. **Broken:** The connection badge (`SocketBadge.tsx`) always renders “socket connected” in the connected colour, whatever the real socket state. **Expected by the operator:** When the telemetry link drops, the badge changes (reconnecting / disconnected) so the operator knows the numbers have stopped updating. **Why it matters:** Operators would act on frozen data believing it is live.

> Product brief: “makes clear whether information is live, delayed, stale, disconnected or unavailable”

**Starting state.** Faults cleared · simulator reset (every drone standby on its dock at 100 %) · started at 1× · SIM_SEED 42 · cockpit at 1440×900 (K6 at 390×844) · Drone 1 selected and taken off · mutation `qa/mutants/m1-badge-always-connected.patch` applied to the kit.

**Steps.**
1. With the kit running and `KIT_DIR` set in `qa/.env`, run `cd qa` then `npm run mutants -- m1`. The runner applies `qa/mutants/m1-badge-always-connected.patch` with `git apply`, runs the checks with a recording, then reverts it (`git apply -R`).
2. Clean start: `DELETE /api/control/fault`, `POST /api/control/sim {"action":"reset"}`, `POST /api/control/sim {"action":"start","speed":1}`.
3. Open the cockpit, click Drone 1 in the device list, `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}`, wait for `in_flight`.
4. Run K1–K7 in order (K5 refuses the socket for 6 s; K6 re-opens the cockpit at 390×844; K7 adds and later removes an HTML-named drone).

**Approach.** K5 (link loss shown) refuses the cockpit socket for 6 s (`POST /api/control/fault {"kind":"socket-refuse","seconds":6}`) and requires a new stale/offline cue within 5 s that clears after recovery. The checks never read the mutation's answer key; it is compared only after the run.

**Result.** K5 failed: link refused 6 s: no stale/offline cue at all. K1, K2, K3, K4, K6, K7 passed.

**Video:** portal video (this submission's Video link), from 02:21

---

### 5. Live connection shown as “disconnected”

**Category:** Visual UI · **Injected by:** seed set (written during development) · **Detected by:** K4

**Description.** What is tested: whether the cockpit notices this change. **Broken:** The connection badge shows “socket disconnected” while the socket is actually connected. **Expected by the operator:** While telemetry is flowing, the cockpit says the link is live. **Why it matters:** A false offline indication makes operators distrust correct data or abort a working mission.

> Product brief: “makes clear whether information is live, delayed, stale, disconnected or unavailable”

**Starting state.** Faults cleared · simulator reset (every drone standby on its dock at 100 %) · started at 1× · SIM_SEED 42 · cockpit at 1440×900 (K6 at 390×844) · Drone 1 selected and taken off · mutation `qa/mutants/m2-online-shown-offline.patch` applied to the kit.

**Steps.**
1. With the kit running and `KIT_DIR` set in `qa/.env`, run `cd qa` then `npm run mutants -- m2`. The runner applies `qa/mutants/m2-online-shown-offline.patch` with `git apply`, runs the checks with a recording, then reverts it (`git apply -R`).
2. Clean start: `DELETE /api/control/fault`, `POST /api/control/sim {"action":"reset"}`, `POST /api/control/sim {"action":"start","speed":1}`.
3. Open the cockpit, click Drone 1 in the device list, `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}`, wait for `in_flight`.
4. Run K1–K7 in order (K5 refuses the socket for 6 s; K6 re-opens the cockpit at 390×844; K7 adds and later removes an HTML-named drone).

**Approach.** K4 (no false offline) requires that, while our socket confirms telemetry is live, there is no stale/offline wording, marker or dimming anywhere on screen and the connection badge says connected. The checks never read the mutation's answer key; it is compared only after the run.

**Result.** K4 failed: cue "socket disconnected" · cue "class badge-disconnected" · badge says "socket disconnected" while live. K1, K2, K3, K5, K6, K7 passed.

**Video:** portal video (this submission's Video link), from 03:07

---

### 6. Battery shown 10 % lower than the drone reports

**Category:** Telemetry · **Injected by:** seed set (written during development) · **Detected by:** K2

**Description.** What is tested: whether the cockpit notices this change. **Broken:** `TelemetryPanel.tsx` subtracts 10 from the battery percentage before display. **Expected by the operator:** The battery on screen matches what the drone reports. **Why it matters:** Battery decides when to bring a drone home; a wrong value causes needless returns, or with the opposite error, a stranded drone.

> Product brief: “Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together”

**Starting state.** Faults cleared · simulator reset (every drone standby on its dock at 100 %) · started at 1× · SIM_SEED 42 · cockpit at 1440×900 (K6 at 390×844) · Drone 1 selected and taken off · mutation `qa/mutants/m3-battery-off-by-10.patch` applied to the kit.

**Steps.**
1. With the kit running and `KIT_DIR` set in `qa/.env`, run `cd qa` then `npm run mutants -- m3`. The runner applies `qa/mutants/m3-battery-off-by-10.patch` with `git apply`, runs the checks with a recording, then reverts it (`git apply -R`).
2. Clean start: `DELETE /api/control/fault`, `POST /api/control/sim {"action":"reset"}`, `POST /api/control/sim {"action":"start","speed":1}`.
3. Open the cockpit, click Drone 1 in the device list, `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}`, wait for `in_flight`.
4. Run K1–K7 in order (K5 refuses the socket for 6 s; K6 re-opens the cockpit at 390×844; K7 adds and later removes an HTML-named drone).

**Approach.** K2 (values) compares battery, altitude, H-speed, distance from home and heading on screen with the latest telemetry frame our own socket client received for the same drone (tolerances ±1.5 %, ±2 m, ±1 m/s, ±12 m, ±3°); a field fails when 2 of 3 samples are off. The checks never read the mutation's answer key; it is compared only after the run.

**Result.** K2 failed: Battery 89 % vs 98.5. K1, K3, K4, K5, K6, K7 passed.

**Video:** portal video (this submission's Video link), from 03:54

---

### 7. Telemetry panel shows another drone's data

**Category:** Telemetry · **Injected by:** seed set (written during development) · **Detected by:** K2 + K3

**Description.** What is tested: whether the cockpit notices this change. **Broken:** `TelemetryPanel.tsx` reads the data of drone N+1 for the selected drone N. **Expected by the operator:** Selecting Drone 1 shows Drone 1's altitude, speed and status. **Why it matters:** Decisions are made about the wrong aircraft: the brief's “data belongs to the wrong source” failure.

> Product brief: “Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together”

**Starting state.** Faults cleared · simulator reset (every drone standby on its dock at 100 %) · started at 1× · SIM_SEED 42 · cockpit at 1440×900 (K6 at 390×844) · Drone 1 selected and taken off · mutation `qa/mutants/m4-wrong-drone-telemetry.patch` applied to the kit.

**Steps.**
1. With the kit running and `KIT_DIR` set in `qa/.env`, run `cd qa` then `npm run mutants -- m4`. The runner applies `qa/mutants/m4-wrong-drone-telemetry.patch` with `git apply`, runs the checks with a recording, then reverts it (`git apply -R`).
2. Clean start: `DELETE /api/control/fault`, `POST /api/control/sim {"action":"reset"}`, `POST /api/control/sim {"action":"start","speed":1}`.
3. Open the cockpit, click Drone 1 in the device list, `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}`, wait for `in_flight`.
4. Run K1–K7 in order (K5 refuses the socket for 6 s; K6 re-opens the cockpit at 390×844; K7 adds and later removes an HTML-named drone).

**Approach.** K2 (values) compares battery, altitude, H-speed, distance from home and heading on screen with the latest telemetry frame our own socket client received for the same drone (tolerances ±1.5 %, ±2 m, ±1 m/s, ±12 m, ±3°); a field fails when 2 of 3 samples are off. K3 (cross-panel) classifies the flight state shown by the device-list pill, the telemetry status pill and the backend (`/api/control/state`) and requires all three to agree. The checks never read the mutation's answer key; it is compared only after the run.

**Result.** K2 failed: Altitude RLT 0.0 m vs 30.0 · H-Speed 0.0 m/s vs 10.0 · Dist. from home 0 m vs 55.0 · Heading 134 ° vs 47.0. K3 failed: device list airborne / status pill grounded / backend airborne. K1, K4, K5, K6, K7 passed.

**Video:** portal video (this submission's Video link), from 04:44

---

### 8. Flying drone's status pill says “standby”

**Category:** Visual UI · **Injected by:** seed set (written during development) · **Detected by:** K3

**Description.** What is tested: whether the cockpit notices this change. **Broken:** The telemetry status pill shows “standby” whenever the drone is `in_flight`. **Expected by the operator:** The status pill, the device list and the drone's real state agree. **Why it matters:** Conflicting statuses: an operator could treat an airborne drone as parked on its dock.

> Product brief: “Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together”

**Starting state.** Faults cleared · simulator reset (every drone standby on its dock at 100 %) · started at 1× · SIM_SEED 42 · cockpit at 1440×900 (K6 at 390×844) · Drone 1 selected and taken off · mutation `qa/mutants/m5-flying-shown-as-landed.patch` applied to the kit.

**Steps.**
1. With the kit running and `KIT_DIR` set in `qa/.env`, run `cd qa` then `npm run mutants -- m5`. The runner applies `qa/mutants/m5-flying-shown-as-landed.patch` with `git apply`, runs the checks with a recording, then reverts it (`git apply -R`).
2. Clean start: `DELETE /api/control/fault`, `POST /api/control/sim {"action":"reset"}`, `POST /api/control/sim {"action":"start","speed":1}`.
3. Open the cockpit, click Drone 1 in the device list, `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}`, wait for `in_flight`.
4. Run K1–K7 in order (K5 refuses the socket for 6 s; K6 re-opens the cockpit at 390×844; K7 adds and later removes an HTML-named drone).

**Approach.** K3 (cross-panel) classifies the flight state shown by the device-list pill, the telemetry status pill and the backend (`/api/control/state`) and requires all three to agree. The checks never read the mutation's answer key; it is compared only after the run.

**Result.** K3 failed: device list airborne / status pill grounded / backend airborne. K1, K2, K4, K5, K6, K7 passed.

**Video:** portal video (this submission's Video link), from 05:43

---

### 9. Connection indicator removed from the cockpit

**Category:** Visual UI · Network and recovery · **Injected by:** seed set (written during development) · **Detected by:** K1 + K5

**Description.** What is tested: whether the cockpit notices this change. **Broken:** `<SocketBadge />` is deleted from `CockpitPage.tsx`. **Expected by the operator:** A visible connection indicator that changes when the link drops. **Why it matters:** Without it the cockpit cannot say whether data is live, so link loss becomes invisible.

> Product brief: “makes clear whether information is live, delayed, stale, disconnected or unavailable”

**Starting state.** Faults cleared · simulator reset (every drone standby on its dock at 100 %) · started at 1× · SIM_SEED 42 · cockpit at 1440×900 (K6 at 390×844) · Drone 1 selected and taken off · mutation `qa/mutants/m6-connection-badge-removed.patch` applied to the kit.

**Steps.**
1. With the kit running and `KIT_DIR` set in `qa/.env`, run `cd qa` then `npm run mutants -- m6`. The runner applies `qa/mutants/m6-connection-badge-removed.patch` with `git apply`, runs the checks with a recording, then reverts it (`git apply -R`).
2. Clean start: `DELETE /api/control/fault`, `POST /api/control/sim {"action":"reset"}`, `POST /api/control/sim {"action":"start","speed":1}`.
3. Open the cockpit, click Drone 1 in the device list, `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}`, wait for `in_flight`.
4. Run K1–K7 in order (K5 refuses the socket for 6 s; K6 re-opens the cockpit at 390×844; K7 adds and later removes an HTML-named drone).

**Approach.** K1 (presence) probes every element the brief needs — connection badge, device rows, status pill, the nine telemetry values (with numbers), map, video tile, map toggles — for real visibility (inside the viewport, not covered: `elementFromPoint` hits the element), and diffs every interactive control against the saved clean-build baseline. K5 (link loss shown) refuses the cockpit socket for 6 s (`POST /api/control/fault {"kind":"socket-refuse","seconds":6}`) and requires a new stale/offline cue within 5 s that clears after recovery. The checks never read the mutation's answer key; it is compared only after the run.

**Result.** K1 failed: socket badge: not found by testid, role or text. K5 failed: link refused 6 s: no stale/offline cue at all. K2, K3, K4, K6, K7 passed.

**Video:** portal video (this submission's Video link), from 06:32

---

### 10. Device list pushed off-screen on phones

**Category:** Responsive UI · **Injected by:** seed set (written during development) · **Detected by:** K6

**Description.** What is tested: whether the cockpit notices this change. **Broken:** `styles.css` moves the side panel off-screen below 800 px (`translateX(-110vw)`). **Expected by the operator:** On a phone the operator can still see the drones and tap one to select it. **Why it matters:** Selecting a drone, the cockpit's main action, becomes impossible on phones.

> Product brief: “Works in modern browsers on phones, tablets, laptops and desktops”

**Starting state.** Faults cleared · simulator reset (every drone standby on its dock at 100 %) · started at 1× · SIM_SEED 42 · cockpit at 1440×900 (K6 at 390×844) · Drone 1 selected and taken off · mutation `qa/mutants/m7-device-list-offscreen-phone.patch` applied to the kit.

**Steps.**
1. With the kit running and `KIT_DIR` set in `qa/.env`, run `cd qa` then `npm run mutants -- m7`. The runner applies `qa/mutants/m7-device-list-offscreen-phone.patch` with `git apply`, runs the checks with a recording, then reverts it (`git apply -R`).
2. Clean start: `DELETE /api/control/fault`, `POST /api/control/sim {"action":"reset"}`, `POST /api/control/sim {"action":"start","speed":1}`.
3. Open the cockpit, click Drone 1 in the device list, `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}`, wait for `in_flight`.
4. Run K1–K7 in order (K5 refuses the socket for 6 s; K6 re-opens the cockpit at 390×844; K7 adds and later removes an HTML-named drone).

**Approach.** K6 (phone) re-opens the cockpit at 390×844 (iPhone 13) and requires every control that is reachable in the clean build at that size to still be visible and tappable, scrolling allowed. The checks never read the mutation's answer key; it is compared only after the run.

**Result.** K6 failed: Drone 1 Dock 1 dock open in_flight: outside the viewport; after scrolling: still not visible (+3). K1, K2, K3, K4, K5, K7 passed.

**Video:** portal video (this submission's Video link), from 07:18

---

### 11. Stale telemetry shown as live when the simulator link drops

**Category:** Telemetry · Network and recovery · **Found in:** the original, unmutated kit · **Verdict:** BUG: telemetry 12.6 s old, still shown as live

**Description.** An operator watching a drone in flight must be able to tell when the telemetry on screen stops being live. We cut the simulator→backend link (sim-offline) while Drone 1 is in flight. The expected behaviour, per the brief, is that within a few seconds the cockpit shows the data as stale/disconnected (wording, age, greyed values, or an offline status) instead of continuing to present the last values as current.

> Product brief: “makes clear whether information is live, delayed, stale, disconnected or unavailable”

**Starting state.** faults cleared · sim reset (all drones standby at 100 %) · started 1× · SIM_SEED 42 · 1440×900 · drone-1 selected.

**Steps** (run with `cd qa` then `npm run scenario -- S1`; every step is shown on the video's HUD):
1. Clean start: clear faults, reset, start sim
2. Open cockpit, select Drone 1 (row found via testid)
3. Take off Drone 1, wait for in_flight
4. Control: UI = truth and no stale cue while live (all fields within tolerance, no stale cue)
5. Inject sim-offline (30 s window) (/api/health → simulator: disconnected (0.0 s after POST))
6. Grace 5 s: UI may flag staleness (no cue yet)
7. Observe: does the UI say data is stale? (no stale cue in 8/8 samples)

**API calls made** (seconds from start):

| t | call | status |
|---|---|---|
| +0.1 s | `DELETE /api/control/fault` | 200 |
| +0.2 s | `POST /api/control/sim {"action":"reset"}` | 200 |
| +0.2 s | `POST /api/control/sim {"action":"start","speed":1}` | 200 |
| +4.8 s | `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}` | 200 |
| +21.2 s | `POST /api/control/fault {"kind":"sim-offline","seconds":30}` | 200 |
| +44.5 s | `DELETE /api/control/fault` | 200 |

**Approach.** Deterministic Playwright run, zero LLM calls. Ground truth comes from the backend (/api/health simulator link), our own socket.io client (frame age for drone-1), and /api/control/state polled straight from the simulator (the drone keeps flying). While live, the harness checks the UI matches truth (battery, altitude, speed, distance, status) and records every freshness cue on screen as a baseline. After the fault and a 5 s grace (the cockpit's own heartbeat threshold), it samples the page every second and looks for any NEW cue that data is stale: stale/offline/disconnected/"N s ago" wording, data-state/aria/class markers, dashed-out or dimmed telemetry. Wording is matched by meaning. It also cross-checks the UI against itself (claimed speed vs unchanged distance) and against the simulator (real distance keeps growing). BUG only if every judged sample shows no cue; a precondition that fails (fault not active) is SETUP-FAILED, not a bug.

**Result.** Simulator disconnected, no data for 12.6 s; cockpit still says "socket connected", "in_flight", 10.0 m/s, distance 65 m (real 185 m). No stale/offline cue in 8/8 samples after a 5 s grace.

| t after fault | truth: last frame | truth: simulator | UI badge | UI status | UI H-speed | UI dist. | real dist. | new stale cue |
|---|---|---|---|---|---|---|---|---|
| 5.2 s | 5.6 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 115 m | none |
| 6.2 s | 6.6 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 125 m | none |
| 7.2 s | 7.6 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 135 m | none |
| 8.2 s | 8.6 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 145 m | none |
| 9.2 s | 9.6 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 155 m | none |
| 10.2 s | 10.6 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 165 m | none |
| 11.2 s | 11.6 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 175 m | none |
| 12.2 s | 12.6 s ago | disconnected | socket connected | in_flight | 10.0 m/s | 65 m | 185 m | none |

**Video:** portal video (this submission's Video link), from 08:08

---

### 12. Out-of-order telemetry rendered as current: drone jumps backwards

**Category:** Telemetry · Network and recovery · **Found in:** the original, unmutated kit · **Verdict:** BUG: UI rendered older telemetry over newer: 5 backward jumps

**Description.** Networks deliver telemetry late and occasionally out of order. When a newer position has already been shown, an older one must not replace it: the operator would see the drone jump backwards and read a wrong position, distance and track. We delay the telemetry path by 3 s with jitter (the kit's socket-delay fault) while Drone 1 flies a straight line away from its dock, so its true distance from home only increases. Expected: the cockpit keeps showing the newest data (discarding late, older frames) and makes clear the data is delayed.

> Product brief: “makes clear whether information is live, delayed, stale, disconnected or unavailable”

**Starting state.** faults cleared · sim reset · started 1× · SIM_SEED 42 · 1440×900 · drone-1 selected, flying straight out.

**Steps** (run with `cd qa` then `npm run scenario -- S2`; every step is shown on the video's HUD):
1. Clean start: clear faults, reset, start sim
2. Open cockpit, select Drone 1 (row found via testid)
3. Take off Drone 1, wait for in_flight
4. Control 5 s: distance only grows (no fault) (12 updates, 0 backward jumps)
5. Inject socket-delay 3000 ms (+≤50 % jitter) (GET /api/control/fault lists socket-delay)
6. Record every UI update for 22 s
7. Match each backward jump to a late frame (5/5 jumps caused by late frames)

**API calls made** (seconds from start):

| t | call | status |
|---|---|---|
| +0.1 s | `DELETE /api/control/fault` | 200 |
| +0.1 s | `POST /api/control/sim {"action":"reset"}` | 200 |
| +0.1 s | `POST /api/control/sim {"action":"start","speed":1}` | 200 |
| +4.7 s | `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}` | 200 |
| +22.3 s | `POST /api/control/fault {"kind":"socket-delay","value":3000}` | 200 |
| +56.2 s | `DELETE /api/control/fault` | 200 |

**Approach.** Deterministic Playwright run, zero LLM calls. A MutationObserver in the page records every value "Dist. from home" displays, with wall-clock time. Our own socket.io client subscribes to the same topics and receives the same frames in the same order as the cockpit, each with the simulator timestamp. Control first: 5 s without the fault, the displayed distance must never decrease. Then socket-delay 3000 ms for 22 s. Every backward step in the UI larger than 2 m is matched to the frame that caused it (same value, arrived within 600 ms) and counts only if that frame's timestamp is older than a frame already delivered. BUG requires at least 2 such matched jumps; if the network produced fewer than 2 out-of-order frames the run is SETUP-FAILED, not PASS.

**Result.** With 3000 ms delay + jitter, 7/37 position frames arrived out of order. The cockpit displayed them anyway: distance-from-home went backwards 5× (e.g. 120 → 115 m) while the drone flew straight away from its dock. No "delayed" cue while data was 3.1–4.5 s old.

| t after delay on | UI showed | then UI showed | cause (our socket) |
|---|---|---|---|
| 8.1 s | 120 m | 115 m | frame 500 ms older than one already delivered |
| 10.2 s | 145 m | 135 m | frame 1000 ms older than one already delivered |
| 11.1 s | 155 m | 150 m | frame 501 ms older than one already delivered |
| 16.0 s | 205 m | 195 m | frame 1001 ms older than one already delivered |
| 19.4 s | 240 m | 230 m | frame 1002 ms older than one already delivered |

**Video:** portal video (this submission's Video link), from 08:53

---

### 13. Map 2D/3D view toggle is covered by the video tile on phones

**Category:** Responsive UI · **Found in:** the original, unmutated kit · **Verdict:** BUG: 2D/3D toggle unusable at 320–412 px

**Description.** The operator switches the map between 3D and 2D with the 2D/3D toggle at the bottom of the map. The product must work on phones, tablets, laptops and desktops. We open the cockpit at a laptop size and at six tablet/phone sizes and check that every control usable on the laptop can still be seen and pressed. Expected: the map view toggle is visible and pressable at every size.

> Product brief: “Works in modern browsers on phones, tablets, laptops and desktops”

**Starting state.** faults cleared · sim reset · started 1× · SIM_SEED 42 · cockpit in a device frame: laptop 1366×768 → 768 → 412 → 390 → 360 → 320 → 375 px.

**Steps** (run with `cd qa` then `npm run scenario -- S3`; every step is shown on the video's HUD):
1. Clean start: clear faults, reset, start sim
2. Laptop 1366×768: audit every control (baseline) (7 usable controls on the laptop)
3. Laptop control: tap "2D", map switches (aria-pressed="true" after tap, then back to 3D)
4. Resize through 6 tablet/phone sizes, audit every control
5. iPhone SE: operator taps "2D" (aria-pressed false → false · Playwright: <div data-state="off" class="video-placeholder" data-testid=)
6. Cross-check in emulated iPhone SE (touch, DPR 2) (emulated iPhone SE: covered by div[data-testid=video-player].video-placeholder)

**API calls made** (seconds from start):

| t | call | status |
|---|---|---|
| +0.1 s | `DELETE /api/control/fault` | 200 |
| +0.1 s | `POST /api/control/sim {"action":"reset"}` | 200 |
| +0.1 s | `POST /api/control/sim {"action":"start","speed":1}` | 200 |
| +34.9 s | `DELETE /api/control/fault` | 200 |

**Approach.** Deterministic Playwright run, zero LLM calls. The cockpit runs in a device frame (an iframe whose CSS viewport is exactly the device size, so the app's own media queries apply) next to the evidence panel. At each size the harness audits every button, link and device row: displayed, inside the viewport or reachable by scrolling, and not covered: document.elementFromPoint() at the control's visible centre must return the control itself. The laptop result is the baseline; anything usable there and unusable elsewhere is flagged, which also catches controls pushed off-screen or hidden by a mutation. The failing control is then tapped like a user (real pointer) and the effect checked through its aria-pressed state, Playwright's own actionability check is recorded, and the result is re-checked in a real iPhone SE emulation context (touch, DPR 2, mobile UA).

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

**Video:** portal video (this submission's Video link), from 09:48

---

### 14. Selecting a drone on a phone does not show its telemetry

**Category:** Responsive UI · **Found in:** the original, unmutated kit · **Verdict:** BUG: phone: selecting a drone shows 0/9 telemetry values

**Description.** An operator selects a drone to see how it is doing: status, battery, altitude, speed, distance, next to the map and video. The brief says selecting a drone shows these together, and that the product works on phones. On a laptop this holds. We repeat the same action on phone-sized screens while Drone 1 is flying. Expected: after tapping the drone, its status and key telemetry (battery, altitude, speed) are visible without hunting for them.

> Product brief: “Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together”

**Starting state.** faults cleared · sim reset · started 1× · SIM_SEED 42 · Drone 1 taking off (live data) · cockpit in a device frame: laptop 1366×768, then iPhone SE 375×667.

**Steps** (run with `cd qa` then `npm run scenario -- S4`; every step is shown on the video's HUD):
1. Clean start, take off Drone 1 (live values)
2. Laptop: select Drone 1, all shown together (control) (status + 9/9 telemetry + map + video visible together)
3. iPhone SE: operator taps Drone 1
4. What is visible right after selecting? (0/9 telemetry visible · status pill hidden (0 % in view) · clipped by aside.cockpit-left (375×220 px))
5. Operator scrolls the side panel to find telemetry (9 wheel steps · at most 7/9 values at once)
6. What is visible together after scrolling?
7. Cross-check: iPhone 13, Pixel 7, emulated iPhone SE

**API calls made** (seconds from start):

| t | call | status |
|---|---|---|
| +0.1 s | `DELETE /api/control/fault` | 200 |
| +0.1 s | `POST /api/control/sim {"action":"reset"}` | 200 |
| +0.1 s | `POST /api/control/sim {"action":"start","speed":1}` | 200 |
| +0.3 s | `POST /api/control/command {"deviceId":"drone-1","type":"takeoff"}` | 200 |
| +32 s | `DELETE /api/control/fault` | 200 |

**Approach.** Deterministic Playwright run, zero LLM calls. The cockpit runs in a device frame (iframe with the exact device viewport, so the app's media queries apply). After the select action the harness probes the selected row, status pill, all 9 telemetry values, the map and the video: an item counts as visible only if it is inside the viewport, at least 60 % unclipped by any scroll container, and document.elementFromPoint() at its visible centre returns the item itself. Laptop first as the control (everything visible together), then iPhone SE. The operator is then allowed to scroll the side panel with the mouse wheel and visibility is measured again, to state precisely what a phone user can see at once. Repeated on iPhone 13 and Pixel 7, and re-checked in a real iPhone SE emulation context (touch, DPR 2).

**Result.** On iPhone SE, after tapping Drone 1 (in flight), its status, battery, altitude and speed are not on screen: they sit below a fixed-height side panel (aside.cockpit-left (375×220 px)) filled by the device list. Scrolling that panel shows at most 7/9 values at once and loses the selected row. Laptop: 9/9 together with map and video. Also on: iPhone 13, Pixel 7, emulated iPhone SE (touch, DPR 2).

| screen | right after selecting Drone 1 | after scrolling the side panel |
|---|---|---|
| Laptop 1366×768 (control) | status visible, 9/9 telemetry, map visible, video visible | not needed |
| iPhone SE 375×667 | status hidden (0 % in view), 0/9 telemetry, map visible, video visible | at most 7/9 at once; selected row scrolled out of view |
| iPhone 13 390×844 | 0/9 telemetry visible, status pill hidden (0 % in view) |  |
| Pixel 7 412×915 | 0/9 telemetry visible, status pill hidden (0 % in view) |  |
| emulated iPhone SE (touch, DPR 2) | 0/9 telemetry visible, status pill hidden (0 % in view) |  |

**Video:** portal video (this submission's Video link), from 10:23


## 3. Misses (not numbered)

The mutation agent produced 2 mutations that the suite did not flag. They are reported, not hidden.

**Live video shown as “off”** (Video and media, `qa/mutants/generated/gen-01-video-live-shown-off.patch`). The agent inverted the video-enabled test in `VideoTile.tsx`, so a live stream would display the “Video off” placeholder. In the kit's normal setup the cockpit shows a live FPV stream (organizers' setup guide: MediaMTX serves one WHEP feed per drone). The cloud recording environment had no video stream, so the clean cockpit already showed “off”, and the suite has no video-liveness check yet: “video is live” cannot be asserted as an invariant there. Next step: a video-liveness oracle that compares the tile's label with actual playback (`currentTime` advancing, `videoWidth` > 0, frame hashes changing), run on a machine with the live stream up. Video: [recording in the repository](https://github.com/Tanmay-Ts/Tireless/blob/claude/flytbase-testing-harness-iwr6ar/submission/videos/K-gen-01-video-live-shown-off.mp4)

**Phone side panel made unscrollable** (Responsive UI, `qa/mutants/generated/gen-04-left-panel-clipped-phone.patch`). The agent added `overflow: hidden` to the phone side panel, clipping the telemetry below its fold. The unmodified kit already hides telemetry on phones (real bug S4 below), so “telemetry visible on a phone” cannot be a clean-passing invariant. K6 checks that interactive controls stay reachable; all four device-row controls still fit at 390 px, so control reachability is genuinely unchanged. The mutation worsens a pre-existing defect instead of introducing a newly detectable one. Video: [recording in the repository](https://github.com/Tanmay-Ts/Tireless/blob/claude/flytbase-testing-harness-iwr6ar/submission/videos/K-gen-04-left-panel-clipped-phone.mp4)

## 4. Precision controls (not numbered)

The suite must not raise false alarms. Each control below was run with a recording.

- **Clean kit:** all seven checks pass on the unmodified kit (all 7 invariants hold). Video: portal video (this submission's Video link), from 12:18
- **Harmless: test ids renamed.** all 7 invariants hold: elements found through visible text and labels instead. Video: [recording in the repository](https://github.com/Tanmay-Ts/Tireless/blob/claude/flytbase-testing-harness-iwr6ar/submission/videos/K-h1-testids-renamed.mp4)
- **Harmless: wording changed** (“FlytBase Cockpit”→“FlytBase Operations”, “Devices”→“Fleet”, “socket …”→“link …”). all 7 invariants hold: meaning is compared, not text. Video: [recording in the repository](https://github.com/Tanmay-Ts/Tireless/blob/claude/flytbase-testing-harness-iwr6ar/submission/videos/K-h2-wording-change.mp4)
- **Land returns to the dock (intended, not flagged).** README says "down where it is"; backend (latest commit: return-to-dock landing) flew 70 m back and landed on the dock in 15.4 s. Cockpit followed it: in_flight → landing → standby, altitude/distance within tolerance in 100 % of 21 samples, final 0.0 m / 0 m. Video: portal video (this submission's Video link), from 10:55
- **Scenario 11 on a fixed cockpit.** The stale-data scenario re-run against a cockpit patched to flag stale data (`qa/mutants/control-fix-stale.patch`): PASS: UI flagged stale data after 4.1 s. Video: portal video (this submission's Video link), from 11:34
