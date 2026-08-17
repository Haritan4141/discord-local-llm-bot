# discord-local-llm-bot

Discord 上でローカル LLM (Ollama / LM Studio など) または OpenAI API と会話できるボットです。指定チャンネルだけで応答し、通常メッセージと `/chat` / `/webchat` をチャンネル単位のキューで処理します。画像添付の Vision 入力、Provider 別の Web Search、OpenAI Image API または Stable Diffusion WebUI による `/draw`、ComfyUI / ACE-Step による `/music`、リアクション操作の `/othello` に対応しています。ローカル GUI から `.env` 設定、Bot 起動/停止、ログ確認もできます。

## 主な機能
- 指定チャンネルのみ応答 (`CHANNEL_IDS` で制限)
- 通常メッセージと `/chat` の 1発言=1返信キュー処理
- 会話履歴の簡易保持 (`LLM_MAX_HISTORY_MESSAGES`、既定値 30)
- 画像添付を Vision 形式で LLM に送信
- 通常メッセージのテキスト添付 (`.txt` など) を読み取り
- `/webchat` で検索付き会話。OpenAI は Responses API の公式 `web_search`、その他は Ollama Web Search を使用
- `WEB_SEARCH_MODE=auto` では、OpenAI のモデル自身または既存ルーターが必要なターンだけ検索
- LLM Provider として Ollama / LM Studio / OpenAI / Custom OpenAI 互換 API を選択
- `/systemprompt` によるチャンネル別の System Prompt 上書き
- `/draw` で OpenAI Image API (`gpt-image-2`) または Stable Diffusion WebUI 画像生成
- `/music` で ComfyUI または ACE-Step による音楽生成
- `/othello` でオセロ (VS AI) をリアクション操作でプレイ
- `/pause` / `/resume` / `/reset` によるチャンネル単位の制御
- ローカル GUI で `.env` 設定、保存、Bot 起動/停止、ログ表示

## 必要なもの
- Node.js 18 以上 (fetch を使用)
- Discord Bot トークン
- Discord Application の `CLIENT_ID`
- ギルドコマンド登録を使う場合は Discord サーバーの `GUILD_ID`
- OpenAI API、または Ollama / LM Studio (OpenAI 互換の chat/completions エンドポイント)
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
- `LLM_PROVIDER` (`ollama`, `lmstudio`, `openai`, `custom`)
- `LLM_BASE_URL` (例: Ollama `http://127.0.0.1:11434/v1`, LM Studio `http://127.0.0.1:1234/v1`, OpenAI `https://api.openai.com/v1`)
- `LLM_MODEL` (例: `gemma3:12b`)
- `LLM_TEMPERATURE` (通常チャットの temperature。既定値 `0.4`)
- `LLM_MAX_HISTORY_MESSAGES` (保持する会話履歴メッセージ数。既定値 `30`)
- `MEMBER_CONTEXT_ENABLED` (通常チャットでメンバー情報を自動参照するか。既定値 `true`)
- `MEMBER_CONTEXT_CACHE_TTL_SECONDS` (メンバーキャッシュの再取得間隔。既定値 `600`)
- `MEMBER_CONTEXT_MAX_MEMBERS` (1回のLLMプロンプトに含める最大メンバー件数。既定値 `24`)
- `MEMBER_CONTEXT_MAX_CHARS` (1回のLLMプロンプトに含める最大文字数。既定値 `6000`)
- `WEB_SEARCH_MODE` (`manual` = `/webchat` のときだけ検索, `auto` = 通常チャットでも毎ターン検索要否を判定)
- `OPENAI_WEB_SEARCH_MAX_TOOL_CALLS` (OpenAI の 1 回の回答で使える内蔵 Web ツール呼び出し上限。既定値 `2`)
- `OPENAI_WEB_SEARCH_MAX_SOURCES` (Discord に表示する OpenAI Sources URL の上限。既定値 `1`、`0` で非表示。リンクプレビューは抑制)
- `BOT_TIMEZONE` (LLM に渡す現在時刻の IANA タイムゾーン。既定値 `Asia/Tokyo`)

任意の値:

