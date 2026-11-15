// Token Radar: the value model, the farm plans and the dashboard data.
//
// The idea, in one paragraph: a pre-token protocol's launch is worth roughly what
// the market already pays for a token in its line of work. The snapshot itself
// tells us that price — for every category, the median market-cap-to-TVL ratio
// of the protocols in it whose token already trades. Multiply the protocol's
// own TVL by that ratio and you have a base value; then tilt it with the
// snapshot's own figures (seven-day TVL growth, how long it has run with no
// token recorded, how many chains it runs on) and with one small prior: how
// often protocols in its category have issued a token at all, again read off
// the snapshot. Nothing in the model names a protocol. Feed it a different
// snapshot and it ranks a different field.
//
// Language the board keeps: a protocol "records no token" when DefiLlama's
// record carries no gecko_id and no symbol for it. That is not proof it has
// no token, only what the record says, and the dashboard says so.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface Breakdown {
  ratio: number;
  ratioSource: string;
  growth: number;
  maturity: number;
  breadth: number;
  prior: number;
  base: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  rank: number;
  implied_value_usd: number;
  breakdown: Breakdown;
  watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number;
  ratio: number;
  age_days: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: {
    name: string;
    overall_ratio: number;
    ratio_low: number;
    ratio_high: number;
    ratio_min_n: number;
    rows: number;
    watchlist_rows: number;
    live_rows: number;
  };
  board: BoardRow[];
  live: LiveRow[];
}

/** Categories whose products are a wrapped, staked or bridged form of a token that already trades. */
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a protocol name must not start with (a house rule, from the snapshot's guide). */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** The value ratio is clamped so one outlier category cannot price the whole board. */
const RATIO_LOW = 0.02;
const RATIO_HIGH = 1.5;
/** A category needs this many token-bearing protocols before its own median is trusted. */
const RATIO_MIN_N = 3;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `listedAt` to the snapshot's date, or null when either is missing. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 86_400_000);
}

/** True when the snapshot records no token for the protocol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** True when the protocol is a wrapped, staked or bridged product, or a versioned name. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return true;
  return VERSION_TAIL.test(p.name);
}

/** A protocol the radar ranks: it records no token and is not another token's wrapper. */
export function isRankable(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && !isWrappedProduct(p);
}

/** Seven-day growth tilts value by at most -24% / +60%; no report means no tilt. */
export function growthMult(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  return 1 + 0.4 * clamp(change7d / 100, -0.6, 1.5);
}

/** Time served with no token recorded: new names are discounted, veterans earn a small premium. */
export function maturityMult(age: number | null): number {
  if (age === null) return 1;
  if (age < 90) return 0.92;
  if (age < 365) return 1;
  if (age < 730) return 1.06;
  return 1.1;
}

/** Running on more chains is worth a little: up to +10% for six or more. */
export function breadthMult(chains: string[]): number {
  return 1 + 0.02 * Math.min(Math.max(chains.length - 1, 0), 5);
}

export interface RatioTable {
  overall: number;
  byCategory: Map<string, number>;
  byCategoryN: Map<string, number>;
}

/** Median mcap/TVL of the protocols whose token already trades, per category and overall. */
export function buildRatios(snapshot: Snapshot): RatioTable {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
    }
  }
  const overall = clamp(median(all), RATIO_LOW, RATIO_HIGH);
  const medians = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const [category, values] of byCategory) {
    counts.set(category, values.length);
    if (values.length >= RATIO_MIN_N) medians.set(category, clamp(median(values), RATIO_LOW, RATIO_HIGH));
  }
  return { overall, byCategory: medians, byCategoryN: counts };
}

/** The ratio a protocol is priced at, and where that ratio came from. */
export function ratioFor(p: SnapshotProtocol, table: RatioTable): { ratio: number; source: string } {
  if (p.category !== null) {
    const own = table.byCategory.get(p.category);
    if (own !== undefined) {
      return { ratio: own, source: `median mcap/TVL of ${table.byCategoryN.get(p.category)} token-bearing ${p.category} protocols` };
    }
  }
  return { ratio: table.overall, source: 'median mcap/TVL of all token-bearing protocols in the snapshot' };
}

/**
 * How often a category has issued a token at all, read off the snapshot:
 * 0.90 + 0.20 * share, so the prior tilts value by -10% to +10% and nothing more.
 */
