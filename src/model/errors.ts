/** Thrown by resolveBaseUrl() when the editor source is Offline but the bundled
 * webapp isn't installed. The message is user-facing: both editor entry points
 * (DrawioModal, DrawioFileView) display it verbatim. There is deliberately no
 * automatic online fallback — offline means offline. */
export class OfflineEditorNotInstalledError extends Error {
  constructor() {
    super(
      "The offline drawio editor isn't installed. Install it in the Drawio plugin " +
      'settings, or switch the editor source to Online.',
    );
    this.name = 'OfflineEditorNotInstalledError';
  }
}
