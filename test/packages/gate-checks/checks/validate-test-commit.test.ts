import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fn, requiredArgs } from '@magpieweaver/gate-checks/src/checks/validate-test-commit.js';
import type { GitInspector } from '@magpieweaver/gate-checks/dist/git-interface';
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
    coverage: {} as any,
  };
}

describe('validate-test-commit', () => {
  let inspectors: Inspectors;

  beforeEach(() => {
    inspectors = createMockInspectors();
    (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      'MAG-30 Add tests\n\nTest body description',
    ]);
    (inspectors.git.diffTree as ReturnType<typeof vi.fn>).mockResolvedValue([
      'test/new.test.ts',
    ]);
    (inspectors.git.added as ReturnType<typeof vi.fn>).mockResolvedValue([
      'test/new.test.ts',
    ]);
    (inspectors.git.modified as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  describe('§3.5.1 Valid Test Commit', () => {
    it('returns passed=true when commit only changes test/ and adds new test', async () => {
      const result = await fn(inspectors, { 'test-commit-sha': 'abc123' });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('returns passed=true with allowed paths package.json and pnpm-lock.yaml', async () => {
      (inspectors.git.diffTree as ReturnType<typeof vi.fn>).mockResolvedValue([
        'test/new.test.ts',
        'package.json',
      ]);
      (inspectors.git.added as ReturnType<typeof vi.fn>).mockResolvedValue([
        'test/new.test.ts',
      ]);
      const result = await fn(inspectors, { 'test-commit-sha': 'abc123' });
      expect(result.passed).toBe(true);
    });

    it('includes existingTests and newTests in values', async () => {
      (inspectors.git.added as ReturnType<typeof vi.fn>).mockResolvedValue([
        'test/a.test.ts',
        'test/b.test.ts',
      ]);
      (inspectors.git.modified as ReturnType<typeof vi.fn>).mockResolvedValue([
        'test/existing.test.ts',
      ]);
      (inspectors.git.diffTree as ReturnType<typeof vi.fn>).mockResolvedValue([
        'test/a.test.ts',
        'test/b.test.ts',
        'test/existing.test.ts',
      ]);
      const result = await fn(inspectors, { 'test-commit-sha': 'abc123' });
      expect(result.values.newTests).toEqual(['test/a.test.ts', 'test/b.test.ts']);
      expect(result.values.existingTests).toEqual(['test/existing.test.ts']);
    });
  });

  describe('§3.5.2 Invalid Commit Message', () => {
    it('returns passed=false when title does not start with ref', async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        'Bad title\n\nBody',
      ]);
      const result = await fn(inspectors, { 'test-commit-sha': 'abc123' });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain('must start with a valid ref');
    });

    it('returns passed=false when title is only the ref', async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        'MAG-30\n\nBody',
      ]);
      const result = await fn(inspectors, { 'test-commit-sha': 'abc123' });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toBe('Commit message title must continue beyond the ref');
    });

    it('returns passed=false when body is empty', async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        'MAG-30 Title',
      ]);
      const result = await fn(inspectors, { 'test-commit-sha': 'abc123' });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toBe('Commit message body must not be empty');
    });
  });

  describe('§3.5.3 Changes Outside Allowed Paths', () => {
    it('returns passed=false when changes outside test/ and config files', async () => {
      (inspectors.git.diffTree as ReturnType<typeof vi.fn>).mockResolvedValue([
        'src/code.ts',
        'test/new.test.ts',
      ]);
      const result = await fn(inspectors, { 'test-commit-sha': 'abc123' });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain('Changes outside allowed paths');
      expect(result.violations[0]).toContain('src/code.ts');
    });
  });

  describe('§3.5.4 Changes Existing Tests', () => {
    it('returns passed=false when modifying an existing test file', async () => {
      (inspectors.git.modified as ReturnType<typeof vi.fn>).mockResolvedValue([
        'test/existing.test.ts',
      ]);
      const result = await fn(inspectors, { 'test-commit-sha': 'abc123' });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toBe('Existing tests must not be changed: test/existing.test.ts');
    });
  });

  describe('§3.5.5 No New Tests Defined', () => {
    it('returns passed=false when no new test files added', async () => {
      (inspectors.git.added as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const result = await fn(inspectors, { 'test-commit-sha': 'abc123' });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toBe('At least one new test must be defined in test/');
    });
  });

  describe('throws on invalid sha', () => {
    it('throws when commitMessages rejects', async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('fatal'),
      );
      await expect(
        fn(inspectors, { 'test-commit-sha': 'bad-sha' }),
      ).rejects.toThrow('Invalid argument');
    });
  });

  describe('requiredArgs', () => {
    it('exports the correct required argument names', () => {
      expect(requiredArgs).toEqual(['test-commit-sha']);
    });
  });
});
