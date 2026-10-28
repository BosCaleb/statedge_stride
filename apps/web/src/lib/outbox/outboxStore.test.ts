import { describe, expect, it } from 'vitest';
import { outboxStatus } from './outboxStore';

describe('outbox status', () => {
  it('is Saved when nothing waits, Saving while online, Offline while offline', () => {
    expect(outboxStatus({ pending: 0, failed: 0, sending: false, online: true })).toBe('saved');
    expect(outboxStatus({ pending: 2, failed: 0, sending: true, online: true })).toBe('saving');
    expect(outboxStatus({ pending: 2, failed: 0, sending: false, online: false })).toBe('offline');
  });

  it('needs attention whenever an entry failed permanently', () => {
    expect(outboxStatus({ pending: 0, failed: 1, sending: false, online: true })).toBe('attention');
    expect(outboxStatus({ pending: 3, failed: 1, sending: false, online: false })).toBe(
      'attention',
    );
  });
});
