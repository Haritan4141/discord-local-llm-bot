# YuE2 Bot integration acceptance — 2026-09-13

## 判定と範囲

`READY_FOR_PR / BACKEND_INTEGRATION_VERIFIED / PRODUCTION_BOT_NOT_DEPLOYED`

ユーザー承認に基づき、YuE2を既定とし、曲の長さを目安に変更した。目安で音声を切らずモデルEOSを待ち、安全上限360秒だけを別に設けた。上限到達時は途中終了の可能性を明示して音声を返す。無制限生成・自動再生成・終了の聴感保証はしない。

実装は専用worktree / `codex/yue2-bot-integration`、main `a0a6c6a` から分離。他セッションのdraw/reference PR #4、元checkoutの未コミット変更は含めない。PRを作成し、マージはしない。

## 実機・固定環境

- BLUE: `pc5700x / DESKTOP-L9HAM1G / 192.168.0.104`、SSH Alias/IP/hostnameを照合。
- RTX3090 UUID: `GPU-e5370fc5-8df1-b0ba-15e8-4574ca831b2e`。同居RTX3060は使用せず、測定時0MiB。
- 独立runtime: `C:\Users\Atsuki\Documents\Codex_workshop\yue2-blue-validation`。
- ComfyUI: `c75d8c966c29cb0392259af791f43373315b72db`、Python3.13.15、torch2.14 cu130。公式BF16 checkpoint、full、batch1、逐次実行。
- 公式ソースは未変更。専用 `discord_yue2_result` 出力ノードだけを追加してwhitelist起動。
- 既存ACE ComfyUI `cb459573c8fa025bbf9ecf312f6af376d659f567` とvideo ComfyUI `700821e1364eaab0e8f21c538a2131719fec57bf` のHEAD/statusは変更前と同じ。ACEの既存outputプレースホルダー削除差分も保持。
- BLACKは接続確認のみ。本番Discord Bot、ゲームサーバー、設定、Firewall、サービスは変更・再起動していない。

## 生成テスト

各caseの `workflow.json / submission.json / history.json / result.json` はruntime内 `integration-20260913/<case>/` に保存。GPUログは `logs/<case>_gpu.csv`。旧検証結果は上書きしていない。

| Case | 目安 / 上限 | 実際 | 終了メタデータ | 処理時間* | 最大VRAM |
| --- | --- | --- | --- | --- | --- |
| integration_cap240 | 120 / 240秒 | 194.96秒 | truncated=false | 117.575秒 | 11,495MiB |
| integration_cap360 | 120 / 360秒 | 312.20秒 | truncated=false | 212.309秒 | 13,161MiB |
| integration_natural128 | 120 / 360秒 | 66.60秒 | truncated=false | 34.476秒 | 9,897MiB |
| integration_stress360 | 300 / 360秒 | 360.00秒 | truncated=true | 278.871秒 | 16,937MiB |

*処理時間は送信から結果取得・音声検査を含むwall time。初回ロードとwarm runが混在するため性能保証ではない。

全4件: 非空ABC、メタデータ取得、48kHz/stereo、MP3/FLACの全体デコード、有限PCM、非無音の数値検査PASS。監視エラー0。360秒stressで利用可能RAM最小5,430.1MiB。OOMなし。6分生成と上限フラグを実機確認できたため安全上限360秒を採用した。

最初の2件はMP3 V0で検証し、312.2秒曲が9,473,168bytesになったため、最終仕様を128kbpsへ変更。その後の日本語66.6秒は1,069,908bytes、stress360秒は5,777,656bytesで、保守的な8MiB送信枠以内。FLACは元音声としてBLUEに残す。

これらは機械検査であり、新しい4曲の発音・歌詞の完遂・聴感上の自然終了は未評価。過去にユーザーが試聴したbaselineの評価を新しい曲へ流用していない。

## HTTP・キュー・メモリ

- BLACK → BLUE `/queue`、既存結果 `/history`、MP3 `/view`: HTTP200。BLACKのファイル/プロセスを変更せずメモリ上で取得した。
- 最終Botのparser/clientで日本語66.6秒と上限360秒の結果を再取得し、終了区分、メタデータ、MP3サイズを検証: PASS。
- `/free` が成功時に本文なしのHTTP200を返す点を実機で発見。初回transport検証ではJSON parse errorになったが、freeだけ空本文を許可する修正と回帰テストを追加し、再試験PASS。`/queue`等のJSON検証は維持。
- 実際のservice/queueによるアイドル解放を、検証用1秒間隔で実施（本番既定300秒、設定自体は変更していない）。1,017ms後にfree成功。生成を追加せず既存結果だけを使用。
- VRAMは生成後8,297MiBから解放後1,065MiBへ低下。同じYuE2 PID9380が生存し、Queue空、API正常。0MiBにならないCUDA/表示領域等は異常とみなさない。
- 新規ジョブとfreeの排他、最大5件、切替前の解放、busy/不明状態で送信しない、タイムアウト時に再送しない、0で自動解放無効、解放失敗時の再確認はモックテストでも確認。
- 旧ACE API経路は互換維持。通信は15秒で打ち切り、エラー後のリモート状態が未検証のため管理者確認・Bot再起動まで安全側に停止する。この制約は独立ACE APIのみで、通常のACE ComfyUI経路には適用しない。

## LAN / 起動停止

- bindは `127.0.0.1:8191` と `192.168.0.104:8191` のみ。
- BLUE専用規則 `Discord-YuE2-BLUE-8191-From-BLACK`: Private / TCP8191 / Local192.168.0.104 / Remote192.168.0.105 / Edge Block。
- 実行ファイル指定の2候補では実機通信に一致せずtimeoutしたため、同じIP/port/profile限定のポート規則を使用。プログラム条件を外しても接続元やポートは広げていない。
- BLACKから成功、MAINからtimeout（許可対象外）、専用規則の再読込検証PASS。SSH/SMB/既存Firewall/Network Profile/Routerは不変。
- 新しいcontrollerで旧loopbackサーバー停止、LAN版起動、二重起動防止、状態表示を確認。最終的にテスト用PID9380を専用Stop経路で停止し、listener0を確認。検証用隠れサーバーは残していない。
- 必要なときBLUEで `C:\Users\Atsuki\Documents\discord-local-llm-bot\music_controller\start-yue2.bat` を手動起動する。ACE-Step用BATは変更しない。

## 管理資料・未実施

- runtimeのAGENTSは今回承認されたLAN/専用ノード例外だけを反映し、旧baseline資料は保持。
- 管理Sheets `個人IT環境管理_ホームIT基盤 / LAN_サービス状態 / O6` のノートだけを更新、再読込一致。既存値・書式・基準日は維持。物理LANノード/接続・構成図入力は変わらず、Slides再生成不要。
- 本番Discordへの投稿、Bot更新/再起動、slash command再登録、PRマージは未実施。Discord操作部分はモック検証であり、デプロイ後の実コマンド試験を置き換えない。
- Bot外からのGUI同時生成を原子的にロックする仕組みはない。手動生成や他Botと同時に同じサーバー/GPUを使わないこと。

コードの再検証: `npm test`、`git diff --check`、PowerShell parser。APIキーを使う試験は行わない。最終テスト件数とPR URLはPR本文に記録する。