export function categoryPrior(p: SnapshotProtocol, snapshot: Snapshot): number {
  let total = 0;
  let withToken = 0;
  for (const other of snapshot.protocols) {
    if (other.category !== p.category) continue;
    total += 1;
    if (!recordsNoToken(other)) withToken += 1;
  }
  if (total === 0) return 1;
  return 0.9 + 0.2 * (withToken / total);
}

/** The implied value and every factor that built it. */
export function impliedValue(
  p: SnapshotProtocol,
  snapshot: Snapshot,
  table: RatioTable,
): { implied: number; breakdown: Breakdown; age: number | null } {
  const age = ageDays(snapshot.as_of, p.listed_at);
  const { ratio, source } = ratioFor(p, table);
  const growth = growthMult(p.change_7d);
  const maturity = maturityMult(age);
  const breadth = breadthMult(p.chains);
  const prior = categoryPrior(p, snapshot);
  const base = p.tvl_usd * ratio;
  const implied = Math.round(base * growth * maturity * breadth * prior);
  return { implied, breakdown: { ratio, ratioSource: source, growth, maturity, breadth, prior, base: Math.round(base) }, age };
}

// ---------------------------------------------------------------- farm plans

function chainList(chains: string[]): string {
  if (chains.length === 0) return 'its chain';
  if (chains.length === 1) return chains[0]!;
  if (chains.length === 2) return `${chains[0]} and ${chains[1]}`;
  return `${chains.slice(0, 2).join(', ')} and ${chains.length - 2} more`;
}

function money(tvl: number): string {
  if (tvl >= 500_000_000) return '$250–$500';
  if (tvl >= 100_000_000) return '$100–$500';
  return '$50–$250';
}

function weeks(age: number | null): string {
  if (age !== null && age < 180) return '4–6 weeks';
  return '6–12 weeks';
}

/** The one action step, tuned to what the protocol actually does. */
function actionStep(p: SnapshotProtocol, chain: string, size: string, span: string): string {
  const name = p.name;
  switch (p.category) {
    case 'Dexs':
      return `Swap ${size} across two or three of its pools on ${chain}, then add the same size as liquidity to one pool; keep the position for at least ${span} and route one swap a week through ${name}.`;
    case 'Lending':
      return `Supply ${size} of a major asset (ETH, USDC or wBTC) as collateral on ${chain}; borrow no more than 30% of it once, repay within a week, and leave the supply earning for ${span}.`;
    case 'Yield':
    case 'Yield Aggregator':
      return `Deposit ${size} into its highest-TVL vault on ${chain}; leave it compounding for ${span} and top it up once a month instead of moving it between vaults.`;
    case 'Derivatives':
      return `Open a small ${size} position on ${chain} at no more than 2x leverage, close it within a week, and repeat one trade a week for ${span}; never leave a leveraged position open unattended.`;
    case 'RWA':
      return `Buy or mint ${size} of its tokenised asset on ${chain} after reading the prospectus and redemption terms; hold at least 30 days and check the redemption window before adding more.`;
    case 'CDP':
      return `Mint ${size} of its stablecoin against two to three times that in collateral on ${chain}, at under 50% loan-to-value; repay the loan within 30 days and keep the collateral ratio above the liquidation line.`;
    case 'Basis Trading':
      return `Deposit ${size} into its basis vault on ${chain}; hold through at least one full funding cycle (about 2–4 weeks) and check the vault's stated return and drawdown before topping up.`;
    case 'Risk Curators':
      return `Allocate ${size} to one of its curated vaults on ${chain}; read the curator's strategy and fee note first, then hold ${span} and compare its return with the vault's stated benchmark.`;
    case 'Onchain Capital Allocator':
      return `Deposit ${size} into its allocation vault on ${chain}; read the allocator's mandate and fee schedule first, then hold ${span} and review its monthly allocation report.`;
    case 'Chain':
      return `Bridge ${size} to the chain and use its native apps for real activity: one swap, one liquidity deposit and one transfer a week for ${span}, keeping each transaction's gas under about $2 where possible.`;
    case 'Liquidity Manager':
      return `Deposit ${size} into one of its managed liquidity positions on ${chain}; leave it for ${span} and rebalance only when the position drifts out of range.`;
    case 'Leveraged Farming':
      return `Deposit ${size} as collateral and open a leveraged farm at no more than 2x on ${chain}; watch the health factor daily for the first week and close the position if it falls near liquidation.`;
    case 'Restaking':
    case 'Staking Pool':
      return `Stake ${size} through ${name} on ${chain}; keep the stake for at least one full reward epoch (about 2–4 weeks) and unstake only through its official interface.`;
    default:
      return `Use ${name} on ${chain} with ${size} of real activity: one deposit or swap a week for ${span}, keeping every transaction hash so the activity can be shown later.`;
  }
}

