import { MIDIO_SCALE, CHAR_SCALE_BASE } from '../render/MeshDrawer.js';

// The player character. Screen-space x is fixed; the world scrolls under him.
// Anchor position is a fraction of the actual canvas, not a fixed pixel: at a
// fixed pixel, the whole cast (Midio + companions, both offset relative to
// him) stayed pinned near literal (220, 480) regardless of viewport size, so
// on anything larger than the 1280x720 reference the entire performance
// crammed into the top-left corner instead of using the screen it was given.
const SCREEN_X_FRAC = 0.26;
const GROUND_Y_FRAC = 480 / 720;

export class Midio {
  constructor({ canvasWidth = 1280, canvasHeight = 720 } = {}) {
    this.screenX = canvasWidth * SCREEN_X_FRAC;
    this.groundY = canvasHeight * GROUND_Y_FRAC;
    this.y = 0;          // px above ground (from JumpController)
    this.scaleX = 1;
    this.scaleY = 1;
    this.leanDeg = 0;
    this.facing = 1;
    this.halfWidth = 23 * (MIDIO_SCALE / CHAR_SCALE_BASE);
    this.poseExtras = {};
  }

  get renderY() { return this.groundY - this.y; }
}
