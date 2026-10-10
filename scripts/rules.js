/* Hex Checkers rules. Plain JavaScript: usable in the browser and in Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HexRules = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SIDE_LENGTH = 12;
  const RADIUS = SIDE_LENGTH - 1;
  const DIRECTIONS = Object.freeze([
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ]);
  const TEAMS = Object.freeze([
    {
      id: "mint",
      name: "Mint",
      color: "#91e5c5",
      hex: 0x91e5c5,
      dark: 0x487361,
    },
    {
      id: "coral",
      name: "Coral",
      color: "#f59b85",
      hex: 0xf59b85,
      dark: 0x7a4c42,
    },
    {
      id: "lilac",
      name: "Lilac",
      color: "#b7a1ec",
      hex: 0xb7a1ec,
      dark: 0x5b5075,
    },
  ]);
  const key = (q, r) => `${q},${r}`;
  const coordinates = (value) => value.split(",").map(Number);
  const distance = (q, r, q2 = 0, r2 = 0) =>
    Math.max(Math.abs(q - q2), Math.abs(r - r2), Math.abs(q + r - q2 - r2));
  const onBoard = (q, r) =>
    Number.isInteger(q) && Number.isInteger(r) && distance(q, r) <= RADIUS;
  const isPromotion = (q, r) =>
    (q === 0 && r === 0) || distance(q, r) === RADIUS;
  const CELLS = [];
  for (let q = -RADIUS; q <= RADIUS; q++) {
    for (
      let r = Math.max(-RADIUS, -q - RADIUS);
      r <= Math.min(RADIUS, -q + RADIUS);
      r++
    ) {
      CELLS.push(
        Object.freeze({
          q,
          r,
          key: key(q, r),
          edge: distance(q, r) === RADIUS,
          center: q === 0 && r === 0,
        }),
      );
    }
  }
  Object.freeze(CELLS);

  function standardSetup() {
    const homes = [
      [0, -RADIUS],
      [RADIUS, 0],
      [-RADIUS, RADIUS],
    ];
    return homes.flatMap(([hq, hr], team) =>
      CELLS.filter(({ q, r }) => distance(q, r, hq, hr) <= 3).map(
        ({ q, r }) => ({ q, r, team, super: false }),
      ),
    );
  }

  function preset(name) {
    if (name === "orbit") {
      const shifts = [
        [0, 3],
        [-3, 0],
        [3, -3],
      ];
      return standardSetup().map((p) => ({
        ...p,
        q: p.q + shifts[p.team][0],
        r: p.r + shifts[p.team][1],
      }));
    }
    if (name === "scattered") {
      let seed = 134701;
      const random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
      const pool = CELLS.filter(
        (c) => distance(c.q, c.r) >= 3 && distance(c.q, c.r) <= 9,
      ).map((c) => ({ ...c }));
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool
        .slice(0, 48)
        .map((c, i) => ({ q: c.q, r: c.r, team: i % 3, super: false }));
    }
    return standardSetup();
  }

  function validateSetup(pieces, requireAllTeams = true) {
    if (!Array.isArray(pieces) || pieces.length > CELLS.length)
      throw new Error("This is not a valid board setup.");
    const occupied = new Set();
    const counts = [0, 0, 0];
    const normalized = pieces.map((piece, i) => {
      if (!piece || !onBoard(piece.q, piece.r))
        throw new Error(`Pawn ${i + 1} is outside the board.`);
      if (!Number.isInteger(piece.team) || piece.team < 0 || piece.team > 2)
        throw new Error(`Pawn ${i + 1} has an unknown color.`);
      const cell = key(piece.q, piece.r);
      if (occupied.has(cell)) throw new Error("Two pawns cannot share a hex.");
      occupied.add(cell);
      counts[piece.team]++;
      return {
        q: piece.q,
        r: piece.r,
        team: piece.team,
        super: piece.super === true,
        id: `p${i}`,
      };
    });
    if (requireAllTeams && counts.some((n) => n === 0))
      throw new Error("Place at least one pawn of each color.");
    if (requireAllTeams && pieces.length === CELLS.length)
      throw new Error("Leave at least one empty hex so the pawns can move.");
    return normalized;
  }

  class Game {
    constructor(pieces = standardSetup(), startingTeam = 0) {
      if (
        !Number.isInteger(startingTeam) ||
        startingTeam < 0 ||
        startingTeam > 2
      )
        throw new Error("Unknown starting color.");
      this.pieces = new Map(
        validateSetup(pieces, false).map((p) => [key(p.q, p.r), p]),
      );
      this.activeTeam = startingTeam;
      this.chainId = null;
      this.turn = 1;
      this.captures = [0, 0, 0];
      this.ended = false;
      this.winner = null;
      this.cache = new Map();
      this.settle(startingTeam);
    }

    get counts() {
      const counts = [0, 0, 0];
      for (const piece of this.pieces.values()) counts[piece.team]++;
      return counts;
    }

    get superCounts() {
      const counts = [0, 0, 0];
      for (const piece of this.pieces.values())
        if (piece.super) counts[piece.team]++;
      return counts;
    }

    rawMoves(piece) {
      if (!piece) return [];
      const moves = [];
      const from = key(piece.q, piece.r);
      const add = (q, r, capture = null) =>
        moves.push({
          from,
          to: key(q, r),
          pieceId: piece.id,
          capture,
          kind: capture ? "capture" : "move",
        });
      for (const [dq, dr] of DIRECTIONS) {
        let q = piece.q + dq;
        let r = piece.r + dr;
        if (!piece.super) {
          if (!onBoard(q, r)) continue;
          const obstacle = this.pieces.get(key(q, r));
          if (!obstacle) add(q, r);
          else if (
            obstacle.team !== piece.team &&
            onBoard(q + dq, r + dr) &&
            !this.pieces.has(key(q + dq, r + dr))
          )
            add(q + dq, r + dr, key(q, r));
          continue;
        }
        let enemy = null;
        while (onBoard(q, r)) {
          const occupied = this.pieces.get(key(q, r));
          if (occupied) {
            if (enemy || occupied.team === piece.team) break;
            enemy = key(q, r);
          } else add(q, r, enemy);
          q += dq;
          r += dr;
        }
      }
      return moves;
    }

    legalMoves(team = this.activeTeam) {
      if (this.ended) return [];
      const cacheKey = `${team}:${team === this.activeTeam ? this.chainId || "" : ""}`;
      if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
      let moves = [];
      for (const piece of this.pieces.values()) {
        if (
          piece.team !== team ||
          (team === this.activeTeam &&
            this.chainId &&
            piece.id !== this.chainId)
        )
          continue;
        moves.push(...this.rawMoves(piece));
      }
      const captures = moves.filter((move) => move.capture);
      moves =
        captures.length || (team === this.activeTeam && this.chainId)
          ? captures
          : moves;
      this.cache.set(cacheKey, moves);
      return moves;
    }

    settle(preferred) {
      this.cache.clear();
      const counts = this.counts;
      const alive = [0, 1, 2].filter((t) => counts[t] > 0);
      if (alive.length <= 1) {
        this.ended = true;
        this.winner = alive.length ? alive[0] : null;
        if (this.winner !== null) this.activeTeam = this.winner;
        return [];
      }
      const skipped = [];
      for (let i = 0; i < 3; i++) {
        const team = (preferred + i) % 3;
        if (counts[team] && this.legalMoves(team).length) {
          this.activeTeam = team;
          this.cache.clear();
          return skipped;
        }
        skipped.push(team);
      }
      this.ended = true;
      this.winner = null;
      return skipped;
    }

    move(from, to) {
      if (this.ended) throw new Error("This match is finished.");
      const move = this.legalMoves().find(
        (m) => m.from === from && m.to === to,
      );
      if (!move) throw new Error("That is not a legal move.");
      const original = this.pieces.get(from);
      const captured = move.capture
        ? { ...this.pieces.get(move.capture) }
        : null;
      const [q, r] = coordinates(to);
      const promoted = !original.super && isPromotion(q, r);
      const piece = { ...original, q, r, super: original.super || promoted };
      this.pieces.delete(from);
      if (move.capture) {
        this.pieces.delete(move.capture);
        this.captures[original.team]++;
      }
      this.pieces.set(to, piece);
      this.cache.clear();
      const chain = Boolean(
        move.capture && this.rawMoves(piece).some((m) => m.capture),
      );
      let skipped = [];
      if (chain) this.chainId = piece.id;
      else {
        this.chainId = null;
        this.turn++;
        skipped = this.settle((this.activeTeam + 1) % 3);
      }
      this.cache.clear();
      return {
        ...move,
        team: original.team,
        captured,
        promoted,
        chain,
        skipped,
        ended: this.ended,
        winner: this.winner,
      };
    }

    toJSON() {
      return {
        version: 1,
        sideLength: SIDE_LENGTH,
        pieces: [...this.pieces.values()].map((p) => ({ ...p })),
        activeTeam: this.activeTeam,
        chainId: this.chainId,
        turn: this.turn,
        captures: [...this.captures],
        ended: this.ended,
        winner: this.winner,
      };
    }

    static fromJSON(data) {
      if (!data || data.version !== 1 || data.sideLength !== SIDE_LENGTH)
        throw new Error("Incompatible saved match.");
      const normalized = validateSetup(data.pieces, false);
      if (
        !Number.isInteger(data.activeTeam) ||
        data.activeTeam < 0 ||
        data.activeTeam > 2
      )
        throw new Error("Invalid saved turn.");
      const ids = new Set();
      normalized.forEach((p, i) => {
        const id = data.pieces[i].id;
        if (typeof id !== "string" || ids.has(id))
          throw new Error("Invalid pawn identifier.");
        p.id = id;
        ids.add(id);
      });
      const game = new Game(normalized, data.activeTeam);
      // The constructor normalizes identifiers; restore them for multi-jump saves.
      game.pieces = new Map(normalized.map((p) => [key(p.q, p.r), p]));
      game.activeTeam = data.activeTeam;
      game.chainId = data.chainId || null;
      game.turn = Number.isInteger(data.turn) && data.turn > 0 ? data.turn : 1;
      game.captures =
        Array.isArray(data.captures) && data.captures.length === 3
          ? data.captures.map((n) => Math.max(0, Number(n) || 0))
          : [0, 0, 0];
      game.ended = Boolean(data.ended);
      game.winner = [0, 1, 2].includes(data.winner) ? data.winner : null;
      game.cache.clear();
      if (game.chainId) {
        const chained = [...game.pieces.values()].find(
          (p) => p.id === game.chainId && p.team === game.activeTeam,
        );
        if (!chained || !game.rawMoves(chained).some((m) => m.capture))
          throw new Error("Invalid saved capture chain.");
      }
      if (!game.ended && !game.chainId) game.settle(game.activeTeam);
      return game;
    }
  }

  function chooseBotMove(game, random = Math.random) {
    const moves = game.legalMoves();
    if (!moves.length) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const move of moves) {
      const piece = game.pieces.get(move.from);
      const [q, r] = coordinates(move.to);
      const beforeDistance = distance(piece.q, piece.r);
      const afterDistance = distance(q, r);
      let score = random() * 1.8;
      if (move.capture)
        score += 16 + (game.pieces.get(move.capture).super ? 6 : 0);
      if (!piece.super && isPromotion(q, r)) score += 13;
      score += (beforeDistance - afterDistance) * (piece.super ? 0.22 : 0.9);
      score -= afterDistance * 0.035;
      const trial = Game.fromJSON(game.toJSON());
      const outcome = trial.move(move.from, move.to);
      if (outcome.chain) score += 7;
      if (trial.ended && trial.winner === piece.team) score += 1000;
      if (!trial.ended) {
        let exposed = false;
        for (let team = 0; team < 3; team++) {
          if (
            team !== piece.team &&
            trial.legalMoves(team).some((m) => m.capture === move.to)
          )
            exposed = true;
        }
        if (exposed) score -= piece.super ? 14 : 9;
      }
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    return best;
  }

  return {
    SIDE_LENGTH,
    RADIUS,
    DIRECTIONS,
    TEAMS,
    CELLS,
    key,
    coordinates,
    distance,
    onBoard,
    isPromotion,
    standardSetup,
    preset,
    validateSetup,
    Game,
    chooseBotMove,
  };
});
