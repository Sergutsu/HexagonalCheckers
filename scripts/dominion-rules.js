/* HEX Triad Dominion rules: a three-player hex Reversi + checkers hybrid.
 * Plain JavaScript: usable in the browser (after rules.js) and in Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./rules.js"));
  else root.DominionRules = factory(root.HexRules);
})(typeof globalThis !== "undefined" ? globalThis : this, function (G) {
  "use strict";

  const { RADIUS, DIRECTIONS, CELLS, TEAMS, key, coordinates, distance } = G;
  const onBoard = G.onBoard;
  const TOTAL = CELLS.length;
  // Each colour's home is one corner of the hexagon, shared with the checkers mode.
  const CORNERS = Object.freeze([
    Object.freeze([0, -RADIUS]),
    Object.freeze([RADIUS, 0]),
    Object.freeze([-RADIUS, RADIUS]),
  ]);
  // Outer hexes within this many steps of a corner form that colour's home edge.
  const HOME_RADIUS = 2;
  // Each colour starts with the corner and its two neighbours along the edge.
  const START_RADIUS = 1;
  // Turns in a row without a drop or a capture before the match is decided on material.
  const STALL_LIMIT = 40;
  // Quick matches end when one colour holds the centre hex and all six around it.
  const CENTRE_CLUSTER = Object.freeze(
    CELLS.filter((c) => distance(c.q, c.r) <= 1).map((c) => c.key),
  );
  const WIN_MODES = Object.freeze(["last-standing", "centre"]);

  // Screen position matching rules.js. Used only to work out which way is "forward".
  const screen = (q, r) => ({ x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r });

  // Men advance toward the centre: the three directions pointing inward from the corner.
  const FORWARD = Object.freeze(
    CORNERS.map(([cq, cr]) => {
      const corner = screen(cq, cr);
      return Object.freeze(
        DIRECTIONS.filter(([dq, dr]) => {
          const step = screen(dq, dr);
          return step.x * -corner.x + step.y * -corner.y > 1e-9;
        }),
      );
    }),
  );

  const isEdge = (q, r) => distance(q, r) === RADIUS;
  const homeEdgeKeys = (team) =>
    new Set(
      CELLS.filter(
        (c) =>
          c.edge &&
          distance(c.q, c.r, CORNERS[team][0], CORNERS[team][1]) <= HOME_RADIUS,
      ).map((c) => c.key),
    );
  const HOME = Object.freeze(TEAMS.map((_, team) => homeEdgeKeys(team)));
  // Any edge hex outside your own home edge crowns a man that walks or jumps onto it.
  const isKingEdge = (q, r, team) =>
    isEdge(q, r) && !HOME[team].has(key(q, r));

  function startingPieces() {
    return TEAMS.flatMap((_, team) =>
      CELLS.filter(
        (c) =>
          c.edge &&
          distance(c.q, c.r, CORNERS[team][0], CORNERS[team][1]) <=
            START_RADIUS,
      ).map((c) => ({ q: c.q, r: c.r, team, king: false })),
    );
  }

  // Every hex that a placement would flip, for a piece of `team` dropped on (q, r).
  // A run of opposing pieces is flipped when it is closed by one of your own pieces.
  function flipsFor(pieces, q, r, team) {
    const flips = [];
    for (const [dq, dr] of DIRECTIONS) {
      const run = [];
      let x = q + dq;
      let y = r + dr;
      while (onBoard(x, y)) {
        const piece = pieces.get(key(x, y));
        if (!piece) break;
        if (piece.team === team) {
          flips.push(...run);
          break;
        }
        run.push(key(x, y));
        x += dq;
        y += dr;
      }
    }
    return flips;
  }

  function validatePieces(pieces) {
    if (!Array.isArray(pieces) || pieces.length > TOTAL)
      throw new Error("This is not a valid Triad Dominion position.");
    const seen = new Set();
    return pieces.map((piece, i) => {
      if (!piece || !onBoard(piece.q, piece.r))
        throw new Error(`Piece ${i + 1} is outside the board.`);
      if (!Number.isInteger(piece.team) || piece.team < 0 || piece.team > 2)
        throw new Error(`Piece ${i + 1} has an unknown color.`);
      const cell = key(piece.q, piece.r);
      if (seen.has(cell)) throw new Error("Two pieces cannot share a hex.");
      seen.add(cell);
      return {
        q: piece.q,
        r: piece.r,
        team: piece.team,
        king: piece.king === true,
      };
    });
  }

  class Game {
    constructor(pieces = startingPieces(), activeTeam = 0, win = "last-standing") {
      if (
        !Number.isInteger(activeTeam) ||
        activeTeam < 0 ||
        activeTeam > 2
      )
        throw new Error("Unknown starting color.");
      if (!WIN_MODES.includes(win)) throw new Error("Unknown win condition.");
      this.win = win;
      this.pieces = new Map(
        validatePieces(pieces).map((p) => [key(p.q, p.r), p]),
      );
      this.activeTeam = activeTeam;
      this.turn = 1;
      this.quiet = 0;
      this.stats = {
        placed: [0, 0, 0],
        flipped: [0, 0, 0],
        captured: [0, 0, 0],
        crowned: [0, 0, 0],
      };
      this.ended = false;
      this.winner = null;
      this.reason = null;
      if (!this.counts[activeTeam]) this.activeTeam = this.nextAlive(activeTeam, true);
      this.settle(this.activeTeam, true);
    }

    get counts() {
      const counts = [0, 0, 0];
      for (const piece of this.pieces.values()) counts[piece.team]++;
      return counts;
    }

    get kingCounts() {
      const counts = [0, 0, 0];
      for (const piece of this.pieces.values()) if (piece.king) counts[piece.team]++;
      return counts;
    }

    get full() {
      return this.pieces.size >= TOTAL;
    }

    nextAlive(from, inclusive = false) {
      const counts = this.counts;
      for (let i = inclusive ? 0 : 1; i <= 3; i++) {
        const team = (from + i) % 3;
        if (counts[team]) return team;
      }
      return from;
    }

    // The colour with the most pieces, or null for a tie.
    leader() {
      const counts = this.counts;
      const top = Math.max(...counts);
      const leaders = counts
        .map((n, team) => (n === top && n > 0 ? team : -1))
        .filter((team) => team >= 0);
      return leaders.length === 1 ? leaders[0] : null;
    }

    finish(winner, reason) {
      this.ended = true;
      this.winner = winner;
      this.reason = reason;
    }

    // The colour that owns the most central cluster hexes (0-7).
    centreOwned(team) {
      return CENTRE_CLUSTER.filter((cell) => this.pieces.get(cell)?.team === team)
        .length;
    }

    // Decides whether the match is over, or who moves next.
    settle(lastMover, initial = false) {
      const counts = this.counts;
      const alive = [0, 1, 2].filter((team) => counts[team] > 0);
      if (
        !initial &&
        this.win === "centre" &&
        this.centreOwned(lastMover) === CENTRE_CLUSTER.length
      ) {
        this.finish(lastMover, "centre");
        return;
      }
      if (alive.length <= 1) {
        this.finish(alive.length ? alive[0] : null, "last-standing");
        return;
      }
      if (this.full) {
        this.finish(this.leader(), "board-full");
        return;
      }
      if (!initial && this.quiet >= STALL_LIMIT) {
        this.finish(this.leader(), "stalled");
        return;
      }
      if (!initial) this.activeTeam = this.nextAlive(lastMover);
    }

    // Man moves: one step or one jump, forward only. Kings move in all six directions.
    movesFrom(cell) {
      const piece = this.pieces.get(cell);
      if (!piece) return [];
      const moves = [];
      const from = key(piece.q, piece.r);
      const directions = piece.king ? DIRECTIONS : FORWARD[piece.team];
      for (const [dq, dr] of directions) {
        const q = piece.q + dq;
        const r = piece.r + dr;
        if (!onBoard(q, r)) continue;
        const target = this.pieces.get(key(q, r));
        if (!target) {
          moves.push({
            type: "move",
            team: piece.team,
            from,
            to: key(q, r),
            capture: null,
            crown: !piece.king && isKingEdge(q, r, piece.team),
            flips: [],
          });
          continue;
        }
        const q2 = q + dq;
        const r2 = r + dr;
        if (
          target.team !== piece.team &&
          onBoard(q2, r2) &&
          !this.pieces.has(key(q2, r2))
        )
          moves.push({
            type: "move",
            team: piece.team,
            from,
            to: key(q2, r2),
            capture: key(q, r),
            crown: !piece.king && isKingEdge(q2, r2, piece.team),
            flips: [],
          });
      }
      return moves;
    }

    movesFor(team = this.activeTeam) {
      const moves = [];
      for (const [cell, piece] of this.pieces)
        if (piece.team === team) moves.push(...this.movesFrom(cell));
      return moves;
    }

    placementsFor(team = this.activeTeam) {
      if (this.full) return [];
      const drops = [];
      for (const cell of CELLS) {
        if (this.pieces.has(cell.key)) continue;
        drops.push({
          type: "place",
          team,
          from: null,
          to: cell.key,
          capture: null,
          crown: false,
          flips: flipsFor(this.pieces, cell.q, cell.r, team),
        });
      }
      return drops;
    }

    legalActions(team = this.activeTeam) {
      if (this.ended || !this.counts[team]) return [];
      return [...this.placementsFor(team), ...this.movesFor(team)];
    }

    dropFlips(cell, team = this.activeTeam) {
      if (this.pieces.has(cell) || !G.onBoard(...coordinates(cell))) return [];
      const [q, r] = coordinates(cell);
      return flipsFor(this.pieces, q, r, team);
    }

    // Applies an action that has already been validated against legalActions().
    apply(action) {
      const team = action.team;
      let progress = false;
      let captured = null;
      let crowned = false;
      if (action.type === "place") {
        const [q, r] = coordinates(action.to);
        this.pieces.set(action.to, { q, r, team, king: false });
        for (const cell of action.flips) this.pieces.get(cell).team = team;
        this.stats.placed[team]++;
        this.stats.flipped[team] += action.flips.length;
        progress = true;
      } else {
        const piece = this.pieces.get(action.from);
        this.pieces.delete(action.from);
        if (action.capture) {
          captured = { ...this.pieces.get(action.capture) };
          this.pieces.delete(action.capture);
          this.stats.captured[team]++;
          progress = true;
        }
        const [q, r] = coordinates(action.to);
        piece.q = q;
        piece.r = r;
        if (action.crown && !piece.king) {
          piece.king = true;
          crowned = true;
          this.stats.crowned[team]++;
        }
        this.pieces.set(action.to, piece);
      }
      this.turn++;
      this.quiet = progress ? 0 : this.quiet + 1;
      this.settle(team);
      return {
        ...action,
        captured,
        crowned,
        ended: this.ended,
        winner: this.winner,
        reason: this.reason,
      };
    }

    play(action) {
      if (this.ended) throw new Error("This match is finished.");
      const match = this.legalActions(this.activeTeam).find(
        (a) =>
          a.type === action.type &&
          a.to === action.to &&
          (a.from || null) === (action.from || null),
      );
      if (!match) throw new Error("That is not a legal move.");
      return this.apply(match);
    }

    clone() {
      const copy = Object.create(Game.prototype);
      copy.pieces = new Map(
        [...this.pieces].map(([cell, piece]) => [cell, { ...piece }]),
      );
      copy.activeTeam = this.activeTeam;
      copy.turn = this.turn;
      copy.quiet = this.quiet;
      copy.stats = {
        placed: [...this.stats.placed],
        flipped: [...this.stats.flipped],
        captured: [...this.stats.captured],
        crowned: [...this.stats.crowned],
      };
      copy.win = this.win;
      copy.ended = this.ended;
      copy.winner = this.winner;
      copy.reason = this.reason;
      return copy;
    }

    toJSON() {
      return {
        version: 1,
        mode: "triad-dominion",
        win: this.win,
        pieces: [...this.pieces.values()].map((p) => ({ ...p })),
        activeTeam: this.activeTeam,
        turn: this.turn,
        quiet: this.quiet,
        stats: this.stats,
        ended: this.ended,
        winner: this.winner,
        reason: this.reason,
      };
    }

    static fromJSON(data) {
      if (
        !data ||
        data.version !== 1 ||
        data.mode !== "triad-dominion" ||
        !Array.isArray(data.pieces)
      )
        throw new Error("Incompatible saved Triad Dominion match.");
      if (!Number.isInteger(data.activeTeam))
        throw new Error("Invalid saved turn.");
      const game = new Game(
        data.pieces,
        data.activeTeam,
        data.win === undefined ? "last-standing" : data.win,
      );
      game.turn = Number.isInteger(data.turn) && data.turn > 0 ? data.turn : 1;
      game.quiet =
        Number.isInteger(data.quiet) && data.quiet >= 0 ? data.quiet : 0;
      const stat = (values) =>
        Array.isArray(values) && values.length === 3
          ? values.map((n) => (Number.isInteger(n) && n >= 0 ? n : 0))
          : [0, 0, 0];
      game.stats = {
        placed: stat(data.stats?.placed),
        flipped: stat(data.stats?.flipped),
        captured: stat(data.stats?.captured),
        crowned: stat(data.stats?.crowned),
      };
      game.ended = data.ended === true;
      game.winner = [0, 1, 2].includes(data.winner) ? data.winner : null;
      game.reason = typeof data.reason === "string" ? data.reason : null;
      return game;
    }
  }

  // Estimate of the best immediate gain `team` could take from `game` next turn.
  // Used by the bot to avoid leaving pieces that can be flipped or jumped.
  function tacticalValue(game, team) {
    let best = 0;
    for (const [cell, piece] of game.pieces) {
      if (piece.team !== team) continue;
      for (const move of game.movesFrom(cell))
        if (move.capture) {
          const target = game.pieces.get(move.capture);
          best = Math.max(best, 2 + (target.king ? 1.5 : 0) + (move.crown ? 2.5 : 0));
        }
    }
    const seen = new Set();
    for (const piece of game.pieces.values()) {
      if (piece.team === team) continue;
      for (const [dq, dr] of DIRECTIONS) {
        const q = piece.q + dq;
        const r = piece.r + dr;
        const cell = key(q, r);
        if (!onBoard(q, r) || game.pieces.has(cell) || seen.has(cell)) continue;
        seen.add(cell);
        const flips = flipsFor(game.pieces, q, r, team).length;
        best = Math.max(best, flips * 2.2);
      }
    }
    return best;
  }

  function chooseBotAction(game, random = Math.random) {
    const actions = game.legalActions();
    if (!actions.length) return null;
    const me = game.activeTeam;
    let best = null;
    let bestScore = -Infinity;
    for (const action of actions) {
      const trial = game.clone();
      const outcome = trial.apply(action);
      let score = 0;
      if (action.type === "place") score += 1 + action.flips.length * 2.2;
      else {
        if (action.capture)
          score += 2 + (outcome.captured && outcome.captured.king ? 1.5 : 0);
        if (action.crown) score += 2.5;
      }
      const [q, r] = coordinates(action.to);
      score += (RADIUS - distance(q, r)) * 0.04;
      if (game.win === "centre" && trial.centreOwned(me) > game.centreOwned(me))
        score += 1.2;
      if (trial.ended) {
        if (trial.winner === me) score += 1000;
        else if (trial.winner !== null) score -= 1000;
      } else {
        const threat = Math.max(
          0,
          ...[0, 1, 2]
            .filter((team) => team !== me && trial.counts[team] > 0)
            .map((team) => tacticalValue(trial, team)),
        );
        score -= threat * 1.1;
      }
      score += random() * 0.6;
      if (score > bestScore) {
        bestScore = score;
        best = action;
      }
    }
    return best;
  }

  return {
    TOTAL,
    CORNERS,
    FORWARD,
    HOME_RADIUS,
    START_RADIUS,
    STALL_LIMIT,
    HOME,
    CENTRE_CLUSTER,
    WIN_MODES,
    isKingEdge,
    startingPieces,
    flipsFor,
    validatePieces,
    chooseBotAction,
    Game,
  };
});
