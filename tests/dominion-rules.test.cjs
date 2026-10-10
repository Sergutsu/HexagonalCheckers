const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../scripts/rules.js");
const D = require("../scripts/dominion-rules.js");

const p = (q, r, team, king = false) => ({ q, r, team, king });
// Far-away pieces keep every colour alive without touching the lines under test.
const bystanders = [p(10, 1, 1), p(-10, 10, 2)];
const keyOf = (q, r) => G.key(q, r);
const sorted = (list) => [...list].sort();

test("homes are the three shared corners, each with a five-hex home edge", () => {
  assert.deepEqual(D.CORNERS, [
    [0, -11],
    [11, 0],
    [-11, 11],
  ]);
  for (const [team, home] of D.HOME.entries()) {
    assert.equal(home.size, 5, `team ${team} home edge`);
    for (const cell of home) {
      const [q, r] = G.coordinates(cell);
      assert.equal(G.distance(q, r), G.RADIUS, "home hexes sit on the edge");
    }
  }
});

test("men advance toward the centre in exactly three directions per colour", () => {
  for (const [team, forward] of D.FORWARD.entries()) {
    assert.equal(forward.length, 3, `team ${team} forward set`);
    const [cq, cr] = D.CORNERS[team];
    for (const [dq, dr] of forward) {
      // Each forward step must reduce the distance to the centre or stay on the rim.
      const before = G.distance(cq, cr);
      const after = G.distance(cq + dq, cr + dr);
      assert.ok(after <= before, `team ${team} step ${dq},${dr} heads outward`);
    }
  }
});

test("the opening gives every colour three pieces on its home edge", () => {
  const game = new D.Game();
  assert.deepEqual(game.counts, [3, 3, 3]);
  assert.deepEqual(game.kingCounts, [0, 0, 0]);
  assert.equal(game.activeTeam, 0);
  assert.equal(game.ended, false);
  for (const piece of game.pieces.values())
    assert.ok(D.HOME[piece.team].has(G.key(piece.q, piece.r)));
  // The three colours are the same position rotated by 120 degrees.
  const rotate = ([q, r]) => [r, -q - r];
  const cellsOf = (team) =>
    sorted(
      [...game.pieces.values()]
        .filter((x) => x.team === team)
        .map((x) => G.key(x.q, x.r)),
    );
  const rotated = (team) =>
    sorted(cellsOf(team).map((cell) => G.key(...rotate(G.coordinates(cell)))));
  assert.deepEqual(rotated(0), cellsOf(2));
  assert.deepEqual(rotated(2), cellsOf(1));
  assert.deepEqual(rotated(1), cellsOf(0));
});
test("a drop flips a closed run in every one of the six directions", () => {
  for (const [dq, dr] of G.DIRECTIONS) {
    const pieces = [
      p(dq, dr, 1),
      p(2 * dq, 2 * dr, 1),
      p(3 * dq, 3 * dr, 0),
      ...bystanders,
    ];
    const game = new D.Game(pieces, 0);
    const drop = game.legalActions().find((a) => a.to === "0,0");
    assert.deepEqual(
      sorted(drop.flips),
      sorted([keyOf(dq, dr), keyOf(2 * dq, 2 * dr)]),
      `direction ${dq},${dr}`,
    );
  }
});

test("runs that end in an empty hex or the board edge are not flipped", () => {
  const open = new D.Game([p(1, 0, 1), p(2, 0, 1), p(-5, 5, 0), ...bystanders], 0);
  assert.deepEqual(open.legalActions().find((a) => a.to === "0,0").flips, []);
  const edge = new D.Game([p(10, 0, 1), p(11, 0, 1), p(-5, 5, 0), ...bystanders], 0);
  assert.deepEqual(edge.legalActions().find((a) => a.to === "9,0").flips, []);
});
test("opponents of both other colours flip together and own pieces never flip", () => {
  const game = new D.Game(
    [p(1, 0, 1), p(2, 0, 2), p(3, 0, 0), p(-1, 0, 0), ...bystanders],
    0,
  );
  const drop = game.legalActions().find((a) => a.to === "0,0");
  assert.deepEqual(sorted(drop.flips), ["1,0", "2,0"]);
  game.play({ type: "place", to: "0,0" });
  assert.equal(game.pieces.get("1,0").team, 0);
  assert.equal(game.pieces.get("2,0").team, 0);
  assert.equal(game.pieces.get("3,0").team, 0);
  assert.equal(game.pieces.get("-1,0").team, 0);
  assert.equal(game.stats.flipped[0], 2);
});
test("drops flip several lines at once", () => {
  const pieces = [
    p(1, 0, 1),
    p(2, 0, 0),
    p(0, 1, 1),
    p(0, 2, 0),
    p(-1, 1, 2),
    p(-2, 2, 0),
    ...bystanders,
  ];
  const game = new D.Game(pieces, 0);
  game.play({ type: "place", to: "0,0" });
  assert.equal(game.pieces.get("1,0").team, 0);
  assert.equal(game.pieces.get("0,1").team, 0);
  assert.equal(game.pieces.get("-1,1").team, 0);
  assert.equal(game.stats.flipped[0], 3);
});

