# AI Context

## プロジェクト概要

このプロジェクトは、Discord 上でローカル LLM と会話し、画像生成 (`/draw`) や音楽生成 (`/music`)、Web 検索付き会話 (`/webchat`)、Vision 入力、オセロ対戦 (`/othello`) も扱える Bot です。通常メッセージとスラッシュコマンドの両方に対応し、ローカル GUI から `.env` 編集・Bot 起動停止・スラッシュコマンド登録・ログ確認ができます。

主な技術スタック:
- Node.js 18+ (グローバル `fetch` を使用)
- `discord.js` v14
- `dotenv`
- OpenAI 互換 API を使うローカル LLM
  - Ollama / LM Studio / Custom OpenAI-compatible API
- Stable Diffusion WebUI (AUTOMATIC1111) `--api` モード
- ComfyUI (`--listen`) または ACE-Step API
- GUI は Node の `http` モジュールで動くローカル HTTP サーバー + 静的 HTML/CSS/JS

起動・確認コマンド:
- 依存関係インストール: `npm install`
- GUI 起動: `start-gui.bat` または `npm run gui`
- Bot 直接起動: `start-bot.bat` または `npm start`
- ギルドコマンド登録: `npm run register` (= `register:guild`) または `npm run register:global`
- 登録済みコマンド削除: `npm run clear:guild` / `npm run clear:global`
- 構文チェック: `npm run check`
- テスト: `npm test` (`npm run check` + `node --test tests/`)

## リポジトリ構成 (2026-05-11 時点)

`index.mjs` は 2 行のシムで、実体は `src/` に分割されています。

- `index.mjs` : `src/bot.mjs` を import するだけ
- `src/bot.mjs` : Discord クライアントと全スラッシュコマンドハンドラ
- `src/config.mjs` : `.env` 読込、検証 (`assertRuntimeConfig`)、ランタイム定数
- `src/utils/llm-config.mjs` : `defaultLlmBaseUrl` / `normalizeOpenAiBaseUrl` / `nativeOllamaBaseUrl` / `numEnv` / `normalizeOllamaKeepAliveForApi` (`gui-server.mjs` からも import)
- `src/utils/env-file.mjs` : `parseEnvValue` / `parseEnvContent` / `formatEnvValue` (`gui-server.mjs` からも import)
- `src/utils/text.mjs` : `truncateText` / `splitForDiscord` / `stripInvisibleCharacters` / `previewValueForLog` / `codePointPreview`
- `src/utils/http.mjs` : `fetchJsonWithTimeout` / `sleep`
- `src/llm/chat.mjs` : `localLlmChat` / `injectRuntimeSystemMessages` / `getCurrentDateContextText` / `preloadOllamaModel`
- `src/llm/diagnostics.mjs` : `logLlmTimeout` / `logEmptyLlmResponse` / `estimateHistoryCharCount`
- `src/web/urls.mjs` : URL 抽出と正規化 (パレン残高判定で Wikipedia URL を壊さない)
- `src/web/ollama-search.mjs` : Ollama `web_search` / `web_fetch` 呼び出し
- `src/web/context.mjs` : 検索結果から LLM に渡すコンテキスト構築、source URL 追記
- `src/web/router.mjs` : `WEB_SEARCH_MODE=auto` のターン毎判定 LLM
- `src/discord/state.mjs` : チャンネル状態 (`stateByChannel`, `getState`, `trimHistory`)
- `src/discord/images.mjs` : 画像添付の MIME 判定、`fetchImageForLlm`, provider 別 vision payload 生成
- `src/discord/typing.mjs` : `startTypingLoop`
- `src/discord/queue.mjs` : `processQueue` (画像 / 通常 / web 検索 / auto-route の分岐)
- `src/sd/draw.mjs` : `sdTxt2Img`, `translatePromptForSd`, `looksJapaneseText`
- `src/music/comfy.mjs` : ComfyUI ワークフローテンプレートの mtime キャッシュ込みの実装
- `src/music/ace.mjs` : ACE-Step API のジョブ実行
- `src/music/queue.mjs` : `musicQueue` / `processMusicQueue` (backend は `MUSIC_BACKEND_MODE` で分岐)
- `src/othello/board.mjs` : 盤面と合法手生成
- `src/othello/ai.mjs` : 難度別の AI (`easy` / `normal` / `hard` / `max`) と位置評価
- `src/othello/render.mjs` : 盤面 PNG エンコーダ (zlib のみ依存)
- `src/othello/game.mjs` : ゲーム進行、リアクション操作、Discord 連携
- `gui-server.mjs` : ローカル GUI サーバー
- `gui/index.html` / `gui/app.js` / `gui/styles.css` : GUI
- `register-commands.mjs` : スラッシュコマンド登録
- `clear-guild-commands.mjs` / `clear-global-commands.mjs` : 削除
- `tests/` : `node --test` ユニットテスト (現在 46 件)
- `comfyui/workflows/` : `/music` 用 ComfyUI workflow
- `start-gui.bat` / `start-bot.bat` / `start-ollama.bat` : Windows 起動補助
- `README.md` / `AGENTS.md` / `docs/ai_context.md` : ドキュメント

