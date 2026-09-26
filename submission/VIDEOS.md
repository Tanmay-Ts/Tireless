# Submission videos

Every file is a real-time recording. "Run" is the UTC start time of the run whose numbers appear in WRITEUP.md; each video is checked against that run (video length within a few seconds of the run length, same run id).

| File | Length | Run started (UTC) | Run length | Same run? | Verdict |
|---|---|---|---|---|---|
| K-gen-02-hspeed-wrong-source.mp4 | 0:49.8 | 10:41:35 | 49.7 s | OK (Δ 0.1 s) | BUG: caught by K2 |
| K-gen-03-device-name-raw-html.mp4 | 0:45.6 | 10:42:30 | 45.2 s | OK (Δ 0.4 s) | BUG: caught by K7 |
| K-gen-05-video-tile-removed.mp4 | 0:46.2 | 10:44:13 | 45.7 s | OK (Δ 0.5 s) | BUG: caught by K1 |
| K-m1-badge-always-connected.mp4 | 0:45.5 | 10:27:13 | 45.4 s | OK (Δ 0.1 s) | BUG: caught by K5 |
| K-m2-online-shown-offline.mp4 | 0:47.9 | 10:28:03 | 47.7 s | OK (Δ 0.2 s) | BUG: caught by K4 |
| K-m3-battery-off-by-10.mp4 | 0:49.4 | 10:28:56 | 49.3 s | OK (Δ 0.1 s) | BUG: caught by K2 |
| K-m4-wrong-drone-telemetry.mp4 | 0:58.9 | 10:29:50 | 58.3 s | OK (Δ 0.6 s) | BUG: caught by K2 + K3 |
| K-m5-flying-shown-as-landed.mp4 | 0:48.7 | 10:30:53 | 48.1 s | OK (Δ 0.6 s) | BUG: caught by K3 |
| K-m6-connection-badge-removed.mp4 | 0:46.9 | 10:31:46 | 46.4 s | OK (Δ 0.5 s) | BUG: caught by K1 + K5 |
| K-m7-device-list-offscreen-phone.mp4 | 0:49.5 | 10:32:37 | 49.0 s | OK (Δ 0.5 s) | BUG: caught by K6 |
| S1.mp4 | 0:44.7 | 10:17:23 | 44.5 s | OK (Δ 0.2 s) | BUG: telemetry 12.6 s old, still shown as live |
| S2.mp4 | 0:55.1 | 10:18:08 | 56.2 s | OK (Δ 1.1 s) | BUG: UI rendered older telemetry over newer: 5 backward jumps |
| S3.mp4 | 0:35.2 | 10:19:05 | 34.9 s | OK (Δ 0.3 s) | BUG: 2D/3D toggle unusable at 320–412 px |
| S4.mp4 | 0:31.8 | 10:19:40 | 32.0 s | OK (Δ 0.2 s) | BUG: phone: selecting a drone shows 0/9 telemetry values |
| K-gen-01-video-live-shown-off.mp4 | 0:46.6 | 10:40:44 | 46.3 s | OK (Δ 0.3 s) | PASS: all 7 invariants hold |
| K-gen-04-left-panel-clipped-phone.mp4 | 0:47.8 | 10:43:20 | 47.8 s | OK (Δ 0.0 s) | PASS: all 7 invariants hold |
| K-m8-xss-drone-name.mp4 | 0:48.8 | 10:33:31 | 48.9 s | OK (Δ 0.1 s) | BUG: caught by K7 |
| K-clean.mp4 | 0:46.7 | 10:26:21 | 46.6 s | OK (Δ 0.1 s) | PASS: all 7 invariants hold |
| K-h1-testids-renamed.mp4 | 0:49.7 | 10:34:25 | 49.5 s | OK (Δ 0.2 s) | PASS: all 7 invariants hold |
| K-h2-wording-change.mp4 | 0:47.1 | 10:35:20 | 47.4 s | OK (Δ 0.3 s) | PASS: all 7 invariants hold |
| P1.mp4 | 0:39.0 | 08:19:07 | 39.8 s | OK (Δ 0.8 s) | INTENDED: Land returns to the dock: intended behaviour, not flagged |
| S1-fixed.mp4 | 0:44.4 | 08:51:28 | 44.0 s | OK (Δ 0.4 s) | PASS: UI flagged stale data after 4.1 s |

Portal cut `level1-all-scenarios.mp4`: 13:05.3 (scenarios 1–14 in numbered order, then the precision runs P1, S1-fixed, clean kit).
