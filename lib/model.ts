// The token radar's model: one sealed snapshot in, one ranked board out.
//
// The board's implied values are derived from the snapshot's own figures, in the open:
//
//   1. What the market pays for TVL today. Every protocol in the snapshot that already has a token
//      carries a market cap and a TVL, so each category has an observed market-cap-to-TVL multiple.
//      A category's multiple is its median observed multiple, winsorised at the snapshot's own 90th
//      percentile (one outlier — a prediction market at 400x — cannot set a category's price) and
//      shrunk toward the global median in proportion to how few tokenised protocols the category
//      has: multiple = (n x median + 8 x global median) / (n + 8). A category with no tokenised
//      protocol takes the global median. Nothing is priced off a hand-written list of names.
//
//   2. Four adjustments per protocol, each from its own record:
//      momentum  1 + 0.6 x clamp(change_7d, -30, +30) / 100 — a week of TVL growth or flight.
//      maturity  0.78 + 0.30 x min(age_days, 1460) / 1460 — how long it has run with no token;
//                an unlisted age takes 0.92, the factor of a roughly two-year-old protocol.
//      breadth   1 + 0.02 x min(chains - 1, 10) — a launch is worth more on more chains.
//      size      (tvl / $100M)^-0.18, clamped to [0.65, 1.30] — the snapshot's own tokenised
//                protocols trade at a median 0.65x TVL in the smallest TVL tercile, 0.32x in the
//                middle and 0.08x in the largest: big TVL is simply worth less per dollar.
//
//   implied = tvl x category multiple x momentum x maturity x breadth x size, rounded to dollars.
//
// Who is ranked: every protocol on the snapshot's watchlist, plus every protocol below the
// watchlist's $50M floor that records no token and passes the same screen the house published for
// the watchlist — not an exchange, not a bridge or staking wrapper of a token that already trades,
// not a versioned pool of another protocol. Above the floor the watchlist is taken as complete:
// a protocol up there that the house left off was left off for a reason the snapshot does not
// show (DefiLlama naming a parent protocol), so the radar does not second-guess it. Protocols
// whose token already trades are never ranked; the dashboard shows the largest of them apart,
// at the market's own values.

import { farmSteps } from './farm.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard's methodology exactly as the code runs them. */
export const MODEL = {
  version: 'radar-2',
  shrinkage_k: 8,
  momentum_weight: 0.6,
  momentum_clamp_pct: 30,
  maturity_base: 0.78,
  maturity_range: 0.3,
  maturity_days: 1460,
  unknown_age_factor: 0.92,
  breadth_per_chain: 0.02,
  breadth_max_extra_chains: 10,
  size_anchor_usd: 100_000_000,
  size_exponent: -0.18,
  size_min: 0.65,
  size_max: 1.3,
  live_rows: 16,
} as const;

/** One category's observed pricing: how many tokenised protocols, their median multiple, the multiple used. */
export interface CategoryStat {
  category: string;
  tokenized_n: number;
  /** The winsorised median market-cap-to-TVL of the category's tokenised protocols; null when none. */
  median_multiple: number | null;
  /** The multiple the model applies after shrinkage toward the global median. */
  multiple: number;
  /** How many pre-token protocols the snapshot carries in this category. */
  pretoken_n: number;
}

/** The full arithmetic of one row's implied value, so the dashboard can show every step. */
export interface ScoreBreakdown {
  category_multiple: number;
  category_median: number | null;
  category_tokenized_n: number;
  momentum: number;
  maturity: number;
  breadth: number;
  size: number;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: ScoreBreakdown;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so it is shown at the market's own value, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  global_median_multiple: number;
  global_q90_multiple: number;
  scanned: number;
  pretoken: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  aggregate_implied_usd: number;
  categories: CategoryStat[];
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from the listing day to the snapshot day; null when the listing day is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * The screen the house published for its watchlist, applied below the floor: a protocol is a
 * candidate future launch when it records no token, is not an exchange, bridge or staking wrapper,
 * is not a versioned pool of another protocol and does not carry a wrapped or staked product's name.
 */
export function passesScreen(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The value at fraction `f` of a sorted list, the nearest-rank way. */
function quantile(sorted: number[], f: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))]!;
}

