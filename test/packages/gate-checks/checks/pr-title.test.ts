import { describe, it, expect } from 'vitest';
import { fn, requiredArgs } from '@magpieweaver/gate-checks/src/checks/pr-title.js';
import type { Inspectors } from '@magpieweaver/gate-checks/dist/types';

const mockInspectors = {} as unknown as Inspectors;

describe('pr-title', () => {
  describe('§3.2.1 PR Title Contains Ref', () => {
    it('returns passed=true when pr-title contains the ref', async () => {
      const result = await fn(mockInspectors, {
        ref: 'MAG-30',
        'pr-title': '[MAG-30] Add new feature',
      });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.values['pr-title']).toBe('[MAG-30] Add new feature');
    });

    it('exposes args and check name in result', async () => {
      const result = await fn(mockInspectors, {
        ref: 'MAG-30',
        'pr-title': '[MAG-30] Feature',
      });
      expect(result.check).toBe('pr-title');
      expect(result.args).toEqual({ ref: 'MAG-30', 'pr-title': '[MAG-30] Feature' });
    });
  });

  describe('§3.2.2 PR Title Does Not Contain Ref', () => {
    it('returns passed=false when ref is missing from pr-title', async () => {
      const result = await fn(mockInspectors, {
        ref: 'MAG-30',
        'pr-title': 'Add new feature without ref',
      });
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toContain('does not contain ref');
      expect(result.violations[0]).toContain('MAG-30');
    });
  });

  describe('§3.2.3 Ref Does Not Match Pattern', () => {
    it('returns passed=false when ref is not [A-Z]+-[0-9]+', async () => {
      const result = await fn(mockInspectors, {
        ref: 'INVALID',
        'pr-title': '[INVALID] Some title',
      });
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toContain('does not match required pattern');
    });

    it('returns passed=false when ref has no number part', async () => {
      const result = await fn(mockInspectors, {
        ref: 'ABC-def',
        'pr-title': '[ABC-def] Title',
      });
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
    });
  });

  describe('requiredArgs', () => {
    it('exports the correct required argument names', () => {
      expect(requiredArgs).toEqual(['ref', 'pr-title']);
    });
  });
});