- `GUILD_ID` (ギルドコマンド登録用。カンマ区切りで複数可)
- `SYSTEM_PROMPT`
- `LLM_API_KEY` (通常は空。API key が必要な互換サーバー向け)
- `OLLAMA_KEEP_ALIVE` (Ollama のモデル保持時間。例: `30m`=30分, `1h`=1時間, `3600`=3600秒, `-1`=常時ロード)
- `OLLAMA_WEB_API_KEY` (`/webchat` 用。Ollama account の API key)
- `STANDBY_CHANNEL_IDS` (Standby Bot の対象チャンネル。空欄なら `CHANNEL_IDS`)
- `STANDBY_REPLY_MESSAGE` (Standby Bot の固定返信)
- `STANDBY_REPLY_COOLDOWN_SECONDS` (同一ユーザー連投時のクールダウン秒数)
- `IMAGE_PROVIDER` (`openai` または `stable-diffusion`。未設定時は OpenAI LLM なら `openai`)
- `OPENAI_IMAGE_MODEL` (既定値 `gpt-image-2`)
- `OPENAI_IMAGE_QUALITY` (`low`, `medium`, `high`, `auto`。既定値 `low`)
- `OPENAI_IMAGE_SIZE` (`1024x1024` など。既定値 `1024x1024`)
- `OPENAI_IMAGE_API_KEY` (空欄なら `LLM_API_KEY` を使用)

`LLM_TEMPERATURE` は 0.0 から 2.0 の範囲で指定します。低いほど安定しやすく、会話の崩れや過剰な演出を抑えやすくなります。通常用途は `0.4` を推奨します。
`WEB_SEARCH_MODE=auto` にすると、通常チャットでも必要なときだけ検索します。OpenAI Provider または公式 API URL では Responses API に公式 `web_search` ツールを渡し、モデル自身が検索要否を判断します。それ以外では既存ルーターが判定して Ollama Web Search を使います。`manual` の場合は `/webchat` のときだけ検索します。
OpenAI 以外の検索経路では、メッセージ本文に `https://...` 形式の URL が含まれている場合、その URL をまず直接取得します。OpenAI Provider では URL の取得も公式 `web_search` ツールに任せます。

OpenAI の設定例:

```env
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-5.4-nano
LLM_API_KEY=sk-proj-...
WEB_SEARCH_MODE=auto
OPENAI_WEB_SEARCH_MAX_TOOL_CALLS=2
OPENAI_WEB_SEARCH_MAX_SOURCES=1
IMAGE_PROVIDER=openai
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_QUALITY=low
OPENAI_IMAGE_SIZE=1024x1024
```

以前の設定が `LLM_PROVIDER=custom` でも、`LLM_BASE_URL=https://api.openai.com/v1` なら OpenAI Responses API を自動判定します。OpenAI Provider では `OLLAMA_WEB_API_KEY` は不要です。`/webchat` は検索必須、`auto` の通常チャットは検索任意として OpenAI に送信され、回答末尾には引用元 URL、Web 検索回数、参照 URL 数、推論トークン数が表示されます。Web 検索回数は Responses API の `search` アクション数で、引用元 URL 数とは一致しません。内蔵 Web ツールの呼び出しは既定で 1 回の回答につき最大 2 回、Sources URL の表示は既定で 1 件です。
- `SD_WEBUI_URL` と `SD_*` (`/draw` 用)
- `SD_PROMPT_TRANSLATE` と `SD_PROMPT_TRANSLATE_MODEL` (`/draw` の日本語プロンプト翻訳用)
- `MUSIC_BACKEND` (`comfyui` または `ace`)
- `COMFY_URL` と `COMFY_WORKFLOW_PATH` (`/music` の ComfyUI 用)
- `MUSIC_VRAM_RELEASE_DELAY_SECONDS` (ComfyUIの音楽キューが空になってからVRAMを解放するまでの秒数。既定値300、0で無効)
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

メンバー情報を通常チャットへ取り込む場合は、同じ `Bot` タブで次も ON にしてください。

- `Server Members Intent`
- `Presence Intent` (オンライン状態も参照する場合)

Bot側でも `GuildMembers` / `GuildPresences` Intent を指定して接続します。`MEMBER_CONTEXT_ENABLED=true` の場合、起動時に許可チャンネルを含むサーバーのメンバーキャッシュを作成し、通常メッセージ中のメンション・ユーザー名・メンバー話題に一致した情報だけを一時的にLLMへ渡します。メンバー情報は会話履歴には保存しません。全員の一覧を毎回送らないため、入力トークンの増加も抑えます。

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
- `Start Standby Bot` / `Stop Standby Bot` / `Restart Standby Bot` で同じ Bot の待機モードを操作
- `Register Guild Commands` / `Register Global Commands` でスラッシュコマンド登録
- ログ欄に GUI / Bot / コマンド登録の出力を表示し、同時に `bot.log` にも追記

