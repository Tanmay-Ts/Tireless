/**
 * Applying and reverting patches to the kit checkout (KIT_DIR) for mutation and control runs.
 * Refuses to touch a kit with local frontend changes; always reverts, also on Ctrl-C.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { sleep } from './config.ts';

export function kitDir(): string {
  const kit = process.env.KIT_DIR && path.resolve(process.env.KIT_DIR);
  if (!kit || !existsSync(path.join(kit, 'frontend', 'src'))) {
    console.error('Set KIT_DIR to the kit checkout (the folder with frontend/src).');
    process.exit(2);
  }
  return kit;
}

const git = (kit: string, ...args: string[]) => execFileSync('git', ['-C', kit, ...args], { encoding: 'utf8' });

export function assertKitClean(kit: string) {
  if (git(kit, 'status', '--porcelain', '--', 'frontend').trim()) {
    console.error('The kit frontend has local changes; commit or stash them first (patches are applied and reverted with git apply).');
    process.exit(2);
  }
}

let applied: { kit: string; patch: string } | undefined;
const revert = () => {
  if (!applied) return;
  git(applied.kit, 'apply', '-R', applied.patch);
  applied = undefined;
};
process.on('SIGINT', () => {
  revert();
  process.exit(130);
});

/** Apply `patch` to the kit (dev server picks it up), run fn, always revert. No patch = run as is. */
export async function withKitPatch<T>(kit: string, patch: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (patch) {
    git(kit, 'apply', '--check', patch);
    git(kit, 'apply', patch);
    applied = { kit, patch };
    await sleep(2500);
  }
  try {
    return await fn();
  } finally {
    revert();
  }
}
