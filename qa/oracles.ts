/**
 * Zero-LLM oracles. Each returns data, not just a boolean, so the HUD and the report can show
 * truth vs UI side by side. Locators go testid → role+name → visible label/text and report which
 * one was used (a fallback means a testid was renamed or removed: worth noting, not a bug by itself).
 */
import type { Frame, Locator, Page } from 'playwright';

/** Oracles run on a page or on a frame (the phone harness puts the cockpit in an iframe). */
export type Scope = Page | Frame;

export type Via = 'testid' | 'role' | 'label' | 'text' | 'none';
export type Target = {
  name: string;
  testid?: string;
  role?: Parameters<Page['getByRole']>[0];
  roleName?: string | RegExp;
  /** Visible label next to the value (e.g. <dt>Battery</dt><dd>99 %</dd>): value = label's row minus the label. */
  label?: string;
  text?: string | RegExp;
};
export type Located = { target: Target; loc: Locator | null; via: Via };

// ---------------------------------------------------------------------------------------------
// Cockpit map (frontend/src/testids.ts), with fallbacks that survive a renamed testid.
// ---------------------------------------------------------------------------------------------
export const T = {
  socketBadge: { name: 'socket badge', testid: 'socket-status', text: /^socket (connected|connecting|reconnecting|disconnected)$/i } as Target,
  statusPill: { name: 'flight status pill', testid: 'status-flight', text: /^(standby|taking_off|in_flight|landing|unknown)$/ } as Target,
  deviceRow: (id: string, name: string): Target => ({ name: `device row ${name}`, testid: `device-row-${id}`, role: 'listitem', roleName: new RegExp(`\\b${name}\\b`), text: name }),
  battery: { name: 'Battery', testid: 'telemetry-battery', label: 'Battery' } as Target,
  altRlt: { name: 'Altitude RLT', testid: 'telemetry-alt-rlt', label: 'Altitude RLT' } as Target,
  altAgl: { name: 'Altitude AGL', testid: 'telemetry-alt-agl', label: 'Altitude AGL' } as Target,
  hSpeed: { name: 'H-Speed', testid: 'telemetry-hspeed', label: 'H-Speed' } as Target,
  vSpeed: { name: 'V-Speed', testid: 'telemetry-vspeed', label: 'V-Speed' } as Target,
  heading: { name: 'Heading', testid: 'telemetry-heading', label: 'Heading' } as Target,
  altAsl: { name: 'Altitude ASL', testid: 'telemetry-alt-asl', label: 'Altitude ASL' } as Target,
  wind: { name: 'Wind', testid: 'telemetry-wind', label: 'Wind' } as Target,
  mapCanvas: { name: 'map', testid: 'map-canvas', role: 'region', roleName: /map/i } as Target,
  videoPlayer: { name: 'video tile', testid: 'video-player', text: /^video off$|^live$/i } as Target,
  homeDistance: { name: 'Dist. from home', testid: 'telemetry-home-distance', label: 'Dist. from home' } as Target,
  map2d: { name: '2D toggle', testid: 'map-view-2d', role: 'button', roleName: /^2D$/i } as Target,
  map3d: { name: '3D toggle', testid: 'map-view-3d', role: 'button', roleName: /^3D$/i } as Target,
  videoState: { name: 'video label', testid: 'video-state' } as Target,
};

export async function locate(page: Scope, t: Target): Promise<Located> {
  if (t.testid) {
    const l = page.getByTestId(t.testid);
    if (await l.count()) return { target: t, loc: l.first(), via: 'testid' };
  }
  if (t.role) {
    const l = page.getByRole(t.role, t.roleName ? { name: t.roleName } : undefined);
    if (await l.count()) return { target: t, loc: l.first(), via: 'role' };
  }
  if (t.label) {
    // The label's parent row holds label + value; readText() strips the label back off.
    const l = page.getByText(t.label, { exact: true }).locator('xpath=..');
    if (await l.count()) return { target: t, loc: l.first(), via: 'label' };
  }
  if (t.text) {
    const l = page.getByText(t.text);
    if (await l.count()) return { target: t, loc: l.first(), via: 'text' };
  }
  return { target: t, loc: null, via: 'none' };
}

