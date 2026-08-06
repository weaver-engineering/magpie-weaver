/**
 * Concrete shape of `GitTool` (task-phasing-lld.md §2's `ExternalTools.git`,
 * detailed in §4.8). Branch create/checkout/push/rebase primitives — never
 * used to create ordinary work commits (§1.1).
 *
 * Spec 01 implements `fetch`, `currentBranch`, `branchExists`, `headSha`,
 * `createBranch`, `checkout`, `commitAll`, `push`. Spec 05.01 implements
 * `isDirty`, `hasCommitsBeyond`, `headCommitTitle`, `pullFastForward`,
 * `deleteBranch`. Spec 07 implements `changedFiles`. `isAncestor` landed
 * early (real, in `packages/task-phases/src/deps/git.ts`) to unblock the
 * spec 10 `promote` success path, which re-derives the post-fork status via
 * `deriveRepoState()` and reaches it. Spec 13 implements the final two
 * stubs — `mergeBase` and `rebase` (the force-push-adjacent primitive
 * every §3.5 rebase-forward case depends on).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { simpleGit } from "simple-git";

const execFileAsync = promisify(execFile);

/** `deps/git.ts`'s own type — `types.ts` imports it, not the reverse. */
export type RebaseOutcome =
  | { status: "ok" }
  | { status: "conflict"; details: string }
  | {
      status: "unexpected-commit-count";
      expected: 1;
      actual: number;
      details: string;
    };

export interface GitTool {
  fetch(): Promise<void>;

  currentBranch(): Promise<string>;

  branchExists(branch: string, opts?: { remote?: boolean }): Promise<boolean>;

  headSha(branch: string): Promise<string>;

  mergeBase(refA: string, refB: string): Promise<string>;

  hasCommitsBeyond(branch: string, parentBranch: string): Promise<boolean>;

  headCommitTitle(branch: string): Promise<string>;

  isDirty(): Promise<boolean>;

  /** `git status --porcelain` parsed into added/changed/deleted buckets —
   * untracked (`??`) and index-added (`A`) files count as added, deleted
   * (`D`) as deleted, and everything else (`M`, `R`, `C`, ...) as changed.
   * Local-checkout-only by nature, like `isDirty`. Callers must run this
   * *before* any `commitAll`, which stages and commits everything and
   * leaves the tree clean. */
  changedFiles(): Promise<{ added: string[]; changed: string[]; deleted: string[] }>;

  /** Exit code 1 from `merge-base --is-ancestor` is a legitimate `false`,
   * not an error. */
  isAncestor(ancestor: string, descendant: string): Promise<boolean>;

  /** Local only — does not push; callers must follow up with `push()`. */
  createBranch(newBranch: string, fromRef: string): Promise<void>;

  /** `git push origin <fromRef>:refs/heads/<newBranch>` — publishes an
   * already-existing ref `fromRef` (e.g. `origin/main`) to a newly-named
   * branch `newBranch` (e.g. `build/{ref}`) on `origin`, without creating
   * or checking `newBranch` out locally (spec 11 §3.1.1).
   * Throws if `newBranch` already exists on origin (the caller checks
   * `branchExists` first). */
  createRemoteBranch(newBranch: string, fromRef: string): Promise<void>;

  checkout(branch: string): Promise<void>;

  commitAll(title: string, message?: string): Promise<string>;

  push(branch: string, opts?: { force?: boolean }): Promise<void>;

  pullFastForward(branch: string): Promise<void>;

  /** Rebases `branch` onto `ontoRef` in place (no push) — the shared
   * primitive behind every §3.5 rebase-forward case (spec-amended-under-
   * test, build-reorder, main-drift). Derives `upstream` as
   * `mergeBase(branch, ontoRef)` — the boundary between the branch's own
   * commits and what it shares with its target — then verifies the
   * commit-count precondition (`rev-list --count upstream..branch == 1`)
   * *before* any rewrite is attempted, refusing with
   * `unexpected-commit-count` otherwise (the branch is left completely
   * untouched). If exactly 1, runs `git rebase --onto <ontoRef>
   * <upstream> <branch>` and reports `conflict` or `ok`. The `<branch>`
   * argument checks the branch out as part of the operation (§2.1 —
   * callers restore the starting branch themselves). Reports rather than
   * resolves a conflict, leaving the repository mid-rebase for a
   * human/agent to resolve manually — newly-merged, human-reviewed
   * content always takes precedence over the branch being rebased. */
  rebase(branch: string, ontoRef: string): Promise<RebaseOutcome>;

