/**
 * Evidence HUD injected into the page under test so every recording explains itself:
 * scenario id + title + brief line, starting state, steps ticking off, API calls, a live
 * truth-vs-UI table, red boxes on failing elements, and the final verdict banner.
 *
 * Isolation from the app under test (so the HUD can never change a verdict):
 *  - lives in a CLOSED shadow root on <html> (outside <body>): Playwright locators and our
 *    DOM scans never see its text;
 *  - pointer-events:none and aria-hidden: elementFromPoint and getByRole ignore it;
 *  - every value is HTML-escaped (UI text can be hostile, e.g. the XSS scenario).
 */
import type { ElementHandle, Locator, Page } from 'playwright';
import { PAGE_SHIM } from './config.ts';

export type StepState = 'todo' | 'run' | 'ok' | 'fail' | 'skip';
export type HudRow = { field: string; truth: string; ui: string; ok: boolean | null };
export type VerdictKind = 'BUG' | 'PASS' | 'INTENDED' | 'SETUP-FAILED' | 'ERROR';
type Box = { x: number; y: number; w: number; h: number; label: string; color: string; align: 'left' | 'right'; below?: boolean };
export type BoxOpts = { color?: string; align?: 'left' | 'right'; below?: boolean };

export type HudState = {
  id: string;
  title: string;
  brief: string;
  start: string;
  t0: number;
  steps: { label: string; state: StepState; detail?: string }[];
  rowsTitle: string;
  rowsCols: [string, string, string];
  rows: HudRow[];
  note?: string;
  api: string[];
  boxes: Box[];
  countdown?: { label: string; until: number; total: number };
  verdict?: { kind: VerdictKind; headline: string; sub?: string };
  /** Banner placement override (phone harness: beside the device instead of over the map). */
  verdictPos?: { left: number; right: number; top: string };
  log?: { title: string; lines: { text: string; bad?: boolean }[] };
  card: boolean;
};

export class Hud {
  s: HudState;
  private boxTargets: { key: string; loc: Locator | ElementHandle; label: string; color: string; align: 'left' | 'right'; below?: boolean }[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private page: Page,
    meta: { id: string; title: string; brief: string; start: string; steps: string[] },
  ) {
    this.s = {
      ...meta,
      t0: Date.now(),
      steps: meta.steps.map((label) => ({ label, state: 'todo' as StepState })),
      rowsTitle: 'TRUTH vs UI',
      rowsCols: ['FIELD', 'TRUTH', 'UI'],
      rows: [],
      api: [],
      boxes: [],
      card: false,
    };
    // Re-mount after every navigation (the HUD lives in the page's DOM).
    page.on('load', () => void this.render());
  }

  step(i: number, state: StepState, detail?: string) {
    const st = this.s.steps[i];
    if (st) Object.assign(st, { state }, detail !== undefined ? { detail } : {});
    return this.render();
  }

  rows(rows: HudRow[], title = 'TRUTH vs UI', cols: [string, string, string] = ['FIELD', 'TRUTH', 'UI']) {
    this.s.rows = rows;
    this.s.rowsTitle = title;
    this.s.rowsCols = cols;
    return this.render();
  }

  note(text: string | undefined) {
    this.s.note = text;
    return this.render();
  }

  api(line: string) {
    this.s.api = [...this.s.api, line].slice(-4);
    if (this.s.log) this.s.api = this.s.api.slice(-3);
    return this.render();
  }

  /** Free-form evidence lines (e.g. every UI jump, or one line per screen size). */
  log(title: string, lines: { text: string; bad?: boolean }[]) {
    this.s.log = { title, lines: lines.slice(-6) };
    return this.render();
  }

  verdictAt(pos: { left: number; right: number; top: string }) {
    this.s.verdictPos = pos;
  }

  countdown(label: string, ms: number) {
    this.s.countdown = { label, until: Date.now() + ms, total: ms };
    return this.render();
  }

  clearCountdown() {
    this.s.countdown = undefined;
    return this.render();
  }

