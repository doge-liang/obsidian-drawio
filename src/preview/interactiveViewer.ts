import { MarkdownRenderChild } from 'obsidian';
import { MAX_VIEWPORT_HEIGHT, MIN_VIEWPORT_HEIGHT } from './viewportHeight';

export interface InteractiveViewerOptions {
  /** Resolved at interaction time so settings changes affect existing previews. */
  isEnabled?: () => boolean;
  initialHeight?: number;
  onHeightCommit?: (height: number) => void;
  onEdit?: () => void;
}

export interface BindSvgOptions {
  /** Page changes replace the SVG but must not resize the surrounding insertion. */
  preserveViewportHeight?: boolean;
}

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rendered content rectangle in client coordinates (letterbox-aware). */
interface ContentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Fine-grained multiplicative step per wheel notch. */
const WHEEL_ZOOM_STEP = 1.02;
/** Coarser step for the discrete toolbar buttons — 2% per click is imperceptible. */
const BUTTON_ZOOM_STEP = 1.25;
const MAX_SCALE = 8;
const SCALE_EPSILON = 0.0001;
/** Pointer travel (px) below which a resize gesture is a click, not a resize. */
const RESIZE_COMMIT_THRESHOLD = 2;
/**
 * Breathing room between the diagram and the viewport edge at Fit, in CSS px.
 * GraphViewer's own ~12 unit gutter alone left shapes touching the accent
 * border and the toolbar sitting on top of the diagram's corner.
 */
export const FIT_PADDING_PX = 24;
/** The top edge reserves the toolbar's band (8px offset + ~34px bar) as well,
 *  so at Fit the toolbar floats over empty space, not over the first shape —
 *  which a tall, narrow flowchart otherwise loses behind it. */
export const FIT_PADDING_TOP_PX = 44;
/** ...never more than this share of the viewport's smaller side, so a tiny or
 *  very flat viewport keeps most of its area for the diagram. */
const FIT_PADDING_MAX_SHARE = 0.1;
/** Automatic viewports stop at this share of the visible pane (or window) height
 *  so a tall diagram can always be seen whole without scrolling the note. */
export const AUTO_HEIGHT_VIEWPORT_SHARE = 0.9;
/** Narrowest viewport; keeps the toolbar inside the frame for tiny diagrams. */
export const MIN_VIEWPORT_WIDTH = 240;
/**
 * Scroll containers whose visible height bounds an automatic viewport — the
 * nearest of Live Preview's CodeMirror scroller, the Reading-view scroller,
 * or a file view's content pane. Falls back to the window when none encloses
 * the preview (a detached render, or a future Obsidian that renames them).
 */
const SCROLL_CONTAINER_SELECTOR = '.cm-scroller, .markdown-preview-view, .view-content';

/**
 * In-place zoom/pan viewer over a rendered preview SVG.
 *
 * Geometry model — three boxes, all in the SVG's own user units:
 *  - `contentBox`: the SVG's intrinsic viewBox as produced by ViewerRenderer
 *    (the diagram bounds plus GraphViewer's gutter). Never changes per bind.
 *  - `baseBox`: what Fit shows — the content box padded by FIT_PADDING_PX of
 *    screen space (FIT_PADDING_TOP_PX on top, where the toolbar floats) and
 *    widened/heightened to the viewport's aspect ratio, so at 1x the diagram
 *    sits clear of the border and the toolbar and the viewBox maps onto the
 *    viewport without letterboxing. Re-derived whenever the viewport's pixel
 *    size changes (pane resize, manual resize, fullscreen).
 *  - `currentBox`: the zoomed/panned window into `baseBox`; scale is
 *    `baseBox.width / currentBox.width`, panning is clamped to `baseBox`.
 *
 * Layout model: the preview is wrapped in a block `.drawio-interactive-frame`
 * that owns the viewport's WIDTH — `min(diagram natural width, 100%)` with a
 * floor of MIN_VIEWPORT_WIDTH — and hosts the toolbar and the resize handle,
 * so they align with the viewport rather than the (possibly wider) root. The
 * explicit width matters: an `![[embed]]` root is an inline-block, and a
 * `width:100%;height:100%` SVG inside one makes the block's shrink-to-fit
 * width depend on the SVG's intrinsic ratio times the height we set — a
 * feedback loop that both collapsed the embed when its height was reduced and
 * would oscillate under any height-from-width rule. The preview's HEIGHT is
 * automatic (diagram aspect at that width, capped to the visible pane) until
 * a user or a persisted value fixes it. A ResizeObserver keeps both the
 * automatic height and the base box in step with layout changes.
 */
