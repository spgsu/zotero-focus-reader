# Focus Reader (Zotero plugin)

**Single page mode for Zotero's PDF reader** — read one page at a time instead
of continuous scrolling, and see your annotation comments in the page margin.

Reading dense academic PDFs on screen is measurably harder than on paper. This
is a personal plugin that tries to claw back some of the difference, without
printing and without buying an e-ink device.

**[⬇ Download the latest release (.xpi)](https://github.com/spgsu/zotero-focus-reader/releases/latest/download/focus-reader.xpi)** — then in Zotero:
Tools → Plugins → gear icon → Install Plugin From File. Please read the caveats
below first.

Two mutually exclusive modes, each a button in Zotero's PDF reader toolbar.

**Focus mode** — for the first read.
- Locked single page view: scrolling settles on one page at a time rather than
  drifting between two, instead of Zotero's continuous scrolling.
- 2x supersampled rendering for better glyph antialiasing.
- Backdrop colour matched to the page, since Zotero's theme picker doesn't
  cover the area around the page.

**Review mode** — for the second pass over something you've marked up.
- Word-style comment balloons in the margin, aligned with the text they
  annotate, with leader lines; overlapping balloons stack downward.
- An annotation map: coloured ticks down the right edge showing every
  annotation's position in the document. Click to jump.
- Previous / next annotation navigation.

## Read this before installing

This is a personal tool published in case it's useful, not a supported product.

- **It is built almost entirely on Zotero's private internals** —
  `_internalReader`, `_primaryView`, `_iframeWindow`, `_item`, `_pages`. None of
  that is public API. Any Zotero release can rename it and break this plugin
  without warning.
- **Developed against Zotero 9.0.6 on Windows only.** Untested elsewhere.
- **PDF only.** It adds no controls for EPUB or snapshot readers.
- **The supersampling in Focus mode overrides `devicePixelRatio`** for the
  reader iframe. Zotero's annotation layer reads that same value when
  positioning highlights. Existing annotations appeared unaffected in testing,
  but placement of *newly created* annotations while Focus mode is active has
  not been rigorously verified. If that worries you, annotate with Focus mode
  off, or set `SUPERSAMPLE_FACTOR = 1` in `bootstrap.js`.
- **Auto-updates are best-effort.** `update_url` points at `update.json` in this
  repo, which is only accurate if a matching Release has been published.
- **No support promise.** Issues and PRs are welcome; replies are not
  guaranteed.

## Installing

Download
[`focus-reader.xpi`](https://github.com/spgsu/zotero-focus-reader/releases/latest/download/focus-reader.xpi)
from [Releases](https://github.com/spgsu/zotero-focus-reader/releases) (or build
it: zip the contents of `plugin/` — `manifest.json` and `bootstrap.js` at the
zip root, not inside a folder — and rename to `.xpi`).

Then in Zotero: **Tools → Plugins → gear icon → Install Plugin From File**. No
restart, no code signing needed.

## Notes for anyone hacking on this

`plugin/README.md` documents the non-obvious constraints that cost the most time
to find — including why pdf.js's `ScrollMode.PAGE` cannot be used in Zotero's
reader, why toolbar buttons need `-moz-window-dragging: no-drag` to receive
single clicks, and why arrays must be cloned across the chrome/content boundary
before being handed to pdf.js.

## Licence

MIT — see [LICENSE](LICENSE).
