import { createHash, randomBytes } from 'node:crypto';
import { LIMITS } from '@stride/shared/limits';

// Invite and share tokens: 32 random bytes in base64url. Only the SHA-256 hash is stored, so a
// database leak does not leak working links.

export function newToken(): { token: string; hash: Buffer } {
  const token = randomBytes(LIMITS.tokenBytes).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
