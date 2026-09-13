"use strict";

var PLUGIN_ID = "focus-reader@zoteroreader.local";

var STYLE_ID = "focus-reader-style";
var LOCKED_CLASS = "focus-reader-locked";
var REVIEW_CLASS = "focus-reader-review";
var COMMENTS_ID = "focus-reader-comments";
var MARKERS_ID = "focus-reader-markers";

var PAGED_CLASS = "focus-reader-paged";
var SDT_STYLE_ID = "focus-reader-sdt-style";
var PAGE_GAP = 48;

var SUPERSAMPLE_FACTOR = 2;
var BALLOON_MIN_WIDTH = 140;
var BALLOON_MAX_WIDTH = 320;
var BALLOON_GAP = 8;

/*
 * Two mutually exclusive modes, because they serve different sessions and
 * actively fight each other if combined:
 *
 *   Focus  -- first read. Locked one-page-at-a-time scrolling, supersampled
 *             rendering, backdrop matched to the page. Nothing in the margins.
 *   Review -- second pass over a document you've already marked up. Margin
 *             comment balloons, annotation markers down the scrollbar, and
 *             next/previous annotation navigation. Free scrolling, since
 *             reviewing means jumping around rather than reading linearly.
 *
 * Locked page snapping deliberately does NOT use pdf.js's ScrollMode.PAGE:
 * Zotero ships its own viewer.css that only styles scrollHorizontal and
 * scrollWrapped, so setting scrollMode = 3 takes effect in JS but never
 * re-lays-out, which breaks page navigation. Native CSS scroll snapping does
 * the same job with nothing for Zotero to fight.
 */
var STYLE_CSS = `
	.focus-reader-controls {
		display: inline-flex;
		align-items: center;
		-moz-window-dragging: no-drag;
	}
	.focus-reader-button {
		/*
		 * Zotero's reader toolbar sits in the window's draggable titlebar
		 * region, so buttons there inherit -moz-window-dragging: drag, which
		 * makes Gecko swallow single clicks to drag the window and only pass
		 * double-clicks through. Opting out is what makes one click work.
		 */
		-moz-window-dragging: no-drag;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		margin: 0 2px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.focus-reader-button:hover {
		background: rgba(128, 128, 128, 0.2);
	}
	.focus-reader-button[aria-pressed="true"] {
		background: #2570e8;
		color: #fff;
	}
	.focus-reader-button[hidden] {
		display: none !important;
	}
	.focus-reader-button svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	html.${LOCKED_CLASS} #viewerContainer {
		scroll-snap-type: y mandatory;
	}
	html.${LOCKED_CLASS} .pdfViewer .page {
		scroll-snap-align: start;
		scroll-snap-stop: always;
	}

	/*
	 * Balloons are positioned from pageDiv.offsetTop, so the overlay and the
	 * pages must share a containing block -- otherwise the two coordinate
	 * spaces disagree and balloons land off-screen.
	 */
	.pdfViewer {
		position: relative;
	}
	#${COMMENTS_ID} {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 5;
	}
	.focus-reader-balloon {
		position: absolute;
		box-sizing: border-box;
		padding: 6px 8px;
		border-radius: 4px;
		border: 1px solid rgba(128, 128, 128, 0.35);
		border-left-width: 3px;
		background: rgba(255, 255, 255, 0.96);
		color: #1a1a1a;
		font: 11px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
		cursor: pointer;
		pointer-events: auto;
		overflow: hidden;
	}
	.focus-reader-balloon:hover {
		border-color: #2570e8;
	}
	.focus-reader-balloon .focus-reader-quote {
		display: block;
		margin-bottom: 3px;
		font-style: italic;
		opacity: 0.65;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.focus-reader-leader {
		position: absolute;
		height: 0;
		border-top: 1px dashed rgba(128, 128, 128, 0.5);
		pointer-events: none;
	}

	/* Document-level map of where the annotations are. */
	#${MARKERS_ID} {
		position: fixed;
		top: 0;
		right: 0;
		width: 12px;
		height: 100%;
		pointer-events: none;
		z-index: 6;
	}
	.focus-reader-marker {
		position: absolute;
		right: 2px;
		width: 8px;
		height: 3px;
		border-radius: 1px;
		opacity: 0.85;
		cursor: pointer;
		pointer-events: auto;
	}
	.focus-reader-marker:hover {
		width: 12px;
		right: 0;
		opacity: 1;
	}
`;

var ICON_FOCUS = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'
	+ '<rect x="5" y="3" width="14" height="18" rx="1.5"/>'
	+ '<line x1="8" y1="8.5" x2="16" y2="8.5"/>'
	+ '<line x1="8" y1="12" x2="16" y2="12"/>'
	+ '<line x1="8" y1="15.5" x2="13" y2="15.5"/>'
	+ '</svg>';
