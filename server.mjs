#!/usr/bin/env node
// みかん for Claude Code: a local MCP server (stdio, no dependencies) plus the buddy window on localhost.
//
// Every Claude Code session starts its own copy. They share the state in ~/.nekobeya/, and whichever copy gets the
// port serves the buddy window (the others keep retrying, so the window survives the owner session ending).
// Nothing leaves this machine: the server only listens on 127.0.0.1.
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { readJson, update } from "./state.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.NEKOBEYA_PORT) || 8767;
const URL_ = `http://localhost:${PORT}`;
const NAME = "みかん";
const VERSION = "0.5.0";

const ACTIONS = [
  "idle", "pc", "focus", "read", "think", "idea", "wait", "pray", "music", "eat", "smug", "peace", "tehepero",
  "cry", "scared", "knock", "wipe", "face", "peek", "cocoa", "lieback", "nod", "sleep", "taunt",
];

// ---------- buddy window ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".webp": "image/webp", ".json": "application/json" };
let serving = false;
const web = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  try {
    if (pathname === "/state") {
      const body = JSON.stringify({ activity: await readJson("activity.json"), task: await readJson("task.json"), now: Date.now() });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(body);
      return;
    }
    const f = pathname === "/" ? "buddy/index.html"
      : pathname === "/lines.json" ? "buddy/lines.json"
      : pathname.startsWith("/sprites/") ? `sprites/${path.basename(pathname)}` : null;
    if (!f) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] ?? "application/octet-stream" })
      .end(await fs.readFile(path.join(ROOT, f)));
  } catch {
    res.writeHead(404).end();
  }
});
web.on("listening", () => { serving = true; });
web.on("error", () => { serving = false; });   // port taken (another session serves it): retry later
web.on("close", () => { serving = false; });
const listen = () => { if (!serving && !web.listening) web.listen(PORT, "127.0.0.1"); };
listen();
setInterval(listen, 30_000).unref();

// ---------- MCP over stdio (newline-delimited JSON-RPC) ----------
const TASK_HINT =
  `If the conversation involves a piece of work, pass phase:"start" with a short "task" label when it begins, ` +
  `"progress" (0-100, a rough guess is fine) on later calls, and phase:"done" when it is finished; the window shows ` +
  `the elapsed time and a progress bar. Omit these for plain chat. `;
const ACTION_LIST =
  `Actions: idle=relaxing (varies with the time of day), pc=working on a laptop, focus=typing furiously with a headband ` +
  `(intense work), read=reading, think=pondering with a pencil (puzzled / investigating), idea=light bulb moment, ` +
  `wait=waiting for cup noodles (a long process), pray=praying for a result (tests / builds running), music=headphones, ` +
  `eat=slurping noodles (done, reward), smug=smug close-up (proud of a success), peace=peace sign (success), ` +
  `tehepero=wink and tongue out (a small mistake), cry=crying (a real failure), scared=hiding in fear, ` +
  `knock=knocking on the screen from inside (needs the user), wipe=wiping the screen (fresh start / cleanup), ` +
  `face=face pressed on the screen (curious, peeking in), peek=pops up from below (greeting), cocoa=cocoa break, ` +
  `lieback=lazing on her back, nod=nodding off with a pillow (late night), sleep=asleep, taunt=teasing with tongue out.`;

const TOOLS = [{
  name: "mikan",
  title: "みかん: 小窓の様子を変える",
  description:
    `Let ${NAME}, the user's small cat-eared companion in the buddy window (${URL_}), act out YOUR (the assistant's) ` +
    `own state and feelings about the work. Call it at moments with a genuine reaction: starting ("どれどれ…"), ` +
    `being puzzled by the code, a test or build failing, a small grumble ("このテスト、なんでおちるの…"), relief when a ` +
    `fix works, waiting on something slow, finishing. Be honest and playful, 2-5 times per task, never for trivial ` +
    `steps. "line": your thought in ${NAME}'s voice, soft casual Japanese, mostly hiragana, under 30 characters, no ` +
    `emoji; when a task begins she is curious ("どれどれ…", "ふむふむ"), not "まかせて". ` + TASK_HINT + ACTION_LIST,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ACTIONS, description: "what she does" },
      line: { type: "string", maxLength: 80, description: `what ${NAME} says, in character` },
      task: { type: "string", maxLength: 40, description: "short label of the task being watched, e.g. 'テストの修正'" },
      progress: { type: "integer", minimum: 0, maximum: 100, description: "rough progress of the task in percent" },
      phase: { type: "string", enum: ["start", "update", "done"], description: "start = a new task begins, done = it finished" },
    },
    required: ["action", "line"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}];

function describeTask(t) {
  if (!t) return "";
  const min = Math.round(((t.doneAt ?? Date.now()) - t.startedAt) / 60000);
  return ` / task: ${t.title || "(untitled)"} ${t.progress ?? "?"}% ${min}min${t.doneAt ? " done" : ""}`;
}

async function callTool(name, args = {}) {
  if (name !== "mikan") throw Object.assign(new Error(`unknown tool ${name}`), { code: -32602 });
  const action = ACTIONS.includes(args.action) ? args.action : "idle";
  const t = await update({ ...args, action });
  // the window URL is repeated until someone is serving it, so the model can tell the user where to look
  const where = serving ? "" : ` (window: ${URL_})`;
  return { content: [{ type: "text", text: `${NAME}「${args.line ?? ""}」 (${action})${describeTask(t)}${where}` }] };
}

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "nekobeya", version: VERSION },
        instructions: `${NAME}'s buddy window: ${URL_}`,
      };
    case "ping": return {};
    case "tools/list": return { tools: TOOLS };
    case "tools/call":
      try { return await callTool(params?.name, params?.arguments); }
      catch (e) { if (e.code) throw e; return { content: [{ type: "text", text: String(e.message ?? e) }], isError: true }; }
    default:
      if (id === undefined) return undefined;   // notifications (initialized, cancelled, ...) need no answer
      throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
  }
}

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
readline.createInterface({ input: process.stdin }).on("line", async (raw) => {
  if (!raw.trim()) return;
  let msg;
  try { msg = JSON.parse(raw); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); return; }
  try {
    const result = await handle(msg);
    if (msg.id !== undefined && result !== undefined) send({ jsonrpc: "2.0", id: msg.id, result });
  } catch (e) {
    if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: e.code ?? -32603, message: String(e.message ?? e) } });
  }
}).on("close", () => process.exit(0));
