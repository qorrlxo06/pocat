import { form, modal, sortOrder, categoryFilters, mismatchToggle, interestDisclosureToggle, optionalConditionsToggle, resultSummary, sourceResultSummary, emptyState, sourceStatusMessage, welfareCacheMessage, formErrorSummary, resultsContent, mismatchContent, setOfficialMoreExpanded, submitButton, resultsSection, submitButtonContent, additionalInterests, optionalConditionsContent, programList, mismatchProgramList } from './render.js';
import { evaluateRelatedProgram, buildPolicyEvidenceContext, buildPreparationChecklist } from './fitEngine.js';

import { state, renderRoute, navigateToRoute, getRouteFromHash } from './state.js';
import { fetchSearchPrograms, fetchProgramAiExplanation } from './api.js';
import { buildFitAnalysis, additionalInfoQuestions } from './fitEngine.js';
import * as dom from './render.js';
import { renderProgramDetail, renderPrograms, resetProgramDetail, renderProgramCollection, updateOfficialDetailsVisibility, renderFitAnalysis, renderDetailRecommendation, renderPreparationChecklist, renderAiExplainer } from './render.js';
// Extract specific dom vars that app.js uses globally

export function parseLocalDate(dateText) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function getLocalDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// YYYY-MM-DD를 시간대로 변환하지 않고 오늘 생일이 지났는지 직접 비교합니다.
export function calculateAge(birthDate, today = new Date()) {
  const birth = parseLocalDate(birthDate);
  if (!birth || Number.isNaN(today.getTime())) return null;

  let age = today.getFullYear() - birth.year;
  const birthdayHasPassed =
    today.getMonth() + 1 > birth.month ||
    (today.getMonth() + 1 === birth.month && today.getDate() >= birth.day);

  if (!birthdayHasPassed) age -= 1;
  return age;
}


export function formatBirthDate(birthDate) {
  const birth = parseLocalDate(birthDate);
  if (!birth) return "";
  return `${birth.year}.${String(birth.month).padStart(2, "0")}.${String(birth.day).padStart(2, "0")}`;
}

// 폼에서 사용자가 선택한 값을 읽어 하나의 객체로 정리합니다.

export function getUserInput() {
  const selectedStatus = form.querySelector('input[name="status"]:checked');
  const selectedInterests = [...form.querySelectorAll('input[name="interest"]:checked')];
  const selectedHouseholdTypes = [...form.querySelectorAll('input[name="householdType"]:checked')];

  const birthDate = form.elements.birthDate.value;

  return {
    birthDate,
    age: calculateAge(birthDate),
    region: "서울",
    status: selectedStatus ? selectedStatus.value : "",
    interests: selectedInterests.map((input) => input.value),
    householdTypes: selectedHouseholdTypes.map((input) => input.value),
    onlineOnly: form.elements.onlineOnly.checked
  };
}


export function clearValidationMessages() {
  ["birth-date", "status", "interest"].forEach((fieldName) => {
    document.querySelector(`#${fieldName}-error`).textContent = "";
  });

  form.querySelectorAll('[aria-invalid="true"]').forEach((element) => {
    element.removeAttribute("aria-invalid");
  });

  formErrorSummary.hidden = true;
  formErrorSummary.textContent = "";
}


export function setFieldError(fieldName, message) {
  document.querySelector(`#${fieldName}-error`).textContent = message;

  if (fieldName === "birth-date") {
    form.elements.birthDate.setAttribute("aria-invalid", "true");
  }
}

// 필수값과 생년월일을 확인하고, 문제가 있으면 입력 위치에 안내합니다.