test("a flipped king keeps its crown", () => {
  const game = new D.Game([p(1, 0, 1, true), p(2, 0, 0), ...bystanders], 0);
  game.play({ type: "place", to: "0,0" });
  assert.equal(game.pieces.get("1,0").team, 0);
  assert.equal(game.pieces.get("1,0").king, true);
});

test("drops never crown, even on a king edge", () => {
  const game = new D.Game([p(-1, 0, 0), ...bystanders], 0);
  const drop = game.legalActions().find((a) => a.to === "11,0");
  assert.equal(drop.crown, false);
  game.play({ type: "place", to: "11,0" });
  assert.equal(game.pieces.get("11,0").king, false);
});

test("men move one step forward only, and kings move in all six directions", () => {
  const men = new D.Game([p(0, 0, 0), ...bystanders], 0);
  const steps = men.movesFrom("0,0").map((m) => m.to);
  assert.deepEqual(
    sorted(steps),
    sorted(D.FORWARD[0].map(([q, r]) => keyOf(q, r))),
  );
  const kings = new D.Game([p(0, 0, 0, true), ...bystanders], 0);
  assert.equal(kings.movesFrom("0,0").length, 6);
});

test("men jump forward over an opponent and remove the jumped piece", () => {
  const game = new D.Game(
    [p(0, 0, 0), p(1, 0, 1), ...bystanders, p(5, -5, 0)],
    0,
  );
  const jump = game.movesFrom("0,0").find((m) => m.capture);
  assert.equal(jump.to, "2,0");
  assert.equal(jump.capture, "1,0");
  game.play({ type: "move", from: "0,0", to: "2,0" });
  assert.equal(game.pieces.has("1,0"), false);
  assert.equal(game.pieces.get("2,0").team, 0);
  assert.equal(game.stats.captured[0], 1);
});

test("men never jump backward, but kings can", () => {
  // Mint men advance along (1,0), (0,1) and (-1,1). Stepping back over (-1,0) is not a jump they can make.
  const men = new D.Game([p(0, 0, 0), p(-1, 0, 1), ...bystanders], 0);
  assert.equal(men.movesFrom("0,0").some((m) => m.capture), false);
  const kings = new D.Game([p(0, 0, 0, true), p(-1, 0, 1), ...bystanders], 0);
  assert.deepEqual(
    kings.movesFrom("0,0").filter((m) => m.capture).map((m) => m.to),
    ["-2,0"],
  );
});

test("a jump needs an empty landing hex and cannot take your own piece", () => {
  const blocked = new D.Game(
    [p(0, 0, 0), p(1, 0, 1), p(2, 0, 2), ...bystanders],
    0,
  );
  assert.equal(blocked.movesFrom("0,0").some((m) => m.capture), false);
  const own = new D.Game([p(0, 0, 0), p(1, 0, 0), ...bystanders], 0);
  assert.equal(own.movesFrom("0,0").some((m) => m.capture), false);
});

test("a man crowns when it lands on an edge outside its home edge", () => {
  // Mint walks to (11,-5), a Coral-side rim hex that is not Mint's home.
  const game = new D.Game([p(10, -5, 0), ...bystanders], 0);
  const move = game.legalActions().find((a) => a.from === "10,-5" && a.to === "11,-5");
  assert.ok(move, "the move onto the rim exists");
  assert.equal(move.crown, true);
  game.play({ type: "move", from: "10,-5", to: "11,-5" });
  assert.equal(game.pieces.get("11,-5").king, true);
  assert.equal(game.stats.crowned[0], 1);
});

