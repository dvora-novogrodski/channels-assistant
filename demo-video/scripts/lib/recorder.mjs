// Records a page as timestamped JPEG frames (Chrome screencast) plus labelled marks on the same clock.
// The build step turns frames + marks into a paced video, so cuts and captions follow the marks automatically.
import fs from 'fs';
import path from 'path';

export async function startRecording(page, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });

  const frames = [];
  const marks = [];
  const cdp = await page.context().newCDPSession(page);

  cdp.on('Page.screencastFrame', (frame) => {
    const file = `${String(frames.length).padStart(6, '0')}.jpg`;
    fs.writeFileSync(path.join(outDir, 'frames', file), Buffer.from(frame.data, 'base64'));
    frames.push({ file, t: frame.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });

  const startedAt = Date.now() / 1000;
  return {
    mark(label) {
      const t = Date.now() / 1000;
      marks.push({ label, t });
      console.log(`${(t - startedAt).toFixed(1).padStart(6)}s  ${label}`);
    },
    async stop(extra = {}) {
      await cdp.send('Page.stopScreencast').catch(() => {});
      fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify({ frames, marks, ...extra }, null, 2));
      return { frames: frames.length, marks: marks.length };
    },
  };
}