export class InteractiveViewerController extends MarkdownRenderChild {
  private active = false;
  private disposed = false;
  private svg: SVGSVGElement | null = null;
  private contentBox: ViewBox | null = null;
  private naturalWidth = 0;
  private baseBox: ViewBox | null = null;
  private currentBox: ViewBox | null = null;
  private frame: number | null = null;
  private viewportFrame: HTMLElement;
  private toolbar: HTMLElement;
  private zoomInButton!: HTMLButtonElement;
  private zoomOutButton!: HTMLButtonElement;
  private fitButton!: HTMLButtonElement;
  private fullscreenButton!: HTMLButtonElement;
  private editButton!: HTMLButtonElement;
  private closeFullscreenButton!: HTMLButtonElement;
  private resizeHandle: HTMLElement;
  private doc: Document;
  private viewportInitialized = false;
  private manuallyResized = false;
  private resizeStartY = 0;
  private resizeStartHeight = 0;
  private resizeMoved = false;
  private viewportHeight = 0;
  private panStartX = 0;
  private panStartY = 0;
  private panStartBox: ViewBox | null = null;
  /** Follows the viewport's layout size for the controller's lifetime. */
  private viewportObserver: ResizeObserver | null = null;

  constructor(
    private root: HTMLElement,
    private preview: HTMLElement,
    private opts: InteractiveViewerOptions = {},
  ) {
    super(root);
    this.doc = root.ownerDocument;
    this.root.classList.add('drawio-interactive');
    this.viewportFrame = this.wrapPreview();
    this.toolbar = this.createToolbar();
    this.resizeHandle = this.createResizeHandle();
    this.root.addEventListener('click', this.onRootClick);
    this.preview.addEventListener('wheel', this.onWheel, { passive: false });
    this.preview.addEventListener('pointerdown', this.onPanStart);
    this.addDocumentListeners(this.doc);
  }

  get isActive(): boolean { return this.active; }

  applyPersistedHeight(height: number): void {
    if (this.disposed || this.opts.isEnabled?.() === false) return;
    this.rebindIfDocumentChanged();
    const next = clamp(height, MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT);
    this.opts.initialHeight = next;
    this.manuallyResized = true;
    if (this.viewportInitialized && Math.abs(this.viewportHeight - next) < 0.5) return;
    if (!this.svg || !this.contentBox) return;
    this.applyViewport(this.svg, next);
    this.fit();
  }

  bindSvg(svg: SVGSVGElement | null, opts: BindSvgOptions = {}): void {
    this.rebindIfDocumentChanged();
    const preservedHeight = opts.preserveViewportHeight && this.viewportInitialized
      ? this.viewportHeight
      : null;
    const wasManuallyResized = this.manuallyResized;
    this.cancelFrame();
    this.svg?.classList.remove('drawio-interactive-svg');
    this.svg = svg;
    this.contentBox = svg ? parseViewBox(svg.getAttribute('viewBox')) : null;
    this.naturalWidth = svg && this.contentBox ? naturalWidthOf(svg, this.contentBox) : 0;
    // Until the viewport has a layout to fit into, Fit is the bare content
    // box; syncGeometry swaps in the padded, aspect-fitted one at the first
    // measurement — zoom and pan work on whichever is current.
    this.baseBox = this.contentBox ? { ...this.contentBox } : null;
    this.currentBox = this.contentBox ? { ...this.contentBox } : null;
    this.viewportInitialized = false;
    this.manuallyResized = preservedHeight === null
      ? this.opts.initialHeight !== undefined
      : wasManuallyResized;
    this.deactivate();
    this.updateControls();
    if (this.opts.isEnabled?.() === false) return;
    if (preservedHeight !== null && svg && this.contentBox) {
      // A page flip keeps the insertion's footprint — width as well as height —
      // and fits the new page inside it.
      this.applyViewport(svg, preservedHeight);
      return;
    }
    this.applyFrameWidth();
    this.initializeViewport();
  }

  activate(): void {
    if (this.disposed || this.opts.isEnabled?.() === false || !this.svg) return;
    this.rebindIfDocumentChanged();
    this.initializeViewport();
    this.active = true;
    this.root.classList.add('drawio-interactive-active');
    this.updateControls();
  }

