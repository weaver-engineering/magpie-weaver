import { describe, it, expect } from 'vitest';
import { catalog } from '@magpieweaver/gate-checks/src/checks/index.js';

describe('checks/index catalog', () => {
  it('exports catalog as an object', () => {
    expect(catalog).toBeDefined();
    expect(typeof catalog).toBe('object');
  });

  const expectedChecks: Record<string, string[]> = {
    'pr-and-branch-refs': ['head-ref', 'pr-base-ref'],
    'pr-title': ['ref', 'pr-title'],
    'get-inbound-commits': ['pr-base-sha', 'pr-head-sha'],
    'validate-spec-commit': ['spec-commit-sha'],
    'validate-test-commit': ['test-commit-sha'],
    'validate-build-commit': ['build-commit-sha'],
    'validate-task-commit': ['task-commit-sha'],
    'existing-tests-pass': ['pr-base-sha', 'pr-head-sha'],
    'new-tests-fail': ['pr-base-sha', 'pr-head-sha'],
    'coverage': ['expect-failure'],
  };

  describe('all 10 checks are registered', () => {
    for (const [name, args] of Object.entries(expectedChecks)) {
      it(`has "${name}" with fn and requiredArgs ${JSON.stringify(args)}`, () => {
        const entry = catalog[name];
        expect(entry).toBeDefined();
        expect(typeof entry.fn).toBe('function');
        expect(Array.isArray(entry.requiredArgs)).toBe(true);
        expect(entry.requiredArgs).toEqual(args);
      });
    }
  });
});