var ICON_REVIEW = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'
	+ '<path d="M4 5.5h16v11H11l-5 4v-4H4z"/>'
	+ '<line x1="8" y1="9.5" x2="16" y2="9.5"/>'
	+ '<line x1="8" y1="12.5" x2="13" y2="12.5"/>'
	+ '</svg>';
var ICON_PREV = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'
	+ '<polyline points="15,5 8,12 15,19"/></svg>';
var ICON_NEXT = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'
	+ '<polyline points="9,5 16,12 9,19"/></svg>';

function getViewerWindow(reader) {
	try {
		return (reader._internalReader
			&& reader._internalReader._primaryView
			&& reader._internalReader._primaryView._iframeWindow) || null;
	}
	catch (e) {
		return null;
	}
}

function getViewerDocument(reader) {
	let win = getViewerWindow(reader);
	return (win && win.document) || null;
}

/*
 * Everything here is built on pdf.js internals, so it has nothing to offer an
 * EPUB or snapshot reader -- those use a different view entirely, and EPUB
 * already has native paginated flow. Zotero sets _type from the attachment,
 * and we fall back to sniffing for a pdf.js viewer.
 */
function isPdfReader(reader) {
	try {
		if (reader._type) {
			return reader._type === "pdf";
		}
	}
	catch (e) {
		// fall through to sniffing
	}
	return !!getPdfViewer(reader);
}

function getPdfViewer(reader) {
	try {
		let win = getViewerWindow(reader);
		return (win && win.PDFViewerApplication && win.PDFViewerApplication.pdfViewer) || null;
	}
	catch (e) {
		return null;
	}
}

function ensureStyles(doc) {
	if (!doc || doc.getElementById(STYLE_ID)) {
		return;
	}
	let style = doc.createElement("style");
	style.id = STYLE_ID;
	style.textContent = STYLE_CSS;
	doc.head.appendChild(style);
}

// ---------------------------------------------------------------- annotations

/*
 * Normalised annotations: { id, comment, text, color, position }. Zotero's
 * ReaderInstance keeps the attachment on _item and its own code calls
 * _item.getAnnotations() directly, so that is the primary source; the reader's
 * internal state is the fallback.
 */
function getAnnotations(reader) {
	try {
		if (reader._item && typeof reader._item.getAnnotations === "function") {
			let items = reader._item.getAnnotations() || [];
			let out = [];
			for (let a of items) {
				let position = null;
				try {
					position = JSON.parse(a.annotationPosition);
				}
				catch (e) {
					continue;
				}
				out.push({
					id: a.key,
					comment: a.annotationComment || "",
					text: a.annotationText || "",
					color: a.annotationColor || "#ffd400",
					position
				});
			}
			if (out.length) {
				return out;
			}
		}
	}
	catch (e) {
		Zotero.debug("Focus Reader: _item annotations unavailable: " + e);
	}

	try {
		let ir = reader._internalReader;
		let state = (ir && ir._state && ir._state.annotations) || [];
		return state.map(a => ({
			id: a.id,
			comment: a.comment || "",
			text: a.text || "",
			color: a.color || "#ffd400",
			position: a.position
		}));
	}
	catch (e) {
		Zotero.debug("Focus Reader: state annotations unavailable: " + e);
	}
	return [];
}

/*
 * Absolute Y of an annotation within the scrolling viewer, or null if its page
 * isn't laid out yet. convertToViewportRectangle runs in the reader's content
 * scope and cannot read a chrome-side array, so the rect is cloned across
 * first ("Permission denied to access property 0" otherwise).
 */
function locateAnnotation(annotation, pdfViewer, doc) {
	let position = annotation.position;
	let rect = position && position.rects && position.rects[0];
	let pageView = position && pdfViewer._pages && pdfViewer._pages[position.pageIndex];
	if (!rect || !pageView || !pageView.div || !pageView.viewport) {
		return null;
	}
	let contentRect = rect;
	try {
		contentRect = Components.utils.cloneInto(rect, doc.defaultView);
	}
	catch (e) {
		// Fall through with the raw rect; worst case this throws and the
		// annotation is skipped by the caller.
	}
	let vr = pageView.viewport.convertToViewportRectangle(contentRect);
	let pageDiv = pageView.div;
	return {
		top: pageDiv.offsetTop + Math.min(vr[1], vr[3]),
		pageRight: pageDiv.offsetLeft + pageDiv.offsetWidth
	};
}

function sortedAnnotations(reader, pdfViewer, doc) {
	let located = [];
	for (let annotation of getAnnotations(reader)) {
		let spot = null;
		try {
			spot = locateAnnotation(annotation, pdfViewer, doc);
		}
		catch (e) {
			continue;
		}
		if (spot) {
			located.push({ annotation, top: spot.top, pageRight: spot.pageRight });
		}
	}
	located.sort((a, b) => a.top - b.top);
	return located;
}

// -------------------------------------------------------------- review render

