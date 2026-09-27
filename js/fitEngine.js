import { formatBirthDate } from './app.js';
import { modal } from './render.js';
import { state } from './state.js';

export const additionalInfoQuestions = {
  housingStatus: { prompt: "이 사업에는 무주택 관련 조건이 있습니다. 더 정확한 분석을 위해 알려주세요.", options: [{ value: "homeless", label: "무주택" }, { value: "owner", label: "주택 보유" }, { value: "unknown", label: "잘 모르겠어요" }] },
  maritalStatus: { prompt: "이 사업에는 혼인 상태 조건이 있습니다. 더 정확한 분석을 위해 알려주세요.", options: [{ value: "unmarried", label: "미혼" }, { value: "married", label: "기혼" }, { value: "unknown", label: "잘 모르겠어요" }] },
  enrollmentStatus: { prompt: "이 사업에는 재학 상태 조건이 있습니다. 더 정확한 분석을 위해 알려주세요.", options: [{ value: "enrolled", label: "재학 중" }, { value: "notEnrolled", label: "재학 중 아님" }, { value: "unknown", label: "잘 모르겠어요" }] }
};
export function checkAgeCondition(userInput, program) {
  const hasMinAge = Number.isFinite(program.minAge);
  const hasMaxAge = Number.isFinite(program.maxAge);

  if (!hasMinAge || !hasMaxAge || program.minAge > program.maxAge) {
    return {
      state: "unknown",
      reason: { type: "check", text: "연령 조건 정보가 없어 추가 확인 필요" }
    };
  }

  const matches = userInput.age >= program.minAge && userInput.age <= program.maxAge;
  return {
    state: matches ? "match" : "mismatch",
    reason: {
      type: matches ? "match" : "mismatch",
      text: matches
        ? `만 ${program.minAge}~${program.maxAge}세 조건 충족`
        : `연령 조건 불일치 · 대상 연령 만 ${program.minAge}~${program.maxAge}세`
    }
  };
}

// 2. 사용자 지역과 사업 지역을 비교합니다. 전국 사업은 지역 조건을 충족합니다.

export function checkRegionCondition(userInput, program) {
  const programRegion = typeof program.region === "string" ? program.region.trim() : "";

  if (!programRegion) {
    return {
      state: "unknown",
      reason: { type: "check", text: "지원 지역 정보가 없어 추가 확인 필요" }
    };
  }

  const matches = programRegion === "전국" || programRegion === userInput.region;
  let reasonText = `지역 조건 불일치 · ${programRegion} 거주자 대상`;

  if (matches) {
    reasonText = programRegion === "전국" ? "전국 대상 사업" : `${programRegion} 거주 조건 일치`;
  }

  return {
    state: matches ? "match" : "mismatch",
    reason: { type: matches ? "match" : "mismatch", text: reasonText }
  };
}

// 3. 현재 상태가 사업 대상 상태에 포함되는지 확인합니다.

export function checkStatusCondition(userInput, program) {
  const validStatuses = Array.isArray(program.status)
    ? program.status.filter((status) => typeof status === "string" && status.trim())
    : [];

  if (validStatuses.length === 0) {
    return {
      state: "unknown",
      reason: { type: "check", text: "대상 상태 정보가 부족해 공고 확인 필요" }
    };
  }

  const matches = validStatuses.includes(userInput.status);
  return {
    state: matches ? "match" : "mismatch",
    reason: {
      type: matches ? "match" : "mismatch",
      text: matches
        ? `${userInput.status} 대상`
        : `현재 상태 조건 불일치 · ${validStatuses.join(", ")} 대상`
    }
  };
}

// 4. 관심 분야는 신청 자격이 아니라 추천 점수와 순서에만 반영합니다.

export function checkInterestMatch(userInput, program) {
  const category = typeof program.category === "string" ? program.category.trim() : "";

  if (!category) {
    return {
      state: "unknown",
      reason: { type: "check", text: "사업 분야 정보가 없어 관심도 확인 필요" }
    };
  }

  const matches = userInput.interests.includes(category);
  return {
    state: matches ? "match" : "mismatch",
    reason: {
      type: matches ? "match" : "neutral",
      text: matches
        ? `${category} 분야 관심 일치`
        : "관심 분야는 다르지만 신청 자격 판단에는 영향을 주지 않음"
    }
  };
}

// 자격 조건과 관심 분야가 각각 몇 점인지 이해하기 쉬운 규칙으로 계산합니다.

