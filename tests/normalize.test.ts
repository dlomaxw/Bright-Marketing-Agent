import { describe, it, expect } from 'vitest';
import {
  domainKey,
  normalizeUrl,
  nameKey,
  emailKey,
  phoneKey,
  looksLikePlaceholderEmail,
  looksLikePlaceholderPhone,
} from '../src/lib/normalize';

describe('domainKey', () => {
  it('strips www, scheme, path and normalizes case', () => {
    expect(domainKey('https://WWW.Example.com/path?arg=1')).toBe('example.com');
    expect(domainKey('http://sub.domain.co.ug')).toBe('sub.domain.co.ug');
  });

  it('allows localhost for dev/testing', () => {
    expect(domainKey('http://localhost:3000')).toBe('localhost');
  });

  it('returns null for invalid or unregistrable domains', () => {
    expect(domainKey('nodot')).toBe(null);
    expect(domainKey('')).toBe(null);
  });
});

describe('nameKey', () => {
  it('normalizes organization names and strips common suffixes', () => {
    expect(nameKey('Kigo Ridge Construction Limited')).toBe('kigo ridge construction');
    expect(nameKey('Bright Thoughts Services Uganda Ltd.')).toBe('bright thoughts');
  });
});

describe('emailKey', () => {
  it('trims and lowercases valid emails', () => {
    expect(emailKey('  User@Domain.COM ')).toBe('user@domain.com');
  });

  it('rejects invalid emails', () => {
    expect(emailKey('not-an-email')).toBe(null);
  });
});

describe('phoneKey', () => {
  it('formats local national numbers to E.164 with default country code', () => {
    expect(phoneKey('0772000000', '256')).toBe('+256772000000');
  });

  it('preserves existing country code with plus', () => {
    expect(phoneKey('+254712345678')).toBe('+254712345678');
  });
});

describe('placeholder checks', () => {
  it('identifies placeholder email patterns', () => {
    expect(looksLikePlaceholderEmail('test@example.com')).toBe(true);
    expect(looksLikePlaceholderEmail('real@company.com')).toBe(false);
  });

  it('identifies placeholder phone patterns', () => {
    expect(looksLikePlaceholderPhone('Call 555-123-4567 today')).toBe(true);
    expect(looksLikePlaceholderPhone('Call +256414000000 today')).toBe(false);
  });
});