## ENV 一覧 (2026-05-11 時点)

必須:
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `CHANNEL_IDS` (カンマ区切り)
- `LLM_PROVIDER` (`ollama` / `lmstudio` / `custom`)
- `LLM_BASE_URL`
- `LLM_MODEL`

任意 (主なもの):
- `GUILD_ID` (カンマ区切り、ギルド登録用)
- `SYSTEM_PROMPT`
- `LLM_API_KEY`
- `LLM_TEMPERATURE` (既定値 `0.4`、0.0-2.0)
- `LLM_MAX_HISTORY_MESSAGES` (既定値 `30`、`0` で履歴ナシ)
- `WEB_SEARCH_MODE` (`manual` または `auto`)
- `BOT_TIMEZONE` (IANA タイムゾーン、既定値 `Asia/Tokyo`)
- `OLLAMA_KEEP_ALIVE` (例: `30m`, `1h`, `-1`)
- `OLLAMA_WEB_API_KEY` (`/webchat` 用)
- `OLLAMA_URL` / `OLLAMA_MODEL` (旧設定、`LLM_*` の fallback)
- `SD_WEBUI_URL`, `SD_WIDTH`, `SD_HEIGHT`, `SD_STEPS`, `SD_CFG_SCALE`, `SD_SAMPLER`, `SD_BATCH_SIZE`, `SD_NEGATIVE_PROMPT`
- `SD_PROMPT_TRANSLATE`, `SD_PROMPT_TRANSLATE_MODEL`
- `MUSIC_BACKEND` (`comfyui` または `ace`)
- `COMFY_URL`, `COMFY_WORKFLOW_PATH`
- `ACE_URL`, `ACE_POLL_MS`, `ACE_API_KEY`
- `GUI_HOST` / `GUI_PORT` (GUI サーバーの bind)
- `GUI_NO_OPEN=1` (GUI 起動時にブラウザを開かない)
- `GUI_LOG_MAX_BYTES` (`bot.log` のローテーション閾値、既定値 5MB)

## これまでに実施した作業

### 2026-04-24 以前
- ローカル GUI 追加 (`.env` 読込・保存、Bot 起動停止、ログ表示、コマンド登録)
- LLM Provider 切り替え (`LLM_PROVIDER` / `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY`) を実装
- GUI で `/v1/models` および Ollama `/api/tags` からモデル一覧取得
- `/webchat` 追加 (`OLLAMA_WEB_API_KEY` 必須)
- `/draw` 完了メッセージを `生成完了` に整理、翻訳プロンプト表示
- typing 表示の定期送信化
- Vision 入力の provider 別 payload 切替 (LM Studio は `image_url.url` オブジェクト、Ollama は `image_url` 文字列)
- LM Studio の MIME 制約に合わせて画像を `image/png` / `image/jpeg` に正規化

### 2026-05-02 〜 2026-05-07
- `OLLAMA_KEEP_ALIVE` を追加 (GUI、`.env.example`、`start-ollama.bat` 連携)
- Bot 起動時に Ollama `/api/chat` で preload を 1 回送る
- README に Discord 招待時の OAuth2/権限・`GUILD_ID` の使い分けを整理
- `GUILD_ID` のカンマ区切り複数対応、GUI を Guild / Global に分割
- `OLLAMA_KEEP_ALIVE=-1` で preload 400 になる問題を修正
- `clientReady` イベントに切替 (`ready` 非推奨対応)
- 空応答を検知して `bot.log` に診断情報 (`code point preview` 含む) を残し、ユーザーへ警告
- Ollama 通常チャットに `reasoning_effort: "none"` を付与
- 通常チャットの temperature を `LLM_TEMPERATURE` で設定可能化 (既定 `0.4`)、`/webchat` も同設定を使用
- `LLM_MAX_HISTORY_MESSAGES` 追加と timeout 時の履歴件数/文字数ログ
- 現在日時 (Asia/Tokyo) を system message として毎回注入
- `WEB_SEARCH_MODE=auto` 追加 (LLM ルーティングで検索要否とクエリを判定)
- 検索経路でメッセージ中の URL を抽出して直接 `web_fetch` する経路を追加

