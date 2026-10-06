# Evidence

Text reports (README, JSON manifests and measurements) for past visual and
performance reviews live here.

The screenshots, frame grabs, videos and raw archives that went with them
(48 files, about 32 MB) were removed from the working tree on 2026-10-05 to keep
clones small. They are still in git history. To get them back:

```sh
git checkout 8f2860f -- docs/evidence
```

Some image links in the reports below, and in older docs under `docs/`,
point at those removed files.

`range-v2/` keeps its images: the scene catalog
(`data/terrain/scenic-views.json`, `src/world/terrain/sceneCatalogData.js`)
cites them as approval evidence, and `tools/build-range-scene.mjs --approve`
requires evidence files to exist.

Renders that show Midio, Broshi or Midasus are also kept (all of
`cast-giants/`, plus every file whose name mentions the cast in
`pixel-storm-peaks/` and `range-v2/`): they are the reference for work on
the characters' return to the scene.
