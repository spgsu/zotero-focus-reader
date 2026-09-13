# Handoff

State as of 2026-09-13. Environment: Zotero **10.0.2** on Windows 11, plugin
version **0.17.4** (work in progress — see "In progress" below).

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

**Current status: working.** Page turns move, via a CSS transform — the
reading-mode document accepts writes to `scrollLeft` and reports them back
while nothing moves, so scrolling it is not an option (see below). 0.17.4
fixed three follow-on geometry bugs; re-test before treating it as settled.

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

### What the 0.17.2 log settled

**The scroll is never applied at all.** It is not applied-then-undone, so the
"Reading Mode is fighting us, switch to a transform" theory the previous
handoff built toward was aimed at the wrong thing.

```
turnPage dir=1 scroller=body stride=848 target=848 sw=22053 cw=906
  before: sl=0 rectX=560
  sync:   sl=0 rectX=560     <- scrollTo({left: 848}) left scrollLeft at 0
```

Eliminated, each by positive evidence rather than silence:

- **Handlers fire.** `first wheel reached reading-mode doc -- deltaY=6` and
  `first keydown ... key=ArrowDown target=BODY` both logged.
- **Sizing is right.** `stride=848`, `sw=22053`, `cw=906`, target well inside
  the scrollable span. Not a clamp.
- **Not a snap-back.** `sync`, `raf` and `+300ms` are all identical to
  `before`. Nothing ever moved to be undone.
- **`body` really is scrollable.** Later lines show `sl=795` with
  `rectX=-235` — exactly the 795px shift, so the offset *can* be set and the
  rect tracks it faithfully. Something other than us moved it.

So the question is no longer "who undoes our scroll" but **why writes to
`body.scrollLeft` from this plugin are ignored while something else sets the
same offset successfully.**

### The open question

0.17.3 answers it by trying every way of moving the content in one page turn
and reporting which one the document accepts (`PAGE_MOVERS`): `scrollTo`,
`scrollLeft =`, the same on `documentElement`, `window.scrollTo`, and finally
a CSS `translateX`, which bypasses the scroll machinery entirely and cannot be
refused. Each is measured against `#sdt-content`'s own viewport x, so a
mechanism only counts as working if the text actually moved. The shape of the
log it emits (**illustration of the format, not a recorded result** -- this
build has not been run yet):

```
Focus Reader: turnPage probe dir=1 scroller=body stride=848 target=848 ...
  start:      sl=0   rectX=560  offset=0
  scrollTo:   sl=0   rectX=560  offset=0
  scrollLeft: sl=848 rectX=560  offset=0
  docElement: sl=848 rectX=560  offset=0
  winScroll:  sl=848 rectX=560  offset=0
  transform:  sl=848 rectX=-288 offset=848  <-- MOVED
  winner=transform
```

The winner is remembered per document, so the cascade runs once and every
later turn goes straight to it — the probe is also the fix. Page position is
now tracked as `originX - rect.left` rather than `scrollLeft`, because that
measure is true under all five mechanisms.

**Turn pages forward (wheel down) to trigger the probe** — a backward turn at
page one is clamped and returns without probing.

A `scroll` listener also logs up to 12 scrolls it did not cause, to identify
whatever set that 795 offset; copying its mechanism is the tidier fix if the
transform turns out to have costs.

Vertical scrolling stays enabled deliberately, so a failure still can't strand
the reader with no way to move.

### Geometry bugs the transform exposed (0.17.4)

Once pages actually turned, three separate faults showed up. All three were
derived from the symptoms and the screenshot rather than guessed:

- **Forward turns stalled, backward ones always worked.** `turnPage` clamped
  the target against a *live* `scrollWidth - clientWidth`. Translating content
  left clips its overflow instead of making it scrollable, so that span shrank
  by one stride per page turned. Simulated against the real numbers
  (stride 848, span 21147): the target meets the shrinking span at page 13,
  and from there forward turns clamp *backward* — 10176 -> 10971 -> 10176
  forever, while backward turns are never constrained. The span is now
  measured once at rest and stored on the paging state.
- **A sliver of the next column was visible** at the right edge (clearly
  in the 0.17.3 screenshot). The column was sized to `#sdt-content` (800px)
  but the visible area is wider (906px+), so a page turn of 848px always left
  the next column peeking. The gap now absorbs the difference —
  `gap = max(PAGE_GAP, viewport - columnWidth)` — which makes one stride
  exactly one screenful and puts the next column just past the right edge.
- **Several lines lost at the top or bottom of each page.** `height: 100vh`
  assumed the content starts at the top of the viewport. Anything above it
  pushes an exactly-viewport-tall column that far below the fold, and
  `column-fill: auto` then clips those lines from *every* column. The height
  is now measured (`win.innerHeight - contentTop * 2`, giving the bottom the
  same margin as the top) and logged as `page metrics`.

All geometry is measured with the transform temporarily cleared, since the
transform shifts every quantity being read.

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