export function calculateScore(conditionResults) {
  let score = 0;

  if (conditionResults.age.state === "match") score += 30;
  if (conditionResults.region.state === "match") score += 30;
  if (conditionResults.status.state === "match") score += 20;
  if (conditionResults.interest.state === "match") score += 20;

  return score;
}

// 5. 핵심 조건 결과를 이용해 최종 추천 상태와 판단 이유를 결정합니다.

export function evaluateProgram(userInput, program) {
  const conditionResults = {
    age: checkAgeCondition(userInput, program),
    region: checkRegionCondition(userInput, program),
    status: checkStatusCondition(userInput, program),
    interest: checkInterestMatch(userInput, program)
  };
  const coreConditions = [conditionResults.age, conditionResults.region, conditionResults.status];
  let recommendationStatus = "high";

  if (coreConditions.some((condition) => condition.state === "mismatch")) {
    recommendationStatus = "mismatch";
  } else if (coreConditions.some((condition) => condition.state === "unknown")) {
    recommendationStatus = "check";
  }

  return {
    program,
    recommendationStatus,
    score: calculateScore(conditionResults),
    reasons: [
      conditionResults.age.reason,
      conditionResults.region.reason,
      conditionResults.status.reason,
      conditionResults.interest.reason
    ],
    requiredDocs: Array.isArray(program.requiredDocs) ? program.requiredDocs : []
  };
}


export function evaluateRelatedProgram(userInput, program) {
  const categories = Array.isArray(program.categories) ? program.categories : [];
  const targetGroups = Array.isArray(program.targetGroups) ? program.targetGroups : [];
  const matchedInterests = userInput.interests.filter((interest) => categories.includes(interest));
  const matchedHouseholdTypes = userInput.householdTypes.filter((type) => targetGroups.includes(type));
  const interestScore = matchedInterests.length > 0
    ? Math.min(80, 60 + (matchedInterests.length - 1) * 10)
    : 0;
  const relatedScore = Math.min(100, interestScore + (matchedHouseholdTypes.length > 0 ? 20 : 0));
  const relatedLevel = relatedScore >= 80 ? "veryHigh" : relatedScore >= 70 ? "high" : "related";
  const reasons = [];

  if (matchedInterests.length > 0) {
    reasons.push({
      type: "match",
      text: `관심분야 ${matchedInterests.map((interest) => `'${interest}'`).join(", ")}와 일치합니다.`
    });
  }

  if (matchedHouseholdTypes.length > 0) {
    reasons.push({
      type: "match",
      text: `선택한 가구 특성 ${matchedHouseholdTypes.map((type) => `'${type}'`).join(", ")}과 사업 대상 유형이 일치합니다.`
    });
  }

  reasons.push({
    type: "check",
    text: "이 관련도는 신청 자격 판정이 아닙니다. 상세 자격조건을 확인해 주세요."
  });

  return { program, relatedScore, relatedLevel, reasons };
}


export function findAgeCondition(text) {
  const patterns = [
    /만?\s*(\d{1,2})\s*세\s*(?:이상|부터)\s*(?:만?\s*)?(\d{1,2})\s*세\s*(?:이하|까지)/,
    /만?\s*(\d{1,2})\s*(?:세)?\s*[~～-]\s*(?:만?\s*)?(\d{1,2})\s*세/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const minAge = Number(match[1]);
    const maxAge = Number(match[2]);
    if (minAge <= maxAge) return { minAge, maxAge, matcher: pattern };
  }

  return null;
}


export function findExplicitStateRequirement(sourceText, candidates, exclusion) {
  const matches = candidates.flatMap((candidate) => {
    if (!candidate.matcher.test(sourceText)) return [];

    const evidence = getEvidenceSnippet(sourceText, candidate.matcher);
    if (exclusion?.test(evidence)) return [];
    return [{ ...candidate, evidence }];
  });

  return matches.length === 1 ? matches[0] : null;
}


export function createAdditionalInfoFitItem(persona, requirement) {
  const answer = persona.additionalInfo?.[requirement.key] ?? null;
  const status = !answer || answer === "unknown"
    ? "unknown"
    : answer === requirement.requiredValue
      ? "match"
      : "mismatch";
  const message = status === "match"
    ? requirement.matchMessage
    : status === "mismatch"
      ? requirement.mismatchMessage
      : answer === "unknown"
        ? "사용자가 현재 상태를 확인하지 못했습니다."
        : requirement.unknownMessage;

  return {
    conditionType: requirement.conditionType,
    status,
    label: requirement.label,
    message,
    evidence: requirement.evidence,
    additionalInfoKey: requirement.key,
    answer
  };
}

