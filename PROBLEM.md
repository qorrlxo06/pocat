# Trouble Shooting: 지원핏 캐시 방어선(Fallback) 동작 실패 현상

## 🚨 문제 상황 (Symptom)
*   **현상**: 사용자가 앱을 이용하던 중 공공데이터포털 연동(또는 API 키 미설정/만료) 에러가 발생했을 때, 로컬에 저장된 `cache/welfare-programs.json` 파일을 가져와 화면에 뿌려주는 Fallback 방어 로직이 정상 작동하지 않았습니다.
*   **결과**: 프론트엔드 모듈에서 `WELFARE_API_ERROR` 예외가 발생하여 사용자 화면에 "지원사업 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."라는 심각한 오류 상태가 노출되었습니다.

## 🔍 원인 분석 (Root Cause)
점검 결과 프론트엔드(`js/api.js`, `js/app.js`)의 응답 파싱 및 모듈 구조에는 전혀 문제가 없었으며, 백엔드(`server.js`)의 **캐시 탐색 및 에러 핸들링 조건**에서 문제가 발생하고 있었습니다.

1.  **과도하게 엄격한 캐시 반환 조건 (`age`, `onlineOnly`)**
    *   `server.js`의 `getCachedWelfareData()`는 캐시를 읽어올 때, 기존 파일에 기록된 `criteria.age` 값과 현재 요청자의 `age`가 완벽히 일치하지 않으면 캐시 반환을 강제로 거부(`return null;`)하도록 되어 있었습니다.
    *   따라서 API가 죽어있는 상태에서 24세 사용자가 접속했을 때 캐시 파일이 23세 기준으로 저장된 상태라면 캐시가 기각되어 502 에러가 발생했습니다.
2.  **API 키 누락 상태에서의 예외 처리 부재**
    *   `.env`에 API 키가 설정되지 않은 경우(`API_KEY_NOT_CONFIGURED`) 예외로 빠질 때, 해당 블록에서는 캐시를 찾아보지도 않고 즉시 `500 Internal Server Error`를 프론트로 던졌습니다.

## 🛠 해결 방안 및 적용 내역 (Resolution)

백엔드 서버 코드(`server/server.js`)를 수정하여 **캐시 무효화 조건을 대폭 완화**하고 Fallback 연결 고리를 복구했습니다.

1.  **캐시 제공 조건 완화 (Strict Criteria 차단)**
    ```javascript
    // (수정 후: 나이/온라인 여부가 달라도 일단 캐시 원본을 내어줌)
    // if (cacheData.criteria.age !== (age ?? null)) return null;
    // if (cacheData.criteria.onlineOnly && onlineOnly !== "true") return null;
    ```
    *   캐시 생성 시점의 조건이 다르더라도 백엔드는 캐시를 포기하지 않고 프론트로 전송합니다.
    *   나이(`age`) 등이 다르더라도 프론트엔드의 `fitEngine.js`가 브라우저 단에서 사용자의 정보에 맞게 지원사업 리스트를 실시간으로 재필터링(정규표현식 기반 Fit 판정)하므로, 오탐(False Positive) 위험 없이 안정적인 렌더링이 보장됩니다.
2.  **API Key 에러 블록에 Fallback 연동**
    ```javascript
    if (!hasConfiguredServiceKey(serviceKey)) {
      // API Key가 없어도 캐시 파일이 있다면 프론트엔드에 전달 (수정 반영)
      const cachedData = await getCachedWelfareData(welfareCachePath, age, interests, onlineOnly);
      if (cachedData) return response.status(200).json(cachedData);

      return response.status(500).json({ ... });
    }
    ```
    *   OpenAPI 키 누락 에러 발생 시에도 `getCachedWelfareData()`를 호출하도록 로직을 보강했습니다.

## ✅ 최종 결과
이제 공공 API 접속에 장애가 생기더라도 백엔드와 프론트엔드가 유기적으로 `Meta: { isStale: true }` 계약을 처리합니다. 화면에서는 오류 창 대신 **"현재 공공데이터 연결이 지연되고 있어 마지막으로 정상 저장된 지원사업 정보를 표시하고 있습니다"**라는 안내 문구와 함께 캐싱된 지원사업 리스트가 안전하게 표출됩니다.

<br><br>

# Trouble Shooting: 프론트엔드 모듈 분리(Phase 2)에 따른 ReferenceError 발생

