// Launch Radar model, version "peer-3".
//
// Revision note (after the first real run): the first board's top ranks were
// crowded by bridges and wrapped assets — WBTC, exchange bitcoin wrappers,
// canonical bridges. Their TVL is another token in transit, not demand for a
// launch of their own, and the snapshot's own watchlist construction already
// knew that: it excluded those categories. The extras below the watchlist now
// pass the same eligibility test the watchlist itself passed, and the peer
// prior was strengthened (8 -> 20 phantom peers) after a single live Risk
// Curator trading near 3x TVL was able to price five board rows into the
// top 20 on a sample of one.
//
// Design, in one paragraph: the starter's house model multiplies TVL by a flat
// 0.25 for every protocol, as if a lending market and a DEX were worth the same
// fraction of the value they custody. This snapshot itself says otherwise. Its
// live-token cohort — protocols that already trade — shows what the market
// actually pays per dollar of TVL, and that price differs by category by more
// than an order of magnitude. So this model learns its base multiple from the
// snapshot at run time: for each category it takes the median market-cap / TVL
// ratio of that category's live protocols, shrunk toward the global live
// median so a category with two live peers cannot shout down one with forty.
// Three smaller factors then adjust that peer price: one week of TVL growth
// (symmetric, damped — a single week must not double or halve a valuation),
// survival (a protocol that has stayed tokenless and alive for years has
// proven demand, with sharply diminishing credit after the first year), and
// breadth (a small capped credit for operating on several chains). No protocol
// name is ever special-cased, nothing is read from the clock or the network,
// and every factor a row earns is stored on the row so the dashboard can show
// its working instead of asking to be trusted.

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

/** The tuned constants of this model. The peer multiples are NOT here: they are measured from the snapshot. */
export interface ModelConstants {
  /** Live peers a category must effectively contribute before its own median outweighs the global one. */
  peer_prior_weight: number;
  /** Peer multiple is kept inside this band so one thin category cannot price a board row alone. */
  peer_multiple_min: number;
  peer_multiple_max: number;
  /** change_7d is a percentage; one week is clamped to this symmetric band before it moves value. */
  growth_clamp_pct: number;
  growth_weight: number;
  /** Survival credit: floor + range * sqrt(age / horizon), so year one counts most. */
  maturity_floor: number;
  maturity_range: number;
  maturity_horizon_days: number;
  /** Breadth credit per doubling of the chain count, and its cap. */
  breadth_per_doubling: number;
  breadth_cap: number;
}

export const MODEL: ModelConstants = {
  peer_prior_weight: 20,
  peer_multiple_min: 0.04,
  peer_multiple_max: 1.25,
  growth_clamp_pct: 40,
  growth_weight: 1.1,
  maturity_floor: 0.72,
  maturity_range: 0.28,
  maturity_horizon_days: 1095,
  breadth_per_doubling: 0.03,
  breadth_cap: 1.12,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'peer-3';

/** Board rows beyond the watchlist: the highest-TVL other rankable pre-token protocols. */
export const EXTRA_ROWS = 180;

/** How many live-token protocols the separate live view carries, by market cap. */
export const LIVE_ROWS = 30;

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
  age_days: number | null;
  in_watchlist: boolean;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_sample: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
    confidence: 'high' | 'medium' | 'low';
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: everything the page renders, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  in_watchlist: boolean;
  implied_value_usd: number;
  peer_multiple: number;
  peer_sample: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  confidence: 'high' | 'medium' | 'low';
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so it is shown at the market's own value, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** Everything the dashboard needs, all of it computed here from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_peer_multiple: number;
  protocol_count: number;
  pre_token_count: number;
  watchlist_size: number;
  board_size: number;
  extra_size: number;
  live_size: number;
  total_tvl_usd: number;
  board_tvl_usd: number;
  median_implied_usd: number;
  categories: string[];
  chains: string[];
  rows: RadarRow[];
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

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Median of a non-empty list, computed on a sorted copy so callers keep their order. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from listed_at to as_of, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol may be ranked: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * Categories whose TVL is another asset in transit or already represented by a
 * parent token — the same exclusions the snapshot's watchlist was built with.
 * A bridge or a wrapped-asset vault is a conduit, not a launch candidate.
 */
const CONDUIT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying a whole word that marks it as a wrapper of someone else's asset. */
const WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Whether a non-watchlist protocol may join the board as an extra. Watchlist
 * rows are never filtered by this: the watchlist is the floor. Extras must be
 * rankable and pass the watchlist's own eligibility shape — no conduits, no
 * wrappers, no versioned pools.
 */
export function isExtraEligible(p: SnapshotProtocol): boolean {
  return isRankable(p) && !CONDUIT_CATEGORIES.has(p.category ?? '') && !WRAPPER_WORD.test(p.name);
}

/**
 * What the market already pays, measured from the snapshot's live cohort:
 * the global median mcap/TVL and, per category, that median shrunk toward the
 * global one by a prior of `peer_prior_weight` phantom peers, then clamped.
 */
export interface PeerTable {
  global: number;
  byCategory: Map<string, { multiple: number; sample: number }>;
}

export function peerTable(snapshot: Snapshot, model: ModelConstants = MODEL): PeerTable {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, { multiple: number; sample: number }>();
  for (const [key, ratios] of ratiosByCategory) {
    const shrunk = (ratios.length * median(ratios) + model.peer_prior_weight * global) / (ratios.length + model.peer_prior_weight);
    // Thin evidence gets a thinner ceiling: with fewer than three live peers a
    // category may not price above twice the global median, however extreme
    // its one or two peers are. (First run: one prediction-market peer above
    // 20x TVL priced a $320M protocol second only to the largest curators.)
    const ceiling = ratios.length < 3 ? Math.min(model.peer_multiple_max, 2 * global) : model.peer_multiple_max;
    byCategory.set(key, {
      multiple: Math.min(ceiling, Math.max(model.peer_multiple_min, shrunk)),
      sample: ratios.length,
    });
  }
  return { global, byCategory };
}

/** The median known age of the snapshot's pre-token cohort: the honest stand-in when a row's own age is unknown. */
export function cohortMedianAge(snapshot: Snapshot): number {
  const ages: number[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) ages.push(age);
  }
  return ages.length > 0 ? Math.round(median(ages)) : 365;
}

