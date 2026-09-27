import { state } from "./state.js";

import { isValidApplyUrl, filterProgramsByCategory, sortPrograms, sortShPrograms, updatePreparationProgress, moveToModalTarget } from './app.js';
import { buildPolicyEvidenceContext, additionalInfoQuestions } from './fitEngine.js';

export const aiExplainerSection = document.querySelector("#modal-ai-explainer-section");
export const aiExplainerSkeleton = document.querySelector("#ai-explainer-skeleton");
export const aiExplainerResult = document.querySelector("#ai-explainer-result");
export const aiSummaryText = document.querySelector("#ai-summary-text");
export const aiEligibilityTip = document.querySelector("#ai-eligibility-tip");
export const aiChecklistTip = document.querySelector("#ai-checklist-tip");

export const form = document.querySelector("#recommendation-form");
export const searchView = document.querySelector("#search-view");
export const resultsSection = document.querySelector("#results-section");
export const resultsContent = document.querySelector("#results-content");
export const programList = document.querySelector("#program-list");
export const shProgramList = document.querySelector("#sh-program-list");
export const resultSummary = document.querySelector("#result-summary");
export const sourceResultSummary = document.querySelector("#source-result-summary");
export const sourceStatusMessage = document.querySelector("#source-status-message");
export const welfareCacheMessage = document.querySelector("#welfare-cache-message");
export const emptyState = document.querySelector("#empty-state");
export const sortOrder = document.querySelector("#sort-order");
export const categoryFilters = document.querySelector("#category-filters");
export const formErrorSummary = document.querySelector("#form-error-summary");
export const modal = document.querySelector("#program-modal");
export const mismatchSection = document.querySelector("#mismatch-section");
export const mismatchToggle = document.querySelector("#mismatch-toggle");
export const mismatchContent = document.querySelector("#mismatch-content");
export const mismatchProgramList = document.querySelector("#mismatch-program-list");
export const interestDisclosureToggle = document.querySelector("#interest-disclosure-toggle");
export const additionalInterests = document.querySelector("#additional-interests");
export const optionalConditionsToggle = document.querySelector("#optional-conditions-toggle");
export const optionalConditionsContent = document.querySelector("#optional-conditions-content");
export const submitButton = form.querySelector('button[type="submit"]');
export const submitButtonContent = submitButton.innerHTML;

export const recommendationMeta = {
  veryHigh: { label: "관심 조건과 매우 관련 높음", icon: "✓", className: "high" },
  high: { label: "관심 조건과 관련 높음", icon: "✓", className: "check" },
  related: { label: "관심 조건과 관련 있음", icon: "•", className: "check" }
};

import { formatAgeRange, formatTargetStatuses, createAdditionalInfoFitItem, buildPreparationChecklist } from './fitEngine.js';
import { formatBirthDate, getLocalDateInputValue, calculateAge } from './app.js';
export function createReasonItem(reason) {
  const item = document.createElement("li");
  item.className = `reason-item reason-${reason.type}`;

  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = reason.type === "match" ? "✓" : reason.type === "mismatch" ? "×" : reason.type === "check" ? "!" : "•";

  const text = document.createElement("span");
  text.textContent = reason.text;
  item.append(icon, text);
  return item;
}


export function appendDocumentItems(container, requiredDocs) {
  container.replaceChildren();

  if (requiredDocs.length === 0) {
    const item = document.createElement("li");
    item.className = "document-check-item";
    item.textContent = "필요 서류 정보 확인 필요";
    container.append(item);
    return;
  }

  requiredDocs.forEach((documentName) => {
    const item = document.createElement("li");
    item.textContent = documentName;
    container.append(item);
  });
}


