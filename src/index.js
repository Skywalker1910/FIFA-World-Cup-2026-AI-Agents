import "dotenv/config";
import { createPredictor } from "./agents/index.js";
import { AppClient } from "./appClient.js";
import { logger } from "./logger.js";
import {
  extractLoggedInUser,
  filterFixturesDueForPrediction,
  getEligibleFixtures,
  getUserDisplayName,
} from "./predictionSchema.js";

const REQUIRED_ENV = [
  "WORLD_CUP_APP_BASE_URL",
  "AGENT_LOGIN_ID",
  "AGENT_PASSWORD",
  "AGENT_SERVER",
];

async function main() {
  const config = loadConfig();
  const summary = {
    loggedInUser: config.loginId,
    server: config.server,
    eligibleFixturesFound: 0,
    dueFixturesFound: 0,
    predictionsGenerated: 0,
    predictionsSubmitted: 0,
    skippedMatches: [],
    openai: null,
    errors: [],
  };

  const appClient = new AppClient({ baseUrl: config.baseUrl });
  const predictor = createPredictor({
    provider: config.provider,
    openaiApiKey: config.openaiApiKey,
    openaiModel: config.openaiModel,
  });

  let didLogin = false;

  try {
    logger.info("Logging in to prediction app", { loginId: config.loginId });
    const loginResponse = await appClient.login({
      loginId: config.loginId,
      password: config.password,
    });
    didLogin = true;

    logger.info("Fetching app state", { server: config.server });
    const state = await appClient.fetchState({ server: config.server });
    const user = extractLoggedInUser(loginResponse, state);
    summary.loggedInUser = getUserDisplayName(user, config.loginId);

    const { eligible, skipped } = getEligibleFixtures(state, user);
    const scheduledSelection = selectFixturesForRun(eligible, config);
    const selectedFixtures = scheduledSelection.fixtures;
    summary.eligibleFixturesFound = eligible.length;
    summary.dueFixturesFound = selectedFixtures.length;
    summary.skippedMatches = [...skipped, ...scheduledSelection.skipped];

    logger.info("Eligible fixtures selected", {
      eligibleFixturesFound: eligible.length,
      predictionMode: config.predictionMode,
      dueFixturesFound: selectedFixtures.length,
      skippedMatches: summary.skippedMatches.length,
    });

    if (selectedFixtures.length === 0) {
      logger.info("No fixtures selected for this run. Nothing to predict.");
      return;
    }

    const predictionResult = await predictor.generatePredictions({
      fixtures: selectedFixtures,
      server: config.server,
      dryRun: config.dryRun,
    });
    const predictions = predictionResult.predictions;
    summary.predictionsGenerated = predictions.length;
    summary.openai = {
      responseId: predictionResult.responseId,
      model: predictionResult.model,
      usage: predictionResult.usage,
    };

    logger.info("OpenAI prediction response received", {
      responseId: summary.openai.responseId,
      model: summary.openai.model,
      inputTokens: summary.openai.usage?.input_tokens ?? null,
      outputTokens: summary.openai.usage?.output_tokens ?? null,
      totalTokens: summary.openai.usage?.total_tokens ?? null,
      reasoningTokens:
        summary.openai.usage?.output_tokens_details?.reasoning_tokens ?? null,
      cachedInputTokens:
        summary.openai.usage?.input_tokens_details?.cached_tokens ?? null,
    });

    if (config.dryRun) {
      logger.info("DRY_RUN=true. Predictions will not be submitted.");
      printPredictions(predictions);
      return;
    }

    for (const prediction of predictions) {
      try {
        await submitWithSingleRetry(appClient, {
          ...prediction,
          server: config.server,
        });
        summary.predictionsSubmitted += 1;
      } catch (error) {
        const message = `Failed to submit prediction for matchId ${prediction.matchId}: ${formatError(error)}`;
        summary.errors.push(message);
        logger.error(message);
      }
    }
  } catch (error) {
    const message = formatError(error);
    summary.errors.push(message);
    logger.error(message);
    process.exitCode = 1;
  } finally {
    if (didLogin) {
      try {
        await appClient.logout();
        logger.info("Logged out of prediction app.");
      } catch (error) {
        const message = `Logout failed: ${formatError(error)}`;
        summary.errors.push(message);
        logger.warn(message);
      }
    }

    printSummary(summary);
  }
}

function loadConfig() {
  const provider = parseProvider(process.env.AI_PROVIDER ?? "openai");
  const providerRequiredEnv = provider === "openai" ? ["OPENAI_API_KEY", "OPENAI_MODEL"] : [];
  const missing = [...REQUIRED_ENV, ...providerRequiredEnv].filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    provider,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL,
    baseUrl: process.env.WORLD_CUP_APP_BASE_URL,
    loginId: process.env.AGENT_LOGIN_ID,
    password: process.env.AGENT_PASSWORD,
    server: process.env.AGENT_SERVER,
    dryRun: parseBoolean(process.env.DRY_RUN, true),
    predictionMode: parsePredictionMode(process.env.PREDICTION_MODE ?? "all"),
    predictionLookaheadMinutes: parsePositiveInteger(
      process.env.PREDICTION_LOOKAHEAD_MINUTES,
      90,
      "PREDICTION_LOOKAHEAD_MINUTES",
    ),
    predictionWindowMinutes: parsePositiveInteger(
      process.env.PREDICTION_WINDOW_MINUTES,
      10,
      "PREDICTION_WINDOW_MINUTES",
    ),
  };
}