### 2026-05-11 コードレビュー & 一括修正 (コミット 58e0480)
コードレビューを実施し、見つかった全項目を一括で修正。

バグ修正:
- `messagesToSend` を try の外に巻き上げ、catch 内の `ReferenceError` を解消
- 空応答時 / 例外時に直前の `user` メッセージを履歴から pop
- `numEnv` が空文字列を default 扱いするように修正 (`SD_WIDTH=` が 0 になる問題)
- `processQueue` / `processMusicQueue` を fire-and-forget 化
- ComfyUI workflow テンプレートを mtime ベースでホットリロード
- URL 末尾の `)` をパレン残高でしか剥がさない (Wikipedia URL を壊さない)
- `pickFirstImageAttachment` が全添付を走査
- Othello の loopGuard 到達時に warn ログ

セキュリティ:
- GUI に per-session `X-GUI-Token` を導入 (`crypto.randomBytes(32)` を `index.html` の `<meta name="gui-token">` に注入、`gui/app.js` が `X-GUI-Token` ヘッダで送信)
- `Host` / `Origin` ヘッダ検証で DNS rebinding と他オリジン CSRF を遮断
- `/api/llm/models` は localhost または保存済み `LLM_BASE_URL` の host:port のみ許可 (SSRF 防止)
- `bot.log` を 5MB でローテーション (`.1` `.2` `.3` まで保持、`GUI_LOG_MAX_BYTES` で調整可能)

改善・小修正:
- `BOT_TIMEZONE` 追加 (`Asia/Tokyo` 既定、GUI と `.env.example` に追加)
- `/draw` の width/height/steps/cfg/batch をクランプ (64-2048, 1-150, 1-30, 1-4)
- `/music` 出力 > 24MB は親切なエラー返却
- Othello "最強" 難度を depth 3 → 5、ポジショナル評価テーブル追加
- restart が旧プロセスの `close` イベント待ち
- GUI ログを ISO 8601 タイムスタンプに
- 画像 MIME を `image/png` / `image/jpeg` / `image/webp` のみ許可 (GIF 廃止)
- ACE / ComfyUI のエラーメッセージで巨大 JSON を 500 文字に切詰
- `Events` enum 採用 (`Events.ClientReady` 等)、未使用 import を削除
- `register-commands.mjs` の `/chat` description を「message か image どちらか」と明示

リポジトリ整理:
- `bak/` ディレクトリ削除
- `discord-local-llm-bot.code-workspace` を git から untrack
- `.gitignore` に `*.code-workspace` と `*.log.*` を追加
- `package.json` に `type=module`, `engines`, `repository`, `bugs`, `homepage`, `keywords` を追加

### 2026-05-11 src/ 分割 & ユニットテスト追加 (コミット 3152703)
- `index.mjs` 2618 行を 2 行のエントリシムに縮小
- 全実装を `src/` 配下 23 モジュールへ分割 (ファイル構成は上記「リポジトリ構成」セクション参照)
- `gui-server.mjs` 内の重複ヘルパを `src/utils/llm-config.mjs` / `src/utils/env-file.mjs` から import するよう統合
- `tests/` に `node --test` ベースのユニットテスト 46 件を追加
  - `llm-config.test.mjs` : `numEnv` / `defaultLlmBaseUrl` / `normalizeOpenAiBaseUrl` / `nativeOllamaBaseUrl` / `normalizeOllamaKeepAliveForApi`
  - `env-file.test.mjs` : `.env` パース / フォーマット round trip
  - `text-utils.test.mjs` : `truncateText` / `stripInvisibleCharacters` / `splitForDiscord`
  - `web-urls.test.mjs` : `normalizeDirectUrl` (パレン残高込み) / `extractDirectUrls` / `isUsefulSearchQuery`
  - `state.test.mjs` : `getState` 初期化 / `trimHistory`
  - `othello-board.test.mjs` : 盤面ロジック
  - `othello-ai.test.mjs` : 難度別 AI 選択と `evaluateBoard`
  - `config-validators.test.mjs` : `resolveLlmTemperature` / `resolveLlmMaxHistoryMessages` / `resolveWebSearchMode` / `resolveBotTimezone`
