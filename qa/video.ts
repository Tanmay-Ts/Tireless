/**
 * Upload-ready videos from the recordings (real time: frames are re-encoded, never sped up):
 *   out/mp4/<id>.mp4              one per scenario / check / mutation run (H.264, 25 fps, no audio)
 *   out/level1-all-scenarios.mp4  S1–S4, P1, then the mutation runs, back to back; each opens with its own title card
 *
 *   npm run video                  # everything in out/videos
 *   npm run video -- S1 S2 S3 S4   # only these, in this order, into the combined file
 *                                  # (ids not in out/videos are taken from qa/recordings/videos)
 * Needs ffmpeg on PATH, or FFMPEG=/path/to/ffmpeg.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cfg, QA_ROOT } from './config.ts';

const ff = process.env.FFMPEG ?? 'ffmpeg';
if (spawnSync(ff, ['-version']).status !== 0) {
  console.error('ffmpeg not found. Install it (macOS: brew install ffmpeg · Windows: winget install ffmpeg · Linux: apt install ffmpeg) or set FFMPEG=/path/to/ffmpeg.');
  process.exit(2);
}

const videos = path.join(cfg.outDir, 'videos');
/** Cloud recordings committed to the repo (mutation runs, S1-fixed): used when a run is not in out/videos. */
const cloud = path.join(QA_ROOT, 'recordings', 'videos');
const src = (id: string) => [path.join(videos, `${id}.webm`), path.join(cloud, `${id}.webm`)].find((f) => existsSync(f)) as string;
const mp4 = path.join(cfg.outDir, 'mp4');
mkdirSync(mp4, { recursive: true });

const rank = (id: string) => (/^S\d/.test(id) ? 0 : /^P\d/.test(id) ? 1 : id === 'K-clean' ? 2 : /^K-m/.test(id) ? 3 : 4);
const list = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.webm')).map((f) => f.replace(/\.webm$/, '')) : []);
const available = [...new Set([...list(videos), ...(process.argv.length > 2 ? list(cloud) : [])])];
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
  run(['-i', src(id), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '25', '-an', path.join(mp4, `${id}.mp4`)]);
  console.log(`mp4/${id}.mp4  ${(statSync(path.join(mp4, `${id}.mp4`)).size / 1e6).toFixed(1)} MB`);
}

const listFile = path.join(mp4, 'concat.txt');
// Names relative to the list file: no drive letters or backslashes for ffmpeg to trip over on Windows.
writeFileSync(listFile, ids.map((id) => `file '${id}.mp4'`).join('\n') + '\n');
const combined = path.join(cfg.outDir, 'level1-all-scenarios.mp4');
run(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', combined]);
console.log(`\n${path.relative(process.cwd(), combined)}  ${(statSync(combined).size / 1e6).toFixed(1)} MB  (${ids.join(' → ')})`);