export function validateUserInput(userInput) {
  clearValidationMessages();
  const errors = [];
  const birthDate = form.elements.birthDate.value.trim();
  const birth = parseLocalDate(birthDate);
  const todayText = getLocalDateInputValue();

  if (birthDate === "") {
    errors.push({ field: "birth-date", message: "생년월일을 입력해 주세요." });
  } else if (!birth || !Number.isInteger(userInput.age)) {
    errors.push({ field: "birth-date", message: "올바른 생년월일을 입력해 주세요." });
  } else if (birthDate > todayText) {
    errors.push({ field: "birth-date", message: "미래 날짜는 생년월일로 사용할 수 없습니다." });
  }

  if (!userInput.status) {
    errors.push({ field: "status", message: "현재 상태를 선택해 주세요." });
  }

  if (userInput.interests.length === 0) {
    errors.push({ field: "interest", message: "관심 분야를 1개 이상 선택해 주세요." });
  } else if (userInput.interests.length > 5) {
    errors.push({ field: "interest", message: "관심 분야는 최대 5개까지 선택할 수 있어요." });
  }

  errors.forEach((error) => setFieldError(error.field, error.message));

  if (errors.length > 0) {
    formErrorSummary.textContent = `입력 내용을 확인해 주세요. (${errors.length}개 항목)`;
    formErrorSummary.hidden = false;
    formErrorSummary.focus();
    return false;
  }

  return true;
}

// 1. 사용자의 나이가 사업의 연령 범위에 포함되는지 확인합니다.

