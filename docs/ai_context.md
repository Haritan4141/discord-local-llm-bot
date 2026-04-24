# AI Context

## プロジェクト概要

このプロジェクトは、Discord 上でローカル LLM と会話し、画像生成や音楽生成も扱える Bot です。通常メッセージとスラッシュコマンドの両方に対応しており、ローカル GUI から `.env` の設定編集、Bot の起動停止、ログ確認ができます。

主な技術スタック:
- Node.js 18+
- `discord.js`
- `dotenv`
- OpenAI 互換 API を使うローカル LLM バックエンド
  - Ollama
  - LM Studio
  - Custom OpenAI-compatible API
- Stable Diffusion WebUI (AUTOMATIC1111) API
- ComfyUI または ACE-Step API
- GUI はローカル HTTP サーバー + HTML / CSS / JavaScript

起動・確認コマンド:
- 依存関係インストール: `npm install`
- GUI 起動: `start-gui.bat` または `npm run gui`
- Bot 直接起動: `start-bot.bat` または `npm start`
- コマンド登録: `npm run register`
- ギルドコマンド削除: `npm run clear:guild`
- グローバルコマンド削除: `npm run clear:global`
- 構文チェック: `npm run check`
- テスト相当: `npm test` (`npm run check` の別名)

重要なディレクトリ・ファイル:
- `index.mjs`: Bot 本体。Discord 受信、LLM 呼び出し、スラッシュコマンド処理
- `gui-server.mjs`: ローカル GUI サーバー
- `gui/`: GUI の HTML / CSS / JS
- `register-commands.mjs`: スラッシュコマンド登録
- `clear-guild-commands.mjs`, `clear-global-commands.mjs`: コマンド削除
- `.env`, `.env.example`: ローカル設定
- `README.md`: セットアップと運用手順
- `AGENTS.md`: エージェント向けの現行ガイド
- `start-gui.bat`, `start-bot.bat`, `start-ollama.bat`: Windows 起動補助
- `comfyui/workflows/`: `/music` 用 ComfyUI workflow

## 現在の作業目的

今回の依頼は、今後の作業引き継ぎ用に `docs/ai_context.md` を作成し、セッションをまたいでも現状をすぐ把握できる状態にすることです。

最終的に達成したい状態:
- 新規チャットや再起動後でも、このファイルだけで現在の構成と作業経緯を把握できる
- 重要な設計判断と注意事項がリポジトリ内に残る
- 次の AI エージェントが迷わず作業再開できる

変更対象の範囲:
- `docs/ai_context.md` の新規作成
- 必要に応じて今後このファイルを継続更新

## これまでに実施した作業

これまでの主要な変更内容:
- ドキュメントを現行実装に合わせて整理
  - `AGENTS.md`
  - `README.md`
  - `.env.example`
  - `clear-guild-commands.mjs`
  - `package.json`
- ローカル GUI を追加
  - `.env` の読込・保存
  - GUI 起動時に `.env` が無ければ `.env.example` から自動生成
  - Bot 起動 / 停止 / 再起動
  - スラッシュコマンド登録
  - ログ表示
- LLM Provider 切り替えを追加
  - `LLM_PROVIDER`
  - `LLM_BASE_URL`
  - `LLM_MODEL`
  - `LLM_API_KEY`
  - 旧 `OLLAMA_URL` / `OLLAMA_MODEL` は fallback として維持
- GUI で LLM モデル一覧取得に対応
  - Provider ごとのモデル取得
  - モデル候補から選択可能な UI を追加
- `/draw` 完了メッセージを修正
  - `done.` を `生成完了` に変更
  - 翻訳が入った場合に `translated prompt: ...` を表示

追加された主要ファイル:
- `gui-server.mjs`
- `gui/index.html`
- `gui/app.js`
- `gui/styles.css`
- `start-gui.bat`
- `docs/ai_context.md`

調査して分かったこと:
- `start-bot.bat` 実行時に画面へエラーが出ない場合でも、実際の原因は `bot.log` に出る
- 以前の Bot 起動失敗は `.env` ではなく `node_modules` 未導入が原因だった
- `/draw` の 404 は `SD_WEBUI_URL` の到達性ではなく、AUTOMATIC1111 側で `--api` が有効でないことが原因だった
- LM Studio は OpenAI 互換 API として扱えるため、Ollama 専用実装にしない方が保守しやすい
- 一時的に `LLM_OUTPUT_CLEANUP` を検討・実装したが、採用せずに元へ戻した。現在はその機能は存在しない

採用した方針:
- 既存の Bot 実装を大きく壊さず、GUI と設定整理を足す方向で進める
- LLM 接続は provider 固有実装ではなく OpenAI 互換 API を基準に寄せる
- 旧環境変数は即削除せず fallback として残し、移行コストを下げる
- ドキュメントは実装基準に合わせて更新する

直近のコミット履歴:
- `992b3a6 fix: improve draw completion message`
- `a0d9bc7 feat: add local GUI and LLM provider selection`
- `be255f0 docs: align project docs with current commands`

## 未完了タスク

現時点で明示的に依頼されている未完了の実装タスクはありません。次回以降は以下を確認してから作業を始めること。