export async function readText(page: Scope, t: Target): Promise<{ text: string | null; via: Via; located: Located }> {
  const located = await locate(page, t);
  if (!located.loc) return { text: null, via: 'none', located };
  let text = ((await located.loc.innerText({ timeout: 1000 }).catch(() => null)) ?? '').replace(/\s+/g, ' ').trim();
  if (located.via === 'label' && t.label) text = text.replace(t.label, '').trim();
  return { text, via: located.via, located };
}

export function parseNum(text: string | null | undefined): number | undefined {
  const m = text?.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Value vs truth
// ---------------------------------------------------------------------------------------------
export type Check = { field: string; truth: string; ui: string; ok: boolean | null; via?: Via; note?: string };

export function compareNum(field: string, uiText: string | null, truth: number | undefined, tol: number, unit = '', via?: Via): Check {
  const ui = parseNum(uiText);
  const fmt = (v: number | undefined) => (v === undefined ? '—' : `${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)}${unit ? ' ' + unit : ''}`);
  if (truth === undefined) return { field, truth: 'n/a', ui: uiText ?? 'missing', ok: null, via };
  if (ui === undefined) return { field, truth: fmt(truth), ui: uiText ?? 'missing', ok: false, via, note: 'no value shown' };
  return { field, truth: fmt(truth), ui: uiText ?? '', ok: Math.abs(ui - truth) <= tol, via, note: `|Δ| ${Math.abs(ui - truth).toFixed(1)} (tol ${tol})` };
}

// ---------------------------------------------------------------------------------------------
// Flight status classes: compare meaning across panels, not strings.
// ---------------------------------------------------------------------------------------------
export type FlightClass = 'airborne' | 'grounded' | 'offline' | 'unknown';
export function flightClass(s: string | null | undefined): FlightClass {
  const t = (s ?? '').toLowerCase();
  if (!t || t === '—') return 'unknown';
  if (/offline|disconnect|lost|stale|no data/.test(t)) return 'offline';
  if (/in[_ -]?flight|flying|airborne|taking[_ -]?off|takeoff|hover|cruis|returning|landing\b/.test(t)) return 'airborne';
  if (/standby|landed|on[_ -]?dock|docked|idle|grounded|ready|parked/.test(t)) return 'grounded';
  return 'unknown';
}

/** Cross-panel consistency: every source must agree on the drone's flight class. */
export function crossPanel(claims: { source: string; value: string | null }[]) {
  const classes = claims.map((c) => ({ ...c, cls: flightClass(c.value) }));
  const known = classes.filter((c) => c.cls !== 'unknown');
  const agree = known.every((c) => c.cls === known[0]?.cls);
  return { agree, classes };
}

// ---------------------------------------------------------------------------------------------
// Freshness: does the UI say anywhere that data is stale / offline / unavailable?
// ---------------------------------------------------------------------------------------------
export type Indicator = { key: string; kind: 'text' | 'age' | 'attr' | 'class' | 'unavailable' | 'dimmed'; text: string; where: string; region: 'app' | 'video' };

/** Wording is matched by meaning (any of these), never by exact string. */
export const STALE_WORDS =
  '\\b(stale|offline|disconnected|no (?:data|signal|telemetry|link|connection|heartbeat)|signal lost|link lost|lost (?:link|signal|connection)|connection lost|not live|delayed|lagging|reconnecting|unavailable|unknown|timed? ?out|last (?:seen|update[ds]?|heard|contact)|outdated|frozen|out of date)\\b';

/**
 * Scans visible app DOM (never the QA overlay) for anything that communicates staleness: wording,
 * "N s ago" ages ≥ 3 s, stale-ish data-state/aria/title attributes or class names, telemetry values
 * replaced by dashes, or telemetry dimmed below 60 % opacity. Video-tile hits are tagged separately:
 * a video label is about video, not telemetry freshness.
 */
export async function freshnessScan(page: Scope): Promise<Indicator[]> {
  return page.evaluate((wordsSrc) => {
    const words = new RegExp(wordsSrc, 'i');
    const out: Indicator[] = [];
    const vw = innerWidth;
    const vh = innerHeight;
    const inOverlay = (el: Element) => !!el.closest('[data-qa-overlay]');
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return false;
      return (el as any).checkVisibility ? (el as any).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true;
    };
    const where = (el: Element) => {
      const t = el.closest('[data-testid]');
      if (t) return t.getAttribute('data-testid') as string;
      const c = el.closest('[class]');
      return c ? `.${String(c.getAttribute('class')).split(/\s+/)[0]}` : el.tagName.toLowerCase();
    };
    const region = (el: Element): 'app' | 'video' => (el.closest('[data-testid^="video"], [class*="video"]') ? 'video' : 'app');
    const keys = new Set<string>();
    const push = (kind: Indicator['kind'], el: Element, text: string, keyText = text) => {
      const w = where(el);
      const key = `${kind}:${w}:${keyText.toLowerCase().replace(/\d+(\.\d+)?/g, '#')}`;
      if (keys.has(key)) return;
      keys.add(key);
      out.push({ key, kind, text: text.slice(0, 80), where: w, region: region(el) });
    };

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !(n.textContent ?? '').trim() || inOverlay(el) || !shown(el)) continue;
      // Frameworks split "stale · {n} s ago" into several text nodes: read the element's whole text.
      const own = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      const txt = own.length <= 120 ? own : (n.textContent ?? '').trim();
      if (words.test(txt)) push('text', el, txt);
      const age = /(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)\s+ago/i.exec(txt);
      if (age && Number(age[1]) >= 3) push('age', el, txt, 'age');
    }
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (inOverlay(el) || !shown(el)) continue;
      for (const a of ['data-state', 'data-status', 'data-freshness', 'aria-label', 'title', 'aria-description']) {
        const v = el.getAttribute(a);
        if (v && words.test(v)) push('attr', el, `${a}=${v}`);
      }
      const cls = typeof el.className === 'string' ? el.className : '';
      const m = /\b[\w-]*(stale|offline|disconnected)[\w-]*\b/i.exec(cls);
      if (m) push('class', el, `class ${m[0]}`);
      const tid = el.getAttribute('data-testid') ?? '';
      if (/^telemetry-|^status-flight$/.test(tid)) {
        const v = (el.textContent ?? '').trim();
        if (!/\d/.test(v) && tid.startsWith('telemetry-')) push('unavailable', el, `${tid}: "${v}"`);
        let op = 1;
        for (let p: Element | null = el; p; p = p.parentElement) op *= Number(getComputedStyle(p).opacity);
        if (op < 0.6) push('dimmed', el, `${tid} opacity ${op.toFixed(2)}`, 'dimmed');
      }
    }
    return out;
  }, STALE_WORDS);
}