export function formatCachedAt(cachedAt) {
  if (typeof cachedAt !== "string" || !cachedAt.trim()) return null;
  const date = new Date(cachedAt);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}.${values.month}.${values.day} ${values.hour}:${values.minute}`;
}

// 실제 목록의 관심주제와 대상 유형만 사용해 관련도를 계산합니다.

export function findPrograms(userInput, programs) {
  return programs.map((program) => program.source === "SH"
    ? { program, source: "SH" }
    : evaluateRelatedProgram(userInput, program));
}


export function sortPrograms(programs, sortType) {
  const copiedPrograms = [...programs];

  if (sortType === "name") {
    return copiedPrograms.sort((a, b) => a.program.title.localeCompare(b.program.title, "ko"));
  }

  return copiedPrograms.sort((a, b) => {
    const scoreA = Number.isFinite(a.relatedScore) ? a.relatedScore : -1;
    const scoreB = Number.isFinite(b.relatedScore) ? b.relatedScore : -1;
    return scoreB - scoreA;
  });
}


export function getPublishedDateValue(value) {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return digits.length === 8 ? Number(digits) : null;
}

// SH 공고에는 관련도 점수를 만들지 않고, 확인 가능한 등록일만 최신순으로 사용합니다.

export function sortShPrograms(programs) {
  return programs
    .map((evaluation, index) => ({ evaluation, index }))
    .sort((a, b) => {
      const dateA = getPublishedDateValue(a.evaluation.program.publishedAt);
      const dateB = getPublishedDateValue(b.evaluation.program.publishedAt);
      if (dateA === null || dateB === null || dateA === dateB) return a.index - b.index;
      return dateB - dateA;
    })
    .map(({ evaluation }) => evaluation);
}


export function filterProgramsByCategory(programs, category) {
  if (category === "전체") return programs;
  return programs.filter((evaluation) => evaluation.program.category === category);
}


export function updateActiveFilter(selectedButton) {
  categoryFilters.querySelectorAll(".filter-button").forEach((button) => {
    const isActive = button === selectedButton;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}


export function showResults(userInput, searchResult) {
  state.activeCategory = "전체";
  sortOrder.value = "score";
  updateActiveFilter(categoryFilters.querySelector('[data-category="전체"]'));
  state.searchSourceStatus = searchResult.sources;
  state.evaluatedPrograms = findPrograms(userInput, searchResult.programs);

  const counts = state.evaluatedPrograms.reduce(
    (summary, evaluation) => {
      if (evaluation.relatedLevel in summary) {
        summary[evaluation.relatedLevel] += 1;
      }
      return summary;
    },
    { veryHigh: 0, high: 0, related: 0 }
  );

  resultsContent.hidden = false;
  document.querySelector(".result-overview").hidden = state.searchSourceStatus.welfare.status !== "success";
  document.querySelector("#welfare-results .result-guide").hidden = state.searchSourceStatus.welfare.status !== "success";
  document.querySelector("#high-count").textContent = `${counts.veryHigh}개`;
  document.querySelector("#check-count").textContent = `${counts.high}개`;
  document.querySelector("#mismatch-count").textContent = `${counts.related}개`;
  document.querySelector("#total-related-count").textContent = `${counts.veryHigh + counts.high + counts.related}개`;
  [
    ["#high-count", counts.veryHigh],
    ["#check-count", counts.high],
    ["#mismatch-count", counts.related]
  ].forEach(([selector, count]) => {
    document.querySelector(selector).closest(".overview-item").hidden = count === 0;
  });
  const interestSummary = userInput.interests.length > 1
    ? `${userInput.interests[0]} 외 ${userInput.interests.length - 1}개`
    : userInput.interests[0];
  resultSummary.textContent = `${formatBirthDate(userInput.birthDate)} 출생 (만 ${userInput.age}세) · ${userInput.status} · ${interestSummary}`;

  const welfareCount = state.evaluatedPrograms.filter((evaluation) => evaluation.program.source !== "SH").length;
  const shCount = state.evaluatedPrograms.filter((evaluation) => evaluation.program.source === "SH").length;
  sourceResultSummary.textContent = [
    state.searchSourceStatus.welfare.status === "success"
      ? `중앙부처 지원사업 ${welfareCount}건`
      : "중앙부처 지원사업 불러오기 실패",
    state.searchSourceStatus.sh.status === "success"
      ? `SH 주거공고 ${shCount}건`
      : state.searchSourceStatus.sh.status === "error"
        ? "SH 주거공고 불러오기 실패"
        : ""
  ].filter(Boolean).join(" · ");

  if (state.searchSourceStatus.welfare.status === "error") {
    sourceStatusMessage.textContent = "중앙부처 복지서비스는 현재 불러오지 못했습니다. SH 주거공고 결과를 표시합니다.";
    sourceStatusMessage.hidden = false;
  } else if (state.searchSourceStatus.sh.status === "error") {
    sourceStatusMessage.textContent = "SH 주거공고를 현재 불러오지 못했습니다. 중앙부처 지원사업 결과를 표시합니다.";
    sourceStatusMessage.hidden = false;
  } else {
    sourceStatusMessage.textContent = "";
    sourceStatusMessage.hidden = true;
  }

  const welfareMeta = state.searchSourceStatus.welfare.meta;
  const usesWelfareCache =
    state.searchSourceStatus.welfare.status === "success" &&
    welfareMeta?.dataSource === "cache" &&
    welfareMeta?.isStale === true;

  if (usesWelfareCache) {
    const formattedCachedAt = formatCachedAt(welfareMeta.cachedAt);
    welfareCacheMessage.textContent = [
      "현재 공공데이터 연결이 지연되고 있어 마지막으로 정상 저장된 지원사업 정보를 표시하고 있습니다.",
      formattedCachedAt ? `저장 시각: ${formattedCachedAt}` : ""
    ].filter(Boolean).join(" ");
    welfareCacheMessage.hidden = false;
  } else {
    welfareCacheMessage.textContent = "";
    welfareCacheMessage.hidden = true;
  }

  mismatchToggle.setAttribute("aria-expanded", "false");
  mismatchContent.hidden = true;
  renderPrograms();

  // 상세 Fit 분석에서 사용할 수 있도록 마지막으로 성공한 검색 Persona만 보존합니다.
  state.currentPersona = {
    ...userInput,
    interests: [...userInput.interests],
    householdTypes: [...userInput.householdTypes],
    additionalInfo: state.currentPersona?.additionalInfo ?? {
      housingStatus: null,
      maritalStatus: null,
      enrollmentStatus: null
    }
  };

}


export function moveToForm() {
  navigateToRoute("search");
}


export function updatePreparationProgress(actions, checkedActions) {
  const summary = document.querySelector("#modal-preparation-summary");
  const count = document.querySelector("#modal-preparation-count");
  const completeMessage = document.querySelector("#modal-preparation-complete");

  if (actions.length === 0) {
    summary.hidden = true;
    completeMessage.hidden = true;
    count.textContent = "";
    return;
  }

  const checkedCount = actions.filter((action) => checkedActions.has(action.id)).length;
  count.textContent = `확인한 항목 ${checkedCount} / ${actions.length}`;
  completeMessage.hidden = checkedCount !== actions.length;
  summary.hidden = false;
}


export function moveToModalTarget(targetId) {
  const target = document.querySelector(`#${targetId}`);
  if (!target || target.hidden) return;

  let parentDisclosure = target.closest("details");
  while (parentDisclosure) {
    parentDisclosure.open = true;
    parentDisclosure = parentDisclosure.parentElement?.closest("details");
  }

  if (target.closest("#modal-official-more-content")) {
    setOfficialMoreExpanded(true);
  }
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  target.classList.add("modal-target-highlight");
  window.setTimeout(() => target.classList.remove("modal-target-highlight"), 1200);
}


