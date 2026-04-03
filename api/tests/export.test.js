import { describe, it, expect } from 'vitest';
import { escapeCsv } from '../src/handlers/export.js';

describe('escapeCsv', () => {
  it('returns plain string as-is', () => {
    expect(escapeCsv('hello')).toBe('hello');
  });

  it('wraps strings with commas in quotes', () => {
    expect(escapeCsv('hello, world')).toBe('"hello, world"');
  });

  it('escapes double quotes', () => {
    expect(escapeCsv('say "hello"')).toBe('"say ""hello"""');
  });

  it('wraps strings with newlines in quotes', () => {
    expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
  });
});
