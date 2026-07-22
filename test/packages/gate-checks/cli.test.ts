import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = resolve(__dirname, "../../../packages/gate-checks/dist/cli.js");

function runCli(args: string[]): {
  stdout: string;
  stderr: string;
  status: number;
} {
  try {
    const stdout = execFileSync("node", [cliPath, ...args], {
      encoding: "utf-8",
      stdio: "pipe",
    });
    return { stdout, stderr: "", status: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
      status: err.status ?? 1,
    };
  }
}

describe("CLI", () => {
  describe("error handling", () => {
    it("exits 2 with \"No check name provided\" when no arguments given", () => {
      const { stdout, status } = runCli([]);
      expect(status).toBe(2);
      expect(stdout).toContain("[gate-check]");
      expect(stdout).toContain("No check name provided");
    });

    it("exits 2 when only --json is given", () => {
      const { stdout, status } = runCli(["--json"]);
      const parsed = JSON.parse(stdout);
      expect(status).toBe(2);
      expect(parsed.check).toBe("unknown");
      expect(parsed.violations).toContain("No check name provided");
    });

    it("exits 2 with check name in result when check not in catalog", () => {
      const { stdout, status } = runCli(["nonexistent", "--json"]);
      const parsed = JSON.parse(stdout);
      expect(status).toBe(2);
      expect(parsed.check).toBe("nonexistent");
      expect(parsed.violations).toContain("Check \"nonexistent\" not found");
    });

    it("exits 2 when a required argument is missing", () => {
      const { stdout, status } = runCli([
        "get-inbound-commits",
        "--base-ref",
        "HEAD",
        "--json",
      ]);
      const parsed = JSON.parse(stdout);
      expect(status).toBe(2);
      expect(parsed.violations).toContain(
        "Missing required argument: --head-ref",
      );
    });

    it("exits 2 when check function throws", () => {
      const { stdout, status } = runCli([
        "get-inbound-commits",
        "--base-ref",
        "INVALID_REF_THAT_DOES_NOT_EXIST_12345",
        "--head-ref",
        "ALSO_INVALID_67890",
        "--json",
      ]);
      const parsed = JSON.parse(stdout);
      expect(status).toBe(2);
      expect(parsed.violations[0]).toContain("Invalid argument");
    });
  });

  describe("check execution", () => {
    it("exits 1 when same base/head ref (no commits)", () => {
      const { stdout, status } = runCli([
        "get-inbound-commits",
        "--base-ref",
        "HEAD",
        "--head-ref",
        "HEAD",
        "--json",
      ]);
      const parsed = JSON.parse(stdout);
      expect(status).toBe(1);
      expect(parsed.check).toBe("get-inbound-commits");
      expect(parsed.passed).toBe(false);
      expect(parsed.violations).toContain(
        "No commits between --base-ref and --head-ref",
      );
    });

    it("exits 0 when different base/head ref (commits found)", () => {
      const { stdout, status } = runCli([
        "get-inbound-commits",
        "--base-ref",
        "HEAD~1",
        "--head-ref",
        "HEAD",
        "--json",
      ]);
      const parsed = JSON.parse(stdout);
      expect(status).toBe(0);
      expect(parsed.check).toBe("get-inbound-commits");
      expect(parsed.passed).toBe(true);
      expect(parsed.values.commits).toBeDefined();
      expect(Array.isArray(parsed.values.commits)).toBe(true);
      expect(parsed.values.commits.length).toBeGreaterThan(0);
    });
  });

  describe("output format", () => {
    it("outputs valid JSON when --json flag is used", () => {
      const { stdout, status } = runCli([
        "get-inbound-commits",
        "--base-ref",
        "HEAD",
        "--head-ref",
        "HEAD",
        "--json",
      ]);
      expect(status).toBe(1);
      expect(() => JSON.parse(stdout)).not.toThrow();
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty("check");
      expect(parsed).toHaveProperty("passed");
      expect(parsed).toHaveProperty("violations");
      expect(parsed).toHaveProperty("summary");
      expect(parsed).toHaveProperty("values");
    });

    it("outputs human-readable text when --json is absent", () => {
      const { stdout, status } = runCli([
        "get-inbound-commits",
        "--base-ref",
        "HEAD",
        "--head-ref",
        "HEAD",
      ]);
      expect(status).toBe(1);
      expect(stdout).toContain("[gate-check]");
      expect(stdout).toContain("get-inbound-commits");
      expect(stdout).toContain("FAIL");
      expect(stdout).toContain("summary:");
    });

    it("outputs human-readable on error without --json", () => {
      const { stdout, status } = runCli(["nonexistent"]);
      expect(status).toBe(2);
      expect(stdout).toContain("[gate-check]");
      expect(stdout).toContain("nonexistent");
      expect(stdout).toContain("FAIL");
    });
  });

  describe("human output for success", () => {
    it("outputs PASS and summary in human mode on success", () => {
      const { stdout, status } = runCli([
        "get-inbound-commits",
        "--base-ref",
        "HEAD~1",
        "--head-ref",
        "HEAD",
      ]);
      expect(status).toBe(0);
      expect(stdout).toContain("PASS");
      expect(stdout).toContain("summary:");
      expect(stdout).toContain("commit");
    });
  });
});
