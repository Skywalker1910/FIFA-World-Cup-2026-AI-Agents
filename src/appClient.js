export class AppClient {
  constructor({ baseUrl, fetchImpl = fetch }) {
    if (!baseUrl) {
      throw new Error("WORLD_CUP_APP_BASE_URL is required.");
    }

    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.cookieHeader = "";
  }

  async login({ loginId, password }) {
    const response = await this.request("/api/login", {
      method: "POST",
      body: {
        loginId,
        password,
      },
      includeCookie: false,
    });

    return response;
  }

  async fetchState({ server }) {
    return this.request(`/api/state?server=${encodeURIComponent(server)}`, {
      method: "GET",
    });
  }

  async submitPrediction({ matchId, server, pick, predictedTeam1Score, predictedTeam2Score }) {
    return this.request("/api/bets", {
      method: "POST",
      body: {
        matchId,
        server,
        pick,
        predictedTeam1Score,
        predictedTeam2Score,
      },
    });
  }

  async logout() {
    return this.request("/api/logout", {
      method: "POST",
    });
  }

  async request(path, { method, body, includeCookie = true }) {
    const headers = {
      Accept: "application/json",
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (includeCookie && this.cookieHeader) {
      headers.Cookie = this.cookieHeader;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    this.captureCookies(response);

    const responseText = await response.text();
    const payload = parseJsonResponse(responseText, path);

    if (!response.ok) {
      const detail =
        payload?.error ??
        payload?.message ??
        response.statusText ??
        "Unknown API error";
      throw new Error(`${method} ${path} failed with ${response.status}: ${detail}`);
    }

    return payload;
  }

  captureCookies(response) {
    const setCookieHeaders = getSetCookieHeaders(response.headers);
    if (setCookieHeaders.length === 0) {
      return;
    }

    const cookiePairs = new Map();

    if (this.cookieHeader) {
      for (const cookiePair of this.cookieHeader.split(";")) {
        const [name, ...valueParts] = cookiePair.trim().split("=");
        if (name) {
          cookiePairs.set(name, valueParts.join("="));
        }
      }
    }

    for (const setCookieHeader of setCookieHeaders) {
      const [cookiePair] = setCookieHeader.split(";");
      const [name, ...valueParts] = cookiePair.trim().split("=");
      if (name) {
        cookiePairs.set(name, valueParts.join("="));
      }
    }

    this.cookieHeader = Array.from(cookiePairs.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const setCookie = headers.get("set-cookie");
  if (!setCookie) {
    return [];
  }

  return splitCombinedSetCookieHeader(setCookie);
}

function splitCombinedSetCookieHeader(header) {
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]+)/);
}

function parseJsonResponse(responseText, path) {
  if (!responseText) {
    return {};
  }

  try {
    return JSON.parse(responseText);
  } catch (error) {
    throw new Error(`Expected JSON response from ${path}, but received invalid JSON.`);
  }
}
