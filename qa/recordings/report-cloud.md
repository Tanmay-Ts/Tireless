# Tireless Hand · Level 1 evaluation

_Generated 2026-09-26T10:51:24.708Z by `qa/report.ts`._

## 1. System design

Two agents and a deterministic oracle suite. The **mutation agent** injects realistic Level-1 bugs; the **QA agent** catches them blind. No LLM runs inside the test loop, so every judged run is deterministic and repeatable.

```
 mutation agent (qa/mutator.ts)                 QA system (deterministic, 0 LLM in the loop)
 reads cockpit source + product brief           driver.ts  -> clean start, takeoff/land, faults, add/remove drone
        |  proposes JSON search/replace          truth.ts   -> own socket.io client + REST polling = ground truth
        |  + answer key (category, file,          oracles.ts -> value-vs-truth, freshness, reachability,
        v   brief line, expected impact)                       cross-panel, control audit, XSS scan
 qa/mutants/generated/<id>.patch  - apply ->  cockpit ->  invariant suite K1-K7 (scenarios/k-invariants.ts)
 qa/mutants/generated/<id>.json (answer key)                 |  records video + trace, writes findings JSON
        |                                                     v
        +------------- compared ONLY after the run -->  mutants.ts: caught / missed / false alarm
```

| Part | What it does |
|---|---|
| **Mutation agent** (`mutator.ts`) | A separate LLM agent (OpenAI, or Gemini / NVIDIA NIM) reads the cockpit source and the brief and proposes realistic mutations as search/replace edits, each with an **answer key**: category, file, what it breaks, the brief line it violates, the expected user impact. Each edit is validated (search occurs exactly once, mutated file still parses) and saved to `mutants/generated/` so runs replay deterministically. |
| **Condition driver** (`driver.ts`) | Puts the cockpit in a known state through the control API: clear faults, reset (seed 42), start, takeoff/land, inject faults, add/remove a drone. |
| **Truth observer** (`truth.ts`) | Independent ground truth: our own socket.io client (same handshake and topics) records every telemetry frame with arrival time and timestamp; `/api/control/state` and `/api/health` are polled from the backend. |
| **Oracles** (`oracles.ts`) | Zero-LLM checks comparing meaning, not pixels: value vs truth within tolerance, freshness vs a live baseline, reachability (in viewport, not covered via `elementFromPoint`, enabled), cross-panel consistency, whole-page control audit, and an XSS scan. Locators go test id -> role -> visible text and report which was used. |
| **Invariant suite K1-K7** (`scenarios/k-invariants.ts`) | Seven checks that hold on the unmodified kit and must fail when a bug is present. This is the blind detector: it never reads the answer keys. |
| **Blind scorer** (`mutants.ts`) | Applies each mutation, runs K1-K7 with a recording, reverts, and only THEN compares the failing checks to the answer key: caught / missed / false alarm, plus whether the failing check matches the agent's predicted one. |
| **Evidence HUD** (`overlay.ts`) | Injected into the page: scenario, brief line, steps, the API calls, a live truth-vs-UI table, red boxes on failing elements, verdict banner. Closed shadow root, `pointer-events:none`, so it never affects a check. |
| **Reporter** (`report.ts`) | This document. |

**The invariant suite (K1-K7).** Each passes on the unmodified kit and is the net for injected bugs:

| Check | Holds on the unmodified kit |
|---|---|
| K1 Presence | Connection badge, every device row, status pill, all 9 telemetry values (with numbers), map, video tile and both map-view toggles are displayed; every control reachable in the clean build still is (semantic diff vs a saved clean baseline). |
| K2 Values | Battery, altitude, H-speed, distance-from-home and heading match the latest telemetry frame for the selected drone (within tolerance, 2 of 3 samples). |
| K3 Cross-panel | Device-list pill, telemetry status pill and the backend agree on the flight state. |
| K4 No false offline | While data is live, no stale/offline cue is on screen and the connection badge says connected. |
| K5 Link loss shown | `socket-refuse` for 6 s produces a new stale/offline cue within 5 s that clears on recovery. |
| K6 Phone | At 390 px every control reachable in the clean build at that size still is. |
| K7 Security | A device name containing HTML is shown as text and runs no script (no onerror, dialog or injected element). |

