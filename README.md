# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Ankerfld12/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Ankerfld12/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar ranks pre-token protocols by what the market already pays for their live peers. Instead of a flat multiple of TVL, its model (peer-3) measures the base price from the snapshot itself: for each category it takes the median market-cap-to-TVL ratio of that category's live-token protocols, shrunk toward the global median so thin categories cannot dominate, then adjusts for one week of TVL growth (clamped and damped), for surviving tokenless (a square-root age curve, with the pre-token cohort's median age standing in when a listing date is unknown), and for chain breadth, capped small. The board covers all 40 watchlist slugs plus every other eligible pre-token protocol it can rank — bridges, wrapped assets and other conduits are excluded by the same eligibility shape the watchlist itself was built with — and every row carries a concrete six-step farm plan with costs and times, generated from its own category, chains, TVL band, age and week. Protocols that already have a token are never ranked; they appear in a separate view at the market's own value, as the yardstick. The program is deterministic (no clock, no randomness, no network), and its static dashboard shows the summary, a searchable, filterable and sortable board, and a per-protocol detail view with the full pricing formula for every row.

## Run it

```sh
# The sealed snapshot ships in the competition kit as input/snapshot.json.
# Run from this repo's root, with --input pointing at your copy of it
# (../input/snapshot.json when the repo sits beside the kit's input/ folder):
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=8rrqgntk&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