function parseProvider(value) {
  const normalized = String(value).trim().toLowerCase();
  if (["openai", "claude", "gemini"].includes(normalized)) {
    return normalized;
  }

  throw new Error("AI_PROVIDER must be one of: openai, claude, gemini.");
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parsePredictionMode(value) {
  const normalized = String(value).trim().toLowerCase();
  if (["all", "due", "next"].includes(normalized)) {
    return normalized;
  }

  throw new Error("PREDICTION_MODE must be one of: all, due, next.");
}

function parsePositiveInteger(value, defaultValue, envName) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer.`);
  }

  return parsed;
}

function selectFixturesForRun(eligibleFixtures, config) {
  if (config.predictionMode === "all") {
    return {
      fixtures: eligibleFixtures,
      skipped: [],
    };
  }

  if (config.predictionMode === "next") {
    return selectNextFixture(eligibleFixtures);
  }

  const { due, skipped } = filterFixturesDueForPrediction(eligibleFixtures, {
    lookaheadMinutes: config.predictionLookaheadMinutes,
    windowMinutes: config.predictionWindowMinutes,
  });

  return {
    fixtures: due,
    skipped,
  };
}

function selectNextFixture(eligibleFixtures) {
  const fixturesWithKickoff = [];
  const skipped = [];

  for (const fixture of eligibleFixtures) {
    const kickoffDate = getFixtureKickoffDate(fixture);
    if (!kickoffDate) {
      skipped.push({
        matchId: fixture.id ?? null,
        team1: fixture.team1 ?? null,
        team2: fixture.team2 ?? null,
        reasons: ["missing or invalid kickoff time"],
      });
      continue;
    }

    fixturesWithKickoff.push({
      fixture,
      kickoffTime: kickoffDate.getTime(),
    });
  }

  fixturesWithKickoff.sort((left, right) => left.kickoffTime - right.kickoffTime);
  const [nextFixture] = fixturesWithKickoff;

  if (!nextFixture) {
    return {
      fixtures: [],
      skipped,
    };
  }

  for (const item of fixturesWithKickoff.slice(1)) {
    skipped.push({
      matchId: item.fixture.id ?? null,
      team1: item.fixture.team1 ?? null,
      team2: item.fixture.team2 ?? null,
      kickoffTime: item.fixture.kickoffTime,
      reasons: ["not the next eligible fixture"],
    });
  }

  return {
    fixtures: [nextFixture.fixture],
    skipped,
  };
}

function getFixtureKickoffDate(fixture) {
  const value = fixture.kickoffTime;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const trimmedValue = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedValue)) {
      return null;
    }

    const date = new Date(trimmedValue);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function formatError(error) {
  if (!error || typeof error !== "object") {
    return String(error);
  }

  const parts = [];
  if (error.name) {
    parts.push(error.name);
  }
  if (error.status) {
    parts.push(`status=${error.status}`);
  }
  if (error.code) {
    parts.push(`code=${error.code}`);
  }
  if (error.message) {
    parts.push(error.message);
  }
  if (error.cause?.code) {
    parts.push(`cause.code=${error.cause.code}`);
  }
  if (error.cause?.message) {
    parts.push(`cause.message=${error.cause.message}`);
  }

  return parts.length > 0 ? parts.join(" | ") : "Unknown error";
}

async function submitWithSingleRetry(appClient, prediction) {
  try {
    return await appClient.submitPrediction(prediction);
  } catch (firstError) {
    logger.warn("Prediction submission failed once; retrying", {
      matchId: prediction.matchId,
      error: formatError(firstError),
    });
    return appClient.submitPrediction(prediction);
  }
}

function printPredictions(predictions) {
  console.log(JSON.stringify(predictions, null, 2));
}

function printSummary(summary) {
  logger.info("Final summary", {
    loggedInUser: summary.loggedInUser,
    server: summary.server,
    eligibleFixturesFound: summary.eligibleFixturesFound,
    dueFixturesFound: summary.dueFixturesFound,
    predictionsGenerated: summary.predictionsGenerated,
    predictionsSubmitted: summary.predictionsSubmitted,
    openaiResponseId: summary.openai?.responseId ?? null,
    openaiModel: summary.openai?.model ?? null,
    openaiTotalTokens: summary.openai?.usage?.total_tokens ?? null,
    skippedMatches: summary.skippedMatches.length,
    errors: summary.errors.length,
  });

  if (summary.skippedMatches.length > 0) {
    logger.info("Skipped match details", {
      skippedMatches: summary.skippedMatches,
    });
  }

  if (summary.errors.length > 0) {
    logger.error("Error details", {
      errors: summary.errors,
    });
  }
}

main();