**Blind answer-key comparison.** The QA suite (K1-K7) imports no answer keys; it only sees the mutated cockpit. `mutants.ts` reads `mutants/generated/<id>.json` after each run to score it. "Caught" means K flagged the build as buggy at all; "attributed" means the check that fired is the one the agent predicted.

**Recording environment.** These runs were recorded in a cloud container that lacked two things the kit normally has: internet **map tiles** (the Cesium globe renders plain, which affects nothing the suite checks — the map is a canvas with no DOM, so K asserts only the map container's presence, not its pixels) and a **live video stream** (MediaMTX was not running, so the video tile reads "off"; this is why the video-liveness gap above exists). Everything else — telemetry, socket, faults, responsive layout, security — is fully exercised. On a laptop with both present, K1 (map/video presence) and a future video-liveness check gain full signal; no current check weakens.

## 2. Mutations injected and caught (numbered scenarios)

Our mutation agent injects Level-1 bugs into the cockpit; the QA suite catches them blind. Each mutation is one scenario. **11/13 injected mutations caught** — 3/5 agent-generated, 8/8 seed — with **0 false alarms** across 3 clean/harmless builds. Misses are reported honestly below. _(run 2026-09-26T10:45:00.777Z)_

*Provenance: the agent-generated mutations in §2a were authored by a separate Claude subagent given only the cockpit `frontend/` source, the product-brief lines and the Level-1 categories, with no access to the QA code (`qa/`) — a genuine blind test. `qa/mutator.ts` is the external-LLM version of the same agent (OpenAI / Gemini / NVIDIA NIM); it was not run in this environment because outbound egress to those APIs is blocked here, so it was exercised through the subagent instead. The §2b seed mutations were written by hand during development. All were validated (search unique, mutated file parses) and applied as git patches, then run through K1-K7 with the answer keys compared only afterwards.*

| # | Mutation | By | Expected | Checks that fired | Outcome |
|---|---|---|---|---|---|
| 1 | Connection shown as live when it is down | seed | K5 | K5 | ✅ caught |
| 2 | Live connection shown as offline | seed | K4 | K4 | ✅ caught |
| 3 | Battery 10 % too low | seed | K2 | K2 | ✅ caught |
| 4 | Telemetry of the wrong drone | seed | K2 + K3 | K2, K3 | ✅ caught |
| 5 | Flying drone shown as landed | seed | K3 | K3 | ✅ caught |
| 6 | Connection indicator removed | seed | K1 + K5 | K1, K5 | ✅ caught |
| 7 | Device list pushed off-screen on phones | seed | K6 | K6 | ✅ caught |
| 8 | Drone name rendered as raw HTML (stored XSS) | seed | K7 | K7 | ✅ caught |
| 9 | status shown wrong | agent | K4 | none | ❌ missed |
| 10 | wrong value | agent | K2 | K2 | ✅ caught |
| 11 | basic security | agent | K7 | K7 | ✅ caught |
| 12 | control off-screen at phone width | agent | K6 | none | ❌ missed |
| 13 | element removed | agent | K1 | K1 | ✅ caught |

### 2a. Agent-generated mutations (separate Claude subagent, no QA access — caught blind)

#### 1. status shown wrong

**Verdict:** MISSED
**Injected by:** mutation agent · **Category:** status shown wrong
**Video:** _<paste Drive link: K-gen-01-video-live-shown-off.webm>_

**Description.** The mutation Inverts the video-enabled test so an enabled live stream is treated as disabled and the tile renders the 'Video off' placeholder with state 'off'. [components/VideoTile.tsx]. The operator expects The operator sees 'Video off' and status 'off' for a drone that is actually streaming a live FPV feed..

> Product brief: “makes clear whether information is live, delayed, stale, disconnected or unavailable”

**Approach.** The QA suite ran K1-K7 against the mutated cockpit with no knowledge of the answer key. No check failed, and the answer key was compared only afterwards.

**Why it was missed (reported honestly).** Honest miss. In the kit's normal setup the cockpit shows a live FPV video stream (per the organizers' setup guide: MediaMTX serves one WHEP feed per drone). The cloud recording environment here had no video stream running, so the clean cockpit already shows the tile as "off" and the suite has no video-liveness check yet — "video is live" therefore cannot be asserted as an invariant in this environment. Next step: add a video-liveness oracle that compares the tile's label against actual playback (video currentTime advancing, videoWidth > 0, frame-hash changes) and run it on a machine with the live stream up; that check would catch this mutation.

