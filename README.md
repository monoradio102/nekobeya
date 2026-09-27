# ねこべや (Claude Code plugin)

![みかんが小窓で Claude Code の作業のようすを見せている紹介動画](docs/promo.webp)

<sub>紹介動画（高画質・27秒）: [X の投稿](https://x.com/monoradio102/status/2104227635870228928) ／ 画面の一部: Wikipedia（CC BY-SA 4.0）</sub>

みかん, a small cat-eared pixel-art girl, keeps you company next to Claude Code. She acts out what Claude is doing and
how it feels about it: 「どれどれ…」 when a task begins, pondering over puzzling code, praying while tests run, crying at
a failing build, slurping noodles when it is done. The window also shows the clock, the elapsed time and the progress.

Everything runs on your machine: a small local MCP server and a page on `http://localhost:8767`. Nothing is sent
anywhere, so Claude can speak freely in her voice.

## Install

```
/plugin marketplace add monoradio102/nekobeya
/plugin install nekobeya@nekobeya
```

Restart Claude Code, then run `/nekobeya:open` (or open http://localhost:8767 yourself). In Chrome or Edge, the
「小窓にする」 button keeps her floating above your other windows. Requires Node.js 18 or newer.

To update, refresh the marketplace first (Claude Code does not re-read it on its own unless auto-update is on
for it), then restart:

```
claude plugin marketplace update nekobeya
claude plugin update nekobeya@nekobeya
```

## How it works

| part | what it does |
|---|---|
| `server.mjs` | MCP server (stdio, no dependencies) with one tool, `mikan`: `action`, `line`, optional `task` / `progress` / `phase`. Also serves the window. |
| `hooks/session-start.mjs` | adds the "when to call her" instructions to each session, so no CLAUDE.md entry is needed |
| `commands/open.md` | `/nekobeya:open` opens the window |
| `buddy/` | the window page and her own line bank (used when a call has no line) |
| `sprites/` | 28 animations (160 px frames, drawn at 2x) |

State lives in `~/.nekobeya/` (`task.json`, `activity.json`) and is shared by all sessions; whichever session gets the
port serves the window, and another takes over within 30 seconds if it ends. After 5 quiet minutes she assumes the
work settled down, and after 30 she falls asleep.

Settings (environment variables): `NEKOBEYA_PORT` (default 8767), `NEKOBEYA_HOME` (default `~/.nekobeya`),
`NEKOBEYA_QUIET=1` (keep the tool but drop the instructions, so she moves only when you ask).

## License

Code: MIT. The character みかん (sprites, line bank, design) is all rights reserved and may be used only as part
of this plugin; see [LICENSE](LICENSE). みかん is an AI-generated character.