  card(on: boolean) {
    this.s.card = on;
    return this.render();
  }

  /**
   * Red outline around an element; calling again with the same key updates its label in place.
   * Not rendered on its own: it shows with the next rows()/step()/render(), so boxes and table stay in sync.
   */
  box(key: string, loc: Locator | ElementHandle | null | undefined, label: string, opts: BoxOpts = {}) {
    if (!loc) return;
    const entry = { key, loc, label, color: opts.color ?? '#ff3b30', align: opts.align ?? 'left', below: opts.below };
    const i = this.boxTargets.findIndex((b) => b.key === key);
    if (i >= 0) this.boxTargets[i] = entry;
    else this.boxTargets.push(entry);
  }

  clearBoxes() {
    this.boxTargets = [];
    return this.render();
  }

  verdict(kind: VerdictKind, headline: string, sub?: string) {
    this.s.verdict = { kind, headline, sub };
    this.s.countdown = undefined;
    return this.render();
  }

  /** Serialised so overlapping updates never interleave; failures (mid-navigation) are ignored. */
  render(): Promise<void> {
    this.chain = this.chain.then(async () => {
      if (this.page.isClosed()) return;
      const boxes: Box[] = [];
      for (const b of this.boxTargets) {
        const r = await ('first' in b.loc ? b.loc.boundingBox({ timeout: 500 }) : b.loc.boundingBox()).catch(() => null);
        if (r) boxes.push({ x: r.x, y: r.y, w: r.width, h: r.height, label: b.label, color: b.color, align: b.align, below: b.below });
      }
      this.s.boxes = boxes;
      await this.page.evaluate(PAGE_SHIM).catch(() => {});
      await this.page.evaluate(renderHud, this.s).catch(() => {});
    });
    return this.chain;
  }
}

