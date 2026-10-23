---
name: context-snapshot-clear
description: Use when context is above 70% - preserves complete session state including actual code, conversation history, errors verbatim, and executable next steps, then clears context so work continues without re-explanation
---

# Context Snapshot Compact

## Overview

**判定基準：「clear後のClaudeがこのファイルだけ読んで、ユーザーに何も聞かずに作業を続けられるか？」**

説明ではなく実物を記録する。コードは実際のコード、エラーはverbatim、次のアクションは実行できるコマンド。

**速度の大原則：モデルが書き出すのは「会話にしか存在しない情報」だけ。ディスク上に既にあるもの（git diff・保存済みコード）はシェルで退避してパス参照する。** 出力トークンの再生成が最大の時間コストであり、復元時の注入量も膨らませる。

## Phase 1: 状態収集＋git退避（1コマンドで完結）

パス取得と git 状態の退避を **1回の Bash** で行う（cwd がキー。`/clear` は session_id を作り直すため session_id では復元できない。必ず作業ディレクトリで実行）：

```bash
SNAP="$(bash ~/.claude/hooks/snapshot-path.sh)"
{ git status; echo '=== DIFF ==='; git diff; echo '=== STAGED ==='; git diff --cached; } > "${SNAP%.md}.git.txt" 2>/dev/null
echo "$SNAP"
```

Windows の PowerShell で実行する場合（bash 版と同じパスになるので、どちらで実行してもよい）：

```powershell
$SNAP = & "$env:USERPROFILE\.claude\hooks\snapshot-path.ps1"
& { git status; '=== DIFF ==='; git diff; '=== STAGED ==='; git diff --cached } 2>$null | Set-Content -Encoding utf8 ($SNAP -replace '\.md$', '.git.txt')
$SNAP
```

作業中ファイルの再 Read は**しない**（内容は既にコンテキストにある。再読は時間の無駄）。

## Phase 2: スナップショット作成

Phase 1 で得たパスに Write ツールで書き込む。**該当する内容がないセクションは「なし」の1行だけにする**（空テンプレの複写は禁止）。**diff や保存済みコードは貼らない**（.git.txt を参照）：

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
  - コード: [ディスクに保存済みなら file:行番号 参照のみ。**貼るのはディスクに存在しない断片だけ**（未保存の設計・書きかけでまだ書き込んでいないコード）]
    ```[言語]
    [未保存の断片がある場合のみ。保存済みコードの複写は禁止]
    ```

### 未着手
- [タスク名] — [概要と優先度]

---

## 変更済みファイル

### [path/to/file.ext]
**変更内容**: [何を変えたか]
**理由**: [なぜ変えたか]
（diff は貼らない — `<スナップショットパス>.git.txt` に verbatim で退避済み。git 管理外の変更のみ before/after を貼る）

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

verbatim 全量を退避済み → `Read <スナップショットパス（.md を .git.txt に変えたもの）>`
[status の要点を2〜3行で（ブランチ名・未コミット件数）。diff の複写はしない]

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

**NGがあれば、Edit ツールで該当セクションだけ直す（全文の書き直しは禁止 — 時間が倍になる）。**

## Phase 4: clear実行

```
/clear
```

## Phase 5: 復元（clear後の最初の行動）

スナップショットは **cwd をキー**にしているので、`/clear` で session_id が変わっても `snapshot-path.sh` は clear 後も同じパスを返す（同じ作業ディレクトリにいる限り）。UserPromptSubmit フックが自動注入もする。復元系コマンドは必ずスナップショットを作成した作業ディレクトリで実行すること。

1. `Read "$(bash ~/.claude/hooks/snapshot-path.sh)"` を実行（PowerShell では `& "$env:USERPROFILE\.claude\hooks\snapshot-path.ps1"` が出したパスを Read。フックが既に注入済みなら不要）
2. ユーザーへ報告：「コンテキストを復元しました。[ゴール]の続きから：[次のアクション1]を実行します」
3. 「次のアクション」から即作業開始（git の詳細が必要になったら `.git.txt` をその時点で Read する — 先読みしない）
4. ファイル削除（.git.txt も一緒に）：

```bash
SNAP="$(bash ~/.claude/hooks/snapshot-path.sh)"; rm -f "$SNAP" "${SNAP%.md}.git.txt"
```

```powershell
$SNAP = & "$env:USERPROFILE\.claude\hooks\snapshot-path.ps1"; Remove-Item -LiteralPath $SNAP, ($SNAP -replace '\.md$', '.git.txt') -Force -ErrorAction SilentlyContinue
```

## よくある失敗

| 失敗 | 正しい対処 |
|---|---|
| 未保存の書きかけコードを「修正中」と書いて実物を省く | ディスクにない断片は実物を貼る（保存済みなら file:行 参照） |
| 保存済みコードや git diff をスナップショットに複写する | .git.txt / file:行 参照にする（複写は作成と注入の両方を遅くする） |
| エラーを要約して書く | エラー出力全体をverbatimで貼る（エラーは会話にしか存在しない） |
| 「次はXを実装する」と書く | `bun run build && bun test` のような実行可能な形で書く |
| 会話のやり取りを省く | ユーザーの訂正・フィードバックは必ず記録する |
| 空セクションにテンプレの雛形を複写する | 「なし」の1行にする |
