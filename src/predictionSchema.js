export const VALID_PICKS = new Set(["Team 1", "Team 2", "Draw"]);

export function isPlaceholderTeamName(teamName) {
  if (typeof teamName !== "string" || teamName.trim().length === 0) {
    return true;
  }

  const normalized = teamName.trim().toLowerCase();
  const placeholderPatterns = [
    /^winner\b/,
    /^runner-up\b/,
    /^runner up\b/,
    /^loser\b/,
    /^tbd$/,
    /^to be decided$/,
    /^team\s*[12]$/,
    /^group\s+[a-z]\s+(winner|runner-up|runner up)$/,
    /placeholder/,
  ];

  return placeholderPatterns.some((pattern) => pattern.test(normalized));
}

export function normalizeMatch(rawMatch) {
  const team1 =
    rawMatch.team1 ??
    rawMatch.team1Name ??
    rawMatch.homeTeam ??
    rawMatch.homeTeamName ??
    rawMatch.teamA ??
    rawMatch.teamAName;
  const team2 =
    rawMatch.team2 ??
    rawMatch.team2Name ??
    rawMatch.awayTeam ??
    rawMatch.awayTeamName ??
    rawMatch.teamB ??
    rawMatch.teamBName;

  return {
    id: rawMatch.id ?? rawMatch.matchId,
    team1,
    team2,
    kickoffTime:
      rawMatch.kickoffAt ??
      rawMatch.kickoff_at ??
      rawMatch.kickoffTime ??
      rawMatch.startTime ??
      rawMatch.date ??
      rawMatch.matchTime ??
      null,
    group: rawMatch.group ?? rawMatch.stage ?? rawMatch.round ?? null,
    locked: Boolean(rawMatch.locked ?? rawMatch.isLocked),
    ended: Boolean(
      rawMatch.ended ??
        rawMatch.isEnded ??
        rawMatch.settled ??
        rawMatch.isSettled ??
        rawMatch.completed ??
        rawMatch.isComplete ??
        rawMatch.result ??
        ["FT", "AET", "PEN", "FINISHED"].includes(String(rawMatch.status ?? rawMatch.match_status ?? "").toUpperCase()),
    ),
    raw: rawMatch,
  };
}

export function extractFixtures(state) {
  const candidates = [
    state?.fixtures,
    state?.matches,
    state?.data?.fixtures,
    state?.data?.matches,
    state?.state?.fixtures,
    state?.state?.matches,
  ];

  const fixtures = candidates.find(Array.isArray);
  if (!fixtures) {
    throw new Error("Could not find fixtures in app state response.");
  }

  return fixtures.map(normalizeMatch);
}

export function extractLoggedInUser(loginResponse, state) {
  return (
    loginResponse?.user ??
    loginResponse?.player ??
    state?.currentUser ??
    state?.user ??
    state?.player ??
    state?.data?.currentUser ??
    state?.data?.user ??
    state?.data?.player ??
    null
  );
}

export function getUserDisplayName(user, fallbackLoginId) {
  return (
    user?.name ??
    user?.displayName ??
    user?.username ??
    user?.loginId ??
    user?.id ??
    fallbackLoginId
  );
}

export function extractExistingPredictionMatchIds(state, user) {
  const userId = user?.id ?? user?.userId ?? user?.playerId ?? null;
  const loginId = user?.loginId ?? user?.username ?? null;
  const candidateCollections = [
    state?.predictions,
    state?.bets,
    state?.myPredictions,
    state?.myBets,
    state?.data?.predictions,
    state?.data?.bets,
    state?.data?.myPredictions,
    state?.data?.myBets,
  ].filter(Array.isArray);

  const matchIds = new Set();
  for (const collection of candidateCollections) {
    for (const prediction of collection) {
      const belongsToCurrentUser =
        prediction.userId === undefined &&
        prediction.playerId === undefined &&
        prediction.loginId === undefined
          ? true
          : prediction.userId === userId ||
            prediction.playerId === userId ||
            prediction.loginId === loginId;

      if (!belongsToCurrentUser) {
        continue;
      }

      const matchId = prediction.matchId ?? prediction.fixtureId;
      if (matchId !== undefined && matchId !== null) {
        matchIds.add(String(matchId));
      }
    }
  }

  return matchIds;
}

