/**
 * System tests for `--dev-testing fs <method>` real-world execution.
 *
 * Every test spawns the built CLI as a subprocess against a real
 * (temporary) filesystem fixture — never calls into `cli.ts` exports
 * directly.
 *
 * Spec: MAG-46-02  §3.1 exists/readFile/writeFile, §3.2 copyFile/mkdir/
 * readDir, §3.3 loadConfig (walk-up past the repo root to the filesystem
 * root), §3.4 error handling.
 *
 * All `RealFileSystemTool` methods throw "not implemented" during the test
 * phase, so every test that reaches a real fs call fails as required.
 */

// Implements: task-MAG-46-02-dev-testing-fs-spec.md
// System behaviors: 8.4, 8.5

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = resolve(__dirname, "../../../../packages/task-phases/dist/cli.js");

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Create a temporary directory that is cleaned up after the suite. */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "mag-fs-test-"));
}

/** Write a file at `relPath` under `root`, creating parent directories. */
function writeFixtureFile(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf-8");
}

/** Make `dir` a git repository (no commit). The repo root is NOT the
 *  walk-up boundary for `loadConfig` — the walk continues past it toward
 *  the filesystem root (amended spec §3.3.1), so fixtures place the
 *  config file above the repo, not inside it. */
function initRepoRoot(dir: string): void {
  execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Build the CLI before all tests
// ---------------------------------------------------------------------------

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
}, 30000);

// ---------------------------------------------------------------------------
// §3.1 exists / readFile / writeFile
// ---------------------------------------------------------------------------