| check | result |
|---|---|
| K1 Presence: everything the clean build shows | pass: 19 items present |
| K2 Values match the backend | pass: 5 values within tolerance (3 samples) |
| K3 Flight status agrees across panels | pass: list, pill and backend agree |
| K4 Live data not shown as offline | pass: no stale/offline cue while live |
| K5 Link loss shown, then recovers | pass: "socket reconnecting" after 0.0 s, cleared after 7.1 s |
| K6 Phone 390 px: controls still reachable | pass: 10 controls as reachable as in the clean build |
| K7 Device name rendered as text, no script | pass: name shown as text; no script ran |

#### 2. wrong value

**Verdict:** CAUGHT by K2
**Injected by:** mutation agent · **Category:** wrong value
**Video:** _<paste Drive link: K-gen-02-hspeed-wrong-source.webm>_

**Description.** The mutation Wires the horizontal-speed readout to the vertical-speed field, so H-Speed no longer reflects horizontal ground speed (it duplicates V-Speed). [components/TelemetryPanel.tsx]. The operator expects The operator reads a horizontal ground speed value that is actually the drone's vertical speed..

> Product brief: “Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together”

**Approach.** The QA suite ran K1-K7 against the mutated cockpit with no knowledge of the answer key. Check K2 failed, and the answer key was compared only afterwards.

| check | result |
|---|---|
| K1 Presence: everything the clean build shows | pass: 19 items present |
| K2 Values match the backend | FAIL: H-Speed 0.0 m/s vs 10.0 |
| K3 Flight status agrees across panels | pass: list, pill and backend agree |
| K4 Live data not shown as offline | pass: no stale/offline cue while live |
| K5 Link loss shown, then recovers | pass: "socket reconnecting" after 0.0 s, cleared after 7.2 s |
| K6 Phone 390 px: controls still reachable | pass: 10 controls as reachable as in the clean build |
| K7 Device name rendered as text, no script | pass: name shown as text; no script ran |

#### 3. basic security

**Verdict:** CAUGHT by K7
**Injected by:** mutation agent · **Category:** basic security
**Video:** _<paste Drive link: K-gen-03-device-name-raw-html.webm>_

**Description.** The mutation Renders the drone name as raw HTML instead of escaped text, injecting any markup or script contained in the name straight into the DOM. [components/DeviceList.tsx]. The operator expects A drone named with HTML (e.g. an img onerror or script tag) executes in the operator's browser instead of showing as literal text..

> Product brief: “Works in modern browsers on phones, tablets, laptops and desktops”

**Approach.** The QA suite ran K1-K7 against the mutated cockpit with no knowledge of the answer key. Check K7 failed, and the answer key was compared only afterwards.

| check | result |
|---|---|
| K1 Presence: everything the clean build shows | pass: 19 items present |
| K2 Values match the backend | pass: 5 values within tolerance (3 samples) |
| K3 Flight status agrees across panels | pass: list, pill and backend agree |
| K4 Live data not shown as offline | pass: no stale/offline cue while live |
| K5 Link loss shown, then recovers | pass: "socket reconnecting" after 0.0 s, cleared after 7.1 s |
| K6 Phone 390 px: controls still reachable | pass: 10 controls as reachable as in the clean build |
| K7 Device name rendered as text, no script | FAIL: HTML in name executed: onerror ran 1×, injected <img> element, injected element from name |

#### 4. control off-screen at phone width

**Verdict:** MISSED
**Injected by:** mutation agent · **Category:** control off-screen at phone width
**Video:** _<paste Drive link: K-gen-04-left-panel-clipped-phone.webm>_

**Description.** The mutation Adds overflow:hidden to the fixed 220px-tall left panel only inside the max-width:800px media query, clipping device/telemetry content below the fold with no way to scroll to it. [styles.css]. The operator expects On a phone the lower telemetry rows and device entries are cut off and unreachable because the panel can no longer scroll..

> Product brief: “Works in modern browsers on phones, tablets, laptops and desktops”

