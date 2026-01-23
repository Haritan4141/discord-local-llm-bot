# discord-local-llm-bot

Discord 上でローカル LLM (Ollama) と会話できるボット。特定チャンネルのみ反応し、画像添付を Vision 形式で渡す簡易対応も入っています。さらに `/draw` で Stable Diffusion WebUI (AUTOMATIC1111) の画像生成も呼び出せます。

## 主な機能
- 指定チャンネルのみ応答 (`CHANNEL_IDS` で制限)
- 1発言=1返信の即レス式キュー処理
- 会話履歴の簡易保持 (最大 30 メッセージ)
- 画像添付を Vision 形式で LLM に送信
- `/draw` で Stable Diffusion WebUI 画像生成
- `/othello` でオセロ (VS AI) をリアクション操作でプレイ

## 必要なもの
- Node.js 18 以上 (fetch を使用)
- Discord Bot トークン
- Ollama (OpenAI 互換の chat/completions エンドポイント)
- Optional: Stable Diffusion WebUI (AUTOMATIC1111, `--api` 起動)

## セットアップ
1) 依存関係をインストール
```bash
npm install
```

2) 環境変数の設定
```bash
copy .env.example .env
```
`.env` を編集して以下を設定します。
- `DISCORD_TOKEN` (必須)
- `CHANNEL_IDS` (必須: カンマ区切りで複数可)
- `OLLAMA_URL` (必須: 例 `http://127.0.0.1:11434/v1/chat/completions`)
- `OLLAMA_MODEL` (必須: 例 `gemma3:12b`)
- `SYSTEM_PROMPT` (任意)
- `SD_WEBUI_URL` など `SD_*` (任意: `/draw` 用)

3) スラッシュコマンド登録
```bash
node register-commands.mjs
```

4) 起動
```bash
# Ollama 起動 (別ターミナル)
start-ollama.bat

# Bot 起動
start-bot.bat
```
PowerShell から起動する場合は `node index.mjs` でも動きます。

## コマンド
- `/help` : ヘルプ表示
- `/status` : 状態表示
- `/chat [message] [image]` : LLMと会話 (画像は任意)
- `/persona [text] [reset]` : 口調/人格の上書き・リセット
- `/draw prompt [width] [height] [steps] [cfg] [sampler] [seed] [batch] [negative]` : 画像生成 (WebUI 起動時のみ)
- `/othello [difficulty]` : オセロ開始（リアクション操作）
- `/pause` : そのチャンネルで停止
- `/resume` : 再開
- `/reset` : そのチャンネルの履歴をリセット

## `/draw` オプション例
```text
/draw prompt:"a cute cat" width:512 height:512 steps:25 cfg:7 sampler:"Euler a"
```

## 画像入力について
- 最初は画像添付のみを認識します
- 10MB を超える画像は拒否されます

## 注意
- `.env` は秘匿情報を含むため GitHub にコミットしないでください
- `CHANNEL_IDS` を設定しないと起動時にエラーになります

## ライセンス
ISC (package.json に準拠)
