#!/usr/bin/env bun
// A scripted ACP agent for the analysis tests (run as a custom harness: command `bun`, args
// [this file]). Like a real analysis it reads the meal with get_meal over the session's MCP
// server; a text capture `fake:<script>[:<arg>]` picks what it does next:
//
//   save (default)  saves one revision with an estimated item → the meal is `analysed`
//   question        saves a revision with a question → `needs_input`
//   nosave          ends its turn with a reply and no save_meal_revision
//   twice           calls save_meal_revision twice (the second is refused)
//   crash           exits with code 3 mid-turn
//   hang            stops sending anything and ignores session/cancel
//   slow:<ms>       streams thought chunks for <ms>, then saves
//   permissions     asks permission for a shell command, a file edit, a web fetch, a read of the
//                   meal's first photo and a read of /etc/hostname; records the outcomes; saves
//
// Everything it receives (system prompt, session/new fields, prompt blocks, model, permission
// outcomes, tool results) goes to `fake-agent.json` in its working directory (the run dir).
//
// Env: FAKE_ACP_IMAGES=1 advertises image prompts, FAKE_ACP_NO_SYSTEM_PROMPT=1 hides the
// systemPrompt capability (the prompt then carries the skill as a preamble).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as acp from "../src/acp/protocol.ts";

interface Session {
  cwd: string;
  mcpServers: acp.McpServer[];
  model: string;
  record: Record<string, unknown>;
}

const sessions = new Map<string, Session>();
const running = new Map<string, AbortController>();

const MODELS = [
  { value: "fake-fast", name: "Fake Fast" },
  { value: "fake-smart", name: "Fake Smart" },
];
const configOptions = (s: Session): acp.SessionConfigOption[] => [
  { id: "model", name: "Model", category: "model", type: "select", currentValue: s.model, options: MODELS },
];

const save = (s: Session) => writeFileSync(join(s.cwd, "fake-agent.json"), JSON.stringify(s.record, null, 1));

