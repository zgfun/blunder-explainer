# Eval

How often Claude's blunder explanations are judged correct on a fixed set of
40 positions where the right answer is known.

## The test set

`positions.json` holds 40 blunders taken from the [Lichess puzzle database](https://database.lichess.org/#puzzles).
In a Lichess puzzle the move at `initialPly` of the source game is the opponent's mistake that allows
the tactic, so the position before that move is our `fenBefore`, that move is the blunder, and the
puzzle solution is the punishment. Every position was re-analysed with Stockfish 19 (lite, depth 16)
and kept only if the move loses at least 1 pawn by the engine's count. Each search starts from a
cleared hash (`ucinewgame`), so single-threaded Stockfish at a fixed depth is deterministic and a
rebuild reproduces `positions.json` byte for byte. The stored `Blunder` includes both engine lines:
the best line from the position before the move, and the engine's reply after it
(`refutationSan`), which is what the move allowed.

Each item stores the Lichess themes, the theme we expect (`theme-map.ts` maps Lichess tags onto the
prompt's theme list), every theme the tags support, the puzzle solution and a full `Blunder` object.
Ratings span 1000 to 2200 and the set covers forks, pins, skewers, hanging and trapped pieces,
back-rank and other mates, discovered attacks, overloaded defenders, pawn and endgame themes.

**Licence:** Lichess puzzle data is released under
[CC0](https://creativecommons.org/publicdomain/zero/1.0/). `raw-puzzles.json` keeps only the puzzle
data and the source game's moves, not player names.

### Rebuilding it

```sh
# 1. A deterministic slice of the puzzle DB (sorted by id; the first 300k rows are plenty)
curl -s https://database.lichess.org/lichess_db_puzzle.csv.zst | zstd -dc | head -n 300000 > /tmp/puzzles.csv
# 2. Pick candidates per theme, fetch each one by id from https://lichess.org/api/puzzle/{id}
pnpm testset:build --csv /tmp/puzzles.csv --fetch-only
# 3. Run Stockfish on every candidate and select 40, balanced across themes
pnpm testset:build
```

Step 3 alone rebuilds `positions.json` from the committed `raw-puzzles.json`. `--verify` re-fetches
every stored puzzle by id and fails if one changed upstream. Requests are sequential and at least
1.5 s apart, with backoff on HTTP 429.

## Grading

```sh
pnpm eval --prompt v2 --level 1600 [--limit 10] [--timestamp my-run]
```

For each position: generate the explanation (`claude-sonnet-5-5`, the same code path as the app),
run the deterministic grounding check, then ask `claude-opus-5-5` (effort `high`,
structured output) to grade it against the ground truth, including the puzzle's winning line:

`{ correct, mentionsRightIdea, contradictsEngine, inventsMoves, reason }`

A position counts as **correct** only if the grader says so **and** the grounding check passes.
Results go to `results/{promptId}-{timestamp}.json` and, when the database is reachable, the
`eval_runs` table. Explanations are cached in the `explanations` table, so re-running only pays for
grading. Without `ANTHROPIC_API_KEY` the script prints a note and exits.

### What the deterministic grounding check covers

`lib/llm/grounding.ts` (`validateExplanation`) checks two things and nothing else:

- **Moves in notation come from the data.** Every move written in notation must be the played
  move or appear in the engine line or the engine reply line. It recognises piece moves (`Nf3`,
  `Qxe7+`), castling, pawn captures (`exd5`) and promotions (`e8=Q`) anywhere. A bare pawn push
  (`d4`) reads exactly like a square ("the pawn on d4"), so it only counts as a move after a move
  number (`17.`, `17...`, `…`) or a verb that introduces a move (play, push, then, after, reply,
  answer, move, was). Disambiguation is ignored when comparing (`Nbd7` matches `Nd7`).
- **Length.** At most 100 words, and not empty.

It does not check chess facts written in words ("the knight on f3 is pinned"); the grader does.

### Prompt versions and the cache key

`eval_runs.prompt_version` and the result file name use a content-derived id such as `v2-1a2b3c4d`
(the version plus a hash of the system prompt and the user template), so editing a prompt without
bumping its version can never mix old and new explanations in one score. Cached rows go further:
their key adds a hash of the exact user message, which holds every engine input (best move, both
lines, rounded evaluations, material), so an explanation is only reused for identical inputs.

## The sample game

`lib/sample-data.json` is a public chess.com blitz game (GothamChess vs BeztDonut, 1 October 2026)
with the Stockfish line for every position precomputed (with the game's move history, so
repetitions count), so the demo is instant. Regenerate it with `pnpm sample:precompute --lines`
(add `--offline` to reuse the stored PGN); `pnpm sample:precompute` caches Claude's explanations
for its blunders at all three levels (needs the API key and the database; `--force` regenerates
existing rows).

Blunders are ranked by how much of the expected result they threw away (Lichess's win-chance
model), not by raw centipawns, so a move from +9 to +13 in a lost position doesn't outrank one
that turned +2.6 into +0.3.
