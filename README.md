# FIFA World Cup 2026 AI Prediction Agent

Phase-1 Node.js agent that logs in to the FIFA World Cup 2026 prediction app as a normal player, reads eligible fixtures, asks OpenAI for structured predictions, and optionally submits those predictions through the app's HTTP APIs.

This project is intentionally independent from the main web app repository.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with a normal player account created in the main app Command Center.

If local Windows runs fail with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, use `npm run dry-run:system-ca` or `npm run start:system-ca`. GitHub Actions uses normal Node because some Linux runner Node versions reject `--use-system-ca`.

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `AI_PROVIDER` | No | `openai` | Prediction provider. `claude` and `gemini` are reserved for future phases. |
| `OPENAI_API_KEY` | Yes | None | OpenAI API key. Never commit this value. |
| `OPENAI_MODEL` | Yes | `gpt-5.5` | OpenAI model used for predictions. |
| `WORLD_CUP_APP_BASE_URL` | Yes | `http://localhost:3000` | Base URL for the prediction app. |
| `AGENT_LOGIN_ID` | Yes | None | Login ID for the AI player account. |
| `AGENT_PASSWORD` | Yes | None | Password for the AI player account. Never commit this value. |
| `AGENT_SERVER` | Yes | `India` | App server/league to read and submit predictions for. |
| `DRY_RUN` | No | `true` | When `true`, prints predictions without submitting them. |
| `ALLOW_UPDATE_EXISTING` | No | `false` | When `true`, existing predictions can be updated. Keep `false` for normal scheduled automation. |
| `PREDICTION_MODE` | No | `all` | Use `all` for every eligible fixture, `due` for scheduled 90-minute runs, or `next` for the nearest upcoming eligible fixture. |
| `PREDICTION_LOOKAHEAD_MINUTES` | No | `90` | In `due` mode, target fixtures this many minutes before kickoff. |
| `PREDICTION_WINDOW_MINUTES` | No | `10` | In `due` mode, accept fixtures from `lookahead` through `lookahead + window`. |

## Create the AI Player Account

1. Open the main prediction app Command Center.
2. Create a regular player account for the agent.
3. Assign the account to the intended server, for example `India`.
4. Put that account's login ID and password in `.env` as `AGENT_LOGIN_ID` and `AGENT_PASSWORD`.

Do not use admin credentials. The agent acts like a normal participant so app permissions, locks, existing predictions, and server scoping are exercised exactly as they are for a real player.

## Run a Dry Run

Dry run is the default and does not submit predictions:

```bash
npm run dry-run
```

or:

```bash
npm start
```

with:

```env
DRY_RUN=true
```

## Run Live Submission

Live submission posts predictions to the app:

```bash
npm run submit
```

or set:

```env
DRY_RUN=false
```

then run:

```bash
npm start
```

The agent retries each failed prediction submission at most once.

## Run Scheduled Mode

Scheduled mode is intended for automation. It only predicts fixtures whose kickoff is inside the configured target window. With the defaults, a run at `10:00` predicts fixtures kicking off from `11:30` through `11:39`.

Scheduled mode requires exact fixture kickoff datetimes, including time and timezone, such as `2026-06-19T20:00:00-04:00` or `2026-06-20T00:00:00Z`. Date-only values like `2026-06-19` are intentionally ignored because they cannot support a reliable 90-minute trigger.

Dry-run scheduled mode:

```bash
npm run scheduled-dry-run
```

Live scheduled submission:

```bash
npm run scheduled-submit
```

Recommended production settings:

```env
DRY_RUN=false
PREDICTION_MODE=due
PREDICTION_LOOKAHEAD_MINUTES=90
PREDICTION_WINDOW_MINUTES=10
```

Run the scheduler every 5 or 10 minutes. The app-side existing-prediction check prevents duplicate submissions when a later scheduler run sees the same fixture again.

## Check Syntax

```bash
npm run check
```

## API Endpoints Used

- `POST /api/login`
  - Body: `{ "loginId": "...", "password": "..." }`
  - Captures the returned session cookie.
- `GET /api/state?server=<AGENT_SERVER>`
  - Reads fixtures, current user context, and existing predictions.
- `POST /api/bets`
  - Body: `{ "matchId": 1, "server": "India", "pick": "Team 1", "predictedTeam1Score": 2, "predictedTeam2Score": 1 }`
- `POST /api/logout`
  - Ends the player session.

## Fixture Eligibility

The agent only predicts matches that:

