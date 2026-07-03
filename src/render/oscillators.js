// Pure geometric oscillator math for the "resonance" visual layer: modal
// ring vibration (struck-membrane physics for the wireframe characters)
// and hypotrochoid (spirograph) curves for the background mandala. No
// canvas, no DOM -- everything here is unit-testable in Node.
import { mulberry32 } from '../utils/math.js';

const PER_MODE_CAP_PX = 3;

/**
 * Modal vibration of a closed ring, the way a struck cymbal or drumhead
 * actually moves: a sum of circumferential modes, each a traveling wave
 *   d_k(theta, t) = A_k * sin(m_k*theta + s_k*omega_k*t + phi_k)
 * with an inharmonic "stiffened plate" spectrum (omega grows faster than
 * linearly in mode number) and higher modes ringing down faster -- both
 * physically true and what makes the wobble read as material rather than
 * as jello. Amplitudes are in px; excite() strikes it, update() decays it.
 */
export class ModalRing {
  constructor({ modes = 4, baseHz = 8, decaySec = 0.5, seed = 1 } = {}) {
    this.rand = mulberry32(seed);
    this.t = 0;
    this.modes = [];
    for (let k = 0; k < modes; k++) {
      this.modes.push({
        m: k + 2, // wavenumber starts at 2: m=0 is uniform breathing, m=1 is rigid translation
        omega: 2 * Math.PI * baseHz * (1 + 0.62 * k), // stiffened (inharmonic) spectrum
        tau: decaySec / (1 + 0.8 * k), // higher modes die faster
        phase: this.rand() * Math.PI * 2,
        dir: k % 2 === 0 ? 1 : -1, // alternate traveling direction per mode
        A: 0,
      });
    }
  }

  /** Strike the ring: strength is roughly px of total displacement injected. */
  excite(strength) {
    for (const md of this.modes) {
      md.A = Math.min(PER_MODE_CAP_PX, md.A + (strength * (0.5 + 0.5 * this.rand())) / (1 + 0.45 * (md.m - 2)));
      md.phase = this.rand() * Math.PI * 2; // a re-strike scrambles phase, like a real re-hit
    }
  }

  update(dtSec) {
    this.t += dtSec;
    for (const md of this.modes) md.A *= Math.exp(-dtSec / md.tau);
  }

  /** Total live amplitude in px -- used as a cheap early-out gate. */
  get energy() {
    let s = 0;
    for (const md of this.modes) s += md.A;
    return s;
  }

  /** Radial displacement (px) at angular position theta right now. */
  displacementAt(theta) {
    let d = 0;
    for (const md of this.modes) {
      d += md.A * Math.sin(md.m * theta + md.dir * md.omega * this.t + md.phase);
    }
    return d;
  }
}

/**
 * Hypotrochoid (spirograph) point: a circle of radius r rolling inside a
 * circle of radius R, pen at distance d from the rolling center.
 * With R=p, r=q coprime integers the curve closes after theta = 2*pi*q,
 * tracing p-q "petals" -- the classic spirograph rose.
 */
export function hypotrochoid(theta, R, r, d) {
  const k = (R - r) / r;
  return {
    x: (R - r) * Math.cos(theta) + d * Math.cos(k * theta),
    y: (R - r) * Math.sin(theta) - d * Math.sin(k * theta),
  };
}
