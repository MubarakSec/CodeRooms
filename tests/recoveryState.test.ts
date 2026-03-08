import { describe, expect, it } from 'vitest';
import { buildRecoveryMetrics } from '../server/recoveryState';

describe('recoveryState', () => {
  it('builds startup recovery counts and accounting from restored room snapshots', () => {
    const metrics = buildRecoveryMetrics([
      {
        ownerIp: '10.0.0.1',
        documents: [{ text: 'alpha' }, { text: 'beta' }],
        suggestions: [{ suggestionId: 's1' }],
        recoverableSessions: [{ sessionToken: 'owner-1' }, { sessionToken: 'collab-1' }],
        chat: [{ messageId: 'm1' }]
      },
      {
        ownerIp: '10.0.0.1',
        documents: [{ text: 'gamma' }],
        suggestions: [],
        recoverableSessions: [{ sessionToken: 'owner-2' }],
        chat: [{ messageId: 'm2' }, { messageId: 'm3' }]
      },
      {
        ownerIp: '10.0.0.2',
        documents: [],
        suggestions: [{ suggestionId: 's2' }, { suggestionId: 's3' }],
        recoverableSessions: [],
        chat: []
      }
    ]);

    expect(metrics.roomCount).toBe(3);
    expect(metrics.documentCount).toBe(3);
    expect(metrics.suggestionCount).toBe(3);
    expect(metrics.recoverableSessionCount).toBe(3);
    expect(metrics.chatMessageCount).toBe(3);
    expect(metrics.totalDocBytes).toBe(
      Buffer.byteLength('alpha', 'utf8') +
      Buffer.byteLength('beta', 'utf8') +
      Buffer.byteLength('gamma', 'utf8')
    );
    expect(metrics.roomCountByIp.get('10.0.0.1')).toBe(2);
    expect(metrics.roomCountByIp.get('10.0.0.2')).toBe(1);
  });

  it('returns zeroed metrics for an empty restore set', () => {
    const metrics = buildRecoveryMetrics([]);

    expect(metrics.roomCount).toBe(0);
    expect(metrics.documentCount).toBe(0);
    expect(metrics.suggestionCount).toBe(0);
    expect(metrics.recoverableSessionCount).toBe(0);
    expect(metrics.chatMessageCount).toBe(0);
    expect(metrics.totalDocBytes).toBe(0);
    expect(metrics.roomCountByIp.size).toBe(0);
  });
});
