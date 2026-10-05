# hotel-vacancy（東横イン空室通知ツール）

東横イン公式サイトの空室を低頻度ポーリングで監視し、**空室 0 → 1以上** の遷移（エッジ）を通知する個人用ツール。
設計思想・検証済み技術事項は [東横イン空室通知_実装計画.md](./東横イン空室通知_実装計画.md) を参照。

**非営利・個人利用**。公式サイトへの負荷を最小化するため、頻度・並列数を厳格に制限しています。変更しないでください。

## 構成

- Node.js 22+ / TypeScript（`node` が直接実行、トランスパイル不要）
- 保存: Neon Postgres（`@neondatabase/serverless` の HTTP SQL。`fetch` のみで依存最小）
- 通知: SMTP(nodemailer)。宛先は監視ごとに登録
- スケジューラ: Vercel Cron（`/api/cron` を定期実行）

```
src/watcher/
  fetcher.mts   # SSR(planResponse)取得・抽出 + tRPCカレンダー副ルート
  analyze.mts   # 正規化・禁煙フィルタ・部屋型max合算
  store.mts     # Neon Postgres（watches / checks / notifications）
  watcher.mts   # 1監視チェック・エッジ検知・通知・連続失敗ポリシー
  notifier.mts  # smtp メール
  config.mts    # .env.local 読み込み
  tests/        # node:test（ネットワークなし・fixture使用）

src/app/api/cron/route.ts  # Vercel Cron 用（全監視を1周）
```

## セットアップ

```bash
cp .env.example .env.local   # DATABASE_URL と通知先（SMTP_*）を設定
npm install
npm run test:watcher         # ユニットテスト
npm run dev                  # Web UI（監視の追加・削除・手動チェック）
```

監視の登録・削除・即時チェックはすべて Web UI（`/`）から行います。

## 動作仕様（要点）

- チェック間隔は cron 側で制御（**推奨 60分以上**）。1実行で全監視を直列処理し、監視間に 3–10 秒の sleep + jitter。
- `planResponse`（SSR埋め込みJSON）が主データ源。欠落時は tRPC カレンダーにフォールバック。
- 空室合計は**部屋型ごとの最大値の合算**（同一部屋型の複数プランによる二重計上を防止）。
- 禁煙希望は `specs.isSmoking` で絞り込み。
- 通知は「前回 0（または初回）→ 今回 1以上」のエッジのみ。再通知は `TOYOKO_REFIRE_MIN`（既定360分）で抑止。
- 連続 `TOYOKO_MAX_FAILURES` 回の失敗でエラー通知。**403/429 は即全監視停止**（自動リトライ禁止）。
- `TOYOKO_STOP_AFTER_NOTIFY=true` で通知後にその監視を停止（元サイト仕様の踏襲）。

## Vercel Cron で定期チェック

1. Vercel にデプロイし、環境変数 `DATABASE_URL` と `SMTP_*` を設定。
2. `vercel.json` の cron（毎日 1回：`0 3 * * *` UTC = JST 正午）が `/api/cron` を呼び、全アクティブ監視を1周して通知判断します。
3. 誤実行防止に `CRON_SECRET` を設定すると、Vercel が付与する `Authorization: Bearer` を検証します。
4. Hobby プランは cron を**1日1回**に制限しています。より高頻度にする場合は Pro プランにするか、外部 cron から `GET /api/cron`（Bearer トークン付き）を呼び出してください。チェック間隔は**60分以上**を推奨。

## 法務・マナー指針（必読）

- 自動アクセスは東横イン利用規約に抵触する可能性があり、**自己責任**で行うこと。
- **商用利用・再配布・予約代行はしない。** 通知は公式サイトへの誘導のみ。
- 取得頻度は本計画の上限を厳守（高頻度化・大量監視は絶対にしない）。
- 403/429 を受けたら即停止。IP 変更等の回避行為を行わない。
