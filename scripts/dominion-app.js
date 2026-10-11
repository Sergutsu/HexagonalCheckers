/* HEX Triad Dominion: PixiJS board, controls, persistence, and bot scheduling. */
(function () {
  "use strict";

  const R = window.HexRules;
  const D = window.DominionRules;
  const $ = (id) => document.getElementById(id);
  const all = (selector) => [...document.querySelectorAll(selector)];
  // Listeners belong to the running mode, so the switcher can stop the board
  // cleanly when the player returns to checkers.
  let activeSignal = null;
  const on = (target, type, handler, options = {}) =>
    target.addEventListener(type, handler, { ...options, signal: activeSignal });
  const STORAGE_KEY = "triad-dominion-v1";
  const UNIT = 24;
  const SQRT3 = Math.sqrt(3);
  const BOT_DELAY = 700;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const position = (q, r) => ({
    x: SQRT3 * UNIT * (q + r / 2),
    y: UNIT * 1.5 * r,
  });
  const HEX_POINTS = Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - 30) * Math.PI) / 180;
    return [Math.cos(a) * (UNIT - 1), Math.sin(a) * (UNIT - 1)];
  }).flat();
  const starPoints = (x, y, radius, inner = radius * 0.35) =>
    Array.from({ length: 8 }, (_, i) => {
      const angle = (i * Math.PI) / 4 - Math.PI / 2;
      const size = i % 2 ? inner : radius;
      return [x + Math.cos(angle) * size, y + Math.sin(angle) * size];
    }).flat();
  const reducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TEAM_NAMES = R.TEAMS.map((t) => t.name);
  const CENTRE = new Set(D.CENTRE_CLUSTER);

  class BoardView {
    constructor(controller) {
      this.controller = controller;
      this.host = $("board-host");
      this.destroyed = false;
      this.zoom = 1;
      this.pan = { x: 0, y: 0 };
      this.hover = null;
      this.keyboardCell = null;
      this.objects = new Map();
      this.tweens = [];
      this.pointers = new Map();
    }

    async init() {
      this.app = new PIXI.Application();
      await this.app.init({
        width: this.host.clientWidth,
        height: this.host.clientHeight,
        antialias: true,
        backgroundAlpha: 0,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        preference: "webgl",
        powerPreference: "low-power",
      });
      if (this.destroyed) {
        try {
          this.app.destroy({ removeView: true }, { children: true });
        } catch (_) {
          /* The player switched modes while the context was starting. */
        }
        this.app = null;
        return;
      }
      this.app.canvas.setAttribute("aria-hidden", "true");
      this.host.appendChild(this.app.canvas);
      this.root = new PIXI.Container();
      this.root.eventMode = "none";
      this.tiles = new PIXI.Graphics();
      this.highlights = new PIXI.Graphics();
      this.pieceLayer = new PIXI.Container();
      this.overlay = new PIXI.Graphics();
      this.ghost = new PIXI.Graphics();
      this.root.addChild(
        this.tiles,
        this.highlights,
        this.pieceLayer,
        this.overlay,
        this.ghost,
      );
      this.app.stage.addChild(this.root);
      this.drawTiles();
      this.app.ticker.maxFPS = 60;
      this.app.ticker.add(() => this.tick());
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.host);
      this.resize();
      this.bindPointers();
      this.syncPieces();
      $("loading").hidden = true;
    }

    drawHex(graphic, q, r, color, alpha = 1) {
      const p = position(q, r);
      const points = HEX_POINTS.map((n, i) => n + (i % 2 ? p.y : p.x));
      graphic.poly(points).fill({ color, alpha });
    }

    drawTiles() {
      this.tiles.clear();
      const shades = [0x252e36, 0x242c34, 0x263039];
      for (const cell of R.CELLS) {
        let color = cell.edge
          ? 0x333e47
          : shades[(((cell.q - cell.r) % 3) + 3) % 3];
        if (CENTRE.has(cell.key)) color = cell.center ? 0x4c5e55 : 0x3b4c45;
        this.drawHex(this.tiles, cell.q, cell.r, color);
      }
      // Each colour's home edge is tinted so players can see where they started.
      D.HOME.forEach((home, team) => {
        for (const cell of home) {
          const [q, r] = R.coordinates(cell);
          this.drawHex(this.tiles, q, r, R.TEAMS[team].hex, 0.2);
        }
      });
      this.tiles
        .poly(starPoints(0, 0, 6.2, 2.1))
        .fill({ color: 0x9db7a9, alpha: 0.8 });
    }

    resize() {
      if (!this.app) return;
      this.width = this.host.clientWidth;
      this.height = this.host.clientHeight;
      if (!this.width || !this.height) return;
      this.app.renderer.resize(this.width, this.height);
      const padding = this.width < 600 ? 17 : 30;
      this.rotation = this.width <= 620 ? Math.PI / 2 : 0;
      const wide = SQRT3 * UNIT * (R.RADIUS * 2 + 1);
      const tall = UNIT * (R.RADIUS * 3 + 2);
      this.fitScale = Math.max(
        0.1,
        Math.min(
          (this.width - padding * 2) / (this.rotation ? tall : wide),
          (this.height - padding * 2 - 12) / (this.rotation ? wide : tall),
        ),
      );
      this.transform();
    }

    transform() {
      if (!this.root) return;
      const scale = this.fitScale * this.zoom;
      this.pan.x = clamp(
        this.pan.x,
        -this.width * this.zoom * 0.6,
        this.width * this.zoom * 0.6,
      );
      this.pan.y = clamp(
        this.pan.y,
        -this.height * this.zoom * 0.6,
        this.height * this.zoom * 0.6,
      );
      this.root.scale.set(scale);
      this.root.rotation = this.rotation || 0;
      this.root.position.set(
        this.width / 2 + this.pan.x,
        this.height / 2 - 6 + this.pan.y,
      );
      $("zoom-label").textContent = `${Math.round(this.zoom * 100)}%`;
      $("zoom-out").disabled = this.zoom <= 0.66;
      $("zoom-in").disabled = this.zoom >= 3.99;
    }

    setZoom(value, focal) {
      const next = clamp(value, 0.65, 4);
      const center = { x: this.width / 2, y: this.height / 2 - 6 };
      focal = focal || center;
      const oldScale = this.fitScale * this.zoom;
      const world = {
        x: (focal.x - center.x - this.pan.x) / oldScale,
        y: (focal.y - center.y - this.pan.y) / oldScale,
      };
      this.zoom = next;
      this.pan.x = focal.x - center.x - world.x * this.fitScale * next;
      this.pan.y = focal.y - center.y - world.y * this.fitScale * next;
      this.transform();
    }

    fit() {
      this.zoom = 1;
      this.pan = { x: 0, y: 0 };
      this.resize();
    }

    cellAt(x, y) {
      const scale = this.fitScale * this.zoom;
      const localX = (x - this.root.x) / scale;
      const localY = (y - this.root.y) / scale;
      const cos = Math.cos(this.rotation || 0),
        sin = Math.sin(this.rotation || 0);
      x = localX * cos + localY * sin;
      y = -localX * sin + localY * cos;
      const rf = ((2 / 3) * y) / UNIT;
      const qf = (x / SQRT3 - y / 3) / UNIT;
      const sf = -qf - rf;
      let q = Math.round(qf);
      let r = Math.round(rf);
      let s = Math.round(sf);
      const qd = Math.abs(q - qf),
        rd = Math.abs(r - rf),
        sd = Math.abs(s - sf);
      if (qd > rd && qd > sd) q = -r - s;
      else if (rd > sd) r = -q - s;
      else s = -q - r;
      if (!R.onBoard(q, r)) return null;
      return R.key(q, r);
    }

    drawPiece(g, team, king, alpha = 1) {
      const color = R.TEAMS[team];
      g.clear();
      g.circle(0, 1.4, UNIT * 0.7).fill({ color: 0x11181e, alpha });
      g.circle(0, 0, UNIT * 0.625).fill({ color: color.dark, alpha });
      g.circle(0, 0, UNIT * 0.55).fill({ color: color.hex, alpha });
      if (king)
        g.poly(starPoints(0, 0, UNIT * 0.31, UNIT * 0.11)).fill({
          color: 0x18251f,
          alpha: alpha * 0.85,
        });
      else
        g.circle(0, 0, UNIT * 0.125).fill({
          color: 0x17231e,
          alpha: alpha * 0.4,
        });
    }

    addTween(tween) {
      this.tweens.push({ start: performance.now(), ...tween });
    }

    // Diffs the PixiJS objects against the game state, animating the latest action.
    syncPieces(outcome) {
      const state = this.controller.game.pieces;
      const animate = Boolean(outcome) && !reducedMotion();

      if (outcome && outcome.type === "move") {
        const entry = this.objects.get(outcome.from);
        this.objects.delete(outcome.from);
        if (entry) {
          this.objects.set(outcome.to, entry);
          const from = position(...R.coordinates(outcome.from));
          const to = position(...R.coordinates(outcome.to));
          if (animate)
            this.addTween({
              object: entry.object,
              duration: 210,
              move: { from, to },
              scale: 1,
            });
          else entry.object.position.set(to.x, to.y);
        }
        if (outcome.capture) {
          const victim = this.objects.get(outcome.capture);
          this.objects.delete(outcome.capture);
          if (victim) {
            if (animate)
              this.addTween({
                object: victim.object,
                duration: 170,
                fade: true,
                finish: () => victim.object.destroy(),
              });
            else victim.object.destroy();
          }
        }
      }

      for (const [cell, entry] of this.objects) {
        if (state.has(cell)) continue;
        this.objects.delete(cell);
        entry.object.destroy();
      }

      for (const [cell, piece] of state) {
        let entry = this.objects.get(cell);
        if (!entry) {
          const object = new PIXI.Graphics();
          const p = position(piece.q, piece.r);
          object.position.set(p.x, p.y);
          this.pieceLayer.addChild(object);
          entry = { object, team: null, king: null };
          this.objects.set(cell, entry);
          if (animate && outcome.type === "place" && outcome.to === cell)
            this.addTween({
              object,
              duration: 220,
              pop: true,
              scale: 1,
            });
        }
        if (entry.team !== piece.team || entry.king !== piece.king) {
          this.drawPiece(entry.object, piece.team, piece.king);
          entry.team = piece.team;
          entry.king = piece.king;
        }
        const flipped =
          animate && outcome && outcome.type === "place" && outcome.flips.includes(cell);
        const crowned = animate && outcome && outcome.crowned && outcome.to === cell;
        if (flipped || crowned)
          this.addTween({
            object: entry.object,
            duration: 300,
            pulse: crowned ? 0.3 : 0.18,
            scale: 1,
          });
      }
      this.updateHighlights();
      return new Promise((resolve) => {
        const wait = animate ? 260 : 0;
        setTimeout(resolve, wait);
      });
    }

    tick() {
      if (!this.tweens.length) return;
      const now = performance.now();
      for (let i = this.tweens.length - 1; i >= 0; i--) {
        const tween = this.tweens[i];
        const t = clamp((now - tween.start) / tween.duration, 0, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        const object = tween.object;
        if (tween.fade) {
          object.alpha = 1 - t;
          object.scale.set(1 - t * 0.35);
        } else if (tween.move) {
          object.position.set(
            tween.move.from.x + (tween.move.to.x - tween.move.from.x) * ease,
            tween.move.from.y + (tween.move.to.y - tween.move.from.y) * ease,
          );
        } else if (tween.pop) {
          object.scale.set(0.4 + 0.6 * ease);
        } else if (tween.pulse) {
          object.scale.set(1 + Math.sin(t * Math.PI) * tween.pulse);
        }
        if (t === 1) {
          this.tweens.splice(i, 1);
          if (tween.finish) tween.finish();
          if (tween.fade) object.alpha = 1;
          if (!tween.fade && !tween.finish) object.scale.set(1);
        }
      }
    }

    stopAnimations() {
      for (const tween of this.tweens) if (tween.finish) tween.finish();
      this.tweens = [];
    }

    updateHighlights() {
      if (!this.highlights) return;
      const c = this.controller;
      const game = c.game;
      const team = R.TEAMS[game.activeTeam];
      this.highlights.clear();
      this.overlay.clear();
      this.ghost.clear();
      const draw = (cell, color, alpha) => {
        if (!cell) return;
        const [q, r] = R.coordinates(cell);
        this.drawHex(this.highlights, q, r, color, alpha);
      };
      if (this.keyboardCell) draw(this.keyboardCell, 0x667a82, 0.6);
      if (game.ended) {
        this.updateCursor();
        return;
      }
      const human = c.canHumanPlay();
      if (c.mode === "drop") {
        if (human && this.hover && !game.pieces.has(this.hover)) {
          draw(this.hover, 0x54616b, 0.35);
          const [q, r] = R.coordinates(this.hover);
          const p = position(q, r);
          this.drawPiece(this.ghost, game.activeTeam, false, 0.5);
          this.ghost.position.set(p.x, p.y);
          for (const cell of game.dropFlips(this.hover, game.activeTeam)) {
            const [fq, fr] = R.coordinates(cell);
            const fp = position(fq, fr);
            this.overlay
              .circle(fp.x, fp.y, UNIT * 0.66)
              .stroke({ width: 2.4, color: team.hex, alpha: 0.95 });
          }
        }
      } else {
        if (c.selected) {
          draw(c.selected, team.dark, 0.8);
          for (const move of game.movesFrom(c.selected)) {
            const [q, r] = R.coordinates(move.to);
            const p = position(q, r);
            draw(move.to, team.dark, 0.3);
            if (move.capture) {
              const [cq, cr] = R.coordinates(move.capture);
              const cp = position(cq, cr);
              this.overlay
                .circle(cp.x, cp.y, UNIT * 0.66)
                .stroke({ width: 2.6, color: 0xff7a6e, alpha: 0.95 });
            }
            if (move.crown)
              this.highlights
                .poly(starPoints(p.x, p.y, 5, 1.8))
                .fill({ color: team.hex, alpha: 0.95 });
            else
              this.highlights
                .circle(p.x, p.y, move.capture ? 4.2 : 3.2)
                .fill({ color: team.hex, alpha: move.capture ? 0.95 : 0.7 });
          }
        } else if (human) {
          for (const [cell, piece] of game.pieces) {
            if (piece.team !== game.activeTeam) continue;
            if (!game.movesFrom(cell).length) continue;
            const [q, r] = R.coordinates(cell);
            const p = position(q, r);
            this.overlay
              .circle(p.x, p.y, UNIT * 0.66)
              .stroke({ width: 1.6, color: team.hex, alpha: 0.45 });
          }
        }
      }
      this.updateCursor();
    }

    updateCursor() {
      if (!this.app) return;
      const c = this.controller;
      if (c.canHumanPlay() && this.hover) {
        const piece = c.game.pieces.get(this.hover);
        const own = piece && piece.team === c.game.activeTeam;
        const empty = !piece;
        const destination =
          c.mode === "move" &&
          c.selected &&
          c.game.movesFrom(c.selected).some((m) => m.to === this.hover);
        this.app.canvas.style.cursor =
          (c.mode === "drop" && empty) || own || destination
            ? "pointer"
            : this.zoom > 1
              ? "grab"
              : "default";
      } else this.app.canvas.style.cursor = this.zoom > 1 ? "grab" : "default";
    }

    bindPointers() {
      const canvas = this.app.canvas;
      const local = (e) => {
        const b = canvas.getBoundingClientRect();
        return { x: e.clientX - b.left, y: e.clientY - b.top };
      };
      on(canvas, "pointerdown", (e) => {
        if (e.button !== 0 && e.button !== 1) return;
        this.host.focus({ preventScroll: true });
        const p = local(e);
        const entry = {
          ...p,
          startX: p.x,
          startY: p.y,
          moved: false,
          button: e.button,
        };
        this.pointers.set(e.pointerId, entry);
        canvas.setPointerCapture(e.pointerId);
        if (this.pointers.size === 2) {
          const points = [...this.pointers.values()];
          points.forEach((point) => {
            point.moved = true;
          });
          this.pinch = {
            distance: Math.hypot(
              points[0].x - points[1].x,
              points[0].y - points[1].y,
            ),
            zoom: this.zoom,
            center: {
              x: (points[0].x + points[1].x) / 2,
              y: (points[0].y + points[1].y) / 2,
            },
          };
        }
      });
      on(canvas, "pointermove", (e) => {
        const p = local(e);
        const pressed = this.pointers.get(e.pointerId);
        if (pressed) {
          const dx = p.x - pressed.x,
            dy = p.y - pressed.y;
          pressed.x = p.x;
          pressed.y = p.y;
          if (this.pointers.size === 2 && this.pinch) {
            const points = [...this.pointers.values()];
            const gap = Math.hypot(
              points[0].x - points[1].x,
              points[0].y - points[1].y,
            );
            const midpoint = {
              x: (points[0].x + points[1].x) / 2,
              y: (points[0].y + points[1].y) / 2,
            };
            this.setZoom(
              (this.pinch.zoom * gap) / Math.max(1, this.pinch.distance),
              this.pinch.center,
            );
            this.pan.x += midpoint.x - this.pinch.center.x;
            this.pan.y += midpoint.y - this.pinch.center.y;
            this.pinch.center = midpoint;
            this.transform();
            return;
          }
          if (
            pressed.moved ||
            Math.hypot(p.x - pressed.startX, p.y - pressed.startY) > 6
          ) {
            pressed.moved = true;
            this.pan.x += dx;
            this.pan.y += dy;
            this.transform();
            canvas.style.cursor = "grabbing";
          }
        } else {
          const cell = this.cellAt(p.x, p.y);
          if (cell !== this.hover) {
            this.hover = cell;
            this.updateHighlights();
          }
        }
      });
      const finish = (e, canceled) => {
        const entry = this.pointers.get(e.pointerId);
        if (!entry) return;
        const p = local(e);
        if (!canceled && !entry.moved && entry.button === 0) {
          const cell = this.cellAt(p.x, p.y);
          if (cell) this.controller.click(cell);
        }
        this.pointers.delete(e.pointerId);
        if (canvas.hasPointerCapture(e.pointerId))
          canvas.releasePointerCapture(e.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
        this.updateCursor();
      };
      on(canvas, "pointerup", (e) => finish(e, false));
      on(canvas, "pointercancel", (e) => finish(e, true));
      on(canvas, "pointerleave", () => {
        if (!this.pointers.size) {
          this.hover = null;
          this.updateHighlights();
        }
      });
      on(canvas, "contextmenu", (e) => {
        e.preventDefault();
        this.controller.clearSelection();
      });
      on(canvas, 
        "wheel",
        (e) => {
          e.preventDefault();
          const b = canvas.getBoundingClientRect();
          this.setZoom(
            this.zoom * Math.exp(-clamp(e.deltaY, -150, 150) * 0.002),
            { x: e.clientX - b.left, y: e.clientY - b.top },
          );
        },
        { passive: false },
      );
      on(this.host, "keydown", (e) => {
        const directions = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        if (directions[e.key]) {
          e.preventDefault();
          e.stopPropagation();
          const [q, r] = R.coordinates(
            this.keyboardCell || this.controller.selected || "0,0",
          );
          const [dq, dr] = directions[e.key];
          if (R.onBoard(q + dq, r + dr))
            this.keyboardCell = R.key(q + dq, r + dr);
          else if (!this.keyboardCell) this.keyboardCell = R.key(q, r);
          this.updateHighlights();
          const piece = this.controller.game.pieces.get(this.keyboardCell);
          $("live-status").textContent =
            `Hex ${this.keyboardCell}. ${piece ? TEAM_NAMES[piece.team] + (piece.king ? " king" : " piece") : "Empty"}.`;
        } else if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          this.controller.click(
            this.keyboardCell || this.controller.selected || "0,0",
          );
        }
      });
      on(this.host, "blur", () => {
        this.keyboardCell = null;
        this.updateHighlights();
      });
    }

    // Releases the WebGL context and the canvas so the other mode can reuse
    // the same board host.
    destroy() {
      this.destroyed = true;
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      this.stopAnimations();
      if (this.app) {
        try {
          this.app.destroy({ removeView: true }, { children: true });
        } catch (_) {
          /* The context may already be gone; nothing left to release. */
        }
        this.app = null;
      }
      this.objects.clear();
      this.tweens = [];
      this.root = null;
      this.tiles = null;
      this.highlights = null;
      this.pieceLayer = null;
      this.overlay = null;
      this.ghost = null;
      $("loading").hidden = false;
    }
  }

  class DominionController {
    constructor() {
      this.settings = {
        controllers: ["human", "bot", "bot"],
        win: "last-standing",
      };
      this.game = new D.Game(undefined, 0, this.settings.win);
      this.history = [];
      this.mode = "drop";
      this.selected = null;
      this.paused = false;
      this.busy = false;
      this.ready = false;
      this.destroyed = false;
      this.botTimer = null;
      this.newWin = this.settings.win;
      this.load();
      this.view = new BoardView(this);
      this.bindUI();
      this.updateUI();
    }

    async init() {
      try {
        await this.view.init();
        if (this.destroyed) return;
        this.ready = true;
        this.view.syncPieces();
        this.updateUI();
        this.scheduleBot();
      } catch (error) {
        if (this.destroyed) return;
        console.error("Unable to initialize the board:", error);
        $("loading").classList.add("error");
        $("loading").textContent =
          "The arena could not start. Enable WebGL / hardware acceleration in your browser, then reload. No installation or build is needed.";
      }
    }

    load() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (!saved || saved.version !== 1) return;
        if (saved.settings) {
          if (
            Array.isArray(saved.settings.controllers) &&
            saved.settings.controllers.length === 3 &&
            saved.settings.controllers.every((c) => c === "human" || c === "bot")
          )
            this.settings.controllers = saved.settings.controllers;
          if (D.WIN_MODES.includes(saved.settings.win))
            this.settings.win = saved.settings.win;
        }
        if (saved.game) this.game = D.Game.fromJSON(saved.game);
        if (["drop", "move"].includes(saved.intent)) this.mode = saved.intent;
        this.paused = saved.paused === true;
        if (Array.isArray(saved.history))
          this.history = saved.history.slice(-40).filter((h) => {
            try {
              D.Game.fromJSON(h.state);
              return true;
            } catch (_) {
              return false;
            }
          });
        this.newWin = this.game.win;
      } catch (_) {
        /* Private mode, unavailable storage, or an old save: start normally. */
      }
    }

    save() {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            version: 1,
            game: this.game.toJSON(),
            settings: this.settings,
            intent: this.mode,
            history: this.history.slice(-40),
            paused: this.paused,
          }),
        );
      } catch (_) {
        /* The game remains fully playable without browser storage. */
      }
    }

    dialogOpen() {
      return all("dialog").some((d) => d.open);
    }

    canHumanPlay() {
      return (
        this.ready &&
        !this.busy &&
        !this.game.ended &&
        !this.dialogOpen() &&
        this.settings.controllers[this.game.activeTeam] === "human"
      );
    }

    clearBot() {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }

    scheduleBot() {
      this.clearBot();
      if (
        !this.ready ||
        this.busy ||
        this.paused ||
        this.game.ended ||
        this.dialogOpen() ||
        document.hidden ||
        this.settings.controllers[this.game.activeTeam] !== "bot"
      )
        return;
      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        if (
          this.busy ||
          this.paused ||
          this.game.ended ||
          this.dialogOpen() ||
          this.settings.controllers[this.game.activeTeam] !== "bot"
        )
          return;
        const action = D.chooseBotAction(this.game);
        if (action) this.performAction(action, false);
      }, BOT_DELAY);
    }

    click(cell) {
      if (!this.ready || this.busy || this.game.ended) return;
      if (!this.canHumanPlay()) {
        if (this.paused) this.toast("Bots are paused. Press Space to resume.");
        else
          this.toast(
            `Let ${TEAM_NAMES[this.game.activeTeam]} think, or switch its controller to Human.`,
          );
        return;
      }
      const game = this.game;
      const team = game.activeTeam;
      const piece = game.pieces.get(cell);
      if (this.mode === "drop") {
        if (!piece) {
          this.performAction(
            {
              type: "place",
              team,
              from: null,
              to: cell,
              capture: null,
              crown: false,
              flips: game.dropFlips(cell, team),
            },
            true,
          );
          return;
        }
        if (piece.team === team) {
          this.mode = "move";
          this.selectPiece(cell);
          this.toast("Move mode. Pick a highlighted hex.");
          return;
        }
        this.toast("Drop on an empty hex, or switch to Move.");
        return;
      }
      if (this.selected && game.movesFrom(this.selected).some((m) => m.to === cell)) {
        const move = game.movesFrom(this.selected).find((m) => m.to === cell);
        this.performAction(move, true);
        return;
      }
      if (piece && piece.team === team) {
        this.selectPiece(cell);
        return;
      }
      if (piece) this.toast("That piece belongs to someone else.");
      else this.clearSelection();
    }

    selectPiece(cell) {
      if (!this.game.movesFrom(cell).length) {
        this.toast("This piece has no open moves.");
        return;
      }
      this.selected = this.selected === cell ? null : cell;
      this.updateUI();
      this.view.updateHighlights();
    }

    clearSelection() {
      if (this.busy || !this.selected) return;
      this.selected = null;
      this.updateUI();
      this.view.updateHighlights();
    }

    setMode(mode) {
      if (mode === "drop" && this.game.full) {
        this.toast("The board is full. Move a piece instead.");
        return;
      }
      if (mode === "move" && !this.game.movesFor(this.game.activeTeam).length) {
        this.toast("No piece can move right now. Drop a piece.");
        return;
      }
      this.mode = mode;
      this.selected = null;
      this.updateUI();
      this.view.updateHighlights();
      this.save();
    }

    async performAction(action, human) {
      if (this.busy) return;
      this.clearBot();
      this.busy = true;
      this.history.push({
        state: this.game.toJSON(),
        human,
        team: this.game.activeTeam,
      });
      if (this.history.length > 40) this.history.shift();
      let outcome;
      try {
        outcome = this.game.play(action);
      } catch (error) {
        this.history.pop();
        this.busy = false;
        this.toast(error.message || "That move could not be completed.");
        this.updateUI();
        return;
      }
      this.selected = null;
      this.ensureMode();
      this.updateUI();
      this.save();
      const who = TEAM_NAMES[outcome.team];
      const summary = this.describe(outcome, who);
      $("live-status").textContent = this.game.ended
        ? "Match complete."
        : `${summary} ${TEAM_NAMES[this.game.activeTeam]} to move.`;
      await this.view.syncPieces(outcome);
      this.busy = false;
      if (human || outcome.crowned || outcome.captured || outcome.flips.length >= 2)
        this.toast(summary);
      this.updateUI();
      if (this.game.ended) this.showWinner();
      else this.scheduleBot();
    }

    describe(outcome, who) {
      if (outcome.type === "place") {
        const n = outcome.flips.length;
        return n
          ? `${who} dropped and flipped ${n} piece${n > 1 ? "s" : ""}.`
          : `${who} dropped a piece.`;
      }
      const parts = [`${who} moved`];
      if (outcome.captured) parts.push("and captured a piece");
      if (outcome.crowned) parts.push("and was crowned a king");
      return parts.join(" ") + ".";
    }

    // Keeps the drop / move choice valid for whoever moves next.
    ensureMode() {
      const game = this.game;
      if (game.ended) return;
      if (this.mode === "move" && !game.movesFor(game.activeTeam).length)
        this.mode = "drop";
      if (this.mode === "drop" && game.full) this.mode = "move";
    }

    updateUI() {
      const game = this.game;
      const team = R.TEAMS[game.activeTeam];
      const counts = game.counts;
      const kings = game.kingCounts;
      const human = this.settings.controllers[game.activeTeam] === "human";
      const hasMoves = game.movesFor(game.activeTeam).length > 0;
      $("turn-dot").style.background = team.color;
      $("turn-label").textContent = game.ended
        ? "MATCH COMPLETE"
        : `${team.name.toUpperCase()}'S TURN`;
      const badge = $("mode-badge");
      badge.hidden = false;
      badge.textContent =
        game.win === "centre" ? "QUICK MATCH" : "CLASSIC MATCH";
      $("win-note").textContent =
        game.win === "centre"
          ? "Hold all seven central hexes to win."
          : "Last colour standing wins.";

      let title;
      let description;
      if (game.ended) {
        title = this.endTitle().title;
        description = "Start a new match to play again.";
      } else if (!human && this.paused) {
        title = "Taking a breath.";
        description = `${team.name}'s bot is paused.`;
      } else if (!human && this.dialogOpen()) {
        title = `${team.name} is waiting.`;
        description = "Close the window to continue.";
      } else if (!human) {
        title = `${team.name} is thinking.`;
        description = "Counting flips, jumps, and the threats in between.";
      } else if (this.mode === "drop") {
        title = "Drop a piece.";
        description = `Land on an empty hex. Enemy pieces in a closed line flip to ${team.name}.`;
      } else if (this.selected) {
        title = "Choose a destination.";
        description = "Step forward, or jump an enemy into the empty hex beyond.";
      } else if (hasMoves) {
        title = "Move a piece.";
        description = `Select a ${team.name.toLowerCase()} piece with a highlighted move.`;
      } else {
        title = "Drop a piece.";
        description = "None of your pieces can move, so drop one instead.";
      }
      $("status-title").textContent = title;
      $("status-description").textContent = description;
      $("hint-text").textContent =
        this.mode === "drop"
          ? "Drops never crown. Kings come from walking or jumping."
          : "Men step forward only. Kings move in all six directions.";
      $("move-number").textContent = String(game.turn).padStart(2, "0");
      const humans = this.settings.controllers.filter((c) => c === "human").length;
      $("match-type").textContent =
        humans === 3
          ? "3 HUMANS"
          : humans === 0
            ? "3 BOTS"
            : humans === 1
              ? "YOU + 2 BOTS"
              : "2 HUMANS + BOT";
      R.TEAMS.forEach((t, i) => {
        const card = $(`player-${i}`);
        card.classList.toggle("active", game.activeTeam === i && !game.ended);
        card.classList.toggle("eliminated", !counts[i]);
        $(`count-${i}`).textContent = counts[i];
        $(`kings-${i}`).textContent = `${kings[i]} king${kings[i] === 1 ? "" : "s"}`;
        const button = card.querySelector(".seat-type");
        const bot = this.settings.controllers[i] === "bot";
        button.querySelector("use").setAttribute("href", bot ? "#i-bot" : "#i-human");
        button.querySelector("span").textContent = bot ? "Bot" : "Human";
        button.title = `Switch ${t.name} to ${bot ? "human" : "bot"}`;
        button.setAttribute(
          "aria-label",
          `${t.name}: ${bot ? "bot" : "human"} controlled. Switch to ${bot ? "human" : "bot"}.`,
        );
        card.title = `${t.name}: ${counts[i]} pieces, ${kings[i]} king${kings[i] === 1 ? "" : "s"}`;
      });
      const dropOn = this.mode === "drop";
      $("drop-mode").classList.toggle("selected", dropOn);
      $("drop-mode").setAttribute("aria-pressed", String(dropOn));
      $("move-mode").classList.toggle("selected", !dropOn);
      $("move-mode").setAttribute("aria-pressed", String(!dropOn));
      $("drop-mode").disabled = game.full || game.ended;
      $("move-mode").disabled = !hasMoves || game.ended;
      $("undo-button").disabled = !this.history.length || this.busy;
      $("pause-button").classList.toggle("is-active", this.paused);
      $("pause-icon").querySelector("use").setAttribute(
        "href",
        this.paused ? "#i-play" : "#i-pause",
      );
      $("pause-button").title = `${this.paused ? "Resume" : "Pause"} bots (Space)`;
      $("pause-button").setAttribute("aria-label", `${this.paused ? "Resume" : "Pause"} bots`);
      $("pause-button").setAttribute("aria-pressed", String(this.paused));
      if (this.ready) this.view.updateHighlights();
    }

    endTitle() {
      const game = this.game;
      const name = game.winner === null ? null : TEAM_NAMES[game.winner];
      const tally = game.counts.map((n, i) => `${TEAM_NAMES[i]} ${n}`).join(" · ");
      switch (game.reason) {
        case "last-standing":
          return { title: `${name} takes the board.`, description: `The last colour standing after ${game.turn - 1} turns.`, tally };
        case "centre":
          return { title: `${name} holds the centre.`, description: "All seven central hexes, theirs at the end of a turn.", tally };
        case "board-full":
          return {
            title: name ? `${name} leads a full board.` : "A tied, full board.",
            description: "Every hex is taken. The most pieces wins.",
            tally,
          };
        case "stalled":
          return {
            title: name ? `${name} leads on count.` : "A stalemate.",
            description: "Forty turns passed without a drop or a capture. The most pieces wins.",
            tally,
          };
        default:
          return { title: "A standstill.", description: "The match ended.", tally };
      }
    }

    showWinner() {
      const winner = this.game.winner;
      const team = winner === null ? null : R.TEAMS[winner];
      const { title, description, tally } = this.endTitle();
      $("winner-emblem").style.background = team ? team.color : "#9aadb4";
      $("winner-title").textContent = title;
      $("winner-description").textContent = description;
      $("winner-tally").textContent = tally;
      this.openDialog("winner-dialog");
    }

    setController(team, value) {
      this.settings.controllers[team] = value;
      this.updateUI();
      this.save();
      this.scheduleBot();
    }

    togglePause() {
      this.paused = !this.paused;
      this.clearBot();
      this.updateUI();
      this.save();
      this.scheduleBot();
      this.toast(
        this.paused
          ? "Bots paused. Human players can still act."
          : "Bots are back in play.",
      );
    }

    undo() {
      if (this.busy || !this.history.length) return;
      this.clearBot();
      let index = this.history.length - 1;
      for (let i = this.history.length - 1; i >= 0; i--)
        if (this.history[i].human) {
          index = i;
          break;
        }
      const snapshot = this.history[index];
      this.history.splice(index);
      this.game = D.Game.fromJSON(snapshot.state);
      this.selected = null;
      this.ensureMode();
      if (this.settings.controllers[this.game.activeTeam] === "bot")
        this.paused = true;
      $("winner-dialog").close();
      this.view.stopAnimations();
      this.view.syncPieces();
      this.updateUI();
      this.save();
      this.scheduleBot();
      this.toast("Turn rewound. Try another angle.");
    }

    startMatch(win) {
      this.clearBot();
      this.view.stopAnimations();
      this.settings.win = win;
      this.game = new D.Game(undefined, 0, win);
      this.selected = null;
      this.history = [];
      this.paused = false;
      this.busy = false;
      this.mode = "drop";
      this.view.hover = null;
      this.view.keyboardCell = null;
      this.view.fit();
      this.view.syncPieces();
      this.updateUI();
      this.save();
      this.scheduleBot();
      $("live-status").textContent = `New match. Mint to move. ${win === "centre" ? "Quick match." : "Classic match."}`;
    }

    newGame() {
      if (this.busy) return;
      this.newWin = this.game.win;
      $("new-game-description").textContent =
        this.game.turn > 1
          ? "Your current match will be replaced. Pick how the next one is decided."
          : "Pick how this match is decided.";
      this.updateNewWin();
      this.openDialog("new-game-dialog");
    }

    updateNewWin() {
      all("[data-new-win]").forEach((b) => {
        const selected = b.dataset.newWin === this.newWin;
        b.classList.toggle("selected", selected);
        b.setAttribute("aria-pressed", String(selected));
      });
    }

    toast(message) {
      clearTimeout(this.toastTimer);
      $("toast-message").textContent = message;
      $("toast").hidden = false;
      this.toastTimer = setTimeout(() => {
        $("toast").hidden = true;
      }, 2800);
    }

    openDialog(id) {
      this.clearBot();
      if (!$(id).open) $(id).showModal();
      this.updateUI();
    }

    bindUI() {
      on($("brand-link"), "click", (e) => {
        e.preventDefault();
        if (this.ready) this.view.fit();
      });
      on($("help-button"), "click", () => this.openDialog("help-dialog"));
      on($("drop-mode"), "click", () => this.setMode("drop"));
      on($("move-mode"), "click", () => this.setMode("move"));
      on($("undo-button"), "click", () => this.undo());
      on($("pause-button"), "click", () => this.togglePause());
      on($("new-game-button"), "click", () => this.newGame());
      on($("zoom-in"), "click", () => {
        if (this.ready) this.view.setZoom(this.view.zoom * 1.25);
      });
      on($("zoom-out"), "click", () => {
        if (this.ready) this.view.setZoom(this.view.zoom / 1.25);
      });
      on($("fit-view"), "click", () => {
        if (this.ready) this.view.fit();
      });
      all(".seat-type").forEach((b) =>
        on(b, "click", () => {
          const team = Number(b.dataset.team);
          this.setController(
            team,
            this.settings.controllers[team] === "human" ? "bot" : "human",
          );
        }),
      );
      all("[data-new-win]").forEach((b) =>
        on(b, "click", () => {
          this.newWin = b.dataset.newWin;
          this.updateNewWin();
        }),
      );
      on($("confirm-new-game"), "click", () => {
        $("new-game-dialog").close();
        this.startMatch(this.newWin);
      });
      on($("play-again"), "click", () => {
        $("winner-dialog").close();
        this.startMatch(this.game.win);
      });
      all("[data-close-dialog]").forEach((b) =>
        on(b, "click", () => $(b.dataset.closeDialog).close()),
      );
      all("dialog").forEach((dialog) => {
        on(dialog, "close", () => {
          this.updateUI();
          this.scheduleBot();
        });
        on(dialog, "click", (e) => {
          if (e.target !== dialog) return;
          const box = dialog.getBoundingClientRect();
          if (
            e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom
          )
            dialog.close();
        });
      });
      on(document, "keydown", (e) => {
        if (e.key === "Escape") {
          if (this.dialogOpen()) return;
          this.clearSelection();
          return;
        }
        if (
          /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) ||
          this.dialogOpen() ||
          e.ctrlKey ||
          e.metaKey ||
          e.altKey ||
          !this.ready
        )
          return;
        const key = e.key.toLowerCase();
        if (e.code === "Space" && e.target.tagName !== "BUTTON") {
          e.preventDefault();
          this.togglePause();
        } else if (key === "u") this.undo();
        else if (key === "d") this.setMode("drop");
        else if (key === "m") this.setMode("move");
        else if (e.key === "?" || key === "h") this.openDialog("help-dialog");
        else if (e.key === "0") this.view.fit();
      });
      on(window, "beforeunload", () => this.save());
      on(document, "visibilitychange", () => {
        if (document.hidden) {
          this.clearBot();
          this.save();
        } else this.scheduleBot();
      });
    }

    destroy() {
      this.destroyed = true;
      this.ready = false;
      this.clearBot();
      clearTimeout(this.toastTimer);
      this.save();
      if (this.view) this.view.destroy();
      if ($("toast")) $("toast").hidden = true;
      all("dialog").forEach((dialog) => {
        if (dialog.open) dialog.close();
      });
    }
  }

  // mode.js starts this app when the URL selects Triad Dominion.
  const app = {
    controller: null,
    abort: null,
    start() {
      if (this.controller) return;
      this.abort = new AbortController();
      activeSignal = this.abort.signal;
      this.controller = new DominionController();
      // Small console API for inspecting a match.
      window.TriadDominion = this.controller;
      this.controller.init();
    },
    stop() {
      if (!this.controller) return;
      const controller = this.controller;
      this.controller = null;
      if (this.abort) {
        this.abort.abort();
        this.abort = null;
      }
      activeSignal = null;
      window.TriadDominion = null;
      controller.destroy();
    },
  };
  window.HexDominionApp = app;
})();