function clearReviewOverlays(doc) {
	for (let id of [COMMENTS_ID, MARKERS_ID]) {
		let el = doc && doc.getElementById(id);
		if (el) {
			el.remove();
		}
	}
}

function renderReview(reader, doc) {
	try {
		let pdfViewer = getPdfViewer(reader);
		let viewerEl = doc.getElementById("viewer");
		let containerEl = doc.getElementById("viewerContainer");
		if (!pdfViewer || !viewerEl || !containerEl) {
			return;
		}
		clearReviewOverlays(doc);

		let located = sortedAnnotations(reader, pdfViewer, doc);
		if (!located.length) {
			return;
		}

		let overlay = doc.createElement("div");
		overlay.id = COMMENTS_ID;
		viewerEl.appendChild(overlay);

		let markers = doc.createElement("div");
		markers.id = MARKERS_ID;

		// Markers cover the whole document (they're the map), but they're cheap:
		// no text, no measurement. Built into a fragment and attached once.
		let totalHeight = viewerEl.offsetHeight || 1;
		let markerFragment = doc.createDocumentFragment();
		for (let { annotation, top } of located) {
			let marker = doc.createElement("div");
			marker.className = "focus-reader-marker";
			marker.style.top = ((top / totalHeight) * 100).toFixed(3) + "%";
			marker.style.background = annotation.color;
			marker.title = annotation.comment || annotation.text || "Annotation";
			marker.addEventListener("click", () => navigateTo(reader, annotation.id));
			markerFragment.appendChild(marker);
		}
		markers.appendChild(markerFragment);
		doc.body.appendChild(markers);

		/*
		 * Balloons are the expensive part -- real text, and each one's height
		 * has to be measured to stack them -- so only build the ones near the
		 * viewport. On a document with hundreds of annotations, building all of
		 * them on every page render is what would make this crawl.
		 */
		let viewHeight = containerEl.clientHeight || 0;
		let windowTop = containerEl.scrollTop - viewHeight;
		let windowBottom = containerEl.scrollTop + viewHeight * 2;
		let visible = located.filter(e => e.annotation.comment.trim()
			&& e.top >= windowTop && e.top <= windowBottom);

		let balloonFragment = doc.createDocumentFragment();
		let placed = [];
		for (let { annotation, top, pageRight } of visible) {
			let available = containerEl.clientWidth - pageRight - BALLOON_GAP * 2;
			let width = Math.max(BALLOON_MIN_WIDTH, Math.min(BALLOON_MAX_WIDTH, available));
			let balloon = doc.createElement("div");
			balloon.className = "focus-reader-balloon";
			balloon.style.top = top + "px";
			balloon.style.left = (pageRight + BALLOON_GAP) + "px";
			balloon.style.width = width + "px";
			balloon.style.borderLeftColor = annotation.color;
			if (annotation.text) {
				let quote = doc.createElement("span");
				quote.className = "focus-reader-quote";
				quote.textContent = annotation.text;
				balloon.appendChild(quote);
			}
			balloon.appendChild(doc.createTextNode(annotation.comment));
			balloon.addEventListener("click", () => navigateTo(reader, annotation.id));
			balloonFragment.appendChild(balloon);
			placed.push({ balloon, desiredTop: top, pageRight });
		}
		overlay.appendChild(balloonFragment);

		// Measure every balloon first, then write positions. Interleaving reads
		// and writes forces a reflow per balloon.
		let heights = placed.map(entry => entry.balloon.offsetHeight);
		let cursor = -Infinity;
		let leaderFragment = doc.createDocumentFragment();
		for (let i = 0; i < placed.length; i++) {
			let entry = placed[i];
			let top = Math.max(entry.desiredTop, cursor);
			entry.balloon.style.top = top + "px";
			cursor = top + heights[i] + BALLOON_GAP;

			// Leader sits at the anchor's own height, so a balloon pushed down
			// the margin still points back at its text.
			let leader = doc.createElement("div");
			leader.className = "focus-reader-leader";
			leader.style.top = (entry.desiredTop + 6) + "px";
			leader.style.left = entry.pageRight + "px";
			leader.style.width = BALLOON_GAP + "px";
			leaderFragment.appendChild(leader);
		}
		overlay.appendChild(leaderFragment);
		Zotero.debug(`Focus Reader: review rendered ${located.length} marker(s), `
			+ `${placed.length} of ${located.length} balloon(s) in view`);
	}
	catch (e) {
		Zotero.debug("Focus Reader: failed to render review overlays: " + e);
	}
}

function navigateTo(reader, annotationID) {
	try {
		reader.navigate({ annotationID });
	}
	catch (e) {
		Zotero.debug("Focus Reader: navigate failed: " + e);
	}
}

/*
 * Step through annotations in document order. The index is resolved from the
 * current scroll position each time rather than remembered, so scrolling by
 * hand between jumps doesn't leave the cursor stale.
 */
