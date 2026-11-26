// Renders composition/ to out/travel-assistant-demo.mp4. HyperFrames needs ffmpeg and ffprobe on PATH,
// so the bundled binaries from ffmpeg-static and ffprobe-static are added first.
import { execSync } from 'child_process';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

const ROOT = path.resolve(import.meta.dirname, '..');
const binDirs = [path.dirname(ffmpegPath), path.dirname(ffprobe.path)];
const env = { ...process.env, PATH: [...binDirs, process.env.PATH].join(path.delimiter) };

execSync('npx --yes hyperframes@0.9.34 render --output ../out/travel-assistant-demo.mp4', {
  cwd: path.join(ROOT, 'composition'),
  env,
  stdio: 'inherit',
});
