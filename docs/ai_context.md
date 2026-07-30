# AI Context

## プロジェクト概要

このプロジェクトは、Discord 上でローカル LLM または OpenAI API と会話できる Bot です。通常メッセージ、`/chat`、`/webchat` を処理し、画像添付、テキスト添付、Stable Diffusion WebUI による `/draw`、ComfyUI / ACE-Step による `/music`、リアクション操作の `/othello` に対応しています。

主な技術スタック:
- Node.js 18+
- `discord.js` v14
- `dotenv`
- OpenAI Responses API / Ollama / LM Studio / Custom OpenAI-compatible API
- Stable Diffusion WebUI (AUTOMATIC1111)
- ComfyUI / ACE-Step

主要ファイル:
- `index.mjs`: エントリシム
- `src/bot.mjs`: Discord クライアント本体
- `src/config.mjs`: `.env` 読込とランタイム設定
- `src/discord/queue.mjs`: 通常チャット、画像、Web 検索の処理キュー
- `src/llm/`: OpenAI Responses / Chat Completions 呼び出しと診断ログ
- `src/web/`: OpenAI 公式 API 以外で使う Ollama Web Search / URL fetch / auto-search router
- `src/standby/`: Main Bot 停止中に同じ Bot で固定返信する Standby モード
- `gui-server.mjs`, `gui/`: ローカル GUI
- `register-commands.mjs`: スラッシュコマンド登録
- `tests/`: `node --test` によるユニットテスト

起動・検証コマンド:
- 依存関係: `npm install`
- GUI 起動: `start-gui.bat` または `npm run gui`
- Main Bot 起動: `start-bot.bat` または `npm start`
- Standby モード起動: `start-standby-bot.bat` または `npm run standby`
- 構文チェック: `npm run check`
- テスト: `npm test`
- ギルドコマンド登録: `npm run register:guild`
- グローバルコマンド登録: `npm run register:global`

## 現在の作業目的

現在の目的は、OpenAI API 接続時に Responses API と公式 `web_search` を利用し、Discord から検索付き回答を得られるようにすることです。

達成したい状態:
- OpenAI 接続は Responses API を使う
- `/webchat` は公式検索必須、`WEB_SEARCH_MODE=auto` はモデル判断、`manual` の通常会話は検索なし
- OpenAI 以外の既存 Chat Completions / Ollama Web Search 経路を維持する
- GUI、`.env.example`、README の説明を同じ仕様に揃える

変更範囲:
- `src/llm/`
- `src/discord/queue.mjs`
- `src/config.mjs`
- `gui-server.mjs`
- `gui/app.js`
- `.env.example`
- `README.md`
- `tests/`

## これまでに実施した作業

既存の主要実装:
- `index.mjs` を薄いエントリにし、`src/` 配下へ分割済み
- `WEB_SEARCH_MODE=manual|auto`
- 現在日時を system message に注入
- URL を含むメッセージは Web 経路で直接 `web_fetch`
- 通常メッセージのテキスト添付読取
- `/systemprompt` / `/systemprompt-show`
- GUI の Host / Origin / `X-GUI-Token` 検証
- `tests/` 配下のユニットテスト

今回の OpenAI Responses 関連:
- OpenAI Provider または `https://api.openai.com` を自動判定
- 通常会話、履歴、Vision 入力を Responses API 形式へ変換
- `/webchat` は `tool_choice=required`、`auto` は `tool_choice=auto`
- 検索結果の引用元 URL を Discord 返信末尾に表示
- OpenAI 返信末尾と GUI ログに Web 検索回数、参照 URL 数、推論トークン数を表示
- OpenAI 内蔵 Web ツールは既定で 1 回の回答につき最大 2 回、Sources URL はリンクプレビューを抑制して最大 1 件表示
- OpenAI 利用時は `OLLAMA_WEB_API_KEY` 不要
- Payload 生成、応答解析、検索モード判定のユニットテストを追加

今回の Standby 関連:
- 追加済み:
  - `src/standby/config.mjs`
  - `src/standby/bot.mjs`
  - `standby-bot.mjs`
  - `start-standby-bot.bat`
  - `tests/standby-config.test.mjs`
- GUI に追加済み:
  - Standby 設定セクション
  - `Start Standby Bot` / `Stop Standby Bot` / `Restart Standby Bot`
  - Main Bot / Standby モードの状態表示
  - Main Bot / Standby モードの相互排他