/** Runs in the page. Plain DOM, no dependencies. */
function renderHud(s: HudState) {
  const w = window as any;
  const esc = (v: unknown) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
  let host = document.querySelector('[data-qa-overlay]') as HTMLElement | null;
  if (!host || !w.__qaHud) {
    host?.remove();
    host = document.createElement('div');
    host.setAttribute('data-qa-overlay', '');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    w.__qaHud = host.attachShadow({ mode: 'closed' });
    document.documentElement.appendChild(host);
  }
  const root: ShadowRoot = w.__qaHud;
  w.__qaT0 = s.t0;
  w.__qaCd = s.countdown;

  const icon: Record<string, string> = { todo: '○', run: '▶', ok: '✓', fail: '✗', skip: '–' };
  const mark = (ok: boolean | null) => (ok === null ? '·' : ok ? '✓' : '✗');
  const vColor: Record<string, string> = { BUG: '#da3633', PASS: '#238636', INTENDED: '#9e6a03', 'SETUP-FAILED': '#6e7681', ERROR: '#6e7681' };

  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel { position: fixed; top: 64px; right: 12px; width: 410px; max-height: calc(100vh - 76px); overflow: hidden;
      background: rgba(8,12,18,.93); color: #e6edf3; border: 1px solid #30363d; border-radius: 10px;
      font: 12px/1.38 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; box-shadow: 0 8px 30px rgba(0,0,0,.55); }
    .hdr { display: flex; justify-content: space-between; padding: 5px 10px; background: #161b22; border-bottom: 1px solid #30363d; font-size: 10.5px; color: #8b949e; letter-spacing: .05em; }
    .rec { color: #ff7b72; font-weight: 700; }
    .sc { padding: 8px 10px 6px; }
    .id { display: inline-block; background: #1f6feb; color: #fff; font-weight: 700; padding: 1px 7px; border-radius: 4px; margin-right: 6px; }
    .title { font: 700 14px/1.3 system-ui, sans-serif; }
    .brief { margin-top: 4px; color: #a5b1bd; font: italic 11.5px/1.35 system-ui, sans-serif; }
    .sec { padding: 6px 10px; border-top: 1px solid #21262d; }
    .lbl { color: #8b949e; font-size: 9.5px; letter-spacing: .1em; margin-bottom: 3px; }
    .start { color: #c9d1d9; font-size: 11px; }
    .step { display: flex; gap: 6px; }
    .ic { width: 12px; text-align: center; flex: none; }
    .todo { color: #6e7681; } .run { color: #e3b341; } .ok { color: #3fb950; } .fail { color: #ff7b72; } .skip { color: #6e7681; }
    .d { color: #8b949e; font-size: 10.5px; padding-left: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    table { width: 100%; border-collapse: collapse; }
    th { color: #8b949e; font-weight: 400; font-size: 9.5px; text-align: left; padding: 1px 4px; letter-spacing: .06em; }
    td { padding: 2px 4px; font-size: 11.5px; vertical-align: top; }
    td.m { width: 14px; text-align: center; font-weight: 700; }
    tr.bad td { color: #ffa198; } tr.bad td.m { color: #ff7b72; } tr.good td.m { color: #3fb950; }
    .note { color: #e3b341; font-size: 11px; }
    .lg { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #c9d1d9; }
    .lg.fail { color: #ffa198; }
    .api { color: #79c0ff; font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cdl { color: #e3b341; font-size: 11px; }
    .cd { height: 4px; background: #30363d; border-radius: 2px; overflow: hidden; margin-top: 3px; }
    .cd > i { display: block; height: 100%; width: 100%; background: #e3b341; }
    .box { position: fixed; border-radius: 4px; }
    .box span { position: absolute; left: -3px; top: -21px; color: #fff; font: 700 11px/1.5 system-ui, sans-serif; padding: 0 6px; border-radius: 3px; white-space: nowrap; }
    .box.below span { top: auto; bottom: -21px; }
    .box.rt span { left: auto; right: -3px; }
    .verdict { position: fixed; left: 312px; right: 434px; top: 34%; padding: 14px 18px; border-radius: 10px; color: #fff;
      font: 700 22px/1.25 system-ui, sans-serif; box-shadow: 0 10px 40px rgba(0,0,0,.6); border: 2px solid rgba(255,255,255,.25); }
    .verdict small { display: block; margin-top: 6px; font: 500 13px/1.4 system-ui, sans-serif; opacity: .95; }
    .verdict .k { display: inline-block; background: rgba(0,0,0,.25); padding: 0 8px; border-radius: 4px; margin-right: 8px; }
    .card { position: fixed; inset: 0; display: grid; place-items: center; background: #0b0f14; color: #e6edf3; font-family: system-ui, sans-serif; }
    .card .in { max-width: 820px; padding: 32px; }
    .card .cid { color: #58a6ff; font: 700 16px ui-monospace, monospace; letter-spacing: .08em; }
    .card h1 { font-size: 36px; margin: 8px 0 14px; }
    .card blockquote { margin: 0 0 16px; padding-left: 12px; border-left: 3px solid #30363d; color: #a5b1bd; font-style: italic; font-size: 17px; }
    .card .st { color: #c9d1d9; font: 14px ui-monospace, monospace; }
    .card .ft { margin-top: 20px; color: #6e7681; font-size: 13px; }
    @media (max-width: 800px) {
      .panel { top: auto; bottom: 0; left: 0; right: 0; width: auto; max-height: 44vh; border-radius: 10px 10px 0 0; font-size: 10px; }
      .verdict { left: 8px; right: 8px; top: 18%; font-size: 17px; }
      .card h1 { font-size: 26px; }
    }`;

  const steps = s.steps
    .map((st, i) => `<div class="step ${st.state}"><span class="ic">${icon[st.state]}</span><span>${i + 1}. ${esc(st.label)}</span></div>${st.detail ? `<div class="d">${esc(st.detail)}</div>` : ''}`)
    .join('');
  const rows = s.rows.length
    ? `<table><tr><th>${esc(s.rowsCols[0])}</th><th>${esc(s.rowsCols[1])}</th><th>${esc(s.rowsCols[2])}</th><th></th></tr>${s.rows
        .map((r) => `<tr class="${r.ok === false ? 'bad' : r.ok ? 'good' : ''}"><td>${esc(r.field)}</td><td>${esc(r.truth)}</td><td>${esc(r.ui)}</td><td class="m">${mark(r.ok)}</td></tr>`)
        .join('')}</table>`
    : '<div class="todo">waiting for first sample…</div>';
  const boxes = s.boxes
    .map((b) => `<div class="box ${b.y < 26 || b.below ? 'below' : ''} ${b.align === 'right' || b.x + b.label.length * 7 + 12 > innerWidth ? 'rt' : ''}" style="left:${b.x - 4}px;top:${b.y - 4}px;width:${b.w + 8}px;height:${b.h + 8}px;border:3px solid ${b.color};box-shadow:0 0 14px ${b.color}">${b.label ? `<span style="background:${b.color}">${esc(b.label)}</span>` : ''}</div>`)
    .join('');
  const vp = s.verdictPos ? `left:${s.verdictPos.left}px;right:${s.verdictPos.right}px;top:${s.verdictPos.top};` : '';
  const verdict = s.verdict
    ? `<div class="verdict" style="${vp}background:${vColor[s.verdict.kind]}"><span class="k">${esc(s.verdict.kind)}</span>${esc(s.id)} · ${esc(s.verdict.headline)}${s.verdict.sub ? `<small>${esc(s.verdict.sub)}</small>` : ''}</div>`
    : '';
  const card = s.card
    ? `<div class="card"><div class="in"><div class="cid">${esc(s.id)} · TIRELESS HAND QA · LEVEL 1</div><h1>${esc(s.title)}</h1><blockquote>Product brief: “${esc(s.brief)}”</blockquote><div class="st">START ▸ ${esc(s.start)}</div><div class="ft">Real-time screen recording · deterministic Playwright · zero LLM calls in the test loop</div></div></div>`
    : '';

  root.innerHTML = `<style>${css}</style>${boxes}
    <div class="panel">
      <div class="hdr"><span>TIRELESS QA · LEVEL 1</span><span class="rec">● REC <span id="clk">t+${((Date.now() - s.t0) / 1000).toFixed(1)} s</span></span></div>
      <div class="sc"><span class="id">${esc(s.id)}</span><span class="title">${esc(s.title)}</span><div class="brief">Brief: “${esc(s.brief)}”</div></div>
      <div class="sec"><div class="lbl">START STATE</div><div class="start">${esc(s.start)}</div></div>
      <div class="sec"><div class="lbl">STEPS</div>${steps}</div>
      ${s.countdown ? `<div class="sec"><div class="cdl" id="cdl">${esc(s.countdown.label)}</div><div class="cd"><i id="cdbar"></i></div></div>` : ''}
      <div class="sec"><div class="lbl">${esc(s.rowsTitle)}</div>${rows}${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}</div>
      ${s.log ? `<div class="sec"><div class="lbl">${esc(s.log.title)}</div>${s.log.lines.map((l) => `<div class="lg ${l.bad ? 'fail' : ''}">${esc(l.text)}</div>`).join('')}</div>` : ''}
      <div class="sec"><div class="lbl">API CALLS</div>${s.api.map((a) => `<div class="api">${esc(a)}</div>`).join('') || '<div class="todo">—</div>'}</div>
    </div>${verdict}${card}`;

  // Wall-clock ticker (proves real time between renders) and countdown bar.
  if (!w.__qaClock)
    w.__qaClock = setInterval(() => {
      const r: ShadowRoot | undefined = w.__qaHud;
      const clk = r?.getElementById('clk');
      if (clk) clk.textContent = `t+${((Date.now() - w.__qaT0) / 1000).toFixed(1)} s`;
      const bar = r?.getElementById('cdbar');
      const cd = w.__qaCd;
      if (bar && cd) bar.style.width = `${Math.max(0, Math.min(100, ((cd.until - Date.now()) / cd.total) * 100))}%`;
    }, 100);
}