/** Every category's observed pricing, computed from the snapshot's tokenised protocols alone. */
export function categoryStats(snapshot: Snapshot): { stats: Map<string, CategoryStat>; globalMedian: number; globalQ90: number } {
  const observed = new Map<string, number[]>();
  const pretokenCount = new Map<string, number>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    const cat = p.category ?? 'Uncategorised';
    if (isPreToken(p)) {
      pretokenCount.set(cat, (pretokenCount.get(cat) ?? 0) + 1);
    } else if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      const m = p.mcap_usd / p.tvl_usd;
      if (!observed.has(cat)) observed.set(cat, []);
      observed.get(cat)!.push(m);
      all.push(m);
    }
  }
  const globalMedian = median(all);
  const globalQ90 = quantile([...all].sort((a, b) => a - b), 0.9);
  const stats = new Map<string, CategoryStat>();
  const cats = new Set([...observed.keys(), ...pretokenCount.keys()]);
  for (const cat of cats) {
    const arr = observed.get(cat) ?? [];
    const med = arr.length > 0 ? Math.min(median(arr), globalQ90) : null;
    const multiple = med === null ? globalMedian : (arr.length * med + MODEL.shrinkage_k * globalMedian) / (arr.length + MODEL.shrinkage_k);
    stats.set(cat, {
      category: cat,
      tokenized_n: arr.length,
      median_multiple: med === null ? null : round4(med),
      multiple: round4(multiple),
      pretoken_n: pretokenCount.get(cat) ?? 0,
    });
  }
  return { stats, globalMedian, globalQ90 };
}

/** One protocol's implied value and the whole of its arithmetic. */
export function score(p: SnapshotProtocol, asOf: string, stat: CategoryStat): { implied: number; age: number | null; breakdown: ScoreBreakdown } {
  const age = ageDays(asOf, p.listed_at);
  const chg = p.change_7d === null ? 0 : Math.max(-MODEL.momentum_clamp_pct, Math.min(MODEL.momentum_clamp_pct, p.change_7d));
  const momentum = 1 + MODEL.momentum_weight * (chg / 100);
  const maturity = age === null
    ? MODEL.unknown_age_factor
    : MODEL.maturity_base + MODEL.maturity_range * (Math.min(age, MODEL.maturity_days) / MODEL.maturity_days);
  const breadth = 1 + MODEL.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), MODEL.breadth_max_extra_chains);
  const sizeRaw = Math.pow(p.tvl_usd / MODEL.size_anchor_usd, MODEL.size_exponent);
  const size = Math.max(MODEL.size_min, Math.min(MODEL.size_max, sizeRaw));
  const implied = Math.max(1, Math.round(p.tvl_usd * stat.multiple * momentum * maturity * breadth * size));
  return {
    implied,
    age,
    breakdown: {
      category_multiple: stat.multiple,
      category_median: stat.median_multiple,
      category_tokenized_n: stat.tokenized_n,
      momentum: round4(momentum),
      maturity: round4(maturity),
      breadth: round4(breadth),
      size: round4(size),
    },
  };
}

const bySlugOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The board: the whole watchlist, then every screen-passing pre-token protocol below the floor. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const { stats } = categoryStats(snapshot);
  const statOf = (p: SnapshotProtocol): CategoryStat => stats.get(p.category ?? 'Uncategorised')!;
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && p.tvl_usd < snapshot.floor_usd && passesScreen(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const s = score(p, snapshot.as_of, statOf(p));
    return { p, ...s };
  });
  scored.sort((a, b) => b.implied - a.implied || bySlugOrder(a.p.slug, b.p.slug));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmSteps({ slug: s.p.slug, name: s.p.name, category: s.p.category, chains: s.p.chains, tvl_usd: s.p.tvl_usd, age_days: s.age }),
  }));
}

/** The largest live-token protocols, at the market's own values: the board's contrast, never ranked. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || bySlugOrder(a.slug, b.slug))
    .slice(0, MODEL.live_rows)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: round4(p.tvl_usd > 0 ? p.mcap_usd! / p.tvl_usd : 0),
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const { stats, globalMedian, globalQ90 } = categoryStats(snapshot);
  const categories = [...stats.values()]
    .filter((s) => s.pretoken_n > 0 || s.tokenized_n > 0)
    .sort((a, b) => b.pretoken_n - a.pretoken_n || bySlugOrder(a.category, b.category));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL.version,
    model: MODEL,
    global_median_multiple: round4(globalMedian),
    global_q90_multiple: round4(globalQ90),
    scanned: snapshot.protocols.length,
    pretoken: snapshot.protocols.filter(isPreToken).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    aggregate_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    categories,
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
