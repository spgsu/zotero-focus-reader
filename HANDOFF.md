# Handoff

State as of 2026-09-13. Environment: Zotero **10.0.2** on Windows 11, plugin
version **0.17.1** (uncommitted work in progress — see "In progress" below).

## What this is

A personal Zotero plugin that tries to recover some of print's advantages when
reading dense academic PDFs on screen. Published at
https://github.com/spgsu/zotero-focus-reader (public, MIT, sole contributor
spgsu — **never add Co-Authored-By trailers to commits here**).

## What works and is shipped

Two mutually exclusive modes, each a toolbar button in the PDF reader:

- **Focus** — locked single-page scrolling via CSS scroll snapping,
  2x supersampled rendering, backdrop colour matched to the page.
- **Review** — margin comment balloons beside the text they annotate, an
  annotation map (coloured ticks down the right edge), and previous/next
  annotation navigation. Read-only; never writes annotation data.

All of this survived the Zotero 10 upgrade unchanged apart from the version cap.

## In progress: pagination for Zotero 10's Reading Mode

Zotero 10 added **Reading Mode** — reflowed single-column HTML with adjustable
font/size/spacing — but it scrolls continuously and has no pagination. Their
EPUB view *does* have paginated flow (CSS columns); they didn't apply it here.
Reflowed text plus real page turns is the gap worth filling, and it's the
original goal of this whole project.

**Current status: not working. Last symptom was "frozen" — pagination applies,
but page turns don't move anything.**

### What's already established (do not re-derive)

- Reading Mode is a **separate view instance**, not a replacement:
  `_primaryView` stays `pdf_view_PDFView` even while reading. The reflowed
  document lives on `_internalReader._primarySDTView` (and `_secondarySDTView`).
  State flags: `_state.primaryReadingModeEnabled`, `readingModeLoading`.
- Its content root is `<article id="sdt-content">`, class `sdt-pdf`.
- Applying CSS columns **does work** — measured `#sdt-content` scrollWidth of
  22000px (~26 columns) against a clientWidth of 800.
- The horizontal overflow lands on **`<body>`** (906 wide, scrollWidth 22053),
  not on `<html>`. `document.scrollingElement` is `<html>` and reports nothing,
  which caused an earlier false "no overflow, reverting".
- Reading Mode already has its own line-length control (`data-page-width`:
  narrow/normal/full), so don't build one.

### The open question

With 0.17.1, `turnPage()` logs which element it scrolled plus `scrollLeft`
before/after. **Get that line first.** It distinguishes:

1. handler never fires (wheel/keydown not reaching the SDT document),
2. `stride` is 0 (sizing calculation wrong),
3. scroll is applied then immediately undone (Reading Mode's own scroll
   handling fighting it) — if so, the fix is probably to translate the content
   with a CSS transform instead of scrolling.

0.17.1 also leaves vertical scrolling enabled deliberately, so a failure can no
longer strand the reader with no way to move.

## Hard-won gotchas

- **`-moz-window-dragging: no-drag`** is required on toolbar buttons. Zotero's
  reader toolbar is in the window's draggable titlebar region; without it Gecko
  swallows single clicks and only double-clicks get through (and those maximise
  the window). This cost several rounds.
- **`renderToolbar` honours only one `append()` call.** Put all buttons in one
  container.
- **pdf.js `ScrollMode.PAGE` (`scrollMode = 3`) is unusable** in the main
  reader — reads back as set, never re-lays-out, breaks page navigation. Zotero
  ships its own `viewer.css` styling only `scrollHorizontal`/`scrollWrapped`.
  Their own use of mode 3 is in `ReaderPreview` (hover popup, one page only).
- **The reader iframe is content-privileged.** Arrays passed into pdf.js calls
  need `Components.utils.cloneInto` ("Permission denied to access property 0").
  Property overrides must target `wrappedJSObject`.
- **Deleting a `devicePixelRatio` override doesn't restore the native value** —
  it leaves `undefined`, which turns Zotero's annotation math into `NaN`.
  Capture and restore it explicitly.
- **Supersampling is polish, not resolution.** It improves antialiasing but
  cannot add detail the screen can't show; invisible at low zoom. The real
  constraint is the 1080p display (~144 DPI for a letter page vs print's 300+).

## Working method that worked

Debug logging is only captured if **Help → Debug Output Logging** is *enabled*
first; viewing the output alone captures nothing. Filter for `Focus Reader:`.

When a fix fails twice, stop theorising and ship one build whose instrumentation
separates every candidate cause at once. Several rounds were lost to guessing.

## Build and install

```bash
# from repo root, after editing plugin/
powershell -Command "Compress-Archive -Path plugin\manifest.json,plugin\bootstrap.js -DestinationPath focus-reader.zip -Force; Rename-Item focus-reader.zip focus-reader.xpi -Force"
```

Then Zotero: **Tools → Plugins → gear → Install Plugin From File**. No restart,
no signing. Copy the `.xpi` into `~/Downloads` to overwrite the previous one —
the desktop app's file card does not refresh an already-downloaded copy, which
caused a stale-file misdiagnosis early on.

## Loose ends

- Published release is **v0.14.0**, which caps at Zotero 9 and therefore won't
  install on 10. `update.json` also still points at v0.14.0. Cut a new release
  when Reading Mode work settles.
- Annotation-coordinate safety under supersampling was never rigorously
  verified — existing annotations looked fine, but placement of *newly created*
  ones while Focus is active is untested. README says so.
- Forum announcement drafted but not posted; new-user posts were held for
  moderation. Threads: forums.zotero.org discussions 129519, 110321, 94957.
