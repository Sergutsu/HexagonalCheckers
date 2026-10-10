# HEX — Three-player Hexagonal Checkers and Triad Dominion

A flat, futuristic, **board-first PixiJS game** on one 397-hex board with **12 hexes along each side**. Mint, Coral, and Lilac share the arena. No build step, no account, no network requests, and no runtime installation.

Two modes share the board:

- **Checkers** (`index.html`): the original three-player hex checkers.
- **Triad Dominion** (`dominion.html`): a three-player hex Reversi and checkers hybrid. See below.

Play online at **https://sergutsu.github.io/HexagonalCheckers/** (published automatically, see [Publishing](#publishing-to-github-pages)).

## Play immediately

**Open `index.html` in a modern browser.** All scripts, fonts, and PixiJS are included locally, and the game works from `file://` as well as a static web host. WebGL must be enabled.

For a local HTTP server (optional, requires Node 18+):

```sh
npm start
# Or: node server.cjs --port 3000
```

There is **no `npm install` or build command** needed. The server listens on `0.0.0.0` and accepts preview hosts. Any ordinary static host also works.

## Playing

- Mint starts as a **human**, with Coral and Lilac as **basic bots**. Click a pawn, then a highlighted destination.
- Click a side's **Human / Bot** button in the player dock, or use Settings, to change its controller independently. Three humans can play locally on the same device; three bots can play a demonstration.
- Pawns move one hex in **any of six directions**.
- Jump over one opponent into an empty hex to capture it. **If any capture is available, you must capture.** Additional jumps with the same pawn are compulsory.
- **Land on the center or any outer-edge hex to become a superpawn.** Starting on a promotion hex does not automatically upgrade a regular pawn.
- Superpawns slide any distance along the six straight directions. They may jump over **one** opponent and land on any empty hex beyond it, but never pass through friendly pawns or jump two pawns at once. Upgrades take effect immediately, including during capture chains.
- Play rotates Mint → Coral → Lilac. Empty and blocked sides are skipped. The last color with pawns wins; if no side can move, it is a draw.
- **Undo** restores the most recent human turn, including subsequent bot replies. With only bots, it undoes the last turn and pauses them.
- **Pause** stops bots, not human players. Opening a panel or dialog also holds bots until it closes.
- Scroll or pinch to zoom, drag to pan, and use Fit to restore the full board. While editing, mouse dragging paints; Alt-drag or middle-drag pans.

## Triad Dominion

Open **Triad Dominion** from the mode switch in the header (or go to `dominion.html`).

Every turn you take **one** action:

- **Drop** a new piece on any empty hex. Every run of opposing pieces trapped between it and another of your pieces flips to your colour, in all six directions at once. Dropped pieces never crown.
- **Move** one of your pieces: step to an adjacent empty hex, or jump an adjacent enemy into the empty hex beyond. The jumped piece is removed. Men move **forward only**, toward the other sides; kings move in all six directions.
- A man that walks or jumps onto an edge hex outside its own home edge becomes a **King**.

Each colour's home is one of the three corners the checkers mode uses. Its home edge is the five outer hexes around that corner (tinted on the board), and each colour starts with three pieces there.

**Winning.** The last colour with pieces wins. Choose **Quick** in *New match* for a faster game: the first colour to hold all seven central hexes at the end of its turn wins. A match also ends when the board fills or 40 turns pass without a drop or capture; the most pieces wins, and a tie is a draw.

Controls: `D` drop, `M` move, click or tap to act (in Move mode, pick a piece, then a highlighted hex), `U` undo, `Space` pause bots, `0` fit, `H` rules.

## Customize the initial position

1. Choose **Edit board**.
2. Select Mint, Coral, Lilac, or the erase tool. Click or paint hexes. Right-click to erase.
3. Choose regular pawns or superpawns, and choose the first color to move.
4. Start from **Corners**, **Inner orbit**, or **Scattered**, or clear the board and make your own.
5. Choose **Play this board**. Each color needs at least one pawn, and the formation must have legal moves. Your formation is saved for future matches.

Setup files can be **exported and imported as JSON**. Invalid coordinates, duplicate cells, incompatible boards, and unknown colors are rejected. Canceling the editor leaves the current match unchanged.

The match, custom formation, controllers, settings, and recent undo history save automatically to local browser storage when available. The game still works if storage is blocked. Clear site storage to reset everything.

### Keyboard shortcuts

| Key                 | Action                                               |
| ------------------- | ---------------------------------------------------- |
| `U`                 | Undo the last human turn                             |
| `E`                 | Open / close the board editor                        |
| `Space`             | Pause / resume bots                                  |
| `H` or `?`          | Show rules                                           |
| `0`                 | Fit the board                                        |
| `Escape`            | Close a dialog / panel or deselect                   |
| Arrow keys, `Enter` | Focus a hex and select it while the board is focused |
| `1`, `2`, `3`, `X`  | Mint, Coral, Lilac, erase while editing              |

## Implementation

- `index.html` / `styles.css` — responsive, board-only game shell, controller dock, setup editor, and accessible dialogs.
- `scripts/dominion-rules.js` — Triad Dominion rules: drops and flips, forward-only men, kings, win conditions, and the bot.
- `scripts/dominion-app.js` — Triad Dominion board, controls, persistence, and bot scheduling.
- `dominion.html` / `dominion.css` — the Triad Dominion page and its additions to the shared styling.
- `scripts/app.js` — PixiJS rendering, pointer / touch controls, animation, optional synthesized move sounds, persistence, and bot scheduling.
- `scripts/rules.js` — browser / Node-compatible rules engine, board geometry, move validation, chained captures, promotion, and a small heuristic bot. No dependencies.
- `vendor/pixi.min.js` — pinned **PixiJS 8.6.6**, MIT license in `vendor/PIXI-LICENSE.txt`.
- `assets/fonts` — locally bundled Inter and Space Grotesk, with their SIL Open Font licenses.
- `server.cjs` — optional dependency-free static server.
- `tests/` — geometry, rules, save / restore, bot simulations, JavaScript syntax, static-asset integrity tests, and Triad Dominion rules, page, and publishing tests.

The board uses axial coordinates `(q, r)`, with `max(|q|, |r|, |q+r|) ≤ 11`. No coordinate labels, decorative lines, or move paths are drawn over the board. Board tiles and pawns are flat vector graphics rendered entirely by PixiJS.

## Publishing to GitHub Pages

`.github/workflows/pages.yml` publishes the site on every push to `main`. The workflow runs `npm test` first and deploys only if the tests pass. It copies just the static site files (`index.html`, `dominion.html`, the CSS, `assets/`, `scripts/`, `vendor/`) into a `_site` artifact, so tests and tooling are never published. Run it manually from the Actions tab with **Run workflow** to publish any branch.

Pages must be set to **Source: GitHub Actions** in the repository settings (`Settings → Pages`). The workflow's test step checks that every asset the pages reference is included in the staged site.

## Test

```sh
npm test
```

No installation is required for the rules tests. Browser rendering requires a WebGL-capable browser.
