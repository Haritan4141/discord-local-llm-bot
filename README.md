# discord-local-llm-bot

Discord 上でローカル LLM (Ollama / LM Studio などの OpenAI 互換 API) と会話できるボットです。指定チャンネルだけで応答し、通常メッセージと `/chat` / `/webchat` をチャンネル単位のキューで処理します。画像添付の Vision 入力、Ollama Web Search を使う `/webchat`、Stable Diffusion WebUI による `/draw`、ComfyUI / ACE-Step による `/music`、リアクション操作の `/othello` に対応しています。ローカル GUI から `.env` 設定、Bot 起動/停止、ログ確認もできます。

## 主な機能
- 指定チャンネルのみ応答 (`CHANNEL_IDS` で制限)
- 通常メッセージと `/chat` の 1発言=1返信キュー処理
- 会話履歴の簡易保持 (`LLM_MAX_HISTORY_MESSAGES`、既定値 30)
- 画像添付を Vision 形式で LLM に送信
- `/webchat` で Ollama Web Search を使った検索付き会話
- `/webchat` や `WEB_SEARCH_MODE=auto` の検索経路では、メッセージ内の URL を優先して直接取得
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
- ギルドコマンド登録を使う場合は Discord サーバーの `GUILD_ID`
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
- `CHANNEL_IDS` (カンマ区切りで複数可)
- `LLM_PROVIDER` (`ollama`, `lmstudio`, `custom`)
- `LLM_BASE_URL` (例: Ollama `http://127.0.0.1:11434/v1`, LM Studio `http://127.0.0.1:1234/v1`)
- `LLM_MODEL` (例: `gemma3:12b`)
- `LLM_TEMPERATURE` (通常チャットの temperature。既定値 `0.4`)
- `LLM_MAX_HISTORY_MESSAGES` (保持する会話履歴メッセージ数。既定値 `30`)
- `WEB_SEARCH_MODE` (`manual` = `/webchat` のときだけ検索, `auto` = 通常チャットでも毎ターン検索要否を判定)
- `BOT_TIMEZONE` (LLM に渡す現在時刻の IANA タイムゾーン。既定値 `Asia/Tokyo`)

任意の値:

- `GUILD_ID` (ギルドコマンド登録用。カンマ区切りで複数可)
- `SYSTEM_PROMPT`
- `LLM_API_KEY` (通常は空。API key が必要な互換サーバー向け)
- `OLLAMA_KEEP_ALIVE` (Ollama のモデル保持時間。例: `30m`=30分, `1h`=1時間, `3600`=3600秒, `-1`=常時ロード)
- `OLLAMA_WEB_API_KEY` (`/webchat` 用。Ollama account の API key)

`LLM_TEMPERATURE` は 0.0 から 2.0 の範囲で指定します。低いほど安定しやすく、会話の崩れや過剰な演出を抑えやすくなります。通常用途は `0.4` を推奨します。
`WEB_SEARCH_MODE=auto` にすると、通常チャットでも LLM がそのターンで検索が必要かを判定し、必要なときだけ Ollama Web Search を使います。`manual` の場合は従来どおり `/webchat` のときだけ検索します。
検索経路では、メッセージ本文に `https://...` 形式の URL が含まれている場合、その URL をまず直接取得します。必要な場合だけ追加で Web Search を併用します。
- `SD_WEBUI_URL` と `SD_*` (`/draw` 用)
- `SD_PROMPT_TRANSLATE` と `SD_PROMPT_TRANSLATE_MODEL` (`/draw` の日本語プロンプト翻訳用)
- `MUSIC_BACKEND` (`comfyui` または `ace`)
- `COMFY_URL` と `COMFY_WORKFLOW_PATH` (`/music` の ComfyUI 用)
- `ACE_URL` / `ACE_POLL_MS` / `ACE_API_KEY` (`/music` の ACE-Step 用)

旧 `.env` の `OLLAMA_URL` / `OLLAMA_MODEL` は fallback として残せます。新しい `LLM_*` が設定されている場合は `LLM_*` が優先されます。

### Discord Bot をサーバーに招待する設定

Discord Developer Portal の `OAuth2` で次を設定します。

- Scope:
  - `bot`
  - `applications.commands`
- Integration Type:
  - `Guild Install`

Bot Permissions は最低限、次を付けてください。

- `View Channels`
- `Send Messages`
- `Read Message History`
- `Attach Files`
- `Add Reactions`
- `Use Slash Commands`

`/othello` を使う場合は追加で:

- `Manage Messages`

スレッド内でも使う場合は追加で:

- `Send Messages in Threads`

Developer Portal の `Bot` タブでは、通常メッセージを読むために `Message Content Intent` を ON にしてください。

### `GUILD_ID` と複数サーバーの関係

この Bot の現在の実装では、実行時にどのサーバーで反応するかは `GUILD_ID` ではなく `CHANNEL_IDS` で決まります。つまり、`CHANNEL_IDS` に入っているチャンネルであれば、複数サーバーにまたがって通常メッセージとスラッシュコマンドの受付判定が動きます。

