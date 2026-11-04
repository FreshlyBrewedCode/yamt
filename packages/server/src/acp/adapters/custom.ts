import type { HarnessAdapter } from "./types.ts";
import { specSystemPrompt } from "./types.ts";

/**
 * Any ACP agent: command, args and env come from the config. Only spec features are used: the
 * system prompt goes in `systemPrompt` if the agent advertises it, else as a preamble block
 * before the prompt; the model through the session's `model` config option, if it offers one.
 * The MCP token stays in the server's header (there is no portable way to reference env vars).
 */
export const customAdapter: HarnessAdapter = {
  kind: "custom",
  defaultLaunch: () => null,
  modelViaMeta: false,
  sessionFields(ctx) {
    const systemPrompt = specSystemPrompt(ctx);
    return systemPrompt ? { systemPrompt } : {};
  },
  needsPromptPreamble: (ctx) =>
    !!ctx.systemPrompt.trim() && !ctx.capabilities.sessionCapabilities?.systemPrompt,
};
