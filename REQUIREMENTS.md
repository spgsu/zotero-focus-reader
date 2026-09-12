# ZoteroReader — Requirements Document

## 1. Problem Statement

The user reads dense academic PDFs significantly faster and with better comprehension on
paper than on screen. This is a documented phenomenon (the "screen inferiority effect"),
driven by three separable mechanisms — not by backlighting itself:

1. **Loss of spatial pagination.** Continuous scroll removes the fixed "place" cues
   (page position, thickness of pages behind/ahead) that print gives the brain for free.
   This is the dominant, most fixable factor.
2. **Habitual shallow-processing mode.** Screens — independent of content — trigger the
   skim behavior built up from scrolling social media/email (the "shallowing hypothesis").
3. **Comprehension overconfidence.** Screen readers underestimate how much they missed,
   so they re-read less than they should; print readers self-assess accurately.

Printing is ruled out (paper waste). E-ink narrows the gap furthest but isn't the
constraint here — the goal is to close as much of the gap as possible **in software**,
inside the user's existing Zotero-based workflow, without buying new hardware.

Key finding from prior research in this session: Zotero's PDF reader is built on
Mozilla's **pdf.js**, which already ships a real, locked single-page **Presentation
Mode** (triggered by `Ctrl+Alt+P` in standalone Firefox). Zotero's reader wrapper does
not expose this mode. The core opportunity is to re-expose an existing capability, not
build page-locking/rendering logic from scratch.

## 2. Goals

- Restore a genuine fixed-page ("locked single-page") reading view for PDFs opened
  through Zotero, to recover the spatial-mapping benefit of print.
- Break the device-association that triggers skim-mode: a full-screen, chrome-free
  reading view that looks and feels different from normal browsing/annotation mode.
- Do this without leaving Zotero's library (annotations, citations, and sync must keep
  working normally) and without introducing a new tool the user has to learn from
  scratch — build on tools already in muscle memory (Zotero, general PDF viewers).
- Prefer the smallest change that gets the real benefit over a from-scratch reader.

## 3. Non-Goals

- Not attempting to fully close the print-vs-screen gap — research indicates even
  e-ink doesn't fully close it. Target is "meaningfully narrower," not "solved."
- Not building a new PDF rendering engine or a general-purpose reader app.
- Not addressing eye strain / blue light as a primary target (secondary, optional).
- Not replacing Zotero's citation/annotation/sync functionality.

## 4. Success Criteria

- The user can enter a locked, single-page, full-screen reading view for any PDF in
  their Zotero library, in one action (keybinding or one click), without leaving
  Zotero's managed library.
- Page navigation in that view is discrete (page-to-page), not continuous scroll.
- Annotations/highlights made in that view are the same annotations tracked by Zotero
  (or, for the fallback approach, sync correctly back into Zotero afterward).
- Subjectively, after using it on a real dense paper, the user reports the reading
  experience feels closer to print than Zotero's default continuous-scroll view.

## 5. Functional Requirements

### Must-have
- **FR1 — Locked page view.** A way to view any Zotero-attached PDF one page at a time,
  with no scroll, and explicit next/previous page navigation (keyboard + click).
- **FR2 — Full-screen / chrome-free.** The view suppresses toolbars, sidebars, and other
  UI chrome not needed for reading, to visually separate "reading mode" from "library/
  annotation mode."
- **FR3 — One-action entry point.** Reachable from the normal Zotero item view (context
  menu item, toolbar button, or keybinding) — no manual file hunting.
- **FR4 — Stays inside the Zotero workflow.** The PDF being read is still the
  Zotero-managed file; the reading view doesn't fork an untracked copy.

### Should-have
- **FR5 — Annotation capability inside the view.** Ability to underline/highlight/margin-
  note while in locked-page mode, since active markup is one of the two evidence-backed
  levers (spatial pagination is the other) and the user already has annotation habits.
- **FR6 — Annotations round-trip into Zotero's normal annotation store**, so citation
  workflows aren't disrupted.

### Nice-to-have
- **FR7 — Warm color temperature / night-mode toggle** in the reading view, for the
  fatigue dimension (this is the one factor actually tied to backlighting).
- **FR8 — Per-document "zoom to page height" memory**, so re-opening a paper resumes at
  a sane fit level instead of requiring re-fitting every time.

## 6. Non-Functional Requirements

- **NFR1 — Low tool-fluency cost.** Must not require learning a materially new UI
  paradigm; reuse patterns from tools the user already knows (Zotero, standard PDF
  viewer conventions), per the documented risk that an unfamiliar annotation interface
  itself adds cognitive load that can cancel out the comprehension benefit.
