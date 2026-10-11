/* HEX mode switcher: one page, two games.
   Reads ?game=dominion (or #dominion) to pick the starting mode, swaps the
   board in place when the player changes mode, and keeps the URL shareable. */
(function () {
  "use strict";

  const MODES = {
    checkers: {
      title: "HEX — Three-player hexagonal checkers",
      description:
        "Three colors. One board. A board-first, three-player hexagonal checkers game, powered by PixiJS.",
    },
    dominion: {
      title: "HEX — Triad Dominion",
      description:
        "Triad Dominion: a three-player hexagonal Reversi and checkers hybrid. Drop pieces to flip enemy lines, jump to capture, and crown kings.",
    },
  };

  const appFor = (mode) =>
    mode === "dominion" ? window.HexDominionApp : window.HexCheckersApp;

  const fromUrl = () => {
    const value = new URLSearchParams(location.search).get("game");
    const hash = location.hash.replace(/^#\/?/, "");
    return (value || hash || "").toLowerCase() === "dominion"
      ? "dominion"
      : "checkers";
  };

  let current = null;

  function enter(mode) {
    document.documentElement.dataset.mode = mode;
    document.getElementById("app").classList.toggle("dominion-shell", mode === "dominion");
    document.querySelectorAll("[data-mode-link]").forEach((link) => {
      if (link.dataset.modeLink === mode) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    document.title = MODES[mode].title;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", MODES[mode].description);
    const app = appFor(mode);
    if (app) app.start();
  }

  function switchTo(mode, push) {
    if (mode === current) return;
    const previous = appFor(current);
    if (previous) previous.stop();
    current = mode;
    enter(mode);
    if (push) {
      const url = new URL(location.href);
      if (mode === "dominion") url.searchParams.set("game", "dominion");
      else url.searchParams.delete("game");
      url.hash = "";
      history.pushState({ mode }, "", url);
    }
  }

  document.querySelectorAll("[data-mode-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      switchTo(link.dataset.modeLink, true);
    });
  });

  window.addEventListener("popstate", () => switchTo(fromUrl(), false));
  window.addEventListener("hashchange", () => switchTo(fromUrl(), false));

  switchTo(fromUrl(), false);
})();
