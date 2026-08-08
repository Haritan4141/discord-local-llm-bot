# AGENTS.md

このリポジトリで作業するコーディングエージェント向けのガイドです。

## 概要
- Discord 上でローカル LLM (Ollama / LM Studio などの OpenAI 互換 API) と会話できるボット
- 指定チャンネルのみ応答 ( `CHANNEL_IDS` )
- 通常メッセージと `/chat` / `/webchat` をチャンネル単位のキューで 1発言=1返信処理
- 画像添付は Vision 形式で LLM に送信
- 通常メッセージのテキスト添付 (`.txt` など) も読み取り可能
- LLM Provider は `LLM_PROVIDER` / `LLM_BASE_URL` / `LLM_MODEL` で設定 (`OLLAMA_*` は fallback)
- 通常チャットの temperature は `LLM_TEMPERATURE` で設定。既定値は `0.4`
- 会話履歴件数は `LLM_MAX_HISTORY_MESSAGES` で設定。既定値は `30`
- Web 検索モードは `WEB_SEARCH_MODE` で設定。`manual` は `/webchat` のみ、`auto` は通常チャットでも毎ターン検索要否を判定
- 検索経路では、メッセージ中の URL を優先して直接 `web_fetch` する
- Ollama のモデル保持時間は `OLLAMA_KEEP_ALIVE` で設定。`start-ollama.bat` と Bot 起動時 preload で使用
- `/webchat` で Ollama Web Search / Web Fetch を使った検索付き会話
- `/systemprompt` でチャンネル単位の System Prompt 上書き、`/systemprompt-show` で現在設定を表示
- `/draw` で OpenAI Image API (`gpt-image-2`) または Stable Diffusion WebUI (AUTOMATIC1111) を呼び出し
- `/music` で ComfyUI または ACE-Step を使った音楽生成を呼び出し
- `/othello` でリアクション操作のオセロ (VS AI) を開始
- ローカル GUI で `.env` 設定、保存、Bot 起動/停止、ログ表示
- 必要に応じて、同じ Bot の Standby モードで「メイン Bot 停止中」の固定返信を返せる

## 主要ファイル
- `index.mjs` : エントリシム。実体は `src/bot.mjs` を import するだけ
- `src/bot.mjs` : Discord クライアントと全スラッシュコマンドハンドラ
- `src/config.mjs` : `.env` 読込、検証、ランタイム定数 (LLM_*, SD_*, MUSIC_*, BOT_TIMEZONE など)
- `src/utils/llm-config.mjs` : base URL 正規化、`numEnv`、`normalizeOllamaKeepAliveForApi` (`gui-server.mjs` からも共有)
- `src/utils/env-file.mjs` : `.env` パース / フォーマット (`gui-server.mjs` から共有)
- `src/utils/text.mjs` : `truncateText`, `splitForDiscord`, 不可視文字除去
- `src/utils/http.mjs` : `fetchJsonWithTimeout`, `sleep`
- `src/llm/chat.mjs` : OpenAI 互換チャット呼び出し、`preloadOllamaModel`、日時注入
- `src/llm/diagnostics.mjs` : timeout / 空応答のログ
- `src/web/urls.mjs` : URL 抽出と正規化 (パレン残高判定込み)
- `src/web/ollama-search.mjs` : Ollama web_search / web_fetch
- `src/web/context.mjs` : web 検索結果から LLM へ渡すコンテキスト構築
- `src/web/router.mjs` : `WEB_SEARCH_MODE=auto` の判定 LLM
- `src/discord/state.mjs` : チャンネル単位の履歴と `trimHistory`
- `src/discord/images.mjs` : 画像添付ヘルパ (`pickImageFromInteraction`, `fetchImageForLlm` 等)
- `src/discord/text-attachments.mjs` : テキスト添付の判定と本文取得
- `src/discord/typing.mjs` : "入力中..." 定期送信
- `src/discord/queue.mjs` : `processQueue` (画像 / 通常 / web 検索の分岐含む)
- `src/discord/members.mjs` : Discord メンバーキャッシュ、名前・メンション判定、LLM 用一時コンテキスト
- `src/standby/config.mjs` / `src/standby/bot.mjs` : 同じ Bot を使う Standby モードの設定と本体
- `src/sd/draw.mjs` : Stable Diffusion txt2img と日本語プロンプト翻訳
- `src/image/openai.mjs` : OpenAI Image API の画像生成、サイズ検証、レスポンス解析
- `src/music/comfy.mjs`, `src/music/ace.mjs`, `src/music/queue.mjs` : ComfyUI / ACE-Step / 共通キュー
- `src/othello/board.mjs` / `ai.mjs` / `render.mjs` / `game.mjs` : 盤面・AI・PNG 描画・進行
- `gui-server.mjs` : ローカル GUI サーバー (`http://127.0.0.1:3150`)
- `gui/` : GUI の HTML/CSS/JS
- `register-commands.mjs` : スラッシュコマンド登録
- `clear-guild-commands.mjs` / `clear-global-commands.mjs` : 登録済みコマンド削除
- `tests/` : `node --test` 用ユニットテスト (純関数中心)
- `README.md` : 使い方・セットアップ手順
- `docs/ai_context.md` : セッションをまたぐ引き継ぎノート
- `.env` / `.env.example` : 環境変数 (秘密情報に注意)
- `comfyui/workflows/` : `/music` 用 ComfyUI workflow
- `start-gui.bat` : GUI 起動
- `start-bot.bat` : Bot 起動
- `start-standby-bot.bat` : Standby Bot 起動
- `start-ollama.bat` : Ollama 起動

