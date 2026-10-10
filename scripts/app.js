/* HEX — a no-build, local-first PixiJS game. */
(function () {
  "use strict";

  const R = window.HexRules;
  const $ = (id) => document.getElementById(id);
  const all = (selector) => [...document.querySelectorAll(selector)];
  const STORAGE_KEY = "hex-checkers-v1";
  const UNIT = 24;
  const SQRT3 = Math.sqrt(3);
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

  class BoardView {
    constructor(controller) {
      this.controller = controller;
      this.host = $("board-host");
      this.zoom = 1;
      this.pan = { x: 0, y: 0 };
      this.hover = null;
      this.keyboardCell = null;
      this.graphics = new Map();
      this.tweens = [];
      this.pointers = new Map();
      this.paintCells = new Set();
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
      this.app.canvas.setAttribute("aria-hidden", "true");
      this.host.appendChild(this.app.canvas);
      this.root = new PIXI.Container();
      this.root.eventMode = "none";
      this.tiles = new PIXI.Graphics();
      this.highlights = new PIXI.Graphics();
      this.pieceLayer = new PIXI.Container();
      this.ghost = new PIXI.Graphics();
      this.root.addChild(
        this.tiles,
        this.highlights,
        this.pieceLayer,
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
      this.updateHighlights();
      $("loading").hidden = true;
    }

    drawHex(graphic, cell, color, alpha = 1) {
      const p = position(cell.q, cell.r);
      const points = HEX_POINTS.map((n, i) => n + (i % 2 ? p.y : p.x));
      graphic.poly(points).fill({ color, alpha });
    }

    drawTiles() {
      this.tiles.clear();
      const shades = [0x252e36, 0x242c34, 0x263039];
      for (const cell of R.CELLS) {
        const color = cell.center
          ? 0x4c5e55
          : cell.edge
            ? 0x333e47
            : shades[(((cell.q - cell.r) % 3) + 3) % 3];
        this.drawHex(this.tiles, cell, color);
      }
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
      // A portrait board makes the tiny hexes more legible on a phone.
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

    screenPosition(cellKey) {
      const [q, r] = R.coordinates(cellKey);
      const p = position(q, r);
      const box = this.host.getBoundingClientRect();
      const cos = Math.cos(this.rotation || 0),
        sin = Math.sin(this.rotation || 0);
      return {
        x: box.left + this.root.x + (p.x * cos - p.y * sin) * this.root.scale.x,
        y: box.top + this.root.y + (p.x * sin + p.y * cos) * this.root.scale.y,
      };
    }

    drawPawn(g, piece, alpha = 1) {
      const team = R.TEAMS[piece.team];
      g.clear();
      g.circle(0, 1.4, UNIT * 0.7).fill({ color: 0x11181e, alpha });
      g.circle(0, 0, UNIT * 0.625).fill({ color: team.dark, alpha });
      g.circle(0, 0, UNIT * 0.55).fill({ color: team.hex, alpha });
      if (piece.super)
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

    stopAnimations() {
      for (const tween of this.tweens) {
        if (tween.finish) tween.finish();
      }
      this.tweens = [];
    }

    syncPieces(outcome) {
      const source = this.controller.editing
        ? this.controller.editPieces
        : this.controller.game.pieces;
      const alive = new Set([...source.values()].map((p) => p.id));
      const animated = outcome && !this.controller.settings.reducedMotion;
      const duration = animated ? 210 : 0;
      let complete;
      const promise = new Promise((resolve) => {
        complete = resolve;
      });
      for (const [id, object] of this.graphics) {
        if (alive.has(id)) continue;
        this.graphics.delete(id);
        if (animated && outcome.captured && outcome.captured.id === id) {
          this.tweens.push({
            object,
            start: performance.now(),
            duration: 155,
            fade: true,
            finish: () => object.destroy(),
          });
        } else object.destroy();
      }
      for (const piece of source.values()) {
        let object = this.graphics.get(piece.id);
        if (!object) {
          object = new PIXI.Graphics();
          this.pieceLayer.addChild(object);
          this.graphics.set(piece.id, object);
          const p = position(piece.q, piece.r);
          object.position.set(p.x, p.y);
        }
        if (object.team !== piece.team || object.superPawn !== piece.super) {
          this.drawPawn(object, piece);
          object.team = piece.team;
          object.superPawn = piece.super;
        }
        const target = position(piece.q, piece.r);
        object.alpha = 1;
        const selected = R.key(piece.q, piece.r) === this.controller.selected;
        object.scale.set(selected ? 1.08 : 1);
        if (animated && outcome.pieceId === piece.id) {
          const start = position(...R.coordinates(outcome.from));
          object.position.set(start.x, start.y);
          this.tweens.push({
            object,
            start: performance.now(),
            duration,
            from: start,
            to: target,
            promoted: outcome.promoted,
            finalScale: selected ? 1.08 : 1,
            finish: complete,
          });
        } else object.position.set(target.x, target.y);
      }
      this.updateHighlights();
      if (!animated) complete();
      return promise;
    }

    tick() {
      if (!this.tweens.length) return;
      const now = performance.now();
      for (let i = this.tweens.length - 1; i >= 0; i--) {
        const tween = this.tweens[i];
        const t = clamp((now - tween.start) / tween.duration, 0, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        if (tween.fade) {
          tween.object.alpha = 1 - t;
          tween.object.scale.set(1 - t * 0.35);
        } else {
          tween.object.position.set(
            tween.from.x + (tween.to.x - tween.from.x) * ease,
            tween.from.y + (tween.to.y - tween.from.y) * ease,
          );
          const pulse = tween.promoted ? Math.sin(t * Math.PI) * 0.22 : 0;
          tween.object.scale.set(tween.finalScale + pulse);
        }
        if (t === 1) {
          this.tweens.splice(i, 1);
          if (tween.finish) tween.finish();
        }
      }
    }

    updateHighlights() {
      if (!this.highlights) return;
      const c = this.controller;
      this.highlights.clear();
      this.ghost.clear();
      const draw = (cellKey, color, alpha) => {
        if (!cellKey) return;
        const [q, r] = R.coordinates(cellKey);
        this.drawHex(this.highlights, { q, r }, color, alpha);
      };
      if (this.hover) draw(this.hover, 0x54616b, c.editing ? 0.5 : 0.32);
      if (this.keyboardCell) draw(this.keyboardCell, 0x667a82, 0.6);
      if (c.editing) {
        if (this.hover && c.brush !== "erase") {
          const [q, r] = R.coordinates(this.hover);
          const p = position(q, r);
          this.drawPawn(
            this.ghost,
            { team: c.brush, super: c.superBrush },
            0.5,
          );
          this.ghost.position.set(p.x, p.y);
        }
      } else if (!c.game.ended) {
        const team = R.TEAMS[c.game.activeTeam];
        const legal = c.game.legalMoves();
        if (c.selected) {
          draw(c.selected, team.dark, 0.8);
          for (const move of legal.filter((m) => m.from === c.selected)) {
            const [q, r] = R.coordinates(move.to);
            const p = position(q, r);
            draw(move.to, team.dark, 0.3);
            if (R.isPromotion(q, r) && !c.game.pieces.get(move.from).super)
              this.highlights
                .poly(starPoints(p.x, p.y, 5, 1.8))
                .fill({ color: team.hex, alpha: 0.9 });
            else
              this.highlights
                .circle(p.x, p.y, move.capture ? 4.2 : 3.2)
                .fill({ color: team.hex, alpha: move.capture ? 0.95 : 0.7 });
          }
        } else if (
          legal[0] &&
          legal[0].capture &&
          c.settings.controllers[c.game.activeTeam] === "human"
        ) {
          for (const cell of new Set(legal.map((m) => m.from)))
            draw(cell, team.dark, 0.48);
        }
      }
      this.updateCursor();
    }

    updateCursor() {
      if (!this.app) return;
      if (this.controller.editing) this.app.canvas.style.cursor = "crosshair";
      else if (this.controller.canHumanPlay() && this.hover) {
        const piece = this.controller.game.pieces.get(this.hover);
        const movable = piece && piece.team === this.controller.game.activeTeam;
        const destination =
          this.controller.selected &&
          this.controller.game
            .legalMoves()
            .some(
              (m) => m.from === this.controller.selected && m.to === this.hover,
            );
        this.app.canvas.style.cursor =
          movable || destination
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
      canvas.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 && e.button !== 1) return;
        this.host.focus({ preventScroll: true });
        const p = local(e);
        const entry = {
          ...p,
          startX: p.x,
          startY: p.y,
          moved: false,
          button: e.button,
          paint:
            this.controller.editing &&
            e.button === 0 &&
            !e.altKey &&
            e.pointerType === "mouse",
        };
        this.pointers.set(e.pointerId, entry);
        canvas.setPointerCapture(e.pointerId);
        if (this.pointers.size === 2) {
          const points = [...this.pointers.values()];
          points.forEach((point) => {
            point.moved = true;
            point.paint = false;
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
        } else if (entry.paint) {
          this.paintCells.clear();
          const cell = this.cellAt(p.x, p.y);
          if (cell) {
            this.paintCells.add(cell);
            this.controller.paint(cell);
          }
        }
      });
      canvas.addEventListener("pointermove", (e) => {
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
          if (pressed.paint) {
            const cell = this.cellAt(p.x, p.y);
            if (cell && !this.paintCells.has(cell)) {
              this.paintCells.add(cell);
              this.controller.paint(cell);
            }
          } else if (
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
        if (!canceled && !entry.moved && !entry.paint && entry.button === 0) {
          const cell = this.cellAt(p.x, p.y);
          if (cell) this.controller.click(cell);
        }
        this.pointers.delete(e.pointerId);
        if (canvas.hasPointerCapture(e.pointerId))
          canvas.releasePointerCapture(e.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
        this.updateCursor();
      };
      canvas.addEventListener("pointerup", (e) => finish(e, false));
      canvas.addEventListener("pointercancel", (e) => finish(e, true));
      canvas.addEventListener("pointerleave", () => {
        if (!this.pointers.size) {
          this.hover = null;
          this.updateHighlights();
        }
      });
      canvas.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const p = local(e),
          cell = this.cellAt(p.x, p.y);
        if (cell && this.controller.editing) this.controller.paint(cell, true);
        else this.controller.clearSelection();
      });
      canvas.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          this.setZoom(
            this.zoom * Math.exp(-clamp(e.deltaY, -150, 150) * 0.002),
            local(e),
          );
        },
        { passive: false },
      );
      canvas.addEventListener("dblclick", (e) => {
        if (e.altKey) this.fit();
      });
      this.host.addEventListener("keydown", (e) => {
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
          const piece = (
            this.controller.editing
              ? this.controller.editPieces
              : this.controller.game.pieces
          ).get(this.keyboardCell);
          $("live-status").textContent =
            `Hex ${this.keyboardCell}. ${piece ? R.TEAMS[piece.team].name + (piece.super ? " superpawn" : " pawn") : "Empty"}.`;
        } else if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          this.controller.click(
            this.keyboardCell || this.controller.selected || "0,0",
          );
        }
      });
      this.host.addEventListener("blur", () => {
        this.keyboardCell = null;
        this.updateHighlights();
      });
    }
  }

  class GameController {
    constructor() {
      this.settings = {
        controllers: ["human", "bot", "bot"],
        pace: "relaxed",
        sound: false,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches,
      };
      this.game = new R.Game();
      this.history = [];
      this.custom = null;
      this.selected = null;
      this.paused = false;
      this.busy = false;
      this.ready = false;
      this.panel = null;
      this.editing = false;
      this.brush = 0;
      this.superBrush = false;
      this.editId = 0;
      this.newSetup = "classic";
      this.load();
      this.view = new BoardView(this);
      this.bindUI();
      this.updateUI();
    }

    async init() {
      try {
        await this.view.init();
        this.ready = true;
        if (this.game.chainId)
          this.selected =
            [...this.game.pieces.entries()].find(
              ([, p]) => p.id === this.game.chainId,
            )?.[0] || null;
        this.updateUI();
        this.view.syncPieces();
        this.scheduleBot();
      } catch (error) {
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
            saved.settings.controllers.every(
              (c) => c === "human" || c === "bot",
            )
          )
            this.settings.controllers = saved.settings.controllers;
          if (["quick", "relaxed"].includes(saved.settings.pace))
            this.settings.pace = saved.settings.pace;
          this.settings.sound = saved.settings.sound === true;
          this.settings.reducedMotion =
            saved.settings.reducedMotion === true ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        }
        if (saved.custom) {
          this.custom = {
            pieces: R.validateSetup(saved.custom.pieces),
            startingTeam: [0, 1, 2].includes(saved.custom.startingTeam)
              ? saved.custom.startingTeam
              : 0,
          };
        }
        if (saved.game) this.game = R.Game.fromJSON(saved.game);
        this.paused = saved.paused === true;
        if (Array.isArray(saved.history)) {
          this.history = saved.history.slice(-40).filter((h) => {
            try {
              R.Game.fromJSON(h.state);
              return true;
            } catch (_) {
              return false;
            }
          });
        }
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
            custom: this.custom,
            history: this.history.slice(-40),
            paused: this.paused,
          }),
        );
      } catch (_) {
        /* The game remains fully playable without browser storage. */
      }
    }

    canHumanPlay() {
      return (
        this.ready &&
        !this.busy &&
        !this.editing &&
        !this.game.ended &&
        this.settings.controllers[this.game.activeTeam] === "human"
      );
    }

    dialogOpen() {
      return all("dialog").some((d) => d.open);
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
        this.editing ||
        this.panel ||
        this.paused ||
        this.game.ended ||
        this.dialogOpen() ||
        document.hidden ||
        this.settings.controllers[this.game.activeTeam] !== "bot"
      )
        return;
      const delay =
        this.settings.pace === "quick"
          ? this.game.chainId
            ? 240
            : 430
          : this.game.chainId
            ? 500
            : 1000;
      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        if (
          this.busy ||
          this.paused ||
          this.panel ||
          this.dialogOpen() ||
          this.editing ||
          this.game.ended ||
          this.settings.controllers[this.game.activeTeam] !== "bot"
        )
          return;
        const move = R.chooseBotMove(this.game);
        if (move) this.performMove(move.from, move.to, false);
      }, delay);
    }

    click(cell) {
      if (!this.ready) return;
      if (this.editing) {
        this.paint(cell);
        return;
      }
      if (this.busy || this.game.ended) return;
      if (!this.canHumanPlay()) {
        if (this.paused) this.toast("Bots are paused. Press Space to resume.");
        else
          this.toast(
            `Let ${R.TEAMS[this.game.activeTeam].name} think, or switch its controller to Human.`,
          );
        return;
      }
      const legal = this.game.legalMoves();
      if (
        this.selected &&
        legal.some((m) => m.from === this.selected && m.to === cell)
      ) {
        this.performMove(this.selected, cell, true);
        return;
      }
      const piece = this.game.pieces.get(cell);
      if (piece && piece.team === this.game.activeTeam) {
        if (this.game.chainId && piece.id !== this.game.chainId) {
          this.toast("Finish the jump chain with the same pawn.");
          return;
        }
        if (!legal.some((m) => m.from === cell)) {
          this.toast(
            legal[0]?.capture
              ? "A capture is available. Choose a pawn that can jump."
              : "This pawn has no open moves.",
          );
          return;
        }
        this.selected =
          this.selected === cell && !this.game.chainId ? null : cell;
        this.updateUI();
        this.view.syncPieces();
      } else if (!this.game.chainId) this.clearSelection();
    }

    clearSelection() {
      if (this.game.chainId || this.busy) return;
      this.selected = null;
      this.updateUI();
      if (this.ready) this.view.syncPieces();
    }

    async performMove(from, to, human) {
      if (this.busy) return;
      this.clearBot();
      this.busy = true;
      try {
        if (!this.game.chainId)
          this.history.push({
            state: this.game.toJSON(),
            human,
            team: this.game.activeTeam,
          });
        if (this.history.length > 40) this.history.shift();
        const outcome = this.game.move(from, to);
        this.selected = outcome.chain ? to : null;
        this.playSound(
          outcome.promoted ? "upgrade" : outcome.capture ? "capture" : "move",
        );
        this.updateUI();
        this.save();
        $("live-status").textContent =
          `${R.TEAMS[outcome.team].name} ${outcome.capture ? "captured a pawn" : "moved"}${outcome.promoted ? " and became a superpawn" : ""}. ${outcome.chain ? "Another jump is required." : R.TEAMS[this.game.activeTeam].name + " to move."}`;
        await this.view.syncPieces(outcome);
        this.busy = false;
        if (outcome.promoted)
          this.toast(`${R.TEAMS[outcome.team].name} unlocked a superpawn.`);
        else if (outcome.skipped.length && !outcome.ended) {
          const aliveSkipped = outcome.skipped.filter(
            (t) => this.game.counts[t],
          );
          if (aliveSkipped.length)
            this.toast(
              `${aliveSkipped.map((t) => R.TEAMS[t].name).join(" & ")} has no legal moves. Turn skipped.`,
            );
        }
        this.updateUI();
        if (this.game.ended) this.showWinner();
        else this.scheduleBot();
      } catch (error) {
        this.busy = false;
        console.error(error);
        this.toast(error.message || "That move could not be completed.");
        this.updateUI();
      }
    }

    updateUI() {
      const game = this.game;
      const team = R.TEAMS[game.activeTeam];
      const counts = this.editing ? this.editCounts() : game.counts;
      const human = this.settings.controllers[game.activeTeam] === "human";
      $("turn-dot").style.background = this.editing
        ? R.TEAMS[typeof this.brush === "number" ? this.brush : 0].color
        : team.color;
      $("turn-label").textContent = this.editing
        ? "BOARD EDITOR"
        : game.ended
          ? "MATCH COMPLETE"
          : `${team.name.toUpperCase()}'S TURN`;
      $("chain-badge").hidden = this.editing || !game.chainId;
      let title, description;
      if (this.editing) {
        title = "Your arena.";
        description = "Paint your starting positions.";
      } else if (game.ended) {
        title = game.winner === null ? "A standstill." : `${team.name} wins.`;
        description =
          game.winner === null
            ? "No side has a legal move."
            : "The last color standing.";
      } else if (game.chainId && human) {
        title = "Keep jumping.";
        description = "One pawn. One more capture.";
      } else if (!human && this.paused) {
        title = "Taking a breath.";
        description = `${team.name}'s bot is paused.`;
      } else if (!human && (this.panel || this.dialogOpen())) {
        title = `${team.name} is waiting.`;
        description = "Close the panel to continue.";
      } else if (!human) {
        title = `${team.name} is thinking.`;
        description = "A little calculation. A little instinct.";
      } else if (this.selected) {
        title = "Make your move.";
        description = "Choose a highlighted hex.";
      } else if (game.legalMoves()[0]?.capture) {
        title = "Take the jump.";
        description = "A capture is available. It is your move.";
      } else {
        title = "Your move.";
        description = `Select a ${team.name.toLowerCase()} pawn to begin.`;
      }
      $("status-title").textContent = title;
      $("status-description").textContent = description;
      $("move-number").textContent = String(game.turn).padStart(2, "0");
      const humans = this.settings.controllers.filter(
        (c) => c === "human",
      ).length;
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
        card.classList.toggle("active", !this.editing && game.activeTeam === i);
        card.classList.toggle("eliminated", !counts[i]);
        $(`count-${i}`).textContent = counts[i];
        const button = card.querySelector(".seat-type");
        const bot = this.settings.controllers[i] === "bot";
        button
          .querySelector("use")
          .setAttribute("href", bot ? "#i-bot" : "#i-human");
        button.querySelector("span").textContent = bot ? "Bot" : "Human";
        button.title = `Switch ${t.name} to ${bot ? "human" : "bot"}`;
        button.setAttribute(
          "aria-label",
          `${t.name}: ${bot ? "bot" : "human"} controlled. Switch to ${bot ? "human" : "bot"}.`,
        );
        $(`controller-${i}`).value = this.settings.controllers[i];
        const supers = !this.editing ? game.superCounts[i] : 0;
        card.title = `${t.name}: ${counts[i]} pawns${supers ? `, including ${supers} superpawn${supers > 1 ? "s" : ""}` : ""}`;
      });
      $("undo-button").disabled =
        !this.history.length || this.busy || this.editing;
      $("pause-button").classList.toggle("is-active", this.paused);
      $("pause-icon")
        .querySelector("use")
        .setAttribute("href", this.paused ? "#i-play" : "#i-pause");
      $("pause-button").title =
        `${this.paused ? "Resume" : "Pause"} bots (Space)`;
      $("pause-button").setAttribute(
        "aria-label",
        `${this.paused ? "Resume" : "Pause"} bots`,
      );
      $("pause-button").setAttribute("aria-pressed", String(this.paused));
      $("settings-button").classList.toggle(
        "is-active",
        this.panel === "settings",
      );
      $("settings-button").setAttribute(
        "aria-expanded",
        String(this.panel === "settings"),
      );
      $("edit-button").classList.toggle("is-active", this.editing);
      $("sound-toggle").checked = this.settings.sound;
      $("motion-toggle").checked = this.settings.reducedMotion;
      all("[data-pace]").forEach((b) => {
        b.classList.toggle("selected", b.dataset.pace === this.settings.pace);
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.pace === this.settings.pace),
        );
      });
      if (this.ready) this.view.updateHighlights();
    }

    setController(team, value) {
      this.settings.controllers[team] = value;
      if (team === this.game.activeTeam && !this.game.chainId)
        this.selected = null;
      this.updateUI();
      if (this.ready && !this.busy) this.view.syncPieces();
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
          ? "Bots paused. Human players can still move."
          : "Bots are back in play.",
      );
    }

    undo() {
      if (this.busy || this.editing || !this.history.length) return;
      this.clearBot();
      let index = this.history.length - 1;
      for (let i = this.history.length - 1; i >= 0; i--)
        if (this.history[i].human) {
          index = i;
          break;
        }
      const snapshot = this.history[index];
      this.history.splice(index);
      this.game = R.Game.fromJSON(snapshot.state);
      this.selected = null;
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

    openPanel(mode) {
      if (this.busy || !this.ready) {
        if (this.busy) this.toast("Let this move finish first.");
        return;
      }
      if (this.panel === mode) {
        this.closePanel();
        return;
      }
      if (this.editing) this.closePanel();
      this.clearBot();
      clearTimeout(this.toastTimer);
      $("toast").hidden = true;
      this.panel = mode;
      this.editing = mode === "editor";
      $("side-panel").hidden = false;
      $("settings-content").hidden = this.editing;
      $("editor-content").hidden = !this.editing;
      $("panel-title").textContent = this.editing
        ? "Build your board"
        : "Game settings";
      $("panel-kicker").textContent = this.editing
        ? "NO TWO GAMES ALIKE"
        : "MAKE IT YOURS";
      $("app").classList.add("panel-open");
      $("app").classList.toggle("editing", this.editing);
      document.body.classList.add("panel-open");
      document.body.classList.toggle("editing", this.editing);
      if (this.editing) {
        this.selected = null;
        this.editPieces = new Map(
          [...this.game.pieces.entries()].map(([cell, p]) => [cell, { ...p }]),
        );
        this.brush = 0;
        this.superBrush = false;
        $("starting-team").value = String(this.game.activeTeam);
        this.updateEditor();
        this.view.syncPieces();
      }
      this.updateUI();
      setTimeout(() => this.view.resize(), 260);
      $("close-panel").focus({ preventScroll: true });
    }

    closePanel() {
      const wasEditing = this.editing;
      this.panel = null;
      this.editing = false;
      $("side-panel").hidden = true;
      $("app").classList.remove("panel-open", "editing");
      document.body.classList.remove("panel-open", "editing");
      if (wasEditing) {
        this.editPieces = null;
        this.view.syncPieces();
      }
      if (this.game.chainId)
        this.selected =
          [...this.game.pieces.entries()].find(
            ([, p]) => p.id === this.game.chainId,
          )?.[0] || null;
      this.updateUI();
      this.scheduleBot();
      setTimeout(() => this.view.resize(), 260);
    }

    editCounts() {
      const counts = [0, 0, 0];
      for (const p of this.editPieces.values()) counts[p.team]++;
      return counts;
    }

    updateEditor() {
      const counts = this.editCounts();
      counts.forEach((count, i) => {
        $(`editor-count-${i}`).textContent = count;
      });
      $("editor-total").textContent = `${this.editPieces.size} PAWNS`;
      all("[data-brush]").forEach((b) => {
        const selected = Number(b.dataset.brush) === this.brush;
        b.classList.toggle("selected", selected);
        b.setAttribute("aria-pressed", String(selected));
      });
      $("erase-brush").classList.toggle("selected", this.brush === "erase");
      $("erase-brush").setAttribute(
        "aria-pressed",
        String(this.brush === "erase"),
      );
      all("[data-piece]").forEach((b) => {
        const selected = (b.dataset.piece === "super") === this.superBrush;
        b.classList.toggle("selected", selected);
        b.setAttribute("aria-pressed", String(selected));
      });
      $("editor-error").hidden = true;
      this.updateUI();
    }

    paint(cell, erase = false) {
      if (!this.editing) return;
      if (erase || this.brush === "erase") this.editPieces.delete(cell);
      else {
        const [q, r] = R.coordinates(cell);
        const existing = this.editPieces.get(cell);
        this.editPieces.set(cell, {
          q,
          r,
          team: this.brush,
          super: this.superBrush,
          id: existing ? existing.id : `edit${++this.editId}`,
        });
      }
      this.updateEditor();
      this.view.syncPieces();
    }

    applyPreset(name) {
      this.editPieces = new Map(
        R.preset(name).map((p, i) => [
          R.key(p.q, p.r),
          { ...p, id: `preset${i}` },
        ]),
      );
      $("starting-team").value = "0";
      this.updateEditor();
      this.view.syncPieces();
      this.toast(
        name === "classic"
          ? "Classic corners. A clean starting point."
          : name === "orbit"
            ? "Inner orbit. A faster meeting in the middle."
            : "Scattered. Expect a few early captures.",
      );
    }

    startCustom() {
      try {
        const pieces = R.validateSetup([...this.editPieces.values()]);
        const startingTeam = Number($("starting-team").value);
        const trial = new R.Game(pieces, startingTeam);
        if (trial.ended)
          throw new Error(
            "This formation has no legal moves. Open up a few hexes.",
          );
        this.custom = {
          pieces: pieces.map(({ q, r, team, super: isSuper }) => ({
            q,
            r,
            team,
            super: isSuper,
          })),
          startingTeam,
        };
        this.closePanel();
        this.startMatch(this.custom.pieces, startingTeam);
        this.toast("Your board. Your rules of engagement.");
      } catch (error) {
        $("editor-error").textContent = error.message;
        $("editor-error").hidden = false;
        $("editor-error").scrollIntoView({ block: "nearest" });
      }
    }

    startMatch(pieces = R.standardSetup(), team = 0) {
      this.clearBot();
      this.view.stopAnimations();
      this.game = new R.Game(pieces, team);
      this.selected = null;
      this.history = [];
      this.paused = false;
      this.busy = false;
      this.view.hover = null;
      this.view.keyboardCell = null;
      this.view.fit();
      this.view.syncPieces();
      this.updateUI();
      this.save();
      this.scheduleBot();
      $("live-status").textContent =
        "New match. " + R.TEAMS[this.game.activeTeam].name + " to move.";
    }

    newGame() {
      if (this.busy) return;
      if (this.editing) this.closePanel();
      this.newSetup = this.custom ? "custom" : "classic";
      $("custom-option").disabled = !this.custom;
      $("new-game-description").textContent =
        this.game.turn > 1
          ? "Your current match will be replaced. Choose a starting formation."
          : "Choose your starting formation.";
      this.updateNewSetup();
      this.openDialog("new-game-dialog");
    }

    updateNewSetup() {
      all("[data-new-setup]").forEach((b) => {
        const selected = b.dataset.newSetup === this.newSetup;
        b.classList.toggle("selected", selected);
        b.setAttribute("aria-pressed", String(selected));
      });
    }

    showWinner() {
      const winner = this.game.winner;
      const team = winner === null ? null : R.TEAMS[winner];
      $("winner-emblem").style.background = team ? team.color : "#9aadb4";
      $("winner-title").textContent = team
        ? `${team.name} takes the board.`
        : "A perfect standstill.";
      $("winner-description").textContent = team
        ? `One color left after ${this.game.turn - 1} turns. Well played.`
        : "No side can make a legal move. This one is a draw.";
      this.openDialog("winner-dialog");
    }

    exportSetup() {
      const pieces = [...this.editPieces.values()].map(
        ({ q, r, team, super: isSuper }) => ({ q, r, team, super: isSuper }),
      );
      const data = {
        format: "hex-checkers-setup",
        version: 1,
        sideLength: R.SIDE_LENGTH,
        startingTeam: Number($("starting-team").value),
        pieces,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = "hex-checkers-setup.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.toast("Board setup exported.");
    }

    async importSetup(file) {
      if (!file) return;
      try {
        if (file.size > 200000)
          throw new Error("Choose a setup file smaller than 200 KB.");
        const data = JSON.parse(await file.text());
        if (
          !Array.isArray(data) &&
          (!data ||
            data.sideLength !== R.SIDE_LENGTH ||
            data.format !== "hex-checkers-setup" ||
            data.version !== 1)
        )
          throw new Error("Choose a HEX setup JSON exported from this game.");
        const pieces = R.validateSetup(
          Array.isArray(data) ? data : data.pieces,
          false,
        );
        this.editPieces = new Map(pieces.map((p) => [R.key(p.q, p.r), p]));
        $("starting-team").value = String(
          [0, 1, 2].includes(data.startingTeam) ? data.startingTeam : 0,
        );
        this.updateEditor();
        this.view.syncPieces();
        this.toast("Setup imported. Make it yours, then play.");
      } catch (error) {
        this.toast(
          error instanceof SyntaxError
            ? "This file is not valid JSON."
            : error.message,
        );
      }
      $("setup-file").value = "";
    }

    playSound(type) {
      if (!this.settings.sound) return;
      try {
        if (!this.audio)
          this.audio = new (window.AudioContext || window.webkitAudioContext)();
        if (this.audio.state === "suspended") this.audio.resume();
        const notes =
          type === "upgrade"
            ? [659.25, 880, 1318.5]
            : type === "capture"
              ? [330, 440]
              : [440];
        notes.forEach((note, i) => {
          const oscillator = this.audio.createOscillator();
          const gain = this.audio.createGain();
          const time = this.audio.currentTime + i * 0.06;
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(note, time);
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(0.035, time + 0.008);
          gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
          oscillator.connect(gain);
          gain.connect(this.audio.destination);
          oscillator.start(time);
          oscillator.stop(time + 0.13);
          oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
          };
        });
      } catch (_) {
        /* Audio is optional and never blocks the game. */
      }
    }

    bindUI() {
      $("brand-link").addEventListener("click", (e) => {
        e.preventDefault();
        if (this.ready) this.view.fit();
      });
      $("help-button").addEventListener("click", () =>
        this.openDialog("help-dialog"),
      );
      $("edit-button").addEventListener("click", () =>
        this.openPanel("editor"),
      );
      $("settings-button").addEventListener("click", () =>
        this.openPanel("settings"),
      );
      $("settings-edit").addEventListener("click", () =>
        this.openPanel("editor"),
      );
      $("close-panel").addEventListener("click", () => this.closePanel());
      $("cancel-edit").addEventListener("click", () => this.closePanel());
      $("undo-button").addEventListener("click", () => this.undo());
      $("pause-button").addEventListener("click", () => this.togglePause());
      $("new-game-button").addEventListener("click", () => this.newGame());
      $("zoom-in").addEventListener("click", () => {
        if (this.ready) this.view.setZoom(this.view.zoom * 1.25);
      });
      $("zoom-out").addEventListener("click", () => {
        if (this.ready) this.view.setZoom(this.view.zoom / 1.25);
      });
      $("fit-view").addEventListener("click", () => {
        if (this.ready) this.view.fit();
      });
      all(".seat-type").forEach((b) =>
        b.addEventListener("click", () => {
          const team = Number(b.dataset.team);
          this.setController(
            team,
            this.settings.controllers[team] === "human" ? "bot" : "human",
          );
        }),
      );
      for (let team = 0; team < 3; team++)
        $(`controller-${team}`).addEventListener("change", (e) =>
          this.setController(team, e.target.value),
        );
      all("[data-pace]").forEach((b) =>
        b.addEventListener("click", () => {
          this.settings.pace = b.dataset.pace;
          this.updateUI();
          this.save();
          this.scheduleBot();
        }),
      );
      $("sound-toggle").addEventListener("change", (e) => {
        this.settings.sound = e.target.checked;
        this.playSound("move");
        this.save();
      });
      $("motion-toggle").addEventListener("change", (e) => {
        this.settings.reducedMotion = e.target.checked;
        this.save();
      });
      all("[data-brush]").forEach((b) =>
        b.addEventListener("click", () => {
          this.brush = Number(b.dataset.brush);
          this.updateEditor();
        }),
      );
      all("[data-piece]").forEach((b) =>
        b.addEventListener("click", () => {
          this.superBrush = b.dataset.piece === "super";
          if (this.brush === "erase") this.brush = 0;
          this.updateEditor();
        }),
      );
      $("erase-brush").addEventListener("click", () => {
        this.brush = "erase";
        this.updateEditor();
      });
      all("[data-preset]").forEach((b) =>
        b.addEventListener("click", () => this.applyPreset(b.dataset.preset)),
      );
      $("clear-board").addEventListener("click", () => {
        this.editPieces.clear();
        this.updateEditor();
        this.view.syncPieces();
      });
      $("start-custom").addEventListener("click", () => this.startCustom());
      $("mobile-start-custom").addEventListener("click", () =>
        this.startCustom(),
      );
      $("export-setup").addEventListener("click", () => this.exportSetup());
      $("import-setup").addEventListener("click", () => {
        $("setup-file").value = "";
        $("setup-file").click();
      });
      $("setup-file").addEventListener("change", (e) =>
        this.importSetup(e.target.files[0]),
      );
      all("[data-close-dialog]").forEach((b) =>
        b.addEventListener("click", () => $(b.dataset.closeDialog).close()),
      );
      all("dialog").forEach((dialog) => {
        dialog.addEventListener("close", () => {
          this.updateUI();
          this.scheduleBot();
        });
        dialog.addEventListener("click", (e) => {
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
      all("[data-new-setup]").forEach((b) =>
        b.addEventListener("click", () => {
          this.newSetup = b.dataset.newSetup;
          this.updateNewSetup();
        }),
      );
      $("confirm-new-game").addEventListener("click", () => {
        $("new-game-dialog").close();
        if (this.panel) this.closePanel();
        const custom = this.newSetup === "custom" && this.custom;
        this.startMatch(
          custom ? custom.pieces : R.standardSetup(),
          custom ? custom.startingTeam : 0,
        );
      });
      $("play-again").addEventListener("click", () => {
        $("winner-dialog").close();
        this.startMatch(
          this.custom ? this.custom.pieces : R.standardSetup(),
          this.custom ? this.custom.startingTeam : 0,
        );
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          if (this.dialogOpen()) return;
          if (this.panel) this.closePanel();
          else this.clearSelection();
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
        if (e.code === "Space" && e.target.tagName !== "BUTTON") {
          e.preventDefault();
          this.togglePause();
        } else if (e.key.toLowerCase() === "u") this.undo();
        else if (e.key.toLowerCase() === "e") this.openPanel("editor");
        else if (e.key === "?" || e.key.toLowerCase() === "h")
          this.openDialog("help-dialog");
        else if (e.key === "0") this.view.fit();
        else if (this.editing && ["1", "2", "3"].includes(e.key)) {
          this.brush = Number(e.key) - 1;
          this.updateEditor();
        } else if (this.editing && e.key.toLowerCase() === "x") {
          this.brush = "erase";
          this.updateEditor();
        }
      });
      window.addEventListener("beforeunload", () => this.save());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          this.clearBot();
          this.save();
        } else this.scheduleBot();
      });
    }
  }

  const controller = new GameController();
  // Small, useful console API for inspecting a match or creating positions.
  window.HexCheckers = controller;
  controller.init();
})();
