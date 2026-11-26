// Turns recordings/<clip>/{frames, timeline.json} into paced MP4 clips for the composition.
// Waiting for the AI (from "send:X" to "reply:X") is compressed to WAIT_SECONDS; everything else plays in real time.
// Writes composition/assets/recordings/<clip>.mp4 and composition/timeline.json (mark times inside each clip).
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';

const ROOT = path.resolve(import.meta.dirname, '..');
const RECORDINGS = path.join(ROOT, 'recordings');
const CLIPS_DIR = path.join(ROOT, 'composition/assets/recordings');
const WAIT_SECONDS = 2;
const WAIT_START_DELAY = 0.8;
const LAST_FRAME_SECONDS = 1.5;
const FPS = 30;

function waitWindows(marks) {
  const sends = marks.filter(({ label }) => label.startsWith('send:'));
  return sends.flatMap((send) => {
    const reply = marks.find(({ label, t }) => label === `reply:${send.label.slice(5)}` && t > send.t);
    if (!reply) return [];
    const start = send.t + WAIT_START_DELAY;
    const length = reply.t - start;
    return length > WAIT_SECONDS ? [{ start, end: reply.t, speed: length / WAIT_SECONDS }] : [];
  });
}

// Output time of a recording timestamp: real time, except inside wait windows where time runs `speed` times faster.
function createTimeMap(origin, windows) {
  return (t) => {
    let output = t - origin;
    for (const window of windows) {
      const overlap = Math.min(t, window.end) - Math.max(origin, window.start);
      if (overlap > 0) output -= overlap * (1 - 1 / window.speed);
    }
    return output;
  };
}

function buildClip(name) {
  const sourceDir = path.join(RECORDINGS, name);
  const { frames, marks, crop } = JSON.parse(fs.readFileSync(path.join(sourceDir, 'timeline.json'), 'utf8'));
  const origin = frames[0].t;
  const toOutput = createTimeMap(origin, waitWindows(marks));

  // A still screen produces no new frames, so the last frame is held until the final mark.
  const endT = Math.max(frames.at(-1).t, marks.at(-1)?.t ?? 0);
  const lastFrameSeconds = toOutput(endT) - toOutput(frames.at(-1).t) + LAST_FRAME_SECONDS;
  const lines = frames.flatMap((frame, index) => {
    const next = frames[index + 1];
    const duration = next ? toOutput(next.t) - toOutput(frame.t) : lastFrameSeconds;
    return [`file 'frames/${frame.file}'`, `duration ${Math.max(duration, 0.001).toFixed(4)}`];
  });
  lines.push(`file 'frames/${frames.at(-1).file}'`);
  const listFile = path.join(sourceDir, 'frames.txt');
  fs.writeFileSync(listFile, lines.join('\n'));

  const even = (value) => value - (value % 2);
  const filters = [
    crop && `crop=${even(crop.width)}:${even(crop.height)}:${crop.x}:${crop.y}`,
    `fps=${FPS}`,
    'format=yuv420p',
  ].filter(Boolean);
  const output = path.join(CLIPS_DIR, `${name}.mp4`);
  execFileSync(
    ffmpegPath,
    ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', filters.join(','), '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', output],
    { cwd: sourceDir, stdio: 'inherit' },
  );

  const duration = toOutput(endT) + LAST_FRAME_SECONDS;
  const markTimes = Object.fromEntries(marks.map(({ label, t }) => [label, +Math.max(0, toOutput(t)).toFixed(2)]));
  console.log(`${name}: ${duration.toFixed(1)}s (recorded ${(frames.at(-1).t - origin).toFixed(1)}s)`);
  return { file: `assets/recordings/${name}.mp4`, duration: +duration.toFixed(2), crop: crop ?? null, marks: markTimes };
}

fs.mkdirSync(CLIPS_DIR, { recursive: true });
const clips = ['web', 'isolation', 'slack']
  .filter((name) => fs.existsSync(path.join(RECORDINGS, name, 'timeline.json')))
  .map((name) => [name, buildClip(name)]);
fs.writeFileSync(path.join(ROOT, 'composition/timeline.json'), JSON.stringify(Object.fromEntries(clips), null, 2));
console.log('Wrote composition/timeline.json');
