import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSql } from './helpers/mockSql.js';
import {
  handleCheckUsername,
  handleRegister,
  handleVerifyRegistration,
  handleLogin,
  handleVerifyLogin,
  handleResendOtp,
} from '../src/handlers/auth.js';

// Mock global fetch for ntfy.sh calls
beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve(new Response('OK')));
});

describe('handleCheckUsername', () => {
  it('returns 400 for missing username', async () => {
    const sql = createMockSql([]);
    const result = await handleCheckUsername(sql, null);
    expect(result.status).toBe(400);
  });

  it('returns available=true when user does not exist', async () => {
    const sql = createMockSql([
      { match: 'SELECT id FROM users', result: [] },
    ]);
    const result = await handleCheckUsername(sql, 'newuser');
    expect(result.body.available).toBe(true);
  });

  it('returns available=false when user exists', async () => {
    const sql = createMockSql([
      { match: 'SELECT id FROM users', result: [{ id: 1 }] },
    ]);
    const result = await handleCheckUsername(sql, 'existing');
    expect(result.body.available).toBe(false);
  });
});

describe('handleRegister', () => {
  it('returns 400 for missing fields', async () => {
    const sql = createMockSql([]);
    const result = await handleRegister(sql, { name: 'John' });
    expect(result.status).toBe(400);
  });

  it('returns 409 for duplicate email', async () => {
    const sql = createMockSql([
      { match: 'SELECT id FROM users WHERE email', result: [{ id: 1 }] },
    ]);
    const result = await handleRegister(sql, {
      name: 'John', email: 'john@test.com', username: 'john',
    });
    expect(result.status).toBe(409);
    expect(result.body.message).toContain('email');
  });

  it('returns 409 for duplicate username', async () => {
    const sql = createMockSql([
      { match: 'SELECT id FROM users WHERE email', result: [] },
      { match: 'SELECT id FROM users WHERE username', result: [{ id: 1 }] },
    ]);
    const result = await handleRegister(sql, {
      name: 'John', email: 'john@test.com', username: 'john',
    });
    expect(result.status).toBe(409);
    expect(result.body.message).toContain('username');
  });

  it('sends OTP on successful registration', async () => {
    const sql = createMockSql([
      { match: 'SELECT id FROM users WHERE email', result: [] },
      { match: 'SELECT id FROM users WHERE username', result: [] },
      { match: 'INSERT INTO users', result: [] },
      { match: 'INSERT INTO otp_codes', result: [] },
    ]);
    const result = await handleRegister(sql, {
      name: 'John', email: 'john@test.com', username: 'john',
    });
    expect(result.body.success).toBe(true);
    expect(result.body.message).toBe('OTP sent');
    expect(global.fetch).toHaveBeenCalled();
  });
});

describe('handleLogin', () => {
  it('returns 400 for missing username', async () => {
    const sql = createMockSql([]);
    const result = await handleLogin(sql, {});
    expect(result.status).toBe(400);
  });

  it('returns 404 for non-existent user', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, verified', result: [] },
    ]);
    const result = await handleLogin(sql, { username: 'nobody' });
    expect(result.status).toBe(404);
  });

  it('returns 403 for unverified user', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, verified', result: [{ id: 1, verified: false }] },
    ]);
    const result = await handleLogin(sql, { username: 'unverified' });
    expect(result.status).toBe(403);
  });
});

describe('handleVerifyRegistration', () => {
  it('returns 400 for missing otp', async () => {
    const sql = createMockSql([]);
    const result = await handleVerifyRegistration(sql, { username: 'john' }, {});
    expect(result.status).toBe(400);
  });

  it('returns 429 when OTP locked out', async () => {
    const sql = createMockSql([
      { match: 'SELECT COUNT', result: [{ count: '1' }] },
    ]);
    const result = await handleVerifyRegistration(sql, {
      username: 'john', otp: '123456',
    }, { JWT_SECRET: 'test' });
    expect(result.status).toBe(429);
  });

  it('returns JWT token on successful OTP verification', async () => {
    const sql = createMockSql([
      { match: 'SELECT COUNT', result: [{ count: '0' }] }, // not locked
      { match: 'SELECT id FROM otp_codes', result: [{ id: 1 }] }, // valid OTP
      { match: 'UPDATE otp_codes SET used', result: [] },
      { match: 'UPDATE users SET verified', result: [] },
      { match: 'SELECT id, username FROM users', result: [{ id: 42, username: 'john' }] },
    ]);
    const result = await handleVerifyRegistration(sql, {
      username: 'john', otp: '123456',
    }, { JWT_SECRET: 'test-secret-for-jwt' });
    expect(result.body.success).toBe(true);
    expect(result.body.token).toBeDefined();
    expect(result.body.token.split('.')).toHaveLength(3);
  });
});

