# Business case

## Context

CherryGuide was built solo, roughly a year after Huntzilla, with AI assistance for both coding
and figuring out the right tooling - the same pattern used for Huntzilla. Unlike Huntzilla, this
wasn't a graded course assignment; it was self-directed.

## The actual problem being solved

As an international/new student, the hardest part isn't finding *information* in general - it's
finding guidance that's actually specific to a particular school, and to a student's own
academic standing. Generic advice doesn't account for either. CherryGuide's answer has two
parts: **quantitative grounding** (the GPA and budget calculators, which tell a student exactly
where they stand and where a decision - taking on more credits, spending less on food - would
take them) and **general guidance** (the AI advisor, layered on top of that grounding when a
student wants to talk through what to actually do about it). The "Explore Campus" directory
solves a smaller, related problem: even knowing *what* resource you need doesn't help if you
don't know *where* it physically is on campus.

The larger ambition behind it: a SaaS product colleges could use to absorb the volume of
routine, repetitive questions that currently land on academic advising - degree planning,
budgeting, "where do I go for X" - giving a student a fast, specific first stop before they need
to book time with a human advisor. CherryGuide as it exists today is a personal-scale prototype
of that idea, not a deployed version of it - worth stating plainly rather than implying more
scale than what was actually built.

## Why build on Huntzilla instead of starting fresh

This was a deliberate reuse decision, not laziness: standing up a new database, a new schema,
and a new auth system would have been pure overhead for a project whose actual point was proving
out the AI/calculator functionality, not rebuilding infrastructure that already worked. Reusing
Huntzilla's tables and Lambda scaffold meant the real effort went into the three new routes
(`gpa`, `budget`, `advisor`) rather than re-solving login and sessions from zero.

**One deliberate, good decision worth naming specifically:** rather than reusing or modifying
Huntzilla's existing (already inconsistent) token-validation logic, a new, separate function
(`validateTokenBasic`) was written specifically for the new routes - with a comment stating
directly that it was built to "not alter or interfere with HuntZilla." That's a real instinct
worth having: isolating new, less-proven code from an existing system you don't want to
destabilize, rather than reaching into fragile legacy logic to extend it.

## A real production issue, encountered and fixed during this documentation review

The AI advisor originally called `amazon.titan-text-lite-v1` on AWS Bedrock. At some point
between building this project and reviewing it for this repository, **AWS fully retired that
model from the Bedrock catalog** - calls to it started failing with an end-of-life error,
independent of anything wrong with the code. This is a genuine, common category of production
problem: depending on a third-party model or API version that the provider later deprecates out
from under you, with no automatic migration.

The fix - migrating to Amazon Nova 2 Lite - required more than swapping a model ID string: Nova's
request format uses a `messages` array and a native `system` field, structurally different from
Titan's single `inputText` string. This is documented in detail in `ARCHITECTURE.md` and
`CODE_REVIEW.md`. Worth stating directly: **this incident and its fix are real and dated to this
review, not something staged for the documentation** - the advisor was genuinely broken, and is
genuinely working again as a result of this specific change.

## Honest scope boundaries

A few things were deliberately not built, consistent with this being a solo, personal-scale
prototype rather than a funded product:

- **No conversation memory.** Every message to the advisor is independent - confirmed by testing
  a real follow-up question live, not just inferred from reading the code.
- **No persistence of GPA history, budget history, or advisor conversations.** Nothing about a
  calculation or a conversation is saved anywhere; it exists only in browser memory until the
  page refreshes.
- **Cost control was a real, deliberate design constraint**, not an afterthought: dual-layer
  rate limiting (client-side and server-side) was specifically built to cap Bedrock usage,
  reflecting real awareness that unmetered LLM API calls on a personal AWS account are a genuine
  financial risk with no company absorbing the bill.

## Why this matters as a portfolio piece, honestly

This project demonstrates something Huntzilla couldn't: a self-directed product decision backed
by a real personal problem, a deliberate infrastructure-reuse call made under time constraints,
actual LLM integration with cost engineering built in from the start, and - genuinely valuable
for an interview - direct, recent experience handling a third-party model deprecation in
production. The scope boundaries above (no memory, no persistence) aren't hidden; they're
documented precisely because being able to say "here's exactly what this doesn't do, and why"
is a stronger signal of engineering maturity than a project with no visible edges at all.
