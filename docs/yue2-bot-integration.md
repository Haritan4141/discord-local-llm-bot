# YuE2 /music integration

## 動作仕様

- 既定はYuE2。/music model:ace-step で既存ACE-Stepを選択可能。
- YuE2のdurationは目安。指定時刻で切らず、モデルの終了を待つ。指定より短い場合も、かなり長くなる場合もある。希望時間に厳密に収まる保証はない。
- 既定の目安120秒、指定10～300秒。内部の安全上限は別設定で既定360秒。目安は安全上限より30秒以上短く指定する。
- YuE2の実生成フレーム数を音声長に使用する。自然終了と上限到達は秒数ではなく、内部のyue2_truncatedを専用出力ノードから取得して区別する。
- 上限到達時も音声を返すが「曲や歌詞が途中で切れている可能性あり」と明示する。自動再生成・自動延長再試行・フェード加工は行わない。
- fullモードの非空ABCを必須とする。生成エラー・メタデータ欠落/不整合は即時エラーにし、20分待機に紛れ込ませない。
- DiscordにはMP3 128kbps、BLUEには元のFLACも保存。自動削除・保存期間ジョブは追加しない。容量管理は管理者が行う。
- モデルが終了を返しても、聴感上の自然な完結を保証するものではない。

## 設定

    MUSIC_DEFAULT_MODEL=yue2
    YUE2_URL=http://192.168.0.104:8191
    YUE2_CHECKPOINT=yue2_3b_bf16.safetensors
    YUE2_MAX_DURATION_SECONDS=360
    MUSIC_VRAM_RELEASE_DELAY_SECONDS=300
    MUSIC_BACKEND=comfyui
    COMFY_URL=http://127.0.0.1:8188

MUSIC_BACKENDはACE-Step側の接続方式として維持する。既存のMUSIC_BACKEND=comfyuiが残っていても、承認された既定モデルはYuE2になる。ACEを既定に戻す場合はMUSIC_DEFAULT_MODEL=ace-stepを明示する。

GUIのMusic項目にも追加。保存後、実行中の仕事がないことを確認してBotだけ再起動する。
更新した/musicの登録は既存GUIまたはnpm run register:guildを使用する。グローバル登録で運用している場合は既存のグローバル登録手順に従う。

旧MUSIC_BACKEND=ace（独立ACE API）も維持する。ただしComfyUIと同等の全体Queue/free APIは未検証のため、ACE APIジョブが失敗した場合は以降の音楽生成を安全側に停止する。管理者がACE API側の状態を確認してからBotを再起動する。自動メモリ解放はComfyUI経路のみ。

## キュー・メモリ・エラー

- Bot全体で1つの逐次音楽キュー。YuE2/ACEを跨いで最大5件（実行中を含む）。
- 開始前に設定されたComfyUIの実キューも確認。処理中・待機中・応答形式不明なら生成しない。未使用の代替サーバーは停止中でもよい。
- HTTPタイムアウトをサーバー停止とみなさない。自動再送や全体/interrupt、キュー削除は行わない。
- 別モデルへ切り替える際は、前に使ったComfyUIモデルを実キューが空のときだけ解放する。
- 既定300秒アイドル後に公式/freeで解放する。解放中は新規Bot生成を待機させる。サーバーが処理中/一時不通なら次のアイドル間隔で再確認する。0は自動解放無効。
- サーバー自体は停止しない。CUDA/デスクトップのVRAMは0にならなくてよい。
- YuE2/ACE-Stepとも、最初に受付応答を確定してDiscordの「考え中」を解除し、待機中→生成中→完了（またはエラー）を同じメッセージに表示する。受付応答に失敗した場合はキューに入れず、生成しない。
- 長い待ち時間でも返信できるよう、受付は `interaction.editReply`、その後はBotの通常メッセージ編集を使用する。入力由来のメンション通知を抑止する。表示修正前から「考え中」が残っている既存投稿は自動修復しない。
- 生成中はWebSocketの実イベントから工程・経過時間・固定ステップの工程内進捗を表示する。可変長部分を全体完成率に置き換えない。実績不足時は工程内の残り時間のみ、同条件の成功実績が3件以上なら完了までの目安も推定する。詳しくは `docs/music-progress-implementation.md` を参照。
- Botと別にGUIから同時生成しないこと。事前確認とfreeは、外部GUIや別Botインスタンスに対する原子的な排他ロックではない。手動のACE/video/Forge/LM Studioは自動停止しない。