  deactivate(): void {
    this.endPan();
    this.active = false;
    this.root.classList.remove('drawio-interactive-active');
    this.updateControls();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Being torn down while fullscreen (e.g. the note re-renders) would leave
    // the pane stuck fullscreen with no exit control — reconcile first.
    if (this.doc.fullscreenElement === this.root && typeof this.doc.exitFullscreen === 'function') {
      try {
        void this.doc.exitFullscreen().catch(() => { /* host is already leaving */ });
      } catch { /* host denies fullscreen control */ }
    }
    this.deactivate();
    this.root.classList.remove('drawio-interactive');
    this.root.classList.remove('drawio-interactive-fullscreen');
    this.root.removeEventListener('click', this.onRootClick);
    this.preview.removeEventListener('wheel', this.onWheel);
    this.preview.removeEventListener('pointerdown', this.onPanStart);
    this.removeDocumentListeners(this.doc);
    this.doc.removeEventListener('pointermove', this.onResizeMove);
    this.doc.removeEventListener('pointerup', this.onResizeEnd);
    this.doc.removeEventListener('pointercancel', this.onResizeEnd);
    this.doc.removeEventListener('pointermove', this.onPanMove);
    this.doc.removeEventListener('pointerup', this.onPanEnd);
    this.disconnectViewportObserver();
    this.cancelFrame();
    this.toolbar.remove();
    this.resizeHandle.remove();
    this.unwrapPreview();
    this.preview.classList.remove('drawio-interactive-viewport');
    this.preview.style.removeProperty('height');
    this.releaseSvg();
    this.svg = null;
    this.contentBox = null;
    this.baseBox = null;
    this.currentBox = null;
  }

  onunload(): void {
    this.dispose();
  }

  private addDocumentListeners(doc: Document): void {
    // Capture phase for click-outside: content click handlers (embeds, other
    // plugins) may stopPropagation during bubbling, which must not leave a
    // second viewer stuck active.
    doc.addEventListener('click', this.onDocumentClick, true);
    doc.addEventListener('keydown', this.onDocumentKeydown);
    doc.addEventListener('fullscreenchange', this.onFullscreenChange);
    doc.defaultView?.addEventListener('resize', this.onWindowResize);
  }

  private removeDocumentListeners(doc: Document): void {
    doc.removeEventListener('click', this.onDocumentClick, true);
    doc.removeEventListener('keydown', this.onDocumentKeydown);
    doc.removeEventListener('fullscreenchange', this.onFullscreenChange);
    doc.defaultView?.removeEventListener('resize', this.onWindowResize);
  }

  /**
   * Obsidian adopts a pane's DOM into a popout window after mount; the
   * document-level listeners must follow the root's current document or
   * Escape, click-outside, drags, and fullscreen keep targeting the old
   * window (same pattern as DrawioEditor.rebindIfWindowChanged). Checked at
   * every element-bound entry point, since those listeners travel with the DOM.
   */
  private rebindIfDocumentChanged(): void {
    const current = this.root.ownerDocument;
    if (current === this.doc) return;
    this.removeDocumentListeners(this.doc);
    this.doc = current;
    if (this.disposed) return;
    this.addDocumentListeners(current);
    // A ResizeObserver belongs to one window; re-arm it from the new one.
    if (this.viewportObserver) {
      this.disconnectViewportObserver();
      this.observeViewport();
    }
  }

  /**
   * Interpose a block frame between the preview and its parent. The frame is
   * the viewport's sizing and positioning context (see the class comment) and
   * survives page flips, which re-render INTO the preview (`preview.empty()`)
   * and would wipe anything placed inside it.
   */
  private wrapPreview(): HTMLElement {
    const frame = this.doc.createElement('div');
    frame.classList.add('drawio-interactive-frame');
    const parent = this.preview.parentNode;
    if (parent) parent.insertBefore(frame, this.preview);
    else this.root.appendChild(frame);
    frame.appendChild(this.preview);
    return frame;
  }

  private unwrapPreview(): void {
    const frame = this.viewportFrame;
    if (this.preview.parentNode === frame) {
      frame.parentNode?.insertBefore(this.preview, frame);
    }
    frame.remove();
  }

