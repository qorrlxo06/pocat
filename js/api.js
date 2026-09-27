import { state } from './state.js';
import { calculateAge, formatBirthDate, getLocalDateInputValue, parseLocalDate } from './app.js';
export async function fetchWelfarePrograms(userInput) {
  const query = new URLSearchParams({
    age: String(userInput.age),
    interests: userInput.interests.join(","),
    onlineOnly: String(userInput.onlineOnly)
  });
  const response = await fetch(`/api/welfare?${query.toString()}`);

  if (!response.ok) {
    console.error("WELFARE_API_ERROR:", response.status, response.statusText); throw new Error("WELFARE_API_ERROR");
  }

  const data = await response.json();

  if (!Array.isArray(data.programs)) {
    console.error("INVALID_WELFARE_DATA:", data); throw new Error("INVALID_WELFARE_DATA");
  }

  return {
    programs: prepareApiPrograms(data.programs, userInput),
    meta: {
      dataSource: data.meta?.dataSource,
      isStale: data.meta?.isStale,
      cachedAt: data.meta?.cachedAt
    }
  };
}


export async function fetchShHousingPrograms(userInput) {
  if (!userInput.interests.includes("주거")) return [];

  const response = await fetch("/api/sh-housing");
  if (!response.ok) throw new Error("SH_HOUSING_API_ERROR");

  const data = await response.json();
  if (!Array.isArray(data.programs)) throw new Error("INVALID_SH_HOUSING_DATA");

  return data.programs.map((program) => ({
    ...program,
    category: Array.isArray(program.categories) && program.categories.includes("주거")
      ? "주거"
      : "분야 확인 필요"
  }));
}


export async function fetchSearchPrograms(userInput) {
  const shouldFetchSh = userInput.interests.includes("주거");

  if (!shouldFetchSh) {
    const welfareResult = await fetchWelfarePrograms(userInput);
    return {
      programs: welfareResult.programs,
      sources: {
        welfare: { status: "success", meta: welfareResult.meta },
        sh: { status: "skipped" }
      }
    };
  }

  // 두 출처를 독립적으로 처리해 한쪽 실패가 다른 쪽 결과를 버리지 않게 합니다.
  const [welfareResult, shResult] = await Promise.allSettled([
    fetchWelfarePrograms(userInput),
    fetchShHousingPrograms(userInput)
  ]);
  const welfareSucceeded = welfareResult.status === "fulfilled";
  const shSucceeded = shResult.status === "fulfilled";

  if (!welfareSucceeded && !shSucceeded) {
    throw new Error("ALL_SEARCH_SOURCES_FAILED");
  }

  return {
    programs: [
      ...(welfareSucceeded ? welfareResult.value.programs : []),
      ...(shSucceeded ? shResult.value : [])
    ],
    sources: {
      welfare: {
        status: welfareSucceeded ? "success" : "error",
        ...(welfareSucceeded ? { meta: welfareResult.value.meta } : {})
      },
      sh: { status: shSucceeded ? "success" : "error" }
    }
  };
}


export function prepareApiPrograms(programs, userInput) {
  return programs.map((program) => ({
    ...program,
    category: getApiProgramCategory(program, userInput.interests)
  }));
}


export function getApiProgramCategory(program, interests) {
  const categories = Array.isArray(program.categories) ? program.categories : [];
  const matchedInterest = interests.find((interest) => categories.includes(interest));

  if (matchedInterest) {
    return matchedInterest;
  }

  return categories[0] || "분야 확인 필요";
}


export async function fetchProgramAiExplanation(servId, payload, signal) {
  const response = await fetch(`/api/welfare/${encodeURIComponent(servId)}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    throw new Error("AI_EXPLAINER_API_ERROR");
  }

  return response.json();
}
