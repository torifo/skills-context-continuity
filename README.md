[English](#english) | [日本語](#日本語)

---

## English

### skills-context-continuity

> Context snapshot, clear, and restore — seamless session continuity for Claude Code

[Claude Code](https://claude.ai/code) skills, the hooks that make them automatic, and an optional mod:

- **`context-snapshot-clear`** — when context usage grows too large, snapshots the complete session state (goals in the user's own words, decisions, in-progress code, errors verbatim, executable next actions), then `/clear`s. Git state (`git status` / `diff` / `diff --cached`) is dumped verbatim to a `.git.txt` sidecar by shell redirection — the model never re-emits what already exists on disk, which keeps snapshotting fast.
- **`context-restore`** — after `/clear` (or a fresh session in the same directory), reads the snapshot back, reports the restored goal, resumes work, and deletes the snapshot + sidecar.
- **`hooks/`** — `snapshot-path.sh` (single source of truth for the snapshot path) and `restore-context.sh` (a `UserPromptSubmit` hook that auto-injects a fresh snapshot into context, so restoration needs zero manual steps), plus their PowerShell twins `snapshot-path.ps1` / `restore-context.ps1` for native Windows.
- **`context-snapshot-refresh`** + **`mods/context-refresh`** (experimental) — `/context-refresh`: the same snapshot, but instead of `/clear` a mod empties the conversation in place, so the session id stays and `/resume` keeps one session. The mod then starts `context-restore` by itself, and also runs the whole thing automatically when a turn ends at 90% context or more. See [/context-refresh](#context-refresh-keep-the-session-id).

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

#### /context-refresh (keep the session id)

Experimental. Checked with the mod's tests (`claude plugin test mods/context-refresh`) and in a real desktop-app session: the conversation went from 813,930 tokens to 1,435 in 21 ms with the same session id, and the restore turn started at about the size of a brand-new session.

`/clear` starts a new session, so the conversation before it ends up in a different `/resume` entry. `/context-refresh` keeps the same session and still ends with an almost empty context:

1. The mod submits a prompt that runs `context-snapshot-refresh`. It writes the same snapshot and `.git.txt` as `context-snapshot-clear`, then just ends the turn.
2. When the turn ends, the mod looks in `~/.claude` for the snapshot written during this run (by modification time). It does not predict the file name, so it still finds the snapshot when Claude's shell `cd`s before writing. If several were written, it prefers the current directory's, then the project root's.
3. The mod runs `/compact` and answers that compaction itself with one marker line, so no summary is made. One line is the minimum: the engine refuses a compaction that leaves no message.
4. The mod submits a prompt that starts `context-restore`. `restore-context.sh` injects the snapshot as usual.

You can also just ask for it in plain words (「コンテキストリフレッシュして」, "refresh the context"). The mod registers a tool, `mcp__context-refresh__refresh`, that Claude calls first; Claude then writes the snapshot in the same turn and the mod does the rest. It also starts by itself when a turn ends normally with the context at 90% or more.

Install (needs `bash`, so macOS, Linux or WSL; the mod does not run on native Windows):

```bash
cp -r /tmp/skills-context-continuity/context-snapshot-refresh ~/.claude/skills/
mkdir -p ~/.claude/mods && cp -r /tmp/skills-context-continuity/mods/context-refresh ~/.claude/mods/
```

Then add the mod folder to `~/.claude/settings.json` and start a new session:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/context-refresh" } }
```

The setting is read when a session's process starts, so a session that was already running before you installed the mod (a long-lived desktop app session, for example) does not have it. Restart that process and reopen the session: quit the desktop app with ⌘Q and open the session again, or in a terminal exit and run `claude --resume <session id>`. The session id stays the same and the mod is loaded. `claude plugin list` shows `context-refresh@inline ... ✔ loaded` when the setting is picked up.

If you ask for a refresh in a session without the mod, `context-snapshot-refresh` writes no snapshot and tells you to restart instead. A snapshot left on disk would be injected into your next prompt and mix a restore into the refresh.

Optional, read from `~/.claude/hooks/` if present (not bundled):

- `ctx-config.sh` setting `CTX_AUTO_REFRESH_THRESHOLD` changes the 90% trigger.
- `ctx-notify-send.sh "<title>" "<subtitle>" "<body>"` sends a desktop notification when an automatic run starts or finishes, and whenever a run stops partway (manual runs too). Without it you only get in-terminal toasts, which the desktop app does not show.

#### Tuning knobs (defaults are deliberate — change them here if you want different behavior)

| Behavior | Default | Where to change |
|---|---|---|
| Snapshot freshness window | 60 min (older snapshots are not auto-injected; `Read` them manually) | `hooks/restore-context.sh` → `is_fresh()` (`-mmin -60`); `hooks/restore-context.ps1` → `AddMinutes(-60)` |
| Descendant search depth | 3 levels | `hooks/restore-context.sh` → `find ... -maxdepth 3`; `hooks/restore-context.ps1` → `$depth -le 3` |
| Two sessions clearing in the same directory | last writer wins (documented trade-off: after `/clear` the directory is the only stable handle) | by design; use distinct working directories if this bites |
| Automatic `/context-refresh` | when a turn ends at 90% context or more | `CTX_AUTO_REFRESH_THRESHOLD` in `~/.claude/hooks/ctx-config.sh`; fallback `DEFAULT_AUTO_PERCENT` in `mods/context-refresh/hooks/register.ts` |

---

## 日本語

### skills-context-continuity

> コンテキストのスナップショット保存・クリア・復元 — Claude Code のセッション継続をシームレスに

スキルと、それを自動化するフック、追加の mod のセットです：

- **`context-snapshot-clear`** — コンテキスト使用率が高くなったら、セッション状態の完全なスナップショット（ユーザーの言葉のままのゴール・決定事項・書きかけコード・エラー verbatim・実行可能な次アクション）を保存して `/clear`。git の状態（`status` / `diff` / `diff --cached`）はシェルのリダイレクトで `.git.txt` サイドカーへ全量退避 — ディスク上に既にあるものをモデルが再出力しないため、スナップショット作成が高速です。
- **`context-restore`** — `/clear` 後（または同じディレクトリでの新セッション）にスナップショットを読み戻し、ゴールを報告して作業を再開し、スナップショットとサイドカーを削除します。
- **`hooks/`** — `snapshot-path.sh`（スナップショットパスの単一情報源）と `restore-context.sh`（`UserPromptSubmit` フック。新鮮なスナップショットを自動注入するので、復元に手作業ゼロ）。Windows 用に PowerShell 版の `snapshot-path.ps1` / `restore-context.ps1` もあります。
- **`context-snapshot-refresh`** ＋ **`mods/context-refresh`**（試験的）— `/context-refresh`：同じスナップショットを取ったうえで、`/clear` の代わりに mod が会話をその場で空にします。session id が変わらないので、`/resume` でも1つのセッションのままです。そのあと mod が `context-restore` を自動で起動します。ターン終了時にコンテキストが 90% 以上なら、この一連の流れを自動で実行します。詳しくは [/context-refresh](#context-refreshsession-id-を維持) を参照。

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

#### /context-refresh（session id を維持）

試験的な機能です。mod のテスト（`claude plugin test mods/context-refresh`）に加えて、実際のデスクトップアプリのセッションでも確認しました。会話は 813,930 トークンから 1,435 トークンになり（21ms）、session id は変わらず、復元のターンは新しいセッションとほぼ同じ大きさから始まりました。

`/clear` は新しいセッションを始めるので、それ以前の会話は `/resume` で別の項目になります。`/context-refresh` は同じセッションのまま、コンテキストをほぼ空にします：

1. mod がプロンプトを送り、`context-snapshot-refresh` を起動します。`context-snapshot-clear` と同じスナップショットと `.git.txt` を書き、そのままターンを終えます。
2. ターンが終わると、mod は `~/.claude` から今回の実行中に書かれたスナップショットを更新時刻で探します。ファイル名を予測しないので、Claude のシェルが書く前に `cd` していても見つかります。複数あれば、今のディレクトリ、プロジェクトのルートの順に選びます。
3. mod が `/compact` を起動し、その compact に自分で答えて会話をマーカー1行だけにします。要約は作りません。1行残すのは、メッセージが0件になる compact をエンジンが受け付けないためです。
4. mod が `context-restore` を起動するプロンプトを送ります。スナップショットはいつもどおり `restore-context.sh` が注入します。

普通の言葉で頼むこともできます（「コンテキストリフレッシュして」など）。mod が `mcp__context-refresh__refresh` というツールを登録しており、Claude はまずそれを呼び、同じターンでスナップショットを書きます。残りは mod が進めます。ターンが普通に終わった時点でコンテキストが 90% 以上なら、自動で始まります。

インストール（`bash` が必要なので macOS・Linux・WSL 向け。ネイティブ Windows では mod は動きません）：

```bash
cp -r /tmp/skills-context-continuity/context-snapshot-refresh ~/.claude/skills/
mkdir -p ~/.claude/mods && cp -r /tmp/skills-context-continuity/mods/context-refresh ~/.claude/mods/
```

続けて `~/.claude/settings.json` に mod のフォルダを追加し、新しいセッションを始めます：

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/context-refresh" } }
```

この設定はセッションのプロセスが起動するときに読まれます。mod を入れる前から動いているセッション（長く開いたままのデスクトップアプリのセッションなど）には入りません。プロセスを起動し直してセッションを開き直してください。デスクトップアプリなら ⌘Q で終了してそのセッションを開き直し、ターミナルなら終了して `claude --resume <session id>` を実行します。session id はそのままで、mod が入ります。設定が読まれていれば、`claude plugin list` に `context-refresh@inline ... ✔ loaded` と出ます。

mod が入っていないセッションでリフレッシュを頼むと、`context-snapshot-refresh` はスナップショットを書かずに、再起動するよう案内します。書いてしまうと次のプロンプトで先に注入され、リフレッシュと復元が混ざるためです。

次のファイルが `~/.claude/hooks/` にあれば使います（同梱していません）：

- `ctx-config.sh` の `CTX_AUTO_REFRESH_THRESHOLD` で、自動起動の 90% を変えられます。
- `ctx-notify-send.sh "<タイトル>" "<サブタイトル>" "<本文>"` があれば、自動実行の開始・完了と、途中で止まったとき（手動でも）をデスクトップ通知します。無ければターミナル内のトーストだけで、デスクトップアプリには表示されません。

#### 調整ポイント（デフォルトは意図的な設計です — 変えたい場合はここ）

| 挙動 | デフォルト | 変更箇所 |
|---|---|---|
| スナップショットの鮮度ウィンドウ | 60分（それより古いと自動注入されない。手動 `Read` は可能） | `hooks/restore-context.sh` → `is_fresh()`（`-mmin -60`）／`hooks/restore-context.ps1` → `AddMinutes(-60)` |
| 子ディレクトリ探索の深さ | 3階層 | `hooks/restore-context.sh` → `find ... -maxdepth 3`／`hooks/restore-context.ps1` → `$depth -le 3` |
| 同一ディレクトリで2セッションが clear した場合 | 後勝ち（`/clear` 後はディレクトリが唯一の安定ハンドル、という設計上のトレードオフ） | 仕様。困る場合は作業ディレクトリを分ける |
| `/context-refresh` の自動起動 | ターン終了時にコンテキスト 90% 以上 | `~/.claude/hooks/ctx-config.sh` の `CTX_AUTO_REFRESH_THRESHOLD`。無い場合は `mods/context-refresh/hooks/register.ts` の `DEFAULT_AUTO_PERCENT` |
