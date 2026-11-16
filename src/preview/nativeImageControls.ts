/** Native image controls are not diagram-opening hotspots. Duck typing also
 * works when an embed has been adopted into a popout window. */
export function isNativeImageControl(event: Event): boolean {
  const target = event.target as Element | null;
  return typeof target?.closest === 'function' &&
    target.closest('.image-resize-corner, .embed-actions, .embed-action') !== null;
}
