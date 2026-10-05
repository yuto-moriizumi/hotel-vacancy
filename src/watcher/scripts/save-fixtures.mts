// 実HTMLから planResponse JSON を抽出して tests/fixtures/ に保存する（開発時のみ実行）
// 使い方: node src/watcher/scripts/save-fixtures.mts /path/to/a.html nameA [/path/to/b.html nameB ...]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractPlanResponse } from "../fetcher.mts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../tests/fixtures");
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
for (let i = 0; i + 1 < args.length; i += 2) {
  const html = readFileSync(args[i], "utf8");
  const pr = extractPlanResponse(html);
  if (!pr) {
    console.error(`planResponse not found in ${args[i]}`);
    process.exitCode = 1;
    continue;
  }
  const name = args[i + 1];
  const out = resolve(outDir, `${name}.json`);
  writeFileSync(out, JSON.stringify(pr, null, 2));
  const nPlans = (pr.roomTypeList ?? []).reduce((a, rt) => a + (rt.plans ?? []).length, 0);
  console.log(`saved ${out} roomTypes=${(pr.roomTypeList ?? []).length} plans=${nPlans} hotel=${pr.hotelCode}`);
}