export function createProgramCard(evaluation) {
  if (evaluation.program.source === "SH") {
    return createShProgramCard(evaluation.program);
  }

  const { program, relatedScore, relatedLevel, reasons } = evaluation;
  const statusInfo = recommendationMeta[relatedLevel];
  const card = document.createElement("article");
  card.className = `program-card program-card--${statusInfo.className}`;
  card.dataset.programId = String(program.id);
  card.dataset.relatedLevel = relatedLevel;
  card.dataset.relatedScore = String(relatedScore);

  const top = document.createElement("div");
  top.className = "card-top";

  const badge = document.createElement("span");
  badge.className = "category-badge";
  badge.textContent = program.category;
  const sourceBadge = document.createElement("span");
  sourceBadge.className = "source-badge";
  sourceBadge.textContent = "중앙부처 복지서비스";
  top.append(badge, sourceBadge);

  const recommendationBadge = document.createElement("span");
  recommendationBadge.className = `recommendation-badge recommendation-badge--${statusInfo.className}`;
  recommendationBadge.textContent = `${statusInfo.icon} ${statusInfo.label}`;

  const title = document.createElement("h3");
  title.textContent = program.title;

  const meta = document.createElement("p");
  meta.className = "program-meta";
  const ministry = document.createElement("span");
  ministry.textContent = program.ministry || "담당 기관 확인 필요";
  const categories = document.createElement("span");
  categories.textContent = Array.isArray(program.categories) && program.categories.length > 0
    ? program.categories.join(", ")
    : "관심주제 확인 필요";
  meta.append(ministry, categories);

  const description = document.createElement("p");
  description.className = "program-description";
  description.textContent = program.description;

  const reasonBlock = document.createElement("div");
  reasonBlock.className = "card-reasons";
  const reasonTitle = document.createElement("h4");
  reasonTitle.textContent = "관련도 근거";
  const reasonList = document.createElement("ul");
  reasonList.className = "reason-list";
  // 자격 판정 관련 공통 안내는 Welfare 섹션에서 한 번만 보여주고, 카드에는 개별 근거만 표시합니다.
  const cardReasons = reasons.filter(
    (reason) => reason.text !== "이 관련도는 신청 자격 판정이 아닙니다. 상세 자격조건을 확인해 주세요."
  );
  cardReasons.forEach((reason) => reasonList.append(createReasonItem(reason)));
  reasonBlock.hidden = cardReasons.length === 0;
  reasonBlock.append(reasonTitle, reasonList);

  const detailButton = document.createElement("button");
  detailButton.className = "detail-button";
  detailButton.type = "button";
  detailButton.textContent = "조건과 준비사항 보기";
  detailButton.dataset.programId = String(program.id);
  detailButton.setAttribute("aria-label", `${program.title} 조건과 준비사항 보기`);

  card.append(top, title, meta, recommendationBadge, reasonBlock, description, detailButton);
  return card;
}


export function createShProgramCard(program) {
  const card = document.createElement("article");
  card.className = "program-card program-card--sh";
  card.dataset.programId = String(program.id);
  card.dataset.source = "SH";

  const top = document.createElement("div");
  top.className = "card-top";
  const categoryBadge = document.createElement("span");
  categoryBadge.className = "category-badge";
  categoryBadge.textContent = program.category;
  const sourceBadge = document.createElement("span");
  sourceBadge.className = "source-badge source-badge--sh";
  sourceBadge.textContent = "SH 서울주택도시개발공사";
  top.append(categoryBadge, sourceBadge);

  const title = document.createElement("h3");
  title.textContent = program.title;

  const meta = document.createElement("p");
  meta.className = "program-meta";
  [program.provider, program.department, program.publishedAt]
    .filter((value) => typeof value === "string" && value.trim())
    .forEach((value) => {
      const item = document.createElement("span");
      item.textContent = value;
      meta.append(item);
    });

  const notice = document.createElement("p");
  notice.className = "program-description";
  notice.textContent = "세부 자격조건은 공식 SH 공고에서 확인해 주세요.";

  card.append(top, title, meta, notice);

  if (isValidApplyUrl(program.detailUrl)) {
    const detailLink = document.createElement("a");
    detailLink.className = "sh-detail-link";
    detailLink.href = program.detailUrl;
    detailLink.target = "_blank";
    detailLink.rel = "noopener noreferrer";
    detailLink.textContent = "공식 공고 보기";
    detailLink.setAttribute("aria-label", `${program.title} 공식 SH 공고 보기`);
    card.append(detailLink);
  }

  return card;
}