test("walking onto your own home edge does not crown", () => {
  // (1,-11) is part of Mint's home edge, so reaching it from the corner is not a crowning step.
  const game = new D.Game([p(0, -11, 0), ...bystanders], 0);
  const move = game.legalActions().find((a) => a.from === "0,-11" && a.to === "1,-11");
  assert.ok(move, "the step along the home edge is legal");
  assert.equal(move.crown, false);
});
test("turns rotate through the colours", () => {
  const game = new D.Game([p(0, 0, 0), p(9, 0, 1), p(-9, 9, 2)], 0);
  game.play({ type: "place", to: "0,1" });
  assert.equal(game.activeTeam, 1);
  game.play({ type: "place", to: "8,0" });
  assert.equal(game.activeTeam, 2);
  game.play({ type: "place", to: "-8,8" });
  assert.equal(game.activeTeam, 0);
  assert.equal(game.turn, 4);
});
test("a colour with no pieces is skipped", () => {
  // Coral has no pieces, so Mint hands the turn straight to Lilac.
  const game = new D.Game([p(0, 0, 0), p(-9, 9, 2)], 0);
  game.play({ type: "place", to: "0,1" });
  assert.equal(game.activeTeam, 2);
  game.play({ type: "place", to: "-8,8" });
  assert.equal(game.activeTeam, 0);
});
test("eliminating one colour does not end a three-colour match", () => {
  // Mint drops on 0,0 and flips Coral's only piece, but Lilac is still in play.
  const game = new D.Game(
    [p(-1, 0, 0), p(1, 0, 1), p(2, 0, 0), p(-10, 10, 2)],
    0,
  );
  const outcome = game.play({ type: "place", to: "0,0" });
  assert.equal(outcome.ended, false);
  assert.equal(game.counts[1], 0);
});

test("the last colour with pieces wins", () => {
  const game = new D.Game([p(-1, 0, 0), p(1, 0, 1), p(2, 0, 0)], 0);
  const finished = game.play({ type: "place", to: "0,0" });
  assert.equal(finished.ended, true);
  assert.equal(finished.winner, 0);
  assert.equal(finished.reason, "last-standing");
  assert.equal(game.ended, true);
});
test("a full board ends the match on piece count", () => {
  // Every hex except the centre is taken; Mint holds the larger share, so it wins on count.
  const pieces = [];
  for (const cell of G.CELLS) {
    if (cell.key === "0,0") continue;
    pieces.push(p(cell.q, cell.r, cell.q >= 4 ? 1 : 0));
  }
  const game = new D.Game(pieces, 0);
  assert.equal(game.full, false);
  assert.ok(game.counts[0] > game.counts[1]);
  game.play({ type: "place", to: "0,0" });
  assert.equal(game.full, true);
  assert.equal(game.ended, true);
  assert.equal(game.reason, "board-full");
  assert.equal(game.winner, 0);
});
test("a stalled match ends on piece count after the stall limit", () => {
  const game = new D.Game([p(0, 0, 0, true), p(-3, 0, 1), p(9, 0, 2)], 0);
  game.quiet = D.STALL_LIMIT - 1;
  // Make a quiet move that neither drops nor captures.
  const move = game.legalActions().find((a) => a.type === "move");
  game.apply(move);
  assert.equal(game.ended, true);
  assert.equal(game.reason, "stalled");
  assert.equal(game.winner, null, "one piece each is a draw");
});

test("state survives a round trip through JSON", () => {
  const game = new D.Game();
  game.play({ type: "place", to: "0,0" });
  const restored = D.Game.fromJSON(JSON.parse(JSON.stringify(game)));
  assert.deepEqual(restored.toJSON(), game.toJSON());
  assert.deepEqual(
    restored.legalActions().map((a) => a.to),
    game.legalActions().map((a) => a.to),
  );
});

test("invalid positions and saves are rejected", () => {
  assert.throws(() => new D.Game([p(12, 0, 0)], 0), /outside the board/);
  assert.throws(() => new D.Game([p(0, 0, 5)], 0), /unknown color/);
  assert.throws(() => new D.Game([p(0, 0, 0), p(0, 0, 1)], 0), /share a hex/);
  assert.throws(() => new D.Game([p(0, 0, 0)], 3), /starting color/);
  assert.throws(() => D.Game.fromJSON({ version: 1 }), /Incompatible/);
  const game = new D.Game();
  game.play({ type: "place", to: "0,0" });
  assert.throws(
    () => game.play({ type: "place", to: "0,0" }),
    /not a legal move/,
  );
});