// Persona에 있는 값과 상세 원문에서 명확히 확인되는 조건만 비교합니다.

export function buildFitAnalysis(persona, listProgram, detailProgram) {
  if (!persona) return { items: [] };

  const sourceText = [detailProgram.target, detailProgram.selectionCriteria]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ");
  const items = [];
  const ageCondition = findAgeCondition(sourceText);

  if (ageCondition && Number.isFinite(persona.age)) {
    const isMatch = persona.age >= ageCondition.minAge && persona.age <= ageCondition.maxAge;
    items.push({
      conditionType: "age",
      status: isMatch ? "match" : "mismatch",
      label: "연령",
      message: isMatch
        ? `현재 나이 ${persona.age}세가 명시된 연령 범위에 포함됩니다.`
        : `현재 나이 ${persona.age}세가 명시된 연령 범위에 포함되지 않습니다.`,
      evidence: getEvidenceSnippet(sourceText, ageCondition.matcher)
    });
  }

  const targetGroups = Array.isArray(listProgram.targetGroups) ? listProgram.targetGroups : [];
  const householdTypes = Array.isArray(persona.householdTypes) ? persona.householdTypes : [];
  const matchedHouseholdTypes = householdTypes.filter((type) => targetGroups.includes(type));

  if (matchedHouseholdTypes.length > 0) {
    items.push({
      conditionType: "household",
      status: "match",
      label: "가구 특성",
      message: `선택한 가구 특성 '${matchedHouseholdTypes.join(", ")}'이 사업 대상 유형에 명시되어 있습니다.`,
      evidence: targetGroups.join(", ").slice(0, 120)
    });
  }

  const seoulPattern = /서울(?:특별시)?(?:에|시내에| 내)?[^.!?\n]{0,20}거주(?:하는| 중인|자|민)/;
  if (persona.region === "서울" && seoulPattern.test(sourceText)) {
    items.push({
      conditionType: "region",
      status: "match",
      label: "지역",
      message: "서울 거주 조건과 현재 입력 지역이 일치합니다.",
      evidence: getEvidenceSnippet(sourceText, seoulPattern)
    });
  }

  const housingExclusion = /(?:무주택|주택\s*(?:소유|보유)(?:\s*여부)?)(?:와|과|에)?\s*(?:관계없이|무관)/;
  const maritalExclusion = /(?:혼인\s*여부|미혼|기혼)(?:와|과|에)?\s*(?:관계없이|무관)/;
  const enrollmentExclusion = /(?:재학\s*여부|학생\s*여부|재학생)(?:와|과|에)?\s*(?:관계없이|무관)/;
  const housingRequirement = findExplicitStateRequirement(sourceText, [
    { requiredValue: "homeless", matcher: /무주택(?:자|인|가구|세대|세대구성원|청년)?/ }
  ], housingExclusion);
  const maritalRequirement = findExplicitStateRequirement(sourceText, [
    { requiredValue: "unmarried", matcher: /미혼(?:인|자|\s*청년)?/ },
    { requiredValue: "married", matcher: /기혼(?:인|자|\s*청년)?/ }
  ], maritalExclusion);
  const enrollmentRequirement = findExplicitStateRequirement(sourceText, [
    { requiredValue: "enrolled", matcher: /재학생|재학\s*중(?!\s*아님)/ },
    { requiredValue: "notEnrolled", matcher: /비재학|재학\s*중\s*아님|졸업자/ }
  ], enrollmentExclusion);

  if (housingRequirement) {
    items.push(createAdditionalInfoFitItem(persona, {
      ...housingRequirement,
      conditionType: "housing",
      key: "housingStatus",
      label: "주택 보유 여부",
      matchMessage: "입력한 무주택 상태가 명시된 조건과 일치합니다.",
      mismatchMessage: "입력한 주택 보유 상태가 명시된 무주택 조건과 일치하지 않습니다.",
      unknownMessage: "무주택 여부에 대한 추가 확인이 필요합니다."
    }));
  }

  if (maritalRequirement) {
    items.push(createAdditionalInfoFitItem(persona, {
      ...maritalRequirement,
      conditionType: "marital",
      key: "maritalStatus",
      label: "혼인 상태",
      matchMessage: "입력한 혼인 상태가 명시된 조건과 일치합니다.",
      mismatchMessage: "입력한 혼인 상태가 명시된 조건과 일치하지 않습니다.",
      unknownMessage: "혼인 상태에 대한 추가 확인이 필요합니다."
    }));
  }

  if (enrollmentRequirement) {
    items.push(createAdditionalInfoFitItem(persona, {
      ...enrollmentRequirement,
      conditionType: "enrollment",
      key: "enrollmentStatus",
      label: "재학 여부",
      matchMessage: "입력한 재학 상태가 명시된 조건과 일치합니다.",
      mismatchMessage: "입력한 재학 상태가 명시된 조건과 일치하지 않습니다.",
      unknownMessage: "재학 여부에 대한 추가 확인이 필요합니다."
    }));
  }

  const unknownConditions = [
    {
      conditionType: "income",
      label: "소득 조건",
      matcher: /소득(?:인정액)?|중위소득/,
      exclusion: /소득(?:\s*조건)?(?:과|와|에)?\s*(?:관계없이|무관)/,
      message: "현재 입력정보만으로는 소득 조건을 확인할 수 없습니다."
    },
    {
      conditionType: "housing",
      label: "주택 보유 여부",
      matcher: /무주택|주택\s*(?:소유|보유)/,
      exclusion: housingExclusion,
      handled: Boolean(housingRequirement),
      message: "무주택 또는 주택 보유 여부에 대한 추가 확인이 필요합니다."
    },
    { conditionType: "asset", label: "재산·자산 조건", matcher: /재산|자산/, message: "현재 입력정보만으로는 재산·자산 조건을 확인할 수 없습니다." },
    {
      conditionType: "marital",
      label: "혼인 여부",
      matcher: /혼인|미혼|기혼/,
      exclusion: maritalExclusion,
      handled: Boolean(maritalRequirement),
      message: "현재 입력정보만으로는 혼인 여부 조건을 확인할 수 없습니다."
    },
    {
      conditionType: "enrollment",
      label: "재학 여부",
      matcher: /재학|학생/,
      exclusion: enrollmentExclusion,
      handled: Boolean(enrollmentRequirement),
      message: "현재 입력정보만으로는 재학·학생 여부 조건을 확인할 수 없습니다."
    }
  ];

  unknownConditions.forEach((condition) => {
    if (condition.handled) return;
    if (!condition.matcher.test(sourceText)) return;
    const evidence = getEvidenceSnippet(sourceText, condition.matcher);
    if (condition.exclusion?.test(evidence)) return;

    items.push({
      conditionType: condition.conditionType,
      status: "unknown",
      label: condition.label,
      message: condition.message,
      evidence
    });
  });

  return { items };
}


