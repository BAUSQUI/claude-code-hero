# Stop holding it all in your head

Hero interaction for a Claude Code landing-page concept. A head sits on the
left with a chaotic scribble churning inside it. You grab the scribble, drag
it out of the head, and let go. Releasing is the point: dropping it outside
the head resolves it into the Claude mark, while dropping it back inside
returns it to your head.

## Run

```
npm install
npm run dev
```

Then open the printed URL. Append `?debug` for a state readout, or `?grid`
for the 12-column overlay.

## Tuning

Everything art-directable lives in [`src/hold/config.ts`](src/hold/config.ts).
Start with:

1. `colors` — ground, scribble, resolved mark.
2. `noise` (both bands) + `spikes` — the character of the unresolved thought.
   `noise.boilFps` is the hand-redrawn line-boil rate.
3. `dragSpring` — how heavy the thought feels to carry.
4. `extraction` — how it peels out of the head.
5. `headExitDelay` / `headFadeDuration` / `resolutionDuration` — the pacing of
   the payoff. `acts` reshapes resolution into DISORDER / BREAKTHROUGH /
   SETTLE (portion, target progress and easing each).
5b. `heat` — the ember peak the colour pushes through; `scaleGesture` — the
   gather-and-swell breath; `construction` / `anchors` / `trail` — the
   structure that makes the morph read as built, not interpolated.
6. `workLog.steps` — the working-overlay rows: copy, icons, and the
   morph-progress window each step occupies.

## Structure

- `src/hold/config.ts` — single `HOLD` config object, all knobs.
- `src/hold/assets.ts` — SVG sampling; `loadSvgArt` returns both the sampled
  outline and the filled geometry under one transform.
- `src/hold/scribble.ts` — the living stroke: normal-only noise displacement
  (silhouette preserved), arrhythmic spikes, extraction peel, and the morph
  onto the Claude mark.
- `src/hold/drag.ts` — grab / elastic spring carry / drop, and the
  inside-vs-outside-head test.
- `src/hold/acts.ts` — the three-act progress curve, easings, scale gesture.
- `src/hold/construction.ts` — guide lines and anchor flashes during the morph.
- `src/hold/colors.ts` — contrast-driven colour state and the act-synced
  background (routed through a warm waypoint, never neutral grey).
- `src/hold/worklog.ts` — the working overlay: lucide icons, file chips,
  diff badges and spinner/check states, all keyed to morph progress.
- `src/hold/grid.ts` — the 12-column grid resolved in JS, so the WebGL layer
  places the head and mark on the same column spans the CSS uses.
- `src/hold/arrival.ts` — behaviour for the chat input (its markup and grid
  placement live in index.html).
- `src/hold/intent.ts` — local, deterministic prompt parsing against
  `HOLD.demo.intentMap`, with clamps that keep the mark on-brand.
- `src/hold/cursor.ts`, `src/hold/noise.ts` — custom cursor, simplex noise.
- `src/hold/main.ts` — scene, layout, pointer plumbing, phase timeline.

## Assets

`public/head.png`, `public/scribble.svg`, `public/claude-symbol.svg` are the
brand artwork — sampled, never approximated or regenerated.

## Page

The page scrolls normally: the hero stage is one viewport tall (the canvas
does not pin), with the CTA block under the head, then the surfaces row and
the logo wall below, revealing with a subtle rise as they enter (disabled
under prefers-reduced-motion). The render loop pauses when the hero scrolls
out of view. `src/hold/page.ts` builds the platform-aware CTA, tiles and
logo wall.

The scribble is coral from the very start — no colour interpolation. The
payoff is carried by outline -> fill: the fill FLOODS outward from the centre
during BREAKTHROUGH (`fill.spreadDuration/origin/feather`) while the stroke
thins and its hand-drawn unevenness (`scribble.strokeWeightRange`) evens out,
and the head trades places with the mark — solid -> outline
(`headOutlineWidth/Opacity`) in the same duration and easing.

## Column map (from the reference)

    Head        col 1, no bleed; sized by height from under the sub-bar
                down to 16px above the CTA (lands across cols 1-6)
    CTA block   cols 1-5
    H1          cols 7-12
    Subtitle    cols 7-11
    Thinking log cols 7-9  — beside the mark, sharing the H1's left edge
    Mark        cols 9-12  — centred on that span
    Chat input  cols 7-11

## The head empties as you drag

The fill/stroke transition is driven by `dragProgress` (0 = scribble inside,
1 = fully out), not by the drop — so it tracks the hand and reverses. The two
are never cross-faded: the stroke snaps to full opacity in
`strokeFadeInDuration` ms so the silhouette keeps its edge, then the fill
DRAINS beneath it — a soft-edged mask (`fillMaskSoftness`) receding toward
`fillDrainOrigin`, with the fill at 100% opacity the whole way so it stays
solid instead of washing out.

## Mobile (390)

A genuine recompose, not a scaled desktop: 4 columns, 30px margins, 16px
gutter (330 content / 70.5 column). Text sits ABOVE the head, which occupies
a real box in the document flow (`.hero__head`) that the canvas draws onto —
so the CTA below it moves with it. On mobile the head does not become an
outline; it fades out entirely and the flow reclaims the space.

Because the hero is taller than the viewport there, the canvas maps to the
STAGE box rather than the viewport — `grid.stageWidth/stageHeight` — and
`resize()` iterates until the stage stops moving, since laying out the head
slot changes the very height the camera is derived from.

## The container (one coordinate system)

The design is authored at 1440. A single `.container` — max-width 1440,
centred, 96px padding, 12 columns, 24px gap — is used by every section, and
`src/hold/grid.ts` MEASURES that container from the DOM at runtime. The
canvas derives its world mapping from the same box and positions the head,
the mark and the log in column units via `columnToWorld()`, so the DOM and
WebGL layers cannot drift apart. `?grid` overlays the columns.

## Layout

`index.html` owns the page: fonts (plantin for the H1 only, Archivo for
everything else), a real 12-column grid (96px margins, 24px gutter), the nav,
the secondary bar, the hero type and the chat input. Elements sit on column
spans. The canvas reads the same grid through `src/hold/grid.ts`: the head is
sized by height and bleeds off the left edge, and the camera's view height is
derived from it so every other proportion in the scene is preserved.

## The demo

After the mark resolves, the input goes live. Prompts are matched locally —
no network, no API — against `HOLD.demo.intentMap` and applied as animated,
clamped transformations of the mark. Unrecognised prompts answer in the log
with suggestions rather than doing nothing.

## Status

Done: drag mechanics, extraction, the empty-head beat, three-act resolution
to the filled mark, the working overlay, and the arrival input with the
first transformation (sharper / softer).
Still to come: the rest of the intent map, working-overlay reuse during
transforms, the version strip, plus reset, keyboard support and reduced
motion.
