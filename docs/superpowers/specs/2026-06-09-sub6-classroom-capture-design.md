# Sub-project #6 — Classroom & Capture — Design Spec

**Date:** 2026-06-09
**Status:** Draft for review
**Parent:** `2026-06-08-agentic-prezi-vision-design.md`
**Inherits:** `2026-06-08-sub0-security-supply-chain-design.md` (all controls apply)
**Consumes:** #5's interaction artifacts (`interactions.json`, stable interaction `id`s, the stop snapshot) and #1's app origin, magic-link auth, `node:sqlite` data layer, job queue, and static serving
**Extends (one non-additive seam):** #5's client runtime — adds a `prezi:interaction` event dispatch (see §4)
**Fulfills:** the capture/assessment half of the **C9** capability (`docs/strategy/2026-06-08-value-chain-feature-mapping.md`); realizes the #5 §11 forward-doc

> This repository is **public**. No secrets in source; student data lives only in the runtime DB, never in the repo. See `CLAUDE.md`.

---

## 1. Purpose & scope

Let an instructor run a #5 interactive deck as a **class exercise**, capture how students respond,
and review the results — **without ever exposing student data publicly.** This turns #5's engagement
substrate into actual formative pedagogy (instructor visibility), which #5 deliberately deferred.

### In scope
Roster/join-code students (cohort-scoped), class-mode serving of an existing #5 artifact, capture of
reveal/mcq/branch/freetext responses, an instructor results view, privacy-first consent + retention,
and an **optional, gated** batch agent-grading path for free-text.

### Phased build seams (one sub-project, three shippable layers — see §12)
1. **Core capture loop** — cohorts, join, student sessions, assignments, class serving + capture
   adapter + the #5 runtime hook, attempts/responses, instructor results. **Ships without the LLM path.**
2. **Optional agent grading** of free-text — **LLM-gated** (same gate as the #3-generator wiring + the
   Hermes drivability spike). The capture loop never depends on it.
3. **Retention/purge** maintenance job.

### Out of scope (named)
- Public/anonymous engagement and self-check — that is **#5** (this builds on it).
- Gradebooks, weighted scoring, SIS/LMS integration, certificates — not now (YAGNI).
- Cross-class student accounts — students are **cohort-scoped** by decision (§3); a platform-account
  upgrade path is a possible later enhancement, not v1.

---

## 2. Reconciliation with #5 §11 (read this before diffing the two specs)

#5 §11 described class mode as "the **same artifact bytes**, a **serve-time mode switch**, with
`connect-src` relaxed in the class context, and the public artifact never gaining this." **#6 realizes
that design; it does not reverse it.** Concretely:

- The **"class context" is an authenticated app-origin route** (`/class/:assignmentId`, §6). That
  route — not the public slug origin — is where `connect-src 'self'` lives, so the capture adapter can
  POST responses.