describe('handleResendOtp', () => {
  it('returns 400 for missing fields', async () => {
    const sql = createMockSql([]);
    const result = await handleResendOtp(sql, { username: 'john' });
    expect(result.status).toBe(400);
    expect(result.body.message).toContain('purpose');
  });

  it('returns 400 for invalid purpose', async () => {
    const sql = createMockSql([]);
    const result = await handleResendOtp(sql, { username: 'john', purpose: 'invalid' });
    expect(result.status).toBe(400);
    expect(result.body.message).toContain('purpose');
  });

  it('returns 404 for non-existent user', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, verified FROM users', result: [] },
    ]);
    const result = await handleResendOtp(sql, { username: 'nobody', purpose: 'login' });
    expect(result.status).toBe(404);
  });

  it('returns 403 for unverified user trying login resend', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, verified FROM users', result: [{ id: 1, verified: false }] },
    ]);
    const result = await handleResendOtp(sql, { username: 'john', purpose: 'login' });
    expect(result.status).toBe(403);
  });

  it('returns 400 for already verified user trying register resend', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, verified FROM users', result: [{ id: 1, verified: true }] },
    ]);
    const result = await handleResendOtp(sql, { username: 'john', purpose: 'register' });
    expect(result.status).toBe(400);
    expect(result.body.message).toContain('already verified');
  });

  it('returns 429 when cooldown is active', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, verified FROM users', result: [{ id: 1, verified: true }] },
      { match: 'SELECT id, created_at FROM otp_codes', result: [{ id: 1, created_at: new Date() }] },
    ]);
    const result = await handleResendOtp(sql, { username: 'john', purpose: 'login' });
    expect(result.status).toBe(429);
    expect(result.body.message).toContain('wait');
  });

  it('invalidates old OTPs and sends new one on success', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, verified FROM users', result: [{ id: 1, verified: true }] },
      { match: 'SELECT id, created_at FROM otp_codes', result: [] }, // no cooldown
      { match: 'UPDATE otp_codes SET used', result: [] }, // invalidate old
      { match: 'INSERT INTO otp_codes', result: [] }, // new OTP
    ]);
    const result = await handleResendOtp(sql, { username: 'john', purpose: 'login' });
    expect(result.body.success).toBe(true);
    expect(result.body.message).toBe('New OTP sent');
    expect(global.fetch).toHaveBeenCalled();
  });

  it('allows register resend for unverified user', async () => {
    const sql = createMockSql([
      { match: 'SELECT id, verified FROM users', result: [{ id: 1, verified: false }] },
      { match: 'SELECT id, created_at FROM otp_codes', result: [] },
      { match: 'UPDATE otp_codes SET used', result: [] },
      { match: 'INSERT INTO otp_codes', result: [] },
    ]);
    const result = await handleResendOtp(sql, { username: 'john', purpose: 'register' });
    expect(result.body.success).toBe(true);
    expect(result.body.message).toBe('New OTP sent');
  });
});

describe('handleVerifyLogin', () => {
  it('returns 400 for missing fields', async () => {
    const sql = createMockSql([]);
    const result = await handleVerifyLogin(sql, { username: 'john' }, {});
    expect(result.status).toBe(400);
  });

  it('returns 429 when locked out', async () => {
    const sql = createMockSql([
      { match: 'SELECT COUNT', result: [{ count: '1' }] },
    ]);
    const result = await handleVerifyLogin(sql, {
      username: 'john', otp: '123456',
    }, { JWT_SECRET: 'test' });
    expect(result.status).toBe(429);
  });

  it('returns JWT token on successful login OTP', async () => {
    const sql = createMockSql([
      { match: 'SELECT COUNT', result: [{ count: '0' }] },
      { match: 'SELECT id FROM otp_codes', result: [{ id: 1 }] },
      { match: 'UPDATE otp_codes SET used', result: [] },
      { match: 'SELECT id, username FROM users', result: [{ id: 42, username: 'john' }] },
    ]);
    const result = await handleVerifyLogin(sql, {
      username: 'john', otp: '123456',
    }, { JWT_SECRET: 'test-secret-for-jwt' });
    expect(result.body.success).toBe(true);
    expect(result.body.token).toBeDefined();
  });
});
