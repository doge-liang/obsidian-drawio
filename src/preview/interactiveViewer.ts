import { MarkdownRenderChild } from 'obsidian';
import { MAX_VIEWPORT_HEIGHT, MIN_VIEWPORT_HEIGHT } from './viewportHeight';

export interface InteractiveViewerOptions {
  /** Resolved at interaction time so settings changes affect existing previews. */
  isEnabled?: () => boolean;
  initialHeight?: number;
  onHeightCommit?: (height: number) => void;
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

const ZOOM_STEP = 1.2;
const MAX_SCALE = 8;
const SCALE_EPSILON = 0.0001;

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
  private editButton!: HTMLButtonElement;
  private resizeHandle: HTMLElement;
  private doc: Document;
  private viewportInitialized = false;
  private manuallyResized = false;
  private resizeStartY = 0;
  private resizeStartHeight = 0;
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
    this.doc.addEventListener('click', this.onDocumentClick);
    this.doc.addEventListener('keydown', this.onDocumentKeydown);
    this.doc.defaultView?.addEventListener('resize', this.onWindowResize);
  }

  get isActive(): boolean { return this.active; }

  bindSvg(svg: SVGSVGElement | null, opts: BindSvgOptions = {}): void {
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
    this.deactivate();
    this.root.classList.remove('drawio-interactive');
    this.root.removeEventListener('click', this.onRootClick);
    this.preview.removeEventListener('wheel', this.onWheel);
    this.preview.removeEventListener('pointerdown', this.onPanStart);
    this.doc.removeEventListener('click', this.onDocumentClick);
    this.doc.removeEventListener('keydown', this.onDocumentKeydown);
    this.doc.removeEventListener('pointermove', this.onResizeMove);
    this.doc.removeEventListener('pointerup', this.onResizeEnd);
    this.doc.removeEventListener('pointermove', this.onPanMove);
    this.doc.removeEventListener('pointerup', this.onPanEnd);
    this.doc.defaultView?.removeEventListener('resize', this.onWindowResize);
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

  private createToolbar(): HTMLElement {
    const toolbar = this.root.createDiv({ cls: 'drawio-interactive-toolbar' });
    toolbar.setAttribute('aria-label', 'Interactive viewer controls');
    this.zoomInButton = this.createButton(toolbar, '+', 'Zoom in', () => this.zoomBy(ZOOM_STEP));
    this.zoomOutButton = this.createButton(toolbar, '−', 'Zoom out', () => this.zoomBy(1 / ZOOM_STEP));
    this.fitButton = this.createButton(toolbar, 'Fit', 'Fit diagram', () => this.fit());
    this.editButton = this.createButton(toolbar, 'Edit', 'Edit diagram', () => {});
    return toolbar;
  }

  private createResizeHandle(): HTMLElement {
    const handle = this.root.createDiv({ cls: 'drawio-interactive-resize-handle' });
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
    if (event.key === 'Escape') this.deactivate();
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.active || event.deltaY === 0) return;
    event.preventDefault();
    this.zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, event.clientX, event.clientY);
  };

  private onPanStart = (event: PointerEvent): void => {
    if (!this.active) this.activate();
    const base = this.baseBox;
    const current = this.currentBox;
    if (!this.active || event.button !== 0 || !base || !current) return;
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
    this.currentBox = {
      x: clamp(
        start.x - (event.clientX - this.panStartX) * start.width / rect.width,
        base.x,
        base.x + base.width - start.width,
      ),
      y: clamp(
        start.y - (event.clientY - this.panStartY) * start.height / rect.height,
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

  private onResizeStart = (event: PointerEvent): void => {
    if (!this.active) return;
    event.preventDefault();
    event.stopPropagation();
    this.resizeStartY = event.clientY;
    this.resizeStartHeight = parseFloat(this.preview.style.height)
      || this.preview.getBoundingClientRect().height;
    this.manuallyResized = true;
    this.root.classList.add('drawio-interactive-resizing');
    this.doc.addEventListener('pointermove', this.onResizeMove);
    this.doc.addEventListener('pointerup', this.onResizeEnd);
  };

  private onResizeMove = (event: PointerEvent): void => {
    const height = clamp(
      this.resizeStartHeight + event.clientY - this.resizeStartY,
      MIN_VIEWPORT_HEIGHT,
      MAX_VIEWPORT_HEIGHT,
    );
    this.setViewportHeight(height);
    this.fit();
  };

  private onResizeEnd = (): void => {
    this.root.classList.remove('drawio-interactive-resizing');
    this.doc.removeEventListener('pointermove', this.onResizeMove);
    this.doc.removeEventListener('pointerup', this.onResizeEnd);
    this.opts.onHeightCommit?.(Math.round(this.viewportHeight));
  };

  private onWindowResize = (): void => {
    if (this.viewportInitialized && !this.manuallyResized) this.initializeViewport(true);
  };

  private initializeViewport(force = false): void {
    if (this.viewportInitialized && !force) return;
    const base = this.baseBox;
    const svg = this.svg;
    const win = this.doc.defaultView;
    if (!base || !svg || !win) return;
    const width = this.preview.getBoundingClientRect().width
      || this.root.getBoundingClientRect().width
      || base.width;
    const proportionalHeight = width * base.height / base.width;
    const availableHeight = Math.max(1, win.innerHeight);
    this.preview.classList.add('drawio-interactive-viewport');
    svg.classList.add('drawio-interactive-svg');
    const height = this.opts.initialHeight === undefined
      ? Math.min(proportionalHeight, availableHeight)
      : clamp(this.opts.initialHeight, MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT);
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

    const rect = svg.getBoundingClientRect();
    const rx = clientX === undefined || rect.width <= 0
      ? 0.5
      : clamp((clientX - rect.left) / rect.width, 0, 1);
    const ry = clientY === undefined || rect.height <= 0
      ? 0.5
      : clamp((clientY - rect.top) / rect.height, 0, 1);
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
    // Wired in the toolbar/Edit stage.
    this.editButton.disabled = true;
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

  /** Use the preview document's DOM realm so popout-window events are accepted. */
  private eventNode(event: Event): Node | null {
    const NodeCtor = this.doc.defaultView?.Node;
    return NodeCtor && event.target instanceof NodeCtor ? event.target : null;
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