test("a finished match accepts no further actions", () => {
  const game = new D.Game([p(-1, 0, 0), p(1, 0, 1), p(2, 0, 0)], 0);
  game.play({ type: "place", to: "0,0" });
  assert.throws(() => game.play({ type: "place", to: "5,0" }), /finished/);
  assert.deepEqual(game.legalActions(), []);
});
test("the bot always chooses a legal action and prefers a decisive flip", () => {
  const game = new D.Game(
    [p(1, 0, 1), p(2, 0, 1), p(3, 0, 0), p(-3, 0, 0), ...bystanders],
    0,
  );
  const choice = D.chooseBotAction(game, () => 0);
  assert.ok(
    game
      .legalActions()
      .some((a) => a.to === choice.to && a.type === choice.type),
  );
  assert.equal(choice.to, "0,0");
  assert.equal(choice.flips.length, 2);
});
test("the bot takes a king when a jump is available", () => {
  const game = new D.Game([p(0, 0, 0), p(1, 0, 1, true), ...bystanders], 0);
  const choice = D.chooseBotAction(game, () => 0);
  assert.equal(choice.type, "move");
  assert.equal(choice.capture, "1,0");
});

test("three bots play a short match without errors", () => {
  const game = new D.Game();
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let turn = 0; turn < 60 && !game.ended; turn++) {
    const action = D.chooseBotAction(game, random);
    assert.ok(action, "a bot always has an action while the match runs");
    game.play(action);
  }
  assert.ok(game.turn > 1);
  for (const piece of game.pieces.values())
    assert.ok(G.onBoard(piece.q, piece.r));
});

test("quick matches end as soon as one colour holds the centre cluster", () => {
  assert.equal(D.CENTRE_CLUSTER.length, 7);
  const ring = [
    p(1, 0, 0),
    p(0, 1, 0),
    p(-1, 1, 0),
    p(-1, 0, 0),
    p(0, -1, 0),
    p(1, -1, 0),
  ];
  const quick = new D.Game([...ring, ...bystanders, p(-9, -1, 1)], 0, "centre");
  const win = quick.play({ type: "place", to: "0,0" });
  assert.equal(win.ended, true);
  assert.equal(win.winner, 0);
  assert.equal(win.reason, "centre");
  assert.equal(quick.centreOwned(0), 7);
});

test("the seventh centre hex completes the cluster; fewer does not", () => {
  // Mint owns the centre and four ring hexes; (0,-1) and (1,-1) are still open.
  const four = [p(0, 0, 0), p(1, 0, 0), p(0, 1, 0), p(-1, 1, 0), p(-1, 0, 0)];
  const short = new D.Game([...four, ...bystanders], 0, "centre");
  assert.equal(short.play({ type: "place", to: "0,-1" }).ended, false);
  // Mint owns six of seven: the open hex (1,-1) is the winning drop.
  const six = [...four, p(0, -1, 0), ...bystanders];
  const game = new D.Game(six, 0, "centre");
  assert.equal(game.centreOwned(0), 6);
  const win = game.play({ type: "place", to: "1,-1" });
  assert.equal(win.ended, true);
  assert.equal(win.reason, "centre");
});

test("the classic rule ignores the centre cluster", () => {
  const ring = [
    p(1, 0, 0),
    p(0, 1, 0),
    p(-1, 1, 0),
    p(-1, 0, 0),
    p(0, -1, 0),
    p(1, -1, 0),
  ];
  const classic = new D.Game([...ring, ...bystanders, p(-9, -1, 1)], 0);
  const outcome = classic.play({ type: "place", to: "0,0" });
  assert.equal(outcome.ended, false);
});

test("the win condition survives a save and is validated", () => {
  const quick = new D.Game(undefined, 0, "centre");
  quick.play({ type: "place", to: "0,0" });
  const restored = D.Game.fromJSON(JSON.parse(JSON.stringify(quick)));
  assert.equal(restored.win, "centre");
  assert.equal(new D.Game().win, "last-standing");
  assert.throws(() => new D.Game(undefined, 0, "sudden-death"), /win condition/);
});

test("the bot takes a centre win when one is available", () => {
  const ring = [
    p(1, 0, 0),
    p(0, 1, 0),
    p(-1, 1, 0),
    p(-1, 0, 0),
    p(0, -1, 0),
    p(1, -1, 0),
  ];
  const game = new D.Game([...ring, ...bystanders], 0, "centre");
  const choice = D.chooseBotAction(game, () => 0);
  assert.equal(choice.to, "0,0");
});

