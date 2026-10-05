import AddForm from "./add-form";
import { deleteWatchAction, setWatchActiveAction, checkNowAction } from "./actions";
import { addDays } from "../watcher/fetcher.mts";
import { loadConfig } from "../watcher/config.mts";
import { Store, makeNeonDb } from "../watcher/store.mts";

export const dynamic = "force-dynamic";

const btn =
  "rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40";

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default async function Home() {
  const cfg = loadConfig();
  const store = new Store(makeNeonDb(cfg.dbUrl));
  let watches: Awaited<ReturnType<typeof store.listWatches>> = [];
  let latest: Awaited<ReturnType<typeof store.latestCheckByWatch>> = [];
  let dbError: string | null = null;
  try {
    watches = await store.listWatches(false);
    latest = await store.latestCheckByWatch();
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  } finally {
    store.close();
  }
  const byWatch = new Map(latest.map((l) => [l.watchId, l]));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">東横イン 空室通知</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        条件に合う空室が <b>0 → 1以上</b> になったときに通知します。監視は Vercel Cron（<code>/api/cron</code>）で定期ポーリングされます。
      </p>

      {dbError && (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
          DB接続エラー: {dbError}
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-medium">監視の登録</h2>
        <p className="mt-1 mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          対象ホテルは公式サイトのホテル一覧（<a className="underline" href="https://www.toyoko-inn.com/hotel_list/" target="_blank" rel="noreferrer">toyoko-inn.com/hotel_list</a>）から選択できます。
        </p>
        <AddForm />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">監視一覧（{watches.length}件）</h2>
        {watches.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">まだ監視がありません。</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {watches.map((w) => {
              const l = byWatch.get(w.id);
              return (
                <li key={w.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        w.active ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {w.active ? "監視中" : "停止中"}
                    </span>
                    <a
                      className="font-medium underline-offset-2 hover:underline"
                      href={`https://www.toyoko-inn.com/search/result/room_plan/?hotel=${encodeURIComponent(w.hotel_code)}&start=${w.checkin_date}&end=${addDays(w.checkin_date, w.nights)}&room=${w.rooms}&people=${w.people}&smoking=all&tab=roomType&sort=recommend`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {w.hotel_name ?? `ホテル ${w.hotel_code}`}
                    </a>
                    <span className="text-xs text-zinc-500">{w.hotel_code}</span>
                  </div>
                  <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                    {w.checkin_date}〜（{w.nights}泊） / {w.rooms}室・{w.people}名 /{" "}
                    {w.smoking === "no_smoking" ? "禁煙" : w.smoking === "smoking" ? "喫煙" : "禁煙指定なし"}
                    {w.notify_to && ` / 通知先: ${w.notify_to}`}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {l
                      ? l.error
                        ? `最終チェック: ${fmt(l.checkedAt)} — エラー: ${l.error}`
                        : `最終チェック: ${fmt(l.checkedAt)} — 空室 ${l.totalVacant ?? "?"}室 / 最安 ${l.lowestPrice != null ? l.lowestPrice.toLocaleString() + "円" : "-"}（${l.route}）`
                      : "未チェック"}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {w.active && (
                      <form action={checkNowAction}>
                        <input type="hidden" name="id" value={w.id} />
                        <button type="submit" className={btn}>
                          今すぐチェック
                        </button>
                      </form>
                    )}
                    <form action={setWatchActiveAction}>
                      <input type="hidden" name="id" value={w.id} />
                      <input type="hidden" name="active" value={w.active ? "0" : "1"} />
                      <button type="submit" className={btn}>
                        {w.active ? "停止" : "再開"}
                      </button>
                    </form>
                    <form action={deleteWatchAction}>
                      <input type="hidden" name="id" value={w.id} />
                      <button type="submit" className={`${btn} text-red-600 dark:text-red-400`}>
                        削除
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="mt-12 border-t border-zinc-200 dark:border-zinc-800 pt-4 text-xs text-zinc-500 dark:text-zinc-400">
        個人利用・非営利。公式サイトへのアクセスは低頻度（直列・間隔制限）に制限されています。詳細は README を参照。
      </footer>
    </main>
  );
}
