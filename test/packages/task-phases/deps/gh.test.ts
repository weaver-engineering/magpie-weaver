/**
 * System tests for `--dev-testing gh <method>` real-world execution.
 *
 * Every test spawns the built CLI as a subprocess from inside a fresh clone
 * of the persistent sandbox repo (weaver-engineering/
 * sandbox-task-phases-DO-NOT-DELETE), so `gh` resolves the repository from
 * the caller's cwd (task-MAG-46-dev-testing-cli-design.md §6) — never
 * calls into `cli.ts` exports directly.
 *
 * Spec: MAG-46-03  §3.1 createPR, §3.2 findOpenPR, §3.3 findMergedPR/
 * findMergedPRs, §3.4 error handling.
 *
 * Merge-detection cases (§3.3) are read-only queries against the sandbox
 * repo's permanent fixture branches (see its README): `gh pr merge` is a
 * deliberately withheld permission, so the fixtures carry the pre-existing
 * merge history the tests assert against. Only §3.1/§3.2 create throwaway
 * branches/PRs, with unique names, cleaned up in `finally`.
 *
 * All `RealGitHubTool` methods throw "not implemented" during the test
 * phase, so every test reaching a real gh call fails as required.
 */

// Implements: task-MAG-46-03-dev-testing-gh-basics-spec.md

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SANDBOX_REPO = "weaver-engineering/sandbox-task-phases-DO-NOT-DELETE";

const MERGED_ONCE_BASE = "fixture-merged-once-base";
const MERGED_ONCE_HEAD = "fixture-merged-once-head";
const MERGED_TWICE_BASE = "fixture-merged-twice-base";
const MERGED_TWICE_HEAD = "fixture-merged-twice-head";
const NEVER_MERGED_BASE = "fixture-never-merged-base";
const NEVER_MERGED_HEAD = "fixture-never-merged-head";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = resolve(__dirname, "../../../../packages/task-phases/dist/cli.js");

// ---------------------------------------------------------------------------
// Fixture: one shared clone of the sandbox repo for the whole file
// ---------------------------------------------------------------------------

let sandboxClone = "";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "mag-gh-test-"));
}

function runCli(
  cwd: string,
  args: string[],
  stdin?: string,
): { stdout: string; stderr: string; status: number } {
  const options: ExecFileSyncOptions = {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    input: stdin,
  };
  try {
    const stdout = execFileSync("node", [cliPath, ...args], options);
    return { stdout: stdout.toString(), stderr: "", status: 0 };
  } catch (e: unknown) {
    const err = e as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      status?: number;
    };
    return {
      stdout: (err.stdout ?? "").toString(),
      stderr: (err.stderr ?? "").toString(),
      status: err.status ?? 1,
    };
  }
}

/** Run `gh` from inside the sandbox clone, returning its parsed stdout. */
function ghJson(clone: string, args: string[]): unknown {
  const out = execFileSync("gh", args, { cwd: clone, encoding: "utf-8" });
  return JSON.parse(out.toString());
}

/** `gh pr list` for one base/head pair, read-only. */
function prList(
  clone: string,
  base: string,
  head: string,
  state: "open" | "merged",
): Array<{
  number: number;
  url: string;
  mergedAt: string | null;
  headRefOid: string | null;
  mergeCommit: { oid: string } | null;
}> {
  return ghJson(clone, [
    "pr", "list",
    "--base", base,
    "--head", head,
    "--state", state,
    "--json", "number,url,mergedAt,headRefOid,mergeCommit",
    "--limit", "50",
  ]) as Array<{
    number: number;
    url: string;
    mergedAt: string | null;
    headRefOid: string | null;
    mergeCommit: { oid: string } | null;
  }>;
}

/** A branch name unique to this run — keeps runs isolated from each other
 *  even if an earlier run crashed mid-cleanup. The spec's `AAA-00X` refs are
 *  placeholders; the behavior under test is the PR between base and head. */