// Which annotation each reader was last stepped to, keyed by its document.
var lastVisited = new WeakMap();

function stepAnnotation(reader, doc, direction) {
	try {
		let pdfViewer = getPdfViewer(reader);
		let containerEl = doc.getElementById("viewerContainer");
		if (!pdfViewer || !containerEl) {
			return;
		}
		let located = sortedAnnotations(reader, pdfViewer, doc);
		if (!located.length) {
			return;
		}
		/*
		 * The cursor is the annotation we last jumped to, not the scroll
		 * position. Navigating doesn't necessarily scroll -- if the target is
		 * already on screen Zotero just selects it -- so deriving "where am I"
		 * from scrollTop gets the same answer on every click and stepping
		 * appears stuck. Scroll position is only the fallback, for when there's
		 * no cursor yet or you've scrolled well away from it by hand.
		 */
		let viewTop = containerEl.scrollTop;
		let viewHeight = containerEl.clientHeight || 0;
		let lastID = lastVisited.get(doc);
		let index = -1;

		if (lastID) {
			let at = located.findIndex(e => e.annotation.id === lastID);
			if (at !== -1 && Math.abs(located[at].top - viewTop) <= viewHeight) {
				index = at + direction;
			}
		}
		if (index === -1) {
			index = direction > 0
				? located.findIndex(e => e.top > viewTop)
				: located.reduce((last, e, i) => (e.top < viewTop ? i : last), -1);
		}

		// Wrap at both ends.
		if (index < 0 || index >= located.length) {
			index = direction > 0 ? 0 : located.length - 1;
		}
		let target = located[index].annotation.id;
		lastVisited.set(doc, target);
		navigateTo(reader, target);
	}
	catch (e) {
		Zotero.debug("Focus Reader: step annotation failed: " + e);
	}
}

// -------------------------------------------------------------- focus helpers

function syncBackdropColor(doc) {
	try {
		let container = doc.getElementById("viewerContainer");
		let pageEl = doc.querySelector(".page");
		if (!container || !pageEl) {
			return;
		}
		let color = doc.defaultView.getComputedStyle(pageEl).backgroundColor;
		if (color) {
			container.style.setProperty("background-color", color, "important");
		}
	}
	catch (e) {
		Zotero.debug("Focus Reader: backdrop sync failed: " + e);
	}
}

function clearBackdropColor(doc) {
	try {
		let container = doc.getElementById("viewerContainer");
		if (container) {
			container.style.removeProperty("background-color");
		}
	}
	catch (e) {
		Zotero.debug("Focus Reader: backdrop clear failed: " + e);
	}
}

/*
 * pdf.js takes its canvas render scale from devicePixelRatio, so reporting a
 * higher value makes it render more source pixels and downsample into the same
 * screen pixels -- better glyph antialiasing, though not more real resolution,
 * so it only shows at higher zoom. The reader iframe is content-privileged, so
 * the override must land on the underlying content object. Deleting it later
 * does NOT restore the native value (it leaves undefined, which turns Zotero's
 * annotation math into NaN), so the original is captured and put back.
 */
var originalDpr = new WeakMap();

function setSupersampling(win, factor) {
	try {
		let target = win.wrappedJSObject || win;
		if (!originalDpr.has(win)) {
			originalDpr.set(win, target.devicePixelRatio);
		}
		Object.defineProperty(target, "devicePixelRatio", {
			value: factor,
			configurable: true,
			writable: true
		});
	}
	catch (e) {
		Zotero.debug("Focus Reader: supersampling on failed: " + e);
	}
}

function clearSupersampling(win) {
	try {
		let target = win.wrappedJSObject || win;
		let original = originalDpr.get(win);
		if (typeof original === "number") {
			Object.defineProperty(target, "devicePixelRatio", {
				value: original,
				configurable: true,
				writable: true
			});
		}
		else {
			delete target.devicePixelRatio;
		}
	}
	catch (e) {
		Zotero.debug("Focus Reader: supersampling off failed: " + e);
	}
}

// pdf.js only re-samples devicePixelRatio when it rebuilds page viewports;
// nudging the scale by a hair forces that without a visible zoom change.
function forceRerender(pdfViewer) {
	try {
		if (!pdfViewer) {
			return;
		}
		for (let page of pdfViewer._pages || []) {
			if (page && typeof page.reset === "function") {
				page.reset();
			}
		}
		let scale = pdfViewer.currentScale;
		if (scale) {
			pdfViewer.currentScale = scale * 1.0001;
		}
		if (typeof pdfViewer.update === "function") {
			pdfViewer.update();
		}
	}
	catch (e) {
		Zotero.debug("Focus Reader: re-render failed: " + e);
	}
}

// -------------------------------------------------------- reading mode paging