  private createToolbar(): HTMLElement {
    const toolbar = this.viewportFrame.createDiv({ cls: 'drawio-interactive-toolbar' });
    toolbar.setAttribute('aria-label', 'Interactive viewer controls');
    this.zoomInButton = this.createButton(toolbar, '+', 'Zoom in', () => this.zoomBy(BUTTON_ZOOM_STEP));
    this.zoomOutButton = this.createButton(toolbar, '−', 'Zoom out', () => this.zoomBy(1 / BUTTON_ZOOM_STEP));
    this.fitButton = this.createButton(toolbar, 'Fit', 'Fit diagram', () => this.fit());
    this.editButton = this.createButton(
      toolbar, 'Edit', 'Edit diagram', () => { void this.runEditAction(); },
    );
    this.fullscreenButton = this.createButton(
      toolbar, 'Full screen', 'Enter full screen', () => { void this.enterFullscreen(); },
    );
    this.closeFullscreenButton = this.createButton(
      toolbar, '×', 'Exit full screen', () => { void this.exitFullscreen(); },
    );
    this.closeFullscreenButton.hidden = true;
    return toolbar;
  }

  private createResizeHandle(): HTMLElement {
    // Lives in the frame, so it spans exactly the viewport's width and sits on
    // its bottom edge by CSS alone — whatever padding or banner the host puts
    // around the preview.
    const handle = this.viewportFrame.createDiv({ cls: 'drawio-interactive-resize-handle' });
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-label', 'Resize interactive viewer');
    handle.setAttribute('aria-orientation', 'horizontal');
    handle.addEventListener('pointerdown', this.onResizeStart);
    return handle;
  }

