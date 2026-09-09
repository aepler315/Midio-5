// Optional custom recording entry point; omitting wavPath generates the
// same fixture as npm run test:smoke. Use a recording >= 15 seconds long.
// Usage: node tools/smoke-audio.mjs [wavPath] [url] [outDir]
import { runAudioSmoke } from './smoke.mjs';

runAudioSmoke({ wavPath: process.argv[2], url: process.argv[3], outDir: process.argv[4] })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
