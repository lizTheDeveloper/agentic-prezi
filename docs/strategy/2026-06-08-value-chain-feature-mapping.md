# Value-Chain Feature Mapping — agentic-prezi as a School Capability

**Date:** 2026-06-08
**Status:** Draft for review
**Author:** Business-analysis pass (value-chain-expert framework)
**Subject:** Mapping the agentic-prezi platform's capabilities to **The Multiverse School's** value chain
**Source specs:** `docs/superpowers/specs/2026-06-08-*` (vision + sub-projects #0–#4)

> **Reading frame (important).** This document maps the platform to the **school's** value
> chain — admissions, teaching, differentiation — **not** to agentic-prezi-as-a-SaaS-product.
> The strategic anchors are the three the brief gave us: *drive marketing*, *enhance class
> delivery*, *set us apart from competitors*. Wherever the specs talk about render
> determinism or publish latency, that is **infrastructure** here, not the headline.

---

## 0. The organization's value chain (the thing we map *onto*)

Before mapping features we fix the reference model: Porter's value chain **for a school**.

| Porter activity | What it means for The Multiverse School |
|---|---|
| **Inbound logistics** (primary) | Curriculum sourcing, content/material creation, keeping material *current* with real research. |
| **Operations** (primary) | **The actual teaching** — the in-class learning experience, exercises, the "wow" that makes a concept stick. |
| **Outbound logistics** (primary) | Student deliverables that leave the building: portfolios, published work, shareable artifacts. |
| **Marketing & Sales** (primary) | Admissions funnel, brand, demos, social proof, lead generation. |
| **Service** (primary) | Student support, alumni outcomes, community, retention. |
| **Firm infrastructure** (support) | The platform itself, hosting, security, the public-repo discipline. |
| **HR / teaching enablement** (support) | Instructor tooling — how much leverage one instructor gets. |
| **Technology development** (support) | R&D on the agentic generation engine; the competitive engine room. |
| **Procurement** (support) | Model + tool provider (Nous Portal), scholarly APIs, hosting (Hetzner). |

Everything below answers: **which of these activities does each capability move, and how hard?**

---

## 1. Capability inventory (what the platform actually is)

The brief says "this set of tools." The five sub-projects are the *build units*; the **capabilities**
are what create value. We map capabilities, and treat #0 (supply-chain security) and #4
(deploy/hosting) as **support/infrastructure** that enable the rest rather than as headline features.

| # | Capability | Source | Strategic weight |
|---|---|---|---|
| **C1** | **Automated research → cited, resolvable findings** | #2 | **High** — credibility + currency |
| **C2** | **Prezi-style spatial/zooming generation** ("the wow") | #3 | **High** — engagement, the differentiator |
| **C3** | **One-click publish to a public `*.themultiverse.school` URL** | #1 | **High** — the marketing surface |
| **C4** | **Vision-refinement loop** (agent looks at its own output, fixes it) | #3 | Medium — quality bar / unit cost of quality |
| **C5** | **Frictionless magic-link onboarding** | #1 | Medium — funnel friction |
| **C6** | Agent engine (Hermes / Nous Portal Tool Gateway) | vision §2 | Support — procurement/tech-dev |
| **C7** | Hardened hosting + sandbox (gVisor, egress-deny, CSP) | #4, #0 | Support — firm infrastructure |
| **C8** | Supply-chain security discipline (7-day gate, lockfiles) | #0 | Support — firm infrastructure / risk |

The heavy frameworks (VRIO / RICE / BCG) below concentrate on **C1, C2, C3** — the three that
move admissions and teaching. C4–C5 get lighter passes; C6–C8 are folded into support analysis.

---

## 2. The feature mapping (the core artifact)

Capability → Porter activity. Cell = nature of the impact. **Bold** = primary value driver for that capability.

| Capability | Inbound (curriculum) | Operations (teaching) | Outbound (deliverables) | Marketing & Sales | Service (retention) |
|---|---|---|---|---|---|
| **C1 Research→cited** | **Always-current, sourced material** | Models research literacy live | Citations travel with artifact | Credibility signal ("we cite real papers") | Alumni-grade rigor |
| **C2 Prezi zoom gen** | Faster lesson authoring | **The engagement "wow" in class** | Memorable spatial artifact | **Demo magnet / portfolio reels** | Sticky learning |
| **C3 Publish→URL** | — | Share-in-class instantly | **Student work goes public** | **Viral/SEO surface, every artifact is an ad** | Public alumni portfolio |
| **C4 Vision loop** | Quality floor on material | Less instructor polish time | Professional-looking output | Brand consistency | — |
| **C5 Magic-link** | — | Zero-friction class start | — | **Top-of-funnel conversion** | Low-friction return |
| **C6 Agent engine** | Procurement leverage | Enables C1/C2 in class | — | — | — |
| **C7 Hosting/sandbox** | — | Reliability of delivery | Safe public serving | Uptime = trust | — |
| **C8 Supply-chain** | — | — | — | "We don't get hacked" trust | — |

**Read of the matrix:** the value concentrates in three cells — **C2 in Operations** (teaching wow),
**C3 in Marketing** (every published artifact is a public ad), and **C1 in Marketing/Inbound**
(credibility + currency). That triad is the strategy. Everything else is enabling.

---

## 3. Feature-to-Value-Chain Reports (the high-weight capabilities)

### C1 — Automated research → cited, resolvable findings (#2)

**1. Feature Overview**
- **Summary:** Turns a topic/write-up into a strictly-grounded findings document — real, latest papers with **live-checked, resolvable** DOIs/URLs; fabricated citations are rejected by construction (#2 §4).
- **JTBD (Christensen):** *"When I prepare a lesson or a student builds an exercise, help me ground it in current, credible research so it's trustworthy and teaches good sourcing — without me spending hours in databases."*
- **Kano:** **Performance** for teaching quality (more rigor = more value, linearly), tipping toward **Basic/expected** for a school that claims to be research-led — its *absence* would be a credibility hole.

**2. Context Mapping (Business Model Canvas)**
- **Value proposition:** "Education grounded in *current* science, not stale slides." Directly supports a premium, differentiated positioning.
- **Key activity/resource:** content currency becomes a *process*, not heroic instructor effort. Scholarly adapters (OpenAlex/Crossref/arXiv) are keyless and durable.
- **Ecosystem dependency:** partly Hermes-gated for extraction, but **insulated** — scholarly APIs are direct HTTPS with a fetch/extract fallback (#2 §8), so it survives a Hermes spike failure. Low platform risk.

**3. Value Chain Mapping**
- **Primary:** **Inbound logistics** (curriculum stays current automatically) and **Marketing** (a defensible credibility claim).
- **Support:** **Technology development** — the strict-grounding pipeline is genuine IP.
- **Wardley:** the *capability* (literature search) is moving toward **utility**; the **strict-grounding + resolvability-checked synthesis** is still **product/novel** — that's where to invest, not the search itself.

**4. Strategic Analysis**
- **VRIO:** Valuable ✅ · Rare ⚠️ (cited content is gettable, *automated and integrated into a curriculum* is uncommon) · Inimitable ⚠️ (pipeline is replicable; the *accumulated, curated, cited corpus* compounds and is harder to copy) · Organized ❓ (only if instructors actually teach from it). **Net: a supporting differentiator, not a standalone moat.**
- **SWOT:** *Strength* credibility; *Weakness* cost is multiplicative (sub-queries × adapters × candidates, #2 §6); *Opportunity* "research-literate" brand + a teachable artifact; *Threat* a single hallucinated citation that ships publicly damages the exact trust this sells.
- **PESTEL:** *Social* demand for trustworthy AI-assisted content ↑; *Legal/ethical* citing real work correctly is reputationally load-bearing; *Technological* scholarly-API stability is favorable (keyless, polite-pool).

**5. Prioritization**
- **Impact/Effort:** High impact / **High effort** (the grounding + verification machinery is the hard part).
- **RICE:** Reach = every lesson/exercise (high); Impact = high (credibility); Confidence = med-high (insulated from spike); Effort = high. **Strong, but gated behind #1 existing.**

**6. Strategic Impact (Balanced Scorecard)**
- **Financial:** indirect — supports premium pricing/positioning.
- **Customer (student):** higher trust, better research habits modeled.
- **Internal process:** content currency becomes systematic.
- **Learning & growth:** builds an institutional cited-knowledge asset over time.
- **Critical value driver:** *credibility-at-scale.* **Strategic risk:** citation integrity failures are existential to the claim — the #2 §4 defenses are non-negotiable.

---

### C2 — Prezi-style spatial/zooming generation (#3) — **the differentiator**

**1. Feature Overview**
- **Summary:** Compiles findings + write-up into one large SVG coordinate space with a camera tour that zooms overview→detail→back — the Prezi "signature" (#3 §1, §3). Nested scenes = zoom-into-detail.
- **JTBD:** *"When I explain a complex idea, help me make it *spatially memorable* and engaging so students grasp structure and remember it — without me being a designer."*
- **Kano:** **Delighter** — this is the "wow" that differentiates; not expected, disproportionately rewarded when present.

**2. Context Mapping**
- **Value proposition:** *the* visible differentiator — "our classes don't use boring slides." This is the thing a prospective student screenshots and shares.
- **Customer relationship:** shifts perception from "another bootcamp" to "the school that builds things like this."
- **Key resource:** the scene-graph IR + player runtime are **engine-agnostic** (#3 §11) — survives a Hermes spike failure with only the code-writing driver swapped. Strategic asset insulated from the riskiest dependency.

**3. Value Chain Mapping**
- **Primary:** **Operations** (in-class engagement — the core teaching moment) **and Marketing** (demo magnet). This is the rare capability that hits *both* headline anchors at once.
- **Support:** **Technology development** — the IR + vision-policed layout is the engine room.
- **Wardley:** zooming-presentation *rendering* is **product** (Prezi commoditized the idea); **agentic generation of it from research** is **novel** — the defensible position is the *generation*, not the zoom.

**4. Strategic Analysis**
- **VRIO:** Valuable ✅ · **Rare ✅** (few schools auto-generate spatial research narratives) · Inimitable ⚠️ (a funded competitor could rebuild the pipeline; the **brand association + the public corpus of `*.themultiverse.school` artifacts** is the durable part) · Organized ❓ (must be woven into both curriculum *and* the marketing motion to pay off). **Net: the strongest single differentiator in the set — but its moat is brand+corpus, not the tech alone.**
- **SWOT:** *Strength* unmistakable visual identity; *Weakness* **multiplicative cost** (stops × iterations vision calls, #3 §10 — a 20-stop deck × 4 iterations ≈ 80 vision calls/render per publish); *Opportunity* a recognizable house style becomes brand equity; *Threat* novelty wears off if it's decoration without pedagogical substance.
- **PESTEL:** *Social* short-attention-span media favors spatial/visual; *Technological* depends on font-fidelity correctness (#3 §7.1) or the "wow" ships clipped; *Economic* compute cost per artifact must be bounded to stay viable at class volume.

**5. Prioritization**
- **Impact/Effort:** **High impact / High effort** — and spike-contingent (the ⚠️ Generate stage).
- **BCG:** **Star** — high differentiation, but cash-hungry (compute) and dependency-risky; fund it, but bound the cost.
- **RICE:** Reach = every artifact (high); Impact = **massive** (it *is* the brand); Confidence = medium (spike-gated, but IR is engine-agnostic); Effort = high.

**6. Strategic Impact (Balanced Scorecard)**
- **Financial:** drives both top-of-funnel (demos) and willingness-to-pay (premium feel).
- **Customer:** engagement and memorability — the pedagogical payoff.
- **Internal process:** turns "make it look good" from instructor labor into a pipeline.
- **Learning & growth:** a house visual language + reusable IR compounds.
- **Critical value driver:** *differentiated engagement.* **Strategic risks:** (a) **unit cost** at class scale, (b) **substance** — wow without learning is a gimmick, (c) **spike dependency** on Hermes drivability.

---

### C3 — One-click publish to a public `*.themultiverse.school` URL (#1) — **the marketing engine**

**1. Feature Overview**
- **Summary:** Magic-link signup → write → Publish → live public URL on the school's own domain, served as static, CSP-locked assets (#1 §5–6). Every artifact is a first-class web page.
- **JTBD:** *"When I make something in class, let me share it instantly with a real link I'm proud of — and let the world (and prospective students) see what this school produces."*
- **Kano:** **Performance→Basic** for the workflow; but the *public-on-our-domain* aspect is a **Delighter for marketing** — it turns coursework into a public asset.

**2. Context Mapping**
- **Value proposition:** **distribution.** This is the cell where coursework becomes marketing. Each published artifact is a branded, SEO-indexable, shareable proof point.
- **Channels:** the published URL *is* the channel — organic/social/SEO compounding.
- **Revenue link:** strongest indirect line to admissions — public student work is the most credible top-of-funnel asset a school has.

**3. Value Chain Mapping**
- **Primary:** **Marketing & Sales** (every artifact is an ad) **and Outbound logistics** (student work leaves the building as a public portfolio).
- **Support:** **Firm infrastructure** (subdomain serving, CSP isolation, hosting).
- **Wardley:** publish-to-URL is **utility** (commodity hosting). The strategic value is **not** the publish — it's that publishing onto **`*.themultiverse.school`** converts every artifact into **owned-channel brand inventory**. Don't over-invest in the plumbing; invest in *what gets published*.

**4. Strategic Analysis**
- **VRIO:** Valuable ✅ · Rare ❌ (publishing is commodity) · Inimitable ❌ alone — **BUT** the **compounding public corpus on the school's branded domain** is rare and inimitable as it accumulates (network/SEO effect). The feature is commodity; **the corpus it builds is the moat.**
- **SWOT:** *Strength* owned distribution channel at zero marginal cost; *Weakness* **public-by-design** (vision §1) — quality and safety of *every* artifact is now reputational; *Opportunity* a flywheel — more students → more public artifacts → more reach → more students; *Threat* a single embarrassing/incorrect public artifact is a public liability (ties back to C1 citation integrity + C4 quality loop).
- **PESTEL:** *Legal* public student work implies consent/IP/privacy handling; *Social* shareability is the modern admissions funnel; *Technological* the two-origin CSP isolation (#1 §2) is what makes "public-by-default" safe.

**5. Prioritization**
- **Impact/Effort:** **High impact / Low-Medium effort** — and it's the **walking skeleton (#1)**, so it exists first. **Best impact/effort ratio in the set.**
- **RICE:** Reach = every artifact + every viewer (highest); Impact = high (admissions); Confidence = **high** (no spike dependency, builds first); Effort = low-med. **Highest RICE of the three.**

**6. Strategic Impact (Balanced Scorecard)**
- **Financial:** the clearest line to enrollment — owned-channel marketing inventory at ~zero marginal cost.
- **Customer:** pride-of-authorship; a public portfolio students keep.
- **Internal process:** coursework → marketing asset, automatically.
- **Learning & growth:** the corpus is a compounding institutional asset.
- **Critical value driver:** *owned-channel distribution flywheel.* **Strategic risk:** public-by-design means **every artifact's quality is a marketing event** — couples this capability tightly to C1 (citations) and C4 (quality loop).

---

## 4. Lighter-weight capabilities

### C4 — Vision-refinement loop (#3 §5)
- **JTBD / Kano:** "make it look professional without me polishing it" — a **Performance** enabler. It's the **unit-cost-of-quality** lever: it raises the floor so public artifacts (C3) don't embarrass the brand.
- **Value chain:** **Operations** (less instructor polish) + **Firm infrastructure** (quality floor). **BCG: Cash Cow-adjacent** — it makes the Star (C2) shippable.
- **Risk:** it is the **dominant cost multiplier** (#3 §10). Bound iterations/stops or it eats margin at class scale. **Cost-benefit:** the per-publish compute bound is the single most important number to set with eyes open.

### C5 — Frictionless magic-link onboarding (#1 §4)
- **JTBD / Kano:** "let me start in seconds" — **Basic** (expected), but a real **funnel-friction** reducer. Removing the password step measurably lifts top-of-funnel conversion.
- **Value chain:** **Marketing & Sales** (conversion) + **Service** (low-friction return). Low effort, already in #1.
- **Note:** security posture (hashed single-use tokens, rate-limited, enumeration-neutral) is correct — friction-reduction without a credential-leak liability.

---

## 5. Support activities (folded in, not headlined)

| Capability | Porter role | Strategic note |
|---|---|---|
| **C6 Agent engine (Hermes/Nous Portal)** | **Procurement + Tech development** | One OAuth → research + vision + image-gen + sandbox. *Concentration risk:* the Milestone-zero spike is the load-bearing assumption; mitigated by engine-agnostic IR (#3 §11) and insulated research (#2 §8). |
| **C7 Hardened hosting + sandbox (#4, #0 §B)** | **Firm infrastructure** | gVisor + broker + egress-deny + CSP = the trust substrate that makes "public-by-default" safe. Invisible when working; catastrophic if absent. |
| **C8 Supply-chain discipline (#0)** | **Firm infrastructure / risk mgmt** | 7-day min-age gate, lockfiles, `--ignore-scripts`. Reputational insurance — *not* a differentiator a prospective student sees, but a liability if skipped (the repo is public). |

These don't get VRIO/RICE passes because their value is **enabling, not differentiating** — they are table stakes that protect the C1–C3 value, not sources of it.

---

## 6. The gap worth naming: presentations ≠ interactive exercises ⚑

The brief asks for **"interactive educational exercises."** The specs, as written, generate
**presentations** — researched, zooming, cited, beautiful, but fundamentally **broadcast** artifacts:
a viewer navigates a tour (next/prev/zoom, #3 §7). That is *engaging consumption*, not *interactive learning*.

This is not a flaw in the specs — it is exactly what the framework's **SWOT-Opportunities** and
**Wardley** lenses exist to surface:

- **What the tools produce today (Wardley: product/novel):** auto-generated spatial, cited *narratives* the student **watches**.
- **What "educational exercise" implies (Wardley: the next evolution):** **interactivity** — student-as-author, branching, prompts, *assessment*, responses, feedback. The platform has the *substrate* (a JS player, a scene graph, an agent engine) but **none of the specs define an exercise/assessment/response loop.**

**Strategic implication (this is the highest-value insight in this document):**
- The fastest differentiation win is to **lean the existing tools into the marketing flywheel (C2+C3)** — that's real, near-term, and spec'd.
- But the *exercise* framing is a **distinct, unspecced capability** (call it **C9 — interactive exercise/assessment layer**). It would convert the platform from "engaging content generator" (Operations *support*) into "**interactive pedagogy engine**" (Operations *core*), which is a materially stronger and rarer competitive position.
- **Recommendation:** treat C9 as a **deliberate next sub-project**, not an assumed property of #2/#3. Scoping it is the difference between "prettier slides" and "a teaching method competitors can't copy."

---

## 7. Strategic synthesis — the school's Balanced Scorecard

| Scorecard dimension | What this tool-set moves | Critical driver |
|---|---|---|
| **Financial** | Admissions via owned-channel public artifacts (C3); premium positioning (C1+C2). | The publish flywheel (C3) is the clearest revenue line. |
| **Customer (student)** | Engagement + memorability (C2); credibility/research-literacy (C1); pride-of-authorship (C3). | Engagement-with-substance, not wow alone. |
| **Internal process** | Content currency, design, and quality become **pipelines** not instructor heroics (C1, C2, C4). | Instructor leverage — one teacher, many artifacts. |
| **Learning & growth** | A compounding, branded, cited public corpus; reusable house style + IR. | The **corpus is the real moat** (rare + inimitable as it grows). |

### Critical value drivers (ranked)
1. **The publish flywheel (C3):** every artifact is owned-channel marketing inventory. Highest RICE, lowest risk, exists first. **Press this hardest.**
2. **Differentiated engagement (C2):** the visible "set us apart." Fund it, but **bound its compute cost** (C4) or it doesn't scale to class volume.
3. **Credibility at scale (C1):** the trust layer that makes public artifacts safe to broadcast. Its citation-integrity defenses are non-negotiable.

### Strategic risks (ranked)
1. **Public-by-design coupling:** C3 makes *every* artifact a marketing event, so a C1 citation failure or a C2/C4 quality miss is a *public* liability. The quality and grounding loops are not polish — they are brand protection.
2. **Multiplicative compute cost (C2+C4):** unbounded, this is margin-negative at class scale. The per-publish cost/iteration budgets (#3 §10) must be set deliberately.
3. **Engine concentration (C6):** the Hermes drivability spike is load-bearing; mitigated but not eliminated by engine-agnostic fallbacks.
4. **The exercise gap (§6):** if "interactive educational exercises" is the actual goal, the moat-grade capability (C9) is **unspecced** — the current tools deliver engaging *presentations*, not interactive *pedagogy*.

---

## Recommendation Summary

**Should this tool-set be prioritized? Yes — as a marketing flywheel first, a differentiator second, and a pedagogy engine only if deliberately specced.**

1. **Lead with C3 (publish flywheel).** Highest impact/effort, no spike dependency, builds first (#1). Make *every* class artifact a public, branded, SEO-indexable asset — that is the cheapest, most durable admissions channel a school can own.
2. **Fund C2 (Prezi generation) as the visible differentiator — with a hard cost bound.** It hits teaching *and* marketing simultaneously. Set the per-publish compute budget (C4 loop) with eyes open before it scales to class volume.
3. **Treat C1 (cited research) as the trust substrate, not a feature.** Its citation-integrity defenses (#2 §4) directly protect the C3 flywheel; a single fabricated citation published on the school's domain damages the exact credibility this sells.
4. **Scope C9 (interactive exercise / assessment layer) as a deliberate decision.** The brief's "interactive educational exercises" is **not** what #2/#3 produce today. This gap is the single highest-leverage strategic choice: prettier presentations (near-term, spec'd) vs. an interactive teaching method competitors can't easily copy (rarer, unspecced).

**Suggested next steps**
- Confirm the **strategic intent**: marketing-content engine (ship C1–C3 as specced) **or** interactive-pedagogy engine (scope C9 first)? This branch changes the roadmap.
- Set the **per-publish cost/iteration budget** (#3 §10, #2 §6) as an explicit business decision — it bounds whether C2 scales to class volume.
- Define a **quality/safety bar for public artifacts**, since C3 makes every artifact a brand event.
- If C9 is wanted, **write its sub-spec** (exercise model, response/assessment loop, student-as-author) before assuming #3 delivers it.

---

## Assumptions stated

- "This set of tools" = the agentic-prezi platform and its sub-projects #0–#4, used **by the school**, not sold as SaaS.
- The organization whose value chain we map is **The Multiverse School**; "competition" = other schools/bootcamps/online-education providers.
- The specs are treated as the source of truth for *what exists*; the §6 presentations-vs-exercises gap is flagged precisely because the brief's language exceeds the specs' scope.
- Cost, effort, and RICE judgments are **qualitative/relative** (the specs intentionally defer the actual budget numbers to planning) — they rank capabilities against each other, not against absolute thresholds.
