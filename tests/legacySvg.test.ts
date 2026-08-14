import { describe, it, expect } from 'vitest';
import { buildInitialSvg } from '../src/model/dualFormat';
import {
  isLegacyDrawioSvgContent, isLegacyDrawioSvgPath,
  legacyRenameStem, preferredLegacyRenamePath,
} from '../src/model/legacySvg';
import { uniquePath } from '../src/model/uniquePath';

/** The old Diagrams plugin's empty template (svg `content` = bare mxGraphModel). */
const EMPTY_DIAGRAMS_PLUGIN_SVG =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="1px" height="1px" ' +
  'content="&lt;mxGraphModel&gt;&lt;root&gt;&lt;mxCell id=&quot;0&quot;/&gt;' +
  '&lt;mxCell id=&quot;1&quot; parent=&quot;0&quot;/&gt;&lt;/root&gt;&lt;/mxGraphModel&gt;">' +
  '</svg>';

describe('isLegacyDrawioSvgPath', () => {
  it('accepts plain .svg and rejects dual-format / non-svg', () => {
    expect(isLegacyDrawioSvgPath('Untitled Diagram.svg')).toBe(true);
    expect(isLegacyDrawioSvgPath('dir/Foo.SVG')).toBe(true);
    expect(isLegacyDrawioSvgPath('a.drawio.svg')).toBe(false);
    expect(isLegacyDrawioSvgPath('a.drawio')).toBe(false);
    expect(isLegacyDrawioSvgPath('a.png')).toBe(false);
  });
});

describe('isLegacyDrawioSvgContent', () => {
  it('accepts the old plugin empty template', () => {
    expect(isLegacyDrawioSvgContent(EMPTY_DIAGRAMS_PLUGIN_SVG)).toBe(true);
  });

  it('accepts an svg whose content is a full mxfile', () => {
    expect(isLegacyDrawioSvgContent(buildInitialSvg(
      '<mxfile><diagram id="0" name="Page-1"><mxGraphModel><root/></mxGraphModel></diagram></mxfile>',
    ))).toBe(true);
  });

  it('rejects a plain picture svg and non-svg text', () => {
    expect(isLegacyDrawioSvgContent('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(false);
    expect(isLegacyDrawioSvgContent('not xml')).toBe(false);
  });
});

describe('preferredLegacyRenamePath', () => {
  it('rewrites the .svg suffix to .drawio.svg', () => {
    expect(preferredLegacyRenamePath('Untitled Diagram.svg')).toBe('Untitled Diagram.drawio.svg');
    expect(preferredLegacyRenamePath('dir/a.SVG')).toBe('dir/a.drawio.svg');
  });

  it('pairs with uniquePath when the preferred name is taken', () => {
    const dest = preferredLegacyRenamePath('notes/a.svg');
    expect(uniquePath(legacyRenameStem(dest), '.drawio.svg', (p) => p === dest))
      .toBe('notes/a 2.drawio.svg');
  });
});