/** Indicators present now that were not present while data was known live (and outside the video tile). */
export function newIndicators(now: Indicator[], baseline: Indicator[]) {
  const seen = new Set(baseline.map((i) => i.key));
  return now.filter((i) => !seen.has(i.key) && i.region === 'app');
}

// ---------------------------------------------------------------------------------------------
// Reachability / visibility: exists, displayed, inside the viewport, not clipped by a scroll box,
// not covered (elementFromPoint), enabled. One geometry routine, installed once per document as
// plain JS (no tsx helpers), shared by single-target checks and the whole-page control audit.
// ---------------------------------------------------------------------------------------------
const PROBE_SRC = `window.__qaProbe = window.__qaProbe || function (el, opts) {
  opts = opts || {};
  var describe = function (e) {
    if (!e || !e.tagName) return 'nothing';
    var tid = e.getAttribute('data-testid');
    var cls = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/)[0] : '';
    return e.tagName.toLowerCase() + (tid ? '[data-testid=' + tid + ']' : '') + cls;
  };
  var label = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
  var r0 = el.getBoundingClientRect();
  var res = { label: label, testid: el.getAttribute('data-testid'), tag: el.tagName.toLowerCase(),
    enabled: !el.disabled && el.getAttribute('aria-disabled') !== 'true', fraction: 0 };
  var shown = el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true;
  if (!shown || r0.width < 1 || r0.height < 1) { res.state = 'hidden'; return res; }
  var measure = function () {
    var r = el.getBoundingClientRect();
    var v = { l: Math.max(r.left, 0), t: Math.max(r.top, 0), r: Math.min(r.right, innerWidth), b: Math.min(r.bottom, innerHeight) };
    var clippedBy = null;
    for (var p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (!/(auto|scroll|hidden|clip)/.test(cs.overflowX + ' ' + cs.overflowY)) continue;
      var pr = p.getBoundingClientRect();
      var before = Math.max(0, v.r - v.l) * Math.max(0, v.b - v.t);
      v = { l: Math.max(v.l, pr.left), t: Math.max(v.t, pr.top), r: Math.min(v.r, pr.right), b: Math.min(v.b, pr.bottom) };
      var after = Math.max(0, v.r - v.l) * Math.max(0, v.b - v.t);
      if (after < before - 1 && !clippedBy) clippedBy = describe(p) + ' (' + Math.round(pr.width) + '×' + Math.round(pr.height) + ' px)';
    }
    var area = Math.max(0, v.r - v.l) * Math.max(0, v.b - v.t);
    var coveredBy = null;
    if (area > 0) {
      var pts = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5]];
      for (var i = 0; i < pts.length; i++) {
        var h = document.elementFromPoint(v.l + (v.r - v.l) * pts[i][0], v.t + (v.b - v.t) * pts[i][1]);
        if (!h || !(h === el || el.contains(h))) { coveredBy = describe(h); break; }
      }
    }
    return { fraction: area / (r.width * r.height), clippedBy: clippedBy, coveredBy: coveredBy,
      offscreen: r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight,
      box: { x: r.left, y: r.top, w: r.width, h: r.height } };
  };
  var m = measure();
  res.fraction = m.fraction; res.clippedBy = m.clippedBy; res.coveredBy = m.coveredBy; res.box = m.box;
  res.state = m.fraction >= 0.6 ? (m.coveredBy ? 'covered' : 'ok') : m.offscreen && !m.clippedBy ? 'offscreen' : 'clipped';
  if (opts.tryScroll && (res.state === 'clipped' || res.state === 'offscreen')) {
    // Could a user reach it by scrolling? Scroll it into view, re-measure, then restore every scroll position.
    var saved = [];
    for (var q = el.parentElement; q; q = q.parentElement) saved.push([q, q.scrollTop, q.scrollLeft]);
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    var m2 = measure();
    res.afterScroll = m2.fraction >= 0.6 ? (m2.coveredBy ? 'covered by ' + m2.coveredBy : 'ok') : 'still not visible';
    for (var k = 0; k < saved.length; k++) { saved[k][0].scrollTop = saved[k][1]; saved[k][0].scrollLeft = saved[k][2]; }
  }
  return res;
};`;

