import { UsageError } from "../errors.js";
import type { ExternalTools, InitCommandResult } from "../types.js";

/** `pnpm task init <ref> [--quick] [--title <title>] [--json]` — see
 * task-phasing-lld.md §3.8. Implements spec 05: the happy path of both
 * branch-creation routes (normal -> `spec/{ref}`, `--quick` ->
 * `task/{ref}`), each scaffolding `docs/tasks/{ref}/task-{ref}.md` from the
 * template with `${ref}`/`${title}` substituted, plus the pre-flight blocks
 * that must pass before any branch is created: a dirty worktree with no
 * `--wip` (unconditional, §3.14), `main` behind `origin/main`, and a
 * missing `--title`/`--doc` (invalid argument, exit 2).
 *
 * The `--doc`/`--specs` conveniences, `--wip`-carried-forward, and the
 * existing-doc/reusable-branch decision tree land with MAG-46-18. */

/** Joins path parts with `/`, tolerating trailing slashes on earlier parts
 * and empty parts — keeps the paths handed to `FileSystemTool` stable
 * regardless of host platform. */
function joinPath(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/\/+$/, ""))
    .filter((part) => part.length > 0)
    .join("/");
}

/** Expands a config path pattern, substituting `${ref}` with the task ref. */
function expand(pattern: string, ref: string): string {
  return pattern.replace(/\$\{ref\}/g, ref);
}

/** The task doc is a markdown file by construction — every LLD §3.8.1
 * example writes `task-{ref}.md`. The config's `taskDocName` pattern may
 * or may not carry the extension itself (`task-${ref}` vs
 * `task-${ref}.md`); guarantee the `.md` suffix either way. */
function ensureMarkdown(name: string): string {
  return name.endsWith(".md") ? name : `${name}.md`;
}

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

  // Scaffold the task doc from the template. The layout comes from the
  // `.task-phases.json` config (docs at `docs/tasks/`, task dir named after
  // the ref, task doc `task-{ref}.md` inside it).
  const config = await tools.fileSystem.loadConfig();

  const docsDir = config.tasks.docs ?? "docs/tasks/";
  const taskDirName = expand(config.tasks.dirName ?? "task-${ref}", ref);
  const taskDocName = ensureMarkdown(expand(config.tasks.taskDocName ?? "task-${ref}", ref));

  const taskDirPath = joinPath(docsDir, taskDirName);
  const taskDocPath = joinPath(taskDirPath, taskDocName);

  if (!(await tools.fileSystem.exists(taskDirPath))) {
    await tools.fileSystem.mkdir(taskDirPath);
  }

  const templatePath = config.templates.task;
  const template = await tools.fileSystem.readFile(templatePath);
  const content = template
    .replace(/\$\{ref\}/g, ref)
    .replace(/\$\{title\}/g, title ?? "");

  await tools.fileSystem.writeFile(taskDocPath, content);

  return {
    success: true,
    messages: [
      `Current branch \`${currentBranch}\` - ref: ${ref}`,
      `New task \`${ref}\` initialised on \`${canonicalBranch}\``,
      `Task doc: ${taskDocPath}`,
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
