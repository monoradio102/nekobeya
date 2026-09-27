---
description: みかんの小窓をブラウザで開く
allowed-tools: Bash(open:*), Bash(xdg-open:*), Bash(start:*)
---

Open みかん's buddy window, http://localhost:8767 (or the port in the NEKOBEYA_PORT environment variable), in the
user's default browser: `open` on macOS, `xdg-open` on Linux, `start ""` on Windows. Then tell the user in one short
Japanese sentence that it is open, and that in Chrome or Edge the 「小窓にする」 button keeps her floating above other
windows. Also call the mikan tool once with action "peek" and a short greeting line.