export function renderProgramCollection(container, programs) {
  container.replaceChildren();
  const fragment = document.createDocumentFragment();
  programs.forEach((evaluation) => fragment.append(createProgramCard(evaluation)));
  container.append(fragment);
}


export function renderPrograms() {
  const filteredPrograms = filterProgramsByCategory(state.evaluatedPrograms, state.activeCategory);
  const welfarePrograms = filteredPrograms.filter((evaluation) => evaluation.program.source !== "SH");
  const shPrograms = filteredPrograms.filter((evaluation) => evaluation.program.source === "SH");
  const sortedWelfarePrograms = sortPrograms(welfarePrograms, sortOrder.value);
  const sortedShPrograms = sortShPrograms(shPrograms);
  const totalCount = sortedWelfarePrograms.length + sortedShPrograms.length;

  document.querySelector("#primary-result-count").textContent = `${sortedWelfarePrograms.length}개 사업`;
  document.querySelector("#sh-result-count").textContent = `${sortedShPrograms.length}개 공고`;
  document.querySelector("#welfare-results").hidden = state.searchSourceStatus.welfare.status !== "success";
  document.querySelector("#sh-results").hidden = state.searchSourceStatus.sh.status !== "success";

  emptyState.hidden = totalCount > 0;
  renderProgramCollection(programList, sortedWelfarePrograms);
  renderProgramCollection(shProgramList, sortedShPrograms);

  mismatchSection.hidden = true;
  mismatchProgramList.replaceChildren();
}


export function renderDetailText(sectionId, contentId, value) {
  const section = document.querySelector(`#${sectionId}`);
  const content = document.querySelector(`#${contentId}`);
  const hasValue = typeof value === "string" && value.trim() !== "";

  section.hidden = !hasValue;
  content.textContent = hasValue ? value : "";
}


export function renderDetailItems(sectionId, listId, items, valueKey) {
  const section = document.querySelector(`#${sectionId}`);
  const list = document.querySelector(`#${listId}`);
  const validItems = Array.isArray(items)
    ? items.filter((item) => item && (item.name || item[valueKey]))
    : [];

  list.replaceChildren();
  section.hidden = validItems.length === 0;

  validItems.forEach((item) => {
    const listItem = document.createElement("li");
    const name = item.name || "정보";
    const value = item[valueKey];

    if (isValidApplyUrl(value)) {
      const link = document.createElement("a");
      link.href = value;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.name || value;
      listItem.append(link);
    } else {
      listItem.textContent = value ? `${name}: ${value}` : name;
    }

    list.append(listItem);
  });
}


