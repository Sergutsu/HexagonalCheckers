const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../scripts/rules.js");
const p = (q, r, team, superPawn = false) => ({ q, r, team, super: superPawn });
const distantOpponents = [p(7, -5, 1), p(-7, 5, 2)];

test("12 hexes per side produce exactly 397 unique cells and 66 edge cells", () => {
  assert.equal(R.SIDE_LENGTH, 12);
  assert.equal(R.CELLS.length, 397);
  assert.equal(new Set(R.CELLS.map((c) => c.key)).size, 397);
  assert.equal(R.CELLS.filter((c) => c.edge).length, 66);
  assert.equal(R.CELLS.filter((c) => c.center).length, 1);
  for (const cell of R.CELLS) assert.equal(R.onBoard(cell.q, cell.r), true);
  assert.equal(R.onBoard(12, 0), false);
  assert.equal(R.onBoard(0.5, 0), false);
});

test("the starting position is 16 regular pawns per color in alternating corners", () => {
  const game = new R.Game();
  assert.deepEqual(game.counts, [16, 16, 16]);
  assert.deepEqual(game.superCounts, [0, 0, 0]);
  assert.equal(game.activeTeam, 0);
  assert.equal(game.ended, false);
  assert.equal(game.pieces.size, 48);
  assert.ok(game.legalMoves().length);
});

test("all three presets are valid and playable", () => {
  for (const name of ["classic", "orbit", "scattered"]) {
    const pieces = R.validateSetup(R.preset(name));
    const game = new R.Game(pieces);
    assert.deepEqual(game.counts, [16, 16, 16]);
    assert.equal(game.ended, false);
  }
});

test("regular pawns move one hex in all six directions", () => {
  const game = new R.Game([p(0, -2, 0), ...distantOpponents]);
  const moves = game.legalMoves().filter((m) => m.from === "0,-2");
  assert.equal(moves.length, 6);
  assert.deepEqual(
    new Set(moves.map((m) => m.to)),
    new Set(R.DIRECTIONS.map(([q, r]) => R.key(q, r - 2))),
  );
});

test("turns rotate through all three colors", () => {
  const game = new R.Game([p(0, -5, 0), p(5, 0, 1), p(-5, 5, 2)]);
  game.move("0,-5", "0,-4");
  assert.equal(game.activeTeam, 1);
  game.move("5,0", "4,0");
  assert.equal(game.activeTeam, 2);
  game.move("-5,5", "-4,4");
  assert.equal(game.activeTeam, 0);
  assert.equal(game.turn, 4);
});

test("starting color is customizable", () => {
  assert.equal(new R.Game(R.standardSetup(), 2).activeTeam, 2);
  assert.throws(() => new R.Game(R.standardSetup(), 3), /starting color/);
});

test("captures are mandatory across the entire army", () => {
  const game = new R.Game([p(-4, 2, 0), p(4, -4, 0), p(-3, 2, 1), p(7, -5, 2)]);
  const moves = game.legalMoves();
  assert.ok(moves.length);
  assert.ok(moves.every((m) => m.capture));
  assert.ok(moves.every((m) => m.from === "-4,2"));
  assert.throws(() => game.move("4,-4", "4,-3"), /not a legal move/);
  const outcome = game.move("-4,2", "-2,2");
  assert.equal(outcome.captured.team, 1);
  assert.equal(game.pieces.has("-3,2"), false);
  assert.deepEqual(game.captures, [1, 0, 0]);
});

test("friendly pawns cannot be captured or jumped", () => {
  const game = new R.Game([p(0, -2, 0), p(1, -2, 0), ...distantOpponents]);
  const pawn = game.pieces.get("0,-2");
  assert.equal(
    game.rawMoves(pawn).some((m) => m.to === "2,-2"),
    false,
  );
  assert.equal(
    game.rawMoves(pawn).some((m) => m.to === "1,-2"),
    false,
  );
});

test("a jump needs an empty, on-board landing cell", () => {
  const game = new R.Game([
    p(0, -2, 0),
    p(1, -2, 1),
    p(2, -2, 2),
    p(10, 0, 0),
    p(11, 0, 1),
  ]);
  assert.equal(
    game.rawMoves(game.pieces.get("0,-2")).some((m) => m.to === "2,-2"),
    false,
  );
  assert.equal(
    game.rawMoves(game.pieces.get("10,0")).some((m) => m.to === "12,0"),
    false,
  );
});