- 新しい機能追加や仕様変更の依頼内容
- `.env` と GUI の設定項目が現行コードとずれていないか
- スラッシュコマンド追加・変更時に `register-commands.mjs` の再実行が必要か
- GUI のモデル一覧取得が対象 Provider で継続して動いているか

保留中の判断:
- なし。新しい仕様変更が入ったら本ファイルに追記する

既知の問題・注意ポイント:
- `README.md` や一部日本語ファイルは文字コードを崩しやすい。UTF-8 で扱うこと
- `.env` はユーザーのローカル設定そのものなので、勝手に書き換えないこと
- 実サービス接続の確認は環境依存のため、ローカル環境で再検証が必要になることがある

## 動作確認・検証状況

このファイル作成時点で確認したこと:
- `git status --short --branch --ignored`
  - `main...origin/main`
  - 追跡対象の未コミット差分なし
  - ignore 対象は `.env`, `bot.log`, `node_modules/`
- `git log --oneline --decorate -5`
  - 最新コミットは `/draw` 完了メッセージ修正
- `package.json`
  - `gui`, `start`, `register`, `clear:guild`, `clear:global`, `check`, `test` の script が定義済み

過去セッションで実施済みの確認:
- `npm run check` は通過済み
- GUI は起動確認済み
- `.env` 読込 / 保存、Bot 起動導線、ログ表示の UI は動作確認済み
- `/draw` は API 有効化後に生成成功を確認済み
- LLM Provider 切り替えとモデル選択 UI は確認済み

まだ確認できていないこと:
- すべての Provider / すべてのモデルでの長期運用
- ComfyUI / ACE-Step の全パターン
- 実運用サーバーでの権限差異による Discord コマンド問題

現時点で把握しているテスト・ビルドエラー:
- なし

## 重要なファイル・ディレクトリ

- `index.mjs`
  - Bot の中心実装
  - 通常メッセージ、`/chat`, `/draw`, `/music`, `/othello` などを処理
- `gui-server.mjs`
  - GUI の HTTP サーバー
  - `.env` 読込保存、Bot 制御、ログ取得、モデル一覧取得
- `gui/index.html`
  - GUI レイアウト
- `gui/app.js`
  - GUI のイベント処理と API 呼び出し
- `gui/styles.css`
  - GUI の見た目
- `register-commands.mjs`
  - Discord スラッシュコマンドをギルドへ登録
- `clear-guild-commands.mjs`
  - ギルドコマンド削除
- `clear-global-commands.mjs`
  - グローバルコマンド削除
- `.env.example`
  - 設定テンプレート
- `README.md`
  - 利用手順と設定説明
- `AGENTS.md`
  - 作業時の運用ルールとプロジェクト概要
- `bot.log`
  - GUI / Bot / コマンド処理のログ

## 注意事項・制約

- 既存の仕様を壊さないこと
- 影響範囲が大きい変更は、理由と影響範囲を明確にしたうえで進めること
- ユーザーが作成・変更したファイルを勝手に上書きしないこと
- 自分が変更していない差分を勝手に修正・削除しないこと
- 不明点がある場合は推測で大きく進めず、必要に応じて確認すること
- `.env` は機密情報を含むためコミットしないこと
- `CHANNEL_IDS` が未設定だと起動時エラーになる
- `LLM_*` が優先され、`OLLAMA_*` は互換 fallback として扱う
- GUI 起動時に `.env` が無ければ `.env.example` から自動生成される
- スラッシュコマンド変更後は GUI の `Register Commands` または `npm run register` を実行すること
- 日本語ファイルは UTF-8 を維持すること

## Git 操作に関する厳守事項

危険な Git 操作は絶対に行わないこと。特に以下は禁止:
- `git reset`
- `git reset --hard`
- `git clean`
- `git checkout -- .`
- `git restore .`
- `git push --force`
- `git push -f`
- `git rebase`
- 履歴を書き換える操作
- ユーザーの許可なくファイルを削除する操作

Git 操作の運用ルール:
- コミット、ブランチ作成、push、pull、merge、rebase などが必要そうな場合は、実行前に必ずユーザーに確認する
- 既存の変更を勝手に破棄しない
- Git 操作を提案する場合は、実行内容とリスクを説明する
- 作業前に `git status` を確認し、自分が触っていない差分を壊さない

## 運用ルール

- 重要な進捗があったら `docs/ai_context.md` を随時更新する
- 方針変更、重要な実装完了、問題の発見、未完了タスクの追加・解決があった場合は必ず追記する
- 作業を中断する前、または一段落したタイミングで、最新状況を反映する
- 次回セッションの AI エージェントが最初に読む前提で、簡潔かつ具体的に書く
- 既存内容を消すより、経緯が分かる形で追記・整理を優先する
- 実装とドキュメントが食い違ったら、実装を確認したうえで両方更新する

## 更新履歴

- 2026-04-24
  - `docs/ai_context.md` を新規作成
  - 現時点の実装状況、設計判断、注意事項、Git 制約、検証状況を整理
  - 今後のセッション引き継ぎ用のベース文書として運用開始
