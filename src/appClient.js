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
    return this.requestWithRetry(`/api/state?server=${encodeURIComponent(server)}`, {
      method: "GET",
      attempts: 5,
      initialDelayMs: 500,
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

  async requestWithRetry(path, { attempts, initialDelayMs, ...requestOptions }) {
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.request(path, requestOptions);
      } catch (error) {
        lastError = error;
        if (attempt === attempts || !isRetryableApiError(error)) {
          throw error;
        }

        await delay(initialDelayMs * 2 ** (attempt - 1));
      }
    }

    throw lastError;
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

function isRetryableApiError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("database is locked") ||
    message.includes("sqlite_busy") ||
    message.includes("failed with 500") ||
    message.includes("failed with 502") ||
    message.includes("failed with 503") ||
    message.includes("failed with 504")
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
