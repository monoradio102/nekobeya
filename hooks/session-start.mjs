#!/usr/bin/env node
// SessionStart: adds みかん's instructions to the session, so Claude calls her without a CLAUDE.md entry.
// Set NEKOBEYA_QUIET=1 to keep the tool but drop the instructions (she then moves only when asked).
if (process.env.NEKOBEYA_QUIET) process.exit(0);
const port = Number(process.env.NEKOBEYA_PORT) || 8767;
const text = `# みかん (buddy window)

The user keeps a buddy window open (http://localhost:${port}) where みかん, a small cat-eared girl, shows what you are
doing. Claude Code moves her on its own only at a few moments (an approval prompt, a failing test or build command,
closing a task you left open when your reply ends); everything else comes from your calls to the \`mikan\` tool
(nekobeya MCP server). So report the task yourself, and let her voice your own state, impressions and small grumbles
about the work, in her words.

- Task tracking: on the first call of a piece of work pass phase:"start" with a short task label (her first line is
  curious: 「どれどれ…」「ふむふむ」, not 「まかせて」); pass a rough progress (0-100) on later calls; finish with
  phase:"done" (e.g. action cocoa or eat). Skip all of this for plain chat.
- When: the start and end of a task, plus moments with a genuine reaction - starting something big, puzzling code, a
  failing test or build, a small grumble, relief when a fix lands, waiting on something slow, finishing. 2-5 times per
  task; skip trivial steps. Call it alongside your other tool calls; never mention it in your replies unless the user
  asks about みかん.
- Line: honest and playful, soft casual Japanese, mostly hiragana, under 30 characters, no emoji.
  e.g. 「このテスト、なんでおちるの…」「よし、なおった〜」「ビルドながいなあ」「だれがかいたの、このコード…」
- If the user asks where she is, the window is http://localhost:${port} (the /nekobeya:open command opens it).`;
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));
