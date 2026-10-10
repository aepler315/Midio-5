# Evidence archive

New evidence is not committed here (see `AGENTS.md`). Captures belong in
`.smoke/`, in a CI artifact, or attached to a GitHub Release and linked
from the PR.

`range-v2/` stays: `src/world/terrain/sceneCatalogData.js` cites those
captures as each view's acceptance evidence.

Every other folder is frozen and can be removed from the working tree
without loss: git history keeps it. The last commit that holds the complete
archive is `356b6c6` (main, 2026-10-10). Restore a folder locally without
committing it:

```sh
git checkout 356b6c6 -- docs/evidence/<folder>   # e.g. pixel-repair
git restore --staged docs/evidence/<folder>
```

| Folder | Size | Recorded for |
| --- | --- | --- |
| `teton-tour` | 88 MB | Teton song highway (#418) |
| `pixel-repair` | 53 MB | Pixel/Palette presentation repair (#425) |
| `landscape-performance` | 24 MB | Earlier Range work, last re-added by #367 |
| `pixel-storm-peaks` | 23 MB | Earlier Range work, last re-added by #367 |
| `range-20260926` | 3.3 MB | Earlier Range work, last re-added by #367 |
| `intentional-effects` | 1.4 MB | Range lens accents (#419) |
| `range-shader-fallback` | 0.6 MB | Shader link fallback (#420) |
| `remove-foreground-ground` | 0.5 MB | Foreground ground bar removal (#421) |
| `dancing-ridge-20260926`, `terrain-continuation`, `glacial-valley-flight`, `ridge-refinement` | < 0.2 MB each | Earlier Range work, last re-added by #367 |