function uniqueBranch(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Create a branch from `main` in the clone, optionally adding a commit so
 *  the PR has commits between base and head, and push it to origin. */
function createAndPushBranch(clone: string, name: string, addCommit = false): void {
  execFileSync("git", ["checkout", "-b", name], { cwd: clone, stdio: "pipe" });
  if (addCommit) {
    const scratch = join(clone, `sandbox-${name.replace(/\//g, "-")}.txt`);
    writeFileSync(scratch, `sandbox content ${name}\n`, "utf-8");
    execFileSync("git", ["add", scratch], { cwd: clone, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", `sandbox commit for ${name}`], {
      cwd: clone,
      stdio: "pipe",
    });
  }
  execFileSync("git", ["push", "-u", "origin", name], { cwd: clone, stdio: "pipe" });
  execFileSync("git", ["checkout", "main"], { cwd: clone, stdio: "pipe" });
}

/** Close any open PR between the pair and delete both branches, locally and
 *  on origin. Tolerates partial prior state. Never touches the permanent
 *  fixture branches — callers only pass throwaway names. */
function cleanupPair(clone: string, base: string, head: string): void {
  try {
    const open = prList(clone, base, head, "open");
    for (const pr of open) {
      try {
        execFileSync("gh", ["pr", "close", String(pr.number)], { cwd: clone, stdio: "pipe" });
      } catch {
        // already closed or gone — fine
      }
    }
  } catch {
    // no open PR — fine
  }
  try {
    execFileSync("git", ["push", "origin", "--delete", head, base], {
      cwd: clone,
      stdio: "pipe",
    });
  } catch {
    // branches may already be gone — fine
  }
  for (const branch of [head, base]) {
    try {
      execFileSync("git", ["branch", "-D", branch], { cwd: clone, stdio: "pipe" });
    } catch {
      // already gone — fine
    }
  }
}

beforeAll(() => {
  // Ensure the CLI is built — this must succeed or none of the tests can run
  try {
    execFileSync("pnpm", ["--filter", "@magpieweaver/task-phases", "build"], {
      cwd: resolve(__dirname, "../../../.."),
      stdio: "pipe",
    });
  } catch {
    // If build fails, the CLI won't exist — let the first test catch it
  }

  // Clone the persistent sandbox repo once; every test runs the CLI from here.
  // `gh repo clone` authenticates via the same gh token every other gh call
  // in this file relies on (git_protocol https), so this works on a bare CI
  // runner with only GH_TOKEN set — no SSH keys required.
  sandboxClone = tempDir();
  execFileSync("gh", ["repo", "clone", SANDBOX_REPO, sandboxClone], { stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test"], {
    cwd: sandboxClone,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: sandboxClone, stdio: "pipe" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], {
    cwd: sandboxClone,
    stdio: "pipe",
  });
}, 120000);

afterAll(() => {
  rmSync(sandboxClone, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// §3.1 createPR
// ---------------------------------------------------------------------------

describe("§3.1 createPR", () => {
  it("opens a real PR and reports its number and url (§3.1.1)", { timeout: 60000 }, () => {
    const clone = sandboxClone;
    const base = uniqueBranch("spec/AAA-001");
    const head = uniqueBranch("test/AAA-001");
    try {
      // Given: both branches exist and are pushed to origin (head with a
      // commit the base lacks), and no PR exists between them — the unique
      // names guarantee no PR can pre-exist
      createAndPushBranch(clone, base);
      createAndPushBranch(clone, head, true);

      // When
      const { stdout, status } = runCli(
        clone,
        ["--dev-testing", "gh", "createPR", "-i"],
        JSON.stringify({ base, head, opts: { title: "Tests for AAA-001" } }),
      );

      // Then — the CLI reports success with the PR's real number and url
      expect(status).toBe(0);
      expect(stdout).toContain("--dev-testing gh createPR: OK");
      const lines = stdout.trim().split("\n");
      const reported = JSON.parse(lines[1]) as { number: number; url: string };
      expect(reported.number).toBeGreaterThan(0);
      expect(reported.url).toBe(
        `https://github.com/${SANDBOX_REPO}/pull/${reported.number}`,
      );

      // Then — a real PR now exists on GitHub from head into base
      const open = prList(clone, base, head, "open");
      expect(open.map((pr) => pr.number)).toContain(reported.number);
    } finally {
      cleanupPair(clone, base, head);
    }
  });
});

// ---------------------------------------------------------------------------
// §3.2 findOpenPR
// ---------------------------------------------------------------------------

describe("§3.2 findOpenPR", () => {
  it("reports the still-open PR for a base/head pair (§3.2.1)", { timeout: 60000 }, () => {
    const clone = sandboxClone;
    const base = uniqueBranch("spec/AAA-002");
    const head = uniqueBranch("test/AAA-002");
    let created = 0;
    try {
      // Given: a PR is open between the pair — establish that state directly
      createAndPushBranch(clone, base);
      createAndPushBranch(clone, head, true);
      const url = execFileSync(
        "gh",
        ["pr", "create", "--base", base, "--head", head, "--title", "PR for AAA-002", "--body", "setup"],
        { cwd: clone, encoding: "utf-8" },
      ).toString().trim();
      created = Number(url.split("/").pop());

      // When
      const { stdout, status } = runCli(
        clone,
        ["--dev-testing", "gh", "findOpenPR", "-i"],
        JSON.stringify({ base, head }),
      );

      // Then — the reported number/url match that real PR
      expect(status).toBe(0);
      expect(stdout).toContain("--dev-testing gh findOpenPR: OK");
      const lines = stdout.trim().split("\n");
      const reported = JSON.parse(lines[1]) as { number: number; url: string };
      expect(reported.number).toBe(created);
      expect(reported.url).toBe(`https://github.com/${SANDBOX_REPO}/pull/${created}`);
    } finally {
      cleanupPair(clone, base, head);
    }
  });

  it("reports null when no PR is open (§3.2.2)", { timeout: 60000 }, () => {
    const clone = sandboxClone;
    const base = uniqueBranch("spec/AAA-003");
    const head = uniqueBranch("test/AAA-003");
    try {
      // Given: the branches exist and are pushed, but no PR exists between them
      createAndPushBranch(clone, base);
      createAndPushBranch(clone, head);

      // When
      const { stdout, status } = runCli(
        clone,
        ["--dev-testing", "gh", "findOpenPR", "-i"],
        JSON.stringify({ base, head }),
      );

      // Then — the reported result is null
      expect(status).toBe(0);
      expect(stdout).toContain("--dev-testing gh findOpenPR: OK");
      const lines = stdout.trim().split("\n");
      expect(JSON.parse(lines[1])).toBeNull();
    } finally {
      cleanupPair(clone, base, head);
    }
  });
});

// ---------------------------------------------------------------------------
// §3.3 findMergedPR / findMergedPRs — read-only against permanent fixtures
// ---------------------------------------------------------------------------

describe("§3.3 findMergedPR / findMergedPRs", () => {
  it("reports the single merged PR with merge metadata (§3.3.1)", { timeout: 60000 }, () => {
    const clone = sandboxClone;
    const base = MERGED_ONCE_BASE;
    const head = MERGED_ONCE_HEAD;

    // When
    const { stdout, status } = runCli(
      clone,
      ["--dev-testing", "gh", "findMergedPR", "-i"],
      JSON.stringify({ base, head }),
    );

    // Then — exits 0 and reports the real merged PR
    expect(status).toBe(0);
    expect(stdout).toContain("--dev-testing gh findMergedPR: OK");
    const lines = stdout.trim().split("\n");
    const reported = JSON.parse(lines[1]) as {
      number: number;
      url: string;
      mergedAt: string;
      headRefOid: string;
      mergeCommitOid: string;
    };

    // Then — mergedAt/headRefOid/mergeCommitOid are present and well-formed
    expect(Date.parse(reported.mergedAt)).not.toBeNaN();
    expect(reported.headRefOid).toMatch(/^[0-9a-f]{40}$/i);
    expect(reported.mergeCommitOid).toMatch(/^[0-9a-f]{40}$/i);

    // Then — the reported values match the real merge on GitHub
    const real = prList(clone, base, head, "merged");
    expect(real).toHaveLength(1);
    expect(reported.number).toBe(real[0].number);
    expect(reported.url).toBe(real[0].url);
    expect(reported.mergedAt).toBe(real[0].mergedAt);
    expect(reported.headRefOid).toBe(real[0].headRefOid);
    expect(reported.mergeCommitOid).toBe(real[0].mergeCommit?.oid);
  });

  it("reports null when nothing has ever merged (§3.3.2)", { timeout: 60000 }, () => {
    const clone = sandboxClone;
    const base = NEVER_MERGED_BASE;
    const head = NEVER_MERGED_HEAD;

    // Given sanity — the fixture pair genuinely has no merged PR
    expect(prList(clone, base, head, "merged")).toEqual([]);

    // When
    const { stdout, status } = runCli(
      clone,
      ["--dev-testing", "gh", "findMergedPR", "-i"],
      JSON.stringify({ base, head }),
    );

    // Then — the reported result is null
    expect(status).toBe(0);
    expect(stdout).toContain("--dev-testing gh findMergedPR: OK");
    const lines = stdout.trim().split("\n");
    expect(JSON.parse(lines[1])).toBeNull();
  });

  it("reports the full history oldest-first, and only the most recent via findMergedPR (§3.3.3)", { timeout: 60000 }, () => {
    const clone = sandboxClone;
    const base = MERGED_TWICE_BASE;
    const head = MERGED_TWICE_HEAD;

    // When — findMergedPRs (plural)
    const { stdout, status } = runCli(
      clone,
      ["--dev-testing", "gh", "findMergedPRs", "-i"],
      JSON.stringify({ base, head }),
    );

    // Then — exits 0 and reports exactly 2 entries
    expect(status).toBe(0);
    expect(stdout).toContain("--dev-testing gh findMergedPRs: OK");
    const lines = stdout.trim().split("\n");
    const history = JSON.parse(lines[1]) as Array<{
      number: number;
      url: string;
      mergedAt: string;
      headRefOid: string;
      mergeCommitOid: string;
    }>;
    expect(history).toHaveLength(2);

    // Then — oldest-first, matching the real merged PRs (gh lists newest
    // first, so sort by mergedAt to get the true chronological order)
    expect(Date.parse(history[0].mergedAt)).toBeLessThan(Date.parse(history[1].mergedAt));
    const real = prList(clone, base, head, "merged");
    expect(real).toHaveLength(2);
    const realOldestFirst = [...real].sort(
      (a, b) => Date.parse(a.mergedAt as string) - Date.parse(b.mergedAt as string),
    );
    expect(history.map((h) => h.number)).toEqual(realOldestFirst.map((r) => r.number));
    for (const h of history) {
      expect(h.headRefOid).toMatch(/^[0-9a-f]{40}$/i);
      expect(h.mergeCommitOid).toMatch(/^[0-9a-f]{40}$/i);
    }

    // When — findMergedPR (singular) against the same pair
    const { stdout: out2, status: st2 } = runCli(
      clone,
      ["--dev-testing", "gh", "findMergedPR", "-i"],
      JSON.stringify({ base, head }),
    );

    // Then — it reports only the second (most recent) entry
    expect(st2).toBe(0);
    expect(out2).toContain("--dev-testing gh findMergedPR: OK");
    const single = JSON.parse(out2.trim().split("\n")[1]) as { number: number };
    expect(single.number).toBe(history[1].number);
  });
});

// ---------------------------------------------------------------------------
// §3.4 Error handling
// ---------------------------------------------------------------------------

describe("§3.4 Error handling", () => {
  it("exits 1 and surfaces the real gh error for a nonexistent head (§3.4.1)", { timeout: 60000 }, () => {
    const clone = sandboxClone;
    const head = `nonexistent-branch-${Date.now().toString(36)}`;

    // When — createPR against a head branch that does not exist on origin
    const { stdout, stderr, status } = runCli(
      clone,
      ["--dev-testing", "gh", "createPR", "-i"],
      JSON.stringify({ base: "main", head, opts: { title: "x" } }),
    );

    // Then — exits 1 and the real gh error is surfaced, not an uncaught stack
    expect(status).toBe(1);
    expect(stdout).toContain("--dev-testing gh createPR: FAILED");
    expect(stdout).toMatch(
      /pull request create failed|no commits between|head ref must be a branch/i,
    );
    expect(stderr).not.toContain("Error:");
  });

  it("rejects malformed JSON on stdin with exit code 2, without making a gh call (§3.4.2)", { timeout: 60000 }, () => {
    const clone = sandboxClone;

    // When — malformed JSON on stdin
    const { stdout, status } = runCli(
      clone,
      ["--dev-testing", "gh", "findOpenPR", "-i"],
      "{not valid json",
    );

    // Then — exit code 2 (invalid argument) and the JSON error is reported
    expect(status).toBe(2);
    expect(stdout).toContain("Malformed JSON");
  });
});