test("capture chains keep the same pawn and the same turn until complete", () => {
  const game = new R.Game([
    p(-4, 2, 0),
    p(4, -4, 0),
    p(-3, 2, 1),
    p(-1, 2, 2),
    p(7, -5, 1),
  ]);
  const outcome = game.move("-4,2", "-2,2");
  assert.equal(outcome.chain, true);
  assert.equal(game.activeTeam, 0);
  assert.equal(game.turn, 1);
  assert.ok(game.chainId);
  assert.ok(game.legalMoves().every((m) => m.from === "-2,2" && m.capture));
  assert.throws(() => game.move("4,-4", "4,-3"), /not a legal move/);
  game.move("-2,2", "0,2");
  assert.equal(game.chainId, null);
  assert.equal(game.activeTeam, 1);
  assert.equal(game.turn, 2);
  assert.deepEqual(game.captures, [2, 0, 0]);
});

test("landing on the center promotes a regular pawn", () => {
  const game = new R.Game([p(0, -1, 0), ...distantOpponents]);
  const outcome = game.move("0,-1", "0,0");
  assert.equal(outcome.promoted, true);
  assert.equal(game.pieces.get("0,0").super, true);
});

test("landing on any outer edge promotes a regular pawn", () => {
  for (const [q, r, toQ, toR] of [
    [10, -3, 11, -3],
    [-10, 4, -11, 4],
    [4, -10, 4, -11],
    [-4, 10, -4, 11],
    [5, 5, 6, 5],
    [-5, -5, -6, -5],
  ]) {
    const game = new R.Game([p(q, r, 0), ...distantOpponents]);
    const outcome = game.move(R.key(q, r), R.key(toQ, toR));
    assert.equal(outcome.promoted, true);
    assert.equal(game.pieces.get(R.key(toQ, toR)).super, true);
  }
});

test("starting on promotion cells does not automatically upgrade pawns", () => {
  const game = new R.Game([p(0, 0, 0), p(11, -4, 1), p(-11, 4, 2)]);
  assert.deepEqual(game.superCounts, [0, 0, 0]);
});

test("promotion takes effect immediately during a capture chain", () => {
  const game = new R.Game([p(-2, 0, 0), p(-1, 0, 1), p(2, 0, 2), p(5, 2, 1)]);
  const outcome = game.move("-2,0", "0,0");
  assert.equal(outcome.promoted, true);
  assert.equal(outcome.chain, true);
  assert.equal(game.pieces.get("0,0").super, true);
  assert.ok(
    game.legalMoves().some((m) => m.to === "7,0" && m.capture === "2,0"),
  );
});

test("superpawns glide along all six directions", () => {
  const game = new R.Game([p(0, 0, 0, true), ...distantOpponents]);
  const pawn = game.pieces.get("0,0");
  for (const [q, r] of R.DIRECTIONS)
    assert.ok(game.rawMoves(pawn).some((m) => m.to === R.key(q * 8, r * 8)));
  assert.equal(
    game.rawMoves(pawn).some((m) => m.to === "3,2"),
    false,
  );
});

test("superpawns can choose any empty landing beyond one enemy, but not a friendly blocker", () => {
  const game = new R.Game([
    p(0, 0, 0, true),
    p(2, 0, 1),
    p(6, 0, 0),
    p(-5, 3, 2),
  ]);
  const moves = game.legalMoves();
  assert.deepEqual(
    moves.filter((m) => m.capture === "2,0").map((m) => m.to),
    ["3,0", "4,0", "5,0"],
  );
  assert.equal(
    moves.some((m) => m.to === "7,0"),
    false,
  );
  assert.equal(
    moves.some((m) => !m.capture),
    false,
  );
});

test("superpawns cannot jump two pieces in one move", () => {
  const game = new R.Game([p(0, 0, 0, true), p(2, 0, 1), p(4, 0, 2)]);
  assert.deepEqual(
    game.legalMoves().map((m) => m.to),
    ["3,0"],
  );
});

test("empty colors are skipped", () => {
  const game = new R.Game([p(0, 0, 0), p(1, 0, 1), p(5, 4, 2)]);
  const outcome = game.move("0,0", "2,0");
  assert.deepEqual(game.counts, [1, 0, 1]);
  assert.equal(game.activeTeam, 2);
  assert.deepEqual(outcome.skipped, [1]);
});

test("a blocked color is skipped without removing its pawns", () => {
  const blockers = R.DIRECTIONS.flatMap(([q, r]) => [
    p(q, r, 1),
    p(q * 2, r * 2, 1),
  ]);
  const game = new R.Game([p(0, 0, 0), ...blockers, p(8, -6, 2)]);
  assert.equal(game.ended, false);
  assert.equal(game.legalMoves(0).length, 0);
  assert.equal(game.activeTeam, 1);
  assert.equal(game.counts[0], 1);
});