export function rerenderCurrentFitAnalysis() {
  if (!state.currentPersona || !state.selectedEvaluation || !state.currentDetailProgram) return;

  const fitAnalysis = buildFitAnalysis(
    state.currentPersona,
    state.selectedEvaluation.program,
    state.currentDetailProgram
  );
  state.currentPolicyEvidenceContext = buildPolicyEvidenceContext(
    state.selectedEvaluation,
    fitAnalysis,
    state.currentPersona,
    state.currentDetailProgram
  );
  renderDetailRecommendation(state.currentPolicyEvidenceContext);
  renderFitAnalysis(state.currentPolicyEvidenceContext);
  const actions = buildPreparationChecklist(fitAnalysis, state.currentDetailProgram);
  renderPreparationChecklist(state.selectedEvaluation.program.id, actions);
}



let aiExplainerAbortController = null;

async function requestAiExplainer(program, fitAnalysis) {
  if (aiExplainerAbortController) {
    aiExplainerAbortController.abort();
  }
  
  if (!fitAnalysis) {
    if (dom.aiExplainerSection) dom.aiExplainerSection.hidden = true;
    return;
  }
  
  aiExplainerAbortController = new AbortController();
  
  if (dom.aiExplainerSection) dom.aiExplainerSection.hidden = false;
  if (dom.aiExplainerSkeleton) dom.aiExplainerSkeleton.hidden = false;
  if (dom.aiExplainerResult) dom.aiExplainerResult.hidden = true;
  
  try {
    const payload = {
      persona: state.currentPersona,
      fitAnalysis: fitAnalysis,
      evidenceSnippets: state.currentPolicyEvidenceContext?.evidenceSnippets || [],
      programTitle: program.title
    };
    
    const explanation = await fetchProgramAiExplanation(program.id, payload, aiExplainerAbortController.signal);
    renderAiExplainer(explanation);
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error("[AI Explainer 에러]", error);
    renderAiExplainer({
      summary: "일시적인 오류로 AI 요약을 불러오지 못했습니다.",
      eligibilityTip: "하단의 상세 자격 조건을 통해 직접 확인해 주세요.",
      checklistTip: "공식 공고문의 유의사항을 꼼꼼히 읽어보시길 권장합니다."
    });
  }
}