export function renderFitAnalysis(policyEvidenceContext) {
  const section = document.querySelector("#modal-fit-section");
  const list = document.querySelector("#modal-fit-list");
  const additionalSection = document.querySelector("#modal-additional-fit");
  const additionalList = document.querySelector("#modal-additional-fit-list");
  const emptyMessage = document.querySelector("#modal-fit-empty");
  const statusMeta = {
    match: "입력 조건과 일치",
    mismatch: "명확히 다른 조건",
    unknown: "추가 확인 필요"
  };

  list.replaceChildren();
  additionalList.replaceChildren();
  const conditionChecks = Array.isArray(policyEvidenceContext?.conditionChecks)
    ? policyEvidenceContext.conditionChecks
    : [];

  conditionChecks.forEach((item) => {
    const listItem = document.createElement("li");
    listItem.className = `fit-analysis-item fit-analysis-item--${item.status}`;

    if (item.additionalInfoKey) {
      listItem.id = `fit-condition-${item.additionalInfoKey}`;
    }

    const label = document.createElement("strong");
    label.className = "policy-condition-label";
    label.textContent = item.label;

    const userValue = document.createElement("div");
    userValue.className = "policy-condition-field policy-user-value";
    const userValueLabel = document.createElement("span");
    userValueLabel.className = "policy-field-label";
    userValueLabel.textContent = "내 정보";
    const userValueText = document.createElement("p");
    userValueText.textContent = item.userValue?.display || "아직 입력한 정보 없음";
    userValue.append(userValueLabel, userValueText);

    const judgement = document.createElement("div");
    judgement.className = "policy-condition-field policy-judgement";
    const judgementLabel = document.createElement("span");
    judgementLabel.className = "policy-field-label";
    judgementLabel.textContent = "현재 판단";
    const status = document.createElement("span");
    status.className = "fit-analysis-status";
    status.textContent = statusMeta[item.status] || "추가 확인 필요";
    judgement.append(judgementLabel, status);

    const message = document.createElement("p");
    message.className = "policy-condition-message";
    message.textContent = item.message;

    listItem.append(label, userValue, judgement);
    if (item.message) listItem.append(message);

    if (item.evidence) {
      const evidence = document.createElement("div");
      evidence.className = "fit-evidence";
      const evidenceLabel = document.createElement("span");
      evidenceLabel.textContent = "공고 근거";
      const evidenceText = document.createElement("p");
      evidenceText.textContent = item.evidence;
      evidence.append(evidenceLabel, evidenceText);
      listItem.append(evidence);
    }

    appendAdditionalInfoControl(listItem, item);
    (item.status === "unknown" ? additionalList : list).append(listItem);
  });

  emptyMessage.hidden = conditionChecks.length > 0;
  additionalSection.hidden = additionalList.children.length === 0;
  section.hidden = false;
}


export function renderPreparationChecklist(programId, actions) {
  const section = document.querySelector("#modal-preparation-section");
  const groupsContainer = document.querySelector("#modal-preparation-list");
  const emptyMessage = document.querySelector("#modal-preparation-empty");
  const stateKey = String(programId);
  const checkedActions = state.preparationChecklistState.get(stateKey) ?? new Set();

  state.preparationChecklistState.set(stateKey, checkedActions);
  groupsContainer.replaceChildren();

  const groups = [
    {
      label: "조건 확인",
      ids: ["check-income", "check-assets", "check-housing", "check-marital", "check-enrollment"]
    },
    { label: "신청 방법", ids: ["check-application"] },
    { label: "문의·관련 자료", ids: ["check-contact", "check-sites", "check-forms"] }
  ];

  groups.forEach((group) => {
    const groupActions = actions.filter((action) => group.ids.includes(action.id));
    if (groupActions.length === 0) return;

    const groupSection = document.createElement("section");
    groupSection.className = "preparation-group";
    const groupTitle = document.createElement("h4");
    groupTitle.textContent = group.label;
    const groupList = document.createElement("ul");
    groupSection.append(groupTitle, groupList);

    groupActions.forEach((action) => {
      const item = document.createElement("li");
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      const text = document.createElement("span");

      checkbox.type = "checkbox";
      checkbox.checked = checkedActions.has(action.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          checkedActions.add(action.id);
        } else {
          checkedActions.delete(action.id);
        }
        updatePreparationProgress(actions, checkedActions);
      });
      text.textContent = action.label;
      label.append(checkbox, text);
      item.append(label);

      if (action.targetId) {
        const actionButton = document.createElement("button");
        actionButton.type = "button";
        actionButton.className = "preparation-action";
        actionButton.textContent = action.actionLabel;
        actionButton.addEventListener("click", () => moveToModalTarget(action.targetId));
        item.append(actionButton);
      }

      groupList.append(item);
    });

    groupsContainer.append(groupSection);
  });

  emptyMessage.hidden = actions.length > 0;
  updatePreparationProgress(actions, checkedActions);
  section.hidden = false;
}


export function renderDetailRecommendation(policyEvidenceContext) {
  const section = document.querySelector("#modal-recommendation-section");
  const list = document.querySelector("#modal-recommendation-reasons");
  const reasons = Array.isArray(policyEvidenceContext?.recommendation?.reasons)
    ? policyEvidenceContext.recommendation.reasons
    : [];

  list.replaceChildren(...reasons.map(createReasonItem));
  section.hidden = reasons.length === 0;
}


