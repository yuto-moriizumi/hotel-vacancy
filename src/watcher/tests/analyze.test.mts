// 抽出器・解析のユニットテスト（実fixture使用・ネットワークなし）
// 実行: node src/watcher/tests/analyze.test.mts
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { extractPlanResponse, extractBalancedObject } from "../fetcher.mts";
import { analyze } from "../analyze.mts";
import type { PlanResponse } from "../types.mts";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string): PlanResponse =>
  JSON.parse(readFileSync(join(here, "../../tests/fixtures", `${name}.json`), "utf8"));

function wrapNextData(pr: unknown): string {
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { planResponse: pr } } })}</script></body></html>`;
}

test("extractPlanResponse: __NEXT_DATA__ 経由で復元できる", () => {
  const pr = fx("available");
  const got = extractPlanResponse(wrapNextData(pr));
  assert.ok(got);
  assert.equal(got.hotelCode, "00270");
  assert.equal((got.roomTypeList ?? []).length, 8);
});

test("extractPlanResponse: バランス括弧フォールバックでも復元できる", () => {
  const pr = fx("available");
  const json = JSON.stringify({ props: { pageProps: { planResponse: pr } } });
  // NEXT_DATAタグを壊してJSON埋め込みのみにする
  const html = `<script>window.__data=${json};</script>`;
  const got = extractPlanResponse(html);
  assert.ok(got, "fallback extraction failed");
  assert.equal(got.hotelCode, "00270");
});

test("extractBalancedObject: 文字列内のブレースを無視する", () => {
  const html = `"planResponse":{"a":"x{y}z","b":{"c":1}},"after":9`;
  assert.equal(extractBalancedObject(html, '"planResponse":'), '{"a":"x{y}z","b":{"c":1}}');
});

test("analyze: available fixture で合計・最安値が取れる", () => {
  const a = analyze(fx("available"), "all");
  assert.ok(a.totalVacant > 0);
  assert.ok(a.lowestPrice != null && a.lowestPrice > 0);
  assert.ok(a.lowestMembershipPrice != null && a.lowestMembershipPrice! <= a.lowestPrice!);
  // 空室ありプランが安い順に並ぶ
  const prices = a.availablePlansByPrice.map((p) => p.generalPrice as number);
  assert.deepEqual(prices, [...prices].sort((x, y) => x - y));
});

test("analyze: §2.5 部屋型ごとのmax合算（単純合算ではない）", () => {
  const pr = fx("available");
  // 単純合算と比較して「部屋型ごとのmax合算」が正しいことの検算
  let naiveSum = 0;
  let byTypeSum = 0;
  const perType = new Map<string, number>();
  for (const rt of pr.roomTypeList ?? []) {
    for (const p of rt.plans ?? []) {
      naiveSum += p.vacant?.generalVacantRoom ?? 0;
      const cur = perType.get(rt.roomTypeId ?? "") ?? 0;
      perType.set(rt.roomTypeId ?? "", Math.max(cur, p.vacant?.generalVacantRoom ?? 0));
    }
  }
  for (const v of perType.values()) byTypeSum += v;
  assert.ok(naiveSum > byTypeSum, "単純合算は部屋型max合算より大きいはず（二重計上）");
  assert.equal(analyze(pr, "all").totalVacant, byTypeSum);
});

test("analyze: 禁煙フィルタで絞り込まれる（specs.isSmoking 正）", () => {
  const all = analyze(fx("available"), "all");
  const ns = analyze(fx("available"), "no_smoking");
  const sm = analyze(fx("available"), "smoking");
  assert.ok(ns.plans.every((p) => p.isSmoking === false));
  assert.ok(sm.plans.every((p) => p.isSmoking === true));
  assert.ok(ns.totalVacant < all.totalVacant || sm.totalVacant < all.totalVacant);
  assert.equal(ns.totalVacant + sm.totalVacant, all.totalVacant);
});

test("analyze: multinight fixture（3泊2名2室）で形状維持", () => {
  const a = analyze(fx("multinight"), "all");
  assert.equal(a.totalVacant, 44); // 実測値
});

test("analyze: roomTypeList 空（過去日等）は安全に 0", () => {
  const a = analyze({ hotelCode: "00270", roomTypeList: [] }, "all");
  assert.equal(a.totalVacant, 0);
  assert.equal(a.lowestPrice, null);
  assert.deepEqual(a.availablePlansByPrice, []);
});
