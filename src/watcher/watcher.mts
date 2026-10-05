// オーケストレーション: 1監視のチェック → 記録 → エッジ検知 → 通知 / 連続失敗ポリシー
import type { StoreLike, Watch, CheckOutcome, NotifyKind } from "./types.mts";
import type { Config } from "./config.mts";
import { checkOnce, BlockError } from "./fetcher.mts";
import { notify, formatVacancyMessage, formatErrorMessage } from "./notifier.mts";

export type SleepFn = (ms: number) => Promise<void>;
const realSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms));

export interface WatcherDeps {
  store: StoreLike;
  config: Config;
  sleep?: SleepFn;
  log?: (msg: string) => void;
  /** テスト注入用（既定: 実fetch） */
  check?: typeof checkOnce;
  /** テスト注入用（既定: SMTP notify） */
  notifyFn?: typeof notify;
}

/**
 * 単一監視を1回チェックして記録し、エッジ（0→1以上）で通知する。
 * @returns 'blocked' の時、上位ループは全体を停止すべき（403/429 遮断）
 */
export async function checkWatchOnce(
  watch: Watch,
  { store, config, sleep = realSleep, log = (m) => console.log(m), check = checkOnce, notifyFn = notify }: WatcherDeps,
): Promise<"ok" | "blocked"> {
  const checkedAt = new Date().toISOString();
  const prevVacant = await store.lastGoodVacant(watch.id);

  let outcome: CheckOutcome;
  try {
    outcome = await check(watch, watch.smoking, { sleep });
  } catch (e) {
    if (e instanceof BlockError) {
      log(`[blocked] watch#${watch.id} hotel=${watch.hotel_code} -> ${e.message}`);
      await store.recordCheck({
        watchId: watch.id,
        checkedAt,
        httpStatus: e.status,
        route: null,
        totalVacant: null,
        lowestPrice: null,
        plansJson: null,
        error: e.message,
      });
      await safeNotify(config, "error", "東横イン: 監視を緊急停止", formatErrorMessage(watch, `${e.message}（アクセス遮断の可能性）`), log, notifyFn, watch.notify_to ?? undefined);
      return "blocked";
    }
    // 想定外の実行時例外 → エラーとして記録し失敗カウンタへ
    const msg = e instanceof Error ? e.message : String(e);
    outcome = { route: "none", httpStatus: null, analysis: null, error: msg, snapshotJson: null };
  }

  const a = outcome.analysis;
  await store.recordCheck({
    watchId: watch.id,
    checkedAt,
    httpStatus: outcome.httpStatus,
    route: outcome.route,
    totalVacant: a ? a.totalVacant : null,
    lowestPrice: a ? a.lowestPrice : null,
    plansJson: outcome.snapshotJson,
    error: outcome.error,
  });

  if (a && !outcome.error) {
    const cur = a.totalVacant;
    log(`[ok] watch#${watch.id} ${watch.hotel_code} route=${outcome.route} vacant=${cur} prev=${prevVacant} low=${a.lowestPrice ?? "-"}`);
    // エッジ検知: 前回 0 または 初回観測(null) → 今回 1以上
    if (cur > 0 && (prevVacant == null || prevVacant === 0)) {
      await onVacancyFound(watch, outcome, config, store, log, notifyFn);
    }
  } else {
    const fails = await store.consecutiveErrors(watch.id);
    log(`[fail] watch#${watch.id} ${watch.hotel_code} error=${outcome.error} consecutive=${fails}`);
    if (fails > 0 && fails % config.maxConsecutiveFailures === 0) {
      const body = formatErrorMessage(watch, `連続 ${fails} 回失敗（planResponse 取得不可 / 構造変更の可能性）。最終: ${outcome.error}`);
      const sent = await safeNotify(config, "error", "東横イン: パース失敗が続いています", body, log, notifyFn, watch.notify_to ?? undefined);
      await store.insertNotification({ watchId: watch.id, sentAt: new Date().toISOString(), kind: "error", body });
      void sent;
    }
  }
  return "ok";
}

async function onVacancyFound(
  watch: Watch,
  outcome: CheckOutcome,
  config: Config,
  store: StoreLike,
  log: (m: string) => void,
  notifyFn: typeof notify,
) {
  const a = outcome.analysis!;
  const to = watch.notify_to ?? undefined;
  const recent = await store.hasRecentVacancyNotification(watch.id, config.refireWindowMinutes);
  if (recent) {
    log(`[skip-notify] watch#${watch.id} 直近 ${config.refireWindowMinutes} 分以内に通知済み`);
    return;
  }
  const body = formatVacancyMessage(watch, a);
  const subject = `東横イン 空室あり: ${a.hotelTitle ?? watch.hotel_name ?? watch.hotel_code} (${a.totalVacant}室)`;
  const sent = await safeNotify(config, "vacancy", subject, body, log, notifyFn, to);
  await store.insertNotification({ watchId: watch.id, sentAt: new Date().toISOString(), kind: "vacancy", body });
  if (config.stopAfterNotify && sent) {
    await store.setActive(watch.id, false);
    log(`[stop] watch#${watch.id} 通知後 active=false（stopAfterNotify）`);
  }
}

async function safeNotify(
  config: Config,
  kind: NotifyKind,
  subject: string,
  body: string,
  log: (m: string) => void,
  notifyFn: typeof notify,
  to?: string,
): Promise<boolean> {
  try {
    await notifyFn(config, kind, subject, body, to);
    return true;
  } catch (e) {
    log(`[notify-error] ${e instanceof Error ? e.message : String(e)}`);
    console.log(`\n===== FALLBACK(${kind}) =====\n${subject}\n\n${body}`);
    return false;
  }
}

/** 全アクティブ監視を直列で1周（監視間 sleep+jitter、403/429 で即全停止） */
export async function runAll(deps: WatcherDeps): Promise<{ checked: number; blocked: boolean }> {
  const { store, config, sleep = realSleep, log = (m) => console.log(m) } = deps;
  const watches = await store.listWatches(true);
  let blocked = false;
  let checked = 0;
  for (let i = 0; i < watches.length; i++) {
    const res = await checkWatchOnce(watches[i], { ...deps, sleep, log });
    checked++;
    if (res === "blocked") {
      blocked = true;
      log(`[abort] 全監視を停止（403/429 遮断）`);
      break;
    }
    if (i < watches.length - 1) {
      const j = config.delayMinMs + Math.random() * Math.max(0, config.delayMaxMs - config.delayMinMs);
      await sleep(j);
    }
  }
  return { checked, blocked };
}
