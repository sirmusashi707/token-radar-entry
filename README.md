# Token Radar — build the best token launch radar

A program plus the dashboard it writes. It reads a sealed snapshot of every
protocol DefiLlama tracks, ranks the ones that record no token yet by what
their launch would be worth, and hands in a web dashboard with the board, a
detail view for each protocol and the steps to farm it.

## The model

Implied value = **TVL × category ratio × growth × maturity × breadth × prior**.

- **Category ratio** — the median market-cap-to-TVL of the protocols in the
  same category whose token already trades (the whole snapshot's median when a
  category has too few token-bearing protocols). Clamped to 0.02–1.50.
- **Growth** — the protocol's 7-day TVL change, tilted at most −24% / +60%.
- **Maturity** — time served with no token recorded: under 90 days is
  discounted (×0.92), over 2 years earns a small premium (×1.10).
- **Breadth** — +2% per extra chain, up to +10%.
- **Prior** — how often protocols in the category have issued a token at all,
  read off the snapshot: 0.90 + 0.20 × share, so it tilts value by −10% to +10%.

Nothing in the model names a protocol. Feed it a different snapshot and it
ranks a different field. The board covers the whole 40-protocol watchlist plus
every other pre-token protocol the snapshot holds that is not a wrapped,
staked or bridged product of a token that already trades (198 rows on this
snapshot), and sets aside the 24 largest token-bearing protocols as the
comparables the board is priced against.

“Records no token” means DefiLlama's record carries no token for the
protocol. It is not proof the protocol has none, and the implied value is
this entry's own claim — never make.fun's — saying nothing about whether or
when a token is issued.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22.18 or later, standard library only, no install step. The program is
fully deterministic: the same snapshot in gives the same bytes out.

## Layout

- `main.ts` — entrypoint: reads the snapshot, writes `board.json` and
  `data.js`, copies `dashboard/` and `screenshots/`, writes `dossier.json`.
- `lib/model.ts` — the value model, the farm plans, the board validation.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte the
  kit's copy (the scorer runs the same file).
- `dashboard/` — a static page with no network: the board, filters, sorting,
  a detail view per protocol (open one with `#slug=<slug>`), and a tab of
  already-trading comparables. Filters deep-link too: `#category=Dexs`,
  `#chain=Base`, `#watchlist=1`, `#tab=live`.
- `screenshots/` — the board, a detail view and a filtered view.

## Grade it

```sh
node /path/to/kit/cli/makefun.mjs grade-local --kit /path/to/kit --bot . --driver process
```

## License

MIT — see `LICENSE`.