/*
 * Zotero 10's Reading Mode (SDTView) reflows the document into clean HTML, but
 * scrolls continuously -- which throws away the page boundaries that make print
 * easier to hold your place in. Their EPUB view does have paginated flow, built
 * on CSS columns; this applies the same idea to Reading Mode, which they left
 * scroll-only.
 *
 * Columns are the right primitive because the browser breaks between lines, so
 * pages never slice a line in half the way a fixed-height scroll snap would.
 * Columns can't be CSS scroll-snap targets, though, so page turns are driven
 * from JS by scrolling exactly one column stride.
 */
var SDT_CSS = `
	/*
	 * Vertical scrolling is deliberately left enabled. Columns shouldn't
	 * produce vertical overflow anyway, and disabling it means any failure of
	 * the horizontal page turns leaves the reader with no way to move at all.
	 */
	html.${PAGED_CLASS}, html.${PAGED_CLASS} body {
		height: 100%;
		max-height: 100%;
		overflow-x: auto;
		overscroll-behavior-x: contain;
	}
	html.${PAGED_CLASS} #sdt-content {
		box-sizing: border-box;
		height: 100vh;
		column-width: var(--focus-reader-page-width, 40em);
		column-gap: var(--focus-reader-page-gap, ${PAGE_GAP}px);
		column-fill: auto;
	}
`;

/*
 * Reading Mode runs as its own view alongside the PDF one rather than
 * replacing it: _primaryView stays the pdf.js view even while you're reading
 * reflowed text, and the reflowed document lives on _primarySDTView. Whether
 * it's currently showing is _state.primaryReadingModeEnabled.
 */
function getReadingModeDocument(reader) {
	try {
		let ir = reader._internalReader;
		if (!ir) {
			return null;
		}
		let state = ir._state || {};
		for (let view of [ir._primarySDTView, ir._secondarySDTView]) {
			if (!view) {
				continue;
			}
			let doc = view._iframeDocument
				|| (view._iframeWindow && view._iframeWindow.document);
			if (doc && doc.getElementById("sdt-content")) {
				return doc;
			}
		}
		Zotero.debug("Focus Reader: no reading-mode document -- "
			+ `sdtView=${!!ir._primarySDTView} `
			+ `enabled=${state.primaryReadingModeEnabled} `
			+ `loading=${state.readingModeLoading}`);
	}
	catch (e) {
		Zotero.debug("Focus Reader: reading-mode lookup failed: " + e);
	}
	return null;
}

/*
 * Reading Mode may not be the primary view at all -- Zotero describes it as an
 * overlay, so it could be a separate view instance or a nested frame. Report
 * the reader's actual shape rather than guessing where #sdt-content lives.
 */
function probeReadingMode(reader) {
	try {
		let ir = reader._internalReader;
		let primary = ir && ir._primaryView;
		let doc = getViewerDocument(reader);
		let viewKeys = ir
			? Object.keys(ir).filter(k => /sdt|read|view|mode/i.test(k)).join("|")
			: "n/a";
		let stateKeys = (ir && ir._state)
			? Object.keys(ir._state).filter(k => /sdt|read|mode/i.test(k)).join("|")
			: "n/a";
		let frames = doc ? doc.querySelectorAll("iframe").length : -1;
		let sdtHere = !!(doc && doc.getElementById("sdt-content"));
		Zotero.debug("Focus Reader: reading-mode probe -- "
			+ `primaryView=${primary && primary.constructor && primary.constructor.name} `
			+ `docURL=${doc && doc.location && doc.location.href} `
			+ `sdtInPrimaryDoc=${sdtHere} iframesInDoc=${frames} `
			+ `internalKeys=[${viewKeys}] stateKeys=[${stateKeys}]`);
	}
	catch (e) {
		Zotero.debug("Focus Reader: reading-mode probe failed: " + e);
	}
}

var pagingState = new WeakMap();

/*
 * Whichever element actually carries the horizontal overflow. Giving body an
 * explicit overflow-x makes it its own scroll container, so document.
 * scrollingElement (<html>) reports nothing to scroll and page turns silently
 * do nothing.
 */
function getScroller(doc) {
	for (let el of [doc.body, doc.documentElement]) {
		if (el && el.scrollWidth - el.clientWidth > 1) {
			return el;
		}
	}
	return doc.scrollingElement || doc.body;
}

function pageStride(doc) {
	let state = pagingState.get(doc);
	return (state && state.stride) || 0;
}

/*
 * Where the text actually sits on screen. scrollLeft is what we command, but
 * it is not evidence that anything moved: it reads back the value we just
 * assigned whether or not the columns repainted. The content box's own
 * viewport-relative x is the independent measurement, so every sample records
 * both and a page turn is only "working" if the two agree.
 */
function pageSample(doc, scroller) {
	let content = doc.getElementById("sdt-content");
	let rect = content && content.getBoundingClientRect();
	return `sl=${Math.round(scroller.scrollLeft)} `
		+ `body=${doc.body ? Math.round(doc.body.scrollLeft) : "n/a"} `
		+ `html=${doc.documentElement ? Math.round(doc.documentElement.scrollLeft) : "n/a"} `
		+ `rectX=${rect ? Math.round(rect.left) : "n/a"}`;
}

