import { describe, expect, it } from 'vitest';
import { withoutBlanks } from '../src/lib/env';

/**
 * A deployment failed on eighteen variables that all had defaults, because the
 * hosting platform passes unset variables to the build as empty strings and
 * Zod's `.default()` only fires on `undefined`. Every local run passed, since a
 * local `.env` sets them — so nothing caught it until the build broke.
 */

describe('environment blanks', () => {
  it('drops empty and whitespace-only values so defaults apply', () => {
    const result = withoutBlanks({
      EMPTY: '',
      SPACES: '   ',
      REAL: 'value',
    } as unknown as NodeJS.ProcessEnv);

    expect(result).toEqual({ REAL: 'value' });
  });

  it('keeps values that are meaningfully falsy', () => {
    // "0" and "false" are real configuration, not absence.
    const result = withoutBlanks({ ZERO: '0', FALSE: 'false' } as unknown as NodeJS.ProcessEnv);
    expect(result).toEqual({ ZERO: '0', FALSE: 'false' });
  });

  it('drops undefined entries rather than passing them through', () => {
    const result = withoutBlanks({ MISSING: undefined, REAL: 'x' } as unknown as NodeJS.ProcessEnv);
    expect(Object.hasOwn(result, 'MISSING')).toBe(false);
    expect(result.REAL).toBe('x');
  });
});
