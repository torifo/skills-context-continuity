---
name: context-snapshot-clear
description: Use when context is above 70% - preserves complete session state including actual code, conversation history, errors verbatim, and executable next steps, then clears context so work continues without re-explanation
---

# Context Snapshot Compact

## Overview

**判定基準：「clear後のClaudeがこのファイルだけ読んで、ユーザーに何も聞かずに作業を続けられるか？」**

説明ではなく実物を記録する。コードは実際のコード、エラーはverbatim、次のアクションは実行できるコマンド。

## Phase 1: 状態収集（書く前に実行）

```bash
# Git状態を取得
git status 2>/dev/null && git diff 2>/dev/null | head -200

# 直近の変更ファイルの内容確認
# (作業中のファイルをReadツールで読む)
```

## Phase 2: スナップショット作成

`~/.claude/context_snapshot.md` に書き込む。**全セクション必須**：

````markdown
# Claude Context Snapshot
Created: YYYY-MM-DDTHH:MM:SS+09:00
Working Directory: /absolute/path
Context at Save: XX%

---

## ゴール（ユーザーの言葉で）
[ユーザーが最初に依頼した内容をそのまま記録。要約しない]

---

## 会話の流れ（失ってはいけないやり取り）

### 重要な決定とその経緯
- **Q**: [ユーザーの問い・指示]
  **A/決定**: [行った判断と理由]

### ユーザーからの訂正・フィードバック
- [訂正内容] → [それを受けて変更した方針]

### このセッションで判明した制約・前提
- [非自明な制約・プロジェクト固有のルール]

---

## タスク状態

### 完了済み ✓
- [タスク名] — [何をどのように完了したか。ファイルパスと変更内容を含む]

### 進行中（最重要）
- [タスク名]
  - 現在地: [どこまで実装したか、ファイル:行番号]
  - 残り: [何が未完成か]
  - 現在のコード:
    ```[言語]
    [実際の半完成コード全体。省略しない]
    ```

### 未着手
- [タスク名] — [概要と優先度]

---

## 変更済みファイル

### [path/to/file.ext]
**変更内容**: [何を変えたか]
**理由**: [なぜ変えたか]
```diff
[git diff の出力、またはbefore/after]
```

---

## エラー・問題（デバッグ中の場合）

**エラーメッセージ（verbatim）**:
```
[実際のエラー出力をそのままコピー。絶対に要約しない]
```
**発生箇所**: [ファイル:行番号]
**原因の仮説**: [現時点での推測]
**試したこと**: [やったこと→結果]
**次の試み**: [次に試すアプローチ]

---

## Git状態

```
[git status の出力]
```

```diff
[git diff の主要部分 — 長すぎる場合は最重要部分のみ]
```

---

## 次のアクション（compact後すぐ実行できる粒度で）

1. [具体的なコマンドまたはファイルの変更内容]
2. [次のステップ]
3. [その次]

---

## セッション固有のコンテキスト

[このセッションでのみ判明した情報。ユーザーの好み、プロジェクト固有の事情、
 見つけたバグの詳細、APIの仕様、設定値など。次のClaudeが知らないと困ること]
````

## Phase 3: 品質チェック（書いた後に必ず確認）

書き終えたら自問する：

| チェック項目 | NG例 | OK例 |
|---|---|---|
| ゴールはユーザーの言葉か | 「機能追加」 | 「認証エラー時に日本語メッセージを出す」 |
| コードは実物か | 「handleAuth関数を修正中」 | 実際のコード全体 |
| 次のアクションは実行できるか | 「テストを書く」 | `bun test src/auth.test.ts` |
| エラーはverbatimか | 「型エラーが出た」 | `Type 'string' is not assignable to...` |
| ユーザーへの確認が0件で続けられるか | — | **これが最終基準** |

**NGが1つでもあれば書き直す。**

## Phase 4: clear実行

```
/clear
```

## Phase 5: 復元（clear後の最初の行動）

1. `Read ~/.claude/context_snapshot.md` を実行
2. ユーザーへ報告：「コンテキストを復元しました。[ゴール]の続きから：[次のアクション1]を実行します」
3. 「次のアクション」から即作業開始
4. ファイル削除：`rm ~/.claude/context_snapshot.md`

## よくある失敗

| 失敗 | 正しい対処 |
|---|---|
| コードを「修正中」と書いて実物を省く | 実際のコードをコピーして貼る |
| エラーを要約して書く | エラー出力全体をverbatimで貼る |
| 「次はXを実装する」と書く | `bun run build && bun test` のような実行可能な形で書く |
| 会話のやり取りを省く | ユーザーの訂正・フィードバックは必ず記録する |
| 「重要なコンテキスト」を空欄にする | このセッションで発見した全ての非自明な情報を書く |
