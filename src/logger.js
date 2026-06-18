const REDACTED_KEYS = new Set([
  "OPENAI_API_KEY",
  "AGENT_PASSWORD",
  "password",
  "apiKey",
  "api_key",
]);

function redactValue(key, value) {
  if (REDACTED_KEYS.has(key)) {
    return "[REDACTED]";
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return redactObject(value);
  }

  return value;
}

function redactObject(input) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, redactValue(key, value)]),
  );
}

function timestamp() {
  return new Date().toISOString();
}

export const logger = {
  info(message, meta) {
    if (meta) {
      console.log(`[${timestamp()}] INFO ${message}`, redactObject(meta));
      return;
    }

    console.log(`[${timestamp()}] INFO ${message}`);
  },

  warn(message, meta) {
    if (meta) {
      console.warn(`[${timestamp()}] WARN ${message}`, redactObject(meta));
      return;
    }

    console.warn(`[${timestamp()}] WARN ${message}`);
  },

  error(message, meta) {
    if (meta) {
      console.error(`[${timestamp()}] ERROR ${message}`, redactObject(meta));
      return;
    }

    console.error(`[${timestamp()}] ERROR ${message}`);
  },
};
