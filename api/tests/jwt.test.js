import { describe, it, expect, vi } from 'vitest';
import { signJwt, verifyJwt } from '../src/helpers/jwt.js';

const SECRET = 'test-secret-key';

describe('JWT Helper', () => {
  it('signJwt produces a valid 3-part token', async () => {
    const token = await signJwt({ userId: 1, username: 'test' }, SECRET);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBeTruthy();
    expect(parts[1]).toBeTruthy();
    expect(parts[2]).toBeTruthy();
  });

  it('verifyJwt returns payload for a valid token', async () => {
    const token = await signJwt({ userId: 42, username: 'johndoe' }, SECRET);
    const payload = await verifyJwt(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload.userId).toBe(42);
    expect(payload.username).toBe('johndoe');
    expect(payload.iat).toBeDefined();
    expect(payload.exp).toBeDefined();
  });

  it('verifyJwt returns null for expired token', async () => {
    // Mock Date.now to create a token in the past
    const realDateNow = Date.now;
    const eightDaysAgo = realDateNow() - 8 * 24 * 60 * 60 * 1000;
    Date.now = vi.fn(() => eightDaysAgo);

    const token = await signJwt({ userId: 1 }, SECRET);

    // Restore real time — token is now expired
    Date.now = realDateNow;

    const payload = await verifyJwt(token, SECRET);
    expect(payload).toBeNull();
  });

  it('verifyJwt returns null for tampered token', async () => {
    const token = await signJwt({ userId: 1 }, SECRET);
    // Tamper with the payload
    const parts = token.split('.');
    parts[1] = parts[1] + 'x';
    const tamperedToken = parts.join('.');

    const payload = await verifyJwt(tamperedToken, SECRET);
    expect(payload).toBeNull();
  });

  it('verifyJwt returns null for wrong secret', async () => {
    const token = await signJwt({ userId: 1 }, SECRET);
    const payload = await verifyJwt(token, 'wrong-secret');
    expect(payload).toBeNull();
  });

  it('verifyJwt returns null for malformed token', async () => {
    const payload = await verifyJwt('not.a.valid.jwt', SECRET);
    expect(payload).toBeNull();

    const payload2 = await verifyJwt('just-a-string', SECRET);
    expect(payload2).toBeNull();
  });
});
