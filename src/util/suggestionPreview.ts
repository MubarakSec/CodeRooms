import { TextPatch } from '../connection/MessageTypes';

const DEFAULT_PREVIEW_PATCHES = 3;

export interface SuggestionPreview {
  text: string;
  truncated: boolean;
  omittedPatchCount: number;
}

export function buildSuggestionPreview(
  patches: TextPatch[],
  maxChars: number,
  maxPreviewPatches = DEFAULT_PREVIEW_PATCHES
): SuggestionPreview {
  const snippets = patches
    .slice(0, Math.max(1, maxPreviewPatches))
    .map(patch => (patch.text || 'Remove text').trim() || 'Remove text');
  const combined = snippets.join('\n');
  const truncated = combined.length > maxChars || patches.length > maxPreviewPatches;
  const text = truncated ? `${combined.slice(0, Math.max(0, maxChars)).trimEnd()}…` : combined;
  return {
    text,
    truncated,
    omittedPatchCount: Math.max(0, patches.length - maxPreviewPatches)
  };
}
