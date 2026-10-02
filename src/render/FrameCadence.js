// Draw skipping never owns simulation or audio advancement.
export function shouldDrawFrame(nowMs, previousDrawMs, fps) {
  return previousDrawMs == null || nowMs - previousDrawMs >= 1000 / (Math.round(fps) === 30 ? 30 : 60) - 1;
}
