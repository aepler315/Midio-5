# Finish the Light — connecting a light system that was built but never plugged in

## Context

**This is a planning document only.** It was written by Claude (Opus) for cost reasons, and will be
**implemented by a different model/agent ("Grok"), not by the session that wrote it.** The implementer
will not have this conversation's context — everything needed to execute must be in this file: exact
file paths, line numbers, function names, and reasoning, not references back to "as discussed."

Two deliverables were requested: an **audit** of the visual-effects suite's current state, and an
**upgrade package** architected off that audit, for the implementer to carry out.

**One choice here is a recommended default, not a confirmed decision** — the user can override it, cheap
to change: the scope is **"Finish the Light"** as described below, rather than a broader package that
also adds beam occlusion or post-process polish (both considered and deferred, see "Dropped from scope"
below).

The audit's finding, in one line: **this suite is mature almost everywhere, and its one real
structural weakness is that the lighting model is half-connected.** Across ~85 visual files
(`src/world/` 39 files/11.1k lines, `src/render/` 20 files/4.0k lines) there are zero TODO/stub
comments, every subsystem carries real math and a doc comment explaining *why*, and 139 test files
hold 1391 green assertions. There is no shortage of depth to deepen. What there is, is
**code that was written, tested, and then never wired to a consumer.**

I verified each claim below by grep rather than trusting the survey:

