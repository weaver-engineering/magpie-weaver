import { UsageError } from "../errors.js";
import type { ExternalTools, InitCommandResult } from "../types.js";
import { scaffoldTaskDoc } from "../lib/task-doc.js";
import { commitWipOnCurrentBranch } from "../lib/wip-commit.js";

/** `pnpm task init <ref> [--quick] [--title <title>] [--doc <path>]
 * [--specs <path>...] [--wip [title] [message]] [--commit] [--json]` —
 * see task-phasing-lld.md §3.8. Implements spec 05 + the MAG-46-18 flag
 * variants: the happy path of both branch-creation routes (normal ->
 * `spec/{ref}`, `--quick` -> `task/{ref}`), each producing the task doc
 * (`docs/tasks/{ref}/task-{ref}.md` from the template, or from a `--doc`
 * path) and any `--specs` docs — never overwriting an existing task doc
 * (`lib/task-doc.ts`, LLD §4.6/§3.8) — plus the pre-flight blocks that
 * must pass before any branch is created: a dirty worktree with no `--wip`
 * (unconditional, §3.14), `main` behind `origin/main`, and a missing
 * `--title`/`--doc` (invalid argument, exit 2). `--wip` (MAG-46-18)
 * converts the dirty-worktree block into a carry-forward: the pre-existing
 * WIP is committed on the current branch BEFORE the new branch is created.
 * `--commit` then commits and pushes the scaffolded doc on the new branch —
 * opt-in, not automatic, so the scaffold can be reviewed before anything
 * is pushed; without it `init` leaves the doc uncommitted on the new
 * branch for the caller to inspect and commit by hand. */

export async function init(
  tools: ExternalTools,
  args: Record<string, boolean | number | string | string[]>,
): Promise<InitCommandResult> {
  const positionals = args.positionals;
  const ref =
    Array.isArray(positionals) && typeof positionals[0] === "string"
      ? positionals[0]
      : "";
  if (ref === "") {
    throw new UsageError("init requires a task ref");
  }

  // §3.5 — one of `--title`/`--doc` is required; caught before any branch
  // or doc creation is attempted. `--specs` is a helper convenience on top,
  // not a substitute for the task doc itself.
  const title = typeof args.title === "string" ? args.title : undefined;
  const doc = typeof args.doc === "string" ? args.doc : undefined;
  const specs =
    typeof args.specs === "string"
      ? [args.specs]
      : Array.isArray(args.specs)
        ? args.specs
        : undefined;
  if (title === undefined && doc === undefined) {
    throw new UsageError("one of `--title`/`--doc` is required");
  }

  // `git.fetch()` runs first, once, before any derivation (§1.1).
  await tools.git.fetch();

  const currentBranch = await tools.git.currentBranch();

  // §3.3 — work in progress with no `--wip` instruction is a hard,
  // unconditional block: the pre-existing branch's state is left untouched.
  // With `--wip` (MAG-46-18) the block becomes a carry-forward instead —
  // the WIP is committed on the current branch before the new branch is
  // created, per §3.8's ordering (WIP handling precedes branch creation).
  const dirty = await tools.git.isDirty();
  let wipCarriedForward = false;
  let wipCommitTitle: string | undefined;
  if (dirty) {
    if (args.wip === undefined) {
      return refuse(
        ref,
        "There is work in progress and no `--wip` instruction was given",
      );
    }
    // The literal `{ref}: {title} - WIP` format is exact (MAG-46-07 §2.1,
    // same convention `wip`/`ref` use — shared with `wip.ts` and
    // `status --fix --wip` via `lib/wip-commit.ts`); with no title the
    // title segment is omitted entirely, and the message falls back to
    // "work in progress". Committed on the branch being LEFT — never the
    // ref being initialised.
    wipCommitTitle = await commitWipOnCurrentBranch(tools, args.wip, currentBranch);
    wipCarriedForward = true;
  }

  // §3.4 — `main` must be up to date with `origin` before branching.
  const mainSha = await tools.git.headSha("main");
  const originMainSha = await tools.git.headSha("origin/main");
  if (mainSha !== originMainSha) {
    return refuse(ref, "`main` is not up to date with `origin`");
  }

  // §3.1/§3.2 — the route decides which canonical branch is created off
  // `main`. An already-existing branch (local or remote) is refused; the
  // merged/reusable decision tree is a later chunk (MAG-46-18).
  const quick = args.quick === true;
  const canonicalBranch = quick ? `task/${ref}` : `spec/${ref}`;

  const branchExistsLocal = await tools.git.branchExists(canonicalBranch);
  const branchExistsRemote = await tools.git.branchExists(canonicalBranch, {
    remote: true,
  });
  if (branchExistsLocal || branchExistsRemote) {
    return refuse(ref, `Branch \`${canonicalBranch}\` already exists`);
  }

  await tools.git.createBranch(canonicalBranch, "main");

  const { taskDocPath, written, specDocPaths, warnings } = await scaffoldTaskDoc(
    tools,
    ref,
    title,
    { doc, specs },
  );

  const messages = [
    `Current branch \`${currentBranch}\` - ref: ${ref}`,
    ...(wipCommitTitle !== undefined
      ? [`WIP committed on \`${currentBranch}\` as \`${wipCommitTitle}\``]
      : []),
    `New task \`${ref}\` initialised on \`${canonicalBranch}\``,
    written
      ? `Task doc: ${taskDocPath}`
      : `Task doc already exists, left untouched: ${taskDocPath}`,
    ...warnings,
    ...(specDocPaths.length > 0 ? [`Spec docs: ${specDocPaths.join(", ")}`] : []),
  ];

  // `--commit` is opt-in: by the time `init` runs the design workflow that
  // produced the doc(s) is already finished, so committing/pushing is
  // purely mechanical — but that's still a push to a shared remote, so it
  // only happens when explicitly asked for, not unconditionally on every
  // scaffold. Nothing to commit at all when the doc already existed and
  // was left untouched — the branch alone needs no commit of its own.
  const commit = args.commit === true && written;
  if (commit) {
    const commitTitle = `${ref}: ${title ?? "New task"}`;
    const commitMessage = `Task doc: ${taskDocPath}`;
    await tools.git.commitAll(commitTitle, commitMessage);
    await tools.git.push(canonicalBranch);
    messages.push(`Committed and pushed \`${canonicalBranch}\``);
  }

  return {
    success: true,
    messages,
    ref,
    canonicalBranch,
    taskDocPath,
    specDocPaths,
    wipCarriedForward,
    committed: commit,
  };
}

/** A refusal result — `success: false` maps to exit 1, and no branch or doc
 * creation has happened. `canonicalBranch` stays empty because nothing was
 * created. */
function refuse(ref: string, message: string): InitCommandResult {
  return {
    success: false,
    messages: [message, `Refusing to initialise \`${ref}\``],
    ref,
    canonicalBranch: "",
    taskDocPath: null,
    specDocPaths: [],
    wipCarriedForward: false,
    committed: false,
  };
}