**Approach.** The QA suite ran K1-K7 against the mutated cockpit with no knowledge of the answer key. No check failed, and the answer key was compared only afterwards.

**Why it was missed (reported honestly).** Honest miss, and an instructive one: the mutation clips the telemetry rows on a phone, but the UNMODIFIED kit already hides telemetry on phones (documented real bug S4 in §3), so "telemetry visible on a phone" cannot be a clean-passing invariant. K6 checks that interactive controls stay reachable, and all four device-row controls still fit within the panel at 390 px, so control reachability is genuinely unchanged. The mutation worsens a pre-existing defect rather than introducing a newly detectable one.

| check | result |
|---|---|
| K1 Presence: everything the clean build shows | pass: 19 items present |
| K2 Values match the backend | pass: 5 values within tolerance (3 samples) |
| K3 Flight status agrees across panels | pass: list, pill and backend agree |
| K4 Live data not shown as offline | pass: no stale/offline cue while live |
| K5 Link loss shown, then recovers | pass: "socket reconnecting" after 0.0 s, cleared after 7.6 s |
| K6 Phone 390 px: controls still reachable | pass: 10 controls as reachable as in the clean build |
| K7 Device name rendered as text, no script | pass: name shown as text; no script ran |

#### 5. element removed

**Verdict:** CAUGHT by K1
**Injected by:** mutation agent · **Category:** element removed
**Video:** _<paste Drive link: K-gen-05-video-tile-removed.webm>_

**Description.** The mutation Removes the VideoTile from the cockpit layout so the FPV video panel is never mounted for the selected drone (import stays but is unused; noUnusedLocals is off so it still compiles). [pages/CockpitPage.tsx]. The operator expects After selecting a drone the operator no longer sees any video feed or its state; the video panel is entirely absent..

> Product brief: “Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together”

**Approach.** The QA suite ran K1-K7 against the mutated cockpit with no knowledge of the answer key. Check K1 failed, and the answer key was compared only afterwards.

| check | result |
|---|---|
| K1 Presence: everything the clean build shows | FAIL: video tile: not found by testid, role or text |
| K2 Values match the backend | pass: 5 values within tolerance (3 samples) |
| K3 Flight status agrees across panels | pass: list, pill and backend agree |
| K4 Live data not shown as offline | pass: no stale/offline cue while live |
| K5 Link loss shown, then recovers | pass: "socket reconnecting" after 0.0 s, cleared after 7.1 s |
| K6 Phone 390 px: controls still reachable | pass: 10 controls as reachable as in the clean build |
| K7 Device name rendered as text, no script | pass: name shown as text; no script ran |


### 2b. Seed mutations (written during development)

#### 6. Connection shown as live when it is down

**Verdict:** CAUGHT by K5
**Injected by:** seed (written during development) · **Category:** Mutation testing · Regression net
**Video:** _<paste Drive link: K-m1-badge-always-connected.webm>_

**Description.** The mutation SocketBadge.tsx: badge text and colour hard-coded to "socket connected". The operator expects the cockpit to keep showing correct, current information.

> Product brief: “makes clear whether information is live, delayed, stale, disconnected or unavailable”

**Approach.** The QA suite ran K1-K7 against the mutated cockpit with no knowledge of the answer key. Check K5 failed, and the answer key was compared only afterwards.

| check | result |
|---|---|
| K1 Presence: everything the clean build shows | pass: 19 items present |
| K2 Values match the backend | pass: 5 values within tolerance (3 samples) |
| K3 Flight status agrees across panels | pass: list, pill and backend agree |
| K4 Live data not shown as offline | pass: no stale/offline cue while live |
| K5 Link loss shown, then recovers | FAIL: link refused 6 s: no stale/offline cue at all |
| K6 Phone 390 px: controls still reachable | pass: 10 controls as reachable as in the clean build |
| K7 Device name rendered as text, no script | pass: name shown as text; no script ran |

#### 7. Live connection shown as offline

**Verdict:** CAUGHT by K4
**Injected by:** seed (written during development) · **Category:** Mutation testing · Regression net
**Video:** _<paste Drive link: K-m2-online-shown-offline.webm>_

**Description.** The mutation SocketBadge.tsx: shows "socket disconnected" while connected. The operator expects the cockpit to keep showing correct, current information.

