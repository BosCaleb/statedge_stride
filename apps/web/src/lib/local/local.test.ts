import { describe, expect, it } from 'vitest';
import { fingerprint, FINGERPRINT_HEAD_BYTES } from './fingerprint';
import { localClipSchema, memoryRecords, type LocalClip } from './records';
import { copyExpired, removeExpiredCopies } from './retention';

const clip = (overrides: Partial<LocalClip> = {}): LocalClip => ({
  id: '0b9f5c7e-1d2a-4c3b-9e8f-7a6b5c4d3e2f',
  sessionId: '1c9f5c7e-1d2a-4c3b-9e8f-7a6b5c4d3e2f',
  athleteId: '2d9f5c7e-1d2a-4c3b-9e8f-7a6b5c4d3e2f',
  role: 'run',
  calibrationId: null,
  fileName: 'VID_20260314_101500.mp4',
  size: 5_000_000,
  fingerprint: 'a'.repeat(64),
  widthPx: 1920,
  heightPx: 1080,
  frameCount: 1200,
  durationSec: 5,
  codec: 'avc1.640028',
  declaredFps: 240,
  detectedFps: 239.8,
  irregularShare: 0,
  copy: 'opfs',
  importedAt: '2026-03-01T10:00:00.000Z',
  ...overrides,
});

describe('fingerprint', () => {
  it('hashes the first megabyte followed by the size', async () => {
    expect(await fingerprint(new Blob([]))).toBe(
      'af5570f5a1810b7af78caf4bc70a660f0df51e42baf91d4de5b2328de0e83dfc',
    );
    expect(await fingerprint(new Blob(['abc']))).toBe(
      'b74ffbd3cb2a7ef1b7af06ef43ff7400fea78948dd7d10e226fbd1f4bb0737db',
    );
  });

  it('tells apart files that share the first megabyte but differ in size', async () => {
    const head = new Uint8Array(FINGERPRINT_HEAD_BYTES).fill(7);
    const a = await fingerprint(new Blob([head, new Uint8Array(10)]));
    const b = await fingerprint(new Blob([head, new Uint8Array(20)]));
    const c = await fingerprint(new Blob([head, new Uint8Array(10).fill(1)]));
    expect(a).not.toBe(b);
    // Only the size is read beyond the first megabyte.
    expect(a).toBe(c);
  });
});

describe('local records', () => {
  it('stores parsed records and refuses malformed ones', async () => {
    const store = memoryRecords(localClipSchema);
    await store.put(clip());
    expect(await store.get(clip().id)).toMatchObject({ fileName: 'VID_20260314_101500.mp4' });
    await expect(store.put(clip({ fingerprint: 'not-hex' }))).rejects.toThrow();
    await store.delete(clip().id);
    expect(await store.all()).toEqual([]);
  });
});

describe('clip retention on the phone', () => {
  const now = new Date('2026-06-01T10:00:00.000Z');

  it('expires copies older than the retention period only', () => {
    expect(copyExpired(clip({ importedAt: '2026-03-02T10:00:00.000Z' }), 90, now)).toBe(true);
    expect(copyExpired(clip({ importedAt: '2026-03-04T10:00:00.000Z' }), 90, now)).toBe(false);
    expect(
      copyExpired(clip({ importedAt: '2026-01-01T10:00:00.000Z', copy: 'none' }), 90, now),
    ).toBe(false);
  });

  it('removes expired copies and keeps the clip records', async () => {
    const store = memoryRecords(localClipSchema);
    const old = clip({ id: '3e9f5c7e-1d2a-4c3b-9e8f-7a6b5c4d3e2f' });
    const recent = clip({
      id: '4f9f5c7e-1d2a-4c3b-9e8f-7a6b5c4d3e2f',
      importedAt: '2026-05-30T10:00:00.000Z',
    });
    await store.put(old);
    await store.put(recent);
    const removed: string[] = [];
    const count = await removeExpiredCopies(store, 30, now, (id) => {
      removed.push(id);
      return Promise.resolve();
    });
    expect(count).toBe(1);
    expect(removed).toEqual([old.id]);
    expect((await store.get(old.id))?.copy).toBe('none');
    expect((await store.get(recent.id))?.copy).toBe('opfs');
  });
});