## 🚨 문제 상황 (Symptom)
*   **현상**: 백엔드 캐시 방어 로직(Fallback)을 성공적으로 복구한 후에도, 브라우저 환경에서 검색 시 "지원사업 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." 라는 오류 메시지가 여전히 표출되었습니다.
*   **결과**: 프론트엔드 예외 처리(`catch` 블록) 로그를 상세하게 출력(`error.message`, `error.stack`)하도록 보완한 결과, 브라우저 콘솔에서 `ReferenceError: lastRenderedHash is not defined` 런타임 에러가 확인되었습니다.

## 🔍 원인 분석 (Root Cause)
모놀리식 구조였던 `app.js`를 역할별 ES 모듈(`state.js`, `render.js`, `api.js` 등)로 분리(Phase 2 리팩터링)하는 과정에서 발생한 전역 변수 참조 오류입니다.

1.  **ES Module의 Strict Mode와 암묵적 전역 변수 할당 불가**
    *   기존 단일 파일 구조에서는 전역 공간에 `let lastRenderedHash` 등의 상태 변수를 선언하여 사용했으나, 모듈 분리 후 이를 `export const state = { ... }` 객체 내부로 통합했습니다.
    *   하지만 `js/state.js` 내의 라우팅 함수(`renderRoute`) 등에서 이 변수에 값을 재할당할 때 `state.lastRenderedHash = ...`와 같이 객체 속성으로 접근하지 않고, `lastRenderedHash = ...` 형태로 식별자에 직접 할당을 시도했습니다.
    *   ES Module은 브라우저 상에서 기본적으로 엄격 모드(Strict Mode, `"use strict"`)로 동작하므로, 선언되지 않은 변수에 암묵적 할당을 시도하면 즉각적으로 `ReferenceError`가 발생하여 프로세스가 중단(Crash)되었습니다.
2.  **모듈 순환 참조 및 최적화 이슈**
    *   상태(`state`) 객체를 가져다 쓰는 일부 파일(`js/render.js` 등)에서 `import { state } from './state.js';` 구문이 모듈 최상단이 아닌 파일 중간에 위치해 있어 잠재적인 로드 순서 에러를 유발할 수 있었습니다.
    *   `js/app.js` 내부에 이벤트 리스너 리팩터링 도중 `form.addEventListener("submit", ...)` 블록이 중복 선언되어 있어 오류가 두 번 연속으로 트리거되고 있었습니다.

## 🛠 해결 방안 및 적용 내역 (Resolution)
프론트엔드 코드베이스 전반에 대해 식별자 전수 스캔 및 디버깅을 수행하여 모든 결함을 수정했습니다.

1.  **상태 객체 참조(Prefix) 복구 (`js/state.js`)**
    ```javascript
    // (수정 전: 모듈 스코프에 선언되지 않은 식별자 참조로 에러 발생)
    lastRenderedHash = window.location.hash;
    lastRenderedRoute = route.name;

    // (수정 후: 통합된 state 객체의 속성에 정상적으로 할당)
    state.lastRenderedHash = window.location.hash;
    state.lastRenderedRoute = route.name;
    ```
2.  **전체 코드베이스 식별자 전수 스캔 및 이벤트 리스너 정리**
    *   전체 JS 파일을 스캔하여 `resultsScrollPosition`, `preparationChecklistState`, `currentPolicyEvidenceContext` 등 여타 상태 변수들은 `state.` 접두사를 모두 안전하게 달고 있는지 교차 검증을 완료했습니다.
    *   `js/app.js` 하단에 중복 삽입되어 있던 제출(`submit`) 이벤트 리스너 블록을 삭제하여 폼이 두 번 전송되는 버그를 잡았습니다.
3.  **모듈 Import 최상단 배치 및 클리닝**
    *   `js/render.js`에서 파일 중간 라인에 있었던 `import { state }` 문구를 최상단으로 끌어올려 Hoisting 의존성 및 초기화(TDZ) 에러 가능성을 원천 차단했습니다.
    *   `js/state.js` 내에서 Import 했으나 쓰이지 않던 미사용 의존성(`form`, `additionalInfoQuestions`)을 정리했습니다.

## ✅ 최종 결과
브라우저 환경에서 발생하던 `ReferenceError` 및 중복 호출 이슈가 완벽히 소거되었습니다. 
서버가 완전히 오프라인인 상태이거나 공공데이터포털(API) 접속 불가 상황이어도, 프론트엔드가 백엔드의 Fallback 캐시(`isStale: true`) 데이터를 무사히 건네받아 검색 결과 화면(results view)으로 부드럽게 렌더링하고 전환합니다.