- テストで `trimHistory(hist, 0)` の境界バグを発見 (`Array.prototype.slice(-0)` が配列全体を返すため `LLM_MAX_HISTORY_MESSAGES=0` が機能していなかった)。明示的にガードを入れて修正。
- `npm test` を `npm run check && node --test tests/` に拡張

## 採用した方針
- 既存仕様を壊さず、機能追加と整理を段階的に進める
- LLM 接続は provider 固有実装ではなく OpenAI 互換 API を基準に寄せる
- 旧環境変数 (`OLLAMA_URL` / `OLLAMA_MODEL`) は即削除せず fallback として残す
- ドキュメント (README / AGENTS.md / ai_context.md) は実装基準で更新する
- 巨大ファイル分割は `src/` 配下に責務単位で配置 (`config` / `utils` / `llm` / `web` / `discord` / `sd` / `music` / `othello`)
- 純関数は `tests/` でカバー。Discord SDK や fetch を直接叩く関数はテスト対象から外す (内部実装が壊れても外部接続テストでは検知しにくいため)
- GUI のセキュリティはトークン + Host/Origin 検証 + SSRF 制限 + ログローテーションの 4 層

## 既知の課題・注意ポイント
- README / `.env.example` / `src/**/*.mjs` / `gui/` は日本語を含むので UTF-8 を維持する
- Git の改行コードは `core.autocrlf=true` 環境では LF → CRLF 警告が出るが内容は問題なし
- `.env` はユーザーのローカル設定。勝手に書き換えないこと
- GUI トークンは起動毎に再生成されるので、GUI を再起動したらブラウザ側もリロードが必要
- `LLM_MAX_HISTORY_MESSAGES=0` は履歴なし運用を意味する。`trimHistory` 内でガード済み
- `BOT_TIMEZONE` に未知の IANA 名を入れると warn ログを残して `Asia/Tokyo` に fallback
- `/music` の生成結果が 24MB を超えると Discord にアップロードできないため、Bot 側で案内メッセージのみ返す
- LM Studio は Vision 入力の MIME に厳しい (`image/webp` を拒否することがある)。送信時に正規化済み

## Git 操作に関する厳守事項
危険な Git 操作は絶対に行わないこと。特に以下は禁止:
- `git reset` / `git reset --hard`
- `git clean`
- `git checkout -- .` / `git restore .`
- `git push --force` / `git push -f`
- `git rebase`
- 履歴を書き換える操作
- ユーザーの許可なくファイルを削除する操作

Git 操作の運用ルール:
- コミット、ブランチ作成、push、pull、merge、rebase などが必要そうな場合は、実行前に必ずユーザーに確認する
- 既存の変更を勝手に破棄しない
- Git 操作を提案する場合は、実行内容とリスクを説明する
- 作業前に `git status` を確認し、自分が触っていない差分を壊さない
- ユーザーの git config を変更しない。コミット時に identity が必要な場合は `git -c user.name=... -c user.email=...` のような単発オーバーライドを使う

## 運用ルール
- 重要な進捗があったら本ファイルを随時更新する
- 方針変更、重要な実装完了、問題の発見、未完了タスクの追加・解決があった場合は必ず追記する
- 作業を中断する前、または一段落したタイミングで、最新状況を反映する
- 次回セッションの AI エージェントが最初に読む前提で、簡潔かつ具体的に書く
- 既存内容を消すより、経緯が分かる形で追記・整理を優先する
- 実装とドキュメントが食い違ったら、実装を確認したうえで両方更新する

## 未完了タスク

現時点で未完了の実装タスクはありません。次回作業時の確認事項:
- 新しい機能追加や仕様変更の依頼内容
- `.env` と GUI の設定項目が現行コードとずれていないか
- スラッシュコマンド追加・変更時に `register-commands.mjs` の再実行が必要か
- GUI のモデル一覧取得が対象 Provider で継続して動いているか
- `npm test` がパスしているか (現在 46 件)

保留中の判断 / 後回しにしている改善案 (2026-05-11 レビューで検討したもの):
- 構造化ロガー導入 (pino など)。現状は `console.log/warn/error` をプレフィックス付きで使用
- Othello "最強" 難度を depth 5 から更に深く (transposition table を入れるならコード量が増える)
- `WEB_SEARCH_MODE=auto` で URL 以外でも軽量ヒューリスティック (例: 「今」「最新」「今日」を含む短文) を判定 LLM の前段に置く
- README/AGENTS.md と `/persona` の説明に「誰でも channel 内の Bot 挙動を書き換えられる」旨を明示
- `gui-server.mjs` 内の `readEnv` / `ensureEnvFile` も `src/utils/` 側に寄せられそうだが今回は保留