- 方針変更:
  - もともとは「別 Bot / 別 Token」前提で実装していた
  - 現在は「同じ `DISCORD_TOKEN` を使う待機用プロセス」に変更
  - `STANDBY_DISCORD_TOKEN` は削除

採用した方針:
- 「停止中でも返答したい」を、同じ Bot の軽量待機プロセスで解決する
- Main Bot と Standby モードは同時起動不可にする
- Standby モードは固定返信だけに限定し、LLM やスラッシュコマンドは持たせない

## 未完了タスク

現時点の残作業:
- ユーザー環境の OpenAI API キーで Discord 実機の通常会話、`/webchat`、`auto` 検索を確認
- 実機で GUI から Standby モードの起動・停止・再起動を確認
- 実機で Standby モードの固定返信とクールダウンを確認
- 必要なら GUI の文言や README の説明をさらに調整

既知の制約:
- Standby モードでも Discord にログインするプロセスは必要
- PC 自体が停止している、GUI も停止している、ネットワークがない、という状態では返信できない
- Main Bot と Standby モードの同時起動は不可

## 動作確認・検証状況

実行済み:
- `npm run check`
- `npm test`
- `node gui-server.mjs` 起動確認
- GUI の `/` と `/api/config` への疎通確認

確認できていること:
- 構文エラーなし
- ユニットテスト通過
- GUI で Standby セクションが返る
- Main Bot / Standby モードの管理 API が存在する

まだ未確認:
- OpenAI API への実リクエスト（API キーと課金を不用意に使わないため未実施）
- Discord 実機での OpenAI `/webchat` と引用 URL 表示
- Discord 実機での Standby モード起動
- 固定返信の内容
- クールダウン挙動

## 重要なファイル・ディレクトリ

- `src/bot.mjs`: Main Bot 本体
- `src/config.mjs`: 環境変数と主要設定
- `src/discord/queue.mjs`: チャット処理キュー
- `src/llm/chat.mjs`: LLM 呼び出し
- `src/web/context.mjs`: Web 検索コンテキスト生成
- `src/web/router.mjs`: `WEB_SEARCH_MODE=auto` 判定
- `src/standby/config.mjs`: Standby モード設定
- `src/standby/bot.mjs`: Standby モード本体
- `gui-server.mjs`: GUI サーバーと Main/Standby プロセス管理
- `gui/index.html`, `gui/app.js`, `gui/styles.css`: GUI
- `README.md`: 利用者向け手順
- `AGENTS.md`: コーディングエージェント向け注意

## 注意事項・制約

- `.env` は機密情報を含むためコミットしない
- 既存の Main Bot 機能を壊さない
- Standby モードは Main Bot の代替ではなく、固定返信専用に保つ
- UTF-8 を維持する
- 日本語の文字化けに注意する
- GUI の `X-GUI-Token` と `Host` / `Origin` 検証は維持する

## Git 操作に関する厳守事項

禁止:
- `git reset`
- `git reset --hard`
- `git clean`
- `git checkout -- .`
- `git restore .`
- `git push --force`
- `git push -f`
- `git rebase`
- 履歴を書き換える操作
- ユーザーの許可なくファイル削除

ルール:
- commit / push / pull / merge などはユーザー確認後
- 既存の変更を勝手に破棄しない
- Git 操作を提案する場合は実行内容とリスクを説明する

## 運用ルール

- 重要な進捗があったらこのファイルを更新する
- 方針変更、重要実装、問題発見、未完了タスクの増減を必ず反映する
- 作業を中断する前、または一段落した時点で更新する
- 次回セッションの AI が最初に読む前提で、簡潔かつ具体的に書く

## 更新履歴

- 2026-07-10
  - OpenAI Responses API と公式 `web_search` を追加
  - `/webchat` の検索必須、`WEB_SEARCH_MODE=auto` の任意検索を Provider 別に実装
  - GUI / `.env.example` / README / テストを更新
- 2026-05-31
  - Standby モードを「別 Bot / 別 Token」前提から「同じ `DISCORD_TOKEN` を使う待機プロセス」前提に変更
  - `STANDBY_DISCORD_TOKEN` を廃止
  - GUI / `.env.example` / README / AGENTS / このファイルの説明を更新
- 2026-05-11 まで
  - `src/` 分割
  - `WEB_SEARCH_MODE=auto`
  - `/systemprompt`
  - テキスト添付読取
  - 各種テスト追加
