import {
  InteractiveViewerController,
  type BindSvgOptions,
} from './interactiveViewer';

export interface InteractiveMountSpec {
  /** Re-resolved at interaction time so settings changes affect existing previews. */
  isEnabled: () => boolean;
  /** Persisted height already read by the caller (interactive-at-render path). */
  initialHeight?: number;
  /**
   * Fetches the height persisted in the note when the controller is first
   * constructed lazily (the click action was switched to Interactive viewer
   * after this preview rendered, so the caller never pre-read it).
   */
  loadPersistedHeight?: () => Promise<number | null>;
  onHeightCommit?: (height: number) => void;
  onEdit?: () => void;
  /** Hook the freshly constructed controller into the caller's lifecycle. */
  onController?: (controller: InteractiveViewerController) => void;
}

export interface InteractiveMountHandle {
  /** Null until the click action first resolves to the interactive viewer. */
  readonly controller: InteractiveViewerController | null;
  bindSvg(svg: SVGSVGElement | null, opts?: BindSvgOptions): void;
  dispose(): void;
}

/**
 * Mount the interactive viewer on a rendered preview.
 *
 * When the click action already resolves to the interactive viewer the
 * controller is constructed immediately (so a persisted height shapes the
 * first paint). In every other mode nothing is constructed — a controller
 * carries five document/window-level listeners plus `user-select: none`
 * styling, which previews that never use the viewer should not pay for.
 * Instead a single root-scoped click listener waits: if the user switches the
 * setting to Interactive viewer later, the first click on the preview
 * constructs the controller, applies the note's persisted height, and
 * activates it — matching the eager behavior without the standing cost.
 */
export function mountInteractiveViewer(
  root: HTMLElement,
  preview: HTMLElement,
  spec: InteractiveMountSpec,
): InteractiveMountHandle {
  let controller: InteractiveViewerController | null = null;
  let disposed = false;

  const construct = (): InteractiveViewerController => {
    const built = new InteractiveViewerController(root, preview, {
      isEnabled: spec.isEnabled,
      initialHeight: spec.initialHeight,
      onHeightCommit: spec.onHeightCommit,
      onEdit: spec.onEdit,
    });
    controller = built;
    spec.onController?.(built);
    built.bindSvg(preview.querySelector('svg'));
    return built;
  };

  const onLazyActivateClick = (event: MouseEvent): void => {
    if (disposed || controller || !spec.isEnabled()) return;
    const target = event.target as Node | null;
    if (!target || typeof target.nodeType !== 'number' || !preview.contains(target)) return;
    root.removeEventListener('click', onLazyActivateClick);
    const built = construct();
    built.activate();
    if (spec.loadPersistedHeight) {
      spec.loadPersistedHeight().then((height) => {
        if (height !== null) built.applyPersistedHeight(height);
      }).catch(() => { /* keep the automatic height */ });
    }
  };

  if (spec.isEnabled()) {
    construct();
  } else {
    root.addEventListener('click', onLazyActivateClick);
  }

  return {
    get controller() { return controller; },
    bindSvg(svg, opts) {
      controller?.bindSvg(svg, opts);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeEventListener('click', onLazyActivateClick);
      controller?.dispose();
      controller = null;
    },
  };
}
