import type { ExternalTools, TaskPhasesConfig } from "../types.js";

/**
 * `task-{ref}.md` scaffolding — see task-phasing-lld.md §4.6. Extracted
 * from `init.ts` (spec 05), which was the first command to need it;
 * `wip`/`promote` (MAG-46-07/10) need the same doc-path resolution, not a
 * fork of it. The new-chunk `--specs` import path lands with MAG-46-18,
 * extending `scaffoldTaskDoc()` with the copy-instead-of-template paths
 * (LLD §3.8/§4.6): `--doc <path>` copies a given doc in as the task doc,
 * `--specs <path>...` copies each given path in as a spec doc, and a
 * missing `.task-phases.json` warns and falls back to every documented
 * default rather than failing `init` (§3.8).
 */

/** Every documented default from LLD §2's `TaskPhasesConfig`, used when no
 * `.task-phases.json` can be loaded — a missing config file is never a hard
 * blocker to running `init` (§3.8). `templates.task` is required by the
 * interface but has no documented default; `templates/task-template.md`
 * matches the convention every real config and test fixture uses. */
const DEFAULT_CONFIG: TaskPhasesConfig = {
  templates: { task: "templates/task-template.md" },
  tasks: {
    docs: "docs/tasks/",
    dirName: "task-${ref}",
    taskDocName: "task-${ref}",
    specDocNames: "task-${ref}-${nn}-spec.md",
  },
};

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

/** Expands a spec-doc name pattern, substituting `${ref}` with the task ref
 * and `${nn}` with the zero-padded (two-digit) 1-based spec index — LLD
 * §3.8.1's `spec-1-scaffolding.md -> task-AAA-001-01-spec.md` numbering. */
function expandSpecDocName(pattern: string, ref: string, nn: number): string {
  return expand(pattern, ref).replace(/\$\{nn\}/g, String(nn).padStart(2, "0"));
}

/** The task doc is a markdown file by construction — every LLD §3.8.1
 * example writes `task-{ref}.md`. The config's `taskDocName` pattern may
 * or may not carry the extension itself (`task-${ref}` vs
 * `task-${ref}.md`); guarantee the `.md` suffix either way. */
function ensureMarkdown(name: string): string {
  return name.endsWith(".md") ? name : `${name}.md`;
}

/** Loads the `.task-phases.json` config, falling back to every documented
 * default (LLD §2) with a warning when none can be found. The failure is
 * surfaced — the warning names the config file — never silently swallowed
 * (§3.8). */
async function loadConfigOrDefault(
  tools: ExternalTools,
  warnings: string[],
): Promise<TaskPhasesConfig> {
  try {
    return await tools.fileSystem.loadConfig();
  } catch {
    warnings.push("No .task-phases.json found; using documented defaults");
    return DEFAULT_CONFIG;
  }
}

/** Scaffolds `docs/tasks/{ref}/task-{ref}.md` for a new task, creating the
 * task directory first if it doesn't already exist. Layout comes from the
 * `.task-phases.json` config (docs at `docs/tasks/`, task dir named after
 * the ref, task doc `task-{ref}.md` inside it, by default).
 *
 * The task doc is produced by one of two mutually exclusive paths (LLD
 * §3.8), both gated on the doc not already existing:
 *   - `--doc <path>` (MAG-46-18): the given path is copied in as the task
 *     doc. A path that doesn't exist warns and falls back to the template
 *     scaffolding below when `--title` is also given (§3.8).
 *   - otherwise, with `--title`: the configured template is copied in with
 *     `${ref}`/`${title}` substituted.
 *
 * `--specs <path>...` (MAG-46-18) additionally copies each given path in
 * as a spec doc with the `task-{ref}-{nn}-spec.md` naming convention —
 * independently of the task-doc step, and one copy failure never aborts
 * the rest of the loop (§3.8): each failure warns and continues.
 *
 * **Never overwrites an existing task doc** (LLD §3.8: "if `--title` is
 * given and the task doc does not exist -> copy task template..." — the
 * existence check is part of the original condition, not an addition).
 * A ref whose `spec/{ref}` branch was cleared down after its own cycle
 * (rather than reused, LLD §3.14/MAG-46-18) still has its task doc's real
 * history sitting on `main` — `init` recreating the branch must not
 * silently replace that with a blank template. Returns `written: false`
 * and leaves the file untouched when it already exists. */
export async function scaffoldTaskDoc(
  tools: ExternalTools,
  ref: string,
  title: string | undefined,
  opts: { doc?: string; specs?: string[] } = {},
): Promise<{
  taskDocPath: string;
  written: boolean;
  specDocPaths: string[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const config = await loadConfigOrDefault(tools, warnings);

  const docsDir = config.tasks.docs ?? "docs/tasks/";
  const taskDirName = expand(config.tasks.dirName ?? "task-${ref}", ref);
  const taskDocName = ensureMarkdown(expand(config.tasks.taskDocName ?? "task-${ref}", ref));

  const taskDirPath = joinPath(docsDir, taskDirName);
  const taskDocPath = joinPath(taskDirPath, taskDocName);

  if (!(await tools.fileSystem.exists(taskDirPath))) {
    await tools.fileSystem.mkdir(taskDirPath);
  }

  let written = false;
  const taskDocExists = await tools.fileSystem.exists(taskDocPath);
  if (!taskDocExists) {
    if (opts.doc !== undefined) {
      if (await tools.fileSystem.exists(opts.doc)) {
        // --doc happy path: the given doc is copied in as the task doc,
        // taking precedence over the template scaffolding (§3.8).
        await tools.fileSystem.copyFile(opts.doc, taskDocPath);
        written = true;
      } else {
        // §3.8 graceful degradation: a bad --doc path warns and continues —
        // the template fallback below runs when --title is also given.
        warnings.push(`--doc path does not exist, falling back to template: ${opts.doc}`);
      }
    }
    if (!written && title !== undefined) {
      const templatePath = config.templates.task;
      const template = await tools.fileSystem.readFile(templatePath);
      const content = template
        .replace(/\$\{ref\}/g, ref)
        .replace(/\$\{title\}/g, title ?? "");

      await tools.fileSystem.writeFile(taskDocPath, content);
      written = true;
    }
  }

  // --specs: one copy per given path into the task dir with the
  // `task-{ref}-{nn}-spec.md` naming convention, numbered in the order
  // given (LLD §3.8/§3.8.1). Each path is copied independently — a source
  // that can't be copied (doesn't exist, etc.) warns and is skipped, never
  // aborting the rest of the loop (§3.8: these are helper conveniences, so
  // "warn and continue" beats failing the whole command over one path).
  const specDocPaths: string[] = [];
  if (opts.specs !== undefined) {
    const specDocPattern = config.tasks.specDocNames ?? "task-${ref}-${nn}-spec.md";
    for (const [index, specPath] of opts.specs.entries()) {
      const dest = joinPath(taskDirPath, expandSpecDocName(specDocPattern, ref, index + 1));
      try {
        await tools.fileSystem.copyFile(specPath, dest);
        specDocPaths.push(dest);
      } catch {
        warnings.push(`Could not copy spec \`${specPath}\`; skipping`);
      }
    }
  }

  return { taskDocPath, written, specDocPaths, warnings };
}
