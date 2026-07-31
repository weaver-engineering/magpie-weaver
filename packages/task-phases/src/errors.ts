/** An invalid CLI argument — thrown by a command handler before any command
 * logic runs, mapped by `cli.ts`'s `dispatch` to exit code 2 (LLD §4.1's
 * "invalid argument" bucket, distinct from a command that ran and failed).
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}
