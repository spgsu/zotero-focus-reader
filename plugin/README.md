# Focus Reader

A personal Zotero plugin for reading dense academic PDFs, built to recover some
of what makes print easier to read than a screen.

Two mutually exclusive modes, each on its own toolbar button in the PDF reader.

## Focus mode (page icon)

For the first read.

- **Locked single-page scrolling** via CSS scroll snapping, so scrolling settles
  on one page at a time instead of drifting between two.
- **Supersampled rendering** at 2x, which improves glyph antialiasing. Note this
  does not add real resolution -- it renders more source pixels and downsamples
  into the same screen pixels -- so it is only visible at higher zoom.
- **Backdrop colour matching**, so the area around the page follows the page's
  own background instead of staying a fixed colour (Zotero's theme picker does
  not cover that area).

## Review mode (speech-bubble icon)

For the second pass over a document you have already marked up.

- **Margin comment balloons** for annotations that have comment text, positioned
  beside the text they annotate, with a leader line. Overlapping balloons push
  down the margin rather than stacking. Clicking one jumps to the annotation.
- **Annotation map**: coloured ticks down the right edge showing every
  annotation's position in the document. Click to jump.
- **Previous / next annotation** buttons, shown only in this mode.

Read-only: it never writes annotation data. Editing still happens in Zotero's
sidebar.

## Installing

Zip the contents of this folder (`manifest.json` and `bootstrap.js` at the zip
root, not inside a subfolder) as `focus-reader.xpi`, then in Zotero:
**Tools -> Plugins -> gear icon -> Install Plugin From File**. No restart and no
code signing needed.

## Things that cost time, worth not rediscovering

- **`-moz-window-dragging: no-drag` is required on toolbar buttons.** Zotero's
  reader toolbar sits in the window's draggable titlebar region, so without it
  Gecko swallows single clicks to drag the window and only double-clicks get
  through (and they also maximise the window).
- **`renderToolbar` only honours one `append()` call.** Multiple calls silently
  drop all but the first, so all buttons go in one container.
- **pdf.js's `ScrollMode.PAGE` (`scrollMode = 3`) does not work here.** It reads
  back as set but never re-lays-out, because Zotero ships its own `viewer.css`
  that only styles `scrollHorizontal`/`scrollWrapped` -- and it breaks page
  navigation. Zotero's own use of it is in `ReaderPreview`, the hover popup,
  where only one page is ever shown.
- **The reader iframe is content-privileged.** Arrays passed into pdf.js
  functions must go through `Components.utils.cloneInto` or you get "Permission
  denied to access property 0". Property overrides must land on
  `wrappedJSObject`.
- **Deleting a `devicePixelRatio` override does not restore the native value** --
  it leaves `undefined`, which turns Zotero's annotation positioning into `NaN`.
  Capture the original and put it back explicitly.

## Debugging

Enable **Help -> Debug Output Logging** first (viewing the output alone does not
capture `Zotero.debug()` calls), then filter for lines starting `Focus Reader:`.
