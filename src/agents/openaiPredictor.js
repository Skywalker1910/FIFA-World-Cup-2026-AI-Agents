import OpenAI from "openai";
import { validatePredictions } from "../predictionSchema.js";

export class OpenAIPredictor {
  constructor({ apiKey, model }) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required.");
    }
    if (!model) {
      throw new Error("OPENAI_MODEL is required.");
    }

    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generatePredictions({ fixtures, server, dryRun }) {
    if (fixtures.length === 0) {
      return {
        predictions: [],
        usage: null,
        responseId: null,
        model: this.model,
      };
    }

    const response = await this.client.responses.create({
      model: this.model,
      metadata: {
        app: "fifa-world-cup-2026-ai-agent",
        server,
        dryRun: String(Boolean(dryRun)),
        eligibleFixtures: String(fixtures.length),
      },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You are participating in a private FIFA World Cup 2026 prediction game.",
                "Choose realistic predictions based on team strength, tournament context, and conservative football scoring.",
                "Do not invent teams, match IDs, or fixtures.",
                "Return only valid JSON matching the requested schema.",
                "Use only these pick values: Team 1, Team 2, Draw.",
                "Include a short reason for each pick.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(
                {
                  server,
                  instructions:
                    "Generate one prediction for each eligible fixture. Return a JSON object with a predictions array only.",
                  schema: {
                    predictions: [
                      {
                        matchId: 1,
                        pick: "Team 1",
                        predictedTeam1Score: 2,
                        predictedTeam2Score: 1,
                        reason: "Short reason",
                      },
                    ],
                  },
                  eligibleFixtures: fixtures.map((fixture) => ({
                    matchId: fixture.id,
                    team1: fixture.team1,
                    team2: fixture.team2,
                    kickoffTime: fixture.kickoffTime,
                    group: fixture.group,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "world_cup_predictions",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["predictions"],
            properties: {
              predictions: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "matchId",
                    "pick",
                    "predictedTeam1Score",
                    "predictedTeam2Score",
                    "reason",
                  ],
                  properties: {
                    matchId: {
                      anyOf: [{ type: "integer" }, { type: "string" }],
                    },
                    pick: {
                      type: "string",
                      enum: ["Team 1", "Team 2", "Draw"],
                    },
                    predictedTeam1Score: {
                      type: "integer",
                      minimum: 0,
                    },
                    predictedTeam2Score: {
                      type: "integer",
                      minimum: 0,
                    },
                    reason: {
                      type: "string",
                      minLength: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const outputText = response.output_text;
    if (!outputText) {
      throw new Error("OpenAI returned an empty prediction response.");
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(outputText);
    } catch (error) {
      throw new Error("OpenAI returned invalid JSON.");
    }

    return {
      predictions: validatePredictions(parsedResponse.predictions, fixtures),
      usage: response.usage ?? null,
      responseId: response.id ?? null,
      model: response.model ?? this.model,
    };
  }
}
