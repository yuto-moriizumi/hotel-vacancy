// 期限切れ監視の自動削除: 宿泊終了日（checkin_date+nights）を過ぎた監視を掃除する。
// cron（/api/cron → runAll）から毎回呼ばれ、監視開始前に一括 DELETE する。
import type { WatcherDeps } from "./watcher.mts";

/** 'YYYY-MM-DD'（UTC日付）を返す */
export function isoDateUtc(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' に日数を加算する（UTC換算） */
export function addDaysIso(iso: string, days: number): string {
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const d = new Date(t + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * 削除対象の基準日（cutoff）。終了日 <= cutoff の監視が対象。
 * now の UTC 日付から猶予日数を引く（既定1日 → 終了日の翌々日に削除、タイムゾーンずれの保険）。
 */
export function expiredCutoff(now: Date, graceDays: number): string {
  return addDaysIso(isoDateUtc(now), -Math.max(0, graceDays));
}

/** 期限切れ監視を一括削除する（@returns 削除された watch id 一覧） */
export async function purgeExpiredWatches({
  store,
  config,
  log = (m) => console.log(m),
  now = new Date(),
}: Pick<WatcherDeps, "store" | "config" | "log"> & { now?: Date }): Promise<number[]> {
  const cutoff = expiredCutoff(now, config.expireGraceDays);
  const ids = await store.deleteExpired(cutoff);
  for (const id of ids) log(`[expire] watch#${id} 宿泊終了日を過ぎたため削除 (cutoff=${cutoff})`);
  return ids;
}