/** One protocol's factors and implied value under the peer table. Pure arithmetic on snapshot fields. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peers: PeerTable,
  fallbackAgeDays: number,
  model: ModelConstants = MODEL,
): { implied: number; peerMultiple: number; peerSample: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null; confidence: 'high' | 'medium' | 'low' } {
  const age = ageDays(asOf, protocol.listed_at);
  const peer = peers.byCategory.get(protocol.category ?? 'Uncategorised') ?? { multiple: peers.global, sample: 0 };
  const peerMultiple = Math.min(model.peer_multiple_max, Math.max(model.peer_multiple_min, peer.multiple));

  const growthPct = Math.min(model.growth_clamp_pct, Math.max(-model.growth_clamp_pct, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;

  const ageForModel = age ?? fallbackAgeDays;
  const maturityMult = model.maturity_floor + model.maturity_range * Math.sqrt(Math.min(Math.max(ageForModel, 0), model.maturity_horizon_days) / model.maturity_horizon_days);

  const chainCount = Math.max(1, protocol.chains.length);
  const breadthMult = Math.min(model.breadth_cap, 1 + model.breadth_per_doubling * Math.log2(chainCount));

  const implied = Math.max(1, Math.round(protocol.tvl_usd * peerMultiple * growthMult * maturityMult * breadthMult));

  // Confidence is a data-quality label, not a price factor: enough live peers
  // pricing this category, a known listing date, and a reported 7d change.
  let score = 0;
  if (peer.sample >= 8) score += 2;
  else if (peer.sample >= 3) score += 1;
  if (age !== null) score += 1;
  if (protocol.change_7d !== null) score += 1;
  const confidence = score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';

  return { implied, peerMultiple, peerSample: peer.sample, growthPct, growthMult, maturityMult, breadthMult, age, confidence };
}

// ---------------------------------------------------------------- farm plans

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Capital for one farm position, banded by the protocol's own TVL so small protocols get small tickets. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 400;
  if (tvl >= 1_000_000_000) return 300;
  if (tvl >= 250_000_000) return 200;
  if (tvl >= 50_000_000) return 120;
  if (tvl >= 10_000_000) return 75;
  return 40;
}

/** How long to hold, from the protocol's age: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 540) return 45;
  return 30;
}

/** The category's core action and its recurring action, in words a farmer can follow. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): { open: string; weekly: string; risk: string } {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('collateral'))
    return {
      open: `Supply $${capital} of USDC as collateral to ${n} on ${chain}, then borrow no more than 40% against it so the position survives a bad week`,
      weekly: `Repay a slice of the borrow and re-supply it on ${n}`,
      risk: `Check the health factor on ${n} twice a week and top up collateral if it drifts toward liquidation`,
    };
  if (c.includes('cdp') || c.includes('stable'))
    return {
      open: `Deposit $${capital} of collateral into ${n} on ${chain} and mint a small amount of its stable asset against it`,
      weekly: `Adjust the vault on ${n} — add or repay a few dollars — so the position stays active`,
      risk: `Keep the collateral ratio on ${n} well above its liquidation line and never mint to the maximum`,
    };
  if (c.includes('dex') || c.includes('liquidity'))
    return {
      open: `Add $${capital} of two-sided liquidity to ${n}'s busiest pool on ${chain} and keep the LP position open`,
      weekly: `Make two swaps through ${n} on ${chain} at normal size`,
      risk: `Watch the pool's range on ${n}: if the price leaves your range, re-centre once instead of chasing it daily`,
    };
  if (c.includes('deriv') || c.includes('perpetual') || c.includes('basis'))
    return {
      open: `Deposit $${capital} of USDC margin on ${n} and open one small hedged position, long and short legs equal`,
      weekly: `Roll or resize the hedge on ${n} once so the account shows real trading activity`,
      risk: `Keep leverage on ${n} at or below 2x and leave at least half the margin unused as a liquidation buffer`,
    };
  if (c.includes('bridge') || c.includes('canonical'))
    return {
      open: `Bridge $${capital} of USDC through ${n} between two of the chains it serves (${p.chains.slice(0, 3).join(', ') || chain}), then use the bridged funds in one app on arrival`,
      weekly: `Bridge a small amount back or onward through ${n} so both directions are on record`,
      risk: `Before bridging back, test the return route through ${n} with $10 first: bridge exits can pause, and the return path is the one that matters`,
    };
  if (c.includes('prediction'))
    return {
      open: `Fund $${capital} on ${n} and place two or three small positions in its most liquid markets, on outcomes you have actually read about`,
      weekly: `Settle finished positions on ${n} and place one new position so the account history keeps growing`,
      risk: `Size every position on ${n} as money that can go to zero: a prediction position is a bet, not a deposit, whatever the odds say`,
    };
  if (c.includes('staking') || c.includes('restak') || c.includes('staking pool'))
    return {
      open: `Stake $${capital} of the native staking asset through ${n} on ${chain} and save the receipt token in the same wallet`,
      weekly: `Claim and re-stake the rewards on ${n} so the balance compounds`,
      risk: `Note the unbonding period on ${n} before staking: that capital is locked until it elapses, so size it as locked money`,
    };
  if (c.includes('rwa'))
    return {
      open: `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} after completing the onboarding its app requires`,
      weekly: `Check the asset's redemption window on ${n} and make one small additional mint`,
      risk: `Read ${n}'s redemption terms first: real-world-asset tokens can settle slowly, so do not farm with money needed this month`,
    };
  if (c.includes('insurance'))
    return {
      open: `Buy $${capital} of cover from ${n} on ${chain} against a protocol you actually use, and keep the policy NFT`,
      weekly: `Renew or extend one cover line on ${n} before it lapses`,
      risk: `Buy cover only for positions you hold: a policy on ${n} with no underlying position is a cost, not a farm`,
    };
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield'))
    return {
      open: `Deposit $${capital} of USDC into one established ${n} vault on ${chain} and keep the vault shares untouched`,
      weekly: `Move a small amount between two ${n} vaults or top up the same vault by $10`,
      risk: `Check which markets the ${n} vault allocates to: the curator's choices, not the vault wrapper, carry the risk`,
    };
  if (c.includes('chain'))
    return {
      open: `Bridge $${capital} of USDC to ${n}'s chain, then make real transactions there: one swap, one transfer, one contract call`,
      weekly: `Use one new app on the ${n} chain each week so the wallet history is varied, not repeated`,
      risk: `Keep only farm capital on a young chain like ${n}: bridge back anything you cannot afford to have stuck`,
    };
  return {
    open: `Deposit $${capital} of USDC into ${n} on ${chain} through its main app and keep the position open`,
    weekly: `Make one genuine transaction in ${n}'s app, at the size you would normally use`,
    risk: `Start with a $10 test deposit into ${n} and withdraw it once, so you know the exit works before committing $${capital}`,
  };
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The wording is assembled from the protocol's own record — category verb,
 * primary chain, chain count, TVL band, age and the sign of its week — so two
 * protocols in different situations never receive the same plan.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const a = actionsFor(p, capital, chain);
  const gas = chain === 'Ethereum' ? 9 : chain === 'Bitcoin' ? 6 : 3;
  const steps: string[] = [];

  steps.push(
    `Set up one fresh wallet for ${p.name} farming on ${chain} and fund it with the $${capital} position plus about $${gas} for gas. Cost: $${capital + gas} total outlay. Time: 10 minutes.`,
  );
  steps.push(`${a.open}. Cost: $${capital} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`);

  if (p.chains.length > 1) {
    const second = p.chains[1]!;
    steps.push(
      `Repeat a smaller version on ${second}, ${p.name}'s second chain: move $50 across and make the same core action there, so the wallet is active on 2 of its ${p.chains.length} chains. Cost: $50 of capital plus about $4 of gas and bridge fees. Time: 20 minutes.`,
    );
  } else if (p.change_7d !== null && p.change_7d <= -15) {
    steps.push(
      `${p.name}'s TVL fell ${Math.abs(Math.round(p.change_7d))}% this week: halve the weekly activity, keep the position at half size, and only restore it after a week where TVL stops falling. Cost: no extra spend, activity budget cut to about $1 of gas a week. Time: 5 minutes to review each week.`,
    );
  } else if (p.change_7d !== null && p.change_7d >= 10) {
    steps.push(
      `${p.name}'s TVL grew ${Math.round(p.change_7d)}% this week: add one extra qualifying action while attention is high, but do not raise the $${capital} position — momentum weeks are when late farmers overpay. Cost: about $2 of extra gas. Time: 10 minutes.`,
    );
  } else {
    steps.push(
      `Build a second, smaller position of $${Math.max(25, Math.round(capital / 3))} in ${p.name} from the same wallet a week later, so the history shows two separate entries instead of one lump. Cost: $${Math.max(25, Math.round(capital / 3))} of capital plus about $${gas} of gas. Time: 10 minutes.`,
    );
  }

  steps.push(`${a.weekly}. Cost: about $2 of gas a week. Time: 10 minutes a week for at least ${Math.max(4, Math.round(hold / 7))} weeks.`);
  steps.push(
    `Hold the ${p.name} position for at least ${hold} days${age !== null && age < 180 ? ' — it is a young listing, so a longer window separates farmers from drive-by wallets' : ''} and keep a dated log of every transaction. Cost: the $${capital} stays deployed for ${hold} days. Time: ${hold} days, 5 minutes of logging a week.`,
  );
  steps.push(
    `${a.risk}. Before any exit, claim only through the rewards or points page ${p.name} itself publishes, and never pay a fee to claim. Cost: $0 to check, about $${gas} of gas to exit. Time: 15 minutes.`,
  );
  return steps;
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerTable(snapshot, model);
  const fallbackAge = cohortMedianAge(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const extras = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isExtraEligible(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EXTRA_ROWS);
  for (const p of extras) chosen.set(p.slug, p);

  const watch = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, peers, fallbackAge, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    token_status: 'pre-token',
    age_days: s.v.age,
    in_watchlist: watch.has(s.p.slug),
    implied_value_usd: s.v.implied,
    model: {
      peer_multiple: round4(s.v.peerMultiple),
      peer_sample: s.v.peerSample,
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
      confidence: s.v.confidence,
    },
    farm_steps: farmSteps(s.p, s.v.age),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's separate live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerTable(snapshot, model);
  const impliedSorted = board.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const categories = [...new Set(board.map((r) => r.category ?? 'Uncategorised'))].sort();
  const chains = [...new Set(board.flatMap((r) => r.chains))].sort();
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    global_peer_multiple: round4(peers.global),
    protocol_count: snapshot.protocols.length,
    pre_token_count: snapshot.protocols.filter(isPreToken).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    extra_size: board.filter((r) => !r.in_watchlist).length,
    live_size: live.length,
    total_tvl_usd: snapshot.protocols.reduce((sum, p) => sum + p.tvl_usd, 0),
    board_tvl_usd: board.reduce((sum, r) => sum + r.tvl_usd, 0),
    median_implied_usd: impliedSorted.length > 0 ? Math.round(median(impliedSorted)) : 0,
    categories,
    chains,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      in_watchlist: r.in_watchlist,
      implied_value_usd: r.implied_value_usd,
      peer_multiple: r.model.peer_multiple,
      peer_sample: r.model.peer_sample,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      confidence: r.model.confidence,
      farm_steps: r.farm_steps,
    })),
    live,
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than 100`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
