/**
 * Upload-ready videos from the recordings (real time: frames are re-encoded, never sped up):
 *   out/mp4/<id>.mp4              one per scenario / check / mutation run (H.264, 25 fps, no audio)
 *   out/level1-all-scenarios.mp4  S1–S4, P1, then the mutation runs, back to back; each opens with its own title card
 *
 *   npm run video                  # everything in out/videos
 *   npm run video -- S1 S2 S3 S4   # only these, in this order, into the combined file
 * Needs ffmpeg on PATH, or FFMPEG=/path/to/ffmpeg.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cfg } from './config.ts';

const ff = process.env.FFMPEG ?? 'ffmpeg';
if (spawnSync(ff, ['-version']).status !== 0) {
  console.error('ffmpeg not found. Install it (macOS: brew install ffmpeg · Windows: winget install ffmpeg · Linux: apt install ffmpeg) or set FFMPEG=/path/to/ffmpeg.');
  process.exit(2);
}

const videos = path.join(cfg.outDir, 'videos');
const mp4 = path.join(cfg.outDir, 'mp4');
mkdirSync(mp4, { recursive: true });

const rank = (id: string) => (/^S\d/.test(id) ? 0 : /^P\d/.test(id) ? 1 : id === 'K-clean' ? 2 : /^K-m/.test(id) ? 3 : 4);
const available = existsSync(videos) ? readdirSync(videos).filter((f) => f.endsWith('.webm')).map((f) => f.replace(/\.webm$/, '')) : [];
const args = process.argv.slice(2);
const ids = (args.length ? args : available).filter((id) => available.includes(id)).sort((a, b) => (args.length ? 0 : rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true })));
if (!ids.length) {
  console.error(`no recordings found in ${videos}`);
  process.exit(2);
}

const run = (a: string[]) => {
  const r = spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${a.join(' ')}`);
};

for (const id of ids) {
  run(['-i', path.join(videos, `${id}.webm`), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '25', '-an', path.join(mp4, `${id}.mp4`)]);
  console.log(`mp4/${id}.mp4  ${(statSync(path.join(mp4, `${id}.mp4`)).size / 1e6).toFixed(1)} MB`);
}

const list = path.join(mp4, 'concat.txt');
writeFileSync(list, ids.map((id) => `file '${path.join(mp4, `${id}.mp4`).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
const combined = path.join(cfg.outDir, 'level1-all-scenarios.mp4');
run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', combined]);
console.log(`\n${path.relative(process.cwd(), combined)}  ${(statSync(combined).size / 1e6).toFixed(1)} MB  (${ids.join(' → ')})`);