/** Five concrete steps: set up, act, repeat, track, and know the risks and the exit. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainList(p.chains);
  const size = money(p.tvl_usd);
  const span = weeks(age);
  const firstChain = p.chains[0] ?? 'its chain';
  const ageNote = age === null ? 'its listing date is not in the snapshot' : `it has run ${age} days with no token recorded`;
  return [
    `Open ${p.name}'s official site and docs from its DefiLlama page; connect a wallet you control, switch it to ${firstChain}, and confirm the contract address matches the docs before depositing anything. Budget about 30 minutes and no deposit yet.`,
    actionStep(p, chain, size, span),
    `Repeat the activity once a week for ${span}: same size, same wallet, same chain. One steady position beats five one-off deposits, and most points systems reward weeks of activity, not single transactions. Expect roughly $0.10–$2 of gas per transaction on a low-fee chain, more on Ethereum.`,
    `Track it: save every transaction hash, screenshot the position each week, and check ${p.name}'s official docs and announcements for a points page or quest. ${p.name} records no token and promises none — ${ageNote} — so farm the usage, not a rumour.`,
    `Know the exit and the risks before you add more: the position can be withdrawn through the official interface at any time, smart-contract risk is real, and a token may never be issued. Never deposit money you need back, and never pay anyone who offers to farm it for you.`,
  ];
}

// ---------------------------------------------------------------- board

/** The token-bearing protocols, set aside as comparables the board is priced against. */
export function liveRows(snapshot: Snapshot, count = 24): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.tvl_usd > 0)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, count)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd!,
      ratio: p.mcap_usd! / p.tvl_usd,
      age_days: ageDays(snapshot.as_of, p.listed_at),
    }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const table = buildRatios(snapshot);
  const watch = new Set(snapshot.watchlist);
  const rows: BoardRow[] = snapshot.protocols
    .filter(isRankable)
    .map((p) => {
      const { implied, breakdown, age } = impliedValue(p, snapshot, table);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        age_days: age,
        listed_at: p.listed_at,
        rank: 0,
        implied_value_usd: implied,
        breakdown,
        watchlist: watch.has(p.slug),
        farm_steps: farmSteps(p, age),
      };
    })
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  // A ranking must rank: force the values strictly down the board so no two rows tie.
  for (let i = 0; i < rows.length; i += 1) {
    if (i > 0 && rows[i]!.implied_value_usd >= rows[i - 1]!.implied_value_usd) {
      rows[i]!.implied_value_usd = rows[i - 1]!.implied_value_usd - 1;
    }
    rows[i]!.rank = i + 1;
  }
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: {
      name: 'snapshot-median mcap/TVL with growth, maturity, breadth and category priors',
      overall_ratio: table.overall,
      ratio_low: RATIO_LOW,
      ratio_high: RATIO_HIGH,
      ratio_min_n: RATIO_MIN_N,
      rows: rows.length,
      watchlist_rows: rows.filter((r) => r.watchlist).length,
      live_rows: live.length,
    },
    board: rows,
    live,
  };
  return { board: rows, radar };
}

/** The gate's own shape, checked before anything is written. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, the gate wants 100 to 4000`;
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i += 1) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${row.slug} carries rank ${row.rank} at position ${i + 1}`;
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${row.slug} is worth more than the row ranked above it`;
    }
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `row ${row.slug} has no positive whole implied value`;
    }
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} carries ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `row ${row.slug} has a farm step of ${trimmed.length} characters`;
      }
    }
  }
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  for (const row of board) {
    if (!slugs.has(row.slug)) return `row ${row.slug} is not one of the snapshot's protocols`;
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot.json: protocols and watchlist must be arrays');
  }
  return raw;
}

/** The dashboard's data, written beside the page as window.RADAR. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