  deleteBranch(branch: string): Promise<void>;

  /** `git for-each-ref --format='%(refname:short)' refs/heads
   * refs/remotes/origin` — every local branch name (`test/{ref}`) and every
   * remote-tracking branch name in its short form (`origin/test/{ref}`), in
   * one call. Sole caller is `list` (§3.10, MAG-46-16) — the first command
   * to need branch enumeration, which no earlier chunk's surface supported
   * (every other command already knows the specific ref/branch it's asking
   * about). The caller strips any `origin/` prefix and any `spec`/`test`/
   * `build`/`task` phase prefix, matches what remains against
   * `/^[A-Z]+-[0-9]+$/`, and groups both forms of the same branch under one
   * `{ref}` entry. */
  listBranches(): Promise<string[]>;
}

export class RealGitTool implements GitTool {
  private git: ReturnType<typeof simpleGit>;

  /**
   * @param cwd Working directory for running git commands. Defaults to
   * `process.cwd()` — the repository is resolved relative to the caller's
   * current working directory, never relative to wherever `task-phases`
   * itself is installed (spec 01 §3.2.5).
   */
  constructor(private readonly cwd: string = process.cwd()) {
    this.git = simpleGit({ baseDir: this.cwd });
  }

  /** `git fetch origin --prune` — keeps local remote-tracking refs fresh
   * (and prunes stale ones) before any phase/state derivation. */
  async fetch(): Promise<void> {
    await this.git.raw(["fetch", "origin", "--prune"]);
  }

  /** `git branch --show-current` — the branch actually checked out, or `""`
   * in detached HEAD. */
  async currentBranch(): Promise<string> {
    return (await this.git.raw(["branch", "--show-current"])).trim();
  }

  /** `git show-ref --verify` against the local branch ref, or the local
   * remote-tracking ref when `opts.remote` is set. A nonzero exit from
   * `show-ref` means the ref doesn't exist — `false`, not an error. (`--quiet`
   * is deliberately omitted: simple-git treats a task as failed only when a
   * nonzero exit is accompanied by stderr output, and `--quiet` suppresses
   * that output, so the "doesn't exist" case would otherwise resolve instead
   * of rejecting.) */
  async branchExists(branch: string, opts?: { remote?: boolean }): Promise<boolean> {
    const ref = opts?.remote ? `refs/remotes/origin/${branch}` : `refs/heads/${branch}`;
    try {
      await this.git.raw(["show-ref", "--verify", ref]);
      return true;
    } catch {
      return false;
    }
  }

  /** `git rev-parse <ref>` — the SHA at `ref`'s current HEAD. */
  async headSha(branch: string): Promise<string> {
    return (await this.git.raw(["rev-parse", branch])).trim();
  }

  /** `git merge-base <refA> <refB>` — the nearest common ancestor SHA of
   * two refs. `rebase()`'s upstream-boundary derivation (§4.8) is built on
   * this, so it shares the same execFile-for-git pattern. */
  async mergeBase(refA: string, refB: string): Promise<string> {
    return (await this.git.raw(["merge-base", refA, refB])).trim();
  }

  /** `git rev-list --count <parentBranch>..<branch>` — commits unique to
   * `branch` relative to `parentBranch`. Nonzero distinguishes
   * `not-started` from `work-in-progress`/`ready?` (§2, §4.5).
   *
   * Total with respect to the parent: a parent that doesn't resolve — e.g.
   * `spec/{ref}` for a remote-only `test/{ref}` that was never forked
   * locally — would otherwise make `rev-list` fail with "unknown revision"
   * and crash the whole derivation. Resolve the parent first; a branch
   * whose parent doesn't exist has no commits of its own to count, so
   * report `false` (the same answer a level fork gives), which
   * `deriveState` reads as `not-started` (spec 16 §2.1). */
  async hasCommitsBeyond(branch: string, parentBranch: string): Promise<boolean> {
    try {
      await this.git.raw(["rev-parse", "--verify", `${parentBranch}^{commit}`]);
    } catch {
      return false;
    }
    const count = (
      await this.git.raw(["rev-list", "--count", `${parentBranch}..${branch}`])
    ).trim();
    return Number(count) > 0;
  }