## BLUEのサーバー

固定環境:
C:\Users\Atsuki\Documents\Codex_workshop\yue2-blue-validation

RTX3090はUUID固定。既存のACE-Step/video ComfyUI・ドライバー・Python環境は更新しない。

comfyui/custom_nodes/discord_yue2_result を、上記YuE2のComfyUI/custom_nodesにコピーする。ACE/video側へ入れない。

music_controller/start-yue2.batは同フォルダーのyue2-control.ps1を使用する。主な起動引数:

    --listen 127.0.0.1,192.168.0.104 --port 8191
    --disable-all-custom-nodes --whitelist-custom-nodes discord_yue2_result
    --disable-api-nodes

生成とQueueが空になってからstop-yue2.batを使用する。BLUE識別、独立Python、待受所有者、作成時刻、Queueを確認する。ACE/video/その他のPythonは停止しない。status-yue2.bat、および各BATの--checkは読み取りのみ。

停止前のQueue確認と停止処理は原子的ではないため、停止操作中にBotやGUIから新規生成を投入しないこと。

サービス・Scheduled Task・自動起動・全アドレス待受・ルーター転送・WAN公開は追加しない。
手動起動時はコンソールを開いたままにする。ブラウザーを閉じただけでは停止しない。

## LAN Firewall

BLUE上でhostname/IPと既存Privateプロファイルを確認後に実行:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File music_controller\yue2-lan-firewall.ps1 -Action Install

作成するのはDiscord-YuE2-BLUE-8191-From-BLACKだけ。

- Private、TCP8191。
- Local:192.168.0.104、Remote:192.168.0.105のみ。
- Edge Traversal Block。
- Python全般の許可ではなくポート/IP限定。実機では実行ファイル指定の2候補とも通信に一致せずタイムアウトしたため、この範囲でポート規則を使用。IP/プロファイル/ポートは広げていない。

-Action Checkは正確な規則を検証。-Action Removeは同一の専用規則だけを削除する。既存の同名規則が異なる場合は勝手に変更しない。

## 配布とrollback

このPRの作成ではBLACK本番Botの更新・再起動・コマンド登録は行わない。レビュー/マージ後、BLACKでpull、設定保存、生成がないタイミングでBot再起動、コマンド再登録を行う。

外部YuE2環境へのcustom nodeコピーはgit pullだけでは自動実行しない。本タスクではBLUEへ必要ファイルを明示コピーして検証した。旧起動停止ラッパーは独立環境内integration-20260913/controller-backupに保存済み。

モデル選択だけ戻すならMUSIC_DEFAULT_MODEL=ace-step。YuE2を検証専用loopbackへ戻す場合は、処理完了後に停止し、専用Firewall規則を削除して、保持している独立環境のstart-validation.batを使用する。公式ComfyUIソースや元の検証レポートは変更していない。

## 検証

実施結果はdocs/yue2-integration-acceptance.mdに記録。ユニットテストはDiscord/通信をモックし、OpenAI APIは呼び出さない。専用worktreeで実装し、他セッションの画像生成・オセロ変更は混ぜない。

scripts/verify-yue2-transport.mjsは既存prompt-idの結果取得のみで、生成を送信しない。ただし--verify-idle-releaseを明示した場合は実際にPOST /freeを呼び、モデル/VRAMを解放する。BLUE本体・専用8191 endpointに限定し、Bot/GUIが生成を投入しない間だけ実行する。検証用アイドル間隔は1秒、本番の300秒設定は変更しない。