function turnPage(doc, direction) {
	let scroller = getScroller(doc);
	let stride = pageStride(doc);
	if (!scroller || !stride) {
		Zotero.debug(`Focus Reader: turnPage aborted -- scroller=${!!scroller} stride=${stride}`);
		return;
	}
	// Snap to the nearest page boundary first, so a half-scrolled position
	// can't accumulate drift across turns.
	let before = scroller.scrollLeft;
	let current = Math.round(before / stride);
	let target = (current + direction) * stride;
	let beforeSample = pageSample(doc, scroller);
	scroller.scrollTo({ left: target, behavior: "auto" });
	let syncSample = pageSample(doc, scroller);
	Zotero.debug(`Focus Reader: turnPage dir=${direction} `
		+ `scroller=${scroller.tagName.toLowerCase()} stride=${stride} `
		+ `target=${target} sw=${scroller.scrollWidth} cw=${scroller.clientWidth}\n`
		+ `  before: ${beforeSample}\n`
		+ `  sync:   ${syncSample}`);

	/*
	 * The synchronous read above cannot tell a working page turn from one that
	 * Reading Mode's own scroll handling immediately undoes -- both report the
	 * value we just set. Sampling again after a frame, and again once any
	 * async handler has had time to run, is what separates them: a position
	 * that reverts to `before` is a fight over the scroll offset, and the
	 * answer there is to translate the content rather than scroll it.
	 */
	let win = doc.defaultView;
	if (!win) {
		return;
	}
	win.requestAnimationFrame(() => {
		let raf = pageSample(doc, scroller);
		win.setTimeout(() => {
			Zotero.debug(`Focus Reader: turnPage settled dir=${direction}\n`
				+ `  raf:    ${raf}\n`
				+ `  +300ms: ${pageSample(doc, scroller)}`);
		}, 300);
	});
}

function enableReadingModePaging(reader, doc) {
	if (pagingState.has(doc)) {
		return;
	}
	try {
		let win = doc.defaultView;
		let content = doc.getElementById("sdt-content");
		if (!win || !content) {
			return;
		}

		if (!doc.getElementById(SDT_STYLE_ID)) {
			let style = doc.createElement("style");
			style.id = SDT_STYLE_ID;
			style.textContent = SDT_CSS;
			doc.head.appendChild(style);
		}

		/*
		 * One column per page, sized to the content box rather than the
		 * element's clientWidth -- clientWidth includes Reading Mode's own
		 * padding, so using it makes the used column width differ from the
		 * value we set, and the page stride drifts a little further out of
		 * step with every turn.
		 */
		let applyWidth = () => {
			let cs = win.getComputedStyle(content);
			let padding = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
			let columnWidth = content.clientWidth - padding;
			if (columnWidth > 0) {
				content.style.setProperty("--focus-reader-page-width", columnWidth + "px");
				content.style.setProperty("--focus-reader-page-gap", PAGE_GAP + "px");
				let state = pagingState.get(doc);
				if (state) {
					state.stride = columnWidth + PAGE_GAP;
				}
				return columnWidth + PAGE_GAP;
			}
			return 0;
		};
		doc.documentElement.classList.add(PAGED_CLASS);

		/*
		 * Whether input reaches the Reading Mode document at all is otherwise
		 * only visible as silence, which is indistinguishable from a page turn
		 * that fired and did nothing. Announce the first event of each kind so
		 * absence becomes real evidence instead of an inference.
		 */
		let seen = { keydown: false, wheel: false };
		let noteEvent = (kind, detail) => {
			if (seen[kind]) {
				return;
			}
			seen[kind] = true;
			Zotero.debug(`Focus Reader: first ${kind} reached reading-mode doc -- ${detail}`);
		};

		let onKeyDown = (event) => {
			noteEvent("keydown", `key=${event.key} target=${event.target
				&& event.target.nodeName}`);
			if (event.key === "ArrowRight" || event.key === "PageDown"
					|| (event.key === " " && !event.shiftKey)) {
				event.preventDefault();
				turnPage(doc, 1);
			}
			else if (event.key === "ArrowLeft" || event.key === "PageUp"
					|| (event.key === " " && event.shiftKey)) {
				event.preventDefault();
				turnPage(doc, -1);
			}
		};
		// A vertical wheel gesture is what people reach for, so map it to page
		// turns rather than leaving it to scroll a now-horizontal document.
		let wheelCooldown = 0;
		let onWheel = (event) => {
			noteEvent("wheel", `deltaY=${event.deltaY} target=${event.target
				&& event.target.nodeName}`);
			if (!event.deltaY) {
				return;
			}
			event.preventDefault();
			let now = Date.now();
			if (now < wheelCooldown) {
				return;
			}
			wheelCooldown = now + 220;
			turnPage(doc, event.deltaY > 0 ? 1 : -1);
		};
		let onResize = () => applyWidth();

		doc.addEventListener("keydown", onKeyDown, true);
		doc.addEventListener("wheel", onWheel, { passive: false });
		win.addEventListener("resize", onResize);
		pagingState.set(doc, { win, onKeyDown, onWheel, onResize, stride: 0 });
		applyWidth();

		/*
		 * Columns only paginate if some ancestor actually scrolls horizontally.
		 * If nothing does, the extra columns are clipped instead: one screenful
		 * of text, vertical scrolling disabled, and page turns that can't move
		 * -- i.e. a frozen reader. Check for real overflow once layout settles
		 * and back out cleanly if it isn't there, rather than stranding the
		 * user in a broken view.
		 */
		win.requestAnimationFrame(() => {
			try {
				let scroller = getScroller(doc);
				let stride = pageStride(doc);
				let overflow = scroller.scrollWidth - scroller.clientWidth;
				let chain = [];
				for (let el = content; el && el !== doc.documentElement; el = el.parentElement) {
					let cs = win.getComputedStyle(el);
					chain.push(`${el.tagName.toLowerCase()}`
						+ `${el.id ? "#" + el.id : ""}`
						+ `${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}`
						+ `[ox=${cs.overflowX},oy=${cs.overflowY},w=${el.clientWidth},sw=${el.scrollWidth}]`);
				}
				Zotero.debug(`Focus Reader: reading-mode paging -- stride=${stride} `
				+ `scrollerTag=${scroller.tagName.toLowerCase()} `
					+ `contentWidth=${content.clientWidth} scrollerOverflow=${overflow} `
					+ `chain=${chain.join(" < ")}`);
				if (overflow < stride / 2) {
					Zotero.debug("Focus Reader: pagination produced no scrollable overflow -- reverting");
					disableReadingModePaging(doc);
				}
			}
			catch (e) {
				Zotero.debug("Focus Reader: pagination verification failed: " + e);
			}
		});
	}
	catch (e) {
		Zotero.debug("Focus Reader: failed to enable reading-mode paging: " + e);
	}
}