- The **public slug origin stays `connect-src 'none'`, untouched** (#1 §6, #3 generate CSP). The public
  marketing surface and the private capture surface are **different origins**, mirroring #1's
  app-vs-published split.
- The class route serves the **same artifact bytes** as the public deck would — only the surrounding
  page + headers differ.

---

## 3. Actors & identity

Two session types **on the app origin**, deliberately separate so they can never be conflated:

| Actor | Auth | Session |
|---|---|---|
| **Instructor** | existing passwordless **magic-link** (#1 `users`) | `sessions` (unchanged) |
| **Student** | **join code** (no email round-trip) | new `student_sessions` — a **different cookie name** + its own middleware |

- **Student onboarding = roster + join code (low-friction, decided).** The instructor creates a cohort
  and shares a join code/link; a student joins by entering a **display name** (+ **optional** email) and
  accepting the consent notice (§10). No per-session magic link.
- **Identity is cohort-scoped:** a `students` row belongs to exactly one cohort; the same person in two
  cohorts is two `students` rows. (Minimal PII; no cross-class linkage.)
- **`requireSession` is not reused for students.** A separate `requireStudentSession` middleware
  validates the student cookie (constant-time hash compare, like #1 §4) and yields `{ studentId,
  cohortId }`. The two cookies have distinct names so an instructor cookie can never satisfy a student
  route or vice-versa.
- **CSRF:** student state-changing POSTs reuse #1's `X-Requested-With` custom-header requirement.

---

## 4. The one non-additive seam — #5 runtime hook

#5's interactions runtime runs entirely client-side with **no capture surface** (by design). To record
answers, #6 adds a **single, additive, CSP-clean line** to the #5 interactions runtime: on each
answer / choice / reveal it dispatches

```js
document.dispatchEvent(new CustomEvent('prezi:interaction', {
  detail: { interactionId, type, answer, correct }   // `answer`/`correct` per type; reveal → answer:null
}));
```

- **Inert in public mode:** nothing listens, so the public #5 deck is unchanged in behavior.
- **In class mode:** the **capture adapter** (a small script loaded **only** on the `/class/:id` route,
  never shipped to the public origin) subscribes to this event and POSTs the response (§8).
- This is the **only** place #6 is not zero-touch on #5. It is declared in this spec's header. If the #5
  engine plan has already shipped without it, #6's plan adds the dispatch line as its first task
  (it is a one-line, test-covered change to `src/prezi/runtime/interactions.mjs`).

---

## 5. Generation is decoupled from public publishing

Capture needs a **generated artifact** (the stable interaction `id`s + the stop snapshot #5 produces).
Privacy-first implies a school will want **class-only** exercises that are **not** on a public slug.
Therefore:

- **Target design:** generation produces the artifact; the public slug is **independent** of class
  assignment. Assigning to a cohort requires the presentation to have been **generated** (so interactions
  + stops exist), **not** to be publicly listed.
- **v1 mechanical reality (honest):** today the only path that produces an artifact is **publish**, which
  also mints a public `slug` (#1). So in v1 an assignable presentation is one that has been generated via
  publish — its **deck may be public** (which is fine: the vision spec §1 states *presentations are public
  by design*; only **student data** must be private, and it always is here). A **generate-without-public-slug**
  path (artifact produced, `slug` left null) is the clean enhancement that enables fully class-only decks;
  it is noted in §13, not required for the capture loop.
- Either way, the distinction that matters for privacy holds: **the deck is non-secret; student responses
  are never public.** The class route serves the artifact from the presentation's artifact directory
  through an **authenticated, enrolled-only** app-origin path (§6) — and student data is reachable **only**
  via authenticated app-origin routes, **never** the public `<slug>` origin.

> Dependency note: until the #3 generator is wired into the worker (LLM/spike-gated), real artifacts
> come from that path; #6's capture loop is testable against any generated artifact dir (the #5 engine
> CLI produces one), independent of that gate.

---

## 6. Class-mode serving

```
student (joined, has student_session cookie)
  GET /class/:assignmentId            → app-origin HTML page (its OWN CSP), enrolled-only
       │  loads same artifact bytes via:
       └─ GET /class/:assignmentId/asset/*   → authenticated, enrolled-only static serve of
                                               data/presentations/<presId>/*  (incl. interactions.json)
       + loads the capture adapter (subscribes to 'prezi:interaction', POSTs responses)
```

- **Class-route CSP** = the published-strict policy **plus `connect-src 'self'`** (so the adapter can
  POST to `/api/class/*`). It is a **distinct policy** from the app SPA's CSP — the SPA's policy carries
  `style-src 'unsafe-inline'`, which the artifact must **not** inherit; the class route defines its own.
- **No public exposure:** the assignment asset route and every response route require a valid student (or
  owning-instructor) session and enrollment in the cohort. Student responses are **never** served from
  the public origin.
- **Enrollment/window checks** on every hit: the student must belong to the assignment's cohort, and the
  assignment must be open (`opens_at`/`closes_at`, if set).

---

## 7. Data model (`node:sqlite`, new tables — additive migration)

| Table | Columns (essentials) | Notes |
|---|---|---|
| `cohorts` | `id` PK, `owner_user_id` FK→users, `name`, `join_code` UNIQUE, `consent_notice`, `retention_days`, `created_at` | Instructor-owned. `join_code` is URL-safe, rotatable (§13). |
| `students` | `id` PK, `cohort_id` FK, `display_name`, `email` NULL, `consent_at`, `joined_at` | **Cohort-scoped**, minimal PII. |
| `student_sessions` | `id` PK, `session_hash` UNIQUE, `student_id` FK, `expires_at`, `created_at` | Mirrors #1 `sessions`; store **hash** only. |
| `assignments` | `id` PK, `cohort_id` FK, `presentation_id` FK, `title`, `opens_at` NULL, `closes_at` NULL, `max_attempts` NULL, `created_at` | Links a generated presentation to a cohort. |
| `attempts` | `id` PK, `assignment_id` FK, `student_id` FK, `status`, `started_at`, `submitted_at` NULL | `status` ∈ {`in_progress`,`submitted`}. Resume = reuse the open attempt (§13). |
| `responses` | `id` PK, `attempt_id` FK, **`interaction_id` TEXT**, `kind`, `answer` JSON, `self_check` NULL, `score` NULL, `feedback` NULL, `graded_at` NULL, `created_at` | Keyed by **#5's stable interaction id** — the join between captured data and the artifact. |

- Migration is **additive** (new tables only); no change to #1/#5 tables. Foreign keys ON (#1 already
  sets `PRAGMA foreign_keys = ON`). Indexes on `responses(attempt_id)`, `attempts(assignment_id)`,
  `students(cohort_id)`, `student_sessions(session_hash)`.
- `score`/`feedback`/`graded_at` are **null until** the optional agent-grading pass (§9) runs; the
  capture loop never writes them.

---

## 8. API surface

All under the **app origin**; all state-changing calls require `X-Requested-With` (CSRF, #1 §8).

**Student (requires `student_session`):**

| Method & path | Purpose |
|---|---|
| `POST /api/class/join` `{ joinCode, displayName, email?, consent }` | Create/lookup the `students` row, stamp consent, set the student session. Rejects without `consent:true`. Rate-limited per IP + per join code. |
| `POST /api/class/attempts` `{ assignmentId }` | Start (or resume the open) attempt; enforces enrollment + window + `max_attempts`. |
| `POST /api/class/attempts/:id/responses` `{ interactionId, answer, selfCheck? }` | Record one response. `interactionId` must exist in the assignment's `interactions.json`; owner-attempt only. Idempotent upsert per `(attempt, interactionId)`. |
| `POST /api/class/attempts/:id/submit` | Finalize the attempt (`status=submitted`). |

**Instructor (requires magic-link `session`, owns the cohort):**

| Method & path | Purpose |
|---|---|
| `POST /api/cohorts` `{ name, retentionDays, consentNotice }` | Create a cohort; mints a `join_code`. |
| `GET /api/cohorts` / `GET /api/cohorts/:id` | List / detail (incl. join code + roster counts). |
| `POST /api/cohorts/:id/assignments` `{ presentationId, title, opensAt?, closesAt?, maxAttempts? }` | Assign a **generated** presentation (rejects if not generated). |
| `GET /api/assignments/:id/results` | Per-question aggregates + per-student progress/answers (never public). |
| `POST /api/assignments/:id/grade` | **Optional, LLM-gated:** enqueue a `grade_assignment` job (§9). |
| `DELETE /api/cohorts/:id/data` | Purge this cohort's students/attempts/responses (§10). |

---

## 9. Free-text: record always, grade optionally (gated)

- **Always recorded:** the student's typed `answer` + their `selfCheck` (their self-assessment against
  #5's embedded model answer). The instructor reviews these verbatim in the results view. **No LLM call
  on the capture path** — capture stays cheap and low-latency.
- **Optional batch grading:** the instructor triggers `POST /api/assignments/:id/grade`, which enqueues a
  `grade_assignment` job on the existing **SQLite job queue** (#1). The worker runs a **per-response,
  orchestration-layer** model call (Nous Portal / OpenRouter — never the code sandbox) against the
  interaction's **rubric** (#5 free-text config), writing `score` + `feedback` + `graded_at`.
- **Gating:** grading depends on the LLM path being live (same gate as the #3-generator wiring + Hermes
  spike). Until then, the button is inert/absent; the capture loop ships and works regardless.
- **Cost bound:** grading is on-demand and batched (not per-submit), and bounded by responses-per-assignment;
  record an expected cost per grade run in budget defaults (mirrors #2/#3 budget discipline).
- Retrieved/typed student text is **untrusted data, not instructions**: the grading prompt is structured
  so the answer is data, and outputs are schema-validated (mirrors #2 §7).

---

## 10. Privacy, consent & retention (privacy-first — assume minors)

- **Minimal collection:** `display_name` + **optional** `email`. Nothing else about the student.
- **Join-time consent:** `POST /api/class/join` requires `consent:true` and stamps `consent_at`; the
  cohort's `consent_notice` is shown at join. No consent → no session, no capture.
- **Configurable retention + auto-purge:** each cohort has `retention_days`; a **maintenance job**
  (§12 layer 3) deletes `attempts`/`responses`/`students` past the window. Cadence is an open item (§13).
- **Instructor data deletion:** `DELETE /api/cohorts/:id/data` purges the cohort's student data on demand.
- **No public exposure:** **no** student response, name, or attempt is ever served from the public origin
  or embedded in a published artifact. All student data is reachable only via authenticated app-origin
  routes (§6, §8).

---

## 11. Security (inherits #0; #6-specific points)

- **Student sessions:** 32-byte random token, stored **hashed** (`node:crypto`), constant-time compare,
  short-TTL, distinct cookie name from instructor sessions; HttpOnly/Secure/SameSite.
- **Join abuse:** rate-limit `POST /api/class/join` per IP + per join code (SQLite counter, #1 pattern);
  neutral errors; rotatable join codes (§13).
- **Authorization on every route:** student routes check enrollment + attempt-ownership + window;
  instructor routes check cohort/assignment **ownership** (404 on non-owner, like #1 §7).
- **Class-route CSP:** published-strict **+ `connect-src 'self'`**, its own policy (not the SPA's).
- **CSRF:** `X-Requested-With` on all student/instructor POSTs/DELETEs.
- **Grading isolation:** the optional grading model call runs in the **orchestration layer**, never the
  code sandbox; no secrets reach any student-facing surface.

---

## 12. Build seams (for the implementation plan)

Spec is whole; the plan should ship in three independently-valuable layers:

1. **Core capture loop (ships without the LLM path):** migration → cohorts + join + `student_sessions`
   + consent → assignments (generated-only) → class route + asset serving + capture adapter + the **#5
   runtime hook** (§4) → attempts/responses → instructor results view. End-to-end testable offline with a
   generated artifact dir (the #5 CLI produces one) and an injected/seeded DB.
2. **Optional agent grading (LLM-gated):** the `grade_assignment` job + per-response model call + results
   surfacing. Behind the same gate as the #3-generator wiring.
3. **Retention/purge job:** the auto-purge maintenance task + cadence.

Each layer is its own plan-or-phase; layer 1 is the spec→plan→build to do first.

---

## 13. Open items (resolve in planning, not hand-waved)

1. **Join-code format + rotation** — length/charset (URL-safe, unambiguous), single-use vs. reusable,
   instructor-triggered rotation. Lean: reusable per-cohort code + a rotate action.
2. **Attempt-resume semantics** — one open attempt per (student, assignment) reused on return; how
   `max_attempts` interacts with resume. Lean: resume the open attempt; new attempt only after submit and
   if under `max_attempts`.
3. **Results dashboard depth** — per-question correctness/branch-distribution + per-student answers for
   v1; trend/time analytics later. Set the v1 boundary in planning.
4. **Retention purge cadence** — nightly cron vs. an in-process scheduled task; default `retention_days`.
   Lean: nightly, default 180 days, per-cohort override.
5. **Student email optionality** — confirm email stays optional everywhere (it drives whether resume
   across devices is possible without it). Lean: optional; resume relies on the session cookie.
6. **Grading model + budget** — model choice + per-grade-run cost/wall-clock defaults (LLM-gated layer 2).
7. **Class-route asset caching/headers** — ensure `no-store` on student-data responses; artifact assets
   may be cacheable but only behind auth.
8. **Generate-without-public-slug path** (§5) — a way to produce an artifact without minting a public
   `slug`, enabling fully class-only (non-public) decks. Enhancement, not required for the capture loop;
   v1 leans on the existing publish-to-generate path (deck public per vision §1, student data never public).