| Evidence | Verdict |
| --- | --- |
| `lightDirTo` / `dirX` / `dirY` (`LightField.js:36-45`) | **Zero consumers.** The only hits repo-wide are the definition and its own JSDoc. A light *direction* is computed every frame and read by nothing. |
| `contactShadowsEnabled` (`PerfGovernor.js:82`) | **Dead gate.** Read into an unused local at `Renderer.js:243`; the three `_drawContactShadow` calls (`:293, :309, :334`) are unconditional. This perf rung does nothing. |
| `contactShadow()` (`ContactShadow.js:30-44`) | Takes no light argument. `cx: screenX` — the ellipse is always exactly under the character, axis-aligned, whatever the sun is doing. |
| `_drawShoulders` (`BiomeManager.js:3417`) | Mountain facet lighting is a **coin flip**: `Math.sin(p.stripX * 0.0137) >= 0 ? 1 : -1`, deliberately unrelated to the celestial's actual position. |
| `ParticleField.js` | **No light concept at all** — grep for "light" returns three unrelated comments. Meanwhile characters *are* now lit (`MeshDrawer.js` `litMeta` loop, shipped in PR #57). |
| `ParticleField.js:145` | Rain "lands" at `this.h * 0.667` — a hardcoded screen fraction, not `GroundField.heightAt()`. Rain splashes in mid-air over a valley. |

So the celestial has a position, a color, an intensity, *and a direction vector* — and until PR #57
(open) nothing consumed even the position. This package finishes that job. It is deliberately **not**
a new subsystem: every item connects existing, already-tested machinery to a consumer that should
have had it from the start.

**Corrected from my initial read:** I had flagged `DepthHaze`'s 4-entry `HAZE_LAYER_FRAC` table as a
"quantized instead of computed" gap. Reading the file directly, its geometric falloff is a
deliberate, documented tuning across only four discrete layers — a reasonable design, not a defect.
**Dropped from scope.** Likewise dropped: film grain and tone mapping (real absences, but cosmetic
bolt-ons that don't share this package's through-line), and any WebGL backend work — `WebGLRenderer.js`
is an opt-in decorative tint overlay (`?renderer=webgl`), not a renderer, and the codebase has
deliberately committed to Canvas2D.

---

## The package — four changes, one theme

### 1. Light-directed contact shadows

`ContactShadow.js` is 44 lines, pure, fully tested, and every constant is calibrated against specific
jump heights. Extend it — don't rewrite it — with an **optional** light argument.

- Offset the ellipse *away* from the light along `lightDirTo(light, screenX, groundY)`, scaled by how
  high the character is above the ground (a character on the ground has its shadow at its feet; one
  mid-jump throws it further).
- Stretch `rx` as the light gets lower on the horizon, since `celestialYFrac` already tracks the
  sun/moon arc through `DayNight`.
- **Backward compatible by construction:** omitting the light argument must reproduce today's exact
  output, so the existing `contactShadow` tests pass untouched. This is the same discipline PR #57
  used for `MeshDrawer`'s `lights` param, and it's what makes the change safe.

The payoff is the one that reads instantly without announcing itself: shadows swing across the ground
over the course of a song as the celestial arcs.

### 2. Fix the dead `contactShadowsEnabled` gate

One-line-ish. Guard the three `_drawContactShadow` calls with the local that's already being computed
and thrown away. This is a genuine bug — a documented perf rung that sheds nothing — and it belongs
in this PR because item 1 makes contact shadows measurably more expensive to compute.

### 3. Sun-facing mountain facets

Replace the `Math.sin(stripX * 0.0137)` coin flip at `BiomeManager.js:3417` with a facet side derived
from the light's actual horizontal direction, so ranges are lit consistently from the celestial's side.

**Risk, and the mitigation:** flipping every summit to one global side could read flatter and more
uniform than the current pseudo-random variety. So keep a *small* per-summit variation (the existing
`stripX` hash) as a perturbation **on top of** the global sun bias, rather than replacing one with the
other. Ridges stay varied; the bias becomes correct. Tune the mix ratio against a screenshot, not a test.

### 4. Lit particles, and rain that lands on the actual ground

Two changes in `ParticleField.js`, bundled because they're the same file and the same "particles don't
know about the world" root:

- **Lighting:** feed particles through the same falloff math `MeshDrawer` already implements for
  character edges — the light plumbing (`groundGlowLights`, `characterGlowLight`, `worldLights`) is
  built and already assembled per-frame at `Renderer.js:242-260`. Snow and motes drifting past a
  kick-glow pulse should catch it. Keep this subtle: particles are numerous, and over-lighting them is
  exactly the "look how complex I am" failure this codebase consistently avoids.
- **Collision:** replace the hardcoded `this.h * 0.667` splash plane with the real terrain height from
  `GroundField.heightAt()`, so rain lands *on the ground* rather than on an invisible screen-space shelf.

**Perf note:** particle counts are the single largest draw-call population in the frame, and
`particleMul` is the very first thing `PerfGovernor` sheds. Gate the per-particle lighting behind
`rimLightEnabled` (level < 2) exactly as the character lighting already is, so the deepest rungs pay
nothing for it.

---

## Files

**Modified:**
- `src/world/ContactShadow.js` — optional light arg, pure, backward compatible
- `src/render/Renderer.js` — pass the light into the three `_drawContactShadow` call sites; honour the dead gate
- `src/world/BiomeManager.js` — `_drawShoulders` facet direction (~`:3417`)
- `src/world/ParticleField.js` — lighting + real terrain collision

**Reused, not reinvented:** `lightDirTo` (`LightField.js:41`, currently consumer-less — this package is
its first caller), the `litMeta` radius-falloff loop pattern (`MeshDrawer.js`), `worldLights` /
`groundGlowLights` / `characterGlowLight` assembly (`Renderer.js:242-260`, shipped in PR #57),
`GroundField.heightAt()`, `PerfGovernor.rimLightEnabled`, and `DayNight`/`celestialYFrac` for the sun arc.

**No new modules.** That is the point of this package.

---

## Sequencing

**As of this writing: PR #57 merged (2026-08-13).** It carried the character-lighting work this package
builds directly on top of — `worldLights` / `groundGlowLights` / `characterGlowLight` assembly and the
`MeshDrawer` `litMeta` falloff loop are now on `main`, so every reuse listed above is available.

**Implementer: verify this is still true before branching** — re-check that `main` contains the symbols
listed in "Reused, not reinvented" below (a quick grep for `groundGlowLights` in `Renderer.js` is enough).
If a further PR has since merged, branch from current `main` regardless; nothing else in this plan depends
on merge order beyond #57.

Branch fresh from `main` for this work — do not stack it on top of any prior branch:

```
git fetch origin main && git checkout -b <new-branch-name> origin/main
```

Open a **new** pull request from that branch; this package has no PR of its own yet.

---

## Verification

**Unit** (`node --test`, flat `test()` calls — **1391 currently green, all must stay green**):
- `contactShadow` with no light argument returns byte-identical output to today (this is the
  regression guard that makes the change safe, and it's the first test to write).
- Shadow offset direction is opposite the light: put the light left, assert `cx > screenX`; mirror it,
  assert `cx < screenX`; put it directly overhead, assert `cx === screenX`.
- Offset scales with `heightAbove` and is zero when grounded.
- Facet side flips when the light crosses the vertical, and per-summit variation still produces both
  facet values across a range of `stripX` (i.e. the ridges did not go uniform).
- Particle lighting is bounded, never negative-alpha, and is a no-op when the lights array is empty.
- Rain splash y-coordinate tracks a mocked `heightAt()` rather than a constant.

**Visual, in a real browser** — Playwright against the dev server (port **8080**, launch Chromium with
`executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`), sampling **canvas pixels**,
not eyeballing:
- The acceptance criterion for item 1: drive `celestialYFrac` / the day-night clock across a full arc
  with all other world state frozen, and assert the shadow's measured centroid **actually translates**
  across the ground. A shadow that doesn't move is the failure mode this whole item exists to fix.
- Screenshot the ranges before/after item 3 and confirm they still read as varied terrain, not a
  uniformly-lit wall. This is the one criterion that cannot be automated.
- Confirm no console errors, and that `?perf=lite` still renders (the newly-live gate now actually
  sheds something).

**Scratch-file discipline** (house convention): verification scripts named `scratch_*.mjs` / `.png` at
repo root, `rm -f`'d before committing; dev server stopped (`pkill -f "tools/serve.js"`) when done.

---

## Deliverables

1. **The audit**, already summarized above under "Context" and the evidence table — inventory and scale,
   the dead-code findings with their evidence, and the "dropped from scope" call on `DepthHaze`, grain,
   tone mapping, and WebGL. Nothing further to produce; it is captured in this file.
2. **The implementation**, per "The package" section: the four numbered changes, in
   `src/world/ContactShadow.js`, `src/render/Renderer.js`, `src/world/BiomeManager.js`, and
   `src/world/ParticleField.js`, verified per the "Verification" section, on a new branch/PR per
   "Sequencing" above.

This plan file is the only artifact this session produces. Publishing either the audit or this plan as a
claude.ai artifact is optional and out of scope unless the user asks for it separately.
