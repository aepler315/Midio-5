// The player character. Screen-space x is fixed; the world scrolls under him.
export class Midio {
  constructor() {
    this.screenX = 220;
    // 585 of a 720 stage. Moved down from 540: the composition was giving a
    // third of the frame to ground and underground, and the sky -- where the
    // sun and moon actually happen -- was the thinnest band on screen. The
    // sea horizon in Ocean.js moves by the same 45px so the whole scene
    // translates rather than the land stretching to meet a fixed sky.
    this.groundY = 585;
    this.y = 0;          // px above ground (from JumpController)
    this.slipX = 0;      // render-only skid offset on iced ground (Traction.js)
    this.ridgeBob = 0;   // render-only lift riding the far skyline (RidgeAnchor.js)
    this.scaleX = 1;
    this.scaleY = 1;
    this.leanDeg = 0;
    this.facing = 1;
    this.halfWidth = 23;
  }

  get renderY() { return this.groundY - this.y + this.ridgeBob; }
}
