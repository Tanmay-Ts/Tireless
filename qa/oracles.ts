/**
 * Zero-LLM oracles. Each returns data, not just a boolean, so the HUD and the report can show
 * truth vs UI side by side. Locators go testid → role+name → visible label/text and report which
 * one was used (a fallback means a testid was renamed or removed: worth noting, not a bug by itself).
 */
import type { Locator, Page } from 'playwright';

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
  homeDistance: { name: 'Dist. from home', testid: 'telemetry-home-distance', label: 'Dist. from home' } as Target,
  map2d: { name: '2D toggle', testid: 'map-view-2d', role: 'button', roleName: /^2D$/i } as Target,
  map3d: { name: '3D toggle', testid: 'map-view-3d', role: 'button', roleName: /^3D$/i } as Target,
  videoState: { name: 'video label', testid: 'video-state' } as Target,
};

export async function locate(page: Page, t: Target): Promise<Located> {
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

export async function readText(page: Page, t: Target): Promise<{ text: string | null; via: Via; located: Located }> {
  const located = await locate(page, t);
  if (!located.loc) return { text: null, via: 'none', located };
  let text = ((await located.loc.textContent({ timeout: 1000 }).catch(() => null)) ?? '').trim();
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
export async function freshnessScan(page: Page): Promise<Indicator[]> {
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
// Reachability: exists, visible, inside the viewport, not covered (elementFromPoint), enabled.
// ---------------------------------------------------------------------------------------------
export type Reach = { ok: boolean; exists: boolean; visible: boolean; inViewport: boolean; uncovered: boolean; enabled: boolean; coveredBy?: string; via: Via; reason?: string };

export async function reachability(page: Page, t: Target): Promise<Reach> {
  const located = await locate(page, t);
  const base = { exists: false, visible: false, inViewport: false, uncovered: false, enabled: false, via: located.via };
  if (!located.loc) return { ...base, ok: false, reason: 'not found by testid, role or text' };
  const loc = located.loc;
  const visible = await loc.isVisible();
  const enabled = await loc.isEnabled().catch(() => true);
  const geo = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const inViewport = r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    const describe = (e: Element | null) =>
      !e ? 'nothing' : `${e.tagName.toLowerCase()}${e.getAttribute('data-testid') ? `[data-testid=${e.getAttribute('data-testid')}]` : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.split(/\s+/)[0] : ''}`;
    // Centre plus two inner points: covered = the top-most element there is not this control or inside it.
    const pts = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5]].map(([fx, fy]) => [r.left + r.width * fx, r.top + r.height * fy]);
    const hits = pts.map(([x, y]) => document.elementFromPoint(x, y));
    const blocker = hits.find((h) => !h || !(h === el || el.contains(h)));
    return { inViewport, uncovered: !blocker, coveredBy: blocker === undefined ? undefined : describe(blocker) };
  });
  const ok = visible && enabled && geo.inViewport && geo.uncovered;
  const reason = !visible ? 'not visible' : !geo.inViewport ? 'outside the viewport' : !geo.uncovered ? `covered by ${geo.coveredBy}` : !enabled ? 'disabled' : undefined;
  return { ok, exists: true, visible, enabled, inViewport: geo.inViewport, uncovered: geo.uncovered, coveredBy: geo.coveredBy, via: located.via, reason };
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
