const WELFARE_API_URL =
  "http://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decodeXmlEntities(value) {
  const namedEntities = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'"
  };

  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code) => {
    if (code.toLowerCase().startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }

    if (code.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    }

    return namedEntities[code.toLowerCase()] ?? entity;
  });
}

function parseAttributes(source) {
  const attributes = {};
  const attributePattern = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match = attributePattern.exec(source);

  while (match) {
    attributes[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? "");
    match = attributePattern.exec(source);
  }

  return attributes;
}

function addChild(parent, child) {
  if (!parent.children[child.name]) {
    parent.children[child.name] = [];
  }

  parent.children[child.name].push(child);
}

function convertNode(node) {
  const childNames = Object.keys(node.children);
  const text = decodeXmlEntities(node.textParts.join("").trim());
  const hasAttributes = Object.keys(node.attributes).length > 0;

  if (childNames.length === 0 && !hasAttributes) {
    return text;
  }

  const result = {};

  if (hasAttributes) {
    result._attributes = node.attributes;
  }

  if (text) {
    result._text = text;
  }

  childNames.forEach((childName) => {
    const values = node.children[childName].map(convertNode);
    result[childName] = values.length === 1 ? values[0] : values;
  });

  return result;
}

// 외부 라이브러리 없이 XML 요소를 JavaScript 객체로 변환합니다.
// 같은 이름의 요소가 반복되면 배열로 보존합니다.
function parseXml(xml) {
  const documentNode = {
    name: "_document",
    attributes: {},
    children: {},
    textParts: []
  };
  const stack = [documentNode];
  const tokens = xml.match(/<!--[\s\S]*?-->|<\?[^?]*\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g) ?? [];

  tokens.forEach((token) => {
    if (token.startsWith("<?") || token.startsWith("<!--") || token.startsWith("<!DOCTYPE")) {
      return;
    }

    if (token.startsWith("<![CDATA[")) {
      stack.at(-1).textParts.push(token.slice(9, -3));
      return;
    }

    if (token.startsWith("</")) {
      if (stack.length === 1) {
        throw new Error("올바르지 않은 XML 종료 태그입니다.");
      }

      const closingName = token.slice(2, -1).trim();
      const currentNode = stack.pop();

      if (currentNode.name !== closingName) {
        throw new Error("XML 태그 구조가 일치하지 않습니다.");
      }
      return;
    }

    if (token.startsWith("<")) {
      const isSelfClosing = token.endsWith("/>");
      const openingTag = token.match(/^<([A-Za-z_][\w:.-]*)([\s\S]*?)\/?\s*>$/);

      if (!openingTag) {
        throw new Error("지원하지 않는 XML 태그 형식입니다.");
      }

      const node = {
        name: openingTag[1],
        attributes: parseAttributes(openingTag[2]),
        children: {},
        textParts: []
      };

      addChild(stack.at(-1), node);

      if (!isSelfClosing) {
        stack.push(node);
      }
      return;
    }

    if (token.trim()) {
      stack.at(-1).textParts.push(token);
    }
  });

  if (stack.length !== 1) {
    throw new Error("XML 문서가 완전히 닫히지 않았습니다.");
  }

  const rootNames = Object.keys(documentNode.children);

  if (rootNames.length !== 1 || documentNode.children[rootNames[0]].length !== 1) {
    throw new Error("XML 최상위 요소를 확인할 수 없습니다.");
  }

  const rootName = rootNames[0];
  return { [rootName]: convertNode(documentNode.children[rootName][0]) };
}

export async function GET() {
  const serviceKey = process.env.PUBLIC_DATA_API_KEY;

  if (!serviceKey) {
    return Response.json(
      { error: "PUBLIC_DATA_API_KEY 환경변수가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  const apiUrl = new URL(WELFARE_API_URL);
  apiUrl.searchParams.set("serviceKey", serviceKey);
  apiUrl.searchParams.set("callTp", "L");
  apiUrl.searchParams.set("pageNo", "1");
  apiUrl.searchParams.set("numOfRows", "10");
  apiUrl.searchParams.set("lifeArray", "004");

  try {
    const apiResponse = await fetch(apiUrl, {
      method: "GET",
      headers: { Accept: "application/xml, text/xml" },
      cache: "no-store"
    });

    if (!apiResponse.ok) {
      return Response.json(
        {
          error: "복지서비스 API가 정상 응답하지 않았습니다.",
          upstreamStatus: apiResponse.status
        },
        { status: 502 }
      );
    }

    const xml = await apiResponse.text();
    const data = parseXml(xml);

    return Response.json(data, {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    // 오류 객체에는 요청 URL이 포함될 수 있으므로 인증키 보호를 위해 상세 내용을 반환하지 않습니다.
    return Response.json(
      { error: "복지서비스 API 응답을 처리하지 못했습니다." },
      { status: 502 }
    );
  }
}