test("capturing the final opposing pawn wins the match", () => {
  const game = new R.Game([p(0, 0, 0), p(1, 0, 1)]);
  const outcome = game.move("0,0", "2,0");
  assert.equal(outcome.ended, true);
  assert.equal(game.winner, 0);
  assert.equal(game.activeTeam, 0);
  assert.equal(game.legalMoves().length, 0);
  assert.throws(() => game.move("2,0", "3,0"), /finished/);
});

test("a board with no legal moves for any team is a draw", () => {
  const game = new R.Game(R.CELLS.map((c, i) => p(c.q, c.r, i % 3)));
  assert.equal(game.ended, true);
  assert.equal(game.winner, null);
});

test("setup validation rejects off-board positions, duplicate cells, bad colors and missing teams", () => {
  assert.throws(() => R.validateSetup([p(12, 0, 0)]), /outside/);
  assert.throws(() => R.validateSetup([p(0, 0, 0), p(0, 0, 1)]), /share/);
  assert.throws(() => R.validateSetup([p(0, 0, 5)]), /unknown color/);
  assert.throws(() => R.validateSetup([p(0, 0, 0), p(2, 0, 1)]), /each color/);
  assert.throws(
    () => R.validateSetup(R.CELLS.map((c, i) => p(c.q, c.r, i % 3))),
    /empty hex/,
  );
});

test("serialization preserves positions, upgrades, captures and an active multi-jump", () => {
  const game = new R.Game([p(-4, 2, 0), p(-3, 2, 1), p(-1, 2, 2), p(7, -5, 1)]);
  game.move("-4,2", "-2,2");
  const saved = JSON.parse(JSON.stringify(game.toJSON()));
  const restored = R.Game.fromJSON(saved);
  assert.deepEqual(restored.toJSON(), saved);
  assert.deepEqual(restored.legalMoves(), game.legalMoves());
  restored.move("-2,2", "0,2");
  assert.equal(restored.chainId, null);
  assert.equal(
    game.chainId,
    "p0",
    "restoring must not mutate the original game",
  );
});

test("corrupted saved matches are rejected safely", () => {
  const saved = new R.Game().toJSON();
  assert.throws(
    () => R.Game.fromJSON({ ...saved, sideLength: 10 }),
    /Incompatible/,
  );
  assert.throws(() => R.Game.fromJSON({ ...saved, activeTeam: 9 }), /turn/);
  assert.throws(
    () => R.Game.fromJSON({ ...saved, chainId: "nonexistent" }),
    /chain/,
  );
  const duplicateIds = JSON.parse(JSON.stringify(saved));
  duplicateIds.pieces[1].id = duplicateIds.pieces[0].id;
  assert.throws(() => R.Game.fromJSON(duplicateIds), /identifier/);
});

test("the bot takes compulsory captures and never mutates a game while thinking", () => {
  const game = new R.Game([p(-4, 2, 0), p(3, -4, 0), p(-3, 2, 1), p(7, -5, 2)]);
  const snapshot = JSON.stringify(game.toJSON());
  const move = R.chooseBotMove(game, () => 0.5);
  assert.ok(move.capture);
  assert.ok(
    game.legalMoves().some((m) => m.from === move.from && m.to === move.to),
  );
  assert.equal(JSON.stringify(game.toJSON()), snapshot);
});

test("300-turn bot simulation maintains occupancy, ownership and capture invariants", () => {
  const game = new R.Game();
  let seed = 7331;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let turn = 0; turn < 300 && !game.ended; turn++) {
    const oldCount = game.pieces.size;
    const move = R.chooseBotMove(game, random);
    assert.ok(move, "a live turn must have a legal bot move");
    assert.ok(
      game.legalMoves().some((m) => m.from === move.from && m.to === move.to),
    );
    const outcome = game.move(move.from, move.to);
    assert.equal(game.pieces.size, oldCount - (outcome.capture ? 1 : 0));
    assert.equal(
      new Set([...game.pieces.values()].map((piece) => piece.id)).size,
      game.pieces.size,
    );
    for (const [cell, piece] of game.pieces) {
      assert.equal(cell, R.key(piece.q, piece.r));
      assert.ok(R.onBoard(piece.q, piece.r));
      assert.ok([0, 1, 2].includes(piece.team));
    }
    assert.equal(
      game.counts.reduce((a, b) => a + b),
      game.pieces.size,
    );
    assert.deepEqual(R.Game.fromJSON(game.toJSON()).toJSON(), game.toJSON());
  }
});
