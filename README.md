# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/albertolynn/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/albertolynn/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A working radar for token launches that have not happened yet. It reads the sealed
DefiLlama snapshot (758 protocols, as of 2026-11-14), finds every protocol that records
no token, and prices what a launch would be worth if the record stayed as it is — from
the snapshot's own figures, never from a hand-picked list of names.

**The model (radar-2).** For each category, the market multiples of the protocols that
already trade — market cap divided by TVL — are summarised by their median, winsorised
at the global 90th percentile so one outlier cannot set a category's price, and shrunk
toward the global median by sample size. A pre-token protocol is then valued as

```
implied = TVL × category multiple × momentum × maturity × breadth × size
```

where momentum follows the 7-day TVL change (clamped at ±30%), maturity rewards time
already run with no token, breadth counts the chains it operates on, and size decays
the multiple as TVL grows — the snapshot's own tokenised protocols show big protocols
trading at a fraction of the multiple small ones get. The board covers all 40 watchlist
protocols plus every other pre-token protocol that passes the house's published
eligibility screen, including 138 early finds below the $50M floor: 178 rows, each with
a concrete farm plan that states what it costs and how long it takes. Protocols that
already trade are kept off the board and shown at the market's own values — they are
the evidence base the multiples come from.

**The dashboard** is a dark, offline board: sortable and filterable by category, chain
and value band, with a per-protocol detail view that shows the full valuation
arithmetic and the farm plan, a methodology section, and the category multiple table
the prices came from.

## Run

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only, no network) writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` into the output directory. It runs
twice to byte-identical output, and it refuses to write a board that fails the
competition gate. Open `dashboard/index.html` from the output directory to read the
board; the detail drawer and filters also accept `?open=<slug>`, `?cat=<category>` and
`?watch=1` in the address bar.

<sub>Entered on [make.fun](https://make.fun/?ref=h4bhmv08&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
