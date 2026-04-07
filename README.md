# discord-local-llm-bot

Discord 上でローカル LLM (Ollama) と会話できるボットです。指定チャンネルだけで応答し、通常メッセージと `/chat` をチャンネル単位のキューで処理します。画像添付の Vision 入力、Stable Diffusion WebUI による `/draw`、ComfyUI / ACE-Step による `/music`、リアクション操作の `/othello` に対応しています。

## 主な機能
- 指定チャンネルのみ応答 (`CHANNEL_IDS` で制限)
- 通常メッセージと `/chat` の 1発言=1返信キュー処理
- 会話履歴の簡易保持 (最大 30 メッセージ)
- 画像添付を Vision 形式で LLM に送信
- `/persona` によるチャンネル別の人格上書き
- `/draw` で Stable Diffusion WebUI (AUTOMATIC1111) 画像生成
- `/music` で ComfyUI または ACE-Step による音楽生成
- `/othello` でオセロ (VS AI) をリアクション操作でプレイ
- `/pause` / `/resume` / `/reset` によるチャンネル単位の制御

## 必要なもの
- Node.js 18 以上 (fetch を使用)
- Discord Bot トークン
- Discord Application の `CLIENT_ID`
- スラッシュコマンドを登録する Discord サーバーの `GUILD_ID`
- Ollama (OpenAI 互換の chat/completions エンドポイント)
- Optional: Stable Diffusion WebUI (AUTOMATIC1111, `--api` 起動)
- Optional: ComfyUI (`--listen` 起動) または ACE-Step API

## セットアップ
1. 依存関係をインストール

```bash
npm install
```

2. 環境変数の設定

```bat
copy .env.example .env
```

`.env` で最低限必要な値:

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`
- `CHANNEL_IDS` (カンマ区切りで複数可)
- `OLLAMA_URL` (例: `http://127.0.0.1:11434/v1/chat/completions`)
- `OLLAMA_MODEL` (例: `gemma3:12b`)

任意の値:

- `SYSTEM_PROMPT`
- `SD_WEBUI_URL` と `SD_*` (`/draw` 用)
- `SD_PROMPT_TRANSLATE` と `SD_PROMPT_TRANSLATE_MODEL` (`/draw` の日本語プロンプト翻訳用)
- `MUSIC_BACKEND` (`comfyui` または `ace`)
- `COMFY_URL` と `COMFY_WORKFLOW_PATH` (`/music` の ComfyUI 用)
- `ACE_URL` / `ACE_POLL_MS` / `ACE_API_KEY` (`/music` の ACE-Step 用)

3. スラッシュコマンド登録

```bash
npm run register
```

`register-commands.mjs` はデフォルトでギルド登録を行います。グローバル登録に切り替える場合は、ファイル内のコメントに従って登録先を変更してください。

4. 起動

```bat
start-ollama.bat
start-bot.bat
```

PowerShell やターミナルから直接起動する場合:

```bash
npm start
```

## コマンド
- `/help` : ヘルプ表示
- `/status` : 状態表示
- `/chat [message] [image]` : LLM と会話 (画像は任意)
- `/persona [text] [reset]` : 口調/人格の上書き・リセット
- `/persona-show` : 現在の persona 設定を表示
- `/draw prompt [width] [height] [steps] [cfg] [sampler] [seed] [batch] [negative]` : 画像生成
- `/music prompt [duration] [lyrics] [bpm] [language]` : 音楽生成
- `/othello [difficulty]` : オセロ開始 (リアクション操作)
- `/pause` : そのチャンネルで停止
- `/resume` : 再開
- `/reset` : そのチャンネルの履歴をリセット

## `/draw` 例
```text
/draw prompt:"a cute cat" width:512 height:512 steps:25 cfg:7 sampler:"Euler a"
```

日本語プロンプトを英語に翻訳して SD WebUI に送る場合:

```env
SD_PROMPT_TRANSLATE=true
SD_PROMPT_TRANSLATE_MODEL=gemma3:12b
```

翻訳は日本語文字を含む prompt だけに実行されます。翻訳に失敗した場合は元の prompt をそのまま使います。

## `/music` 例
```text
/music prompt:"j-pop vocal, pop rock" duration:120 lyrics:"test" bpm:120 language:ja
```

`MUSIC_BACKEND=comfyui` がデフォルトです。ComfyUI を使う場合は `COMFY_URL` と、必要に応じて `COMFY_WORKFLOW_PATH` を設定します。ACE-Step API を使う場合は `MUSIC_BACKEND=ace` と `ACE_URL` を設定します。

## 画像入力
- 通常メッセージの画像添付と `/chat image:<画像>` に対応
- 10MB を超える画像は拒否
- 履歴には画像本体ではなく `[画像あり]` の印だけを残し、そのターンだけ Vision 形式で送信

## Remote Connection Example
SD WebUI / ComfyUI を別マシンで動かす場合は、`.env` に接続先 URL を設定します。

```env
SD_WEBUI_URL=http://192.168.1.50:7860
COMFY_URL=http://192.168.1.51:8188
```

サーバー側の起動オプション:

- SD WebUI: `--api --listen`
- ComfyUI: `--listen`

ファイアウォールで必要なポートを許可し、Bot を動かすマシンから接続できることを確認してください。

## 注意
- `.env` は秘匿情報を含むため GitHub にコミットしないでください
- `CHANNEL_IDS` を設定しないと起動時にエラーになります
- スラッシュコマンドを変更したら `npm run register` を実行してください

## ライセンス
ISC (package.json に準拠)
