# Audio-analysis evaluation

Run section metrics against a held-out set of human annotations:

```sh
npm run bench:sections -- path/to/corpus.json
```

The corpus is an array (or an object with a `tracks` array). Each track has an
identifier, duration, a reference segmentation, and the segmentation emitted
by the analysis pipeline:

```json
[
  {
    "id": "track-001",
    "durationMs": 218000,
    "reference": {
      "boundariesMs": [0, 32000, 76000, 128000, 218000],
      "labels": ["A", "B", "A", "C"]
    },
    "estimate": {
      "boundariesMs": [0, 31800, 75500, 129100, 218000],
      "labels": [0, 1, 0, 2]
    }
  }
]
```

The report includes boundary F-measure at 0.5 s and 3 s, median boundary
deviation, pairwise form-label F-measure, and over/under-segmentation NCE.
Keep final evaluation tracks separate from tuning tracks. Synthetic unit cases
protect algorithmic regressions, but they are not a substitute for a real,
annotated music corpus.
