[English](#english) | [日本語](#日本語)

---

## English

### skills-context-continuity

> Context snapshot, clear, and restore — seamless session continuity for Claude Code

Two [Claude Code](https://claude.ai/code) skills plus the hooks that make them automatic:

- **`context-snapshot-clear`** — when context usage grows too large, snapshots the complete session state (goals in the user's own words, decisions, in-progress code, errors verbatim, executable next actions), then `/clear`s. Git state (`git status` / `diff` / `diff --cached`) is dumped verbatim to a `.git.txt` sidecar by shell redirection — the model never re-emits what already exists on disk, which keeps snapshotting fast.
- **`context-restore`** — after `/clear` (or a fresh session in the same directory), reads the snapshot back, reports the restored goal, resumes work, and deletes the snapshot + sidecar.
- **`hooks/`** — `snapshot-path.sh` (single source of truth for the snapshot path) and `restore-context.sh` (a `UserPromptSubmit` hook that auto-injects a fresh snapshot into context, so restoration needs zero manual steps), plus their PowerShell twins `snapshot-path.ps1` / `restore-context.ps1` for native Windows.

#### Why cwd-keyed paths

`/clear` mints a brand-new `session_id`, so anything keyed by session id is orphaned the moment you clear. Snapshots are instead keyed by **working directory** (`~/.claude/context_snapshot_<encoded-cwd>.md`) — the only handle that survives a clear. If there is no exact-cwd snapshot, the hook walks the directory **hierarchy** (ancestors, and descendants up to 3 levels, each confirmed against the real filesystem so lookalike siblings never match): one fresh candidate → auto-inject; several → list them and ask instead of guessing.

#### Install

```bash
git clone https://github.com/torifo/skills-context-continuity /tmp/skills-context-continuity
cp -r /tmp/skills-context-continuity/context-snapshot-clear /tmp/skills-context-continuity/context-restore ~/.claude/skills/
mkdir -p ~/.claude/hooks
cp /tmp/skills-context-continuity/hooks/snapshot-path.sh /tmp/skills-context-continuity/hooks/restore-context.sh ~/.claude/hooks/
```

Then register the hook: merge `hooks/settings.example.json` into your `~/.claude/settings.json` (the `UserPromptSubmit` entry). Without the hook the skills still work — you just run the restore step manually.

#### Windows

| Environment | Install | Hook entry |
|---|---|---|
| WSL | the bash steps above, inside WSL | `hooks/settings.example.json` |
| Native Windows (with or without Git for Windows) | the PowerShell steps below | `hooks/settings.windows.example.json` |

```powershell
git clone https://github.com/torifo/skills-context-continuity "$env:TEMP\skills-context-continuity"
$src = "$env:TEMP\skills-context-continuity"
# No git? Download the ZIP instead:
#   Invoke-WebRequest https://github.com/torifo/skills-context-continuity/archive/refs/heads/main.zip -OutFile "$env:TEMP\scc.zip"
#   Expand-Archive -Force "$env:TEMP\scc.zip" "$env:TEMP"; $src = "$env:TEMP\skills-context-continuity-main"
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills", "$env:USERPROFILE\.claude\hooks" | Out-Null
Copy-Item -Recurse -Force "$src\context-snapshot-clear", "$src\context-restore" "$env:USERPROFILE\.claude\skills\"
Copy-Item -Force "$src\hooks\*.ps1", "$src\hooks\*.sh" "$env:USERPROFILE\.claude\hooks\"
```

Then merge `hooks/settings.windows.example.json` into `%USERPROFILE%\.claude\settings.json`. The hook runs in PowerShell (`"shell": "powershell"`), so Git for Windows is optional. The `.sh` and `.ps1` scripts build the same file name, so Claude may save a snapshot from Git Bash or from PowerShell and the hook still finds it. The PowerShell scripts are written for Windows PowerShell 5.1 and PowerShell 7 (tested on PowerShell 7). PowerShell's start-up time (about half a second) is added to each prompt.

#### Usage

```
context is at 75%, snapshot and clear        # or let your own trigger rule invoke it
```

After `/clear`, just send any prompt — the hook injects the snapshot automatically and `context-restore` resumes from "next actions".

#### Tuning knobs (defaults are deliberate — change them here if you want different behavior)

| Behavior | Default | Where to change |
|---|---|---|
| Snapshot freshness window | 60 min (older snapshots are not auto-injected; `Read` them manually) | `hooks/restore-context.sh` → `is_fresh()` (`-mmin -60`); `hooks/restore-context.ps1` → `AddMinutes(-60)` |
| Descendant search depth | 3 levels | `hooks/restore-context.sh` → `find ... -maxdepth 3`; `hooks/restore-context.ps1` → `$depth -le 3` |
| Two sessions clearing in the same directory | last writer wins (documented trade-off: after `/clear` the directory is the only stable handle) | by design; use distinct working directories if this bites |

---

## 日本語

### skills-context-continuity

> コンテキストのスナップショット保存・クリア・復元 — Claude Code のセッション継続をシームレスに

2つのスキルと、それを自動化するフックのセットです：

- **`context-snapshot-clear`** — コンテキスト使用率が高くなったら、セッション状態の完全なスナップショット（ユーザーの言葉のままのゴール・決定事項・書きかけコード・エラー verbatim・実行可能な次アクション）を保存して `/clear`。git の状態（`status` / `diff` / `diff --cached`）はシェルのリダイレクトで `.git.txt` サイドカーへ全量退避 — ディスク上に既にあるものをモデルが再出力しないため、スナップショット作成が高速です。
- **`context-restore`** — `/clear` 後（または同じディレクトリでの新セッション）にスナップショットを読み戻し、ゴールを報告して作業を再開し、スナップショットとサイドカーを削除します。
- **`hooks/`** — `snapshot-path.sh`（スナップショットパスの単一情報源）と `restore-context.sh`（`UserPromptSubmit` フック。新鮮なスナップショットを自動注入するので、復元に手作業ゼロ）。Windows 用に PowerShell 版の `snapshot-path.ps1` / `restore-context.ps1` もあります。

#### なぜ cwd キーなのか

`/clear` は session_id を作り直すため、session_id をキーにすると clear した瞬間にスナップショットが迷子になります。そこで **作業ディレクトリ**をキーにしたパス（`~/.claude/context_snapshot_<エンコード済みcwd>.md`）を使います — clear を生き延びる唯一のハンドルです。完全一致がない場合、フックはディレクトリ**階層**を探索します（親方向、および3階層までの子方向。実ファイルシステムと突合してから採用するので、紛らわしい兄弟ディレクトリを誤マッチしません）。新鮮な候補が1つなら自動注入、複数なら推測せず一覧を提示して指示を待ちます。

#### インストール

```bash
git clone https://github.com/torifo/skills-context-continuity /tmp/skills-context-continuity
cp -r /tmp/skills-context-continuity/context-snapshot-clear /tmp/skills-context-continuity/context-restore ~/.claude/skills/
mkdir -p ~/.claude/hooks
cp /tmp/skills-context-continuity/hooks/snapshot-path.sh /tmp/skills-context-continuity/hooks/restore-context.sh ~/.claude/hooks/
```

フック登録：`hooks/settings.example.json` の `UserPromptSubmit` エントリを `~/.claude/settings.json` にマージしてください。フックなしでもスキル自体は動きます（復元手順を手動で実行する形になります）。

#### Windows

| 環境 | インストール | フック登録 |
|---|---|---|
| WSL | 上の bash の手順を WSL の中で実行 | `hooks/settings.example.json` |
| Windows（Git for Windows の有無は問わない） | 下の PowerShell の手順 | `hooks/settings.windows.example.json` |

```powershell
git clone https://github.com/torifo/skills-context-continuity "$env:TEMP\skills-context-continuity"
$src = "$env:TEMP\skills-context-continuity"
# git が無い場合は ZIP で:
#   Invoke-WebRequest https://github.com/torifo/skills-context-continuity/archive/refs/heads/main.zip -OutFile "$env:TEMP\scc.zip"
#   Expand-Archive -Force "$env:TEMP\scc.zip" "$env:TEMP"; $src = "$env:TEMP\skills-context-continuity-main"
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills", "$env:USERPROFILE\.claude\hooks" | Out-Null
Copy-Item -Recurse -Force "$src\context-snapshot-clear", "$src\context-restore" "$env:USERPROFILE\.claude\skills\"
Copy-Item -Force "$src\hooks\*.ps1", "$src\hooks\*.sh" "$env:USERPROFILE\.claude\hooks\"
```

続けて `hooks/settings.windows.example.json` の内容を `%USERPROFILE%\.claude\settings.json` にマージしてください。フックは PowerShell で動くので（`"shell": "powershell"`）、Git for Windows が無くても動きます。`.sh` と `.ps1` は同じファイル名を作るので、Claude が Git Bash と PowerShell のどちらでスナップショットを保存しても、フックは見つけられます。PowerShell 版は Windows PowerShell 5.1 と PowerShell 7 のどちらでも動くように書いてあります（動作確認は PowerShell 7 のみ）。プロンプトを送るたびに、PowerShell の起動時間（0.5 秒ほど）がかかります。

#### 使い方

```
コンテキスト75%超えたのでスナップショットしてクリアして
```

`/clear` 後は何かプロンプトを送るだけ — フックがスナップショットを自動注入し、`context-restore` が「次のアクション」から再開します。

#### 調整ポイント（デフォルトは意図的な設計です — 変えたい場合はここ）

| 挙動 | デフォルト | 変更箇所 |
|---|---|---|
| スナップショットの鮮度ウィンドウ | 60分（それより古いと自動注入されない。手動 `Read` は可能） | `hooks/restore-context.sh` → `is_fresh()`（`-mmin -60`）／`hooks/restore-context.ps1` → `AddMinutes(-60)` |
| 子ディレクトリ探索の深さ | 3階層 | `hooks/restore-context.sh` → `find ... -maxdepth 3`／`hooks/restore-context.ps1` → `$depth -le 3` |
| 同一ディレクトリで2セッションが clear した場合 | 後勝ち（`/clear` 後はディレクトリが唯一の安定ハンドル、という設計上のトレードオフ） | 仕様。困る場合は作業ディレクトリを分ける |
