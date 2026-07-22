import { simpleGit } from "simple-git";
import { type GitInspector } from "./git-interface.js";

/**
 * Implementation of GitInspector using simple-git to interact with the
 * local git repository. Used in production gate-check execution.
 */
export class GitInspectorImpl implements GitInspector {
  private git: ReturnType<typeof simpleGit>;

  /**
   * @param cwd Working directory for running git commands (defaults to process.cwd())
   */
  constructor(cwd?: string) {
    this.git = simpleGit({ baseDir: cwd ?? process.cwd() });
  }

  /**
   * Get the reference (Sha) of the commit where the 2 references diverge.
   *
   * @param aRef The reference to a commit
   * @param bRef The reference to another commit
   * @returns The commit reference where the changes to aRef diverge from the changes to bRef
   */
  async mergeBase(aRef: string, bRef: string): Promise<string> {
    return (await this.git.raw(["merge-base", aRef, bRef])).trim();
  }

  /**
   * List the file changes between baseRef and headRef.
   * If headRef is not given then list the file changes introduced by baseRef.
   *
   * @param baseRef The starting reference
   * @param headRef The ending reference
   * @returns A list of the changed paths in the repository between baseRef and headRef
   */
  async diffTree(baseRef: string, headRef?: string): Promise<string[]> {
    let output: string;
    if (headRef) {
      output = await this.git.raw([
        "diff",
        "--name-only",
        `${baseRef}..${headRef}`,
      ]);
    } else {
      output = await this.git.raw([
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "-r",
        baseRef,
      ]);
    }
    return this.splitLines(output);
  }

  /**
   * List the paths in the repository at the given commit reference.
   * If the path is not given list all the paths in the repository.
   *
   * @param commitRef List the paths in the repository up to this reference
   * @param path If given only list the paths with this prefix
   * @returns A list of the paths in the repository to the given reference
   */
  async lsTree(commitRef: string, path?: string): Promise<string[]> {
    const args = ["ls-tree", "--name-only", "-r", commitRef];
    if (path) args.push(path);
    const output = await this.git.raw(args);
    return this.splitLines(output);
  }

  /**
   * List the commit messages from baseRef to headRef.
   * If headRef is not given then return the commit message for the baseRef.
   *
   * @param baseRef The reference of the first commit message
   * @param headRef The reference of the last commit message
   * @returns The commit messages between baseRef and headRef
   */
  async commitMessages(baseRef: string, headRef?: string): Promise<string[]> {
    let output: string;
    if (headRef) {
      output = await this.git.raw([
        "log",
        "--format=%B",
        `${baseRef}..${headRef}`,
      ]);
    } else {
      output = await this.git.raw(["log", "--format=%B", "-1", baseRef]);
    }
    return this.splitByCommit(output);
  }

  /**
   * List the files added between baseRef and headRef.
   * If headRef is not given list the files added by baseRef.
   * If the path is given only list the files added with that prefix.
   *
   * @param baseRef The starting reference
   * @param path The path prefix
   * @param headRef The ending reference
   * @returns The files added to the repository between baseRef and headRef
   */
  async added(
    baseRef: string,
    path?: string,
    headRef?: string,
  ): Promise<string[]> {
    return this.diffFilter("A", baseRef, path, headRef);
  }

  /**
   * List the files modified between baseRef and headRef.
   * If headRef is not given list the files modified by baseRef.
   * If the path is given only list the files modified with that prefix.
   *
   * @param baseRef The starting reference
   * @param path The path prefix
   * @param headRef The ending reference
   * @returns The files modified in the repository between baseRef and headRef
   */
  async modified(
    baseRef: string,
    path?: string,
    headRef?: string,
  ): Promise<string[]> {
    return this.diffFilter("M", baseRef, path, headRef);
  }

  /**
   * List the files deleted between baseRef and headRef.
   * If headRef is not given list the files deleted by baseRef.
   * If the path is given only list the files deleted with that prefix.
   *
   * @param baseRef The starting reference
   * @param path The path prefix
   * @param headRef The ending reference
   * @returns The files deleted in the repository between baseRef and headRef
   */
  async deleted(
    baseRef: string,
    path?: string,
    headRef?: string,
  ): Promise<string[]> {
    return this.diffFilter("D", baseRef, path, headRef);
  }

  /**
   * List the commits from baseRef to headRef.
   *
   * @param baseRef The starting reference
   * @param headRef The ending reference
   * @returns The commit references between baseRef and headRef
   */
  async revList(baseRef: string, headRef: string): Promise<string[]> {
    const output = await this.git.raw([
      "rev-list",
      `${baseRef}..${headRef}`,
    ]);
    return this.splitLines(output);
  }

  /**
   * Run git diff with a specific --diff-filter to list files of a change type.
   *
   * @param filter The diff filter character (A, M, D, etc.)
   * @param baseRef The starting reference
   * @param path An optional path prefix to filter by
   * @param headRef The ending reference
   * @returns The list of file paths matching the filter
   */
  private async diffFilter(
    filter: string,
    baseRef: string,
    path?: string,
    headRef?: string,
  ): Promise<string[]> {
    const range = headRef
      ? `${baseRef}..${headRef}`
      : `${baseRef}^..${baseRef}`;

    const args = ["diff", "--name-only", `--diff-filter=${filter}`, range];
    if (path) args.push("--", path);

    const output = await this.git.raw(args);
    return this.splitLines(output);
  }

  /**
   * Split raw git output into non-empty lines.
   */
  private splitLines(output: string): string[] {
    return (output || "").split("\n").filter(Boolean);
  }

  /**
   * Split raw git log output into individual commit messages.
   * Commit messages are separated by newlines, with each message
   * potentially spanning multiple lines. An empty line separates commits.
   */
  private splitByCommit(output: string): string[] {
    return (output || "")
      .split(/\n\n+/)
      .map((m) => m.trim())
      .filter(Boolean);
  }
}