### Standby Bot

メイン Bot を停止している間だけ固定メッセージを返したい場合は、同じ `DISCORD_TOKEN` を使う Standby モードを起動できます。

- `STANDBY_CHANNEL_IDS` を空欄にすると `CHANNEL_IDS` をそのまま使う
- `STANDBY_REPLY_MESSAGE` に停止中メッセージを設定
- `STANDBY_REPLY_COOLDOWN_SECONDS` で同じユーザーへの連投返信を抑制
- GUI では `Start Standby Bot` / `Stop Standby Bot` / `Restart Standby Bot`
- CLI では `npm run standby` または `start-standby-bot.bat`

注意:

- Main Bot と Standby Bot は同時起動しません。GUI で排他制御しています。
- Standby Bot は同じ `DISCORD_TOKEN` でログインします。追加の Discord Application / Bot Token は不要です。
- 必要な権限は最低限 `View Channels`, `Send Messages`, `Read Message History` と `Message Content Intent` です。

## コマンド
- `/help` : ヘルプ表示
- `/status` : 状態表示
- `/chat [message] [image]` : LLM と会話 (画像は任意)
- `/webchat [message]` : Provider に応じた Web Search を使って最新情報つきで会話
- `/systemprompt [text] [reset]` : このチャンネルの System Prompt を設定またはリセット
- `/systemprompt-show` : 現在このチャンネルで有効な System Prompt を表示
- `/draw prompt [width] [height] [steps] [cfg] [sampler] [seed] [batch] [negative]` : 画像生成
- `/music prompt [duration] [lyrics] [bpm] [language]` : 音楽生成
- `/othello [difficulty]` : オセロ開始 (リアクション操作)
- `/pause` : そのチャンネルで停止
- `/resume` : 再開
- `/reset` : そのチャンネルの履歴をリセット

`/systemprompt` はそのチャンネルの System Prompt を上書きするため、実行するとそのチャンネル内の Bot の挙動が変わります。スラッシュコマンドを使える人なら変更できる前提で運用してください。

## プロジェクト構成
- `index.mjs` : エントリシム。実体は `src/bot.mjs` を import するだけ
- `src/bot.mjs` : Discord クライアントと全スラッシュコマンドハンドラ
- `src/config.mjs` : `.env` 読込、検証、ランタイム定数
- `src/utils/` : 共通ユーティリティ (`llm-config`, `env-file`, `text`, `http`)。`gui-server.mjs` からも import
- `src/llm/` : OpenAI Responses / OpenAI 互換 Chat Completions クライアントと診断ログ
- `src/web/` : OpenAI 以外で使う Ollama Web Search、コンテキスト生成、auto-route 判定
- `src/discord/` : チャンネル状態、画像添付、typing ループ、キュー処理
- `src/image/` : OpenAI Image API による画像生成
- `src/sd/` : Stable Diffusion txt2img、日本語プロンプト翻訳
- `src/music/` : ComfyUI / ACE-Step 共通キュー
- `src/othello/` : 盤面・AI・PNG 描画・ゲーム進行
- `gui-server.mjs` : ローカル GUI サーバー
- `gui/` : GUI の HTML / CSS / JS
- `tests/` : `node --test` 用ユニットテスト

## テスト
- `npm run check` : 全 `.mjs` ファイルの構文チェック
- `npm test` : `npm run check` + `node --test tests/` (現在 72 件、純関数を中心に検証)

## `/draw` 例
```text
/draw prompt:"月面で宇宙服を着た白い猫" width:1024 height:1024 batch:1
```

`IMAGE_PROVIDER=openai` の場合は Image API の `gpt-image-2` を直接呼び出します。`width` / `height` は各辺16px単位、最大3840px、総画素数655,360〜8,294,400、縦横比3:1以内で指定します。`batch` は1〜4です。`steps` / `cfg` / `sampler` / `seed` / `negative` は Stable Diffusion の場合だけ使われます。

OpenAI Image API の設定例:

