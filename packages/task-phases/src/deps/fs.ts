import type { TaskPhasesConfig } from "../types.js";

/**
 * Concrete shape of `FileSystemTool` (task-phasing-lld.md §2's
 * `ExternalTools.fileSystem`, detailed in §4.10). Used by `lib/task-doc.ts`
 * and `init` — never by any git-mutating path.
 *
 * `RealFileSystemTool` below is a placeholder only: every method throws.
 * Real implementations land with the chunk that owns them (MAG-46-02).
 */
export interface FileSystemTool {
  /** Locates and parses the nearest `.task-phases.json` walking up from
   * cwd to the repo root. */
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
  loadConfig(): Promise<TaskPhasesConfig> {
    throw new Error("not implemented");
  }

  exists(_path: string): Promise<boolean> {
    throw new Error("not implemented");
  }

  readFile(_path: string): Promise<string> {
    throw new Error("not implemented");
  }

  writeFile(_path: string, _content: string): Promise<void> {
    throw new Error("not implemented");
  }

  copyFile(_src: string, _dest: string): Promise<void> {
    throw new Error("not implemented");
  }

  mkdir(_path: string): Promise<void> {
    throw new Error("not implemented");
  }

  readDir(_path: string): Promise<string[]> {
    throw new Error("not implemented");
  }
}
