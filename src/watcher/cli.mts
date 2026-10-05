#!/usr/bin/env node
// CLI: node src/watcher/cli.mts <command> [options]
import { loadConfig, parseSmoking } from "./config.mts";
import { makeNeonDb, Store } from "./store.mts";
import { checkWatchOnce, runAll } from "./watcher.mts";
import { isValidIsoDate } from "./fetcher.mts";
import type { Watch } from "./types.mts";

const HELP = `toyoko-watcher CLI
commands:
  init                          テーブル作成（Neon）
  add   --hotel 00270 --start 2026-10-06 [--nights 1] [--rooms 1] [--people 1]
        [--smoking all|no_smoking|smoking] [--name "群馬伊勢崎駅前"] --to you@example.com
  list                          監視一覧
  check --id N                  1監視を1回チェック（記録＋通知判断）
  run                           アクティブ監視を直列で1周
  deactivate --id N             監視を無効化
  activate --id N               監視を有効化
`;

function die(msg: string): never {
  console.error(msg);
  process.exit(2);
}
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (v == null || v.startsWith("--")) die(`--${name.slice(2)} に値が必要です`);
  return v;
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const cfg = loadConfig();
  const store = new Store(makeNeonDb(cfg.dbUrl));
  await store.init();

  switch (cmd) {
    case "init": {
      console.log("schema ready");
      break;
    }
    case "add": {
      const hotel = flag("--hotel");
      const start = flag("--start");
      if (!hotel || !start) die(HELP);
      if (!/^\d{5}$/.test(hotel)) die("--hotel は5桁コード (例: 00270)");
      if (!isValidIsoDate(start)) die("--start は YYYY-MM-DD");
      const nights = Number(flag("--nights") ?? 1);
      if (!Number.isInteger(nights) || nights < 1) die("--nights は1以上");
      const rooms = Number(flag("--rooms") ?? 1);
      if (!Number.isInteger(rooms) || rooms < 1) die("--rooms は1以上");
      const people = Number(flag("--people") ?? 1);
      if (!Number.isInteger(people) || people < 1) die("--people は1以上");
      const smoking = parseSmoking(flag("--smoking") ?? "all");
      const name = flag("--name") ?? null;
      const to = flag("--to");
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) die("--to に通知先メールアドレスが必要です");
      const id = await store.addWatch({ hotel_code: hotel, hotel_name: name, checkin_date: start, nights, rooms, people, smoking, notify_to: to });
      console.log(`added watch id=${id}`);
      break;
    }
    case "list": {
      const ws = await store.listWatches(false);
      if (!ws.length) console.log("no watches");
      for (const w of ws) {
        console.log(
          `#${w.id} ${w.active ? "act " : "off "} ${w.hotel_code} ${w.checkin_date} ${w.nights}n ${w.rooms}r ${w.people}p smoking=${w.smoking} to=${w.notify_to ?? "-"} ${w.hotel_name ?? ""}`,
        );
      }
      break;
    }
    case "deactivate": {
      const id = Number(flag("--id"));
      await store.setActive(id, false);
      console.log(`deactivated #${id}`);
      break;
    }
    case "activate": {
      const id = Number(flag("--id"));
      await store.setActive(id, true);
      console.log(`activated #${id}`);
      break;
    }
    case "check": {
      const id = Number(flag("--id"));
      const w: Watch | undefined = await store.getWatch(id);
      if (!w || !w.active) die(`watch #${id} not found or inactive`);
      const res = await checkWatchOnce(w, { store, config: cfg });
      process.exitCode = res === "blocked" ? 3 : 0;
      break;
    }
    case "run": {
      const r = await runAll({ store, config: cfg });
      console.log(`done checked=${r.checked} blocked=${r.blocked}`);
      process.exitCode = r.blocked ? 3 : 0;
      break;
    }
    default:
      console.log(HELP);
  }
  store.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
