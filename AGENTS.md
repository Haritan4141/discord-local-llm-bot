# AGENTS.md

このリポジトリで作業するコーディングエージェント向けのガイドです。

## 概要
- Discord 上でローカル LLM (Ollama) と会話できるボット
- 指定チャンネルのみ応答 ( `CHANNEL_IDS` )
- 1発言=1返信の即レス式キュー処理
- 画像添付は Vision 形式で LLM に送信
- `!draw` で Stable Diffusion WebUI (AUTOMATIC1111) を呼び出し

## 主要ファイル
- `index.mjs` : 本体 (Discord 受信、Ollama 連携、`!draw` 画像生成)
- `README.md` : 使い方・セットアップ手順
- `.env` / `.env.example` : 環境変数 (秘密情報に注意)
- `start-bot.bat` : Bot 起動
- `start-ollama.bat` : Ollama 起動

## 実行の前提
- Node.js 18 以降 (fetch 使用)
- Discord Bot トークン
- Ollama (OpenAI 互換 chat/completions)
- Optional: Stable Diffusion WebUI ( `--api` 起動 )

## 重要な注意
- `.env` は機密情報を含むためコミットしない
- `CHANNEL_IDS` 未設定時は起動時にエラー
- UTF-8 でファイルを保存すること
- 日本語の文字化けに注意 (特に `index.mjs`, `.env.example`, `README.md`)
