// 共通型定義（東横イン空室ウォッチャ）

export type SmokingFilter = "all" | "no_smoking" | "smoking";
export type Route = "ssr" | "trpc" | "none";
export type NotifyKind = "vacancy" | "error" | "test";

/** planResponse.roomTypeList[].plans[] の最小観測形状（未知キーは許容） */
export interface RawPlan {
  planCode?: string;
  planName?: string;
  smokingCategorize?: string;
  membershipCategorize?: string;
  price?: { generalPrice?: number | null; membershipPrice?: number | null };
  vacant?: { generalVacantRoom?: number | null; membershipVacantRoom?: number | null };
}

export interface RawRoomType {
  roomTypeId?: string;
  roomTypeName?: string;
  roomClassId?: string;
  specs?: { isSmoking?: boolean | null } & Record<string, unknown>;
  plans?: RawPlan[];
}

/** SSR内の __NEXT_DATA__.props.pageProps.planResponse */
export interface PlanResponse {
  hotelCode?: string;
  hotelTitle?: string;
  canReservation?: boolean;
  isKoreaHotel?: boolean;
  isHotelBeforeOpen?: boolean;
  openDate?: string | null;
  hotelStatus?: string;
  roomTypeList?: RawRoomType[];
}

/** 正規化されたプラン1件 */
export interface NormalizedPlan {
  roomTypeId: string;
  roomTypeName: string | null;
  isSmoking: boolean | null;
  planCode: string | null;
  planName: string | null;
  generalPrice: number | null;
  membershipPrice: number | null;
  generalVacant: number;
  membershipVacant: number;
}

export interface Analysis {
  hotelCode: string | null;
  hotelTitle: string | null;
  /** 部屋型ごとのmaxを合算した物理空室数（§2.5） */
  totalVacant: number;
  lowestPrice: number | null;
  lowestMembershipPrice: number | null;
  plans: NormalizedPlan[];
  /** 空室ありプランを安い順（通知文上位3件用） */
  availablePlansByPrice: NormalizedPlan[];
}

/** check1回分の結果 */
export interface CheckOutcome {
  route: Route;
  httpStatus: number | null;
  analysis: Analysis | null;
  error: string | null;
  /** planResponse生のJSON文字列（任意保存） */
  snapshotJson: string | null;
}

export interface Watch {
  id: number;
  hotel_code: string;
  hotel_name: string | null;
  checkin_date: string;
  nights: number;
  rooms: number;
  people: number;
  smoking: SmokingFilter;
  active: boolean;
  /** 通知先メールアドレス（監視ごと。必須） */
  notify_to: string | null;
  created_at: string;
}

export type NewWatch = Omit<Watch, "id" | "created_at" | "active"> & { active?: boolean };

/** 永続化インターフェース（実装: Postgres/Neon） */
export interface StoreLike {
  addWatch(w: NewWatch): Promise<number>;
  listWatches(onlyActive?: boolean): Promise<Watch[]>;
  getWatch(id: number): Promise<Watch | undefined>;
  setActive(id: number, active: boolean): Promise<void>;
  recordCheck(input: {
    watchId: number;
    checkedAt: string;
    httpStatus: number | null;
    route: Route | null;
    totalVacant: number | null;
    lowestPrice: number | null;
    plansJson: string | null;
    error: string | null;
  }): Promise<void>;
  /** 直近の「成功」レコードの total_vacant（無ければ null=初回） */
  lastGoodVacant(watchId: number): Promise<number | null>;
  /** 末尾から数えた連続エラー回数（成功レコードでリセット） */
  consecutiveErrors(watchId: number): Promise<number>;
  insertNotification(input: { watchId: number; sentAt: string; kind: NotifyKind; body: string }): Promise<void>;
  /** 直近 minutes 分の vacancy 通知有無（再通知ゲート） */
  hasRecentVacancyNotification(watchId: number, minutes: number): Promise<boolean>;
  /** 監視削除（checks/notifications は CASCADE） */
  deleteWatch(id: number): Promise<void>;
  /** 監視ごとの最新チェック結果（1監視=1行） */
  latestCheckByWatch(): Promise<
    { watchId: number; checkedAt: string; route: string | null; totalVacant: number | null; lowestPrice: number | null; error: string | null }[]
  >;
  close(): void;
}
