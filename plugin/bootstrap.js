"use strict";

var PLUGIN_ID = "focus-reader@zoteroreader.local";

var STYLE_ID = "focus-reader-style";
var LOCKED_CLASS = "focus-reader-locked";
var REVIEW_CLASS = "focus-reader-review";
var COMMENTS_ID = "focus-reader-comments";
var MARKERS_ID = "focus-reader-markers";

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
		let viewTop = containerEl.scrollTop + 4;
		let target;
		if (direction > 0) {
			target = located.find(e => e.top > viewTop) || located[0];
		}
		else {
			let earlier = located.filter(e => e.top < viewTop - 8);
			target = earlier.length ? earlier[earlier.length - 1] : located[located.length - 1];
		}
		navigateTo(reader, target.annotation.id);
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
	let classes = doc.documentElement.classList;

	// Always tear both modes down first, so switching between them can't leave
	// half of the previous mode applied.
	classes.remove(LOCKED_CLASS);
	classes.remove(REVIEW_CLASS);
	clearReviewOverlays(doc);
	detachReviewRefresh(pdfViewer);
	clearBackdropColor(doc);
	if (win) {
		clearSupersampling(win);
	}

	if (mode === "focus") {
		classes.add(LOCKED_CLASS);
		syncBackdropColor(doc);
		if (win) {
			setSupersampling(win, SUPERSAMPLE_FACTOR);
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
	updateControls(controls, doc);
	Zotero.debug(`Focus Reader: mode -> ${mode || "off"}`);
}

function updateControls(controls, doc) {
	let mode = currentMode(doc);
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
		setMode(reader, controls, currentMode(getViewerDocument(reader)) === "focus" ? null : "focus");
	});
	controls.review.addEventListener("click", () => {
		setMode(reader, controls, currentMode(getViewerDocument(reader)) === "review" ? null : "review");
	});
	controls.prev.addEventListener("click", () => {
		stepAnnotation(reader, getViewerDocument(reader), -1);
	});
	controls.next.addEventListener("click", () => {
		stepAnnotation(reader, getViewerDocument(reader), 1);
	});

	updateControls(controls, viewerDoc);
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
