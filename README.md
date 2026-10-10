# HEX — Three-player Hexagonal Checkers

A flat, futuristic, **board-first PixiJS game** on one 397-hex board with **12 hexes along each side**. Mint, Coral, and Lilac share the arena. No build step, no account, no network requests, and no runtime installation.

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
- `scripts/app.js` — PixiJS rendering, pointer / touch controls, animation, optional synthesized move sounds, persistence, and bot scheduling.
- `scripts/rules.js` — browser / Node-compatible rules engine, board geometry, move validation, chained captures, promotion, and a small heuristic bot. No dependencies.
- `vendor/pixi.min.js` — pinned **PixiJS 8.6.6**, MIT license in `vendor/PIXI-LICENSE.txt`.
- `assets/fonts` — locally bundled Inter and Space Grotesk, with their SIL Open Font licenses.
- `server.cjs` — optional dependency-free static server.
- `tests/` — geometry, rules, save / restore, bot simulations, JavaScript syntax, and static-asset integrity tests.

The board uses axial coordinates `(q, r)`, with `max(|q|, |r|, |q+r|) ≤ 11`. No coordinate labels, decorative lines, or move paths are drawn over the board. Board tiles and pawns are flat vector graphics rendered entirely by PixiJS.

## Test

```sh
npm test
```

No installation is required for the rules tests. Browser rendering requires a WebGL-capable browser.