> Product brief: “makes clear whether information is live, delayed, stale, disconnected or unavailable”

**Approach.** The QA suite ran K1-K7 against the mutated cockpit with no knowledge of the answer key. Check K4 failed, and the answer key was compared only afterwards.

| check | result |
|---|---|
| K1 Presence: everything the clean build shows | pass: 19 items present |
| K2 Values match the backend | pass: 5 values within tolerance (3 samples) |
| K3 Flight status agrees across panels | pass: list, pill and backend agree |
| K4 Live data not shown as offline | FAIL: cue "socket disconnected" · cue "class badge-disconnected" · badge says "socket disconnected" while live |
| K5 Link loss shown, then recovers | pass: "socket reconnecting" after 0.0 s, cleared after 7.2 s |
| K6 Phone 390 px: controls still reachable | pass: 10 controls as reachable as in the clean build |
| K7 Device name rendered as text, no script | pass: name shown as text; no script ran |

#### 8. Battery 10 % too low

**Verdict:** CAUGHT by K2
**Injected by:** seed (written during development) · **Category:** Mutation testing · Regression net
**Video:** _<paste Drive link: K-m3-battery-off-by-10.webm>_

**Description.** The mutation TelemetryPanel.tsx: battery value − 10. The operator expects the cockpit to keep showing correct, current information.

> Product brief: “Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together”

**Approach.** The QA suite ran K1-K7 against the mutated cockpit with no knowledge of the answer key. Check K2 failed, and the answer key was compared only afterwards.

| check | result |
|---|---|
| K1 Presence: everything the clean build shows | pass: 19 items present |
| K2 Values match the backend | FAIL: Battery 89 % vs 98.5 |
| K3 Flight status agrees across panels | pass: list, pill and backend agree |
| K4 Live data not shown as offline | pass: no stale/offline cue while live |
| K5 Link loss shown, then recovers | pass: "socket reconnecting" after 0.0 s, cleared after 7.2 s |
| K6 Phone 390 px: controls still reachable | pass: 10 controls as reachable as in the clean build |
| K7 Device name rendered as text, no script | pass: name shown as text; no script ran |

#### 9. Telemetry of the wrong drone

**Verdict:** CAUGHT by K2, K3
**Injected by:** seed (written during development) · **Category:** Mutation testing · Regression net
**Video:** _<paste Drive link: K-m4-wrong-drone-telemetry.webm>_

**Description.** The mutation TelemetryPanel.tsx: reads data of drone N+1 for selected drone N. The operator expects the cockpit to keep showing correct, current information.

> Product brief: “Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together”

**Approach.** The QA suite ran K1-K7 against the mutated cockpit with no knowledge of the answer key. Check K2, K3 failed, and the answer key was compared only afterwards.

| check | result |
|---|---|
| K1 Presence: everything the clean build shows | pass: 19 items present |
| K2 Values match the backend | FAIL: Altitude RLT 0.0 m vs 30.0 · H-Speed 0.0 m/s vs 10.0 · Dist. from home 0 m vs 55.0 · Heading 134 ° vs 47.0 |
| K3 Flight status agrees across panels | FAIL: device list airborne / status pill grounded / backend airborne |
| K4 Live data not shown as offline | pass: no stale/offline cue while live |
| K5 Link loss shown, then recovers | pass: "socket reconnecting" after 0.0 s, cleared after 7.3 s |
| K6 Phone 390 px: controls still reachable | pass: 10 controls as reachable as in the clean build |
| K7 Device name rendered as text, no script | pass: name shown as text; no script ran |

#### 10. Flying drone shown as landed

**Verdict:** CAUGHT by K3
**Injected by:** seed (written during development) · **Category:** Mutation testing · Regression net
**Video:** _<paste Drive link: K-m5-flying-shown-as-landed.webm>_

**Description.** The mutation TelemetryPanel.tsx: status pill shows "standby" while in_flight. The operator expects the cockpit to keep showing correct, current information.

> Product brief: “Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together”

**Approach.** The QA suite ran K1-K7 against the mutated cockpit with no knowledge of the answer key. Check K3 failed, and the answer key was compared only afterwards.

