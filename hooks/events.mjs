#!/usr/bin/env node
// Moments Claude Code itself knows about, so みかん keeps up even when Claude forgets to call her (or before it can):
// the user's message arriving, the kind of step being run (reading, searching, editing, tests, builds, git ...),
// waiting for approval, a failure, the reply being finished, and so on.
// Her words are left to Claude; an empty line lets the window pick one from her bank.
import { readJson, update, writeJson } from "../state.mjs";

// commands worth praying over, and crying over when they fail (a grep that finds nothing is not); first match wins
const CHECKS = [
  [/\b(test|tests|jest|vitest|mocha|pytest|tox|rspec)\b/, "test"],
  [/\b(tsc|vue-tsc|mypy|pyright|typecheck|type-check)\b/, "typecheck"],
  [/\b(lint|eslint|ruff|flake8|pylint|clippy|go\s+vet)\b/, "review"],
  [/\b(build|make|cargo|gradle|mvn|xcodebuild|swift\s+build|webpack|esbuild)\b/, "build"],
];
// other commands: only the scene changes, her words stay (first match wins)
const SCENES = [
  [/\bgit\s+commit\b/, "commit"],
  [/\bgit\s+push\b/, "push"],
  [/\bgit\s+(pull|fetch|clone)\b/, "git_pull"],
  [/\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b|\bpip3?\s+install\b|\b(brew|apt|apt-get)\s+install\b|\bcargo\s+(add|install)\b|\buv\s+(add|sync|pip\s+install)\b|\bpoetry\s+(add|install)\b/, "install"],
  [/\bgh\s+(pr\s+checks|run\s+(watch|view))\b/, "ci_wait"],
  [/\b(deploy|vercel|netlify|wrangler|fly\s+deploy|terraform\s+apply|kubectl\s+apply)\b/, "deploy"],
  [/\b(curl|wget|aria2c)\b|\b(colab|huggingface-cli|hf)\s+download\b/, "download"],
  [/\b(ffmpeg|blender|remotion)\b/, "render"],
  [/\b(nvidia-smi|colab\s+(new|exec))\b|\btrain\w*\.py\b/, "gpu_wait"],
  [/\b(tail|journalctl)\b|\b(docker|kubectl)\s+logs\b|\bgit\s+log\b/, "logs"],
  [/\b(grep|rg|ag|ack)\b/, "grep"],
  [/\b(find|ls|tree|fd)\b/, "explore"],
  [/\bsleep\s+\d/, "wait"],
];
const TOOLS = {
  Read: "explore", Glob: "explore", LS: "explore", Grep: "grep", Edit: "edit", MultiEdit: "edit", Write: "edit",
  NotebookEdit: "edit", WebFetch: "web", WebSearch: "web", TodoWrite: "plan", TaskCreate: "plan",
  EnterPlanMode: "plan", ExitPlanMode: "plan",
};
// what went wrong, read from the error text of any failed command or fetch
const FAILS = [
  [/CONFLICT|merge conflict|Automatic merge failed/i, "conflict"],
  [/out of memory|\bOOM\b|ENOMEM|heap out of memory|Killed: 9/i, "oom"],
  [/rate.?limit|\b429\b|too many requests|overloaded/i, "rate_limit"],
  [/timed? ?out|ETIMEDOUT|deadline exceeded/i, "timeout"],
  [/could not resolve|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network is unreachable|getaddrinfo/i, "offline"],
];
const match = (table, s) => table.find(([re]) => re.test(s))?.[1];

// Claude often calls her alongside a tool; its own reaction wins over the hook's for this long
const CLAUDE_SPOKE_MS = 5000;
// a reaction (a failure, a question, success) stays up this long before a work scene may replace it
const REACTION_MS = 6000;
// reactions that may stay up after the reply ends; any other hook pose goes back to idle then
const LASTING = ["peace", "test_pass", "test_fail", "cry", "tehepero", "denied", "conflict", "timeout", "oom", "offline",
  "rate_limit", "eat", "cocoa", "report", "trophy", "morning", "late_night", "peek"];

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const ev = JSON.parse(raw || "{}");
const task = await readJson("task.json");
const act = await readJson("activity.json");
const open = task && !task.doneAt;
const mine = open && (!task.session || task.session === ev.session_id);   // another session's task is left alone
const since = act ? Date.now() - act.at : Infinity;
const claudeJustSpoke = act && act.by !== "hook" && since < CLAUDE_SPOKE_MS;
const command = String(ev.tool_input?.command ?? "");
const check = ev.tool_name === "Bash" ? match(CHECKS, command) : undefined;
const move = (action, extra) => update({ action, line: "", by: "hook", ...extra });
// a work scene: no words, never over Claude's own reaction or a fresh hook reaction, and not again if already showing
const scene = (action) => {
  if (!action || claudeJustSpoke || act?.action === action) return;
  if (act?.by === "hook" && !act.quiet && since < REACTION_MS) return;
  return move(action, { quiet: true });
};

switch (ev.hook_event_name) {
  case "SessionStart": {   // matcher: startup
    const h = new Date().getHours();
    await move(h >= 5 && h < 10 ? "morning" : h >= 22 || h < 5 ? "late_night" : "peek");
    break;
  }

  case "UserPromptSubmit":   // react at once; Claude takes a few seconds to read and answer
    await move("face");
    break;

  case "PreToolUse":
    if (ev.tool_name === "AskUserQuestion") await move("question");
    else if (check) { if (!claudeJustSpoke) await move(check); }
    else await scene(ev.tool_name === "Bash" ? match(SCENES, command) : TOOLS[ev.tool_name]);
    break;

  case "PostToolUse":
    if (ev.tool_name === "Bash") {
      if (check && !claudeJustSpoke) await move(check === "test" ? "test_pass" : "peace");
    } else if (open && task.session !== ev.session_id) {
      // Claude called her: remember which session owns the task, so another session's Stop leaves it alone
      await writeJson("task.json", { ...task, session: ev.session_id });
    }
    break;

  case "PostToolUseFailure": {   // Bash, WebFetch, WebSearch
    if (ev.is_interrupt) break;
    const what = match(FAILS, `${ev.error ?? ""} ${JSON.stringify(ev.tool_response ?? "")}`);
    if (what) await move(what);
    else if (check) await move(check === "test" ? "test_fail" : "cry");
    break;
  }

  case "PermissionDenied":
    await move("denied");
    break;

  case "Notification":   // permission_prompt / elicitation_dialog
    await move(ev.notification_type === "elicitation_dialog" ? "question" : "approval");
    break;

  case "SubagentStart":   // a helper went off to work
    if (!claudeJustSpoke) await move("subagent");
    break;

  case "PreCompact":   // squeezing the conversation into a smaller box
    await move("compact");
    break;

  case "StopFailure":   // the turn ended on an API error
    if (/rate.?limit|\b429\b|overloaded/i.test(raw)) await move("rate_limit", { line: "こみあってるみたい…" });
    else await move("cry", { line: "うまくいかない…" });
    break;

  case "Stop":
  case "SessionEnd":
    if (mine) {
      // a long piece of work earns the trophy
      const long = Date.now() - task.startedAt > 20 * 60_000;
      await move(long ? "trophy" : ["eat", "cocoa", "report"][Math.floor(Math.random() * 3)], { phase: "done" });
    } else if (act?.by === "hook" && !LASTING.includes(act.action)) await move("idle");   // don't leave a stale scene up
    break;
}
