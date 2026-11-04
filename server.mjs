#!/usr/bin/env node
// みかん for Claude Code: a local MCP server (stdio, no dependencies) plus the buddy window on localhost.
//
// Every Claude Code session starts its own copy. They share the state in ~/.nekobeya/, and whichever copy gets the
// port serves the buddy window (the others keep retrying, so the window survives the owner session ending).
// Nothing leaves this machine: the server only listens on 127.0.0.1. The one exception is the optional voice (off by
// default): when the user turns it on, her lines go to the OpenAI-compatible TTS endpoint they configured.
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { readJson, writeJson, update } from "./state.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.NEKOBEYA_PORT) || 8767;
const URL_ = `http://localhost:${PORT}`;
const NAME = "みかん";
const VERSION = "0.8.0";

const ACTIONS = [
  "idle", "pc", "focus", "read", "think", "idea", "wait", "pray", "music", "eat", "smug", "peace", "tehepero",
  "cry", "scared", "knock", "wipe", "face", "peek", "cocoa", "lieback", "nod", "sleep", "taunt",
  // work scenes, one per kind of step
  "explore", "grep", "edit", "web", "download", "install", "plan", "subagent", "compact", "build", "test",
  "test_pass", "test_fail", "debug", "logs", "commit", "push", "conflict", "review", "deploy", "ci_wait", "approval",
  "question", "denied", "rate_limit", "timeout", "oom", "offline", "gpu_wait", "render", "imagegen", "morning",
  "late_night", "break", "report", "trophy", "git_pull", "typecheck",
];

// ---------- voice (optional) ----------
// The buddy page asks this server to read a line aloud; the server calls the TTS endpoint (POST {url}/audio/speech,
// the OpenAI API shape), so the endpoint needs no CORS. Settings live in ~/.nekobeya/settings.json; the key is write-only.
const VOICE_DEFAULTS = { enabled: false, url: "", voice: "", model: "tts-1", speed: 1, key: "" };
const voiceSettings = async () => ({ ...VOICE_DEFAULTS, ...(await readJson("settings.json"))?.voice });
const publicVoice = ({ key, ...v }) => ({ ...v, hasKey: !!key });

function mergeVoice(cur, v = {}) {
  const out = { ...cur }, str = (x, n) => String(x).trim().slice(0, n);
  if (typeof v.enabled === "boolean") out.enabled = v.enabled;
  if (typeof v.url === "string") {
    const url = str(v.url, 300);
    if (url && !/^https?:\/\//.test(url)) throw new Error("url must start with http:// or https://");
    out.url = url;
  }
  if (typeof v.voice === "string") out.voice = str(v.voice, 60);
  if (typeof v.model === "string") out.model = str(v.model, 60) || VOICE_DEFAULTS.model;
  if (typeof v.key === "string") out.key = str(v.key, 300);
  if (v.speed != null && Number.isFinite(+v.speed)) out.speed = Math.min(4, Math.max(0.25, +v.speed));
  return out;
}

// a streamed WAV may carry placeholder sizes; set them from what arrived so every decoder accepts it
function fixWav(b) {
  if (b.length < 44 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") return b;
  b.writeUInt32LE(b.length - 8, 4);
  for (let p = 12; p + 8 <= b.length;) {
    const id = b.toString("ascii", p, p + 4), n = b.readUInt32LE(p + 4);
    if (id === "data") { b.writeUInt32LE(b.length - p - 8, p + 4); break; }
    p += 8 + n + (n & 1);
  }
  return b;
}

async function speak(text) {
  const v = await voiceSettings();
  if (!v.enabled || !v.url) return { status: 409, error: "voice is off" };
  const r = await fetch(v.url.replace(/\/+$/, "") + "/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(v.key && { Authorization: `Bearer ${v.key}` }) },
    body: JSON.stringify({ model: v.model, input: text, voice: v.voice || "alloy", response_format: "wav", speed: v.speed }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) return { status: 502, error: `TTS answered ${r.status}` };
  return { status: 200, audio: fixWav(Buffer.from(await r.arrayBuffer())) };
}

// only the buddy page itself may change settings or make her speak: no other site (Origin), no rebinding (Host),
// and a JSON body, which a cross-site form cannot send without a CORS preflight this server never answers
const fromPage = (req) => /^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host ?? "")
  && (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`)
  && /^application\/json\b/.test(req.headers["content-type"] ?? "");
async function readBody(req, max = 8192) {
  let s = "";
  for await (const c of req) { s += c; if (s.length > max) throw new Error("body too large"); }
  return JSON.parse(s || "{}");
}
const json = (res, status, obj) => res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(obj));

// ---------- buddy window ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".webp": "image/webp", ".json": "application/json" };
let serving = false;
const web = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  try {
    if (pathname === "/state") {
      json(res, 200, { activity: await readJson("activity.json"), task: await readJson("task.json"), voice: (await voiceSettings()).enabled, now: Date.now() });
      return;
    }
    if (pathname === "/settings" && req.method === "GET") { json(res, 200, { voice: publicVoice(await voiceSettings()) }); return; }
    if ((pathname === "/settings" || pathname === "/speak") && req.method === "POST") {
      if (!fromPage(req)) { json(res, 403, { error: "forbidden" }); return; }
      let b;
      try { b = await readBody(req); } catch (e) { json(res, 400, { error: String(e.message) }); return; }
      if (pathname === "/settings") {
        let voice;
        try { voice = mergeVoice(await voiceSettings(), b.voice); } catch (e) { json(res, 400, { error: e.message }); return; }
        await writeJson("settings.json", { ...(await readJson("settings.json")), voice });
        json(res, 200, { voice: publicVoice(voice) });
        return;
      }
      const text = String(b.text ?? "").trim().slice(0, 200);
      if (!text) { json(res, 400, { error: "text is empty" }); return; }
      let r;
      try { r = await speak(text); } catch (e) { r = { status: 502, error: `TTS unreachable (${e.name})` }; }
      if (r.audio) res.writeHead(200, { "Content-Type": "audio/wav", "Cache-Control": "no-store" }).end(r.audio);
      else json(res, r.status, { error: r.error });
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
  `lieback=lazing on her back, nod=nodding off with a pillow (late night), sleep=asleep, taunt=teasing with tongue out. ` +
  `Work scenes (a prop shows the kind of step): explore=digging through papers (looking around files), ` +
  `grep=magnifying glass over a map (searching), edit=red pen on a manuscript, web=reading a big book (web research), ` +
  `download=hugging a parcel, install=opening a box of parts, plan=flowchart on a whiteboard, ` +
  `subagent=commanding tiny clones (delegating), compact=squeezing papers into a box, build=hard hat and wrench, ` +
  `test=shaking a test tube, test_pass=party cracker, test_fail=burnt afro after an explosion, debug=chasing a bug ` +
  `with a net, logs=reading a long scroll, commit=pressing a seal stamp, push=throwing a paper plane, ` +
  `conflict=tug of war, review=glasses and a checklist, deploy=launch button and rocket, ci_wait=waiting at a yellow ` +
  `light, approval="いい？" sign (asking permission), question="？" sign, denied=shield with an X, rate_limit=waiting ` +
  `in a queue, timeout=panicking with an hourglass, oom=crushed under boxes (out of memory), offline=broken cable, ` +
  `gpu_wait=toasting a marshmallow, render=film projector, imagegen=painting canvases, morning=stretching awake, ` +
  `late_night=nightcap and coffee, break=tea and dango, report=salute (reporting done), trophy=golden trophy (a big ` +
  `success), git_pull=pulling in parcels on a rope, typecheck=shape-sorter blocks.`;

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