function disableReadingModePaging(doc) {
	let state = doc && pagingState.get(doc);
	if (!state) {
		return;
	}
	try {
		doc.documentElement.classList.remove(PAGED_CLASS);
		let content = doc.getElementById("sdt-content");
		if (content) {
			content.style.removeProperty("--focus-reader-page-width");
			content.style.removeProperty("--focus-reader-page-gap");
		}
		doc.removeEventListener("keydown", state.onKeyDown, true);
		doc.removeEventListener("wheel", state.onWheel);
		state.win.removeEventListener("resize", state.onResize);
	}
	catch (e) {
		Zotero.debug("Focus Reader: failed to disable reading-mode paging: " + e);
	}
	pagingState.delete(doc);
}

// ------------------------------------------------------------------ mode swap

var refreshState = new WeakMap();

function attachReviewRefresh(reader, doc, pdfViewer) {
	if (!pdfViewer || !pdfViewer.eventBus || refreshState.has(pdfViewer)) {
		return;
	}
	let pending = null;
	let handler = () => {
		let win = doc.defaultView;
		if (!win) {
			return;
		}
		win.clearTimeout(pending);
		pending = win.setTimeout(() => renderReview(reader, doc), 250);
	};
	pdfViewer.eventBus.on("pagerendered", handler);
	pdfViewer.eventBus.on("scalechanging", handler);
	// Balloons are only built near the viewport, so scrolling has to rebuild
	// them as new annotations come into range.
	let container = doc.getElementById("viewerContainer");
	if (container) {
		container.addEventListener("scroll", handler, { passive: true });
	}
	refreshState.set(pdfViewer, { eventBus: pdfViewer.eventBus, handler, container });
}

function detachReviewRefresh(pdfViewer) {
	let state = pdfViewer && refreshState.get(pdfViewer);
	if (!state) {
		return;
	}
	try {
		state.eventBus.off("pagerendered", state.handler);
		state.eventBus.off("scalechanging", state.handler);
		if (state.container) {
			state.container.removeEventListener("scroll", state.handler);
		}
	}
	catch (e) {
		Zotero.debug("Focus Reader: detach refresh failed: " + e);
	}
	refreshState.delete(pdfViewer);
}

function currentMode(doc) {
	if (!doc) {
		return null;
	}
	let classes = doc.documentElement.classList;
	if (classes.contains(LOCKED_CLASS)) {
		return "focus";
	}
	if (classes.contains(REVIEW_CLASS)) {
		return "review";
	}
	return null;
}