export type ProbeState = 'ok' | 'covered' | 'clipped' | 'offscreen' | 'hidden' | 'missing';
type Probe = {
  label: string;
  testid: string | null;
  tag: string;
  enabled: boolean;
  state: ProbeState;
  fraction: number;
  clippedBy?: string | null;
  coveredBy?: string | null;
  afterScroll?: string;
  box?: { x: number; y: number; w: number; h: number };
};
export type Reach = Probe & { ok: boolean; via: Via; reason?: string; located: Located };

export function probeReason(p: Pick<Probe, 'state' | 'coveredBy' | 'clippedBy' | 'fraction' | 'afterScroll'>): string | undefined {
  switch (p.state) {
    case 'ok':
      return undefined;
    case 'covered':
      return `covered by ${p.coveredBy}`;
    case 'clipped':
      return `clipped by ${p.clippedBy ?? 'viewport'} (${Math.round(p.fraction * 100)} % visible)${p.afterScroll ? `; after scrolling: ${p.afterScroll}` : ''}`;
    case 'offscreen':
      return `outside the viewport${p.afterScroll ? `; after scrolling: ${p.afterScroll}` : ''}`;
    case 'hidden':
      return 'not displayed';
    case 'missing':
      return 'not found by testid, role or text';
  }
}

async function installProbe(scope: Scope) {
  await scope.evaluate(PROBE_SRC);
}

/** Is this element visible to the user right now (and, with tryScroll, reachable by scrolling)? */
export async function reachability(scope: Scope, t: Target, opts: { tryScroll?: boolean } = {}): Promise<Reach> {
  const located = await locate(scope, t);
  if (!located.loc)
    return { label: t.name, testid: null, tag: '', enabled: false, state: 'missing', fraction: 0, ok: false, via: 'none', reason: probeReason({ state: 'missing', fraction: 0 }), located };
  await installProbe(scope);
  const p = (await located.loc.evaluate((el, o) => (window as any).__qaProbe(el, o), opts)) as Probe;
  return { ...p, ok: p.state === 'ok' && p.enabled, via: located.via, reason: p.enabled ? probeReason(p) : 'disabled', located };
}

export const CONTROL_SELECTOR =
  'button, a[href], [role=button], [role=tab], [role=switch], input:not([type=hidden]), select, textarea, [data-testid^="device-row-"]';

export type AuditRow = Probe & { key: string };

