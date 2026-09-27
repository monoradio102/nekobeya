// Shared state in ~/.nekobeya/ (task.json, activity.json), written by the MCP server and the hooks alike.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DATA = process.env.NEKOBEYA_HOME || path.join(os.homedir(), ".nekobeya");

const file = (f) => path.join(DATA, f);
export async function readJson(f) {
  try { return JSON.parse(await fs.readFile(file(f), "utf-8")); } catch { return null; }
}
export async function writeJson(f, v) {
  await fs.mkdir(DATA, { recursive: true });
  const tmp = file(`${f}.${process.pid}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(v));
  await fs.rename(tmp, file(f));   // atomic, so the buddy window never reads half a file
}

// the task she is keeping an eye on: what, since when, how far. An empty line lets the window pick one from her bank.
export async function update({ action, line, task, progress, phase }) {
  const now = Date.now();
  let cur = await readJson("task.json");
  phase ??= progress != null || task ? (cur && !cur.doneAt ? "update" : "start") : undefined;
  if (phase) {
    if (phase === "start" || !cur) cur = { title: "", startedAt: now, progress: null, doneAt: null };
    if (task) cur.title = String(task).slice(0, 40);
    if (progress != null) cur.progress = Math.max(0, Math.min(100, Math.round(progress)));
    if (phase === "done") { cur.progress = 100; cur.doneAt = now; }
    cur.updatedAt = now;   // the window treats a long silence as "probably finished" (the model may forget "done")
    await writeJson("task.json", cur);
  }
  await writeJson("activity.json", { action, line: String(line ?? "").slice(0, 80), phase: phase ?? null, at: now });
  return cur;
}