- Have no existing prediction for the logged-in player.
- Are not locked.
- Are not ended or settled.
- Have valid concrete team names.
- Do not use placeholder knockout labels like `Winner Group A`, `TBD`, or `Team 1`.

## OpenAI Prediction Contract

The model is instructed to:

- Treat the task as a private FIFA World Cup 2026 prediction game.
- Choose realistic predictions using team strength, tournament context, and conservative football scoring.
- Never invent teams or match IDs.
- Return only structured JSON.
- Include a short reason for each prediction.

Expected prediction shape:

```json
[
  {
    "matchId": 1,
    "pick": "Team 1",
    "predictedTeam1Score": 2,
    "predictedTeam2Score": 1,
    "reason": "Short reason"
  }
]
```

Valid `pick` values are `Team 1`, `Team 2`, and `Draw`.

## OpenAI Usage Visibility

The agent logs the OpenAI `responseId`, model, input tokens, output tokens, cached input tokens, reasoning tokens, and total tokens after every successful prediction call. The OpenAI platform Logs page can show the request before the Usage dashboard finishes aggregating usage, and the Logs table may display `<no output>` until a row is opened even when the API response returned text to the agent.

Each OpenAI request includes metadata:

- `app=fifa-world-cup-2026-ai-agent`
- `server=<AGENT_SERVER>`
- `dryRun=true|false`
- `eligibleFixtures=<count>`

## Safety Notes

- `.env` is ignored by Git.
- Passwords and API keys are redacted from logs.
- Missing required environment variables fail fast.
- `DRY_RUN` defaults to `true`.
- The primary integration uses HTTP APIs instead of fragile UI automation.

## Roadmap

- Add an optional Playwright smoke test that logs in as the same normal player and verifies the browser can view submitted predictions.
- Add support for additional LLM providers behind the same prediction validation contract.
- Add app-specific adapters if the `/api/state` response shape changes.

## Cheap Automation Options

Cheapest reliable order:

1. Existing always-on machine or VPS: use `cron` or Windows Task Scheduler to run `npm run scheduled-submit` every 5-10 minutes. Incremental hosting cost is zero if that machine already exists.
2. Public GitHub repository: use GitHub Actions scheduled workflows. Standard GitHub-hosted runners are free for public repositories.
3. Private GitHub repository: still simple, but private repositories consume included Actions minutes. GitHub Free includes 2,000 Actions minutes per month for private repositories.
4. Existing Vercel app: use Vercel Cron to call a small protected endpoint that runs the same scheduled logic. Vercel Cron Jobs are available on all plans.

For the lowest cost with this exact Node CLI, use an existing machine/VPS or a public GitHub Actions workflow. If the repository must stay private and you run every 5 minutes all month, GitHub Actions can exceed the free private quota, so prefer an existing VPS or schedule only during World Cup match days.

## GitHub Actions Automation

This repo includes `.github/workflows/scheduled-agent.yml`, which runs every 10 minutes and executes scheduled mode:

```bash
npm start
```

The workflow uses:

```env
PREDICTION_MODE=due
PREDICTION_LOOKAHEAD_MINUTES=90
PREDICTION_WINDOW_MINUTES=10
DRY_RUN=false
```

Configure these GitHub repository secrets:

- `OPENAI_API_KEY`
- `WORLD_CUP_APP_BASE_URL` — use the Railway production URL, for example `https://your-app.up.railway.app`
- `AGENT_LOGIN_ID`
- `AGENT_PASSWORD`

Configure these optional GitHub repository variables:

- `OPENAI_MODEL` — defaults to `gpt-5.5`
- `AGENT_SERVER` — defaults to `India`
- `PREDICTION_LOOKAHEAD_MINUTES` — defaults to `90`
- `PREDICTION_WINDOW_MINUTES` — defaults to `10`

Use the manual `workflow_dispatch` trigger with `dry_run=true` before enabling live submissions.

For a safe production test against the nearest upcoming match:

1. Open `Actions` → `Scheduled Prediction Agent`.
2. Select `Run workflow`.
3. Set `dry_run=false`.
4. Set `prediction_mode=next`.
5. Set `allow_update_existing=true` only if you intentionally want to overwrite an existing prediction for that match.
6. Run the workflow.

Use `prediction_mode=all` only when you intentionally want to fill every eligible unlocked fixture.

## Provider Layout

The provider-specific prediction code lives under `src/agents/`.

- `src/agents/openaiPredictor.js` implements phase-1 OpenAI predictions.
- `src/agents/index.js` is the provider factory.
- `AI_PROVIDER=claude` and `AI_PROVIDER=gemini` intentionally fail fast until those future providers are implemented.