  private createButton(
    toolbar: HTMLElement,
    label: string,
    ariaLabel: string,
    action: () => void,
  ): HTMLButtonElement {
    const button = toolbar.createEl('button', { text: label });
    button.disabled = true;
    button.setAttribute('aria-label', ariaLabel);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      // A pane can move into a popout without any prior rebinding interaction
      // (e.g. the "Move to new window" command while the viewer is active) —
      // and this handler's stopPropagation keeps onRootClick from rebinding.
      this.rebindIfDocumentChanged();
      action();
    });
    return button;
  }

  private onRootClick = (event: MouseEvent): void => {
    const target = this.eventNode(event);
    if (target && this.preview.contains(target)) this.activate();
  };

  private onDocumentClick = (event: MouseEvent): void => {
    if (!this.active) return;
    const target = this.eventNode(event);
    if (!target || !this.root.contains(target)) this.deactivate();
  };

  private onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (this.doc.fullscreenElement === this.root) void this.exitFullscreen();
    this.deactivate();
  };

  private onFullscreenChange = (): void => {
    const fullscreen = this.doc.fullscreenElement === this.root;
    this.root.classList.toggle('drawio-interactive-fullscreen', fullscreen);
    this.fullscreenButton.hidden = fullscreen;
    this.closeFullscreenButton.hidden = !fullscreen;
    this.closeFullscreenButton.disabled = !fullscreen;
    // The viewport's size just changed (or is about to, once the host lays
    // the fullscreen element out); the observer catches the latter, this
    // covers hosts without one.
    this.refreshViewport();
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.active || event.deltaY === 0) return;
    this.rebindIfDocumentChanged();
    event.preventDefault();
    this.zoomBy(event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP, event.clientX, event.clientY);
  };

  private onPanStart = (event: PointerEvent): void => {
    if (event.button !== 0) return; // never let a right/middle press activate or pan
    this.rebindIfDocumentChanged();
    if (!this.active) this.activate();
    const base = this.baseBox;
    const current = this.currentBox;
    if (!this.active || !base || !current) return;
    if (base.width / current.width <= 1 + SCALE_EPSILON) return;
    event.preventDefault();
    event.stopPropagation();
    this.panStartX = event.clientX;
    this.panStartY = event.clientY;
    this.panStartBox = { ...current };
    this.root.classList.add('drawio-interactive-panning');
    this.doc.addEventListener('pointermove', this.onPanMove);
    this.doc.addEventListener('pointerup', this.onPanEnd);
    this.doc.addEventListener('pointercancel', this.onPanEnd);
  };

  private onPanMove = (event: PointerEvent): void => {
    const svg = this.svg;
    const base = this.baseBox;
    const start = this.panStartBox;
    if (!svg || !base || !start) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    event.preventDefault();
    // `preserveAspectRatio="meet"` letterboxes the content inside the client
    // rect once the viewport aspect no longer matches the viewBox; pixel
    // deltas convert to viewBox units through the rendered content scale,
    // not the raw rect dimensions.
    const scale = Math.min(rect.width / start.width, rect.height / start.height);
    if (scale <= 0) return;
    this.currentBox = {
      x: clamp(
        start.x - (event.clientX - this.panStartX) / scale,
        base.x,
        base.x + base.width - start.width,
      ),
      y: clamp(
        start.y - (event.clientY - this.panStartY) / scale,
        base.y,
        base.y + base.height - start.height,
      ),
      width: start.width,
      height: start.height,
    };
    this.scheduleViewBoxWrite();
  };

  private onPanEnd = (): void => {
    this.endPan();
  };

  private endPan(): void {
    if (!this.panStartBox) return;
    this.panStartBox = null;
    this.root.classList.remove('drawio-interactive-panning');
    this.doc.removeEventListener('pointermove', this.onPanMove);
    this.doc.removeEventListener('pointerup', this.onPanEnd);
    this.doc.removeEventListener('pointercancel', this.onPanEnd);
  }

  private async enterFullscreen(): Promise<void> {
    if (!this.active || typeof this.root.requestFullscreen !== 'function') return;
    try {
      await this.root.requestFullscreen();
      this.onFullscreenChange();
    } catch {
      // The host may deny fullscreen; the rest of the viewer remains usable.
    }
  }

  private async exitFullscreen(): Promise<void> {
    if (this.doc.fullscreenElement !== this.root || typeof this.doc.exitFullscreen !== 'function') return;
    try {
      await this.doc.exitFullscreen();
      this.onFullscreenChange();
    } catch {
      // The host may already be leaving fullscreen; fullscreenchange reconciles state.
    }
  }

  private async runEditAction(): Promise<void> {
    if (this.doc.fullscreenElement === this.root) await this.exitFullscreen();
    this.deactivate();
    this.opts.onEdit?.();
  }

  private onResizeStart = (event: PointerEvent): void => {
    if (!this.active) return;
    this.rebindIfDocumentChanged();
    event.preventDefault();
    event.stopPropagation();
    this.resizeStartY = event.clientY;
    this.resizeStartHeight = parseFloat(this.preview.style.height)
      || this.preview.getBoundingClientRect().height;
    this.resizeMoved = false;
    this.root.classList.add('drawio-interactive-resizing');
    this.doc.addEventListener('pointermove', this.onResizeMove);
    this.doc.addEventListener('pointerup', this.onResizeEnd);
    this.doc.addEventListener('pointercancel', this.onResizeEnd);
  };

  private onResizeMove = (event: PointerEvent): void => {
    // Judge the gesture by raw pointer travel, not by the clamped height
    // delta (clamping an out-of-range start height would inflate a 1px
    // wiggle past the threshold) — and until the drag engages, leave the
    // viewport completely untouched so a click never disturbs the zoom.
    if (!this.resizeMoved
        && Math.abs(event.clientY - this.resizeStartY) < RESIZE_COMMIT_THRESHOLD) {
      return;
    }
    this.resizeMoved = true;
    this.manuallyResized = true;
    const height = clamp(
      this.resizeStartHeight + event.clientY - this.resizeStartY,
      MIN_VIEWPORT_HEIGHT,
      MAX_VIEWPORT_HEIGHT,
    );
    // An explicit user height IS a viewport — initialize from it even when
    // the automatic measurement was deferred (detached render).
    if (this.svg) this.applyViewport(this.svg, height);
    else this.setViewportHeight(height);
    this.fit();
  };

  private onResizeEnd = (): void => {
    this.root.classList.remove('drawio-interactive-resizing');
    this.doc.removeEventListener('pointermove', this.onResizeMove);
    this.doc.removeEventListener('pointerup', this.onResizeEnd);
    this.doc.removeEventListener('pointercancel', this.onResizeEnd);
    // A plain click on the handle (zero drag) must not touch the note.
    if (!this.resizeMoved) return;
    this.resizeMoved = false;
    this.opts.onHeightCommit?.(Math.round(this.viewportHeight));
  };

  private onWindowResize = (): void => {
    // Same isEnabled gate as every other entry point: after the click action
    // is switched away, a window resize must not re-apply the viewport.
    if (this.disposed || this.opts.isEnabled?.() === false) return;
    if (!this.viewportInitialized) this.initializeViewport();
    else this.refreshViewport();
  };

  private initializeViewport(): void {
    if (this.viewportInitialized) return;
    const content = this.contentBox;
    const svg = this.svg;
    const win = this.doc.defaultView;
    if (!content || !svg || !win) return;
    if (this.opts.initialHeight !== undefined) {
      this.applyViewport(svg, clamp(this.opts.initialHeight, MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT));
      return;
    }
    const width = this.measureWidth();
    if (width <= 0) {
      // Detached or hidden (code blocks and Reading-view sections render
      // detached): measuring now would produce a bogus height. Watch for the
      // first real layout instead — otherwise a tall diagram renders at full
      // height until the user clicks or resizes the OS window (Obsidian pane
      // drags don't fire window resize, and PDF export never clicks).
      this.observeViewport();
      return;
    }
    this.applyViewport(svg, this.autoHeightFor(width, content, win));
  }

  /**
   * Layout moved under an initialized viewport (pane resize, sidebar toggle,
   * fullscreen, a height change of our own): re-derive an automatic height
   * from the new width and re-fit the base box to the new aspect.
   */
  private refreshViewport(): void {
    if (this.disposed || !this.viewportInitialized) return;
    const content = this.contentBox;
    const svg = this.svg;
    const win = this.doc.defaultView;
    if (!content || !svg || !win) return;
    const fullscreen = this.doc.fullscreenElement === this.root;
    if (!fullscreen) {
      this.applyFrameWidth();
      if (!this.manuallyResized) {
        const width = this.measureWidth();
        if (width > 0) {
          const height = this.autoHeightFor(width, content, win);
          if (Math.abs(height - this.viewportHeight) >= 0.5) this.setViewportHeight(height);
        }
      }
    }
    this.syncGeometry();
  }

  private onViewportResize = (): void => {
    if (this.disposed || this.opts.isEnabled?.() === false) return;
    if (!this.viewportInitialized) this.initializeViewport();
    else this.refreshViewport();
  };

  private observeViewport(): void {
    const win = this.doc.defaultView;
    if (!win || this.viewportObserver || typeof win.ResizeObserver !== 'function') return;
    this.viewportObserver = new win.ResizeObserver(this.onViewportResize);
    this.viewportObserver.observe(this.preview);
  }

  private disconnectViewportObserver(): void {
    this.viewportObserver?.disconnect();
    this.viewportObserver = null;
  }

  private measureWidth(): number {
    return this.preview.getBoundingClientRect().width
      || this.viewportFrame.getBoundingClientRect().width
      || this.root.getBoundingClientRect().width;
  }

  /** The frame takes the diagram's natural width (floored for the toolbar);
   *  CSS caps it at the container, so wide diagrams still fill the line. */
  private applyFrameWidth(): void {
    if (this.naturalWidth <= 0) return;
    this.viewportFrame.style.width = `${Math.max(this.naturalWidth, MIN_VIEWPORT_WIDTH)}px`;
  }

  /**
   * Height at which the diagram, padded per {@link fitPadding}, exactly fills
   * `width` — capped to the visible pane so a tall diagram is seen whole.
   */
  private autoHeightFor(width: number, content: ViewBox, win: Window): number {
    const ratio = content.height / content.width;
    const topFactor = FIT_PADDING_TOP_PX / FIT_PADDING_PX;
    const pad = Math.min(FIT_PADDING_PX, FIT_PADDING_MAX_SHARE * width);
    let height = (width - 2 * pad) * ratio + pad * (1 + topFactor);
    if (FIT_PADDING_MAX_SHARE * height < pad) {
      // A flat diagram: the padding is bound by the height, not the width —
      // solve h = (w - 2·s·h)·r + s·h·(1 + t) for h, with s = the share cap
      // and t = the top factor.
      const s = FIT_PADDING_MAX_SHARE;
      height = (width * ratio) / (1 + 2 * s * ratio - s * (1 + topFactor));
    }
    return clamp(height, MIN_VIEWPORT_HEIGHT, Math.min(this.availableHeight(win), MAX_VIEWPORT_HEIGHT));
  }

  private availableHeight(win: Window): number {
    const scroller = this.preview.closest<HTMLElement>(SCROLL_CONTAINER_SELECTOR);
    const visible = scroller && scroller.clientHeight > 0 ? scroller.clientHeight : win.innerHeight;
    return Math.max(1, visible * AUTO_HEIGHT_VIEWPORT_SHARE);
  }

  private applyViewport(svg: SVGSVGElement, height: number): void {
    this.preview.classList.add('drawio-interactive-viewport');
    svg.classList.add('drawio-interactive-svg');
    this.setViewportHeight(height);
    this.viewportInitialized = true;
    this.observeViewport();
    this.syncGeometry();
  }

  private setViewportHeight(height: number): void {
    this.viewportHeight = height;
    this.preview.style.height = `${height}px`;
  }

  /**
   * Re-derive the base box from the viewport's current pixel size, keeping
   * the user's zoom level and centre when zoomed (a fresh bind, or 1x, snaps
   * to the new Fit). Also the moment the padded/aspect-fitted viewBox is
   * first written to the SVG, so the inactive preview already shows what
   * activation will — the first click never changes the picture.
   */
  private syncGeometry(): void {
    const svg = this.svg;
    const content = this.contentBox;
    if (!svg || !content) return;
    const prevBase = this.baseBox;
    const prevCurrent = this.currentBox;
    const base = this.computeBaseBox(svg, content);
    this.baseBox = base;
    const prevScale = prevBase && prevCurrent ? prevBase.width / prevCurrent.width : 1;
    if (prevBase && prevCurrent && prevScale > 1 + SCALE_EPSILON) {
      const width = base.width / prevScale;
      const height = base.height / prevScale;
      const centerX = prevCurrent.x + prevCurrent.width / 2;
      const centerY = prevCurrent.y + prevCurrent.height / 2;
      this.currentBox = {
        x: clamp(centerX - width / 2, base.x, base.x + base.width - width),
        y: clamp(centerY - height / 2, base.y, base.y + base.height - height),
        width,
        height,
      };
    } else {
      this.currentBox = { ...base };
    }
    this.updateControls();
    this.scheduleViewBoxWrite();
  }

  /**
   * The Fit box: the content padded by {@link fitPadding} of screen space and
   * expanded to the viewport's aspect ratio — centred horizontally, and
   * vertically below the toolbar band with any surplus split evenly. While the
   * viewport has no layout (detached/hidden) the content box itself is used;
   * the observer re-derives the real one at the first layout.
   */
  private computeBaseBox(svg: SVGSVGElement, content: ViewBox): ViewBox {
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { ...content };
    const { side, top } = fitPadding(rect.width, rect.height);
    const scale = Math.min(
      (rect.width - 2 * side) / content.width,
      (rect.height - top - side) / content.height,
    );
    if (!(scale > 0)) return { ...content };
    const width = rect.width / scale;
    const height = rect.height / scale;
    const surplusY = height - content.height - (top + side) / scale;
    return {
      x: content.x - (width - content.width) / 2,
      y: content.y - top / scale - surplusY / 2,
      width,
      height,
    };
  }

  private zoomBy(factor: number, clientX?: number, clientY?: number): void {
    const svg = this.svg;
    const base = this.baseBox;
    const current = this.currentBox;
    if (!svg || !base || !current) return;

    const scale = base.width / current.width;
    const nextScale = clamp(scale * factor, 1, MAX_SCALE);
    if (Math.abs(nextScale - scale) < SCALE_EPSILON) return;

    const content = this.contentRect(svg, current);
    const rx = clientX === undefined || !content
      ? 0.5
      : clamp((clientX - content.left) / content.width, 0, 1);
    const ry = clientY === undefined || !content
      ? 0.5
      : clamp((clientY - content.top) / content.height, 0, 1);
    const anchorX = current.x + rx * current.width;
    const anchorY = current.y + ry * current.height;
    const width = base.width / nextScale;
    const height = base.height / nextScale;

    this.currentBox = {
      x: clamp(anchorX - rx * width, base.x, base.x + base.width - width),
      y: clamp(anchorY - ry * height, base.y, base.y + base.height - height),
      width,
      height,
    };
    this.updateControls();
    this.scheduleViewBoxWrite();
  }

  /**
   * The client rectangle the viewBox content actually occupies. The base box
   * is fitted to the viewport's aspect, so normally this is the whole client
   * rect — but between a layout change and the observer's re-fit the default
   * `preserveAspectRatio` ("xMidYMid meet") letterboxes the content, and an
   * anchor computed over the raw rect would drift the zoom under the cursor.
   */
  private contentRect(svg: SVGSVGElement, box: ViewBox): ContentRect | null {
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const scale = Math.min(rect.width / box.width, rect.height / box.height);
    const width = box.width * scale;
    const height = box.height * scale;
    return {
      left: rect.left + (rect.width - width) / 2,
      top: rect.top + (rect.height - height) / 2,
      width,
      height,
    };
  }

  private fit(): void {
    const svg = this.svg;
    const content = this.contentBox;
    if (!svg || !content) return;
    this.baseBox = this.computeBaseBox(svg, content);
    this.currentBox = { ...this.baseBox };
    this.updateControls();
    this.scheduleViewBoxWrite();
  }

  private updateControls(): void {
    if (!this.zoomInButton) return;
    const ready = this.active && this.baseBox !== null && this.currentBox !== null;
    const scale = ready ? this.baseBox!.width / this.currentBox!.width : 1;
    this.root.classList.toggle('drawio-interactive-zoomed', ready && scale > 1 + SCALE_EPSILON);
    this.zoomInButton.disabled = !ready || scale >= MAX_SCALE - SCALE_EPSILON;
    this.zoomOutButton.disabled = !ready || scale <= 1 + SCALE_EPSILON;
    this.fitButton.disabled = !ready || scale <= 1 + SCALE_EPSILON;
    this.fullscreenButton.disabled = !ready || typeof this.root.requestFullscreen !== 'function';
    this.editButton.disabled = !ready || this.opts.onEdit === undefined;
  }

  private scheduleViewBoxWrite(): void {
    const win = this.doc.defaultView;
    if (!win || this.frame !== null) return;
    // A re-fit that lands on the box already shown (same layout, a detached
    // preview) needs no frame at all.
    if (this.svg && this.currentBox
        && this.svg.getAttribute('viewBox') === formatViewBox(this.currentBox)) {
      return;
    }
    this.frame = win.requestAnimationFrame(() => {
      this.frame = null;
      if (this.svg && this.currentBox) {
        this.svg.setAttribute('viewBox', formatViewBox(this.currentBox));
      }
    });
  }

  private cancelFrame(): void {
    if (this.frame === null) return;
    this.doc.defaultView?.cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /** Hand the SVG back as ViewerRenderer produced it: intrinsic viewBox, no viewport class. */
  private releaseSvg(): void {
    const svg = this.svg;
    if (!svg) return;
    svg.classList.remove('drawio-interactive-svg');
    if (this.contentBox) svg.setAttribute('viewBox', formatViewBox(this.contentBox));
  }

  /**
   * Duck-type the event target instead of an instanceof check against one
   * realm's Node constructor — after a pane moves to a popout window, events
   * arrive from a different realm and a realm-bound check drops them.
   */
  private eventNode(event: Event): Node | null {
    const target = event.target as Node | null;
    return target && typeof target.nodeType === 'number' ? target : null;
  }
}

