import type { DiagramPage } from '../model/xmlUtils';

export interface PageControlOptions {
  pages: DiagramPage[];
  initialPage: number;
  onPageChange: (page: number) => void;
}

/**
 * Render a compact "‹ N / M ›" page-switcher bar into `container`. Caller is
 * responsible for only invoking this when `pages.length > 1` — this function
 * does not check that itself.
 */
export function renderPageControl(container: HTMLElement, opts: PageControlOptions): void {
  const { pages, onPageChange } = opts;
  let current = opts.initialPage;

  const prevBtn = container.createEl('button', { text: '‹' });
  const indicator = container.createSpan();
  const nextBtn = container.createEl('button', { text: '›' });

  function update(): void {
    indicator.textContent = `${current + 1} / ${pages.length}`;
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === pages.length - 1;
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

  update();
}
