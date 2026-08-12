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
    expect(preview.style.height).toBe('300px');
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

  it('creates a full-width viewport using the diagram aspect ratio', () => {
    const { root, preview, svg, controller } = fixture();
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 600, height: 100, right: 600, bottom: 100, x: 0, y: 0,
      toJSON: () => ({}),
    });
    window.dispatchEvent(new Event('resize'));
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(preview.classList.contains('drawio-interactive-viewport')).toBe(true);
    expect(preview.style.height).toBe('300px');
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
    expect(preview.style.height).toBe('700px');
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
    expect(preview.style.height).toBe('450px');
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

  it('rebinds a replacement page SVG, resets zoom, and preserves viewport height', () => {
    const { root, preview, svg, controller } = fixture();
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();

    const handle = root.querySelector<HTMLElement>('.drawio-interactive-resize-handle')!;
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 420 }));
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 420 }));
    expect(preview.style.height).toBe('420px');

    const replacement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    replacement.setAttribute('viewBox', '10 20 400 300');
    preview.empty();
    preview.appendChild(replacement);
    controller.bindSvg(replacement, { preserveViewportHeight: true });

    expect(controller.isActive).toBe(false);
    expect(preview.style.height).toBe('420px');
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

  it('removes DOM and listeners when disposed', () => {
    const { root, preview, controller } = fixture();
    controller.dispose();
    expect(root.querySelector('.drawio-interactive-toolbar')).toBeNull();
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(controller.isActive).toBe(false);
    expect(root.classList.contains('drawio-interactive')).toBe(false);
  });
});
