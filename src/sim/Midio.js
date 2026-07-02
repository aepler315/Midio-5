// The player character. Screen-space x is fixed; the world scrolls under him.
export class Midio {
  constructor() {
    this.screenX = 220;
    this.groundY = 480;
    this.y = 0;          // px above ground (from JumpController)
    this.scaleX = 1;
    this.scaleY = 1;
    this.leanDeg = 0;
    this.facing = 1;
    this.halfWidth = 23;
    this.poseExtras = {};
  }

  get renderY() { return this.groundY - this.y; }
}
