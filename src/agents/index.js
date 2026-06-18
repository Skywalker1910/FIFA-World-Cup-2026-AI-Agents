import { OpenAIPredictor } from "./openaiPredictor.js";

export function createPredictor({ provider, openaiApiKey, openaiModel }) {
  switch (provider) {
    case "openai":
      return new OpenAIPredictor({
        apiKey: openaiApiKey,
        model: openaiModel,
      });
    case "claude":
      throw new Error("AI_PROVIDER=claude is planned for a future phase.");
    case "gemini":
      throw new Error("AI_PROVIDER=gemini is planned for a future phase.");
    default:
      throw new Error("AI_PROVIDER must be one of: openai, claude, gemini.");
  }
}