/**
 * Screen-space margins around the diagram at Fit for a viewport of the given
 * pixel size: FIT_PADDING_PX on the sides and bottom, the toolbar band on top,
 * both shrunk proportionally for viewports too small to afford them.
 */
function fitPadding(viewportWidth: number, viewportHeight: number): { side: number; top: number } {
  const side = Math.min(
    FIT_PADDING_PX,
    FIT_PADDING_MAX_SHARE * Math.min(viewportWidth, viewportHeight),
  );
  return { side, top: side * (FIT_PADDING_TOP_PX / FIT_PADDING_PX) };
}

function formatViewBox(box: ViewBox): string {
  return `${box.x} ${box.y} ${box.width} ${box.height}`;
}

function parseViewBox(raw: string | null): ViewBox | null {
  if (!raw) return null;
  const values = raw.trim().split(/[\s,]+/).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const x = values[0]!;
  const y = values[1]!;
  const width = values[2]!;
  const height = values[3]!;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** ViewerRenderer sizes the SVG with an explicit `width` attribute equal to the
 *  diagram bounds; the viewBox width is the same number and the fallback. */
function naturalWidthOf(svg: SVGSVGElement, content: ViewBox): number {
  const attr = parseFloat(svg.getAttribute('width') ?? '');
  return Number.isFinite(attr) && attr > 0 ? attr : content.width;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
