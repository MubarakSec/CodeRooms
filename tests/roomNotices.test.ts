import { describe, expect, it } from 'vitest';
import {
  buildSuggestionReviewSummary,
  getDocumentResyncNotice,
  getJoinAccessDeniedNotice,
  getJoinAccessRetryActionLabel,
  getOwnerUnavailableNotice,
  getReconnectFailureNotice,
  getRoomClosedNotice,
  getRoomStateInvalidNotice
} from '../src/util/roomNotices';

describe('room notices', () => {
  it('returns shared recovery notices for common session failures', () => {
    expect(getJoinAccessDeniedNotice()).toContain('Unable to join room');
    expect(getJoinAccessRetryActionLabel()).toBe('Retry with secret or token');
    expect(getDocumentResyncNotice()).toContain('Resyncing shared file');
    expect(getOwnerUnavailableNotice()).toContain('owner is unavailable');
    expect(getRoomStateInvalidNotice()).toContain('active room state');
    expect(getRoomClosedNotice()).toContain('closed by the owner');
    expect(getReconnectFailureNotice()).toContain('unable to reconnect');
  });

  it('builds concise bulk review summaries', () => {
    expect(buildSuggestionReviewSummary({
      action: 'reject',
      reviewedCount: 3,
      alreadyReviewedCount: 1,
      conflictCount: 0,
      missingCount: 2
    })).toBe('Rejected 3 suggestions · 1 already reviewed · 2 missing');
  });
});