export async function loadProgramDetail(programId) {
  if (state.detailRequestInProgress) return;

  const routeEvaluation = state.evaluatedPrograms.find((evaluation) => evaluation.program.id === programId) ?? null;
  if (routeEvaluation) state.selectedEvaluation = routeEvaluation;
  const hasRecommendationContext = Boolean(state.currentPersona && state.selectedEvaluation?.program.id === programId);
  const program = hasRecommendationContext
    ? state.selectedEvaluation.program
    : { id: programId, title: "사업 상세정보", ministry: "", category: "" };
  const applyMessage = document.querySelector("#apply-message");
  state.editingAdditionalInfoKey = null;

  if (state.currentDetailProgram?.id === programId) {
    const fitAnalysis = hasRecommendationContext
      ? buildFitAnalysis(state.currentPersona, state.selectedEvaluation.program, state.currentDetailProgram)
      : null;
    renderProgramDetail(state.currentDetailProgram, fitAnalysis);
    applyMessage.textContent = hasRecommendationContext
      ? ""
      : "추천 결과에서 이 사업을 선택하면 내 조건 비교를 함께 확인할 수 있습니다.";
        requestAiExplainer(state.currentDetailProgram, fitAnalysis);
    applyMessage.hidden = hasRecommendationContext;
    return;
  }

  state.currentDetailProgram = null;
  resetProgramDetail(program);
  applyMessage.textContent = "상세 정보를 불러오는 중...";
  applyMessage.hidden = false;

  state.detailRequestInProgress = true;
  if (state.lastModalTrigger?.isConnected) state.lastModalTrigger.disabled = true;

  try {
    const response = await fetch(`/api/welfare/${encodeURIComponent(program.id)}`);

    if (!response.ok) {
      throw new Error("WELFARE_DETAIL_API_ERROR");
    }

    const data = await response.json();

    if (!data.program || data.program.id !== program.id) {
      throw new Error("INVALID_WELFARE_DETAIL_DATA");
    }

    state.currentDetailProgram = data.program;
    const fitAnalysis = hasRecommendationContext
      ? buildFitAnalysis(state.currentPersona, state.selectedEvaluation.program, state.currentDetailProgram)
      : null;
    renderProgramDetail(data.program, fitAnalysis);
    applyMessage.textContent = hasRecommendationContext
      ? ""
      : "추천 결과에서 이 사업을 선택하면 내 조건 비교를 함께 확인할 수 있습니다.";
        requestAiExplainer(data.program, fitAnalysis);
    applyMessage.hidden = hasRecommendationContext;
  } catch (error) {
    console.error("[상세 조회 API 에러]", error);
    state.currentDetailProgram = program;
    const fitAnalysis = hasRecommendationContext
      ? buildFitAnalysis(state.currentPersona, state.selectedEvaluation.program, state.currentDetailProgram)
      : null;
    renderProgramDetail(program, fitAnalysis);
    
    applyMessage.textContent = "상세 정보 서버 연결 지연으로 기본 정보만 표시됩니다.";
    applyMessage.hidden = false;
        requestAiExplainer(program, fitAnalysis);
    applyMessage.focus();
  } finally {
    state.detailRequestInProgress = false;
    if (state.lastModalTrigger?.isConnected) state.lastModalTrigger.disabled = false;
  }
}


export function showProgramDetail(programId, detailButton) {
  state.selectedEvaluation = state.evaluatedPrograms.find((evaluation) => evaluation.program.id === programId);
  if (!state.selectedEvaluation) return;

  state.lastModalTrigger = detailButton;
  state.resultsScrollPosition = window.scrollY;
  navigateToRoute({ servId: programId });
}


export function closeProgramDetail() {
  const canReturnToResults = state.hasCompletedSearch && window.history.state?.from === "results";
  if (canReturnToResults) {
    window.history.back();
    return;
  }

  navigateToRoute(state.hasCompletedSearch ? "results" : "search");
}


export function isValidApplyUrl(url) {
  if (!url || url === "#") return false;

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch (error) {
    return false;
  }
}

// 유효한 공식 웹 주소만 새 탭에서 엽니다.

export function handleApplyButton() {
  if (!state.selectedEvaluation) return;

  const applyUrl = state.selectedEvaluation.program.applyUrl;

  if (!isValidApplyUrl(applyUrl)) {
    const applyMessage = document.querySelector("#apply-message");
    applyMessage.textContent = "공식 신청 링크가 제공되지 않았습니다. 관련 사이트와 공식 정보를 확인해 주세요.";
    applyMessage.hidden = false;
    applyMessage.focus();
    return;
  }

  window.open(applyUrl, "_blank", "noopener,noreferrer");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const userInput = getUserInput();

  if (!validateUserInput(userInput)) return;

  submitButton.disabled = true;
  submitButton.textContent = "지원사업 불러오는 중...";

  try {
    const searchResult = await fetchSearchPrograms(userInput);
    showResults(userInput, searchResult);
    state.hasCompletedSearch = true;
    navigateToRoute("results");
  } catch (error) {
    console.error("[지원핏 검색 오류]", error.message, "\nStack:", error.stack);
    resultsSection.hidden = true;
    formErrorSummary.textContent = "지원사업 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    formErrorSummary.hidden = false;
    formErrorSummary.focus();
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = submitButtonContent;
  }
});

