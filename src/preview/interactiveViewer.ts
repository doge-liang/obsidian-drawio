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
 * Minimal interactive-viewer lifecycle and activation shell.
 *
 * Zoom, pan, Edit, and fullscreen are intentionally added by later stages. This
 * walking skeleton only owns activation, exit, a placeholder toolbar, and cleanup.
 */
export class InteractiveViewerController extends MarkdownRenderChild {
  private active = false;
  private disposed = false;
  private svg: SVGSVGElement | null = null;
  private baseBox: ViewBox | null = null;
  private currentBox: ViewBox | null = null;
  private frame: number | null = null;
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

  constructor(
    private root: HTMLElement,
    private preview: HTMLElement,
    private opts: InteractiveViewerOptions = {},
  ) {
    super(root);
    this.doc = root.ownerDocument;
    this.root.classList.add('drawio-interactive');
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
    if (!this.svg || !this.baseBox) return;
    this.preview.classList.add('drawio-interactive-viewport');
    this.svg.classList.add('drawio-interactive-svg');
    this.setViewportHeight(next);
    this.viewportInitialized = true;
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
    this.baseBox = svg ? parseViewBox(svg.getAttribute('viewBox')) : null;
    this.currentBox = this.baseBox ? { ...this.baseBox } : null;
    this.viewportInitialized = false;
    this.manuallyResized = preservedHeight === null
      ? this.opts.initialHeight !== undefined
      : wasManuallyResized;
    this.deactivate();
    this.updateControls();
    if (this.opts.isEnabled?.() === false) return;
    if (preservedHeight !== null && svg && this.baseBox) {
      this.preview.classList.add('drawio-interactive-viewport');
      svg.classList.add('drawio-interactive-svg');
      this.setViewportHeight(preservedHeight);
      this.viewportInitialized = true;
      return;
    }
    this.initializeViewport();
  }

  activate(): void {
    if (this.disposed || this.opts.isEnabled?.() === false || !this.svg) return;
    this.rebindIfDocumentChanged();
    this.initializeViewport();
    this.active = true;
    this.root.classList.add('drawio-interactive-active');
    this.setHintHidden(true);
    this.updateControls();
  }

  deactivate(): void {
    this.endPan();
    this.active = false;
    this.root.classList.remove('drawio-interactive-active');
    this.setHintHidden(false);
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
    this.cancelFrame();
    this.toolbar.remove();
    this.resizeHandle.remove();
    this.preview.classList.remove('drawio-interactive-viewport');
    this.preview.style.removeProperty('height');
    this.svg?.classList.remove('drawio-interactive-svg');
    this.svg = null;
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
    if (!this.disposed) this.addDocumentListeners(current);
  }

  private createToolbar(): HTMLElement {
    const toolbar = this.root.createDiv({ cls: 'drawio-interactive-toolbar' });
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
    // Anchor the handle to the preview's own positioned wrapper when there is
    // one (the read-only file view nests the preview inside a padded content
    // element); positioning against the outer root would leave the handle
    // offset from the viewport's real bottom edge by that padding.
    const host = this.preview.parentElement ?? this.root;
    const handle = host.createDiv({ cls: 'drawio-interactive-resize-handle' });
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
  };

  private setHintHidden(hidden: boolean): void {
    for (const hint of Array.from(this.root.querySelectorAll<HTMLElement>('.drawio-edit-hint'))) {
      hint.hidden = hidden;
    }
  }

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
    const height = clamp(
      this.resizeStartHeight + event.clientY - this.resizeStartY,
      MIN_VIEWPORT_HEIGHT,
      MAX_VIEWPORT_HEIGHT,
    );
    if (Math.abs(height - this.resizeStartHeight) >= RESIZE_COMMIT_THRESHOLD) {
      this.resizeMoved = true;
      this.manuallyResized = true;
    }
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
    if (!this.manuallyResized) this.initializeViewport(true);
  };

  private initializeViewport(force = false): void {
    if (this.viewportInitialized && !force) return;
    const base = this.baseBox;
    const svg = this.svg;
    const win = this.doc.defaultView;
    if (!base || !svg || !win) return;
    if (this.opts.initialHeight !== undefined) {
      this.applyViewport(svg, clamp(this.opts.initialHeight, MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT));
      return;
    }
    const width = this.preview.getBoundingClientRect().width
      || this.root.getBoundingClientRect().width;
    if (width <= 0) {
      // Detached or hidden (code blocks and Reading-view sections render
      // detached): measuring now would produce a bogus height. Stay
      // uninitialized — activation and window resizes re-enter here once the
      // element is laid out.
      return;
    }
    const availableHeight = Math.max(1, win.innerHeight);
    const height = clamp(
      Math.min(width * base.height / base.width, availableHeight),
      MIN_VIEWPORT_HEIGHT,
      MAX_VIEWPORT_HEIGHT,
    );
    this.applyViewport(svg, height);
  }

  private applyViewport(svg: SVGSVGElement, height: number): void {
    this.preview.classList.add('drawio-interactive-viewport');
    svg.classList.add('drawio-interactive-svg');
    this.setViewportHeight(height);
    this.viewportInitialized = true;
  }

  private setViewportHeight(height: number): void {
    this.viewportHeight = height;
    this.preview.style.height = `${height}px`;
    this.resizeHandle.style.top = `${Math.max(0, height - 5)}px`;
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
   * The client rectangle the viewBox content actually occupies. With the
   * default `preserveAspectRatio` ("xMidYMid meet") the content is scaled
   * uniformly and centered, leaving letterbox margins whenever the element's
   * aspect differs from the viewBox's — mapping the cursor over the full
   * client rect would drift the zoom anchor on every wheel step.
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
    if (!this.baseBox) return;
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
    this.frame = win.requestAnimationFrame(() => {
      this.frame = null;
      if (this.svg && this.currentBox) {
        const { x, y, width, height } = this.currentBox;
        this.svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
      }
    });
  }

  private cancelFrame(): void {
    if (this.frame === null) return;
    this.doc.defaultView?.cancelAnimationFrame(this.frame);
    this.frame = null;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
