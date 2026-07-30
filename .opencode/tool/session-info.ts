import { tool } from "@opencode-ai/plugin";

export default tool({
  description:
    "Returns this session's real sessionId. Call this before writing the final JSON report (§6) — never invent or copy a placeholder sessionId.",
  args: {},
  async execute(_args, context) {
    return {
      title: `sessionId: ${context.sessionID}`,
      output: context.sessionID,
      metadata: { sessionId: context.sessionID },
    };
  },
});
