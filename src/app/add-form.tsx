"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { addWatchAction, type AddFormState } from "./actions";
import { TOYOKO_HOTELS } from "./hotels";

const input =
  "w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-500";
const label = "block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1";

/** 検索付きコンボボックス（テキスト入力で絞り込み、候補をクリックで選択） */
function HotelCombobox() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<{ code: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // フォームの自動リセット時はホテル欄だけをクリアし、他の入力内容は保持する
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = (e: Event) => {
      e.preventDefault();
      setQuery("");
      setSelected(null);
      setOpen(false);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TOYOKO_HOTELS.slice(0, 40);
    const kw = q.replace(/\s+/g, "");
    return TOYOKO_HOTELS.filter((h) => h.name.toLowerCase().includes(kw) || h.code.includes(kw)).slice(0, 40);
  }, [query]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        className={input}
        placeholder="ホテル名で検索（例: 伊勢崎）"
        autoComplete="off"
        value={selected && query === selected.name ? query : query || (selected ? selected.name : "")}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
          setOpen(true);
        }}
        required
      />
      {selected && <input type="hidden" name="hotel" value={selected.code} />}
      {open && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg">
          {candidates.length === 0 && <li className="px-3 py-2 text-sm text-zinc-500">該当するホテルがありません</li>}
          {candidates.map((h) => (
            <li key={h.code}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => {
                  setSelected(h);
                  setQuery(h.name);
                  setOpen(false);
                }}
              >
                {h.name}
                <span className="ml-2 text-xs text-zinc-500">{h.code}</span>
              </button>
            </li>
          ))}
          {candidates.length === 40 && (
            <li className="px-3 py-1.5 text-xs text-zinc-500">
              先頭40件のみ表示。絞り込んでください
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function AddForm({ defaultStart }: { defaultStart: string }) {
  const [state, formAction, pending] = useActionState<AddFormState, FormData>(addWatchAction, {
    error: null,
    ok: false,
    message: null,
  });

  // React は action 完了後にフォームを自動リセットするため、各欄を制御コンポーネントにして
  // 登録後も入力内容を保持する（ホテル欄は reset イベントでクリアする）
  const [start, setStart] = useState(defaultStart);
  const [nights, setNights] = useState("1");
  const [rooms, setRooms] = useState("1");
  const [people, setPeople] = useState("1");
  const [smoking, setSmoking] = useState("all");
  const [email, setEmail] = useState("");

  return (
    <form action={formAction} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div>
        <label className={label} htmlFor="hotel">
          ホテル
        </label>
        <HotelCombobox />
      </div>
      <div>
        <label className={label} htmlFor="start">
          チェックイン日
        </label>
        <input
          id="start"
          name="start"
          type="date"
          required
          className={input}
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </div>
      <div>
        <label className={label} htmlFor="nights">
          泊数
        </label>
        <input
          id="nights"
          name="nights"
          type="number"
          min={1}
          max={9}
          className={input}
          value={nights}
          onChange={(e) => setNights(e.target.value)}
        />
      </div>
      <div>
        <label className={label} htmlFor="rooms">
          部屋数
        </label>
        <input
          id="rooms"
          name="rooms"
          type="number"
          min={1}
          max={4}
          className={input}
          value={rooms}
          onChange={(e) => setRooms(e.target.value)}
        />
      </div>
      <div>
        <label className={label} htmlFor="people">
          人数
        </label>
        <input
          id="people"
          name="people"
          type="number"
          min={1}
          max={6}
          className={input}
          value={people}
          onChange={(e) => setPeople(e.target.value)}
        />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label className={label} htmlFor="smoking">
          喫煙希望
        </label>
        <select
          id="smoking"
          name="smoking"
          className={input}
          value={smoking}
          onChange={(e) => setSmoking(e.target.value)}
        >
          <option value="all">指定なし</option>
          <option value="no_smoking">禁煙</option>
          <option value="smoking">喫煙</option>
          <option value="all">指定なし</option>
        </select>
      </div>
      <div className="col-span-2">
        <label className={label} htmlFor="email">
          通知先メールアドレス
        </label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          required
          className={input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="col-span-2 flex items-end sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-zinc-900 dark:bg-white px-4 py-2 text-sm font-medium text-white dark:text-zinc-900 disabled:opacity-50"
        >
          {pending ? "登録中…" : "監視を登録"}
        </button>
      </div>
      {state.error && <p className="col-span-full text-sm text-red-600">{state.error}</p>}
      {state.ok && state.message && <p className="col-span-full text-sm text-emerald-600">{state.message}</p>}
    </form>
  );
}
