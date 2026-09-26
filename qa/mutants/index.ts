/**
 * Planted bugs (patches against the kit's cockpit source) used to prove the invariant suite K catches
 * mutations, plus harmless changes it must let through. Each patch is a `git diff` of the kit repo.
 * `expect` = the K checks that must fail ([] = must PASS: a failure there would be a false alarm).
 */
export type Mutant = { id: string; title: string; planted: string; expect: string[]; patch?: string };

export const MUTANTS: Mutant[] = [
  { id: 'clean', title: 'Unmodified kit', planted: 'nothing (records the clean baseline)', expect: [] },
  {
    id: 'm1-badge-always-connected',
    title: 'Connection shown as live when it is down',
    planted: 'SocketBadge.tsx: badge text and colour hard-coded to "socket connected"',
    expect: ['K5'],
  },
  {
    id: 'm2-online-shown-offline',
    title: 'Live connection shown as offline',
    planted: 'SocketBadge.tsx: shows "socket disconnected" while connected',
    expect: ['K4'],
  },
  { id: 'm3-battery-off-by-10', title: 'Battery 10 % too low', planted: 'TelemetryPanel.tsx: battery value − 10', expect: ['K2'] },
  {
    id: 'm4-wrong-drone-telemetry',
    title: "Telemetry of the wrong drone",
    planted: 'TelemetryPanel.tsx: reads data of drone N+1 for selected drone N',
    expect: ['K2', 'K3'],
  },
  {
    id: 'm5-flying-shown-as-landed',
    title: 'Flying drone shown as landed',
    planted: 'TelemetryPanel.tsx: status pill shows "standby" while in_flight',
    expect: ['K3'],
  },
  { id: 'm6-connection-badge-removed', title: 'Connection indicator removed', planted: 'CockpitPage.tsx: <SocketBadge /> deleted', expect: ['K1', 'K5'] },
  {
    id: 'm7-device-list-offscreen-phone',
    title: 'Device list pushed off-screen on phones',
    planted: 'styles.css (< 800 px): side panel translateX(-110vw)',
    expect: ['K6'],
  },
  {
    id: 'h1-testids-renamed',
    title: 'Harmless: test ids renamed',
    planted: 'testids.ts: socket-status, telemetry-battery, telemetry-hspeed renamed (UI unchanged)',
    expect: [],
  },
  {
    id: 'h2-wording-change',
    title: 'Harmless: wording changed',
    planted: '"FlytBase Cockpit"→"FlytBase Operations", "Devices"→"Fleet", "socket …"→"link …", "Dist. from home"→"Distance to home"',
    expect: [],
  },
].map((m) => ({ ...m, patch: m.id === 'clean' ? undefined : `${m.id}.patch` }));
