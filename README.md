# discord-local-llm-bot

Discord 上でローカル LLM (Ollama / LM Studio などの OpenAI 互換 API) と会話できるボットです。指定チャンネルだけで応答し、通常メッセージと `/chat` をチャンネル単位のキューで処理します。画像添付の Vision 入力、Ollama Web Search を使う `/webchat`、Stable Diffusion WebUI による `/draw`、ComfyUI / ACE-Step による `/music`、リアクション操作の `/othello` に対応しています。ローカル GUI から `.env` 設定、Bot 起動/停止、ログ確認もできます。

## 主な機能
- 指定チャンネルのみ応答 (`CHANNEL_IDS` で制限)
- 通常メッセージと `/chat` の 1発言=1返信キュー処理
- 会話履歴の簡易保持 (最大 30 メッセージ)
- 画像添付を Vision 形式で LLM に送信
- `/webchat` で Ollama Web Search を使った検索付き会話
- LLM Provider として Ollama / LM Studio / Custom OpenAI 互換 API を選択
- `/persona` によるチャンネル別の人格上書き
- `/draw` で Stable Diffusion WebUI (AUTOMATIC1111) 画像生成
- `/music` で ComfyUI または ACE-Step による音楽生成
- `/othello` でオセロ (VS AI) をリアクション操作でプレイ
- `/pause` / `/resume` / `/reset` によるチャンネル単位の制御
- ローカル GUI で `.env` 設定、保存、Bot 起動/停止、ログ表示

## 必要なもの
- Node.js 18 以上 (fetch を使用)
- Discord Bot トークン
- Discord Application の `CLIENT_ID`
- スラッシュコマンドを登録する Discord サーバーの `GUILD_ID`
- Ollama または LM Studio (OpenAI 互換の chat/completions エンドポイント)
- Optional: Stable Diffusion WebUI (AUTOMATIC1111, `--api` 起動)
- Optional: ComfyUI (`--listen` 起動) または ACE-Step API

## セットアップ
1. 依存関係をインストール

```bash
npm install
```

2. GUI を起動して環境変数を設定

```bat
start-gui.bat
```

ブラウザで `http://127.0.0.1:3150` が開きます。`.env` がない場合は GUI 起動時に `.env.example` から自動作成されます。

`.env` で最低限必要な値:

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`
- `CHANNEL_IDS` (カンマ区切りで複数可)
- `LLM_PROVIDER` (`ollama`, `lmstudio`, `custom`)
- `LLM_BASE_URL` (例: Ollama `http://127.0.0.1:11434/v1`, LM Studio `http://127.0.0.1:1234/v1`)
- `LLM_MODEL` (例: `gemma3:12b`)

任意の値:

- `SYSTEM_PROMPT`
- `LLM_API_KEY` (通常は空。API key が必要な互換サーバー向け)
- `OLLAMA_WEB_API_KEY` (`/webchat` 用。Ollama account の API key)
- `SD_WEBUI_URL` と `SD_*` (`/draw` 用)
- `SD_PROMPT_TRANSLATE` と `SD_PROMPT_TRANSLATE_MODEL` (`/draw` の日本語プロンプト翻訳用)
- `MUSIC_BACKEND` (`comfyui` または `ace`)
- `COMFY_URL` と `COMFY_WORKFLOW_PATH` (`/music` の ComfyUI 用)
- `ACE_URL` / `ACE_POLL_MS` / `ACE_API_KEY` (`/music` の ACE-Step 用)

旧 `.env` の `OLLAMA_URL` / `OLLAMA_MODEL` は fallback として残せます。新しい `LLM_*` が設定されている場合は `LLM_*` が優先されます。

3. スラッシュコマンド登録

GUI の `Register Commands` ボタンを押します。CLI から実行する場合は `npm run register` を使えます。`register-commands.mjs` はデフォルトでギルド登録を行います。グローバル登録に切り替える場合は、ファイル内のコメントに従って登録先を変更してください。

4. 起動

GUI の `Start Bot` ボタンを押します。ログ欄と `bot.log` で起動状況を確認できます。

Ollama は別ターミナルで起動します。

```bat
start-ollama.bat
```

CLI から直接 Bot を起動する場合:

```bash
npm start
```

従来どおり `start-bot.bat` で直接起動することもできます。

## GUI
- 起動: `start-gui.bat` または `npm run gui`
- URL: `http://127.0.0.1:3150`
- デフォルトではローカルホスト (`127.0.0.1`) のみに bind
- `.env` がない場合は `.env.example` から自動作成
- LLM Provider に応じて `/v1/models` からモデル一覧を取得し、`LLM_MODEL` の候補として選択可能
- `Save .env` で設定保存
- `Start Bot` / `Stop Bot` / `Restart Bot` で Bot プロセスを操作
- `Register Commands` でスラッシュコマンド登録
- ログ欄に GUI / Bot / コマンド登録の出力を表示し、同時に `bot.log` にも追記

## コマンド
- `/help` : ヘルプ表示
- `/status` : 状態表示
- `/chat [message] [image]` : LLM と会話 (画像は任意)
- `/webchat [message]` : Ollama Web Search を使って最新情報つきで会話
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

## `/webchat`
```text
/webchat message:"最新のOllama web search機能を教えて"
```

- `OLLAMA_WEB_API_KEY` の設定が必要です
- Web 検索自体は Ollama のクラウド API を使うため、インターネット接続が必要です
- Bot が `web_search` で候補を取得し、`web_fetch` で本文を取りに行ってから LLM に渡します
- 返答の末尾に参照した source URL を表示します
- 通常の `/chat` や通常メッセージでは Web 検索しません
- 検索結果はトークンを多く使うため、Ollama / LM Studio の context length は大きめ推奨です

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
