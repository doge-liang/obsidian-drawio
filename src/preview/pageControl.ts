import { setIcon } from 'obsidian';
import type { DiagramPage } from '../model/xmlUtils';

export interface PageControlOptions {
  pages: DiagramPage[];
  initialPage: number;
  onPageChange: (page: number) => void;
  /** Optional pin support: adds a button that persists the shown page back
   *  into the note (embeds only — callers without a note omit this). */
  pin?: {
    /** Page index the note's link currently resolves to. */
    pinnedPage: number;
    /** Called with the currently shown page index. */
    onPin: (page: number) => void;
  };
}

/**
 * Render a compact "‹ N / M ›" page-switcher bar into `container`. Caller is
 * responsible for only invoking this when `pages.length > 1` — this function
 * does not check that itself.
 */
export function renderPageControl(container: HTMLElement, opts: PageControlOptions): void {
  const { pages, onPageChange, pin } = opts;
  let current = opts.initialPage;

  const prevBtn = container.createEl('button', { text: '‹' });
  const indicator = container.createSpan();
  const nextBtn = container.createEl('button', { text: '›' });
  let pinBtn: HTMLButtonElement | null = null;
  if (pin) {
    pinBtn = container.createEl('button', { cls: 'drawio-pin' });
    setIcon(pinBtn, 'pin');
    pinBtn.setAttribute('aria-label', 'Pin current page in the note');
    pinBtn.setAttribute('title', 'Pin current page in the note');
  }

  function update(): void {
    indicator.textContent = `${current + 1} / ${pages.length}`;
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === pages.length - 1;
    if (pinBtn && pin) pinBtn.disabled = current === pin.pinnedPage;
  }

  prevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (current === 0) return;
    current -= 1;
    update();
    onPageChange(current);
  });

  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (current === pages.length - 1) return;
    current += 1;
    update();
    onPageChange(current);
  });

  pinBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!pin || current === pin.pinnedPage) return;
    pin.onPin(current);
  });

  update();
}
