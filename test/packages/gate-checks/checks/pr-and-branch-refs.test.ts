import { describe, it, expect } from 'vitest';
import { fn, requiredArgs } from '@magpieweaver/gate-checks/src/checks/pr-and-branch-refs.js';
import type { Inspectors } from '@magpieweaver/gate-checks/dist/types';

const mockInspectors = {} as unknown as Inspectors;

function run(headRef: string, prBaseRef: string) {
  return fn(mockInspectors, { 'head-ref': headRef, 'pr-base-ref': prBaseRef });
}

describe('pr-and-branch-refs', () => {
  describe('§3.1.1 Valid Head Ref and Base Ref', () => {
    it('returns passed=true when both refs match and ref is valid', async () => {
      const result = await run('task/MAG-30', 'build/MAG-30');
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.values.ref).toBe('MAG-30');
    });

    it('exposes args and check name in result', async () => {
      const result = await run('task/MAG-30', 'build/MAG-30');
      expect(result.check).toBe('pr-and-branch-refs');
      expect(result.args).toEqual({ 'head-ref': 'task/MAG-30', 'pr-base-ref': 'build/MAG-30' });
    });
  });

  describe('§3.1.2 Mismatched Refs', () => {
    it('returns passed=false when refs differ', async () => {
      const result = await run('task/MAG-30', 'build/MAG-99');
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toContain('Ref mismatch');
      expect(result.violations[0]).toContain('MAG-30');
      expect(result.violations[0]).toContain('MAG-99');
    });
  });

  describe('§3.1.3 Invalid Head Ref Format', () => {
    it('returns passed=false when head-ref does not match */{ref}', async () => {
      const result = await run('invalid-branch', 'build/MAG-30');
      expect(result.passed).toBe(false);
      expect(result.violations).toContain(
        '--head-ref "invalid-branch" does not match pattern */{ref}',
      );
    });
  });

  describe('§3.1.4 Invalid Base Ref Format', () => {
    it('returns passed=false when pr-base-ref does not match build/{ref}', async () => {
      const result = await run('task/MAG-30', 'invalid-base');
      expect(result.passed).toBe(false);
      expect(result.violations).toContain(
        '--pr-base-ref "invalid-base" does not match pattern build/{ref}',
      );
    });
  });

  describe('§3.1.5 Ref Does Not Match Pattern', () => {
    it('returns passed=false when ref is not [A-Z]+-[0-9]+', async () => {
      const result = await run('task/FOO', 'build/FOO');
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toContain('does not match required pattern');
    });
  });

  describe('requiredArgs', () => {
    it('exports the correct required argument names', () => {
      expect(requiredArgs).toEqual(['head-ref', 'pr-base-ref']);
    });
  });
});