## 実行の前提
- Node.js 18 以降 (fetch 使用)
- Discord Bot トークン
- Discord Application の `CLIENT_ID` と、ギルド登録用の `GUILD_ID`（カンマ区切りで複数可）
- Ollama / LM Studio / Custom OpenAI 互換 chat/completions
- Optional: chat temperature (`LLM_TEMPERATURE`, 0.0-2.0, default `0.4`)
- Optional: web search mode (`WEB_SEARCH_MODE`, `manual` or `auto`)
- Optional: Discord member context (`MEMBER_CONTEXT_ENABLED`, cache TTL / max members / max chars)
- Optional: chat timezone (`BOT_TIMEZONE`, IANA name, default `Asia/Tokyo`)
- Optional: Ollama model keep-alive (`OLLAMA_KEEP_ALIVE`, 例: `30m`, `1h`, `-1`)
- Optional: Ollama Web Search API key (`OLLAMA_WEB_API_KEY`)
- Optional: standby mode (`STANDBY_CHANNEL_IDS`, `STANDBY_REPLY_MESSAGE`, `STANDBY_REPLY_COOLDOWN_SECONDS`)
- Optional: Stable Diffusion WebUI ( `--api` 起動 )
- Optional: ComfyUI ( `--listen` 起動 ) または ACE-Step API

## 重要な注意
- `.env` は機密情報を含むためコミットしない
- `CHANNEL_IDS` 未設定時は起動時にエラー
- `LLM_*` が優先され、旧 `OLLAMA_URL` / `OLLAMA_MODEL` は互換 fallback として扱う
- `LLM_TEMPERATURE` は通常チャット系の応答安定性に効く。低めほど暴走しにくい
- `MEMBER_CONTEXT_ENABLED` が有効な場合、`GuildMembers` / `GuildPresences` Intent を Developer Portal と Bot の両方で有効化する
- `OLLAMA_KEEP_ALIVE` は Ollama 利用時のみ有効。`-1` は常時ロードだが VRAM / RAM を占有し続ける
- `/webchat` は `OLLAMA_WEB_API_KEY` が必要。検索自体は Ollama のクラウド API を使い、回答生成の LLM provider とは独立
- Discord で長文が `message.txt` 添付になった場合でも、通常メッセージなら最初のテキスト添付 1 件を自動で読む
- `/systemprompt` はそのチャンネルの Bot 挙動を直接変える。スラッシュコマンドを使える人なら変更できる前提で扱う
- Standby Bot はメイン Bot と同時起動しない前提。GUI では排他制御している
- Standby Bot は同じ `DISCORD_TOKEN` を使う。`STANDBY_CHANNEL_IDS` が空なら `CHANNEL_IDS` を使う
- GUI 起動時に `.env` がなければ `.env.example` から自動作成される
- スラッシュコマンドを変更したら GUI の `Register Guild Commands` / `Register Global Commands` または `node register-commands.mjs --guild|--global` を実行する
- UTF-8 でファイルを保存すること
- 日本語の文字化けに注意 (特に `src/**/*.mjs`, `gui/`, `.env.example`, `README.md`)
- GUI は起動毎にランダムな `X-GUI-Token` を発行し、`Host` / `Origin` ヘッダも検証する。改造する際は `gui/index.html` の `<meta name="gui-token">` と `gui/app.js` の `GUI_TOKEN` を維持すること
- `npm test` で syntax check + `tests/` 配下のユニットテスト (現在 72 件) が走る。純関数を変更したら必要に応じてテストを追加する
