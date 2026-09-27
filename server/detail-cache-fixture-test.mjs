import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "./server.js";

const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), "welfare-detail-cache-"));
const xml = (servId) => `<?xml version="1.0" encoding="UTF-8"?>
<wantedDtl>
  <servId>${servId}</servId>
  <servNm>Fixture 상세</servNm>
  <tgtrDtlCn>Fixture 대상</tgtrDtlCn>
</wantedDtl>`;

async function requestWith(fetchImpl, servId) {
  const app = createApp({
    fetchImpl,
    serviceKey: "fixture-key",
    welfareDetailCacheDirectory: cacheDirectory
  });
  const layer = app.router.stack.find((item) => item.route?.path === "/api/welfare/:servId");
  const handler = layer.route.stack[0].handle;
  const result = { status: 200, body: null };
  const response = {
    status(value) {
      result.status = value;
      return this;
    },
    json(value) {
      result.body = value;
      return this;
    }
  };

  await handler({ params: { servId } }, response);
  return result;
}

const timeoutFetch = async () => {
  throw new DOMException("fixture timeout", "TimeoutError");
};

try {
  const live = await requestWith(async (url) => {
    const servId = new URL(url).searchParams.get("servId");
    return new Response(xml(servId), { status: 200 });
  }, "WLF_FIXTURE_A");
  const stored = JSON.parse(await readFile(path.join(cacheDirectory, "WLF_FIXTURE_A.json"), "utf8"));
  const fallback = await requestWith(timeoutFetch, "WLF_FIXTURE_A");
  const noCache = await requestWith(timeoutFetch, "WLF_FIXTURE_NONE");
  const isolated = await requestWith(timeoutFetch, "WLF_FIXTURE_B");

  const results = {
    A: live.status === 200 && live.body.meta?.dataSource === "live" && live.body.meta?.isStale === false && stored.detail?.program?.id === "WLF_FIXTURE_A",
    B: fallback.status === 200 && fallback.body.meta?.dataSource === "cache" && fallback.body.meta?.isStale === true && Boolean(fallback.body.meta?.cachedAt),
    C: noCache.status === 502 && noCache.body.error === "복지서비스 상세정보를 불러오지 못했습니다.",
    D: isolated.status === 502 && isolated.body.meta === undefined
  };
  console.log(JSON.stringify(results));
  if (Object.values(results).some((result) => !result)) process.exitCode = 1;
} finally {
  await rm(cacheDirectory, { recursive: true, force: true });
}
