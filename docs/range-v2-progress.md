# Range v2 progress

Plan: `docs/superpowers/plans/2026-09-29-range-geodata-master.md` (copied verbatim from the supplied package).
Reference image: `docs/evidence/range-v2/reference.webp` (1806×871, documentation only; never staged into `/src`).

## State

| Field | Value |
| --- | --- |
| Branch | `claude/amazing-brown-tbiycu` |
| Base | `b8a3d72b344792d149906449f1cd86d68df8cc2b` (= audited SHA; `origin/main` rechecked 2026-09-29) |
| Last completed task | 0 |
| Next action | Task 1 — fixture quality pin, Broshi render RNG, evidence state |

## Decisions recorded with the user (2026-09-29)

- Runtime asset ceiling: **≤ 60 MB** total under `src/assets/range/v2/` (plain files, no Git LFS).
- Materials: **hybrid**. Procedural, offline-baked colour ramps and masks everywhere; procedural detail on distant terrain; CC0 photo-scan **normal/roughness data only** (no scan albedo) for the rock stage and nearest terrain. Provenance recorded per file.

## Environment (this execution session)

| Capability | Status |
| --- | --- |
| Node / npm | v22.22.2 / 10.9.7 |
| Python + GDAL | `/usr/bin/python3.12`, GDAL 3.8.4, numpy 1.26.4, Pillow 10.2.0 (apt `gdal-bin python3-gdal python3-numpy python3-pil`). The default `python3` (3.11) has no GDAL bindings. |
| ffmpeg | 6.1.1 (apt) |
| Browser | Playwright Chromium 1194 at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (set `PLAYWRIGHT_CHROMIUM_PATH`). |
| WebGL2 | Available only through **SwiftShader** (software, `--use-angle=swiftshader --enable-unsafe-swiftshader`). No physical GPU and no phone: every frame timing from this session is software-rendered and **not** a device measurement. |
| Network | Terrarium tiles (AWS), USGS TNM API + `prd-tnm` S3, ambientCG API, npm registry reachable. Poly Haven download host returned 521. |

## Baseline (Task 0)

| Command | Result |
| --- | --- |
| `npm ci` | ok |
| `npm test` | 3228 pass / 0 fail |
| `npm run lint` | clean |
| `npm run stage:site` | ok |

## Audit findings re-checked at base

The four confirmed defects in plan §1 are re-verified in Task 1 against source before editing.

## Command log

(appended per task)