/** Every interactive control on the page, probed in one pass (scroll-reachability included). */
export async function auditControls(scope: Scope): Promise<AuditRow[]> {
  await installProbe(scope);
  return scope.evaluate((sel) => {
    const w = window as any;
    return Array.from(document.querySelectorAll(sel))
      .filter((el) => !el.closest('[data-qa-overlay]'))
      .map((el) => {
        const p = w.__qaProbe(el, { tryScroll: true });
        return { ...p, key: p.testid ?? `${p.tag}:${p.label}` };
      });
  }, CONTROL_SELECTOR);
}

/** A control is broken at this size if it was usable in the baseline and now cannot be seen or reached. */
export function auditFailures(now: AuditRow[], baseline: AuditRow[]) {
  const byKey = new Map(now.map((r) => [r.key, r]));
  return baseline
    .filter((b) => b.state === 'ok')
    .map((b) => {
      const r = byKey.get(b.key);
      if (!r) return { key: b.key, label: b.label, reason: 'missing (present in baseline)' };
      const reachable = r.state === 'ok' || ((r.state === 'clipped' || r.state === 'offscreen') && r.afterScroll === 'ok');
      return reachable ? null : { key: r.key, label: r.label, reason: probeReason(r) ?? r.state };
    })
    .filter((x): x is { key: string; label: string; reason: string } => x !== null);
}

const reachableRow = (r: Pick<AuditRow, 'state' | 'afterScroll'>) => r.state === 'ok' || ((r.state === 'clipped' || r.state === 'offscreen') && r.afterScroll === 'ok');

/**
 * Semantic diff against a known-good build: every control that was reachable in the clean build (at the same
 * screen size) must still exist and be reachable. Known issues of the clean build are part of the baseline, so
 * only NEW breakage is reported; this is what catches mutations nobody wrote a specific check for.
 */
export function auditRegressions(now: AuditRow[], cleanBaseline: Pick<AuditRow, 'key' | 'label' | 'state' | 'afterScroll'>[]) {
  const byKey = new Map(now.map((r) => [r.key, r]));
  return cleanBaseline
    .filter(reachableRow)
    .map((b) => {
      const r = byKey.get(b.key);
      if (!r) return { key: b.key, label: b.label, reason: 'missing (present in clean build)' };
      return reachableRow(r) ? null : { key: r.key, label: r.label, reason: probeReason(r) ?? r.state };
    })
    .filter((x): x is { key: string; label: string; reason: string } => x !== null);
}

// ---------------------------------------------------------------------------------------------
// Time series of what the UI displayed: a MutationObserver records every text change of an element
// with its wall-clock time (same clock as the truth recorder), so no update between samples is missed.
// ---------------------------------------------------------------------------------------------
export async function watchText(loc: Locator, key: string) {
  await loc.evaluate((el, k) => {
    const w = window as any;
    w.__qaSeries = w.__qaSeries ?? {};
    const series: { t: number; text: string }[] = (w.__qaSeries[k] = [{ t: Date.now(), text: (el.textContent ?? '').trim() }]);
    new MutationObserver(() => {
      const text = (el.textContent ?? '').trim();
      if (text !== series[series.length - 1]?.text) series.push({ t: Date.now(), text });
    }).observe(el, { subtree: true, childList: true, characterData: true });
  }, key);
}

export async function readSeries(scope: Scope, key: string): Promise<{ t: number; text: string }[]> {
  return scope.evaluate((k) => ((window as any).__qaSeries?.[k] ?? []) as { t: number; text: string }[], key);
}

// ---------------------------------------------------------------------------------------------
// Internal consistency of what the UI itself shows (no backend needed).
// ---------------------------------------------------------------------------------------------
/** UI claims speed > 1 m/s but its own distance-from-home has not moved: the numbers cannot both be live. */
export function motionContradiction(samples: { at: number; hSpeed?: number; homeDist?: number }[]) {
  const s = samples.filter((x) => x.hSpeed !== undefined && x.homeDist !== undefined);
  if (s.length < 2) return undefined;
  const span = (s[s.length - 1].at - s[0].at) / 1000;
  const claimed = Math.min(...s.map((x) => x.hSpeed as number));
  const moved = Math.abs((s[s.length - 1].homeDist as number) - (s[0].homeDist as number));
  const expected = claimed * span;
  return { span, claimed, moved, expected, contradiction: claimed > 1 && span >= 3 && moved < expected * 0.2 };
}