一方で、`GUILD_ID` は `register-commands.mjs` で使っているスラッシュコマンドの登録先です。ギルド登録では `GUILD_ID` にカンマ区切りで複数サーバー ID を指定できます。

- 実行時の応答先: `CHANNEL_IDS`
- コマンド登録先: `GUILD_ID`（カンマ区切り複数可）

複数サーバーで Bot が動いているのに `GUILD_ID` が 1 つしかない場合、考えられる状況は次のどれかです。

- 通常メッセージ応答は `CHANNEL_IDS` に含まれるチャンネルで動いている
- スラッシュコマンドは過去に各サーバーへ個別登録され、そのまま残っている
- 以前にグローバルコマンド登録をしていて、そのコマンドが見えている

今の実装では、複数サーバーで同じスラッシュコマンドを使いたい場合は次のどちらかを選べます。

- `Register Guild Commands` / `npm run register:guild`
  - `GUILD_ID` に入っている 1 個以上のサーバーへ順番に登録
  - 反映が速い
- `Register Global Commands` / `npm run register:global`
  - アプリを導入している全サーバー向けのグローバルコマンドを登録
  - 反映は遅め（最大 1 時間程度）

3. スラッシュコマンド登録

GUI では次の 2 つのボタンを使えます。

- `Register Guild Commands`
  - `.env` の `GUILD_ID` に指定した 1 個以上のサーバーへ登録
- `Register Global Commands`
  - グローバルコマンドとして登録

CLI から実行する場合:

```bash
npm run register:guild
npm run register:global
```

`npm run register` は `npm run register:guild` と同じです。

4. 起動

GUI の `Start Bot` ボタンを押します。ログ欄と `bot.log` で起動状況を確認できます。

Ollama は別ターミナルで起動します。

```bat
start-ollama.bat
```

`start-ollama.bat` は `.env` の `OLLAMA_KEEP_ALIVE` を読んで `ollama serve` を起動します。Bot も起動時に preload を1回送るため、初回応答の待ち時間を減らせます。

CLI から直接 Bot を起動する場合:

```bash
npm start
```

従来どおり `start-bot.bat` で直接起動することもできます。

## GUI
- 起動: `start-gui.bat` または `npm run gui`
- URL: `http://127.0.0.1:3150`
- デフォルトではローカルホスト (`127.0.0.1`) のみに bind
- 起動毎にランダムなセッショントークンを生成して `index.html` に埋め込み、API 呼び出しは `X-GUI-Token` ヘッダで検証
- `Host` / `Origin` ヘッダも検証するため、DNS rebinding や他オリジンからの CSRF を遮断
- `.env` がない場合は `.env.example` から自動作成
- LLM Provider に応じて `/v1/models` からモデル一覧を取得し、`LLM_MODEL` の候補として選択可能
- `Save .env` で設定保存
- `Start Bot` / `Stop Bot` / `Restart Bot` で Bot プロセスを操作
- `Register Guild Commands` / `Register Global Commands` でスラッシュコマンド登録
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

## プロジェクト構成
- `index.mjs` : エントリシム。実体は `src/bot.mjs` を import するだけ
- `src/bot.mjs` : Discord クライアントと全スラッシュコマンドハンドラ
- `src/config.mjs` : `.env` 読込、検証、ランタイム定数
- `src/utils/` : 共通ユーティリティ (`llm-config`, `env-file`, `text`, `http`)。`gui-server.mjs` からも import
- `src/llm/` : OpenAI 互換チャットクライアントと診断ログ
- `src/web/` : Ollama Web Search、コンテキスト生成、auto-route 判定
- `src/discord/` : チャンネル状態、画像添付、typing ループ、キュー処理
- `src/sd/` : Stable Diffusion txt2img、日本語プロンプト翻訳
- `src/music/` : ComfyUI / ACE-Step 共通キュー
- `src/othello/` : 盤面・AI・PNG 描画・ゲーム進行
- `gui-server.mjs` : ローカル GUI サーバー
- `gui/` : GUI の HTML / CSS / JS
- `tests/` : `node --test` 用ユニットテスト

## テスト
- `npm run check` : 全 `.mjs` ファイルの構文チェック
- `npm test` : `npm run check` + `node --test tests/` (現在 46 件、純関数を網羅)

## `/draw` 例
```text
/draw prompt:"a cute cat" width:512 height:512 steps:25 cfg:7 sampler:"Euler a"
```

数値オプションは事故防止のためにクランプされます: `width` / `height` は 64〜2048、`steps` は 1〜150、`cfg` は 1〜30、`batch` は 1〜4。

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

生成されたファイルサイズが 24MB を超えると Discord にアップロードできないため、Bot 側で検知して案内メッセージだけを返します。長尺は `duration` を短くするか、低 bitrate の出力に切り替えてください。

## 画像入力
- 通常メッセージの画像添付と `/chat image:<画像>` に対応
- 対応 MIME: `image/png`, `image/jpeg`, `image/webp` (GIF は不可)
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
- `WEB_SEARCH_MODE=manual` では `/webchat` のときだけ検索します
- `WEB_SEARCH_MODE=auto` では通常メッセージや `/chat` でもターンごとに検索要否を判定し、必要なときだけ検索します
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