describe("§3.1 exists / readFile / writeFile", () => {
  // §3.1.1 exists — present and absent
  describe("§3.1.1 exists", () => {
    it("reports true for a path that exists on disk", () => {
      const dir = tempDir();
      try {
        // Given: docs/tasks/AAA-001/task-AAA-001.md exists on disk
        writeFixtureFile(dir, "docs/tasks/AAA-001/task-AAA-001.md", "# Task AAA-001");

        // When
        const { stdout, status } = runCli(
          dir,
          ["--dev-testing", "fs", "exists", "-i"],
          JSON.stringify({ path: "docs/tasks/AAA-001/task-AAA-001.md" }),
        );

        // Then — exits 0 and reports true
        expect(status).toBe(0);
        expect(stdout).toContain("--dev-testing fs exists: OK");
        expect(stdout).toContain("true");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("reports false for a path that does not exist", () => {
      const dir = tempDir();
      try {
        // Given: docs/tasks/AAA-999/task-AAA-999.md does not exist

        // When
        const { stdout, status } = runCli(
          dir,
          ["--dev-testing", "fs", "exists", "-i"],
          JSON.stringify({ path: "docs/tasks/AAA-999/task-AAA-999.md" }),
        );

        // Then — exits 0 and reports false
        expect(status).toBe(0);
        expect(stdout).toContain("--dev-testing fs exists: OK");
        expect(stdout).toContain("false");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // §3.1.2 writeFile then readFile round-trips real content
  describe("§3.1.2 writeFile then readFile", () => {
    it("writeFile creates the file on disk with the given content", () => {
      const dir = tempDir();
      try {
        // Given: docs/tasks/AAA-001/ exists and is empty
        mkdirSync(join(dir, "docs/tasks/AAA-001"), { recursive: true });

        // When
        const { stdout, status } = runCli(
          dir,
          ["--dev-testing", "fs", "writeFile", "-i"],
          JSON.stringify({ path: "docs/tasks/AAA-001/note.md", content: "hello" }),
        );

        // Then — exits 0 and the file exists on disk with content "hello"
        expect(status).toBe(0);
        expect(stdout).toContain("--dev-testing fs writeFile: OK");
        const onDisk = readFileSync(join(dir, "docs/tasks/AAA-001/note.md"), "utf-8");
        expect(onDisk).toBe("hello");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("readFile reports exactly the content written", () => {
      const dir = tempDir();
      try {
        // Given: docs/tasks/AAA-001/note.md exists with content "hello"
        writeFixtureFile(dir, "docs/tasks/AAA-001/note.md", "hello");

        // When
        const { stdout, status } = runCli(
          dir,
          ["--dev-testing", "fs", "readFile", "-i"],
          JSON.stringify({ path: "docs/tasks/AAA-001/note.md" }),
        );

        // Then — exits 0 and the reported value is exactly "hello"
        expect(status).toBe(0);
        expect(stdout).toContain("--dev-testing fs readFile: OK");
        const lines = stdout.trim().split("\n");
        expect(lines[1]).toBe('"hello"');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// §3.2 copyFile / mkdir / readDir
// ---------------------------------------------------------------------------

describe("§3.2 copyFile / mkdir / readDir", () => {
  // §3.2.1 mkdir creates parent directories as needed
  describe("§3.2.1 mkdir", () => {
    it("creates the path and its parents", () => {
      const dir = tempDir();
      try {
        // Given: docs/tasks/AAA-002/ does not exist

        // When
        const { stdout, status } = runCli(
          dir,
          ["--dev-testing", "fs", "mkdir", "-i"],
          JSON.stringify({ path: "docs/tasks/AAA-002/nested" }),
        );

        // Then — both docs/tasks/AAA-002/ and docs/tasks/AAA-002/nested/ exist
        expect(status).toBe(0);
        expect(stdout).toContain("--dev-testing fs mkdir: OK");
        expect(existsSync(join(dir, "docs/tasks/AAA-002"))).toBe(true);
        expect(existsSync(join(dir, "docs/tasks/AAA-002/nested"))).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // §3.2.2 copyFile creates parent directories as needed
  describe("§3.2.2 copyFile", () => {
    it("copies the source content and creates the destination parents", () => {
      const dir = tempDir();
      try {
        // Given: templates/task-template.md exists
        writeFixtureFile(dir, "templates/task-template.md", "# Template content");

        // Given: docs/tasks/AAA-003/ does not exist

        // When
        const { stdout, status } = runCli(
          dir,
          ["--dev-testing", "fs", "copyFile", "-i"],
          JSON.stringify({
            src: "templates/task-template.md",
            dest: "docs/tasks/AAA-003/task-AAA-003.md",
          }),
        );

        // Then — the destination directory is created
        expect(status).toBe(0);
        expect(stdout).toContain("--dev-testing fs copyFile: OK");
        expect(existsSync(join(dir, "docs/tasks/AAA-003"))).toBe(true);

        // Then — the destination file exists with the template's content
        const copied = readFileSync(join(dir, "docs/tasks/AAA-003/task-AAA-003.md"), "utf-8");
        expect(copied).toBe("# Template content");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // §3.2.3 readDir lists direct entries only
  describe("§3.2.3 readDir", () => {
    it("lists direct entries only, excluding nested files", () => {
      const dir = tempDir();
      try {
        // Given: docs/tasks/ contains AAA-001/ and AAA-002/
        writeFixtureFile(dir, "docs/tasks/AAA-001/task-AAA-001.md", "# Task AAA-001");
        writeFixtureFile(dir, "docs/tasks/AAA-002/task-AAA-002.md", "# Task AAA-002");

        // Given: docs/tasks/AAA-001/ contains a nested file (already above)

        // When
        const { stdout, status } = runCli(
          dir,
          ["--dev-testing", "fs", "readDir", "-i"],
          JSON.stringify({ path: "docs/tasks" }),
        );

        // Then — the reported list is exactly [AAA-001, AAA-002]
        expect(status).toBe(0);
        expect(stdout).toContain("--dev-testing fs readDir: OK");
        const lines = stdout.trim().split("\n");
        const reported = JSON.parse(lines[1]) as string[];
        expect([...reported].sort()).toEqual(["AAA-001", "AAA-002"]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// §3.3 loadConfig
// ---------------------------------------------------------------------------

describe("§3.3 loadConfig", () => {
  // §3.3.1 Walks up past the repo root — the search is not bounded to the repo
  it("walks up past the repo root to find a config above the repo (§3.3.1)", () => {
    const dir = tempDir();
    try {
      // Given: .task-phases.json exists several directories ABOVE the repo
      // root (outside the repo entirely) with a custom tasks.docs value
      writeFixtureFile(
        dir,
        ".task-phases.json",
        JSON.stringify({
          templates: { task: "templates/task-template.md" },
          tasks: { docs: "custom-tasks-dir" },
        }),
      );

      // Given: a real repo nested several levels below the config dir, and
      // no .task-phases.json anywhere inside the repo itself
      const repoRoot = join(dir, "upper", "middle", "repo");
      mkdirSync(repoRoot, { recursive: true });
      initRepoRoot(repoRoot);

      // Given: the command is invoked from a subdirectory several levels
      // deep inside the repo
      const nested = join(repoRoot, "a", "b", "c", "d");
      mkdirSync(nested, { recursive: true });

      // When — loadConfig (no args)
      const { stdout, status } = runCli(nested, ["--dev-testing", "fs", "loadConfig"]);

      // Then — exits 0 and the reported tasks.docs matches the
      // outside-the-repo file's value, not any default. The walk-up must
      // not stop at the repo root.
      expect(status).toBe(0);
      expect(stdout).toContain("--dev-testing fs loadConfig: OK");
      const lines = stdout.trim().split("\n");
      const reported = JSON.parse(lines[1]) as { tasks?: { docs?: string } };
      expect(reported.tasks?.docs).toBe("custom-tasks-dir");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // §3.3.2 Missing config is reported, not thrown as a hard crash
  it("reports a missing config rather than crashing (§3.3.2)", () => {
    const dir = tempDir();
    try {
      // Given: no .task-phases.json exists anywhere walking up from cwd
      // (the repo root below is a git repo so this fixture mirrors the
      // amended §3.3.2 wording; the walk-up is not bounded to it)
      initRepoRoot(dir);

      // When — loadConfig (no args)
      const { stdout, stderr, status } = runCli(dir, ["--dev-testing", "fs", "loadConfig"]);

      // Then — exits non-zero and reports the failure through the CLI result
      expect(status).toBe(1);
      expect(stdout).toContain("--dev-testing fs loadConfig: FAILED");

      // Then — the message identifies the missing config file (not an
      // unhandled stack trace). "config" alone would match the method name
      // in the FAILED line, so require the config-file phrasing itself.
      expect(stdout).toMatch(/\.task-phases\.json|config file/i);
      expect(stderr).not.toContain("Error:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §3.4 Error Handling
// ---------------------------------------------------------------------------

describe("§3.4 Error handling", () => {
  // §3.4.1 readFile on a missing path
  describe("§3.4.1 readFile on a missing path", () => {
    it("exits 1 and surfaces the real filesystem error", () => {
      const dir = tempDir();
      try {
        // Given: docs/tasks/AAA-999/missing.md does not exist

        // When
        const { stdout, stderr, status } = runCli(
          dir,
          ["--dev-testing", "fs", "readFile", "-i"],
          JSON.stringify({ path: "docs/tasks/AAA-999/missing.md" }),
        );

        // Then — exits 1
        expect(status).toBe(1);

        // Then — the real filesystem error is surfaced in the output, not an
        // unhandled stack trace
        expect(stdout).toContain("--dev-testing fs readFile: FAILED");
        expect(stdout).toMatch(/ENOENT|no such file/i);
        expect(stderr).not.toContain("Error:");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // §3.4.2 Malformed JSON args is rejected before any fs call
  describe("§3.4.2 Malformed JSON args", () => {
    it("rejects malformed JSON on stdin with exit code 2, without making an fs call", () => {
      // When — malformed JSON on stdin
      const { stdout, status } = runCli(
        process.cwd(),
        ["--dev-testing", "fs", "readFile", "-i"],
        "{not valid json",
      );

      // Then — exit code 2 (invalid argument) and the JSON error is reported
      expect(status).toBe(2);
      expect(stdout).toContain("Malformed JSON");
    });
  });
});
