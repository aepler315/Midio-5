# Range mobile uniform-limit repair

The user's actual S26 Ultra Chrome/Adreno 840 report rejected `teton-range-tour` with `FRAGMENT shader uniforms count exceeds MAX_FRAGMENT_UNIFORM_VECTORS(256)`. Range loading was complete, the context was live and residency had no denials; the permanent flat scene was the deliberate fallback after shader rejection.

The repair packs 64 cloud shape vec2s into 32 vec4s and the water's three six-element scalar gust arrays into six vec3s. All 64 puffs and six gust fronts remain, with unchanged full-precision radius/opacity/age/strength/direction. The forest retains its existing uniforms. Conservative terrain fragment vector allocation, including Three's six-slot prefix, drops from 288 to244. No landscape, audio, camera, weather, quality policy, residency or fallback redesign was made.

Code commit: `6bec139abc0e19f27310a69837e2a9bd21109180`, based on current main `356b6c6f60db3e22b66be9eb9724567c70092a34`. This evidence commit adds only documentation and artifacts.

[Download evidence.zip](evidence.zip) contains before/after full PNGs and generated audio, both offline HTML reports, comparison, native diagnostics, mobile-budget tour PNGs, test logs, GPU samples and the final probe source. [manifest.json](manifest.json) records source hashes, reported device details, settings, times, seed, artifact hashes and limits. ZIP SHA256: `23dd8a8f07edec4d1d2b576d8b20a1f50046bc0d81b681e81972d9f3c84b0a25` (11,154,132bytes). Every file hash and ZIP CRC was checked.

Verification performed:

- The new budget regression failed on unmodified code at288 vectors, then passed at244. All64 cloud slots and all six gust values are tested.
- `npm test`:3941passed. `npm run lint` and `git diff --check`:passed.
- Existing `cloud-occlusion-smoke.mjs`:12 actual GPU shadow samples across cloud indices0,1,62,63 passed, preserving covered-camera/uncovered-lake/behind-receiver behavior. The existing bounded pixel CI job now runs these samples after a server-ready check.
- Existing `visual-evaluate.mjs`:seed315/generated24-second contrast fixture at12,12.5,13seconds,550×310,DPR1,Natural/Auto/Fit. All three before/after PNGs were pixel-identical. Actual mountain silhouette, lake reflections, sky and lanterns were inspected; this is uniform transport, not an aesthetic change.
- Existing browser evaluation helpers exercised Natural→Pixel→Palette on active `teton-range-tour` at12/12.5/13seconds under mobile128MiB budget/DPR4 emulation. All completed frames stayed v2. Two bounded residency denials occurred after look transitions; they did not cause fallback or incomplete presentation. One cancelled old-generation tour manifest request is explicitly recorded; the successful manifest fetch returned200. An earlier probe rejected this expected cancellation, and is not counted as a passed run.
- `RETRO_BACKENDS=v2 RETRO_OUT=.smoke/uniform-retro npm run test:retro`:passed,14 recorded frames,32 real raster fixtures, six output/profile cases, palette membership, nonblank/temporal checks, context loss/recovery, native shader fallback and denied export cleanup.

Limitations: SwiftShader hardware exposes4096 fragment vectors, so it cannot establish the actual Adreno linker's behavior. The conservative244 bound fits the reported256 limit without relying on optimization or scalar packing. Actual S26 after-deployment confirmation remains pending. Existing export tooling requires even dimensions, hence550×310 instead of the reported live550×309. DPR4 and mobile residency tests are emulation, not hardware performance benchmarks. No encoded-output or audio-change claim is added by this repair.
