/**
 * Device harness for phone/tablet scenarios in a desktop-sized recording.
 *
 * The cockpit is loaded in an iframe whose CSS viewport is exactly the device size (media queries,
 * innerWidth, elementFromPoint all evaluate inside the iframe), shown scaled next to the HUD, so the
 * recording shows the phone layout AND the evidence panel without one covering the other.
 * Touch/DPR/mobile-UA fidelity is covered separately by `crossCheckOnDevice()` in a real
 * Playwright device-emulation context.
 */
import { devices, type Browser, type Frame, type Page } from 'playwright';
import { sleep } from './config.ts';

export type Device = { name: string; width: number; height: number; emulate?: string };

export const DEVICES = {
  laptop: { name: 'Laptop', width: 1366, height: 768 },
  ipad: { name: 'iPad Mini', width: 768, height: 1024, emulate: 'iPad Mini' },
  pixel7: { name: 'Pixel 7', width: 412, height: 915, emulate: 'Pixel 7' },
  iphone13: { name: 'iPhone 13', width: 390, height: 844, emulate: 'iPhone 13' },
  iphoneSE: { name: 'iPhone SE', width: 375, height: 667, emulate: 'iPhone SE' },
  galaxyS8: { name: 'Galaxy S8', width: 360, height: 740, emulate: 'Galaxy S8' },
  small: { name: 'Small phone', width: 320, height: 568 },
} satisfies Record<string, Device>;

/** Area of the 1440×900 recording left free by the HUD (410 px panel on the right). */
const AREA = { left: 36, top: 44, width: 1440 - 434 - 60, height: 900 - 44 - 24 };

export class DeviceFrame {
  frame!: Frame;
  device!: Device;
  scale = 1;

  constructor(private page: Page) {}

  private scaleFor(d: Device) {
    return Math.min(1.3, AREA.width / (d.width + 20), (AREA.height - 20) / (d.height + 20));
  }

  async mount(url: string, d: Device) {
    await this.page.setContent(`<!doctype html><html><head><style>
      html, body { margin: 0; height: 100%; background: #0b0f14; overflow: hidden; font-family: system-ui, sans-serif; }
      #label { position: absolute; left: ${AREA.left}px; top: 12px; color: #8b949e; font: 600 13px system-ui; letter-spacing: .03em; }
      #label b { color: #e6edf3; }
      #bezel { position: absolute; left: ${AREA.left}px; top: ${AREA.top}px; border: 10px solid #1c2128; border-radius: 22px; background: #000; box-shadow: 0 0 0 1px #30363d, 0 12px 40px rgba(0,0,0,.6); overflow: hidden; }
      #dut { border: 0; display: block; transform-origin: 0 0; background: #fff; }
    </style></head><body><div id="label"></div><div id="bezel"><iframe id="dut" title="device under test"></iframe></div></body></html>`);
    await this.applySize(d);
    const handle = await this.page.$('#dut');
    await handle!.evaluate((el, src) => ((el as HTMLIFrameElement).src = src), url);
    const frame = await handle!.contentFrame();
    if (!frame) throw new Error('device iframe has no frame');
    await frame.waitForLoadState('domcontentloaded');
    this.frame = frame;
  }

  private async applySize(d: Device) {
    this.device = d;
    this.scale = this.scaleFor(d);
    await this.page.evaluate(
      ({ w, h, s, label }) => {
        const f = document.getElementById('dut') as HTMLIFrameElement;
        f.style.width = `${w}px`;
        f.style.height = `${h}px`;
        f.style.transform = `scale(${s})`;
        const b = document.getElementById('bezel')!;
        b.style.width = `${Math.round(w * s)}px`;
        b.style.height = `${Math.round(h * s)}px`;
        document.getElementById('label')!.innerHTML = label;
      },
      {
        w: d.width,
        h: d.height,
        s: this.scale,
        label: `<b>${d.name}</b> · ${d.width}×${d.height} CSS px · shown at ${Math.round(this.scale * 100)} %${d.width < 800 ? ' · cockpit mobile layout (&lt; 800 px)' : ''}`,
      },
    );
  }

  /** Resize the device viewport (the app re-lays out exactly as on a real screen of that size). */
  async resize(d: Device, settleMs = 900) {
    await this.applySize(d);
    await sleep(settleMs);
  }

  /** Where the device sits in the recording, so the verdict banner can be placed beside it. */
  rect() {
    return { left: AREA.left, top: AREA.top, right: AREA.left + Math.round(this.device.width * this.scale) + 20, bottom: AREA.top + Math.round(this.device.height * this.scale) + 20 };
  }
}

/**
 * Re-run a check in a real Playwright device-emulation context (touch, DPR, mobile UA, isMobile).
 * Not recorded: its result is shown on the HUD as corroboration of what the recording shows.
 */
export async function crossCheckOnDevice<T>(browser: Browser, d: Device, url: string, check: (page: Page) => Promise<T>): Promise<T> {
  const desc = d.emulate ? devices[d.emulate] : undefined;
  const ctx = await browser.newContext(desc ? { ...desc } : { viewport: { width: d.width, height: d.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return await check(page);
  } finally {
    await ctx.close();
  }
}