## 動作確認・検証状況
直近 (2026-05-11) で確認したこと:
- `npm run check` 通過
- `npm test` 通過 (46 件すべて pass)
- 全 `src/**/*.mjs` を `import()` で読み込み、循環参照なしで起動できることをスモークテスト

過去セッションで実施済み:
- GUI 起動 / `.env` 保存 / Bot 起動停止 / ログ表示
- `/draw` (API 有効化前提)
- LLM Provider 切替とモデル選択 UI
- `/webchat` の Ollama Web Search 経由

未確認:
- GUI トークン認証の手動検証 (実ブラウザで `X-GUI-Token` が送信されているか)
- すべての Provider / すべてのモデルでの長期運用
- ComfyUI / ACE-Step の全パターン
- 実運用サーバーでの権限差異による Discord コマンド問題

現時点で把握しているテスト・ビルドエラー: なし

## 更新履歴

- 2026-04-24
  - `docs/ai_context.md` 新規作成
  - 通常チャット typing 表示の定期更新を追記
  - Vision 入力 payload を Ollama / LM Studio で切り替える変更を追記
  - LM Studio 向け Vision 入力の MIME 正規化を追記

- 2026-05-02
  - `/webchat` を追加 (`OLLAMA_WEB_API_KEY` 必須、source URL 付き回答)

- 2026-05-06
  - `OLLAMA_KEEP_ALIVE` 追加 (GUI / `start-ollama.bat` / preload 連携)
  - `GUILD_ID` カンマ区切り複数対応、GUI を Guild / Global 分割
  - `OLLAMA_KEEP_ALIVE=-1` で preload 400 だった問題を修正
  - `clientReady` イベントに切替、空応答時の診断ログを追加
  - 通常チャット系で `reasoning_effort: "none"` を付与

- 2026-05-07
  - `LLM_TEMPERATURE` を追加 (既定 `0.4`)、`/webchat` も同じ温度を使用
  - `LLM_MAX_HISTORY_MESSAGES` 追加と timeout 診断ログ
  - 現在日時 (Asia/Tokyo) を system message に毎回注入
  - `WEB_SEARCH_MODE=auto` 追加

- 2026-05-11 (コミット 9743f52)
  - 検索経路でメッセージ内の URL を抽出して直接 `web_fetch`、必要時のみ Web Search を併用

- 2026-05-11 (コミット 58e0480) — コードレビュー & 一括修正
  - バグ修正 B1〜B8: `messagesToSend` 巻き上げ、空応答時の履歴 pop、`numEnv` 空文字列、`processQueue/processMusicQueue` の fire-and-forget 化、ComfyUI workflow の mtime リロード、URL パレン残高、`pickFirstImageAttachment` の全添付走査、Othello loopGuard 警告
  - セキュリティ S1〜S3: GUI per-session `X-GUI-Token` + Host/Origin 検証、`/api/llm/models` SSRF 制限、`bot.log` ローテーション (5MB / `.1`-`.3`)
  - 改善: `BOT_TIMEZONE`、`/draw` パラメータクランプ、`/music` 24MB ガード、Othello "最強" depth 5 + 位置評価、restart の close 待ち、ISO 8601 ログ、画像 MIME ホワイトリスト (gif 廃止)、エラー JSON 切詰、`Events` enum、不要 import 削除、`register-commands.mjs` の `/chat` description 修正、`bak/` 削除、`.code-workspace` を git から untrack、`package.json` に type/engines/repository
  
- 2026-05-11 (コミット 3152703) — src/ 分割 & ユニットテスト
  - `index.mjs` 2618 行 → 2 行のエントリシム
  - `src/` 配下 23 モジュールへ分割 (`config` / `utils` / `llm` / `web` / `discord` / `sd` / `music` / `othello`)
  - `gui-server.mjs` の重複ヘルパを `src/utils/` から共有 import
  - `tests/` に `node --test` 46 件追加 (`llm-config` / `env-file` / `text-utils` / `web-urls` / `state` / `othello-board` / `othello-ai` / `config-validators`)
  - テストで `trimHistory(hist, 0)` の境界バグを発見し修正 (`slice(-0)` が全体を返すため `LLM_MAX_HISTORY_MESSAGES=0` が無効化されていた)
  - `npm test` を `npm run check && node --test tests/` に拡張
  - 引き継ぎ用に本ファイルと AGENTS.md / README.md を整合
