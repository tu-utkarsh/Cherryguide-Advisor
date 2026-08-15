# CherryGuide

A student planning tool for Temple University students, combining a GPA calculator, a budget
calculator, an AI advisor (AWS Bedrock), and a campus resource directory - built on top of an
earlier project ([Huntzilla](https://github.com/tu-utkarsh/Huntzilla)) rather than from scratch.

**Author:** Utkarsh Vaid, solo, built with AI assistance (as with Huntzilla).
**Course scaffold:** the underlying Lambda routing/connection-lifecycle pattern originates from
Jeremy Shafer's MIS3502 web service template, carried over from Huntzilla.

> For the full technical and design story, see [`docs/BUSINESS_CASE.md`](docs/BUSINESS_CASE.md),
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and [`docs/CODE_REVIEW.md`](docs/CODE_REVIEW.md).

---

## Why this exists

Built to address a specific gap: as an international/new student, finding the *right* guidance -
specific to Temple and to a student's actual academic standing - is genuinely hard to navigate.
The GPA and budget calculators give a student concrete, numeric grounding (where they actually
stand, and where a decision would take them); the AI advisor gives general, conversational
guidance on top of that. The long-term idea behind it: a SaaS colleges could use to reduce the
volume of routine questions hitting academic advising - degree planning, budgeting, "where do I
go for X" - by giving students a fast, specific first stop before they need a human advisor.

## What it does

1. **Login/signup and the scavenger hunt** - carried over directly from Huntzilla's codebase
   (same tables, same logic), present here as a lighter, secondary feature rather than the main
   product.
2. **GPA calculator** - projects a student's GPA forward given their current standing and
   expected grades for upcoming courses.
3. **Budget calculator** - takes income and expenses (rent, food, books, etc.) and returns a
   monthly remainder, category breakdowns, and a status ("good" / "over").
4. **AI Advisor** - a chat interface powered by AWS Bedrock. After running a GPA or budget
   calculation, a student can ask the advisor a follow-up grounded in those actual numbers
   (composed client-side into a natural-language message - see `ARCHITECTURE.md` for exactly
   how). The advisor also gives a standard disclaimer ("double-check this with Temple Academic
   Advising") when a question touches official policy, deadlines, or visa/immigration rules.
5. **Explore Campus** - a static directory of key campus buildings and resources, each with a
   photo and a direct link to Google Maps - built to help a new student find things without
   already knowing where they are.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JavaScript, jQuery, Chart.js |
| API | Amazon API Gateway (REST API, single `{proxy+}` resource, `ANY` method) |
| Compute | AWS Lambda (Node.js, `mysql2/promise` for the database driver) |
| AI | AWS Bedrock - Amazon Nova 2 Lite (see note below) |
| Database | MySQL (the same Temple-hosted instance Huntzilla uses) |
| Auth | Custom UUID token issued on login, stored client-side in `localStorage` |

**Note on the AI model:** this originally called `amazon.titan-text-lite-v1`. AWS has since
fully retired that model from Bedrock's catalog. It was migrated to Amazon Nova 2 Lite during
this documentation review - same ultra-low-cost tier, current generation.

## Architecture, in one line

```
Browser (jQuery AJAX)
   -> API Gateway (single proxy resource, forwards method + path + body as-is)
      -> Lambda (parses path, routes internally to a handler function)
         -> MySQL (auth/game routes only, new connection per invocation)
         -> AWS Bedrock (AI advisor route only, no persistence)
```

## Data model

**No new tables were created for this project.** It reuses Huntzilla's five tables (`users`,
`logins`, `games`, `gameprogress`, `leaderboard`) unchanged. The GPA calculator, budget
calculator, and AI advisor each check a token against `users.lasttoken` before running - that's
their *only* database interaction. **Nothing about a GPA calculation, a budget calculation, or
an advisor conversation is ever saved anywhere.** All of it lives only in browser memory
(cleared on refresh) or, for rate limiting, in a Lambda-scoped in-memory object (unreliable
across cold starts - see `CODE_REVIEW.md`).

## Known limitations

Documented honestly - full detail and reasoning in `CODE_REVIEW.md`:

- **The AI advisor has no memory of previous messages.** Every question is sent to Bedrock
  independently; a follow-up like "what does it do?" referring to something asked two messages
  earlier will fail, because the model was never told what "it" refers to. Verified live, not
  just inferred from code.
- **The advisor's cost ceiling (under $5/month) is a calculated worst-case projection, not a
  verified invoice** - actual historical usage fell outside AWS Cost Explorer's retention
  window by the time this was documented. The projection is based on the actual rate limit
  (10 messages/user/hour, 300 max output tokens) against current Nova 2 Lite pricing - see the
  full math in `ARCHITECTURE.md`.
- **The budget calculator's negative-number validation exists only on the frontend.** The
  backend (`toolBudget`) accepts negative values without complaint if called directly.
- **Unused dependencies remain in `package.json`** - `axios` and `js-base64` are imported
  in `index.mjs` but never actually called anywhere in the code.
- Every limitation already documented for Huntzilla's auth/game logic (plaintext passwords, no
  token expiration, inconsistent token-validation paths, connection-per-invocation, no foreign
  key constraints) applies equally here, since it's the same underlying tables and connection
  code.

## License

No license is granted for reuse. This repository builds on a course-provided template (the
routing and event-handler skeleton, originally attributed to Jeremy Shafer, MIS3502, via
Huntzilla) alongside original work. It's shared publicly for portfolio purposes, not as an
open-source project available for reuse.

## Setup

This project depends on the same Temple University-hosted MySQL instance as Huntzilla, plus AWS
Bedrock model access for Amazon Nova 2 Lite. To adapt it:

1. Copy `server/.env.example` to `server/.env` and point it at your own MySQL instance and
   schema (see `docs/ARCHITECTURE.md` for the table structure - identical to Huntzilla's).
2. In the AWS Bedrock console, request/confirm model access for Nova 2 Lite.
3. Deploy `server/index.mjs` as a Lambda function (Node.js runtime), with `DB_USER`,
   `DB_PASSWORD`, `DB_NAME`, and `DB_HOST` set as Lambda environment variables.
4. Put a REST API Gateway in front of it using a single `{proxy+}` resource with the `ANY`
   method, forwarding to the Lambda with Lambda proxy integration.
5. Update `CONFIG.API_ENDPOINT` in `js/app.js` to point at your deployed API Gateway stage URL.
6. Open `index.html`.
