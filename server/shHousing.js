import { load } from "cheerio";

const SH_LIST_URL =
  "https://www.i-sh.co.kr/app/lay2/program/S1T294C297/www/brd/m_247/list.do?multi_itm_seq=2&page=1";
const SH_DETAIL_URL =
  "https://www.i-sh.co.kr/app/lay2/program/S1T294C297/www/brd/m_247/view.do";

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

export function parseShHousingHtml(html) {
  const $ = load(html);
  const programs = [];

  $("table tbody tr").each((index, row) => {
    const detailLink = $(row).find('a[onclick*="getDetailView"]').first();
    if (detailLink.length === 0) return;

    const onclick = detailLink.attr("onclick") ?? "";
    const seq = onclick.match(/getDetailView\(['"](\d+)['"]\)/)?.[1];
    const title = normalizeWhitespace(detailLink.text());
    if (!seq || !title) return;

    const cells = $(row).find("td");
    const titleCellIndex = cells.index(detailLink.closest("td"));
    const department = normalizeWhitespace(cells.eq(titleCellIndex + 1).text());
    const publishedAt = normalizeWhitespace(cells.eq(titleCellIndex + 2).text());
    const officialDetailUrl = new URL(SH_DETAIL_URL);
    officialDetailUrl.searchParams.set("multi_itm_seq", "2");
    officialDetailUrl.searchParams.set("seq", seq);

    programs.push({
      id: `SH:${seq}`,
      source: "SH",
      title,
      provider: "서울주택도시개발공사",
      categories: ["주거"],
      publishedAt: /^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ? publishedAt : null,
      status: null,
      department: department || null,
      detailUrl: officialDetailUrl.toString()
    });
  });

  return programs.slice(0, 10);
}

export async function fetchShHousingPrograms(fetchImpl = fetch) {
  const response = await fetchImpl(SH_LIST_URL, {
    headers: {
      Accept: "text/html"
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error("SH_UPSTREAM_ERROR");
  }

  const programs = parseShHousingHtml(await response.text());
  if (programs.length === 0) {
    throw new Error("SH_HTML_STRUCTURE_ERROR");
  }

  return {
    source: "SH",
    programs
  };
}
