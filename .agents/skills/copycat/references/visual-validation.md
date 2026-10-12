# Visual validation

Validation is part of the deliverable. Do not report a reconstruction as done until you
have compared it, or until you have stated why comparison was impossible.

## The loop

```bash
CC="node <this-skill-dir>/scripts/copycat.mjs"
# 1. Serve the local build (dev server or static server), then:
$CC compare --reference https://example.com/pricing --local http://localhost:5173/pricing \
  --viewport desktop,mobile --run <run-id>
# 2. Read the prioritized corrections and open compare/iter-N/side-by-side.<vp>.png
# 3. Fix the highest-priority category first, then run the same command again (same --run)
```

Each run adds `compare/iter-N/` and appends to `compare.json`, so the report shows how
things progressed. Stop when one of these is true:

- The issue list has only explained, accepted differences (fonts not available, licensed
  imagery replaced, dynamic content).
- You have done 5 iterations. Report what remains.
- A `--max-mismatch` gate passes, if the user set one.

For components, compare the same root on both sides with `--selector`. Use
`--local-selector` when the local root has a different selector.
For interactive states, run `flow` with the same steps against both sides (`--label
reference`, then `--label local`, same `--run`) and compare the step screenshots and
observations.

## What is measured

| Output | Meaning |
|---|---|
| `pixel.mismatchRatio` | Differing pixels ÷ compared pixels. A pixel differs when its color distance exceeds `--threshold` (pixelmatch YIQ, 0–1, default 0.1). Anti-aliased pixels count unless you pass `--ignore-antialiasing` |
| `pixel.unstablePixels` | Pixels that changed between **two captures of the reference** (carousels, timers, ads). They are excluded and shown in blue in the diff image. Disable with `--no-stability` |
| `pixel.sizeMismatch` | The screenshots have different sizes. Default `--size-mode pad` fills the missing area with magenta and counts it. `crop` compares only the overlap |
| `regions[]` | Clusters of differing pixels, each with a bounding box and the smallest reference element under its center (`near`) |
| `structural.coverage` | Share of key reference elements (role and label) found in the local DOM |
| `structural.missing / extra` | Unmatched elements: structure problems |
| `structural.layout` | Matched elements whose box differs by more than `--tolerance` px (default 4), relative to the scope root |
| `structural.typography / spacing / color / micro` | Computed-style differences on matched elements |
| `issues[]` | All of the above merged, sorted: structure → layout → typography/spacing → color → assets → responsive → states → micro |

## Limits of these numbers

- Pixel ratios depend on page length. A 2% mismatch on a very long page can hide a broken
  header. Always read `issues[]` and look at the diff image.
- Font rendering differs across machines. Run both captures on the same machine and in the
  same run, as `compare` does.
- A text change shifts every pixel below it. Fix structure and layout first, then measure
  again.
- A low mismatch does not prove the interactions work. Flows and the interaction matrix do.
- Never turn these values into a "fidelity score" or claim 100% fidelity. Report the actual
  numbers, with their viewport and threshold.

## Screenshot references

`compare --reference design.png --local http://localhost:5173 --viewport 1440x900`
compares against an image. Only pixel metrics are available, because there is no reference
DOM. Match the viewport width to the image width.
