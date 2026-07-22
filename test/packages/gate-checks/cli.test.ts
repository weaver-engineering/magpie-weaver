import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { resolve } from 'path';

const cliPath = resolve(process.cwd(), 'packages/gate-checks/dist/cli.js');

function runCli(args: string[]): {
  stdout: string;
  stderr: string;
  status: number;
} {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return { stdout, stderr: '', status: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      status: e.status ?? 1,
    };
  }
}

describe('CLI', () => {
  describe('error handling', () => {
    it('exits 2 with "No check name provided" when no arguments given', () => {
      const { stdout, status } = runCli([]);
      expect(status).toBe(2);
      expect(stdout).toContain('[gate-check]');
      expect(stdout).toContain('No check name provided');
    });

    it('exits 2 when only --json is given', () => {
      const { stdout, status } = runCli(['--json']);
      const parsed = JSON.parse(stdout);
      expect(status).toBe(2);
      expect(parsed.check).toBe('unknown');
      expect(parsed.violations).toContain('No check name provided');
    });

    it('exits 2 with check name in result when check not in catalog', () => {
      const { stdout, status } = runCli(['nonexistent', '--json']);
      const parsed = JSON.parse(stdout);
      expect(status).toBe(2);
      expect(parsed.check).toBe('nonexistent');
      expect(parsed.violations).toContain('Check "nonexistent" not found');
    });

    it('exits 2 when a required argument is missing', () => {
      const { stdout, status } = runCli([
        'get-inbound-commits',
        '--pr-base-sha',
        'HEAD',
        '--json',
      ]);
      const parsed = JSON.parse(stdout);
      expect(status).toBe(2);
      expect(parsed.violations).toContain(
        'Missing required argument: --pr-head-sha',
      );
    });

    it('exits 2 when check function throws', () => {
      const { stdout, status } = runCli([
        'get-inbound-commits',
        '--pr-base-sha',
        'INVALID_SHA_THAT_DOES_NOT_EXIST_12345',
        '--pr-head-sha',
        'ALSO_INVALID_67890',
        '--json',
      ]);
      const parsed = JSON.parse(stdout);
      expect(status).toBe(2);
      expect(parsed.violations[0]).toContain('Invalid argument');
    });
  });

  describe('check execution', () => {
    it('exits 1 when same base/head sha (no commits)', () => {
      const { stdout, status } = runCli([
        'get-inbound-commits',
        '--pr-base-sha',
        'HEAD',
        '--pr-head-sha',
        'HEAD',
        '--json',
      ]);
      const parsed = JSON.parse(stdout);
      expect(status).toBe(1);
      expect(parsed.check).toBe('get-inbound-commits');
      expect(parsed.passed).toBe(false);
      expect(parsed.violations).toContain(
        'No commits between --pr-base-sha and --pr-head-sha',
      );
    });

    it('exits 0 when different base/head sha (commits found)', () => {
      const { stdout, status } = runCli([
        'get-inbound-commits',
        '--pr-base-sha',
        'HEAD~1',
        '--pr-head-sha',
        'HEAD',
        '--json',
      ]);
      const parsed = JSON.parse(stdout);
      expect(status).toBe(0);
      expect(parsed.check).toBe('get-inbound-commits');
      expect(parsed.passed).toBe(true);
      expect(parsed.values.commits).toBeDefined();
      expect(Array.isArray(parsed.values.commits)).toBe(true);
      expect(parsed.values.commits.length).toBeGreaterThan(0);
    });
  });

  describe('output format', () => {
    it('outputs valid JSON when --json flag is used', () => {
      const { stdout, status } = runCli([
        'get-inbound-commits',
        '--pr-base-sha',
        'HEAD',
        '--pr-head-sha',
        'HEAD',
        '--json',
      ]);
      expect(status).toBe(1);
      expect(() => JSON.parse(stdout)).not.toThrow();
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty('check');
      expect(parsed).toHaveProperty('passed');
      expect(parsed).toHaveProperty('violations');
      expect(parsed).toHaveProperty('summary');
      expect(parsed).toHaveProperty('values');
    });

    it('outputs human-readable text when --json is absent', () => {
      const { stdout, status } = runCli([
        'get-inbound-commits',
        '--pr-base-sha',
        'HEAD',
        '--pr-head-sha',
        'HEAD',
      ]);
      expect(status).toBe(1);
      expect(stdout).toContain('[gate-check]');
      expect(stdout).toContain('get-inbound-commits');
      expect(stdout).toContain('FAIL');
      expect(stdout).toContain('summary:');
    });

    it('outputs human-readable on error without --json', () => {
      const { stdout, status } = runCli(['nonexistent']);
      expect(status).toBe(2);
      expect(stdout).toContain('[gate-check]');
      expect(stdout).toContain('nonexistent');
      expect(stdout).toContain('FAIL');
    });
  });

  describe('human output for success', () => {
    it('outputs PASS and summary in human mode on success', () => {
      const { stdout, status } = runCli([
        'get-inbound-commits',
        '--pr-base-sha',
        'HEAD~1',
        '--pr-head-sha',
        'HEAD',
      ]);
      expect(status).toBe(0);
      expect(stdout).toContain('PASS');
      expect(stdout).toContain('summary:');
      expect(stdout).toContain('commit');
    });
  });
});