| check | result |
|---|---|
| K1 Presence: everything the clean build shows | pass: 19 items present |
| K2 Values match the backend | pass: 5 values within tolerance (3 samples) |
| K3 Flight status agrees across panels | FAIL: device list airborne / status pill grounded / backend airborne |
| K4 Live data not shown as offline | pass: no stale/offline cue while live |
| K5 Link loss shown, then recovers | pass: "socket reconnecting" after 0.0 s, cleared after 7.2 s |
| K6 Phone 390 px: controls still reachable | pass: 10 controls as reachable as in the clean build |
| K7 Device name rendered as text, no script | pass: name shown as text; no script ran |

#### 11. Connection indicator removed

**Verdict:** CAUGHT by K1, K5
**Injected by:** seed (written during development) · **Category:** Mutation testing · Regression net
**Video:** _<paste Drive link: K-m6-connection-badge-removed.webm>_

**Description.** The mutation CockpitPage.tsx: <SocketBadge /> deleted. The operator expects the cockpit to keep showing correct, current information.

> Product brief: “makes clear whether information is live, delayed, stale, disconnected or unavailable”

**Approach.** The QA suite ran K1-K7 against the mutated cockpit with no knowledge of the answer key. Check K1, K5 failed, and the answer key was compared only afterwards.

| check | result |
|---|---|
| K1 Presence: everything the clean build shows | FAIL: socket badge: not found by testid, role or text |
| K2 Values match the backend | pass: 5 values within tolerance (3 samples) |
| K3 Flight status agrees across panels | pass: list, pill and backend agree |
| K4 Live data not shown as offline | pass: no stale/offline cue while live |
| K5 Link loss shown, then recovers | FAIL: link refused 6 s: no stale/offline cue at all |
| K6 Phone 390 px: controls still reachable | pass: 10 controls as reachable as in the clean build |
| K7 Device name rendered as text, no script | pass: name shown as text; no script ran |

#### 12. Device list pushed off-screen on phones

**Verdict:** CAUGHT by K6
**Injected by:** seed (written during development) · **Category:** Mutation testing · Regression net
**Video:** _<paste Drive link: K-m7-device-list-offscreen-phone.webm>_

**Description.** The mutation styles.css (< 800 px): side panel translateX(-110vw). The operator expects the cockpit to keep showing correct, current information.

> Product brief: “Works in modern browsers on phones, tablets, laptops and desktops”

**Approach.** The QA suite ran K1-K7 against the mutated cockpit with no knowledge of the answer key. Check K6 failed, and the answer key was compared only afterwards.

| check | result |
|---|---|
| K1 Presence: everything the clean build shows | pass: 19 items present |
| K2 Values match the backend | pass: 5 values within tolerance (3 samples) |
| K3 Flight status agrees across panels | pass: list, pill and backend agree |
| K4 Live data not shown as offline | pass: no stale/offline cue while live |
| K5 Link loss shown, then recovers | pass: "socket reconnecting" after 0.0 s, cleared after 7.1 s |
| K6 Phone 390 px: controls still reachable | FAIL: Drone 1 Dock 1 dock open in_flight: outside the viewport; after scrolling: still not visible (+3) |
| K7 Device name rendered as text, no script | pass: name shown as text; no script ran |

#### 13. Drone name rendered as raw HTML (stored XSS)

**Verdict:** CAUGHT by K7
**Injected by:** seed (written during development) · **Category:** Mutation testing · Regression net
**Video:** _<paste Drive link: K-m8-xss-drone-name.webm>_

**Description.** The mutation DeviceList.tsx: renders drone.name with dangerouslySetInnerHTML instead of as text. The operator expects the cockpit to keep showing correct, current information.

> Product brief: “Works in modern browsers on phones, tablets, laptops and desktops”

**Approach.** The QA suite ran K1-K7 against the mutated cockpit with no knowledge of the answer key. Check K7 failed, and the answer key was compared only afterwards.

| check | result |
|---|---|
| K1 Presence: everything the clean build shows | pass: 19 items present |
| K2 Values match the backend | pass: 5 values within tolerance (3 samples) |
| K3 Flight status agrees across panels | pass: list, pill and backend agree |
| K4 Live data not shown as offline | pass: no stale/offline cue while live |
| K5 Link loss shown, then recovers | pass: "socket reconnecting" after 0.0 s, cleared after 7.1 s |
| K6 Phone 390 px: controls still reachable | pass: 10 controls as reachable as in the clean build |
| K7 Device name rendered as text, no script | FAIL: HTML in name executed: onerror ran 1×, injected <img> element, injected element from name |