form.addEventListener("input", () => {
  if (!formErrorSummary.hidden) clearValidationMessages();
});

interestDisclosureToggle.addEventListener("click", () => {
  const willOpen = additionalInterests.hidden;
  additionalInterests.hidden = !willOpen;
  interestDisclosureToggle.setAttribute("aria-expanded", String(willOpen));
  interestDisclosureToggle.textContent = willOpen ? "관심 분야 접기" : "관심 분야 더 보기";
});

optionalConditionsToggle.addEventListener("click", () => {
  const willOpen = optionalConditionsContent.hidden;
  optionalConditionsContent.hidden = !willOpen;
  optionalConditionsToggle.setAttribute("aria-expanded", String(willOpen));
  optionalConditionsToggle.innerHTML = `추천을 더 구체적으로 만들기 <span aria-hidden="true">${willOpen ? "−" : "＋"}</span>`;
});

categoryFilters.addEventListener("click", (event) => {
  const button = event.target.closest(".filter-button");
  if (!button) return;

  state.activeCategory = button.dataset.category;
  updateActiveFilter(button);
  renderPrograms();
});

sortOrder.addEventListener("change", renderPrograms);




export function handleProgramListClick(event) {
  const button = event.target.closest(".detail-button");
  if (!button) return;

  const programId = button.dataset.programId;
  if (!programId) return;

  state.lastModalTrigger = button;
  navigateToRoute({ name: "detail", servId: programId });
}

programList.addEventListener("click", handleProgramListClick);
dom.shProgramList.addEventListener("click", handleProgramListClick);
mismatchProgramList.addEventListener("click", handleProgramListClick);

mismatchToggle.addEventListener("click", () => {
  const willOpen = mismatchContent.hidden;
  mismatchContent.hidden = !willOpen;
  mismatchToggle.setAttribute("aria-expanded", String(willOpen));
});

document.querySelector("#modal-fit-section").addEventListener("click", (event) => {
  const answerButton = event.target.closest("[data-fit-answer-key]");
  const editButton = event.target.closest("[data-fit-edit]");

  if (answerButton && state.currentPersona) {
    const key = answerButton.dataset.fitAnswerKey;
    const value = answerButton.dataset.fitAnswerValue;
    const question = additionalInfoQuestions[key];
    const isValidValue = question?.options.some((option) => option.value === value);
    if (!isValidValue) return;

    state.currentPersona.additionalInfo[key] = value;
    state.editingAdditionalInfoKey = null;
    rerenderCurrentFitAnalysis();
    return;
  }

  if (editButton) {
    state.editingAdditionalInfoKey = editButton.dataset.fitEdit;
    rerenderCurrentFitAnalysis();
  }
});

document.querySelector("#modal-close").addEventListener("click", closeProgramDetail);
document.querySelector("#detail-back").addEventListener("click", closeProgramDetail);
document.querySelector("#modal-official-toggle").addEventListener("click", () => {
  const isExpanded = document.querySelector("#modal-official-toggle").getAttribute("aria-expanded") === "true";
  setOfficialMoreExpanded(!isExpanded);
});
document.querySelector("#apply-button").addEventListener("click", handleApplyButton);
document.querySelector("#retry-button").addEventListener("click", moveToForm);
document.querySelector("#edit-conditions-button").addEventListener("click", moveToForm);

modal.addEventListener("click", (event) => {
  if (event.target === modal) closeProgramDetail();
});

modal.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeProgramDetail();
});

modal.addEventListener("close", () => {
  document.body.classList.remove("modal-open");
});

window.addEventListener("popstate", () => renderRoute({ focus: true }));
window.addEventListener("hashchange", () => renderRoute({ focus: true }));
form.elements.birthDate.max = getLocalDateInputValue();
renderRoute();

