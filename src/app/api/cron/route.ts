// Vercel Cron 用エンドポイント: 全アクティブ監視を1周（記録＋通知判断込み）
// vercel.json の crons から GET で呼ばれる。CRON_SECRET 設定時は Vercel が
// `Authorization: Bearer <CRON_SECRET>` を付与するため、それを検証する。
import { loadConfig } from "../../../watcher/config.mts";
import { makeNeonDb, Store } from "../../../watcher/store.mts";
import { runAll } from "../../../watcher/watcher.mts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hobby プランの上限
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const cfg = loadConfig();
  const store = new Store(makeNeonDb(cfg.dbUrl));
  try {
    await store.init();
    const r = await runAll({ store, config: cfg });
    return Response.json({ ok: true, checked: r.checked, blocked: r.blocked });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    store.close();
  }
}
