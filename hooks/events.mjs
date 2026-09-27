#!/usr/bin/env node
// Moments Claude Code itself knows about, so みかん keeps up even when Claude forgets to call her:
// waiting for the user's approval, a failing test or build, the reply being finished (closes a task left open).
// Her words are left to Claude; an empty line lets the window pick one from her bank.
import { readJson, update, writeJson } from "../state.mjs";

// commands worth crying over when they fail (a grep that finds nothing is not)
const CHECK = /\b(test|tests|jest|vitest|mocha|pytest|tox|rspec|tsc|lint|eslint|build|make|cargo|go\s+(test|build|vet)|gradle|mvn|xcodebuild|swift\s+(build|test))\b/;

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const ev = JSON.parse(raw || "{}");
const task = await readJson("task.json");
const open = task && !task.doneAt;

switch (ev.hook_event_name) {
  case "PostToolUse":   // Claude called her: remember which session owns the task, so another session's Stop leaves it alone
    if (open && task.session !== ev.session_id) await writeJson("task.json", { ...task, session: ev.session_id });
    break;

  case "Notification":   // permission_prompt / elicitation_dialog (see the matcher in hooks.json)
    await update({ action: "knock", line: "" });
    break;

  case "PostToolUseFailure":
    if (!ev.is_interrupt && CHECK.test(String(ev.tool_input?.command ?? ""))) await update({ action: "cry", line: "" });
    break;

  case "StopFailure":   // the turn ended on an API error
    await update({ action: "cry", line: "うまくいかない…" });
    break;

  case "Stop": {
    if (open && (!task.session || task.session === ev.session_id)) {
      await update({ action: Math.random() < 0.5 ? "eat" : "cocoa", line: "", phase: "done" });
    } else if ((await readJson("activity.json"))?.action === "knock") {
      await update({ action: "idle", line: "" });   // the approval was given long ago; don't keep knocking
    }
    break;
  }
}