  /** `git log -1 --format=%s <branch>` — HEAD's commit title (subject line
   * only, no body), for the literal `WIP` substring check. */
  async headCommitTitle(branch: string): Promise<string> {
    return (await this.git.raw(["log", "-1", "--format=%s", branch])).trim();
  }

  /** `git status --porcelain` — nonempty output means dirty. Covers both
   * staged and unstaged changes, and untracked files. Local-checkout-only
   * by nature — only meaningful for whatever's currently checked out. */
  async isDirty(): Promise<boolean> {
    const status = await this.git.raw(["status", "--porcelain"]);
    return status.trim() !== "";
  }

  /** `git status --porcelain` parsed into added/changed/deleted buckets.
   * Each porcelain line is `<XY> <path>` — the two status chars are the
   * index (X) and worktree (Y) state, and the path starts at index 3.
   * Untracked files report as `??`; a `D` in either position means deleted;
   * an `A` in either position means added; everything else (`M`, `R`, `C`,
   * ...) is changed. Paths git quoted (spaces, quotes, non-ASCII) have
   * their surrounding quotes stripped. Must run before `commitAll`, which
   * leaves the tree clean. */
  async changedFiles(): Promise<{ added: string[]; changed: string[]; deleted: string[] }> {
    const status = await this.git.raw(["status", "--porcelain"]);
    const added: string[] = [];
    const changed: string[] = [];
    const deleted: string[] = [];
    for (const raw of status.split("\n")) {
      if (raw.length === 0) continue;
      const indexStatus = raw[0];
      const worktreeStatus = raw[1];
      const path = raw.slice(3).replace(/^"(.*)"$/, "$1");
      if (indexStatus === "?" && worktreeStatus === "?") {
        added.push(path);
      } else if (indexStatus === "D" || worktreeStatus === "D") {
        deleted.push(path);
      } else if (indexStatus === "A" || worktreeStatus === "A") {
        added.push(path);
      } else {
        changed.push(path);
      }
    }
    return { added, changed, deleted };
  }