export function renderProgramDetail(program, fitAnalysis) {
  const ministry = document.querySelector("#modal-ministry");
  ministry.textContent = program.ministry || "";
  ministry.hidden = !program.ministry;
  document.querySelector("#modal-title").textContent = program.title || "";
  const category = document.querySelector("#modal-category");
  category.textContent = state.selectedEvaluation?.program.category || "";
  category.hidden = !category.textContent;
  const summary = document.querySelector("#modal-summary");
  const supportText = typeof program.support === "string"
    ? program.support.replace(/\s+/g, " ").trim()
    : "";
  summary.textContent = supportText.length > 180
    ? supportText.slice(0, 180).trim() + "…"
    : supportText;
  summary.hidden = !supportText;
  renderDetailText("modal-target-section", "modal-target", program.target);
  renderDetailText("modal-selection-section", "modal-selection-criteria", program.selectionCriteria);
  renderDetailText("modal-support-section", "modal-support", program.support);
  renderDetailItems("modal-application-section", "modal-application-methods", program.applicationMethods, "description");
  renderDetailItems("modal-contacts-section", "modal-contacts", program.contacts, "contact");
  renderDetailItems("modal-related-sites-section", "modal-related-sites", program.relatedSites, "url");
  renderDetailItems("modal-forms-section", "modal-forms", program.forms, "url");
  renderDetailItems("modal-legal-basis-section", "modal-legal-basis", program.legalBasis, "url");
  updateOfficialDetailsVisibility();
  state.currentPolicyEvidenceContext = buildPolicyEvidenceContext(
    fitAnalysis ? state.selectedEvaluation : null,
    fitAnalysis,
    fitAnalysis ? state.currentPersona : null,
    program
  );
  if (fitAnalysis) {
    renderDetailRecommendation(state.currentPolicyEvidenceContext);
    renderFitAnalysis(state.currentPolicyEvidenceContext);
    const actions = buildPreparationChecklist(fitAnalysis, program);
    renderPreparationChecklist(program.id, actions);
    document.querySelector("#detail-condition-section").hidden = false;
    document.querySelector("#detail-preparation-section").hidden = false;
    document.querySelector("#modal-official-section").hidden = false;
  } else {
    renderDetailRecommendation(null);
    document.querySelector("#detail-condition-section").hidden = true;
  }
}


export function resetProgramDetail(program) {
  state.currentPolicyEvidenceContext = null;
  const ministry = document.querySelector("#modal-ministry");
  ministry.textContent = program.ministry || "";
  ministry.hidden = !program.ministry;
  document.querySelector("#modal-title").textContent = program.title;
  const category = document.querySelector("#modal-category");
  category.textContent = program.category || "";
  category.hidden = !program.category;
  const summary = document.querySelector("#modal-summary");
  summary.textContent = "";
  summary.hidden = true;

  if (aiExplainerSection) aiExplainerSection.hidden = true;
  if (aiExplainerSkeleton) aiExplainerSkeleton.hidden = false;
  if (aiExplainerResult) aiExplainerResult.hidden = true;

  document.querySelector("#modal-official-section").hidden = true;
  document.querySelector("#detail-summary-section").open = true;
  document.querySelector("#detail-condition-section").open = true;
  document.querySelector("#detail-condition-section").hidden = true;
  document.querySelector("#detail-preparation-section").open = false;
  document.querySelector("#detail-preparation-section").hidden = false;
  renderDetailRecommendation(null);
  document.querySelector("#modal-official-more").hidden = true;
  setOfficialMoreExpanded(false);

  [
    "modal-fit-section",
    "modal-preparation-section",
    "modal-target-section",
    "modal-selection-section",
    "modal-support-section",
    "modal-application-section",
    "modal-contacts-section",
    "modal-related-sites-section",
    "modal-forms-section",
    "modal-legal-basis-section"
  ].forEach((sectionId) => {
    document.querySelector(`#${sectionId}`).hidden = true;
  });
}