export function getEligibleFixtures(state, user, { allowUpdateExisting = false } = {}) {
  const fixtures = extractFixtures(state);
  const existingPredictionMatchIds = extractExistingPredictionMatchIds(state, user);
  const skipped = [];
  const eligible = [];

  for (const fixture of fixtures) {
    const reasons = [];

    if (fixture.id === undefined || fixture.id === null) {
      reasons.push("missing match id");
    }
    if (!allowUpdateExisting && hasExistingPrediction(fixture, user, existingPredictionMatchIds)) {
      reasons.push("already predicted");
    }
    if (fixture.locked) {
      reasons.push("locked");
    }
    if (fixture.ended) {
      reasons.push("ended or settled");
    }
    if (isPlaceholderTeamName(fixture.team1) || isPlaceholderTeamName(fixture.team2)) {
      reasons.push("placeholder or invalid team");
    }

    if (reasons.length > 0) {
      skipped.push({
        matchId: fixture.id ?? null,
        team1: fixture.team1 ?? null,
        team2: fixture.team2 ?? null,
        reasons,
      });
      continue;
    }

    eligible.push(fixture);
  }

  return { eligible, skipped };
}

function hasExistingPrediction(fixture, user, existingPredictionMatchIds) {
  if (existingPredictionMatchIds.has(String(fixture.id))) {
    return true;
  }

  if (fixture.raw?.myPrediction || fixture.raw?.myPick) {
    return true;
  }

  const userId = user?.id ?? user?.userId ?? user?.playerId ?? null;
  if (userId !== null && fixture.raw?.bets && typeof fixture.raw.bets === "object") {
    return Boolean(fixture.raw.bets[userId]);
  }

  return false;
}

export function filterFixturesDueForPrediction(
  fixtures,
  {
    now = new Date(),
    lookaheadMinutes = 90,
    windowMinutes = 10,
  } = {},
) {
  const due = [];
  const skipped = [];
  const targetStart = now.getTime() + lookaheadMinutes * 60 * 1000;
  const targetEnd = targetStart + windowMinutes * 60 * 1000;

  for (const fixture of fixtures) {
    const kickoffDate = parseKickoffTime(fixture.kickoffTime);
    if (!kickoffDate) {
      skipped.push({
        matchId: fixture.id ?? null,
        team1: fixture.team1 ?? null,
        team2: fixture.team2 ?? null,
        reasons: ["missing or invalid kickoff time"],
      });
      continue;
    }

    const kickoffTime = kickoffDate.getTime();
    if (kickoffTime < targetStart || kickoffTime >= targetEnd) {
      skipped.push({
        matchId: fixture.id ?? null,
        team1: fixture.team1 ?? null,
        team2: fixture.team2 ?? null,
        kickoffTime: fixture.kickoffTime,
        minutesUntilKickoff: Math.round((kickoffTime - now.getTime()) / 60000),
        reasons: ["outside scheduled prediction window"],
      });
      continue;
    }

    due.push(fixture);
  }

  return { due, skipped };
}

function parseKickoffTime(value) {
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

export function validatePredictions(predictions, eligibleFixtures) {
  if (!Array.isArray(predictions)) {
    throw new Error("OpenAI response must be a JSON array.");
  }

  const eligibleMatchIds = new Set(eligibleFixtures.map((fixture) => String(fixture.id)));
  const seenMatchIds = new Set();
  const validated = [];

  for (const [index, prediction] of predictions.entries()) {
    if (!prediction || typeof prediction !== "object" || Array.isArray(prediction)) {
      throw new Error(`Prediction at index ${index} must be an object.`);
    }

    const matchId = prediction.matchId;
    if (!eligibleMatchIds.has(String(matchId))) {
      throw new Error(`Prediction at index ${index} has ineligible matchId: ${matchId}.`);
    }

    if (seenMatchIds.has(String(matchId))) {
      throw new Error(`Duplicate prediction for matchId: ${matchId}.`);
    }
    seenMatchIds.add(String(matchId));

    if (!VALID_PICKS.has(prediction.pick)) {
      throw new Error(
        `Prediction for matchId ${matchId} has invalid pick: ${prediction.pick}.`,
      );
    }

    if (!Number.isInteger(prediction.predictedTeam1Score) || prediction.predictedTeam1Score < 0) {
      throw new Error(`Prediction for matchId ${matchId} has invalid team 1 score.`);
    }

    if (!Number.isInteger(prediction.predictedTeam2Score) || prediction.predictedTeam2Score < 0) {
      throw new Error(`Prediction for matchId ${matchId} has invalid team 2 score.`);
    }

    validated.push({
      matchId,
      pick: prediction.pick,
      predictedTeam1Score: prediction.predictedTeam1Score,
      predictedTeam2Score: prediction.predictedTeam2Score,
      reason:
        typeof prediction.reason === "string" && prediction.reason.trim().length > 0
          ? prediction.reason.trim()
          : "No reason provided.",
    });
  }

  return validated;
}
