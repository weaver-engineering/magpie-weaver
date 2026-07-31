import { existsSync } from "node:fs";
import {
  copyFile as fsCopyFile,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  readdir as fsReaddir,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { TaskPhasesConfig } from "../types.js";

/**
 * Concrete shape of `FileSystemTool` (task-phasing-lld.md §2's
 * `ExternalTools.fileSystem`, detailed in §4.10). Used by `lib/task-doc.ts`
 * and `init` — never by any git-mutating path.
 *
 * All methods resolve relative paths against `cwd` (defaulting to
 * `process.cwd()`), so every call operates on the caller's current working
 * directory, never relative to wherever `task-phases` itself is installed
 * (task-MAG-46-dev-testing-cli-design.md §6).
 */
export interface FileSystemTool {
  /** Locates and parses the nearest `.task-phases.json` walking up from
   * cwd to the filesystem root. Throws (a raw wrapper result) when none
   * exists — graceful-degradation-to-defaults is `init`'s concern
   * (MAG-46-18). */
  loadConfig(): Promise<TaskPhasesConfig>;

  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;

  /** Copies `src` to `dest`, creating parent directories as needed. */
  copyFile(src: string, dest: string): Promise<void>;

  /** Creates `path` (and parents) if it doesn't already exist. */
  mkdir(path: string): Promise<void>;

  /** Lists entries directly under `path`. */
  readDir(path: string): Promise<string[]>;
}

export class RealFileSystemTool implements FileSystemTool {
  private cwd: string;

  /**
   * @param cwd Working directory that relative paths resolve against.
   * Defaults to `process.cwd()`.
   */
  constructor(cwd?: string) {
    this.cwd = cwd ?? process.cwd();
  }

  async loadConfig(): Promise<TaskPhasesConfig> {
    const config = await this.findConfig();
    if (config === null) {
      throw new Error(
        `No .task-phases.json found from "${this.cwd}" up to the filesystem root`,
      );
    }
    return config;
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(resolve(this.cwd, path));
  }

  async readFile(path: string): Promise<string> {
    return fsReadFile(resolve(this.cwd, path), "utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    await fsWriteFile(resolve(this.cwd, path), content, "utf-8");
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const destResolved = resolve(this.cwd, dest);
    await fsMkdir(dirname(destResolved), { recursive: true });
    await fsCopyFile(resolve(this.cwd, src), destResolved);
  }

  async mkdir(path: string): Promise<void> {
    await fsMkdir(resolve(this.cwd, path), { recursive: true });
  }

  async readDir(path: string): Promise<string[]> {
    return fsReaddir(resolve(this.cwd, path));
  }

  /** Walk up from `cwd` looking for the nearest `.task-phases.json`,
   * continuing all the way to the filesystem root — the search is NOT
   * bounded to the git repo, so a config file can legitimately live above
   * the repo root (amended spec §3.3.1). Returns `null` when no config
   * file exists anywhere from cwd up to the filesystem root. */
  private async findConfig(): Promise<TaskPhasesConfig | null> {
    let dir = this.cwd;
    while (true) {
      const candidate = join(dir, ".task-phases.json");
      if (existsSync(candidate)) {
        const raw = await fsReadFile(candidate, "utf-8");
        return JSON.parse(raw) as TaskPhasesConfig;
      }
      const parent = dirname(dir);
      if (parent === dir) {
        return null;
      }
      dir = parent;
    }
  }
}
