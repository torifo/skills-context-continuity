[English](#english) | [日本語](#日本語)

---

## English

### skills-context-snapshot-clear

> Context snapshot and clear for seamless session continuity

A [Claude Code](https://claude.ai/code) skill that preserves complete session state — actual code, conversation history, errors verbatim, and executable next steps — then clears context so work continues without re-explanation.

#### Install

```bash
git clone https://github.com/torifo/skills-context-snapshot-clear /tmp/skills-context-snapshot-clear
cp -r /tmp/skills-context-snapshot-clear/context-snapshot-clear ~/.claude/skills/
```

#### Usage

Triggers automatically when context usage exceeds 70% (configured in `CLAUDE.md`).

**What it does:**

1. Collects current git state and reads in-progress files
2. Writes a complete snapshot to `~/.claude/context_snapshot.md` — real code, verbatim errors, runnable next-step commands
3. Runs `/clear` to reset the context window
4. On the next session start, restores the snapshot and resumes work immediately — no re-explanation needed

**Quality bar:** After writing the snapshot, the skill asks: *"Can Claude read this file alone and continue without asking the user anything?"* If the answer is no, the snapshot is rewritten.

**Snapshot sections:**

| Section | What it captures |
|---------|-----------------|
| Goal | User's original request verbatim |
| Conversation flow | Decisions made, corrections received, constraints discovered |
| Task state | Completed / in-progress (with actual code) / pending |
| Changed files | Diffs or before/after for each modified file |
| Errors | Verbatim error output, hypothesis, tried approaches, next attempt |
| Git state | `git status` + `git diff` output |
| Next actions | Executable commands, not vague descriptions |

---

## 日本語

### skills-context-snapshot-clear

> コンテキストをスナップショット保存してセッションを継続する

[Claude Code](https://claude.ai/code) のスキル。コンテキスト使用率が70%を超えたとき、セッションの状態（実際のコード・会話の流れ・エラーの全文・実行可能な次のアクション）を完全に保存してからコンテキストをクリア。再説明なしで作業を続けられます。

#### インストール

```bash
git clone https://github.com/torifo/skills-context-snapshot-clear /tmp/skills-context-snapshot-clear
cp -r /tmp/skills-context-snapshot-clear/context-snapshot-clear ~/.claude/skills/
```

#### 使い方

`CLAUDE.md` に設定することで、コンテキスト使用率が70%を超えたときに自動起動します。

**動作:**

1. 現在の git 状態を収集し、作業中のファイルを読み込む
2. `~/.claude/context_snapshot.md` に完全なスナップショットを書き込む（実際のコード・エラー全文・実行可能なコマンドで次のアクションを記録）
3. `/clear` でコンテキストウィンドウをリセット
4. 次のセッション開始時にスナップショットを復元し、即座に作業を再開（再説明不要）

**品質基準:** スナップショット作成後、「clear後のClaudeがこのファイルだけ読んで、ユーザーに何も聞かずに作業を続けられるか？」を自問します。Noであれば書き直します。

**スナップショットのセクション:**

| セクション | 記録内容 |
|------------|---------|
| ゴール | ユーザーの依頼をそのまま記録 |
| 会話の流れ | 行った決定・受けた訂正・判明した制約 |
| タスク状態 | 完了済み / 進行中（実際のコード付き） / 未着手 |
| 変更済みファイル | 各ファイルの差分またはbefore/after |
| エラー | エラー出力全文・仮説・試したこと・次の試み |
| Git状態 | `git status` と `git diff` の出力 |
| 次のアクション | 実行可能なコマンド（曖昧な説明ではなく） |