export function buildPolicyEvidenceContext(evaluation, fitAnalysis, persona, detailProgram) {
  if (evaluation?.program?.source === "SH" || detailProgram?.source === "SH") {
    return null;
  }

  const program = {
    id: detailProgram?.id ?? evaluation?.program?.id ?? null,
    title: detailProgram?.title ?? evaluation?.program?.title ?? null,
    ministry: detailProgram?.ministry ?? evaluation?.program?.ministry ?? null,
    source: detailProgram?.source ?? evaluation?.program?.source ?? null
  };

  if (!evaluation || !persona) {
    return {
      program,
      recommendation: null,
      conditionChecks: []
    };
  }

  const reasons = Array.isArray(evaluation.reasons)
    ? evaluation.reasons.map((reason) => ({ type: reason.type, text: reason.text }))
    : [];
  const items = Array.isArray(fitAnalysis?.items) ? fitAnalysis.items : [];

  return {
    program,
    recommendation: {
      level: evaluation.relatedLevel ?? null,
      reasons
    },
    conditionChecks: items.map((item) => ({
      conditionType: item.conditionType,
      label: item.label,
      userValue: formatPolicyEvidenceUserValue(item.conditionType, persona),
      status: item.status,
      message: item.message,
      evidence: item.evidence ?? null,
      sourceSection: null,
      additionalInfoKey: item.additionalInfoKey ?? null
    }))
  };
}