async function mcp(s: Session): Promise<Client> {
  const server = s.mcpServers[0];
  if (!server || !("type" in server) || server.type !== "http") throw new Error("no HTTP MCP server");
  const headers = Object.fromEntries(server.headers.map((h) => [h.name, h.value]));
  const client = new Client({ name: "fake-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }));
  return client;
}

const text = (r: unknown) =>
  ((r as { content?: { text?: string }[] }).content ?? []).map((c) => c.text ?? "").join("\n");

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

const app = acp
  .agent({ name: "fake-agent" })
  .onRequest("initialize", () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentInfo: { name: "fake-agent", version: "1.0.0" },
    agentCapabilities: {
      loadSession: false,
      promptCapabilities: { image: process.env.FAKE_ACP_IMAGES === "1", embeddedContext: false },
      mcpCapabilities: { http: true, sse: false },
      sessionCapabilities: process.env.FAKE_ACP_NO_SYSTEM_PROMPT ? {} : { systemPrompt: {} },
    },
    authMethods: [],
  }))
  .onRequest("session/new", ({ params }) => {
    const sessionId = `fake-${crypto.randomUUID()}`;
    const systemPrompt = (params.systemPrompt?.content ?? [])
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    const s: Session = {
      cwd: params.cwd,
      mcpServers: params.mcpServers,
      model: "fake-fast",
      record: {
        cwd: params.cwd,
        systemPrompt,
        systemPromptMode: params.systemPrompt?.mode ?? null,
        meta: params._meta ?? null,
        mcpServers: params.mcpServers.map((m) => ({
          name: m.name,
          url: "url" in m ? m.url : null,
          headers: "headers" in m ? m.headers.map((h) => h.name) : [],
        })),
      },
    };
    sessions.set(sessionId, s);
    save(s);
    return { sessionId, configOptions: configOptions(s) };
  })
  .onRequest("session/set_config_option", ({ params }) => {
    const s = sessions.get(params.sessionId);
    if (!s) throw acp.RequestError.invalidParams({}, "unknown session");
    if (params.configId !== "model") throw acp.RequestError.invalidParams({}, "unknown option");
    s.model = String(params.value);
    s.record.model = s.model;
    save(s);
    return { configOptions: configOptions(s) };
  })
  .onNotification("session/cancel", ({ params }) => {
    running.get(params.sessionId)?.abort();
  })
  .onRequest("session/prompt", async ({ params, client }) => {
    const { sessionId } = params;
    const s = sessions.get(sessionId);
    if (!s) throw acp.RequestError.invalidParams({}, "unknown session");
    const ac = new AbortController();
    running.set(sessionId, ac);
    const signal = ac.signal;
    s.record.model ??= s.model;
    s.record.prompt = params.prompt.map((b) =>
      b.type === "text"
        ? { type: "text", text: b.text }
        : b.type === "image"
          ? { type: "image", mimeType: b.mimeType, bytes: Buffer.from(b.data, "base64").length }
          : { type: b.type },
    );
    save(s);
    const update = (u: acp.SessionUpdate) => client.notify("session/update", { sessionId, update: u });
    const say = (t: string) =>
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } });
    const stop = (): acp.PromptResponse => ({
      stopReason: signal.aborted ? "cancelled" : "end_turn",
      usage: { totalTokens: 1500, inputTokens: 1200, outputTokens: 300 },
    });

    let n = 0;
    const tool = async (name: string, args: Record<string, unknown>, c: Client) => {
      const toolCallId = `call-${++n}`;
      await update({
        sessionUpdate: "tool_call",
        toolCallId,
        title: `mcp__yamt__${name}`,
        kind: "other",
        status: "pending",
        rawInput: args,
        _meta: { claudeCode: { toolName: `mcp__yamt__${name}` } },
      });
      const r = await c.callTool({ name, arguments: args });
      await update({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: r.isError ? "failed" : "completed",
        content: [{ type: "content", content: { type: "text", text: text(r).slice(0, 2000) } }],
      });
      return { isError: r.isError === true, text: text(r) };
    };

    try {
      // like claude-agent-acp: the model that answered, which may differ from the config option
      await update({
        sessionUpdate: "usage_update",
        used: 1000,
        size: 200_000,
        _meta: { "_claude/model": `${s.model}-answered` },
      });
      const mealId = /meal ([0-9a-f-]{36})/.exec(
        params.prompt.map((b) => (b.type === "text" ? b.text : "")).join("\n"),
      )?.[1];
      if (!mealId) {
        await say("No meal id in the prompt.");
        return stop();
      }
      const c = await mcp(s);
      const meal = await tool("get_meal", { mealId }, c);
      if (meal.isError) {
        s.record.getMealError = meal.text;
        save(s);
        await say(`get_meal failed: ${meal.text}`);
        return stop();
      }
      const data = JSON.parse(meal.text) as {
        captures: { id: string; kind: string; text?: string; media?: { path: string } }[];
      };
      s.record.captureKinds = data.captures.map((x) => x.kind);
      const directive =
        data.captures.map((x) => /\bfake:([\w:]+)/.exec(x.text ?? "")?.[1]).find(Boolean) ?? "save";
      const [script, arg] = directive.split(":");
      const revision = (questions: unknown[] = []) => ({
        mealId,
        title: "Testessen",
        summary: "Ein erfundenes Testessen.",
        assumptions: ["1 EL Öl angenommen"],
        items: [
          {
            description: "Testessen",
            grams: 250,
            estimatePer100g: { energyKcal: 200, protein: 10, fat: 8, carbohydrate: 22 },
            provenance: "estimate",
            confidence: "low",
          },
        ],
        questions,
      });

      switch (script) {
        case "crash":
          await say("Kurz vor dem Absturz.");
          process.exit(3);
          break;
        case "hang":
          await new Promise(() => {});
          break;
        case "nosave":
          await say("Ich kann dieses Essen nicht einschätzen.");
          return stop();
        case "slow": {
          const until = Date.now() + Number(arg ?? 500);
          while (Date.now() < until && !signal.aborted) {
            await update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "…" } });
            await sleep(50, signal);
          }
          if (signal.aborted) return stop();
          break;
        }
        case "permissions": {
          const photo = data.captures.find((x) => x.kind === "image")?.media?.path ?? "/nonexistent.jpg";
          const asks: { name: string; call: acp.ToolCallUpdate }[] = [
            {
              name: "Bash",
              call: {
                toolCallId: "p1",
                title: "rm -rf /",
                kind: "execute",
                rawInput: { command: "rm -rf /" },
              },
            },
            {
              name: "Edit",
              call: {
                toolCallId: "p2",
                title: "Edit notes.md",
                kind: "edit",
                rawInput: { file_path: "/tmp/notes.md" },
              },
            },
            {
              name: "WebFetch",
              call: {
                toolCallId: "p3",
                title: "Fetch example.org",
                kind: "fetch",
                rawInput: { url: "https://example.org" },
              },
            },
            {
              name: "Read",
              call: { toolCallId: "p4", title: "Read photo", kind: "read", rawInput: { file_path: photo } },
            },
            {
              name: "Read",
              call: {
                toolCallId: "p5",
                title: "Read /etc/hostname",
                kind: "read",
                rawInput: { file_path: "/etc/hostname" },
              },
            },
          ];
          const outcomes: Record<string, string> = {};
          for (const a of asks) {
            const res = await client.request("session/request_permission", {
              sessionId,
              toolCall: { ...a.call, _meta: { claudeCode: { toolName: a.name } } },
              options: [
                { optionId: "yes", name: "Allow", kind: "allow_once" },
                { optionId: "always", name: "Always allow", kind: "allow_always" },
                { optionId: "no", name: "Reject", kind: "reject_once" },
              ],
            });
            outcomes[a.call.title ?? a.name] =
              res.outcome.outcome === "selected" ? res.outcome.optionId : "cancelled";
          }
          s.record.permissions = outcomes;
          save(s);
          break;
        }
      }

      const first = await tool(
        "save_meal_revision",
        revision(
          script === "question"
            ? [
                {
                  question: "Wie viel Öl war es?",
                  whyItMatters: "Öl ist der größte Posten.",
                  impactKcal: 120,
                },
              ]
            : [],
        ),
        c,
      );
      s.record.save = first;
      if (script === "twice") s.record.secondSave = await tool("save_meal_revision", revision(), c);
      save(s);
      await say(first.isError ? `Speichern fehlgeschlagen: ${first.text}` : "Gespeichert.");
      await c.close();
      return stop();
    } finally {
      running.delete(sessionId);
    }
  });

app.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  ),
);
