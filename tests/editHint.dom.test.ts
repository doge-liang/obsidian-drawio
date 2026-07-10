import { describe, it, expect } from 'vitest';
import { addEditHint } from '../src/preview/editHint';

// createDiv/createSpan are shimmed onto HTMLElement.prototype in tests/setup.ts;
// setIcon is a no-op in the obsidian stub.
describe('addEditHint', () => {
  it('appends a single .drawio-edit-hint element', () => {
    const parent = document.createElement('div');
    addEditHint(parent);
    expect(parent.querySelectorAll('.drawio-edit-hint')).toHaveLength(1);
  });

  it('contains an icon slot and an "Edit" text label', () => {
    const parent = document.createElement('div');
    addEditHint(parent);
    const hint = parent.querySelector('.drawio-edit-hint');
    expect(hint).not.toBeNull();
    expect(hint?.querySelector('.drawio-edit-hint-icon')).not.toBeNull();
    const labels = Array.from(hint?.querySelectorAll('span') ?? []);
    expect(labels.some((s) => s.textContent === 'Edit')).toBe(true);
  });

  it('renders a custom label when given one', () => {
    const parent = document.createElement('div');
    addEditHint(parent, 'Open', 'external-link');
    const labels = Array.from(parent.querySelectorAll('.drawio-edit-hint span'));
    expect(labels.some((s) => s.textContent === 'Open')).toBe(true);
  });

  it('does not register any inline click handler (clicks fall through to the preview)', () => {
    const parent = document.createElement('div');
    addEditHint(parent);
    const hint = parent.querySelector('.drawio-edit-hint') as HTMLElement | null;
    // The hint is purely decorative; interactivity lives on the preview wrapper.
    expect(hint?.getAttribute('onclick')).toBeNull();
  });
});