export function formatPolicyEvidenceUserValue(conditionType, persona) {
  if (!persona) return { raw: null, display: null };

  if (conditionType === "age") {
    const birthDate = typeof persona.birthDate === "string" && persona.birthDate
      ? persona.birthDate
      : null;
    const age = Number.isFinite(persona.age) ? persona.age : null;
    const formattedBirthDate = birthDate ? formatBirthDate(birthDate) : "";
    const display = formattedBirthDate && age !== null
      ? `${formattedBirthDate} 출생 (만 ${age}세)`
      : age !== null
        ? `만 ${age}세`
        : null;

    return {
      raw: birthDate || age !== null ? { birthDate, age } : null,
      display
    };
  }

  if (conditionType === "region") {
    const region = typeof persona.region === "string" && persona.region.trim()
      ? persona.region
      : null;
    return { raw: region, display: region };
  }

  const additionalInfoConfig = {
    housing: {
      key: "housingStatus",
      labels: { homeless: "무주택", owner: "주택 보유", unknown: "잘 모르겠어요" }
    },
    marital: {
      key: "maritalStatus",
      labels: { unmarried: "미혼", married: "기혼", unknown: "잘 모르겠어요" }
    },
    enrollment: {
      key: "enrollmentStatus",
      labels: { enrolled: "재학 중", notEnrolled: "재학 중이 아님", unknown: "잘 모르겠어요" }
    }
  };
  const config = additionalInfoConfig[conditionType];

  if (config) {
    const raw = persona.additionalInfo?.[config.key] ?? null;
    return {
      raw,
      display: raw && config.labels[raw] ? config.labels[raw] : null
    };
  }

  return { raw: null, display: null };
}


export function getEvidenceSnippet(text, matcher) {
  const normalizedText = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  const match = normalizedText.match(matcher);

  if (!match || match.index === undefined) return "";

  const start = Math.max(0, match.index - 35);
  const end = Math.min(normalizedText.length, match.index + match[0].length + 55);
  const snippet = normalizedText.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${snippet}${end < normalizedText.length ? "…" : ""}`;
}


export function buildPreparationChecklist(fitAnalysis, detailProgram) {
  const actions = new Map();
  const unknownActionByLabel = {
    "소득 조건": { id: "check-income", label: "소득 기준 확인하기", actionLabel: "선정 기준 보기", targetId: "modal-selection-section" },
    "재산·자산 조건": { id: "check-assets", label: "재산·자산 기준 확인하기", actionLabel: "선정 기준 보기", targetId: "modal-selection-section" },
    "주택 보유 여부": { id: "check-housing", label: "주택 보유 여부 다시 확인하기", actionLabel: "정보 입력하기", targetId: "fit-condition-housingStatus" },
    "혼인 상태": { id: "check-marital", label: "혼인 상태 확인하기", actionLabel: "정보 입력하기", targetId: "fit-condition-maritalStatus" },
    "재학 여부": { id: "check-enrollment", label: "재학 여부 확인하기", actionLabel: "정보 입력하기", targetId: "fit-condition-enrollmentStatus" }
  };

  fitAnalysis.items.forEach((item) => {
    if (item.status !== "unknown") return;
    const action = unknownActionByLabel[item.label];
    if (action) actions.set(action.id, action);
  });

  const detailActions = [
    { field: "applicationMethods", id: "check-application", label: "신청 방법 확인하기", actionLabel: "신청 방법 보기", targetId: "modal-application-section" },
    { field: "contacts", id: "check-contact", label: "필요하면 담당 기관에 문의하기", actionLabel: "문의처 보기", targetId: "modal-contacts-section" },
    { field: "relatedSites", id: "check-sites", label: "공식 관련 사이트 확인하기", actionLabel: "관련 사이트 보기", targetId: "modal-related-sites-section" },
    { field: "forms", id: "check-forms", label: "관련 서식·자료 확인하기", actionLabel: "관련 자료 보기", targetId: "modal-forms-section" }
  ];

  detailActions.forEach((action) => {
    if (Array.isArray(detailProgram[action.field]) && detailProgram[action.field].length > 0) {
      actions.set(action.id, action);
    }
  });

  return [...actions.values()];
}


export function formatAgeRange(program) {
  return Number.isFinite(program.minAge) && Number.isFinite(program.maxAge)
    ? `${program.minAge}~${program.maxAge}세`
    : "연령 정보 확인 필요";
}


export function formatTargetStatuses(program) {
  return Array.isArray(program.status) && program.status.length > 0
    ? program.status.join(", ")
    : "대상 상태 확인 필요";
}

