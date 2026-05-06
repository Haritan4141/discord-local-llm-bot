# AGENTS.md

このリポジトリで作業するコーディングエージェント向けのガイドです。

## 概要
- Discord 上でローカル LLM (Ollama / LM Studio などの OpenAI 互換 API) と会話できるボット
- 指定チャンネルのみ応答 ( `CHANNEL_IDS` )
- 通常メッセージと `/chat` / `/webchat` をチャンネル単位のキューで 1発言=1返信処理
- 画像添付は Vision 形式で LLM に送信
- LLM Provider は `LLM_PROVIDER` / `LLM_BASE_URL` / `LLM_MODEL` で設定 (`OLLAMA_*` は fallback)
- Ollama のモデル保持時間は `OLLAMA_KEEP_ALIVE` で設定。`start-ollama.bat` と Bot 起動時 preload で使用
- `/webchat` で Ollama Web Search / Web Fetch を使った検索付き会話
- `/draw` で Stable Diffusion WebUI (AUTOMATIC1111) を呼び出し
- `/music` で ComfyUI または ACE-Step を使った音楽生成を呼び出し
- `/othello` でリアクション操作のオセロ (VS AI) を開始
- ローカル GUI で `.env` 設定、保存、Bot 起動/停止、ログ表示

## 主要ファイル
- `index.mjs` : 本体 (Discord 受信、Ollama 連携、スラッシュコマンド処理)
- `gui-server.mjs` : ローカル GUI サーバー (`http://127.0.0.1:3150`)
- `gui/` : GUI の HTML/CSS/JS
- `register-commands.mjs` : スラッシュコマンド登録
- `clear-guild-commands.mjs` / `clear-global-commands.mjs` : 登録済みコマンド削除
- `README.md` : 使い方・セットアップ手順
- `.env` / `.env.example` : 環境変数 (秘密情報に注意)
- `comfyui/workflows/` : `/music` 用 ComfyUI workflow
- `start-gui.bat` : GUI 起動
- `start-bot.bat` : Bot 起動
- `start-ollama.bat` : Ollama 起動

## 実行の前提
- Node.js 18 以降 (fetch 使用)
- Discord Bot トークン
- Discord Application の `CLIENT_ID` と、ギルド登録用の `GUILD_ID`
- Ollama / LM Studio / Custom OpenAI 互換 chat/completions
- Optional: Ollama model keep-alive (`OLLAMA_KEEP_ALIVE`, 例: `30m`, `1h`, `-1`)
- Optional: Ollama Web Search API key (`OLLAMA_WEB_API_KEY`)
- Optional: Stable Diffusion WebUI ( `--api` 起動 )
- Optional: ComfyUI ( `--listen` 起動 ) または ACE-Step API

## 重要な注意
- `.env` は機密情報を含むためコミットしない
- `CHANNEL_IDS` 未設定時は起動時にエラー
- `LLM_*` が優先され、旧 `OLLAMA_URL` / `OLLAMA_MODEL` は互換 fallback として扱う
- `OLLAMA_KEEP_ALIVE` は Ollama 利用時のみ有効。`-1` は常時ロードだが VRAM / RAM を占有し続ける
- `/webchat` は `OLLAMA_WEB_API_KEY` が必要。検索自体は Ollama のクラウド API を使い、回答生成の LLM provider とは独立
- GUI 起動時に `.env` がなければ `.env.example` から自動作成される
- スラッシュコマンドを変更したら GUI の `Register Commands` または `node register-commands.mjs` を実行する
- UTF-8 でファイルを保存すること
- 日本語の文字化けに注意 (特に `index.mjs`, `gui/`, `.env.example`, `README.md`)
