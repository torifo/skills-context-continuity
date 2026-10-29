---
name: context-snapshot-refresh
description: Use when the user asks to refresh the context (「コンテキストリフレッシュして」「リフレッシュして」「context refresh」) or when the context-refresh mod asks for a snapshot - writes the same complete session snapshot as context-snapshot-clear, then ends the turn; the mod empties the conversation (session_id kept) and triggers context-restore. Never run /clear or /compact yourself.
---

# Context Snapshot Refresh

> `/context-refresh` の内部ステップ。流れ：**このスキル（snapshot 作成）→ mod が会話を0にする（session_id 維持）→ mod が context-restore を起動**。
> 旧フロー（context-snapshot-clear → /clear → context-restore）とは独立・並行運用。

## Overview

**判定基準：「clear後のClaudeがこのファイルだけ読んで、ユーザーに何も聞かずに作業を続けられるか？」**

説明ではなく実物を記録する。コードは実際のコード、エラーはverbatim、次のアクションは実行できるコマンド。

**速度の大原則：モデルが書き出すのは「会話にしか存在しない情報」だけ。ディスク上に既にあるもの（git diff・保存済みコード）はシェルで退避してパス参照する。** 出力トークンの再生成が最大の時間コストであり、復元時の注入量も膨らませる。

## Phase 0: 起動経路の確認

- **mod から「context-snapshot-refresh を実行」というプロンプトが来た**（`/context-refresh` か 90% 自動）→ mod は準備済み。そのまま Phase 1 へ。
- **ユーザーが自然言語で頼んだ**（「コンテキストリフレッシュして」など）→ 最初に `mcp__context-refresh__refresh` ツールを呼ぶ（引数なし）。結果の指示どおり、同じターンで Phase 1 へ進む。
- **そのツールが無い**（mod が読み込まれていないセッション。mod の設定はプロセス起動時にしか読まれないので、導入前から続くセッションがこれに当たる）→ **スナップショットは書かない**（書くと次のプロンプトで先に注入され、復元とリフレッシュが混ざる）。次のとおり案内してターンを終える：
  「このセッションは mod を入れる前に起動したので、リフレッシュの仕組みが入っていません。デスクトップアプリなら ⌘Q で終了して開き直し、このセッションをもう一度開いてから同じように頼んでください（session_id はそのままで mod が入ります。ターミナルなら `claude --resume <id>`）。今すぐ空にしたい場合は context-snapshot-clear と `/clear` で進めます（session_id は変わります）。」

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

`Context at Save` には mod から伝えられた値（ツールの結果か mod のプロンプトにある「Context at Save には N% と書くこと」）をそのまま書く。自分では推測しない。伝えられていなければ「不明」。

ターンが終わると、mod が末尾に「付録：会話記録からの自動抽出」を追記する（ユーザーの発言の原文、編集したファイル、会話に出た URL、空にする前の会話が残る記録ファイルのパス）。付録は機械的な抜き出しなので、どれが今も使うものか、どれが置き換え済みかは分からない。その判断は本文に書く（特に「公開・共有したもの」）。付録の「編集したファイル」は Edit / Write / NotebookEdit の分だけで、Bash やスクリプトで書き換えたファイルは出ないので、それは本文の「変更済みファイル」に必ず書く。

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

## 公開・共有したもの

- [URL またはパス]（Artifact・Slack のスレッドや下書き・PR・配布ファイルなど）— [何か] ／ [最新か、置き換え済みか（何に置き換えたか）]
（同じものの旧版も書く。復元後の「あのスライド」「あのスレッド」がどれを指すか分かるように）

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
| 公開・共有したものに URL と最新かどうかがあるか | 「スライドを作った」 | 「`https://…/CYgK…` は旧版。配布するのは `~/…/refresh-slides.pdf`」 |
| ユーザーへの確認が0件で続けられるか | — | **これが最終基準** |

**NGがあれば、Edit ツールで該当セクションだけ直す（全文の書き直しは禁止 — 時間が倍になる）。**

## Phase 4: ターンを終える（refresh は mod が行う）

スナップショットを書き終えたら、**「スナップショット作成完了」の1行だけ返してターンを終える**。
`/clear` も `/compact` も実行しない・ユーザーに打たせない。ターン終了を context-refresh mod が検知し、
スナップショットが今回書かれたこと（mtime）を確認してから、会話を完全に空にして context-restore 用のプロンプトを自動送信する。

## Phase 5: 復元（mod が送るプロンプトで自動開始）

refresh 後の最初のプロンプトで UserPromptSubmit フック（restore-context.sh）がスナップショットを自動注入する。以降は context-restore スキルの手順どおり（報告 → 作業再開 → スナップショット削除）。
注入されていなければ `Read "$(bash ~/.claude/hooks/snapshot-path.sh)"`（PowerShell では `& "$env:USERPROFILE\.claude\hooks\snapshot-path.ps1"` が出したパス）。
スナップショットにも付録にも無いことは、ユーザーに聞く前に付録の記録ファイルを検索する（手順は context-restore）。

## よくある失敗

| 失敗 | 正しい対処 |
|---|---|
| 未保存の書きかけコードを「修正中」と書いて実物を省く | ディスクにない断片は実物を貼る（保存済みなら file:行 参照） |
| 保存済みコードや git diff をスナップショットに複写する | .git.txt / file:行 参照にする（複写は作成と注入の両方を遅くする） |
| エラーを要約して書く | エラー出力全体をverbatimで貼る（エラーは会話にしか存在しない） |
| 「次はXを実装する」と書く | `bun run build && bun test` のような実行可能な形で書く |
| 会話のやり取りを省く | ユーザーの訂正・フィードバックは必ず記録する |
| 空セクションにテンプレの雛形を複写する | 「なし」の1行にする |
| 書き終えた後に /clear や /compact を案内する | 何もしない。mod が自動で続ける |
