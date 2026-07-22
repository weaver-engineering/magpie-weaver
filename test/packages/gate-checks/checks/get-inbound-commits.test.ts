import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fn, requiredArgs } from '@magpieweaver/gate-checks/src/checks/get-inbound-commits.js';
import type { GitInspector } from '@magpieweaver/gate-checks/dist/git-interface';
import type { CoverageInspector } from '@magpieweaver/gate-checks/dist/coverage-interface';
import type { Inspectors } from '@magpieweaver/gate-checks/dist/types';

function createMockInspectors(): Inspectors {
  return {
    git: {
      mergeBase: vi.fn(),
      diffTree: vi.fn(),
      lsTree: vi.fn(),
      commitMessages: vi.fn(),
      added: vi.fn(),
      modified: vi.fn(),
      deleted: vi.fn(),
      revList: vi.fn(),
    } as unknown as GitInspector,
    coverage: {
      runTestsWithCoverage: vi.fn(),
      getNewLineCoverage: vi.fn(),
      getCoverage: vi.fn(),
    } as unknown as CoverageInspector,
  };
}

describe('get-inbound-commits', () => {
  let inspectors: Inspectors;

  beforeEach(() => {
    inspectors = createMockInspectors();
  });

  describe('§3.3.1 Commits Present', () => {
    it('returns passed=true with commits when revList returns SHAs', async () => {
      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValue(['abc123', 'def456', 'ghi789']);

      const result = await fn(inspectors, {
        'pr-base-sha': 'sha-base',
        'pr-head-sha': 'sha-head',
      });

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.values.commits).toEqual(['abc123', 'def456', 'ghi789']);
      expect(mockRevList).toHaveBeenCalledWith('sha-base', 'sha-head');
    });

    it('exposes the check name and args in the result', async () => {
      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValue(['abc123']);

      const result = await fn(inspectors, {
        'pr-base-sha': 'base',
        'pr-head-sha': 'head',
      });

      expect(result.check).toBe('get-inbound-commits');
      expect(result.args).toEqual({
        'pr-base-sha': 'base',
        'pr-head-sha': 'head',
      });
    });
  });

  describe('§3.3.2 No Commits (Shas Equal)', () => {
    it('returns passed=false when base sha equals head sha', async () => {
      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;

      const result = await fn(inspectors, {
        'pr-base-sha': 'same-sha',
        'pr-head-sha': 'same-sha',
      });

      expect(result.passed).toBe(false);
      expect(result.violations).toContain(
        'No commits between --pr-base-sha and --pr-head-sha',
      );
      expect(mockRevList).not.toHaveBeenCalled();
    });
  });

  describe('Invalid sha (throws)', () => {
    it('throws when revList rejects with an error (invalid sha)', async () => {
      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockRejectedValue(new Error('fatal: ambiguous argument'));

      await expect(
        fn(inspectors, {
          'pr-base-sha': 'bad-sha',
          'pr-head-sha': 'also-bad',
        }),
      ).rejects.toThrow(
        'Invalid argument: --pr-base-sha="bad-sha" or --pr-head-sha="also-bad" could not be resolved',
      );
    });
  });

  describe('revList returns empty', () => {
    it('returns passed=false when revList returns an empty array', async () => {
      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValue([]);

      const result = await fn(inspectors, {
        'pr-base-sha': 'base',
        'pr-head-sha': 'head',
      });

      expect(result.passed).toBe(false);
      expect(result.violations).toContain(
        'No commits between --pr-base-sha and --pr-head-sha',
      );
    });
  });

  describe('requiredArgs', () => {
    it('exports the correct required argument names', () => {
      expect(requiredArgs).toEqual(['pr-base-sha', 'pr-head-sha']);
    });
  });
});
