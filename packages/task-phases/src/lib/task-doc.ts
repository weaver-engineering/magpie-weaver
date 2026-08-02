import type { ExternalTools } from "../types.js";

/**
 * `task-{ref}.md` scaffolding — see task-phasing-lld.md §4.6. Extracted
 * from `init.ts` (spec 05), which was the first command to need it;
 * `wip`/`promote` (MAG-46-07/10) need the same doc-path resolution, not a
 * fork of it. The new-chunk `--specs` import path is parked (§3.14,
 * MAG-46-18) — not part of this extraction, since `init.ts` never had it
 * either.
 */

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

/** Scaffolds `docs/tasks/{ref}/task-{ref}.md` from the configured
 * template, substituting `${ref}`/`${title}`, creating the task
 * directory first if it doesn't already exist. Layout comes from the
 * `.task-phases.json` config (docs at `docs/tasks/`, task dir named after
 * the ref, task doc `task-{ref}.md` inside it, by default). Returns the
 * path written. */
export async function scaffoldTaskDoc(
  tools: ExternalTools,
  ref: string,
  title: string | undefined,
): Promise<{ taskDocPath: string }> {
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

  return { taskDocPath };
}
