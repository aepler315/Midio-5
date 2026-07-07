// Fourier epicycle math: decompose a closed 2D path into a discrete
// Fourier series, so a chain of circles -- each rotating at an integer
// frequency k with radius |c_k| -- literally draws the path with its
// endpoint. The complex DFT of the path's uniform arc-length samples IS
// the circle chain: magnitude = radius, argument = starting angle,
// index = rotation speed. Ptolemy's deferents and epicycles, vindicated
// as a Fourier basis two millennia later.

/** Close an open stroke by retracing it backward -- makes it periodic
 * with no jump, so the DFT converges cleanly. The pen simply redraws
 * the same line on the way back. */
export function closeStroke(points) {
  const out = points.slice();
  for (let i = points.length - 2; i >= 1; i--) out.push(points[i]);
  return out;
}

/** Resample a closed polyline to n points spaced uniformly by arc length. */
export function resampleClosed(points, n) {
  const m = points.length;
  const cum = [0];
  let total = 0;
  for (let i = 0; i < m; i++) {
    const a = points[i], b = points[(i + 1) % m];
    total += Math.hypot(b.x - a.x, b.y - a.y);
    cum.push(total);
  }
  if (total === 0) return Array.from({ length: n }, () => ({ ...points[0] }));

  const out = [];
  let seg = 0;
  for (let j = 0; j < n; j++) {
    const target = (j / n) * total;
    while (seg < m - 1 && cum[seg + 1] < target) seg++;
    const a = points[seg], b = points[(seg + 1) % m];
    const span = cum[seg + 1] - cum[seg];
    const t = span > 0 ? (target - cum[seg]) / span : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/**
 * Complex DFT of uniform samples, returned as the epicycle chain:
 * [{k, re, im, mag}] sorted by magnitude descending (biggest circle
 * first, the classic presentation). Keep the top maxK terms.
 */
export function dftCoefficients(samples, maxK = Infinity) {
  const N = samples.length;
  const coeffs = [];
  const kLo = -Math.floor(N / 2), kHi = Math.ceil(N / 2);
  for (let k = kLo; k < kHi; k++) {
    let re = 0, im = 0;
    for (let j = 0; j < N; j++) {
      const ang = (-2 * Math.PI * k * j) / N;
      const c = Math.cos(ang), s = Math.sin(ang);
      re += samples[j].x * c - samples[j].y * s;
      im += samples[j].x * s + samples[j].y * c;
    }
    re /= N; im /= N;
    coeffs.push({ k, re, im, mag: Math.hypot(re, im) });
  }
  coeffs.sort((a, b) => b.mag - a.mag);
  return coeffs.slice(0, Math.min(coeffs.length, maxK));
}

/**
 * Positions of every joint in the circle chain at path-time t in [0,1):
 * out[i] is the center of circle i; the last entry is the pen tip.
 */
export function chainPoints(coeffs, t) {
  const out = [{ x: 0, y: 0 }];
  let x = 0, y = 0;
  for (const c of coeffs) {
    const ang = 2 * Math.PI * c.k * t;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    x += c.re * cos - c.im * sin;
    y += c.re * sin + c.im * cos;
    out.push({ x, y });
  }
  return out;
}

/** Just the pen tip -- cheaper when the chain itself isn't being drawn. */
export function penPoint(coeffs, t) {
  let x = 0, y = 0;
  for (const c of coeffs) {
    const ang = 2 * Math.PI * c.k * t;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    x += c.re * cos - c.im * sin;
    y += c.re * sin + c.im * cos;
  }
  return { x, y };
}
