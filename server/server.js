import dotenv from "dotenv";
import express from "express";
import { XMLParser } from "fast-xml-parser";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchShHousingPrograms } from "./shHousing.js";

const DEFAULT_PORT = 3001;
const WELFARE_API_URL =
  "http://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001";
const WELFARE_DETAIL_API_URL =
  "http://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfaredetailedV001";
const SUPPORTED_INTERESTS = [
  "신체건강",
  "정신건강",
  "주거",
  "일자리",
  "문화·여가",
  "안전·위기",
  "임신·출산",
  "보육",
  "교육",
  "입양·위탁",
  "보호·돌봄",
  "서민금융",
  "법률",
  "관계개선",
  "에너지"
];
const serverFilePath = fileURLToPath(import.meta.url);
const serverDirectory = path.dirname(serverFilePath);
const projectDirectory = path.resolve(serverDirectory, "..");
const DEFAULT_WELFARE_CACHE_PATH = path.join(serverDirectory, "cache", "welfare-programs.json");
const DEFAULT_WELFARE_DETAIL_CACHE_DIRECTORY = path.join(serverDirectory, "cache", "welfare-details");

// 실행 위치와 관계없이 server/.env 파일만 환경변수 파일로 사용합니다.
dotenv.config({ path: path.join(serverDirectory, ".env"), quiet: true });

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  ignoreDeclaration: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false
});

function normalizeServiceKey(serviceKey) {
  try {
    // 공공데이터포털의 인코딩 키와 디코딩 키를 모두 한 번만 인코딩해 전송합니다.
    return decodeURIComponent(serviceKey);
  } catch {
    return serviceKey;
  }
}

function hasConfiguredServiceKey(serviceKey) {
  return Boolean(serviceKey);
}

function getUpstreamError(data) {
  const serviceErrorHeader = data?.OpenAPI_ServiceResponse?.cmmMsgHeader;

  if (serviceErrorHeader) {
    return {
      resultCode: String(serviceErrorHeader.returnReasonCode ?? ""),
      resultMessage: String(
        serviceErrorHeader.errMsg ?? serviceErrorHeader.returnAuthMsg ?? "UNKNOWN_ERROR"
      )
    };
  }

  const responseHeader = data?.response?.header;
  const wantedData = data?.wantedList ?? data?.wantedDtl;
  const resultCode = responseHeader?.resultCode ?? wantedData?.resultCode;

  if (resultCode === undefined || resultCode === null || resultCode === "") {
    return null;
  }

  if (["0", "00"].includes(String(resultCode))) {
    return null;
  }

  return {
    resultCode: String(resultCode),
    resultMessage: String(
      responseHeader?.resultMsg ?? wantedData?.resultMessage ?? "UNKNOWN_ERROR"
    )
  };
}

