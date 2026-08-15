import { candidateNames, firstFree, nextCandidateName } from './node-name';

/**
 * The name a conflict offers is the only part of the refusal a user acts on, so it has
 * to be one that will actually be accepted. Offering the next number blindly meant
 * "test" suggesting "test (2)" when that was taken too — a click that earned a second
 * identical refusal.
 */
describe('candidateNames', () => {
  it('counts up from 2, keeping the number before the extension', () => {
    expect(candidateNames('MSA.pdf', 3)).toEqual([
      'MSA (2).pdf',
      'MSA (3).pdf',
      'MSA (4).pdf',
    ]);
  });

  it('restarts from 2 for a name that is already numbered', () => {
    // Not from 3: with "Report" and "Report (3)" taken, "Report (2)" is the free slot,
    // and counting up from where the name happens to sit would skip it.
    expect(candidateNames('Report (5)', 2)).toEqual([
      'Report (2)',
      'Report (3)',
    ]);
  });

  it('leaves a name with no extension alone', () => {
    expect(candidateNames('Legal', 1)).toEqual(['Legal (2)']);
  });

  it('keeps every candidate inside the column bound', () => {
    const long = `${'x'.repeat(200)}.pdf`;
    for (const candidate of candidateNames(long, 5)) {
      expect(candidate.length).toBeLessThanOrEqual(200);
      expect(candidate.endsWith('.pdf')).toBe(true);
    }
  });
});

describe('firstFree', () => {
  const candidates = ['test (2)', 'test (3)', 'test (4)'];

  it('skips the names already taken', () => {
    expect(firstFree(candidates, new Set(['test (2)']))).toBe('test (3)');
  });

  it('compares case-insensitively, as the unique index does', () => {
    // The index is on lower(name), so "test (2)" would be refused against "TEST (2)"
    // for a reason nothing on screen would explain.
    expect(firstFree(candidates, new Set(['test (2)', 'test (3)']))).toBe(
      'test (4)',
    );
    expect(firstFree(['TEST (2)'], new Set(['test (2)']))).toBeNull();
  });

  it('returns the first candidate when nothing is taken', () => {
    expect(firstFree(candidates, new Set())).toBe('test (2)');
  });

  it('returns null when every candidate is taken, so the caller can fall back', () => {
    expect(firstFree(candidates, new Set(candidates))).toBeNull();
  });
});

describe('nextCandidateName', () => {
  it('still counts up from the name it is given, for the retry loops', () => {
    // Unlike the suggestion path, this one is deliberately blind: two clients racing for
    // one name must both collide and both move on, which a database lookup would break.
    expect(nextCandidateName('MSA.pdf')).toBe('MSA (2).pdf');
    expect(nextCandidateName('MSA (2).pdf')).toBe('MSA (3).pdf');
  });
});
