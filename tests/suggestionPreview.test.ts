import { describe, expect, it } from 'vitest';

import { buildSuggestionPreview } from '../src/util/suggestionPreview';

describe('suggestionPreview', () => {
  it('caps preview text and reports omitted patches', () => {
    const preview = buildSuggestionPreview([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 }
        },
        text: 'alpha'
      },
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 1 }
        },
        text: 'beta'
      },
      {
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 1 }
        },
        text: 'gamma'
      },
      {
        range: {
          start: { line: 3, character: 0 },
          end: { line: 3, character: 1 }
        },
        text: 'delta'
      }
    ], 12, 2);

    expect(preview.text).toBe('alpha\nbeta…');
    expect(preview.omittedPatchCount).toBe(2);
    expect(preview.truncated).toBe(true);
  });

  it('uses a remove-text fallback when a patch deletes content', () => {
    const preview = buildSuggestionPreview([{
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 }
      },
      text: ''
    }], 20);

    expect(preview.text).toBe('Remove text');
    expect(preview.omittedPatchCount).toBe(0);
    expect(preview.truncated).toBe(false);
  });
});