// 사용자가 카드를 클릭했을 때만 해당 복지서비스의 실제 상세정보를 요청합니다.

export function appendAdditionalInfoControl(listItem, item) {
  if (!item.additionalInfoKey) return;

  const question = additionalInfoQuestions[item.additionalInfoKey];
  const control = document.createElement("div");
  control.className = "fit-question";
  const selectedOption = question.options.find(
    (option) => option.value === item.userValue?.raw
  );

  if (selectedOption && state.editingAdditionalInfoKey !== item.additionalInfoKey) {
    const answer = document.createElement("p");
    answer.className = "fit-answer";
    answer.textContent = `입력한 정보: ${selectedOption.label}`;

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "fit-answer-edit";
    editButton.dataset.fitEdit = item.additionalInfoKey;
    editButton.textContent = "답변 수정";
    control.append(answer, editButton);
  } else {
    const controlLabel = document.createElement("span");
    controlLabel.className = "fit-question-label";
    controlLabel.textContent = "추가 확인";

    const prompt = document.createElement("p");
    prompt.className = "fit-question-prompt";
    prompt.textContent = question.prompt;

    const options = document.createElement("div");
    options.className = "fit-question-options";
    question.options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fit-question-option";
      button.dataset.fitAnswerKey = item.additionalInfoKey;
      button.dataset.fitAnswerValue = option.value;
      button.textContent = option.label;
      options.append(button);
    });
    control.append(controlLabel, prompt, options);
  }

  listItem.append(control);
}


export function setOfficialMoreExpanded(isExpanded) {
  const toggle = document.querySelector("#modal-official-toggle");
  const content = document.querySelector("#modal-official-more-content");
  toggle.setAttribute("aria-expanded", String(isExpanded));
  toggle.querySelector("span").textContent = isExpanded ? "−" : "＋";
  content.hidden = !isExpanded;
}


export function updateOfficialDetailsVisibility() {
  const primarySectionIds = [
    "modal-target-section",
    "modal-selection-section",
    "modal-support-section",
    "modal-application-section"
  ];
  const secondarySectionIds = [
    "modal-contacts-section",
    "modal-related-sites-section",
    "modal-forms-section",
    "modal-legal-basis-section"
  ];
  const hasPrimaryDetails = primarySectionIds.some((id) => !document.querySelector(`#${id}`).hidden);
  const hasSummaryDetails = [
    "modal-target-section",
    "modal-selection-section",
    "modal-support-section"
  ].some((id) => !document.querySelector(`#${id}`).hidden);
  const hasApplicationDetails = !document.querySelector("#modal-application-section").hidden;
  const hasSecondaryDetails = secondarySectionIds.some((id) => !document.querySelector(`#${id}`).hidden);
  const disclosurePairs = [
    ["modal-support-disclosure", "modal-support-section"],
    ["modal-target-disclosure", "modal-target-section"],
    ["modal-selection-disclosure", "modal-selection-section"]
  ];

  disclosurePairs.forEach(([disclosureId, sectionId]) => {
    const disclosure = document.querySelector(`#${disclosureId}`);
    disclosure.hidden = document.querySelector(`#${sectionId}`).hidden;
    disclosure.open = false;
  });

  document.querySelector("#detail-summary-section").hidden = !hasSummaryDetails;
  document.querySelector("#detail-preparation-section").hidden =
    !hasApplicationDetails && !hasSecondaryDetails;

  document.querySelector("#modal-official-section").hidden = !hasPrimaryDetails && !hasSecondaryDetails;
  document.querySelector("#modal-official-more").hidden = !hasSecondaryDetails;
  setOfficialMoreExpanded(false);
}



export function renderAiExplainer(data) {
  aiExplainerSkeleton.hidden = true;
  aiExplainerResult.hidden = false;
  
  if (data) {
    aiSummaryText.textContent = data.summary || "";
    aiEligibilityTip.textContent = data.eligibilityTip || "";
    aiChecklistTip.textContent = data.checklistTip || "";
  }
}
