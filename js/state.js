import { searchView, resultsSection, modal } from './render.js';
import { loadProgramDetail } from './app.js';

export const state = {
  evaluatedPrograms: [],
  searchSourceStatus: { welfare: { status: "success" }, sh: { status: "skipped" } },
  activeCategory: "전체",
  selectedEvaluation: null,
  detailRequestInProgress: false,
  currentPersona: null,
  currentDetailProgram: null,
  editingAdditionalInfoKey: null,
  lastModalTrigger: null,
  hasCompletedSearch: false,
  lastRenderedHash: null,
  lastRenderedRoute: null,
  resultsScrollPosition: 0,
  currentPolicyEvidenceContext: null,
  preparationChecklistState: new Map()
};

export function getRouteFromHash() {
  if (window.location.hash === "#search" || window.location.hash === "") {
    return { name: "search" };
  }

  if (window.location.hash === "#results") {
    return { name: "results" };
  }

  const detailMatch = window.location.hash.match(/^#detail\/([^/?#]+)$/);
  if (detailMatch) {
    try {
      const servId = decodeURIComponent(detailMatch[1]);
      if (/^[A-Za-z0-9_-]+$/.test(servId)) return { name: "detail", servId };
    } catch {
      return { name: "invalid" };
    }
  }

  return { name: "invalid" };
}


export function renderRoute({ focus = false, force = false } = {}) {
  let route = getRouteFromHash();

  if (route.name === "invalid" || (route.name === "results" && !state.hasCompletedSearch)) {
    window.history.replaceState(null, "", "#search");
    route = { name: "search" };
  }

  if (!force && state.lastRenderedHash === window.location.hash) return;

  const previousRoute = state.lastRenderedRoute;
  state.lastRenderedHash = window.location.hash;
  state.lastRenderedRoute = route.name;
  searchView.hidden = route.name !== "search";
  resultsSection.hidden = route.name !== "results";
  document.body.dataset.view = route.name;

  if (route.name === "detail") {
    document.body.classList.add("modal-open");
    if (!modal.open) modal.showModal();
    loadProgramDetail(route.servId);
  } else {
    document.body.classList.remove("modal-open");
    if (modal.open) modal.close();
  }

  if (route.name === "results" && previousRoute === "detail") {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: state.resultsScrollPosition, behavior: "auto" });
      if (state.lastModalTrigger?.isConnected) state.lastModalTrigger.focus({ preventScroll: true });
    });
  } else {
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  if (focus) {
    window.requestAnimationFrame(() => {
      if (route.name === "detail") {
        document.querySelector("#detail-back").focus({ preventScroll: true });
      } else if (!(route.name === "results" && previousRoute === "detail")) {
        document.querySelector(route.name === "results" ? "#results-title" : "#form-title")
          .focus({ preventScroll: true });
      }
    });
  }
}


export function navigateToRoute(route) {
  const nextHash = route === "results"
    ? "#results"
    : route === "search"
      ? "#search"
      : `#detail/${encodeURIComponent(route.servId)}`;

  if (window.location.hash !== nextHash) {
    window.history.pushState(
      { jiwonfitRoute: typeof route === "string" ? route : "detail", from: state.lastRenderedRoute },
      "",
      nextHash
    );
  }

  renderRoute({ focus: true, force: true });
}


