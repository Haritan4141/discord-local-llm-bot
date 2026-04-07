# AGENTS.md

このリポジトリで作業するコーディングエージェント向けのガイドです。

## 概要
- Discord 上でローカル LLM (Ollama) と会話できるボット
- 指定チャンネルのみ応答 ( `CHANNEL_IDS` )
- 通常メッセージと `/chat` をチャンネル単位のキューで 1発言=1返信処理
- 画像添付は Vision 形式で LLM に送信
- `/draw` で Stable Diffusion WebUI (AUTOMATIC1111) を呼び出し
- `/music` で ComfyUI または ACE-Step を使った音楽生成を呼び出し
- `/othello` でリアクション操作のオセロ (VS AI) を開始

## 主要ファイル
- `index.mjs` : 本体 (Discord 受信、Ollama 連携、スラッシュコマンド処理)
- `register-commands.mjs` : スラッシュコマンド登録
- `clear-guild-commands.mjs` / `clear-global-commands.mjs` : 登録済みコマンド削除
- `README.md` : 使い方・セットアップ手順
- `.env` / `.env.example` : 環境変数 (秘密情報に注意)
- `comfyui/workflows/` : `/music` 用 ComfyUI workflow
- `start-bot.bat` : Bot 起動
- `start-ollama.bat` : Ollama 起動

## 実行の前提
- Node.js 18 以降 (fetch 使用)
- Discord Bot トークン
- Discord Application の `CLIENT_ID` と、ギルド登録用の `GUILD_ID`
- Ollama (OpenAI 互換 chat/completions)
- Optional: Stable Diffusion WebUI ( `--api` 起動 )
- Optional: ComfyUI ( `--listen` 起動 ) または ACE-Step API

## 重要な注意
- `.env` は機密情報を含むためコミットしない
- `CHANNEL_IDS` 未設定時は起動時にエラー
- スラッシュコマンドを変更したら `node register-commands.mjs` を実行する
- UTF-8 でファイルを保存すること
- 日本語の文字化けに注意 (特に `index.mjs`, `.env.example`, `README.md`)
