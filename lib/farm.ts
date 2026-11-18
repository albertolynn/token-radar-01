// The farm plans: one concrete plan per protocol, derived from the protocol's own record — its
// category, its chains, its TVL and its age — never from a hand-written list of names. Every step
// states the action, what it costs and how long it takes, in one string of 20..600 characters, the
// shape board.json's gate reads. Variation between rows comes from a stable hash of the slug, so
// two runs of the program write the same bytes and no two plans read as the same boilerplate.

/** The protocol facts a farm plan is built from. */
export interface FarmFacts {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  age_days: number | null;
}

/** A stable small hash of the slug: the plan's phrasing seed. */
export function slugHash(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Pick one of `options` by the seed, deterministically. */
function pick<T>(options: readonly T[], seed: number): T {
  return options[seed % options.length]!;
}

/** The capital one farm position carries, from the protocol's own TVL: bigger protocols, bigger ticket. */
export function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

const CHEAP_CHAINS = new Set(['Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BNB Chain', 'Binance', 'Tron', 'Sui', 'Aptos', 'Near', 'Stellar', 'Algorand', 'Ink', 'Monad', 'Plasma', 'Flare']);

/** A realistic one-way gas figure for a chain, in dollars. */
export function gasFor(chain: string): number {
  if (chain === 'Ethereum') return 7;
  if (chain === 'Bitcoin') return 4;
  return CHEAP_CHAINS.has(chain) ? 1 : 3;
}

/** How long a position should be held to count, from the protocol's age: younger, longer window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's core action and its follow-through, in words a farmer can follow. */
interface CategoryPlay {
  /** The main position, with {name}, {chain} and {cap} substituted. */
  action: string;
  /** The second, qualifying action that keeps the position active. */
  second: string;
  /** The asset the position is held in, for the monitoring step. */
  asset: string;
}

const PLAYS: Record<string, CategoryPlay> = {
  'Lending': {
    action: 'Supply ${cap} of USDC to {name} on {chain} through its main lending market, then borrow about 30% of it back and re-supply the borrow once.',
    second: 'Roll the borrow once a week: repay a slice and re-borrow, so the wallet shows both supply and borrow activity on {chain}.',
    asset: 'the supplied USDC and the open borrow',
  },
  'CDP': {
    action: 'Open a collateral vault in {name} on {chain}: deposit ${cap} of collateral and mint about half of it as the protocol stablecoin.',
    second: 'Stake or deposit the minted stablecoin in {name}\'s own stability pool or savings module, and top the vault up if the collateral price dips.',
    asset: 'the collateral vault and the minted stablecoin',
  },
  'Dexs': {
    action: 'Provide ${cap} of liquidity to {name}\'s highest-volume pool on {chain}, split evenly between the pair\'s two assets.',
    second: 'Make two or three small swaps a week through {name} on {chain} at different times of day, so the wallet reads as a regular trader, not a bot.',
    asset: 'the liquidity position',
  },
  'Derivatives': {
    action: 'Deposit ${cap} of USDC margin on {name} ({chain}) and open one small hedged pair: a long and a short of equal size on two liquid markets.',
    second: 'Adjust the hedge once a week and close and reopen one leg, keeping total fees low while the account stays active on {name}.',
    asset: 'the margin balance and the hedged pair',
  },
  'Risk Curators': {
    action: 'Deposit ${cap} of USDC into a {name}-curated vault on {chain}: pick the vault whose underlying markets you can name, not the highest APY.',
    second: 'Split a second, smaller deposit into a different {name} vault on {chain2}, and read the curator\'s own risk notes before adding more.',
    asset: 'the vault shares',
  },
  'Onchain Capital Allocator': {
    action: 'Deposit ${cap} into {name}\'s main vault on {chain} and keep the receipt shares in the same wallet.',
    second: 'Move a slice of the position to {name}\'s vault on {chain2} if it runs one there, so the wallet is active on two of its deployments.',
    asset: 'the vault shares',
  },
  'Yield': {
    action: 'Deposit ${cap} of USDC into {name} on {chain} and take the yield-bearing receipt token it issues.',
    second: 'Use the receipt token where {name} lists it — a lending market or a DEX pool on {chain} — so the position composes instead of sitting idle.',
    asset: 'the yield-bearing receipt token',
  },
  'Yield Aggregator': {
    action: 'Deposit ${cap} into {name}\'s flagship stablecoin vault on {chain}; it routes the funds across lending markets for you.',
    second: 'Shift the position between two of {name}\'s vaults once a month, following its own published strategy notes.',
    asset: 'the vault shares',
  },
  'RWA': {
    action: 'Mint ${cap} of {name}\'s tokenised real-world asset on {chain} after its onboarding check, and hold the asset in the farming wallet.',
    second: 'Hold through at least one full yield distribution from {name}, and add a small second mint on {chain2} if it issues there.',
    asset: 'the tokenised asset',
  },
  'Basis Trading': {
    action: 'Deposit ${cap} of USDC into {name}\'s basis vault on {chain}: it runs the hedged spot-and-perpetual position for you.',
    second: 'Leave the vault through one funding-rate cycle, then re-deposit half, so the wallet shows both an exit and a return to {name}.',
    asset: 'the basis vault shares',
  },
  'Chain': {
    action: 'Bridge ${cap} to {chain} and make it the wallet\'s home chain for a month: hold the gas token and use two native apps.',
    second: 'Transact on {chain} at least twice a week — a swap, a stake or a name registration — and keep a small balance there between sessions.',
    asset: 'the bridged balance on the chain',
  },
  'Payments': {
    action: 'Fund the wallet with ${cap} and route two real payments a week through {name} on {chain} instead of your usual rail.',
    second: 'Receive at least one payment back through {name}, so the wallet shows flow in both directions, not only deposits.',
    asset: 'the payment balance',
  },
  'Restaking': {
    action: 'Restake ${cap} of liquid-staked ETH through {name} on {chain} and keep the restaking receipt in the wallet.',
    second: 'Delegate the restaked position to one of {name}\'s operators and leave the delegation untouched for the full hold window.',
    asset: 'the restaked position',
  },
  'Collateral Markets': {
    action: 'Deposit ${cap} of collateral into {name} on {chain} and register the wallet as a restaker or collateral provider.',
    second: 'Extend the deposit to a second asset {name} accepts on {chain}, in a smaller size, and keep both positions open together.',
    asset: 'the deposited collateral',
  },
  'Insurance': {
    action: 'Buy ${cap} of cover from {name} on {chain} against a position you actually hold, and keep the policy for its full term.',
    second: 'Stake a smaller amount into {name}\'s underwriting pool once the first policy is live, so the wallet both buys and backs cover.',
    asset: 'the cover policy',
  },
  'CeDeFi': {
    action: 'Deposit ${cap} into {name}\'s main earn product on {chain} after finishing its account checks.',
    second: 'Make one withdrawal and one fresh deposit a month apart in {name}, so the account shows a full use cycle.',
    asset: 'the earn balance',
  },
  'Governance Incentives': {
    action: 'Deposit ${cap} into {name} on {chain} and enrol the wallet in its incentive program from its own page.',
    second: 'Claim incentives only when {name} opens a claim window, and restake half of each claim back into the position.',
    asset: 'the enrolled position',
  },
  'Stablecoin Wrapper': {
    action: 'Wrap ${cap} of the underlying stablecoin through {name} on {chain} and hold the wrapped asset.',
    second: 'Provide the wrapped asset to one pool {name} points to on {chain}, in a smaller size, and keep both legs open.',
    asset: 'the wrapped stablecoin',
  },
  'Staking Pool': {
    action: 'Stake ${cap} of the chain\'s native asset through {name} on {chain} and keep the pooled staking receipt.',
    second: 'Add a small second stake after the first rewards land, and vote with the pooled position if {name} passes votes to stakers.',
    asset: 'the pooled stake',
  },
  'Prediction Market': {
    action: 'Fund ${cap} on {name} ({chain}) and take small positions in three liquid markets you have a view on.',
    second: 'Settle every position at expiry instead of selling early, and keep a fourth market open across the whole hold window.',
    asset: 'the open market positions',
  },
};

const FALLBACK_PLAY: CategoryPlay = {
  action: 'Deposit ${cap} of USDC into {name} on {chain} through its main product page and keep the position open.',
  second: 'Repeat one qualifying action in {name} each week — a deposit, a claim or a vote — and add a second position on {chain2} if it runs there.',
  asset: 'the open position',
};

/** Fill a template with the protocol's facts. */
function fill(template: string, f: FarmFacts, cap: number): string {
  const chain = f.chains[0] ?? 'its main chain';
  const chain2 = f.chains[1] ?? chain;
  return template
    .replaceAll('{name}', f.name)
    .replaceAll('{chain2}', chain2)
    .replaceAll('{chain}', chain)
    .replaceAll('{cap}', String(cap));
}

const SETUP_LINES = [
  'Start with a fresh wallet funded only with the farming budget, and store its seed phrase on paper, offline.',
  'Use a dedicated wallet for this farm, funded from your main wallet in one transfer, and keep its keys offline.',
  'Create a new wallet for this protocol alone, so the position is easy to track, snapshot and unwind later.',
] as const;

const CADENCE_LINES = [
  'Keep a weekly rhythm: one qualifying action every week for {weeks} weeks, at varied times, never in a single burst.',
  'Act once a week for {weeks} weeks — a top-up, a claim or a vote — and skip no more than one week in the run.',
  'Spread the work over {weeks} weeks: one small action a week, sized like a real user\'s, not a script\'s.',
] as const;

const MONITOR_LINES = [
  'Watch {name}\'s own points or rewards page and its governance forum; claim only from links the protocol itself publishes, never from a search ad.',
  'Check {name}\'s rewards page and announcements weekly; if a points program opens, enrol the same wallet rather than starting a new one.',
  'Follow {name}\'s official announcements and vote in any governance poll it opens to depositors during the hold.',
] as const;

const EXIT_LINES = [
  'Unwind in two steps a week apart, keep the farm log (wallet, dates, transactions), and leave a dust balance so the wallet stays alive for any late distribution.',
  'Exit half the position first and the rest a week later; keep the log of every transaction so a later claim can be matched to this wallet.',
  'Close the position gradually over a week, record the final balances in your farm log, and keep the wallet — distributions often land after the program ends.',
] as const;

/**
 * One protocol's farm plan: six steps — set up, the core position, the follow-through, the weekly
 * cadence, the monitoring habit and the exit. Each step carries its cost and its time.
 */
export function farmSteps(f: FarmFacts): string[] {
  const seed = slugHash(f.slug);
  const cap = capitalFor(f.tvl_usd);
  const chain = f.chains[0] ?? 'its main chain';
  const gas = gasFor(chain);
  const hold = holdDaysFor(f.age_days);
  const weeks = Math.max(4, Math.round(hold / 7));
  const play = PLAYS[f.category ?? ''] ?? FALLBACK_PLAY;
  const steps = [
    `${pick(SETUP_LINES, seed)} Cost: about $${gas} of gas to fund and make the first transaction. Time: 10 minutes, once.`,
    `${fill(play.action, f, cap)} Cost: $${cap} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
    `${fill(play.second, f, cap)} Cost: about $${Math.max(1, Math.round(cap / 3))} of extra capital and $${gas} of gas. Time: 10 minutes.`,
    `${pick(CADENCE_LINES, seed + 1).replaceAll('{weeks}', String(weeks))} Cost: about $${gas} of gas a week. Time: 10 minutes a week for ${weeks} weeks.`,
    `Hold ${play.asset} for at least ${hold} days so the activity spans more than one snapshot or points epoch. Cost: the $${cap} stays in the position; the risk is the protocol's, so size it as money you can leave. Time: ${hold} days.`,
    `${fill(pick(MONITOR_LINES, seed + 2), f, cap)} Cost: nothing to watch; never pay a third party to claim. Time: 5 minutes a week.`,
    `${pick(EXIT_LINES, seed + 3)} Cost: about $${gas * 2} of gas to unwind fully. Time: 20 minutes, plus the week's wait.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}
