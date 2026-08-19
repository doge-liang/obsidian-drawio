import { describe, expect, it, vi } from 'vitest';
import { InteractiveViewerController } from '../src/preview/interactiveViewer';

function fixture(): {
  root: HTMLElement;
  preview: HTMLElement;
  svg: SVGSVGElement;
  controller: InteractiveViewerController;
} {
  const root = document.body.createDiv({ cls: 'drawio-codeblock' });
  const preview = root.createDiv({ cls: 'drawio-preview' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 200 100');
  preview.appendChild(svg);
  const controller = new InteractiveViewerController(root, preview);
  controller.bindSvg(svg);
  return { root, preview, svg, controller };
}

describe('InteractiveViewerController walking skeleton', () => {
  it('initializes viewport geometry before activation and the first click does not resize it', () => {
    const root = document.body.createDiv({ cls: 'drawio-codeblock' });
    const preview = root.createDiv({ cls: 'drawio-preview' });
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 100, right: 600, bottom: 100, x: 0, y: 0,
      toJSON: () => ({}),
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 100');
    preview.appendChild(svg);
    const controller = new InteractiveViewerController(root, preview);
    controller.bindSvg(svg);

    expect(controller.isActive).toBe(false);
    // 600px wide, 2:1 diagram, 24px side/bottom padding plus the 44px
    // toolbar band on top: (600 - 48) / 2 + 24 + 44.
    expect(preview.style.height).toBe('344px');
    const heightBeforeClick = preview.style.height;
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(controller.isActive).toBe(true);
    expect(preview.style.height).toBe(heightBeforeClick);
    controller.dispose();
  });

  it('starts inactive and renders zoom, Fit, and disabled Edit controls', () => {
    const { root, controller } = fixture();
    expect(controller.isActive).toBe(false);
    expect(root.classList.contains('drawio-interactive-active')).toBe(false);
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.drawio-interactive-toolbar button'));
    expect(buttons.map((button) => button.textContent)).toEqual([
      '+', '−', 'Fit', 'Edit', 'Full screen', '×',
    ]);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    controller.dispose();
  });

  it('activates only when the diagram preview is clicked', () => {
    const { root, preview, controller } = fixture();
    root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(controller.isActive).toBe(false);
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(controller.isActive).toBe(true);
    expect(root.classList.contains('drawio-interactive-active')).toBe(true);
    controller.dispose();
  });

  it('deactivates on Escape and on a click outside the viewer', () => {
    const { preview, controller } = fixture();
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(controller.isActive).toBe(false);

    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(controller.isActive).toBe(false);
    controller.dispose();
  });

  it('intercepts wheel only while active and batches viewBox writes through RAF', () => {
    const { preview, svg, controller } = fixture();
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0,
      toJSON: () => ({}),
    });
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    const inactiveWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true });
    preview.dispatchEvent(inactiveWheel);
    expect(inactiveWheel.defaultPrevented).toBe(false);

    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const firstWheel = new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -100, clientX: 50, clientY: 25,
    });
    const secondWheel = new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -100, clientX: 50, clientY: 25,
    });
    preview.dispatchEvent(firstWheel);
    preview.dispatchEvent(secondWheel);
    expect(firstWheel.defaultPrevented).toBe(true);
    expect(frames).toHaveLength(1);
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 100');

    frames.shift()!(0);
    const zoomed = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const x = zoomed[0]!;
    const y = zoomed[1]!;
    const width = zoomed[2]!;
    const height = zoomed[3]!;
    expect(width).toBeCloseTo(200 / 1.02 ** 2);
    expect(height).toBeCloseTo(100 / 1.02 ** 2);
    // The content coordinate under the 25%-from-top-left cursor stays fixed.
    expect(x + 0.25 * width).toBeCloseTo(50);
    expect(y + 0.25 * height).toBeCloseTo(25);
    expect(preview.querySelectorAll('svg')).toHaveLength(1);
    expect(preview.querySelector('svg')).toBe(svg);
    controller.dispose();
    raf.mockRestore();
  });

  it('clamps zoom between Fit and 8x', () => {
    const { root, preview, svg, controller } = fixture();
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 120; i += 1) {
      preview.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -1 }));
    }
    frames.shift()!(0);
    const limitButtons =
      Array.from(root.querySelectorAll<HTMLButtonElement>('.drawio-interactive-toolbar button'));
    const zoomIn = limitButtons[0]!;
    const zoomOut = limitButtons[1]!;
    expect(svg.getAttribute('viewBox')!.split(' ').map(Number)[2]).toBeCloseTo(25);
    expect(zoomIn.disabled).toBe(true);
    expect(zoomOut.disabled).toBe(false);

    for (let i = 0; i < 120; i += 1) {
      preview.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 1 }));
    }
    frames.shift()!(0);
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 100');
    expect(zoomOut.disabled).toBe(true);
    controller.dispose();
    raf.mockRestore();
  });

  it('zooms with toolbar controls and Fit restores the original viewBox', () => {
    const { root, preview, svg, controller } = fixture();
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const toolbarButtons =
      Array.from(root.querySelectorAll<HTMLButtonElement>('.drawio-interactive-toolbar button'));
    const zoomIn = toolbarButtons[0]!;
    const zoomOut = toolbarButtons[1]!;
    const fit = toolbarButtons[2]!;
    const edit = toolbarButtons[3]!;
    const fullscreen = toolbarButtons[4]!;
    expect(zoomIn.disabled).toBe(false);
    expect(zoomOut.disabled).toBe(true);
    expect(fit.disabled).toBe(true);
    expect(fullscreen.disabled).toBe(true);
    expect(edit.disabled).toBe(true);

    zoomIn.click();
    frames.shift()!(0);
    expect(svg.getAttribute('viewBox')).not.toBe('0 0 200 100');
    expect(zoomOut.disabled).toBe(false);
    expect(fit.disabled).toBe(false);

    fit.click();
    frames.shift()!(0);
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 100');
    expect(zoomOut.disabled).toBe(true);
    controller.dispose();
    raf.mockRestore();
  });

  it('runs the explicit Edit action without triggering the preview click action', () => {
    const root = document.body.createDiv({ cls: 'drawio-codeblock' });
    const preview = root.createDiv({ cls: 'drawio-preview' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 100');
    preview.appendChild(svg);
    const onEdit = vi.fn();
    const controller = new InteractiveViewerController(root, preview, { onEdit });
    controller.bindSvg(svg);
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    root.querySelector<HTMLButtonElement>('[aria-label="Edit diagram"]')!.click();

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(controller.isActive).toBe(false);
    controller.dispose();
  });

  it('exits fullscreen before running Edit', async () => {
    const root = document.body.createDiv({ cls: 'drawio-codeblock' });
    const preview = root.createDiv({ cls: 'drawio-preview' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 100');
    preview.appendChild(svg);
    const descriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });
    const requestFullscreen = vi.fn(() => {
      fullscreenElement = root;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    const exitFullscreen = vi.fn(() => {
      fullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    Object.defineProperty(root, 'requestFullscreen', { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen });
    const onEdit = vi.fn();
    const controller = new InteractiveViewerController(root, preview, { onEdit });
    controller.bindSvg(svg);
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[aria-label="Enter full screen"]')!.click();

    root.querySelector<HTMLButtonElement>('[aria-label="Edit diagram"]')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(controller.isActive).toBe(false);
    controller.dispose();
    if (descriptor) Object.defineProperty(document, 'fullscreenElement', descriptor);
    else delete (document as unknown as { fullscreenElement?: Element | null }).fullscreenElement;
  });

  it('enters and exits fullscreen through the preview document', () => {
    const { root, preview, controller } = fixture();
    const descriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });
    const requestFullscreen = vi.fn(() => {
      fullscreenElement = root;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    const exitFullscreen = vi.fn(() => {
      fullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    Object.defineProperty(root, 'requestFullscreen', { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen });
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    root.querySelector<HTMLButtonElement>('[aria-label="Enter full screen"]')!.click();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(root.classList.contains('drawio-interactive-fullscreen')).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Enter full screen"]')!.hidden).toBe(true);
    const close = root.querySelector<HTMLButtonElement>('[aria-label="Exit full screen"]')!;
    expect(close.hidden).toBe(false);

    close.click();
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(root.classList.contains('drawio-interactive-fullscreen')).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Enter full screen"]')!.hidden).toBe(false);

    root.querySelector<HTMLButtonElement>('[aria-label="Enter full screen"]')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(exitFullscreen).toHaveBeenCalledTimes(2);
    controller.dispose();
    if (descriptor) Object.defineProperty(document, 'fullscreenElement', descriptor);
    else delete (document as unknown as { fullscreenElement?: Element | null }).fullscreenElement;
  });

  it('creates a viewport whose height pads the diagram aspect ratio at the measured width', () => {
    const { root, preview, svg, controller } = fixture();
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 100, right: 600, bottom: 100, x: 0, y: 0,
      toJSON: () => ({}),
    });
    window.dispatchEvent(new Event('resize'));
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(preview.classList.contains('drawio-interactive-viewport')).toBe(true);
    expect(preview.style.height).toBe('344px');
    expect(svg.classList.contains('drawio-interactive-svg')).toBe(true);
    expect(root.querySelector('.drawio-interactive-resize-handle')).not.toBeNull();
    controller.dispose();
  });

  it('limits the automatic viewport by available window height for tall diagrams', () => {
    const { preview, svg, controller } = fixture();
    svg.setAttribute('viewBox', '0 0 100 400');
    controller.bindSvg(svg);
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 100, right: 600, bottom: 100, x: 0, y: 0,
      toJSON: () => ({}),
    });
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
    window.dispatchEvent(new Event('resize'));
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // 90% of the window: the whole diagram stays visible with room around it.
    expect(preview.style.height).toBe('630px');
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
    controller.dispose();
  });

  it('resizes the viewport vertically and Fit resets the current zoom', () => {
    const { root, preview, svg, controller } = fixture();
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 300, right: 600, bottom: 300, x: 0, y: 0,
      toJSON: () => ({}),
    });
    window.dispatchEvent(new Event('resize'));
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const zoomIn = root.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!;
    zoomIn.click();
    frames.shift()!(0);
    expect(svg.getAttribute('viewBox')).not.toBe('0 0 200 100');

    const handle = root.querySelector<HTMLElement>('.drawio-interactive-resize-handle')!;
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 300 }));
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 450 }));
    expect(preview.style.height).toBe('494px'); // 344 automatic + 150 dragged
    frames.shift()!(0);
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 100');
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 450 }));
    controller.dispose();
    raf.mockRestore();
  });

  it('uses a persisted height and commits the final drag height once', () => {
    const root = document.body.createDiv({ cls: 'drawio-codeblock' });
    const preview = root.createDiv({ cls: 'drawio-preview' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 100');
    preview.appendChild(svg);
    const onHeightCommit = vi.fn();
    const controller = new InteractiveViewerController(root, preview, {
      initialHeight: 420,
      onHeightCommit,
    });
    controller.bindSvg(svg);
    expect(preview.style.height).toBe('420px');

    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const handle = root.querySelector<HTMLElement>('.drawio-interactive-resize-handle')!;
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 420 }));
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 500 }));
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 520 }));
    expect(onHeightCommit).not.toHaveBeenCalled();
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 520 }));
    expect(onHeightCommit).toHaveBeenCalledTimes(1);
    expect(onHeightCommit).toHaveBeenCalledWith(520);
    controller.dispose();
  });

  it('applies a persisted height discovered after the SVG was bound', () => {
    const { preview, controller } = fixture();
    controller.applyPersistedHeight(560);
    expect(preview.style.height).toBe('560px');
    controller.dispose();
  });

  it('does not apply persisted height while Interactive Viewer is disabled', () => {
    const root = document.body.createDiv({ cls: 'drawio-codeblock' });
    const preview = root.createDiv({ cls: 'drawio-preview' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 100');
    preview.appendChild(svg);
    const controller = new InteractiveViewerController(root, preview, { isEnabled: () => false });
    controller.bindSvg(svg);
    controller.applyPersistedHeight(560);
    expect(preview.style.height).toBe('');
    expect(preview.classList.contains('drawio-interactive-viewport')).toBe(false);
    controller.dispose();
  });

  it('keeps the current zoom when the persisted height is unchanged', () => {
    const { root, preview, svg, controller } = fixture();
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 300, right: 600, bottom: 300, x: 0, y: 0,
      toJSON: () => ({}),
    });
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
    frames.shift()!(0);
    const zoomed = svg.getAttribute('viewBox');
    const height = parseFloat(preview.style.height);

    controller.applyPersistedHeight(height);

    expect(frames).toHaveLength(0);
    expect(svg.getAttribute('viewBox')).toBe(zoomed);
    controller.dispose();
    raf.mockRestore();
  });

  it('finishes and commits resize when the pointer gesture is cancelled', () => {
    const root = document.body.createDiv({ cls: 'drawio-codeblock' });
    const preview = root.createDiv({ cls: 'drawio-preview' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 100');
    preview.appendChild(svg);
    const onHeightCommit = vi.fn();
    const controller = new InteractiveViewerController(root, preview, { onHeightCommit });
    controller.bindSvg(svg);
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const handle = root.querySelector<HTMLElement>('.drawio-interactive-resize-handle')!;
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 420 }));
    document.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true, clientY: 420 }));
    const committedHeight = preview.style.height;

    expect(onHeightCommit).toHaveBeenCalledTimes(1);
    expect(root.classList.contains('drawio-interactive-resizing')).toBe(false);
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 520 }));
    expect(preview.style.height).toBe(committedHeight);
    controller.dispose();
  });

  it('rebinds a replacement page SVG, resets zoom, and preserves the viewport footprint', () => {
    const { root, preview, svg, controller } = fixture();
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 100, right: 600, bottom: 100, x: 0, y: 0,
      toJSON: () => ({}),
    });
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
    const frame = root.querySelector<HTMLElement>('.drawio-interactive-frame')!;
    const frameWidth = frame.style.width;

    const handle = root.querySelector<HTMLElement>('.drawio-interactive-resize-handle')!;
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 420 }));
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 420 }));
    expect(preview.style.height).toBe('664px'); // 344 automatic + 320 dragged

    const replacement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    replacement.setAttribute('viewBox', '10 20 400 300');
    replacement.setAttribute('width', '400');
    preview.empty();
    preview.appendChild(replacement);
    controller.bindSvg(replacement, { preserveViewportHeight: true });

    expect(controller.isActive).toBe(false);
    expect(preview.style.height).toBe('664px');
    // The new page's natural width must not reshape the insertion either.
    expect(frame.style.width).toBe(frameWidth);
    expect(replacement.getAttribute('viewBox')).toBe('10 20 400 300');
    expect(replacement.classList.contains('drawio-interactive-svg')).toBe(true);
    expect(preview.querySelectorAll('svg')).toHaveLength(1);
    expect(root.querySelectorAll('.drawio-interactive-toolbar')).toHaveLength(1);
    expect(svg.isConnected).toBe(false);
    controller.dispose();
  });

  it('pans a zoomed SVG by dragging, clamps to its bounds, and keeps the view after deactivation', () => {
    const { root, preview, svg, controller } = fixture();
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0,
      toJSON: () => ({}),
    });
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
    frames.shift()!(0);
    const zoomed = svg.getAttribute('viewBox')!;

    const start = new MouseEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 50,
    });
    preview.dispatchEvent(start);
    document.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, cancelable: true, clientX: 90, clientY: 45,
    }));
    expect(start.defaultPrevented).toBe(true);
    expect(frames).toHaveLength(1);
    frames.shift()!(0);
    const panned = svg.getAttribute('viewBox')!;
    expect(panned).not.toBe(zoomed);
    const [x, y] = panned.split(' ').map(Number);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);

    document.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, cancelable: true, clientX: 1000, clientY: 1000,
    }));
    frames.shift()!(0);
    expect(svg.getAttribute('viewBox')!.split(' ').slice(0, 2).map(Number)).toEqual([0, 0]);
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(controller.isActive).toBe(false);
    expect(svg.getAttribute('viewBox')!.split(' ').slice(0, 2).map(Number)).toEqual([0, 0]);

    preview.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 50,
    }));
    document.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, cancelable: true, clientX: 90, clientY: 45,
    }));
    frames.shift()!(0);
    expect(controller.isActive).toBe(true);
    expect(svg.getAttribute('viewBox')!.split(' ').map(Number)[0]).toBeGreaterThan(0);

    document.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, cancelable: true, clientX: 50, clientY: 25,
    }));
    expect(frames).toHaveLength(0);
    controller.dispose();
    raf.mockRestore();
  });

  it('does not commit a height when the resize handle is clicked without dragging', () => {
    const root = document.body.createDiv({ cls: 'drawio-codeblock' });
    const preview = root.createDiv({ cls: 'drawio-preview' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 100');
    preview.appendChild(svg);
    const onHeightCommit = vi.fn();
    const controller = new InteractiveViewerController(root, preview, {
      initialHeight: 420,
      onHeightCommit,
    });
    controller.bindSvg(svg);
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const handle = root.querySelector<HTMLElement>('.drawio-interactive-resize-handle')!;

    // Plain click: pointerdown + pointerup at the same position.
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 420 }));
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 420 }));
    expect(onHeightCommit).not.toHaveBeenCalled();

    // A wiggle below the threshold is still a click, not a resize.
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 420 }));
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 421 }));
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 421 }));
    expect(onHeightCommit).not.toHaveBeenCalled();

    // An actual drag commits once.
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 421 }));
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 500 }));
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 500 }));
    expect(onHeightCommit).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('zooms by a perceptible step from the toolbar buttons', () => {
    const { root, preview, svg, controller } = fixture();
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
    frames.shift()!(0);
    const [, , width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(width).toBeCloseTo(200 / 1.25);
    expect(height).toBeCloseTo(100 / 1.25);
    controller.dispose();
    raf.mockRestore();
  });

  it('anchors wheel zoom to the letterboxed content, not the raw client rect', () => {
    const { preview, svg, controller } = fixture();
    // Square viewport, 2:1 viewBox — "meet" letterboxes the content to the
    // vertical middle band (y 50..150 in client coordinates).
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0,
      toJSON: () => ({}),
    });
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    preview.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -100, clientX: 100, clientY: 75,
    }));
    frames.shift()!(0);
    const [x, y, width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    // clientY=75 is 25% into the rendered content band (top 50, height 100):
    // the content point (100, 25) must stay under the cursor.
    expect(x! + 0.5 * width!).toBeCloseTo(100);
    expect(y! + 0.25 * height!).toBeCloseTo(25);
    controller.dispose();
    raf.mockRestore();
  });

  it('defers automatic height while detached and initializes on activation', () => {
    const { root, preview, svg, controller } = fixture();
    // jsdom reports zero-size rects — exactly what a detached code-block or
    // Reading-view section measures. No bogus height may be applied from that.
    expect(preview.style.height).toBe('');
    expect(preview.classList.contains('drawio-interactive-viewport')).toBe(false);
    expect(svg.classList.contains('drawio-interactive-svg')).toBe(false);

    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 100, right: 600, bottom: 100, x: 0, y: 0,
      toJSON: () => ({}),
    });
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(preview.style.height).toBe('344px');
    expect(preview.classList.contains('drawio-interactive-viewport')).toBe(true);
    expect(root.querySelector('.drawio-interactive-resize-handle')).not.toBeNull();
    controller.dispose();
  });

  it('clamps the automatic height into the viewport bounds', () => {
    const { preview, svg, controller } = fixture();
    svg.setAttribute('viewBox', '0 0 2000 100'); // very flat diagram
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 100, right: 600, bottom: 100, x: 0, y: 0,
      toJSON: () => ({}),
    });
    controller.bindSvg(svg);
    // ~37px padded-proportional — clamped up to the 80px minimum.
    expect(preview.style.height).toBe('80px');
    controller.dispose();
  });

  it('anchors the resize handle to the preview wrapper, not the outer padded root', () => {
    const root = document.body.createDiv({ cls: 'drawio-preview-file-view' });
    const wrap = root.createDiv({ cls: 'drawio-preview-wrap' });
    const preview = wrap.createDiv({ cls: 'drawio-preview' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 100');
    preview.appendChild(svg);
    const controller = new InteractiveViewerController(root, preview);
    controller.bindSvg(svg);
    // The viewport frame takes the preview's place inside the wrapper and
    // hosts the handle, so it sits on the viewport's own bottom edge.
    const frame = root.querySelector<HTMLElement>('.drawio-interactive-frame')!;
    expect(frame.parentElement).toBe(wrap);
    expect(preview.parentElement).toBe(frame);
    const handle = root.querySelector<HTMLElement>('.drawio-interactive-resize-handle')!;
    expect(handle.parentElement).toBe(frame);
    controller.dispose();
    expect(root.querySelector('.drawio-interactive-resize-handle')).toBeNull();
    expect(root.querySelector('.drawio-interactive-frame')).toBeNull();
    expect(preview.parentElement).toBe(wrap);
  });

  it('rebinds document-level listeners after the pane is adopted into another document', () => {
    const { root, preview, controller } = fixture();
    const popoutDoc = document.implementation.createHTMLDocument('popout');
    popoutDoc.body.appendChild(root); // Obsidian adopts the pane DOM into the popout

    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(controller.isActive).toBe(true);

    // The original document no longer controls the viewer...
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(controller.isActive).toBe(true);
    // ...the adopting document does.
    popoutDoc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(controller.isActive).toBe(false);

    // Click-outside works in the popout document too.
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(controller.isActive).toBe(true);
    popoutDoc.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(controller.isActive).toBe(false);
    controller.dispose();
  });

  it('does not re-apply the viewport on window resize after the viewer is disabled', () => {
    const root = document.body.createDiv({ cls: 'drawio-codeblock' });
    const preview = root.createDiv({ cls: 'drawio-preview' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 100');
    preview.appendChild(svg);
    let enabled = true;
    const controller = new InteractiveViewerController(root, preview, { isEnabled: () => enabled });
    controller.bindSvg(svg); // jsdom measures 0 — stays deferred
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 100, right: 600, bottom: 100, x: 0, y: 0,
      toJSON: () => ({}),
    });

    enabled = false;
    window.dispatchEvent(new Event('resize'));
    expect(preview.style.height).toBe('');
    expect(preview.classList.contains('drawio-interactive-viewport')).toBe(false);

    enabled = true;
    window.dispatchEvent(new Event('resize'));
    expect(preview.style.height).toBe('344px');
    controller.dispose();
  });

  it('rebinds document listeners from the toolbar after a no-click popout adoption', () => {
    const { root, preview, controller } = fixture();
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(controller.isActive).toBe(true);

    // "Move to new window" relocates the pane without any prior interaction.
    const popoutDoc = document.implementation.createHTMLDocument('popout');
    popoutDoc.body.appendChild(root);
    root.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();

    // The original document lost control; the adopting one gained it.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(controller.isActive).toBe(true);
    popoutDoc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(controller.isActive).toBe(false);
    controller.dispose();
  });

  it('judges the resize threshold by pointer travel and leaves the viewport untouched below it', () => {
    const root = document.body.createDiv({ cls: 'drawio-codeblock' });
    const preview = root.createDiv({ cls: 'drawio-preview' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 100');
    preview.appendChild(svg);
    const onHeightCommit = vi.fn();
    const controller = new InteractiveViewerController(root, preview, { onHeightCommit });
    controller.bindSvg(svg);
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 300, right: 600, bottom: 300, x: 0, y: 0,
      toJSON: () => ({}),
    });
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
    frames.shift()!(0);
    const zoomed = svg.getAttribute('viewBox');

    // Simulate an out-of-range start height (SVG without usable viewBox
    // metrics): a 1px wiggle must not let the clamp difference commit.
    preview.style.height = '30px';
    const handle = root.querySelector<HTMLElement>('.drawio-interactive-resize-handle')!;
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 101 }));
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 101 }));

    expect(onHeightCommit).not.toHaveBeenCalled();
    expect(preview.style.height).toBe('30px'); // untouched — no clamp jump
    expect(frames).toHaveLength(0); // no fit(): the zoom survives a click
    expect(svg.getAttribute('viewBox')).toBe(zoomed);
    controller.dispose();
    raf.mockRestore();
  });

  it('initializes the deferred automatic height at the first real layout (ResizeObserver)', () => {
    const callbacks: Array<() => void> = [];
    const observed: Element[] = [];
    const disconnect = vi.fn();
    class FakeResizeObserver {
      constructor(private cb: () => void) {
        callbacks.push(() => { this.cb(); });
      }
      observe(el: Element): void { observed.push(el); }
      disconnect = disconnect;
      unobserve(): void { /* not used */ }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    try {
      const { preview, controller } = fixture(); // width 0: defers, arms the observer
      expect(observed).toContain(preview);
      expect(preview.style.height).toBe('');

      const rect = vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, width: 600, height: 100, right: 600, bottom: 100, x: 0, y: 0,
        toJSON: () => ({}),
      });
      callbacks[0]!();
      expect(preview.style.height).toBe('344px');
      expect(preview.classList.contains('drawio-interactive-viewport')).toBe(true);

      // The observer stays on: a pane resize re-derives the automatic height
      // from the new width instead of leaving the old one letterboxed.
      expect(disconnect).not.toHaveBeenCalled();
      rect.mockReturnValue({
        left: 0, top: 0, width: 500, height: 344, right: 500, bottom: 344, x: 0, y: 0,
        toJSON: () => ({}),
      });
      callbacks[0]!();
      expect(preview.style.height).toBe('294px'); // (500 - 48) / 2 + 24 + 44
      controller.dispose();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ignores right-button presses for activation and panning', () => {
    const { preview, controller } = fixture();
    preview.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 2, clientX: 50, clientY: 25,
    }));
    expect(controller.isActive).toBe(false);
    controller.dispose();
  });

  it('deactivates even when a bubble-phase handler stops click propagation', () => {
    const first = fixture();
    const second = fixture();
    // Embed roots stop propagation of their persistent click handler; the
    // document-level click-outside listener must still see the click.
    second.root.addEventListener('click', (event) => { event.stopPropagation(); });

    first.preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(first.controller.isActive).toBe(true);

    second.preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(second.controller.isActive).toBe(true);
    expect(first.controller.isActive).toBe(false);
    first.controller.dispose();
    second.controller.dispose();
  });

  it('fits the diagram with screen-space padding, expanded to the viewport aspect', () => {
    const { preview, svg, controller } = fixture();
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 344, right: 600, bottom: 344, x: 0, y: 0,
      toJSON: () => ({}),
    });
    // The viewport the automatic height produces for a 2:1 diagram at 600px.
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 344, right: 600, bottom: 344, x: 0, y: 0,
      toJSON: () => ({}),
    });
    window.dispatchEvent(new Event('resize'));
    expect(preview.style.height).toBe('344px');
    // Written before any click: the inactive preview already shows the fit.
    expect(frames).toHaveLength(1);
    frames.shift()!(0);
    const [x, y, width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    // 24px at the sides/bottom and 44px on top at the fit scale
    // (600 - 48) / 200 = 2.76: the box is the viewport in user units, centred
    // horizontally on the content and sitting below the toolbar band.
    expect(width).toBeCloseTo(600 / 2.76, 3);
    expect(height).toBeCloseTo(344 / 2.76, 3);
    expect(x).toBeCloseTo(-(600 / 2.76 - 200) / 2, 3);
    expect(y).toBeCloseTo(-44 / 2.76, 3);
    expect(width! / height!).toBeCloseTo(600 / 344, 6);
    controller.dispose();
    // Disposal hands the SVG back with its intrinsic viewBox.
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 100');
    raf.mockRestore();
  });

  it('gives the frame the diagram natural width with a floor for the toolbar', () => {
    const root = document.body.createDiv({ cls: 'drawio-embed' });
    const preview = root.createDiv({ cls: 'drawio-preview' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '-4 -4 320 160');
    svg.setAttribute('width', '320');
    svg.setAttribute('height', '160');
    preview.appendChild(svg);
    const controller = new InteractiveViewerController(root, preview, { initialHeight: 150 });
    controller.bindSvg(svg);
    const frame = root.querySelector<HTMLElement>('.drawio-interactive-frame')!;
    // Width follows the diagram, not the (persisted, shorter) height: an
    // embed's inline-block must not collapse when its viewport is made short.
    expect(frame.style.width).toBe('320px');
    expect(preview.style.height).toBe('150px');

    const small = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    small.setAttribute('viewBox', '0 0 120 60');
    small.setAttribute('width', '120');
    preview.empty();
    preview.appendChild(small);
    controller.bindSvg(small);
    expect(frame.style.width).toBe('240px');
    controller.dispose();
  });

  it('keeps the zoom level and re-fits the base box when the viewport changes size', () => {
    const callbacks: Array<() => void> = [];
    class FakeResizeObserver {
      constructor(private cb: () => void) { callbacks.push(() => { this.cb(); }); }
      observe(): void { /* not used */ }
      disconnect(): void { /* not used */ }
      unobserve(): void { /* not used */ }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    try {
      const { preview, svg, controller } = fixture();
      const frames: FrameRequestCallback[] = [];
      const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        frames.push(cb);
        return frames.length;
      });
      const rect = (width: number, height: number) => ({
        left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0,
        toJSON: () => ({}),
      });
      const previewRect = vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue(rect(600, 344));
      const svgRect = vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(rect(600, 344));
      callbacks[0]!();
      frames.shift()!(0);
      const fitWidth = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
      preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      preview.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaY: -100, clientX: 300, clientY: 162,
      }));
      frames.shift()!(0);
      expect(Number(svg.getAttribute('viewBox')!.split(' ')[2])).toBeCloseTo(fitWidth / 1.02, 6);

      // The pane narrows: the height follows the width, and the view keeps
      // its 1.02x zoom relative to the NEW fit instead of snapping back.
      previewRect.mockReturnValue(rect(500, 294));
      svgRect.mockReturnValue(rect(500, 294));
      callbacks[0]!();
      expect(preview.style.height).toBe('294px');
      frames.shift()!(0);
      const [, , width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
      const newFitWidth = 500 / ((500 - 48) / 200);
      expect(width).toBeCloseTo(newFitWidth / 1.02, 3);
      expect(width! / height!).toBeCloseTo(500 / 294, 6);
      controller.dispose();
      raf.mockRestore();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('caps the automatic height by the enclosing scroll container, not the window', () => {
    const scroller = document.body.createDiv({ cls: 'markdown-preview-view' });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 500 });
    const root = scroller.createDiv({ cls: 'drawio-codeblock' });
    const preview = root.createDiv({ cls: 'drawio-preview' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 400');
    preview.appendChild(svg);
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 100, right: 600, bottom: 100, x: 0, y: 0,
      toJSON: () => ({}),
    });
    const controller = new InteractiveViewerController(root, preview);
    controller.bindSvg(svg);
    // 90% of the 500px pane, although the window is taller.
    expect(preview.style.height).toBe('450px');
    controller.dispose();
    scroller.remove();
  });

  it('removes DOM and listeners when disposed', () => {
    const { root, preview, controller } = fixture();
    controller.dispose();
    expect(root.querySelector('.drawio-interactive-toolbar')).toBeNull();
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(controller.isActive).toBe(false);
    expect(root.classList.contains('drawio-interactive')).toBe(false);
  });
});
