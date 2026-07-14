// Tracks player tap accuracy against the NoteHighway chart. Owns streak /
// score counters and hands judgment results back to main for SFX + HUD.

export class TapScorer {
  constructor() {
    this.perfect = 0;
    this.great = 0;
    this.ok = 0;
    this.miss = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.score = 0;
    this.lastGrade = null;
  }

  reset() {
    this.perfect = 0;
    this.great = 0;
    this.ok = 0;
    this.miss = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.score = 0;
    this.lastGrade = null;
  }

  /** @param {'perfect'|'great'|'ok'|'miss'} grade */
  register(grade) {
    this.lastGrade = grade;
    if (grade === 'miss') {
      this.miss++;
      this.streak = 0;
      return;
    }
    this.streak++;
    if (this.streak > this.maxStreak) this.maxStreak = this.streak;
    if (grade === 'perfect') {
      this.perfect++;
      this.score += 300 + Math.min(50, this.streak) * 2;
    } else if (grade === 'great') {
      this.great++;
      this.score += 200 + Math.min(30, this.streak);
    } else {
      this.ok++;
      this.score += 100;
    }
  }

  get totalHits() {
    return this.perfect + this.great + this.ok + this.miss;
  }

  get accuracy() {
    const t = this.totalHits;
    if (t === 0) return 1;
    // Weighted accuracy: perfect=1, great=0.8, ok=0.5, miss=0.
    const w = this.perfect + this.great * 0.8 + this.ok * 0.5;
    return w / t;
  }

  summary() {
    return {
      perfect: this.perfect,
      great: this.great,
      ok: this.ok,
      miss: this.miss,
      streak: this.maxStreak,
      score: this.score,
      accuracy: this.accuracy,
    };
  }
}
