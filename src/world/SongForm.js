// Song-form recognition: which sections are the SAME music. The section
// schedule (BiomeManager._buildSchedule) cuts boundaries at energy-novelty
// peaks, but a boundary list has no memory -- it never notices that verse 2
// is verse 1 again, or that the chorus has returned. This labels sections
// so recurrences can wear the same face: every chorus the same world/color,
// every verse another.
//
// The feature that says "same music" is a section's mean 7-band spectral
// SHAPE (its timbral fingerprint -- bass-heavy drop vs airy breakdown vs
// mid-forward verse), compared by cosine similarity so loudness alone
// doesn't decide identity, gated by a coarse energy-proximity check so two
// differently-voiced sections that happen to sit at the same loudness don't
// merge. Pure/DOM-free, like the other analysis modules (Dramaturgy,
// PhraseTracker, MountainChoreo).

/** Cosine similarity of two equal-length vectors, in [-1, 1]; 0 for a
 *  zero-magnitude vector (no shape to compare). */
export function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const den = Math.sqrt(na * nb);
  return den > 1e-12 ? dot / den : 0;
}

/**
 * Greedy agglomerative labelling of a section sequence into structural
 * classes (A=0, B=1, C=2, ...). A section joins the existing label whose
 * running centroid it most resembles when the band-shape cosine similarity
 * clears `simThreshold` AND the energy sits within `energyTol`; otherwise it
 * founds a new label. First-appearance order, so an A-B-A-C-B song reads
 * back exactly [0,1,0,2,1].
 *
 * @param {Array<{energy:number, shape:number[]}>} sectionFeatures
 * @returns {number[]} one integer label per section
 */
export function analyzeSongForm(sectionFeatures, { simThreshold = 0.9, energyTol = 0.22 } = {}) {
  const labels = [];
  // Per-label running centroid: summed shape + summed energy + count, so the
  // centroid is the mean of every section assigned so far (a returning
  // chorus is matched against the average of all prior choruses, not just
  // the last one).
  const centroids = []; // { shapeSum:number[], energySum:number, count:number }

  for (const feat of sectionFeatures) {
    let best = -1, bestSim = -Infinity;
    for (let c = 0; c < centroids.length; c++) {
      const cen = centroids[c];
      const centroidShape = cen.shapeSum.map((s) => s / cen.count);
      const centroidEnergy = cen.energySum / cen.count;
      if (Math.abs(feat.energy - centroidEnergy) > energyTol) continue;
      const sim = cosineSim(feat.shape, centroidShape);
      if (sim >= simThreshold && sim > bestSim) { bestSim = sim; best = c; }
    }

    if (best === -1) {
      centroids.push({ shapeSum: [...feat.shape], energySum: feat.energy, count: 1 });
      labels.push(centroids.length - 1);
    } else {
      const cen = centroids[best];
      for (let k = 0; k < feat.shape.length; k++) cen.shapeSum[k] += feat.shape[k];
      cen.energySum += feat.energy;
      cen.count++;
      labels.push(best);
    }
  }

  return labels;
}
