---
name: context-restore
description: Use when a context snapshot is injected (=== CONTEXT SNAPSHOT ===) - ~/.claude/context_snapshot_<cwd>.md under 60 minutes old, after /clear, /context-refresh or a new session in the same directory - reads the snapshot, reports restored state, resumes work, then deletes the file. Injected automatically by the UserPromptSubmit hook.
---

# Context Restore

## Overview

Restores previous session state from the snapshot file (`~/.claude/context_snapshot_<cwd>.md`, path resolved by `~/.claude/hooks/snapshot-path.sh`; Windows PowerShell: `snapshot-path.ps1`, same path) after `/clear`, `/context-refresh` or session restart. Keyed by **working directory**, not `session_id`, because `/clear` mints a new `session_id` — cwd is the only handle that survives a clear. The snapshot is injected automatically into context by a hook. (Trade-off: two sessions clearing in the same directory share one snapshot.)

## When the Snapshot Appears

A `UserPromptSubmit` hook injects snapshot content (if fresh) wrapped in markers:

```
=== CONTEXT SNAPSHOT (自動復元) ===
[snapshot content]
=== END SNAPSHOT ===
```

When you see these markers, immediately follow the procedure below.

## Procedure

1. **Read the full snapshot** — parse: goal, progress, last action, next steps, key code/errors

2. **Report to user** (日本語で):
   ```
   [ゴール]のコンテキストを復元しました。次：[次のアクション]
   ```

3. **Resume work** — continue from snapshot's next actions immediately, no re-explanation needed

4. **Delete the snapshot** (per-cwd path; also remove the `.git.txt` sidecar that holds the verbatim git state):
   ```bash
   SNAP="$(bash ~/.claude/hooks/snapshot-path.sh)"; rm -f "$SNAP" "${SNAP%.md}.git.txt"
   ```
   Windows PowerShell:
   ```powershell
   $SNAP = & "$env:USERPROFILE\.claude\hooks\snapshot-path.ps1"; Remove-Item -LiteralPath $SNAP, ($SNAP -replace '\.md$', '.git.txt') -Force -ErrorAction SilentlyContinue
   ```

## Rules

- Skip restore if snapshot is older than 60 minutes (hook won't inject stale files)
- Skip restore if no markers appear in context
- Delete snapshot after restore — prevents stale reload in next session
- Resume immediately — don't ask "should I continue?" just continue
