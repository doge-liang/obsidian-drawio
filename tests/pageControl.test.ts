import { describe, it, expect, vi } from 'vitest';
import { renderPageControl } from '../src/preview/pageControl';
import type { DiagramPage } from '../src/model/xmlUtils';

const pages: DiagramPage[] = [
  { id: '0', name: 'Page-1' },
  { id: '1', name: 'Page-2' },
  { id: '2', name: 'Page-3' },
];

describe('renderPageControl', () => {
  it('shows "1 / 3" and disables the prev button at the first page', () => {
    const container = document.createElement('div');
    renderPageControl(container, { pages, initialPage: 0, onPageChange: () => {} });
    const [prevBtn, nextBtn] = Array.from(container.querySelectorAll('button'));
    expect(container.textContent).toContain('1 / 3');
    expect((prevBtn as HTMLButtonElement).disabled).toBe(true);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables the next button at the last page', () => {
    const container = document.createElement('div');
    renderPageControl(container, { pages, initialPage: 2, onPageChange: () => {} });
    const [prevBtn, nextBtn] = Array.from(container.querySelectorAll('button'));
    expect((prevBtn as HTMLButtonElement).disabled).toBe(false);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('advances the page, updates the indicator, and calls onPageChange when next is clicked', () => {
    const container = document.createElement('div');
    const onPageChange = vi.fn();
    renderPageControl(container, { pages, initialPage: 0, onPageChange });
    const [, nextBtn] = Array.from(container.querySelectorAll('button'));
    (nextBtn as HTMLButtonElement).click();
    expect(onPageChange).toHaveBeenCalledWith(1);
    expect(container.textContent).toContain('2 / 3');
  });

  it('goes back a page and calls onPageChange when prev is clicked', () => {
    const container = document.createElement('div');
    const onPageChange = vi.fn();
    renderPageControl(container, { pages, initialPage: 1, onPageChange });
    const [prevBtn] = Array.from(container.querySelectorAll('button'));
    (prevBtn as HTMLButtonElement).click();
    expect(onPageChange).toHaveBeenCalledWith(0);
    expect(container.textContent).toContain('1 / 3');
  });

  it('does not advance past the last page or call onPageChange', () => {
    const container = document.createElement('div');
    const onPageChange = vi.fn();
    renderPageControl(container, { pages, initialPage: 2, onPageChange });
    const [, nextBtn] = Array.from(container.querySelectorAll('button'));
    (nextBtn as HTMLButtonElement).click();
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('does not go before the first page or call onPageChange', () => {
    const container = document.createElement('div');
    const onPageChange = vi.fn();
    renderPageControl(container, { pages, initialPage: 0, onPageChange });
    const [prevBtn] = Array.from(container.querySelectorAll('button'));
    (prevBtn as HTMLButtonElement).click();
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('stops click propagation so a wrapper click handler is not also triggered', () => {
    const wrapper = document.createElement('div');
    const container = wrapper.createDiv();
    const wrapperClick = vi.fn();
    wrapper.addEventListener('click', wrapperClick);
    renderPageControl(container, { pages, initialPage: 0, onPageChange: () => {} });
    const [, nextBtn] = Array.from(container.querySelectorAll('button'));
    (nextBtn as HTMLButtonElement).click();
    expect(wrapperClick).not.toHaveBeenCalled();
  });
});