- **NFR2 — No data loss / no fork risk.** Must not create a second, unsynced copy of an
  annotated PDF that diverges from the Zotero-tracked one.
- **NFR3 — Reasonable build scope.** Given the underlying capability (pdf.js Presentation
  Mode) already exists one layer below Zotero's reader, the implementation should be
  scoped as "expose/patch an existing feature," not "build a new renderer." Target:
  a small personal plugin, buildable incrementally, not a multi-month effort.
- **NFR4 — Cross-platform.** Should work on whatever OS(es) the user actually reads on
  (confirm: Windows only, per this machine, or also others).

## 7. Candidate Approaches (for scoping, not yet a decision)

Two independent tracks were identified; they are not mutually exclusive.

**A. No-code workaround (available today):**
Zotero's built-in "Show File" (right-click a PDF attachment) opens it in the OS default
PDF viewer. Point the OS default (or use the open-source `zotero-open-pdf` plugin to do
this per-click without changing the OS default) at a viewer with a genuine locked
single-page/presentation mode — e.g., Okular (full presentation mode), qpdfview
(explicit single-page layout), or SumatraPDF (Windows). Satisfies FR1–FR3 immediately;
does not satisfy FR5/FR6 (annotations made externally don't sync back to Zotero) unless
the chosen external viewer's annotations are re-imported.

**B. Custom Zotero plugin — SELECTED. Correction to the original premise below.**

The original assumption in Section 1 — "re-expose pdf.js's dormant Presentation Mode,
the same one Firefox triggers via Ctrl+Alt+P" — turned out to be **wrong** after reading
Zotero's actual source (`zotero/reader` and `zotero/zotero`):

- Zotero's reader does embed a real pdf.js viewer app (`PDFViewerApplication`) per tab,
  inside a hidden iframe — but there is **zero reference anywhere** in either repo to
  `PresentationMode` / `requestPresentationMode`. It appears to not be compiled into
  Zotero's custom pdf.js build at all, not merely hidden behind a missing button. A
  plugin can't call a method that isn't in the shipped bundle, so "just re-expose it"
  is not viable as originally framed.
- However, there **is** a real, working, already-in-use lever for the actual goal
  (locked, non-continuous single-page view): pdf.js's core `scrollMode` property
  supports a 4th value (`3` = `PAGE`) beyond the three Zotero's Appearance popup exposes
  (0=vertical, 1=horizontal, 2=wrapped). Confirmed directly in Zotero's own shipped
  client source (`chrome/content/zotero/xpcom/reader.js`), which sets
  `pdfViewer.scrollMode = 3` together with `pdfViewer.currentScaleValue = 'page-height'`
  for its own hover-preview feature. So the real, verified plugin strategy is: expose
  this already-functioning-but-hidden scroll mode, not "unlock" a nonexistent dormant
  feature.
- Confirmed the real plugin hook: `Zotero.Reader.registerEventListener('renderToolbar',
  handler, pluginID)` — documented, in current use by other Zotero 7 plugins (e.g.
  `vecear/zotero-epub`).
- Net effect on scope: FR1 (locked page view) and FR3 (one-action entry point) are
  confirmed buildable and were built as a v0.1 (`plugin/`). FR2 (full-screen/chrome-free
  "presentation" feel) has **no native equivalent to lean on** — Zotero's reader chrome
  would need to be hidden by hand (CSS/layout), which was deliberately left unbuilt
  rather than guessed at, since the right selectors need to be confirmed against a
  running Zotero instance, not just static source.

Status: v0.1 built in `plugin/` (manifest.json + bootstrap.js + README.md). Implements
FR1 + FR3 only. Not yet tested inside an actual Zotero install.

## 8. Open Questions

- Which track to pursue first: ship the no-code workaround (A) immediately as a stopgap,
  then build the plugin (B) for the "real" fix — or go straight to (B)?
- Platform scope: Windows-only, or does the user read on other machines/OSes too?
- Is FR5/FR6 (in-view annotation) actually required, or is read-only locked-page view
  (FR1–FR4) sufficient for the primary goal of faster/better first-pass reading, with
  annotation happening afterward back in normal Zotero view?
- Any preference among Okular / qpdfview / SumatraPDF for approach (A), if pursued?
- Target timeline / effort budget for approach (B) — confirmed as a "weekend to few
  weeks" scope in prior research; does the user want to bound it further?
