import { UsageError } from "../errors.js";
import type { ExternalTools, InitCommandResult } from "../types.js";
import { scaffoldTaskDoc } from "../lib/task-doc.js";

/** `pnpm task init <ref> [--quick] [--title <title>] [--json]` — see
 * task-phasing-lld.md §3.8. Implements spec 05: the happy path of both
 * branch-creation routes (normal -> `spec/{ref}`, `--quick` ->
 * `task/{ref}`), each scaffolding `docs/tasks/{ref}/task-{ref}.md` from the
 * template with `${ref}`/`${title}` substituted (`lib/task-doc.ts`, LLD
 * §4.6), plus the pre-flight blocks that must pass before any branch is
 * created: a dirty worktree with no `--wip` (unconditional, §3.14), `main`
 * behind `origin/main`, and a missing `--title`/`--doc` (invalid argument,
 * exit 2). The scaffolded doc is then committed and pushed on the new
 * branch — queuing it up is purely mechanical by the time `init` runs, so
 * there's no manual step left.
 *
 * The `--doc`/`--specs` conveniences, `--wip`-carried-forward, and the
 * existing-doc/reusable-branch decision tree land with MAG-46-18. */

export async function init(
  tools: ExternalTools,
  args: Record<string, boolean | number | string | string[]>,
): Promise<InitCommandResult> {
  // `init <ref>` takes the ref positionally (§1); the flag-variant forms
  // are a later chunk (MAG-46-18).
  const positionals = args.positionals;
  const ref =
    Array.isArray(positionals) && typeof positionals[0] === "string"
      ? positionals[0]
      : "";
  if (ref === "") {
    throw new UsageError("init requires a task ref");
  }

  // §3.5 — one of `--title`/`--doc` is required; caught before any branch
  // or doc creation is attempted.
  const title = typeof args.title === "string" ? args.title : undefined;
  const doc = typeof args.doc === "string" ? args.doc : undefined;
  if (title === undefined && doc === undefined) {
    throw new UsageError("one of `--title`/`--doc` is required");
  }

  // `git.fetch()` runs first, once, before any derivation (§1.1).
  await tools.git.fetch();

  const currentBranch = await tools.git.currentBranch();

  // §3.3 — work in progress with no `--wip` instruction is a hard,
  // unconditional block: the pre-existing branch's state is left untouched.
  const dirty = await tools.git.isDirty();
  if (dirty) {
    return refuse(
      ref,
      "There is work in progress and no `--wip` instruction was given",
    );
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

  const { taskDocPath } = await scaffoldTaskDoc(tools, ref, title);

  // By the time `init` runs, the design workflow that produced the doc(s)
  // just written is already finished — queuing them up is purely
  // mechanical, so `init` commits and pushes them itself rather than
  // leaving that as a manual step for every single task.
  const commitTitle = `${ref}: ${title ?? "New task"}`;
  const commitMessage = `Task doc: ${taskDocPath}`;
  await tools.git.commitAll(commitTitle, commitMessage);
  await tools.git.push(canonicalBranch);

  return {
    success: true,
    messages: [
      `Current branch \`${currentBranch}\` - ref: ${ref}`,
      `New task \`${ref}\` initialised on \`${canonicalBranch}\``,
      `Task doc: ${taskDocPath}`,
      `Committed and pushed \`${canonicalBranch}\``,
    ],
    ref,
    canonicalBranch,
    taskDocPath,
    specDocPaths: [],
    wipCarriedForward: false,
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
  };
}