## 3. Real bugs found in the original (unmutated) kit

Genuine defects already present in the unmodified kit, found while building the harness; each reproduced from a clean seeded start.

#### 1. Stale telemetry shown as live when the simulator link drops

**Verdict:** BUG · telemetry 12.6 s old, still shown as live
**Category:** Live data · Network/recovery · Freshness
**Video:** _<paste Drive link: videos/S1.webm>_

**Description.** An operator watching a drone in flight must be able to tell when the telemetry on screen stops being live. We cut the simulator→backend link (sim-offline) while Drone 1 is in flight. The expected behaviour, per the brief, is that within a few seconds the cockpit shows the data as stale/disconnected (wording, age, greyed values, or an offline status) instead of continuing to present the last values as current.

> Product brief: “makes clear whether information is live, delayed, stale, disconnected or unavailable”

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

---

#### 2. Out-of-order telemetry rendered as current: drone jumps backwards

**Verdict:** BUG · UI rendered older telemetry over newer: 5 backward jumps
**Category:** Live data · Changing network conditions · Telemetry integrity
**Video:** _<paste Drive link: videos/S2.webm>_

**Description.** Networks deliver telemetry late and occasionally out of order. When a newer position has already been shown, an older one must not replace it: the operator would see the drone jump backwards and read a wrong position, distance and track. We delay the telemetry path by 3 s with jitter (the kit's socket-delay fault) while Drone 1 flies a straight line away from its dock, so its true distance from home only increases. Expected: the cockpit keeps showing the newest data (discarding late, older frames) and makes clear the data is delayed.

> Product brief: “makes clear whether information is live, delayed, stale, disconnected or unavailable”

**Approach.** Deterministic Playwright run, zero LLM calls. A MutationObserver in the page records every value "Dist. from home" displays, with wall-clock time. Our own socket.io client subscribes to the same topics and receives the same frames in the same order as the cockpit, each with the simulator timestamp. Control first: 5 s without the fault, the displayed distance must never decrease. Then socket-delay 3000 ms for 22 s. Every backward step in the UI larger than 2 m is matched to the frame that caused it (same value, arrived within 600 ms) and counts only if that frame's timestamp is older than a frame already delivered. BUG requires at least 2 such matched jumps; if the network produced fewer than 2 out-of-order frames the run is SETUP-FAILED, not PASS.

**Result.** With 3000 ms delay + jitter, 7/37 position frames arrived out of order. The cockpit displayed them anyway: distance-from-home went backwards 5× (e.g. 120 → 115 m) while the drone flew straight away from its dock. No "delayed" cue while data was 3.1–4.5 s old.

| t after delay on | UI showed | then UI showed | cause (our socket) |
|---|---|---|---|
| 8.1 s | 120 m | 115 m | frame 500 ms older than one already delivered |
| 10.2 s | 145 m | 135 m | frame 1000 ms older than one already delivered |
| 11.1 s | 155 m | 150 m | frame 501 ms older than one already delivered |
| 16.0 s | 205 m | 195 m | frame 1001 ms older than one already delivered |
| 19.4 s | 240 m | 230 m | frame 1002 ms older than one already delivered |

---

#### 3. Map 2D/3D view toggle is covered by the video tile on phones

**Verdict:** BUG · 2D/3D toggle unusable at 320–412 px
**Category:** Responsive · Devices · Map controls
**Video:** _<paste Drive link: videos/S3.webm>_

**Description.** The operator switches the map between 3D and 2D with the 2D/3D toggle at the bottom of the map. The product must work on phones, tablets, laptops and desktops. We open the cockpit at a laptop size and at six tablet/phone sizes and check that every control usable on the laptop can still be seen and pressed. Expected: the map view toggle is visible and pressable at every size.

> Product brief: “Works in modern browsers on phones, tablets, laptops and desktops”

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

---

#### 4. Selecting a drone on a phone does not show its telemetry

**Verdict:** BUG · phone: selecting a drone shows 0/9 telemetry values
**Category:** Responsive · Devices · Operator workflow
**Video:** _<paste Drive link: videos/S4.webm>_

**Description.** An operator selects a drone to see how it is doing: status, battery, altitude, speed, distance, next to the map and video. The brief says selecting a drone shows these together, and that the product works on phones. On a laptop this holds. We repeat the same action on phone-sized screens while Drone 1 is flying. Expected: after tapping the drone, its status and key telemetry (battery, altitude, speed) are visible without hunting for them.

> Product brief: “Selecting a drone shows its state, telemetry, map location, video, warnings and freshness together”

**Approach.** Deterministic Playwright run, zero LLM calls. The cockpit runs in a device frame (iframe with the exact device viewport, so the app's media queries apply). After the select action the harness probes the selected row, status pill, all 9 telemetry values, the map and the video: an item counts as visible only if it is inside the viewport, at least 60 % unclipped by any scroll container, and document.elementFromPoint() at its visible centre returns the item itself. Laptop first as the control (everything visible together), then iPhone SE. The operator is then allowed to scroll the side panel with the mouse wheel and visibility is measured again, to state precisely what a phone user can see at once. Repeated on iPhone 13 and Pixel 7, and re-checked in a real iPhone SE emulation context (touch, DPR 2).

**Result.** On iPhone SE, after tapping Drone 1 (in flight), its status, battery, altitude and speed are not on screen: they sit below a fixed-height side panel (aside.cockpit-left (375×220 px)) filled by the device list. Scrolling that panel shows at most 7/9 values at once and loses the selected row. Laptop: 9/9 together with map and video. Also on: iPhone 13, Pixel 7, emulated iPhone SE (touch, DPR 2).

| screen | right after selecting Drone 1 | after scrolling the side panel |
|---|---|---|
| Laptop 1366×768 (control) | status visible, 9/9 telemetry, map visible, video visible | not needed |
| iPhone SE 375×667 | status hidden (0 % in view), 0/9 telemetry, map visible, video visible | at most 7/9 at once; selected row scrolled out of view |
| iPhone 13 390×844 | 0/9 telemetry visible, status pill hidden (0 % in view) |  |
| Pixel 7 412×915 | 0/9 telemetry visible, status pill hidden (0 % in view) |  |
| emulated iPhone SE (touch, DPR 2) | 0/9 telemetry visible, status pill hidden (0 % in view) |  |


## 4. Precision controls (no false alarms)

The suite must not cry wolf. On 3 clean/harmless builds it raised 0 false alarms.

#### Land returns the drone to its dock: intended, not flagged

**Result: INTENDED.** README says "down where it is"; backend (latest commit: return-to-dock landing) flew 70 m back and landed on the dock in 15.4 s. Cockpit followed it: in_flight → landing → standby, altitude/distance within tolerance in 100 % of 21 samples, final 0.0 m / 0 m.

Precision check, not a numbered finding. The kit README says Land brings the drone "down where it is", but the backend now flies it back to its dock first (latest kit commit: "return-to-dock landing"). A tester that trusts the README would raise a false alarm. We land Drone 1 mid-flight and check that the cockpit shows what the drone really does.

| source | what it says Land does | result |
|---|---|---|
| Kit README | "Press Land to bring it down where it is" | outdated |
| Latest kit commit | "feat(cockpit): add 2D/3D view toggle, terrain height references and return-to-dock landing" | intended change |
| Backend (simulator state) | flew back 70 m to the dock, descended at 0.0 m from it | returns to dock |
| Cockpit | status in_flight → landing → standby; final 0.0 m / 0 m | matches backend |

**Video:** _<paste Drive link: videos/P1.webm>_

#### S1 on a fixed cockpit: stale data is flagged, so S1 reports PASS

**Result: PASS.** Cue: "stale · 4 s ago"

Precision control for S1. The same scenario, oracle and thresholds, run against a copy of the cockpit patched to show "stale · N s ago" when position data is older than 3 s. If the S1 oracle were simply always red, it would flag this build too. Expected: PASS.

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


**Harmless changes correctly ignored:** Harmless: test ids renamed → correctly passed; Harmless: wording changed → correctly passed. The clean build passes all seven checks.
