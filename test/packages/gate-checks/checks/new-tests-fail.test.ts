import { describe, it, expect, vi } from 'vitest';
import { fn, requiredArgs } from '@magpieweaver/gate-checks/src/checks/new-tests-fail.js';
import type { Inspectors } from '@magpieweaver/gate-checks/dist/types';

function createMockInspectors(coverageExists: boolean, testsFail: boolean): Inspectors {
  return {
    git: {} as any,
    coverage: {
      getCoverage: vi.fn().mockImplementation(async () => {
        if (!coverageExists) throw new Error('No coverage data');
        return 85;
      }),
      getNewLineCoverage: vi.fn(),
      runTestsWithCoverage: vi.fn().mockImplementation(() => {
        if (!testsFail) return;
        throw new Error('Tests failed');
      }),
    } as any,
  };
}

describe('new-tests-fail', () => {
  describe('§3.9.1 At Least One New Test Fails', () => {
    it('returns passed=true when tests fail', async () => {
      const inspectors = createMockInspectors(true, true);
      const result = await fn(inspectors, { 'pr-base-sha': 'base', 'pr-head-sha': 'head' });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('§3.9.2 No New Tests Fail', () => {
    it('returns passed=false when all tests pass', async () => {
      const inspectors = createMockInspectors(true, false);
      const result = await fn(inspectors, { 'pr-base-sha': 'base', 'pr-head-sha': 'head' });
      expect(result.passed).toBe(false);
      expect(result.violations).toContain('Tests were expected to fail but all passed');
    });
  });

  describe('§3.9.3 No New Tests Defined', () => {
    it('returns passed=false when no new tests defined (all pass)', async () => {
      const inspectors = createMockInspectors(true, false);
      const result = await fn(inspectors, { 'pr-base-sha': 'base', 'pr-head-sha': 'head' });
      expect(result.passed).toBe(false);
    });
  });

  describe('§3.9.4 Coverage Not Run', () => {
    it('returns passed=false when coverage data does not exist', async () => {
      const inspectors = createMockInspectors(false, true);
      const result = await fn(inspectors, { 'pr-base-sha': 'base', 'pr-head-sha': 'head' });
      expect(result.passed).toBe(false);
      expect(result.violations).toContain('Coverage must be run first');
    });
  });

  describe('requiredArgs', () => {
    it('exports the correct required argument names', () => {
      expect(requiredArgs).toEqual(['pr-base-sha', 'pr-head-sha']);
    });
  });
});