function setMode(reader, controls, mode) {
	let doc = getViewerDocument(reader);
	if (!doc) {
		Zotero.debug("Focus Reader: no viewer document (non-PDF, or not loaded)");
		return;
	}
	ensureStyles(doc);
	let win = getViewerWindow(reader);
	let pdfViewer = getPdfViewer(reader);
	let readingDoc = getReadingModeDocument(reader);
	let classes = doc.documentElement.classList;

	// Always tear both modes down first, so switching between them can't leave
	// half of the previous mode applied.
	classes.remove(LOCKED_CLASS);
	classes.remove(REVIEW_CLASS);
	clearReviewOverlays(doc);
	detachReviewRefresh(pdfViewer);
	clearBackdropColor(doc);
	disableReadingModePaging(readingDoc);
	if (win) {
		clearSupersampling(win);
	}

	if (mode === "focus") {
		if (!readingDoc) {
			probeReadingMode(reader);
		}
		Zotero.debug("Focus Reader: focus path -> " + (readingDoc ? "reading mode" : "pdf view"));
		if (readingDoc) {
			// Reading Mode is a reflowed HTML view, so none of the pdf.js work
			// applies -- it gets column pagination instead.
			enableReadingModePaging(reader, readingDoc);
		}
		else {
			classes.add(LOCKED_CLASS);
			syncBackdropColor(doc);
			if (win) {
				setSupersampling(win, SUPERSAMPLE_FACTOR);
			}
		}
	}
	else if (mode === "review") {
		classes.add(REVIEW_CLASS);
		attachReviewRefresh(reader, doc, pdfViewer);
	}

	forceRerender(pdfViewer);
	if (mode === "review" && win) {
		win.setTimeout(() => renderReview(reader, doc), 600);
	}
	updateControls(controls, reader);
	Zotero.debug(`Focus Reader: mode -> ${mode || "off"}`);
}

/*
 * Focus mode in Reading Mode marks a different document than the PDF path
 * does, so the active mode has to consider both.
 */
function activeMode(reader) {
	let readingDoc = getReadingModeDocument(reader);
	if (readingDoc && pagingState.has(readingDoc)) {
		return "focus";
	}
	return currentMode(getViewerDocument(reader));
}

function updateControls(controls, reader) {
	let mode = activeMode(reader);
	controls.focus.setAttribute("aria-pressed", String(mode === "focus"));
	controls.review.setAttribute("aria-pressed", String(mode === "review"));
	controls.prev.hidden = mode !== "review";
	controls.next.hidden = mode !== "review";
}

function makeButton(doc, id, icon, title) {
	let button = doc.createElement("button");
	button.id = id;
	button.className = "focus-reader-button";
	button.title = title;
	button.innerHTML = icon;
	return button;
}

function onRenderToolbar(event) {
	let { reader, doc, append } = event;
	if (!isPdfReader(reader)) {
		Zotero.debug("Focus Reader: not a PDF reader, no controls added");
		return;
	}
	// Drop leftovers from a previous render so clicks can't hit a stale button.
	for (let el of doc.querySelectorAll(".focus-reader-controls, .focus-reader-button")) {
		el.remove();
	}
	ensureStyles(doc);
	let viewerDoc = getViewerDocument(reader);
	if (viewerDoc && viewerDoc !== doc) {
		ensureStyles(viewerDoc);
	}

	let controls = {
		focus: makeButton(doc, "focus-reader-focus-button", ICON_FOCUS,
			"Focus mode -- locked single-page reading"),
		review: makeButton(doc, "focus-reader-review-button", ICON_REVIEW,
			"Review mode -- margin comments and annotation map"),
		prev: makeButton(doc, "focus-reader-prev-button", ICON_PREV,
			"Previous annotation"),
		next: makeButton(doc, "focus-reader-next-button", ICON_NEXT,
			"Next annotation")
	};

	controls.focus.addEventListener("click", () => {
		setMode(reader, controls, activeMode(reader) === "focus" ? null : "focus");
	});
	controls.review.addEventListener("click", () => {
		setMode(reader, controls, activeMode(reader) === "review" ? null : "review");
	});
	controls.prev.addEventListener("click", () => {
		stepAnnotation(reader, getViewerDocument(reader), -1);
	});
	controls.next.addEventListener("click", () => {
		stepAnnotation(reader, getViewerDocument(reader), 1);
	});

	updateControls(controls, reader);
	// One append call, not four: Zotero's renderToolbar hook only honours a
	// single append, so the buttons go in together inside one container.
	let container = doc.createElement("div");
	container.className = "focus-reader-controls";
	container.appendChild(controls.focus);
	container.appendChild(controls.review);
	container.appendChild(controls.prev);
	container.appendChild(controls.next);
	append(container);
}

function install(data, reason) {}

async function startup(data, reason) {
	Zotero.Reader.registerEventListener("renderToolbar", onRenderToolbar, PLUGIN_ID);
}

function shutdown(data, reason) {
	Zotero.Reader.unregisterEventListener("renderToolbar", onRenderToolbar);
}

function uninstall(data, reason) {}
