import type { FunctionCatalog } from "./types.js";
import { init } from "./commands/init.js";
import { status } from "./commands/status.js";
import { list } from "./commands/list.js";
import { promote } from "./commands/promote.js";
import { wip } from "./commands/wip.js";
import { ref } from "./commands/task.js";

/** Subcommand name -> handler. `cli.ts` dispatches through this so adding a
 * new command means adding one file under `commands/` plus one entry here. */
export const commandRegistry: FunctionCatalog = {
  init,
  status,
  list,
  promote,
  wip,
  ref,
};
