# Code review

Same standard as Huntzilla's review: honest, based on actually reading the code and the live
API Gateway configuration, not a resume gloss.

## What's genuinely solid

- **`validateTokenBasic` is a deliberately isolated design choice**, not an accident. Its own
  comment states the intent directly: built so new functionality wouldn't touch or destabilize
  Huntzilla's existing, already-inconsistent auth logic. That's a real, mature instinct - keep
  new, less-proven code separate from a system you don't want to break.
- **Dual-layer rate limiting is genuinely correct and matches the resume claim exactly** -
  verified independently on both sides: a client-side timestamp array that blocks a request
  before it's even sent, and a server-side in-memory object as backstop.
- **The system prompt's conditional disclaimer logic is real, deliberate prompt engineering** -
  general questions get answered plainly; questions touching policy, deadlines, or immigration
  rules get the same answer plus a fixed liability disclaimer, entirely via prompt instruction,
  not code branching.
- **A real production incident was diagnosed and fixed correctly during this review**: Amazon
  fully retired the original Titan Text Lite model from Bedrock's catalog. The fix - migrating to
  Amazon Nova 2 Lite - required restructuring the request body (a `messages` array and a native
  `system` field, replacing Titan's single `inputText` string), not just swapping a model ID.
  This is dated, real, and verifiable - not staged for the documentation.
- **Error handling (`try`/`catch` returning structured errors) was extended to every new
  function** (`toolGpa`, `toolBudget`, `advisorHandler`), consistent with the improvement already
  made on top of the course template in Huntzilla.

## Security findings

- **The same hardcoded database credential existed in this file too** (identical `dboptions`
  block) - removed in this repo's version, reading from environment variables instead. Same
  underlying credential as Huntzilla; rotating it once fixes both projects.
- **No token expiration anywhere**, including in the new `validateTokenBasic` path. Once issued,
  a token remains valid until explicitly cleared, same gap as Huntzilla.
- **Tokens are stored in `localStorage`**, same persistence characteristics and same risk as
  already documented for Huntzilla.

## Data integrity findings

- **No new tables or columns were added for any of the three new features.** Confirmed by
  checking every `connection.execute` call's location directly: `toolGpa`, `toolBudget`, and
  `advisorHandler` each touch the database exactly once, through `validateTokenBasic`, and
  nowhere else.
- **Nothing about a GPA calculation, a budget calculation, or an advisor conversation is ever
  persisted.** All of it lives only in browser JavaScript variables (`lastGpaResult`,
  `lastBudgetResult`) or the Lambda's in-memory rate-limit object, both of which vanish on
  refresh or cold start respectively.
- Every schema-level finding already documented for Huntzilla (no `FOREIGN KEY` constraints,
  `users.isadmin` as a `varchar`, the unused `games.lastmodifiedby` column) applies unchanged,
  since this project never touches the schema at all.

## Logic and consistency findings

- **There are now three different token-validation mechanisms across the combined codebase**,
  not two: Huntzilla's `getUserByToken` (joins `users` to `logins`), Huntzilla's direct
  `users.lasttoken` check (`guess1`/`2`/`3`, `endgame`, `cancelGame`), and this project's own
  `validateTokenBasic` (also a direct `lasttoken` check, but written independently). The third
  one happens to check the same thing as the second, just via a separately-written function -
  worth knowing precisely if asked "how does auth work here."
- **The budget calculator's negative-number validation exists only on the frontend.**
  `calcBudgetFrontEnd()` explicitly rejects negative rent/food/books/income before calling the
  Lambda; the backend `toolBudget` has no equivalent check and would accept negative values if
  called directly, bypassing the frontend.
- **`axios` and `js-base64` are listed in `package.json` and imported in `index.mjs`, but never
  called anywhere in the code.** Confirmed via direct search across the whole file - likely
  leftovers from an earlier, abandoned attempt at something (token encoding? email verification?
  the also-unused `SESClient`/`SendEmailCommand` import suggests the latter).
- **The AI advisor has no memory of previous messages - verified live, not just inferred.**
  Asking "where is the Student Success Center" followed by "what does it do?" fails, because the
  second question is sent to Bedrock with zero awareness that "it" refers to anything. Every
  message is an independent call, both by design (no history array is ever built) and by the
  underlying model's single-turn `messages` structure as currently called.
- **The resume's "academic status" grounding claim isn't backed by any actual field.** Checked
  directly: no input, variable, or form field representing academic status (standing, probation,
  year level, etc.) exists anywhere in the frontend or backend. GPA is the only academic signal
  actually captured - a reasonable proxy, but not the same as a distinct "academic status" input.

## If I revisited this project

| Finding | Fix |
|---|---|
| Hardcoded credentials | Same fix as Huntzilla - environment variables, rotate the actual password |
| No token expiration | Add a real expiration check, shared across all three validation paths |
| Three inconsistent auth-check functions | Consolidate into one, reused everywhere, rather than writing a third variant |
| Backend budget validation gap | Replicate the frontend's negative-number check server-side |
| Unused dependencies | Remove `axios`, `js-base64`, and the SES import/dependency entirely |
| No conversation memory | Resend the last 1-2 exchanges with each new advisor call, if this were to grow into more than a prototype |
| No persistence of GPA/budget/advisor history | Add a table if this ever needs to show a student their progress over time - deliberately out of scope for this prototype |
