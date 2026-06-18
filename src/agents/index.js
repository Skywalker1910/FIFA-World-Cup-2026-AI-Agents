import { ClaudePredictor } from "./claudePredictor.js";
import { GeminiPredictor } from "./geminiPredictor.js";
import { OpenAIPredictor } from "./openaiPredictor.js";

export function createPredictor({ provider, openaiApiKey, openaiModel }) {
  switch (provider) {
    case "openai":
      return new OpenAIPredictor({
        apiKey: openaiApiKey,
        model: openaiModel,
      });
    case "claude":
      return new ClaudePredictor();
    case "gemini":
      return new GeminiPredictor();
    default:
      throw new Error("AI_PROVIDER must be one of: openai, claude, gemini.");
  }
}