  /** `git merge-base --is-ancestor <ancestor> <descendant>` — determines
   * whether `<ancestor>` is an ancestor of `<descendant>`. Exit code 0
   * means true, exit code 1 a legitimate false (as the interface's
   * docstring notes), and anything else (e.g. an unknown ref, exit 128) a
   * genuine error — which is surfaced via git's own stderr, or a generic
   * message when git produced none. Read the exit code via execFile
   * directly (the same pattern `pullFastForward` uses) because simple-git
   * treats a nonzero exit as a failure only when it's accompanied by
   * stderr, and `merge-base --is-ancestor`'s exit-1 `false` is silent. */
  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    try {
      await execFileAsync(
        "git",
        ["merge-base", "--is-ancestor", ancestor, descendant],
        { cwd: this.cwd, encoding: "utf-8" },
      );
      return true;
    } catch (error) {
      const err = error as { code?: number; stderr?: string | Buffer };
      if (err.code === 1) {
        return false;
      }
      const stderrText = (err.stderr ?? "").toString().trim();
      throw new Error(
        stderrText.length > 0
          ? stderrText
          : `git merge-base --is-ancestor ${ancestor} ${descendant} failed (exit code ${err.code ?? "unknown"})`,
        { cause: error },
      );
    }
  }

  /** `git checkout -b <newBranch> <fromRef>` — creates `newBranch` off
   * `fromRef`'s current HEAD and checks it out. Local only — does not push;
   * callers must follow up with `push()`. */
  async createBranch(newBranch: string, fromRef: string): Promise<void> {
    await this.git.raw(["checkout", "-b", newBranch, fromRef]);
  }

  /** `git checkout <branch>` — switches to an already-existing branch. */
  async checkout(branch: string): Promise<void> {
    await this.git.raw(["checkout", branch]);
  }

  /** `git push origin <fromRef>:refs/heads/<newBranch>` — publishes an
   * already-existing ref `fromRef` (e.g. `origin/main`) to a newly-named
   * branch `newBranch` (e.g. `build/{ref}`) on `origin` straight, without
   * creating or checking `newBranch` out locally — the base branch a
   * `gh pr create --base build/{ref}` would 422 against if it didn't exist
   * (spec 11 §2.1/§3.1.1). */
  async createRemoteBranch(newBranch: string, fromRef: string): Promise<void> {
    await this.git.raw(["push", "origin", `${fromRef}:refs/heads/${newBranch}`]);
  }

  /** `git add -A && git commit -m "<title>" [-m "<message>"]`, then
   * `git rev-parse HEAD` for the returned SHA. Generic — has no
   * WIP-specific knowledge itself; callers build the full
   * `{ref}: {title} - WIP` formatted title/message first. */
  async commitAll(title: string, message?: string): Promise<string> {
    await this.git.raw(["add", "-A"]);
    const commitArgs = ["commit", "-m", title];
    if (message !== undefined) {
      commitArgs.push("-m", message);
    }
    await this.git.raw(commitArgs);
    return (await this.git.raw(["rev-parse", "HEAD"])).trim();
  }

  /** `git push origin <branch>`, or `git push origin <branch>
   * --force-with-lease` when `opts.force` is set. */
  async push(branch: string, opts?: { force?: boolean }): Promise<void> {
    const args = ["push", "origin", branch];
    if (opts?.force) {
      args.push("--force-with-lease");
    }
    await this.git.raw(args);
  }

  /** The non-destructive half of `merged-pending-pull` (§3.3).
   * If `branch` doesn't exist locally: `git branch <branch>
   * origin/<branch>` (create only, no checkout — callers use `checkout()`
   * separately if they want to switch to it).
   * If it does exist: first verify `git merge-base --is-ancestor
   * <branch> origin/<branch>` — a genuine fast-forward must actually be
   * possible — then fast-forward the local ref to `origin/<branch>`. The
   * verification matters: blindly forcing the ref without checking
   * direction would silently discard a local-only commit if this were
   * ever called on a branch that had diverged.
   *
   * How the ref is moved depends on whether `branch` is checked out:
   * `git branch -f <branch> <originRef>` refuses (`fatal: Cannot force
   * update the current branch.`) when `<branch>` is the currently
   * checked-out branch — which is exactly the situation `promote`'s
   * `merged-pending-pull` resolution is always in, since its own
   * `branchMismatch` guard forces the caller onto `build/{ref}` before
   * calling this (spec 10/14). So when `branch === currentBranch`, the
   * fast-forward is done in place with `git merge --ff-only <originRef>`
   * instead — which moves the checked-out branch forward only if the
   * update genuinely is a fast-forward and errors (cleanly, on a real
   * divergence) otherwise. */
  async pullFastForward(branch: string): Promise<void> {
    const originRef = `origin/${branch}`;
    if (!(await this.branchExists(branch))) {
      // Create-only, no checkout.
      await this.git.raw(["branch", branch, originRef]);
      return;
    }
    // Verify a genuine fast-forward is possible before forcing the ref.
    // `git merge-base --is-ancestor` exits 1 with *no* stderr output when
    // `branch` is not an ancestor of `origin/<branch>`, and simple-git
    // only treats a nonzero exit as a failure when it is accompanied by
    // stderr — so the divergence case would silently resolve. Read the
    // exit code via execFile directly (gh.ts's pattern) instead.
    try {
      await execFileAsync("git", ["merge-base", "--is-ancestor", branch, originRef], {
        cwd: this.cwd,
        encoding: "utf-8",
      });
    } catch (error) {
      const err = error as { code?: number; stderr?: string | Buffer };
      if (err.code === 1) {
        throw new Error(
          `Cannot fast-forward ${branch}: local branch has diverged from ${originRef}`,
          { cause: error },
        );
      }
      // Any other failure (e.g. unknown ref, exit 128) surfaces git's own
      // stderr, or a generic message when git produced none.
      const stderrText = (err.stderr ?? "").toString().trim();
      throw new Error(
        stderrText.length > 0
          ? stderrText
          : `git merge-base --is-ancestor ${branch} ${originRef} failed (exit code ${err.code ?? "unknown"})`,
        { cause: error },
      );
    }
    if ((await this.currentBranch()) === branch) {
      // `git branch -f` cannot force-update the currently checked-out
      // branch, so fast-forward in place instead. `git merge --ff-only`
      // moves the checked-out branch head to `origin/<branch>` only when
      // that update really is a fast-forward (already verified above) and
      // leaves it untouched on any genuine divergence.
      await this.git.raw(["merge", "--ff-only", originRef]);
      return;
    }
    await this.git.raw(["branch", "-f", branch, originRef]);
  }

  /** Rebases `branch` onto `ontoRef` in place (no push) — the shared
   * primitive behind every §3.5 rebase-forward case (spec-amended-under-
   * test, build-reorder, main-drift). `upstream` is derived as
   * `mergeBase(branch, ontoRef)`, then the commit-count precondition
   * (`rev-list --count upstream..branch == 1`) is verified *before* any
   * rewrite is attempted — a branch with zero or more than one commit of
   * its own is refused cleanly with `unexpected-commit-count`, left
   * completely untouched. If exactly 1, runs `git rebase --onto <ontoRef>
   * <upstream> <branch>`. execFile (not simple-git) so the exit code and
   * git's own stdout/stderr can be read: a content conflict exits 1 and
   * must be reported as its own outcome (leaving the repository
   * mid-rebase, never auto-aborted), while anything else (an unknown ref,
   * a dirty worktree) is a genuine error to surface. */
  async rebase(branch: string, ontoRef: string): Promise<RebaseOutcome> {
    const upstream = await this.mergeBase(branch, ontoRef);

    const count = Number(
      (await this.git.raw(["rev-list", "--count", `${upstream}..${branch}`])).trim(),
    );
    if (count !== 1) {
      return {
        status: "unexpected-commit-count",
        expected: 1,
        actual: count,
        details: `Expected exactly 1 commit unique to ${branch} relative to ${upstream}, found ${count}`,
      };
    }

    try {
      await execFileAsync(
        "git",
        ["rebase", "--onto", ontoRef, upstream, branch],
        { cwd: this.cwd, encoding: "utf-8" },
      );
      return { status: "ok" };
    } catch (error) {
      const err = error as { code?: number; stdout?: string | Buffer; stderr?: string | Buffer };
      const stdout = (err.stdout ?? "").toString();
      const stderr = (err.stderr ?? "").toString();

      // Distinguish a genuine content conflict (git rebase exit 1, CONFLICT
      // lines on stdout, unmerged paths left in the worktree) from any other
      // failure (exit 128, fatal on stderr). The unmerged-path check via
      // `git diff --name-only --diff-filter=U` is the decisive signal — a
      // conflicted rebase always leaves at least one path unmerged.
      let unmerged: string;
      try {
        unmerged = (await this.git.raw(["diff", "--name-only", "--diff-filter=U"])).trim();
      } catch {
        unmerged = "";
      }
      if (err.code === 1 || unmerged.length > 0 || /CONFLICT/i.test(stdout)) {
        return {
          status: "conflict",
          details: [
            stdout.trim(),
            stderr.trim(),
            ...(unmerged.length > 0 ? [`Unmerged paths:\n${unmerged}`] : []),
          ]
            .filter((line) => line.length > 0)
            .join("\n"),
        };
      }

      const stderrText = stderr.trim();
      throw new Error(
        stderrText.length > 0
          ? stderrText
          : `git rebase --onto ${ontoRef} ${upstream} ${branch} failed (exit code ${err.code ?? "unknown"})`,
        { cause: error },
      );
    }
  }

  /** `git branch -D <branch>` + `git push origin --delete <branch>` —
   * used only by final cleanup once the Main Gate PR merges (§3.6); never
   * for any earlier transition. Either half already being absent is a
   * no-op, not an error: the local half in particular is exactly the state
   * a previously-interrupted cleanup leaves behind, so re-running must
   * succeed. (Remote half existence is checked against the local
   * remote-tracking ref, which `fetch()` keeps fresh per §1.1.) */
  async deleteBranch(branch: string): Promise<void> {
    if (await this.branchExists(branch)) {
      await this.git.raw(["branch", "-D", branch]);
    }
    if (await this.branchExists(branch, { remote: true })) {
      await this.git.raw(["push", "origin", "--delete", branch]);
    }
  }

  /** `git for-each-ref --format='%(refname:short)' refs/heads
   * refs/remotes/origin` — the enumeration primitive behind `list`
   * (MAG-46-16 §2.1/LLD §3.10): every local branch name and every
   * remote-tracking branch name in its short form (`origin/test/{ref}`), in
   * one call. `%(refname:short)` already produces the short form git itself
   * uses — `test/{ref}` for heads, `origin/test/{ref}` for the origin
   * remote-tracking namespace — so no further transformation is needed
   * beyond trimming whitespace and dropping empty lines. */
  async listBranches(): Promise<string[]> {
    const output = await this.git.raw([
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
      "refs/remotes/origin",
    ]);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}
