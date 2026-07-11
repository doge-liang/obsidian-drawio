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

  it('renders no pin button without pin support', () => {
    const container = document.createElement('div');
    renderPageControl(container, { pages, initialPage: 0, onPageChange: () => {} });
    expect(container.querySelector('.drawio-pin')).toBeNull();
  });

  it('disables the pin button while the shown page is the pinned page', () => {
    const container = document.createElement('div');
    renderPageControl(container, {
      pages, initialPage: 1, onPageChange: () => {},
      pin: { pinnedPage: 1, onPin: () => {} },
    });
    const pin = container.querySelector<HTMLButtonElement>('.drawio-pin')!;
    expect(pin.disabled).toBe(true);
  });

  it('enables the pin button after flipping away and pins the shown page', () => {
    const container = document.createElement('div');
    const onPin = vi.fn();
    renderPageControl(container, {
      pages, initialPage: 0, onPageChange: () => {},
      pin: { pinnedPage: 0, onPin },
    });
    const [, nextBtn] = Array.from(container.querySelectorAll('button'));
    (nextBtn as HTMLButtonElement).click();
    const pin = container.querySelector<HTMLButtonElement>('.drawio-pin')!;
    expect(pin.disabled).toBe(false);
    pin.click();
    expect(onPin).toHaveBeenCalledWith(1);
  });

  it('stops pin-click propagation to wrapper click handlers', () => {
    const wrapper = document.createElement('div');
    const container = wrapper.createDiv();
    const wrapperClick = vi.fn();
    wrapper.addEventListener('click', wrapperClick);
    renderPageControl(container, {
      pages, initialPage: 1, onPageChange: () => {},
      pin: { pinnedPage: 0, onPin: () => {} },
    });
    container.querySelector<HTMLButtonElement>('.drawio-pin')!.click();
    expect(wrapperClick).not.toHaveBeenCalled();
  });
});
