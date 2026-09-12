# /draw 参照画像対応の実装記録

## 実装概要

既存の `/draw` に任意の `image` / `reference` / `model` を追加しました。参照画像なしでは従来のJSONによる画像生成、参照画像ありでは複数ファイルのmultipartによる画像編集を使用します。OpenAI APIの送信形式は [公式画像生成ガイド](https://developers.openai.com/api/docs/guides/image-generation#edit-images) を確認しました。

SDの既存オプション・既定値・数値制限・日本語翻訳・翻訳失敗時の継続処理は維持し、新オプションを明示したときだけOpenAI専用である旨を返します。

## この機能で変更・追加したファイル

| ファイル | 内容 |
| --- | --- |
| `src/bot.mjs` | ハンドラの振り分け、help/status/モデルログ |
| `src/config.mjs` | モデル設定とedits URL |
| `src/image/openai.mjs` | multipart編集、使用量と完了表示、共通エラー処理 |
| `src/image/openai-models.mjs` | モデル選択と互換fallback（新規） |
| `src/image/reference-images.mjs` | 添付の取得・形式・容量検証（新規） |
| `src/image/references.mjs` | manifest・画像の保存、再読込、置換、削除（新規） |
| `src/discord/draw.mjs` | テスト可能な画像生成ハンドラ（新規） |
| `src/discord/references.mjs` | reference管理のハンドラ（新規） |
| `src/discord/image-commands.mjs` | draw/referenceの登録定義（新規） |
| `register-commands.mjs` | 画像コマンドの登録定義を組み込み |
| `gui-server.mjs` | Flare/Sunburst設定欄と互換設定の説明 |
| `.env.example` | 追加設定とfallbackの説明 |
| `.gitignore` | `data/references/` を除外 |
| `README.md` | 新仕様、設定、利用例、共有範囲 |
| `AGENTS.md` | プロジェクト内の機能・ファイル案内 |
| `tests/openai-image-edits.test.mjs` | モデル、multipart、APIエラー・timeout（新規） |
| `tests/draw-handler.test.mjs` | 旧利用方法、参照画像全組合せ、SD回帰（新規） |
| `tests/image-commands.test.mjs` | コマンドの必須/任意項目とchoices（新規） |
| `tests/reference-handler.test.mjs` | 管理コマンド、永続再読込、長文返信（新規） |
| `tests/reference-images.test.mjs` | ダウンロード・MIME・容量制限（新規） |
| `tests/references.test.mjs` | 保存上限、衝突、置換復旧、同時追加、パス検証（新規） |
| `docs/draw-references-implementation.md` | この実装記録（新規） |

同時進行のオセロ改修はこの機能の変更一覧に含めません。既存の調査メモ、`.env`、稼働プロセスはこの作業では変更していません。

## 環境変数

- `OPENAI_IMAGE_MODEL_FLARE`：既定値 `gpt-image-2.5-flare`
- `OPENAI_IMAGE_MODEL_SUNBURST`：既定値 `gpt-image-2.5-sunburst`

各専用設定 → 旧 `OPENAI_IMAGE_MODEL` → 各既定値の順です。旧設定を明示している場合の使用モデルを維持します。GUIで未設定の旧モデルを自動補完して新しい既定値を隠すこともありません。

## Slash commandと生成仕様

`/draw prompt [width] [height] [steps] [cfg] [sampler] [seed] [batch] [negative] [image] [reference] [model]`

| mode | 参照なし | 参照あり |
| --- | --- | --- |
| 未指定 / auto | Flare設定 / generations | Sunburst設定 / edits |
| flare | Flare設定 / generations | Flare設定 / edits |
| sunburst | Sunburst設定 / generations | Sunburst設定 / edits |

`image` は添付1枚、`reference` は保存済みprofile名またはslugです。添付→profile内の保存順で合計最大8枚、PNG/JPEG/WebP・1枚20 MiB以下に制限します。`batch` は従来どおり1～4枚です。

完了返信にはprompt、provider、実モデル、選択mode、size、quality、生成枚数、参照枚数、input_text / input_image / output / total tokensを表示します。

## referenceの操作

```text
/reference add name:Akaya image:<画像1> image2:<画像2>
/reference add name:Akaya image:<追加画像>
/reference add name:Akaya image:<新画像> replace:true
/reference list
/reference show name:akaya
/draw prompt:"月面のAkaya" reference:Akaya model:auto
/reference delete name:Akaya
```

addは最大4添付を1回で登録し、未指定時は追加、replace:trueで全置換します。1 profile最大8枚です。displayNameは新規登録の入力を保持し、slugは内部識別子として安全に正規化します。保存先は `<ProjectRoot>/data/references/<slug>/`、画像と `manifest.json` を再起動後にも読み込めます。

listはdisplay name / slug / image count / updatedAt、showはcreatedAtと各画像のfilename / originalName / sizeも表示します。削除対象がない場合はエラーです。全許可チャンネルで共有するため、利用者は共通profileを追加・置換・削除できます。

## 検証・反映結果

- `npm run check`：PASS。
- 変更したsource 9モジュールの `node --check`：PASS。
- `npm test`：158件PASS、失敗0、skip 0（2026-09-13の実行時点。同時進行のオセロ改修のテストも含む）。
- PR用に `origin/main` から作成した独立worktreeへ本機能だけを取り出し、`npm ci --ignore-scripts` 後に再検証：`npm test` 117件PASS、失敗0、skip 0。`npm run check` と変更source 9モジュールの構文確認もPASS。こちらがPRに含むコードでの結果。
- マージ前に最新main（オセロ改修とYuE2 `/music` 更新を含む `a447f5b`）を統合し、`src/bot.mjs` のimport競合を各ハンドラを保持して解消。統合後の `npm test` は207件PASS、失敗0、skip 0。`npm run check`、Bot構文確認、差分の空白検査もPASS。
- 旧OpenAI generationテストをそのまま維持し、imageのみ・referenceのみ・両方・合計8枚・9枚拒否、モデル切替、SDの旧オプションを検証。
- 一時ディレクトリでCRUD・新しいstoreインスタンスからの再読込・同時追加・保存上限・名前衝突・置換失敗からの保持・中断バックアップ復旧・hash不一致・junction拒否を検証。
- `git diff --check` と `git check-ignore`：PASS。保存画像とmanifestはGit対象外。
- 別エージェントによる旧SD処理との比較、OpenAI生成・編集・設定・登録定義の読み取りレビュー：具体的な不具合・要件漏れなし。
- `.env`のBot tokenが指すApplicationとCLIENT_IDの一致を読み取り確認後、`npm run register:guild` を実行：既存AIBotの設定済み1ギルドで登録成功。
- Discordから再取得して `/draw` の全12オプション、model choices、`/reference` の4サブコマンドと必須/任意項目をローカル定義と意味上照合：PASS。Discordが省略する空配列・falseは同等と扱う。
- Global command登録、Botプロセスの再起動、実API画像生成、Discordメッセージ送信は実施していない。

## 実機確認の範囲

OpenAI生成・SD生成・Discordへの生成画像送信はモックによる検証です。課金を伴う実API生成とDiscord上の操作試験は実施していません。Botへ新コードを反映するには通常の停止・起動が必要です。

この作業で確認した現行の画像providerは `stable-diffusion` です。OpenAI参照生成を利用する際は `IMAGE_PROVIDER=openai` と既存のAPIキー設定を使用してください。APIキー値はこの記録へ保存していません。
