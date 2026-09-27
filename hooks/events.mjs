#!/usr/bin/env node
// Moments Claude Code itself knows about, so みかん keeps up even when Claude forgets to call her (or before it can):
// the user's message arriving, tests or builds running, waiting for approval, the reply being finished, and so on.
// Her words are left to Claude; an empty line lets the window pick one from her bank.
import { readJson, update, writeJson } from "../state.mjs";

// commands worth praying over, and crying over when they fail (a grep that finds nothing is not)
const CHECK = /\b(test|tests|jest|vitest|mocha|pytest|tox|rspec|tsc|lint|eslint|build|make|cargo|go\s+(test|build|vet)|gradle|mvn|xcodebuild|swift\s+(build|test))\b/;
// Claude often calls her alongside a tool; its own reaction wins over the hook's for this long
const CLAUDE_SPOKE_MS = 5000;

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const ev = JSON.parse(raw || "{}");
const task = await readJson("task.json");
const act = await readJson("activity.json");
const open = task && !task.doneAt;
const mine = open && (!task.session || task.session === ev.session_id);   // another session's task is left alone
const claudeJustSpoke = act && act.by !== "hook" && Date.now() - act.at < CLAUDE_SPOKE_MS;
const isCheck = CHECK.test(String(ev.tool_input?.command ?? ""));
const move = (action, extra) => update({ action, line: "", by: "hook", ...extra });

switch (ev.hook_event_name) {
  case "SessionStart":   // matcher: startup
    await move("peek");
    break;

  case "UserPromptSubmit":   // react at once; Claude takes a few seconds to read and answer
    await move("face");
    break;

  case "PreToolUse":   // Bash
    if (isCheck && !claudeJustSpoke) await move("pray");
    break;

  case "PostToolUse":
    if (ev.tool_name === "Bash") {
      if (isCheck && !claudeJustSpoke) await move("peace");
    } else if (open && task.session !== ev.session_id) {
      // Claude called her: remember which session owns the task, so another session's Stop leaves it alone
      await writeJson("task.json", { ...task, session: ev.session_id });
    }
    break;

  case "PostToolUseFailure":   // Bash
    if (!ev.is_interrupt && isCheck) await move("cry");
    break;

  case "PermissionDenied":
    await move("tehepero");
    break;

  case "Notification":   // permission_prompt / elicitation_dialog
    await move("knock");
    break;

  case "SubagentStart":   // a helper went off to work; nothing to do but wait
    if (!claudeJustSpoke) await move("wait");
    break;

  case "PreCompact":   // tidying up the conversation
    await move("wipe");
    break;

  case "StopFailure":   // the turn ended on an API error
    await move("cry", { line: "うまくいかない…" });
    break;

  case "Stop":
  case "SessionEnd":
    if (mine) await move(Math.random() < 0.5 ? "eat" : "cocoa", { phase: "done" });
    else if (act?.by === "hook" && ["knock", "pray", "face", "wait"].includes(act.action)) await move("idle");   // don't leave a stale reaction up
    break;
}