function splitCommaSeparatedValue(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRegisteredDate(value) {
  const date = String(value ?? "");

  if (!/^\d{8}$/.test(date)) {
    return date || null;
  }

  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function normalizeWelfareData(data) {
  const wantedList = data.wantedList;
  const rawPrograms = wantedList?.servList;
  const programList = Array.isArray(rawPrograms)
    ? rawPrograms
    : rawPrograms
      ? [rawPrograms]
      : [];

  // 공공데이터 원본 필드명을 지원핏에서 이해하기 쉬운 구조로 변환합니다.
  const programs = programList.map((program) => ({
    id: program.servId ?? null,
    title: program.servNm ?? "",
    description: program.servDgst ?? "",
    categories: splitCommaSeparatedValue(program.intrsThemaArray),
    lifeStages: splitCommaSeparatedValue(program.lifeArray),
    targetGroups: splitCommaSeparatedValue(program.trgterIndvdlArray),
    ministry: program.jurMnofNm ?? "",
    department: program.jurOrgNm ?? "",
    supportCycle: program.sprtCycNm ?? "",
    supportType: program.srvPvsnNm ?? "",
    onlineApplicationAvailable: program.onapPsbltYn === "Y",
    contact: program.rprsCtadr ?? "",
    detailUrl: program.servDtlLink ?? "",
    viewCount: toNumber(program.inqNum),
    registeredDate: normalizeRegisteredDate(program.svcfrstRegTs)
  }));

  return {
    meta: {
      resultCode: String(wantedList?.resultCode ?? ""),
      resultMessage: String(wantedList?.resultMessage ?? ""),
      totalCount: toNumber(wantedList?.totalCount),
      pageNo: toNumber(wantedList?.pageNo),
      numOfRows: toNumber(wantedList?.numOfRows)
    },
    programs
  };
}

function filterWelfarePrograms(data, interests, onlineOnly) {
  return {
    ...data,
    meta: { ...data.meta },
    programs: data.programs.filter((program) => {
      const matchesInterest =
        interests.length === 0 ||
        program.categories.some((category) => interests.includes(category));
      const matchesOnlineOnly =
        onlineOnly !== "true" || program.onlineApplicationAvailable;

      return matchesInterest && matchesOnlineOnly;
    })
  };
}

function isValidWelfareCache(data) {
  return Boolean(
    data &&
    typeof data === "object" &&
    typeof data.cachedAt === "string" &&
    data.criteria &&
    typeof data.criteria === "object" &&
    typeof data.criteria.onlineOnly === "boolean" &&
    data.meta &&
    typeof data.meta === "object" &&
    ["0", "00"].includes(String(data.meta.resultCode)) &&
    Array.isArray(data.programs) &&
    data.programs.length > 0
  );
}

async function readWelfareCache(cachePath) {
  try {
    const data = JSON.parse(await readFile(cachePath, "utf8"));
    return isValidWelfareCache(data) ? data : null;
  } catch {
    return null;
  }
}

async function writeWelfareCache(cachePath, data, age, onlineOnly) {
  const cacheData = {
    cachedAt: new Date().toISOString(),
    // upstream 후보를 좁힌 조건이 호환되는 요청에만 cache를 제공합니다.
    criteria: {
      age: age ?? null,
      onlineOnly: onlineOnly === "true"
    },
    meta: data.meta,
    programs: data.programs
  };
  const temporaryPath = `${cachePath}.tmp`;

  try {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(temporaryPath, JSON.stringify(cacheData), "utf8");
    await rename(temporaryPath, cachePath);
  } catch (error) {
    console.warn("[Cache Write Error]", error.message);
  }
  return cacheData.cachedAt;
}

async function getCachedWelfareData(cachePath, age, interests, onlineOnly) {
  const cacheData = await readWelfareCache(cachePath);
  if (!cacheData) return null;
  // if (cacheData.criteria.age !== (age ?? null)) return null;
  // if (cacheData.criteria.onlineOnly && onlineOnly !== "true") return null;

  const filteredData = filterWelfarePrograms(cacheData, interests, onlineOnly);
  filteredData.meta = {
    ...filteredData.meta,
    dataSource: "cache",
    isStale: true,
    cachedAt: cacheData.cachedAt
  };
  return filteredData;
}

function getWelfareDetailCachePath(cacheDirectory, servId) {
  return path.join(cacheDirectory, `${servId}.json`);
}

async function readWelfareDetailCache(cacheDirectory, servId) {
  try {
    const data = JSON.parse(await readFile(getWelfareDetailCachePath(cacheDirectory, servId), "utf8"));
    const isValid =
      typeof data?.cachedAt === "string" &&
      data.detail?.program?.id === servId;
    return isValid ? data : null;
  } catch {
    return null;
  }
}

async function writeWelfareDetailCache(cacheDirectory, servId, detail) {
  const cacheData = {
    cachedAt: new Date().toISOString(),
    detail
  };
  const cachePath = getWelfareDetailCachePath(cacheDirectory, servId);
  const temporaryPath = `${cachePath}.tmp`;

  try {
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(temporaryPath, JSON.stringify(cacheData), "utf8");
    await rename(temporaryPath, cachePath);
  } catch (error) {
    console.warn("[Cache Write Error]", error.message);
  }
}

async function getCachedWelfareDetail(cacheDirectory, servId) {
  const cacheData = await readWelfareDetailCache(cacheDirectory, servId);
  if (!cacheData) return null;

  return {
    ...cacheData.detail,
    meta: {
      dataSource: "cache",
      isStale: true,
      cachedAt: cacheData.cachedAt
    }
  };
}

function parseInterests(interestsValue, interestValue) {
  const queryValue = interestsValue ?? interestValue;

  if (queryValue === undefined) {
    return [];
  }

  if (typeof queryValue !== "string") {
    return null;
  }

  const interests = queryValue
    .split(",")
    .map((interest) => interest.trim())
    .filter(Boolean)
    .map((interest) => (interest === "취업" ? "일자리" : interest));

  if (
    interests.length === 0 ||
    interests.length > 5 ||
    interests.some((interest) => !SUPPORTED_INTERESTS.includes(interest))
  ) {
    return null;
  }

  return [...new Set(interests)];
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
}

function normalizeDetailText(value) {
  if (!value) {
    return null;
  }

  return String(value).replace(/&#13;/g, "\n").trim();
}

function normalizeDetailItems(value, valueKey) {
  return toArray(value).map((item) => ({
    name: item.servSeDetailNm ?? "",
    [valueKey]: item.servSeDetailLink ?? null
  }));
}

function normalizeWelfareDetail(data) {
  const detail = data.wantedDtl;

  return {
    program: {
      id: detail.servId ?? null,
      title: detail.servNm ?? "",
      ministry: detail.jurMnofNm ?? "",
      target: normalizeDetailText(detail.tgtrDtlCn),
      selectionCriteria: normalizeDetailText(detail.slctCritCn),
      support: normalizeDetailText(detail.alwServCn),
      applicationMethods: normalizeDetailItems(detail.applmetList, "description"),
      contacts: normalizeDetailItems(detail.inqplCtadrList, "contact"),
      relatedSites: normalizeDetailItems(detail.inqplHmpgReldList, "url"),
      forms: normalizeDetailItems(detail.basfrmList, "url"),
      legalBasis: normalizeDetailItems(detail.baslawList, "url")
    }
  };
}

export function createApp({
  fetchImpl = fetch,
  serviceKey = process.env.PUBLIC_DATA_API_KEY,
  welfareCachePath = DEFAULT_WELFARE_CACHE_PATH,
  welfareDetailCacheDirectory = DEFAULT_WELFARE_DETAIL_CACHE_DIRECTORY
} = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());
  app.get("/", (request, response) => {
    response.sendFile(path.join(projectDirectory, "index.html"));
  });
  app.use("/css", express.static(path.join(projectDirectory, "css")));
  app.use("/js", express.static(path.join(projectDirectory, "js")));

  app.get("/api/sh-housing", async (request, response) => {
    try {
      return response.status(200).json(await fetchShHousingPrograms(fetchImpl));
    } catch {
      return response.status(502).json({
        error: "SH 주거 공고를 불러오지 못했습니다."
      });
    }
  });

  app.get("/api/welfare", async (request, response) => {
    const { age, interest, interests: interestsValue, onlineOnly } = request.query;
    const interests = parseInterests(interestsValue, interest);
    console.log("Q:", request.query, "interests:", interests);


    if (age !== undefined && (typeof age !== "string" || !/^\d+$/.test(age))) {
      return response.status(400).json({
        error: "나이는 숫자로 입력해 주세요."
      });
    }

    if (interests === null) {
      return response.status(400).json({
        error: "지원하지 않는 관심분야입니다.",
        supportedInterests: SUPPORTED_INTERESTS
      });
    }

    if (onlineOnly !== undefined && !["true", "false"].includes(onlineOnly)) {
      return response.status(400).json({
        error: "onlineOnly는 true 또는 false로 입력해 주세요."
      });
    }

    if (!hasConfiguredServiceKey(serviceKey)) {
      const cachedData = await getCachedWelfareData(welfareCachePath, age, interests, onlineOnly);
      if (cachedData) return response.status(200).json(cachedData);

      return response.status(500).json({
        error: "server/.env의 예시 값을 실제 공공데이터 API 키로 교체한 뒤 서버를 재시작해 주세요.",
        code: "API_KEY_NOT_CONFIGURED"
      });
    }

    const apiUrl = new URL(WELFARE_API_URL);
    apiUrl.searchParams.set("serviceKey", normalizeServiceKey(serviceKey));
    apiUrl.searchParams.set("callTp", "L");
    apiUrl.searchParams.set("pageNo", "1");
    apiUrl.searchParams.set("numOfRows", "500");
    apiUrl.searchParams.set("srchKeyCode", "001");
    apiUrl.searchParams.set("lifeArray", "004");

    if (age !== undefined) {
      apiUrl.searchParams.set("age", age);
    }

    if (onlineOnly === "true") {
      apiUrl.searchParams.set("onapPsbltYn", "Y");
    }

    let diagnosticStage = "fetch";
    let apiResponse;

    try {
      apiResponse = await fetchImpl(apiUrl, {
        method: "GET",
        headers: {
          Accept: "application/xml, text/xml"
        },
        signal: AbortSignal.timeout(30000)
      });

      if (!apiResponse.ok) {
        console.error("[복지서비스 목록 upstream HTTP 오류]", {
          status: apiResponse.status,
          statusText: apiResponse.statusText
        });
      }

      diagnosticStage = "response-body";
      const xml = await apiResponse.text();
      diagnosticStage = "xml-parsing";
      const data = xmlParser.parse(xml);
      const upstreamError = getUpstreamError(data);

      if (upstreamError) {
        console.warn("[복지서비스 목록 upstream 응답 오류]", {
          status: apiResponse.status,
          statusText: apiResponse.statusText
        });
        const cachedData = await getCachedWelfareData(welfareCachePath, age, interests, onlineOnly);
        if (cachedData) return response.status(200).json(cachedData);

        return response.status(502).json({
          error: "복지서비스 데이터를 불러오지 못했습니다.",
          upstreamStatus: apiResponse.status,
          resultCode: upstreamError.resultCode,
          resultMessage: upstreamError.resultMessage
        });
      }

      if (!apiResponse.ok || !data || typeof data !== "object") {
        throw new Error("UPSTREAM_DATA_ERROR");
      }

      diagnosticStage = "normalization";
      const normalizedData = normalizeWelfareData(data);
      let cachedAt = null;

      if (["0", "00"].includes(normalizedData.meta.resultCode) && normalizedData.programs.length > 0) {
        try {
          cachedAt = await writeWelfareCache(welfareCachePath, normalizedData, age, onlineOnly);
        } catch (cacheError) {
          console.warn("[복지서비스 cache 저장 실패]", {
            errorName: cacheError?.name ?? "UnknownError",
            errorMessage: cacheError?.message ?? "오류 메시지 없음"
          });
        }
      }

      const liveData = filterWelfarePrograms(normalizedData, interests, onlineOnly);
      liveData.meta = {
        ...liveData.meta,
        dataSource: "live",
        isStale: false,
        ...(cachedAt ? { cachedAt } : {})
      };
      return response.status(200).json(liveData);
    } catch (error) {
      const errorName = typeof error?.name === "string" ? error.name : "UnknownError";
      const rawMessage = typeof error?.message === "string" ? error.message : "오류 메시지 없음";
      const safeMessage = rawMessage.replace(/https?:\/\/\S+/gi, "[URL_REDACTED]");
      const isTimeout = errorName === "AbortError" || errorName === "TimeoutError";

      console.error("[복지서비스 목록 요청 실패]", {
        type: isTimeout ? "timeout" : diagnosticStage,
        status: apiResponse?.status ?? null,
        statusText: apiResponse?.statusText ?? null,
        errorName,
        errorMessage: safeMessage
      });

      const cachedData = await getCachedWelfareData(welfareCachePath, age, interests, onlineOnly);
      if (cachedData) return response.status(200).json(cachedData);

      if (isTimeout) {
        return response.status(504).json({
          error: "복지서비스 API 응답 시간이 초과되었습니다."
        });
      }

      return response.status(502).json({
        error: "복지서비스 데이터를 불러오지 못했습니다."
      });
    }
  });

  app.get("/api/welfare/:servId", async (request, response) => {
    const { servId } = request.params;

    if (!/^[A-Za-z0-9_-]{1,100}$/.test(servId)) {
      return response.status(400).json({
        error: "올바른 복지서비스 ID를 입력해 주세요."
      });
    }

    if (!hasConfiguredServiceKey(serviceKey)) {
      const cachedData = await getCachedDetailData(welfareDetailCacheDirectory, servId);
      if (cachedData) return response.status(200).json(cachedData);


      return response.status(500).json({
        error: "server/.env의 예시 값을 실제 공공데이터 API 키로 교체한 뒤 서버를 재시작해 주세요.",
        code: "API_KEY_NOT_CONFIGURED"
      });
    }

    const apiUrl = new URL(WELFARE_DETAIL_API_URL);
    apiUrl.searchParams.set("serviceKey", normalizeServiceKey(serviceKey));
    apiUrl.searchParams.set("callTp", "D");
    apiUrl.searchParams.set("servId", servId);

    let apiResponse;

    try {
      apiResponse = await fetchImpl(apiUrl, {
        method: "GET",
        headers: {
          Accept: "application/xml, text/xml"
        },
        signal: AbortSignal.timeout(30000)
      });

      const xml = await apiResponse.text();
      const data = xmlParser.parse(xml);
      const upstreamError = getUpstreamError(data);

      if (upstreamError) {
        if (apiResponse.status >= 500) {
          const cachedDetail = await getCachedWelfareDetail(welfareDetailCacheDirectory, servId);
          if (cachedDetail) return response.status(200).json(cachedDetail);
        }

        return response.status(502).json({
          error: "복지서비스 상세정보를 불러오지 못했습니다.",
          upstreamStatus: apiResponse.status,
          resultCode: upstreamError.resultCode,
          resultMessage: upstreamError.resultMessage
        });
      }

      if (!apiResponse.ok || !data?.wantedDtl?.servId) {
        if (apiResponse.status >= 500) {
          const cachedDetail = await getCachedWelfareDetail(welfareDetailCacheDirectory, servId);
          if (cachedDetail) return response.status(200).json(cachedDetail);
        }

        return response.status(404).json({
          error: "복지서비스 상세정보를 찾지 못했습니다."
        });
      }

      const normalizedDetail = normalizeWelfareDetail(data);

      try {
        await writeWelfareDetailCache(welfareDetailCacheDirectory, servId, normalizedDetail);
      } catch (cacheError) {
        console.warn("[복지서비스 상세 cache 저장 실패]", {
          errorName: cacheError?.name ?? "UnknownError",
          errorMessage: cacheError?.message ?? "오류 메시지 없음"
        });
      }

      return response.status(200).json({
        ...normalizedDetail,
        meta: {
          dataSource: "live",
          isStale: false
        }
      });
    } catch (error) {
      const errorName = typeof error?.name === "string" ? error.name : "UnknownError";
      const canUseCache =
        errorName === "AbortError" ||
        errorName === "TimeoutError" ||
        !apiResponse ||
        apiResponse.status >= 500;

      if (canUseCache) {
        const cachedDetail = await getCachedWelfareDetail(welfareDetailCacheDirectory, servId);
        if (cachedDetail) return response.status(200).json(cachedDetail);
      }

      return response.status(502).json({
        error: "복지서비스 상세정보를 불러오지 못했습니다."
      });
    }
  });


  app.post("/api/welfare/:servId/explain", async (request, response) => {
    try {
      const { servId } = request.params;
      const { persona, fitAnalysis, evidenceSnippets, programTitle } = request.body;

      const apiKey = process.env.GEMINI_API_KEY;
      console.log(`[AI Explainer] API Key Loaded: ${!!apiKey}`);
      if (!apiKey) {
        return response.status(200).json({
          summary: "AI 요약 기능이 설정되지 않았습니다. (.env에 GEMINI_API_KEY를 추가해 주세요)",
          eligibilityTip: "지원 조건은 하단의 자격 조건을 확인해 주세요.",
          checklistTip: "준비사항은 공식 공고문을 꼭 참조해 주세요."
        });
      }

      const systemInstruction = `당신은 대한민국 청년 복지정책을 알기 쉽게 해설해 주는 '지원핏(JiwonFit)' AI 어시스턴트입니다.
반드시 아래 규칙을 지켜주세요:
1. 주어진 근거(evidenceSnippets)와 판정 결과(fitAnalysis) 이외의 지원 금액이나 자격 요건을 절대 임의로 창작(Hallucination)하지 마세요.
2. 청년 신청자의 눈높이에 맞게 이해하기 쉬운 구어체(~해요, ~합니다)로 작성하세요.
3. 응답은 반드시 다음 JSON 스키마를 엄격히 따라야 합니다:
{
  "summary": "사업의 핵심 내용과 추천 이유 (3줄 요약 형태로 1문단)",
  "eligibilityTip": "신청자가 놓치기 쉬운 자격 요건이나 주의사항 (1~2문장)",
  "checklistTip": "미리 준비해야 할 서류나 체크 포인트 (1~2문장)"
}`;

      const prompt = `프로그램: ${programTitle} (ID: ${servId})
사용자 프로필: ${JSON.stringify(persona)}
Fit 판정 결과: ${JSON.stringify(fitAnalysis)}
공고문 근거 요약: ${JSON.stringify(evidenceSnippets)}
위 정보를 바탕으로 분석 결과를 JSON으로 반환해 주세요.`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: { text: systemInstruction } },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: "application/json" }
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        const err = new Error(`Gemini API Error ${res.status}: ${errorText}`);
        err.status = res.status;
        throw err;
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Empty response from Gemini");

      const parsed = JSON.parse(text);
      return response.status(200).json(parsed);

    } catch (error) {
      console.error("[Gemini Explain Error]", {
        message: error.message,
        status: error.status,
        stack: error.stack
      });
      return response.status(200).json({
        summary: "일시적인 오류로 AI 요약을 불러오지 못했습니다.",
        eligibilityTip: "하단의 상세 자격 조건을 통해 직접 확인해 주세요.",
        checklistTip: "공식 공고문의 유의사항을 꼼꼼히 읽어보시길 권장합니다."
      });
    }
  });

  return app;
}

const isDirectRun = process.argv[1] && serverFilePath === path.resolve(process.argv[1]);


const app = createApp();
export default app;

if (isDirectRun && !process.env.VERCEL) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const app = createApp();

  app.listen(port, () => {
    console.log(`복지서비스 API 서버가 http://localhost:${port} 에서 실행 중입니다.`);

    if (!hasConfiguredServiceKey(process.env.PUBLIC_DATA_API_KEY)) {
      console.warn("API 키 설정 필요: server/.env의 YOUR_API_KEY_HERE를 실제 키로 교체하고 서버를 재시작하세요.");
    }
  });
}
