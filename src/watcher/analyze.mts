// 解析・正規化（§2.5: 部屋型ごとのmax合算で物理空室数を算出）
import type { PlanResponse, SmokingFilter, NormalizedPlan, Analysis } from "./types.mts";

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 禁煙フィルタの部屋型適合判定（specs.isSmoking 正） */
function roomMatches(rm: boolean | null | undefined, filter: SmokingFilter): boolean {
  if (filter === "all") return true;
  if (rm === null || rm === undefined) return false; // 判定不能は除外
  return filter === "no_smoking" ? rm === false : rm === true;
}

export function analyze(pr: PlanResponse, filter: SmokingFilter): Analysis {
  const plans: NormalizedPlan[] = [];
  let totalVacant = 0;

  for (const rt of pr.roomTypeList ?? []) {
    const isSmoking = rt.specs?.isSmoking ?? null;
    if (!roomMatches(isSmoking, filter)) continue;

    const rtPlans = (rt.plans ?? []).map((p): NormalizedPlan => ({
      roomTypeId: rt.roomTypeId ?? "",
      roomTypeName: rt.roomTypeName ?? null,
      isSmoking,
      planCode: p.planCode ?? null,
      planName: p.planName ?? null,
      generalPrice: numOrNull(p.price?.generalPrice),
      membershipPrice: numOrNull(p.price?.membershipPrice),
      generalVacant: num(p.vacant?.generalVacantRoom),
      membershipVacant: num(p.vacant?.membershipVacantRoom),
    }));
    plans.push(...rtPlans);

    // §2.5: 同一部屋型の複数プランは二重計上になるので max を取って合算
    const rtMax = rtPlans.reduce((a, p) => Math.max(a, p.generalVacant), 0);
    totalVacant += rtMax;
  }

  const avail = plans.filter((p) => p.generalVacant > 0 && p.generalPrice != null);
  // 同一 planCode が複数部屋型で重複掲載されるため top3 表示用に dedupe
  const seen = new Set<string>();
  const availablePlansByPrice = [...avail]
    .sort((a, b) => (a.generalPrice ?? 0) - (b.generalPrice ?? 0))
    .filter((p) => {
      const k = p.planCode ?? `${p.roomTypeId}:${p.planName}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const lowestPrice = avail.length ? Math.min(...avail.map((p) => p.generalPrice as number)) : null;
  const memAvail = plans.filter((p) => p.generalVacant > 0 && p.membershipPrice != null);
  const lowestMembershipPrice = memAvail.length ? Math.min(...memAvail.map((p) => p.membershipPrice as number)) : null;

  return {
    hotelCode: pr.hotelCode ?? null,
    hotelTitle: pr.hotelTitle ?? null,
    totalVacant,
    lowestPrice,
    lowestMembershipPrice,
    plans,
    availablePlansByPrice,
  };
}