```env
IMAGE_PROVIDER=openai
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_QUALITY=low
OPENAI_IMAGE_SIZE=1024x1024
# 空欄なら LLM_API_KEY を使用
OPENAI_IMAGE_API_KEY=
```

OpenAI の組織設定によっては、GPT Image モデルを使う前に Organization Verification が必要です。

`gpt-image-2` の標準API料金（2026-08-02確認、1024x1024の画像出力目安）:

| Quality | 1枚 | 100枚 |
| --- | ---: | ---: |
| Low | $0.006 | $0.60 |
| Medium | $0.053 | $5.30 |
| High | $0.211 | $21.10 |

このほか、プロンプトのテキスト入力は100万トークンあたり$5です。通常の短い画像プロンプトでは画像出力料金に比べて小額です。最新料金は [OpenAI API Pricing](https://developers.openai.com/api/docs/pricing) と [Image generation calculator](https://developers.openai.com/api/docs/guides/image-generation#calculating-costs) を確認してください。`batch`を増やすと、おおむね生成枚数に比例して料金が増えます。

`IMAGE_PROVIDER=stable-diffusion` の場合、数値オプションは事故防止のためにクランプされます: `width` / `height` は64〜2048、`steps` は1〜150、`cfg` は1〜30、`batch` は1〜4。

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

`MUSIC_BACKEND=comfyui` がデフォルトです。ComfyUI を使う場合は `COMFY_URL` と、必要に応じて `COMFY_WORKFLOW_PATH` を設定します。音楽キューが空になってから `MUSIC_VRAM_RELEASE_DELAY_SECONDS` 秒経過すると、Bot は ComfyUI の `/free` API に `unload_models=true` と `free_memory=true` を送り、読み込まれたモデルを解放します。既定値は300秒（5分）で、0にすると無効です。解放後の次回生成ではモデルの再ロードが発生するため、初回だけ時間がかかる場合があります。ACE-Step API を使う場合は `MUSIC_BACKEND=ace` と `ACE_URL` を設定します。

生成されたファイルサイズが 24MB を超えると Discord にアップロードできないため、Bot 側で検知して案内メッセージだけを返します。長尺は `duration` を短くするか、低 bitrate の出力に切り替えてください。

## 画像入力
- 通常メッセージの画像添付と `/chat image:<画像>` に対応
- 対応 MIME: `image/png`, `image/jpeg`, `image/webp` (GIF は不可)
- 10MB を超える画像は拒否
- 履歴には画像本体ではなく `[画像あり]` の印だけを残し、そのターンだけ Vision 形式で送信

## テキスト添付
- Discord で長文が `message.txt` 添付になった場合でも、通常メッセージなら最初のテキスト添付 1 件を自動で読みます
- 対応拡張子 / MIME: `.txt`, `.md`, `.json`, `.csv`, `.tsv`, `.log`
- UTF-8 前提、最大 256KB まで。長すぎる場合は先頭 20,000 文字に切ってそのターンだけ LLM に渡します
- 履歴には本文全文ではなく `[text attachment: ...]` のプレースホルダだけ残します

## `/webchat`
```text
/webchat message:"最新のOllama web search機能を教えて"
```

- `OLLAMA_WEB_API_KEY` の設定が必要です
- Web 検索自体は Ollama のクラウド API を使うため、インターネット接続が必要です
- Bot が `web_search` で候補を取得し、`web_fetch` で本文を取りに行ってから LLM に渡します
- 返答の末尾に参照した source URL を表示します
- `WEB_SEARCH_MODE=manual` では `/webchat` のときだけ検索します
- `WEB_SEARCH_MODE=auto` では通常メッセージや `/chat` でも必要なときだけ検索します
- OpenAI は Responses API の公式 `web_search` を使い、`/webchat` では検索必須、通常チャットでは検索任意です
- OpenAI の返答末尾には Web 検索回数、参照 URL 数、推論トークン数を表示し、同じ数値を GUI ログにも記録します
- `Sources` の件数は参照 URL 数であり、Web 検索回数ではありません
- OpenAI の内蔵 Web ツールは既定で 1 回の回答につき最大 2 回、Sources URL はリンクプレビューを抑制して最大 1 件表示します。GUI で変更できます
- OpenAI 公式 API 以外は従来どおり Ollama Web Search と URL fetch を使います
- 検索はモデルのトークン料金に加えて Provider 側の検索料金が発生する場合があります

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
