# AP Study Coach — Engineering Execution Plan (v4)

**Working name:** AP Study Coach (Bluebook-style)
**One-liner:** A web app that gives students full-length AP mock exams inside a pixel-faithful recreation of the College Board Bluebook testing experience, then uses AI to score everything (including FRQs), re-test misses, and surface weak topics — so practice feels exactly like game day.

**Scope note:** This is an engineering execution plan — a build guide, not a business plan. Monetization/competition notes are kept only as context for engineering decisions (e.g., what's expensive per-unit). GTM, financial modeling, and fundraising live elsewhere.

*v4 updates: calendar-anchored roadmap against the May 2027 exams; the "I don't know" answer option (diagnostic/practice only); the Scan-and-Grade vision system; score projection methodology (last year's curve, weighted slightly stricter); the remediation step (teach, not just re-test); humanities/document-set generation; bank leakage controls; accommodations simulation; diagnostic onboarding; minor hardening notes.*

---

## 1. The Problem

AP students prepare in environments that look nothing like the real test. Since College Board moved most AP exams to the digital Bluebook app (28 exams digital as of 2025, continuing in 2026), the gap between "practicing from a PDF or Quizlet deck" and "sitting the actual digital exam" has widened. Specific pain points:

- **Interface unfamiliarity.** Students lose time and confidence on exam day because they've never used the real tools: the timer behavior, question navigator, mark-for-review, answer eliminator, highlighter/annotate, the built-in Desmos calculator, or the split-pane stimulus + question layout.
- **No FRQ feedback loop.** Multiple choice is easy to self-grade; free-response questions are not. Most students either skip FRQ practice or grade themselves badly against rubrics they don't fully understand.
- **No adaptivity.** Prep books and question banks are static. A student who keeps missing "period 5 causation" questions in APUSH just keeps grinding random questions.
- **Fragmented tooling.** Timers in one app, questions in a PDF, flashcards in another app, no unified score tracking.

## 2. The Solution

A single web app that does five things:

1. **Simulates Bluebook faithfully** — same layout, tools, timing, section structure, and flow, matched per-subject to whether the real exam is fully digital or hybrid.
2. **Serves original + AI-generated questions built to the official spec** — generated and assembled against each course's Course and Exam Description (CED), teacher-reviewed, with real released materials used only where legally safe (Sections 6, 7, 10).
3. **Scores everything** — instant MCQ scoring, AI rubric-based FRQ scoring with per-point feedback, vision grading of handwritten and photographed work (Scan-and-Grade, Section 5.6), and a projected AP score (1–5) built on last year's curve weighted slightly stricter (Section 5.7).
4. **Closes the loop** — automatic re-test queues (fresh variants of the same skill, not repeats), a *teach* step between diagnosis and re-test (Section 5.5), spaced repetition, and a mastery dashboard mapped to CED units and skills.
5. **Meets students where their work is** — typed, handwritten-and-uploaded, or photographed from paper practice they did elsewhere.

**Positioning:** "The closest thing to sitting the real AP exam, plus a coach that tells you exactly what to fix."

## 3. Target Users

- **Primary:** High school students taking AP exams (roughly 3M students, 6M+ exams per year).
- **Secondary:** AP teachers who want to assign realistic mocks and see class-level weak-topic data.
- **Tertiary:** Tutors and tutoring companies; self-studiers (homeschool, international students).

**Launch subjects (3–5 high-volume, high-pain courses):**
- AP U.S. History (heavy FRQ pain: SAQ, DBQ, LEQ rubrics; fully digital)
- AP Calculus AB/BC (hybrid; Desmos + symbolic work)
- AP English Language (essay scoring pain; fully digital, now 4 answer choices on MCQ)
- AP Biology or AP Psychology (huge enrollment; Bio is hybrid, Psych is fully digital)
- AP Physics 1 (hybrid; the diagram-generation architecture in Section 9 makes this feasible and defensible)

Expand later to remaining APs, then adjacent exams (SAT/PSAT — also Bluebook, so the interface investment pays twice — then ACT, IB, etc.).

## 4. Exam Format Reality (drives product design)

The 28 digital AP exams split into two modes, and the mock experience must match per subject:

- **Fully digital (16 exams):** MCQ *and* FRQ completed entirely in Bluebook. Includes AP English Lang/Lit, the history courses, Psychology, Computer Science. Typed FRQ responses → on-screen FRQ text editor in our app.
- **Hybrid digital (12 exams):** MCQ in Bluebook; FRQs *viewed* in Bluebook but *handwritten* in paper booklets returned for scoring. Includes AP Calculus, Physics, Chemistry, Biology, Statistics. Our app mirrors this: FRQ on screen, student works on paper, photographs/uploads handwritten work for vision grading.
- **Shared details to replicate:** built-in Desmos calculator for all calculator-permitted exams, in-app reference sheets, standardized scratch paper (2 sheets), equation editor for fully digital math-notation entry.

**Product implications:**
- Two native FRQ answer flows (typed editor; photo-upload) plus the general Scan-and-Grade path (5.6).
- Optional practice-only enhancement for hybrid subjects: a digital free-body-diagram / graph-sketching tool with snap-to arrows and machine-readable output — instant feedback like "your normal force isn't perpendicular to the surface." Clearly labeled as a practice aid.
- Embedded Desmos and per-subject reference sheets are table stakes for authenticity.
- **Accommodations simulation:** extended-time modes (1.5x, 2x) and screen-reader/TTS-friendly rendering, so students who test with accommodations can practice under *their* real conditions. Also required posture for any future school adoption (WCAG).

## 5. Core Features

### 5.1 Bluebook-Style Mock Test Interface
- **Layout:** Top bar with section title, countdown timer (hide/show toggle), "Directions" dropdown; bottom bar with student name, question navigator popup, Back/Next buttons.
- **Two-pane layout** for stimulus-based questions, single pane for standalone questions.
- **Tools:** Mark for Review; answer eliminator (ABC strikethrough); highlighter + annotate; embedded Desmos; reference sheets; zoom/accessibility options.
- **Exam flow:** Start screen → section timing → 5-minute warning → locked section transitions → break screen → review page → submit screen.
- **Section structure per subject** matches the real exam exactly.
- **Three modes:**
  - **Exam mode:** strict, uninterrupted, authentic. **No "I don't know" option** — the real AP has no guessing penalty, so guessing is correct strategy, and the mock trains it (the review screen even nudges: "3 unanswered — there's no penalty for guessing").
  - **Practice mode:** pausable, untimed, instant explanations, **includes an "I don't know" button.**
  - **Diagnostic mode:** the onboarding assessment (5.8), **includes "I don't know."**

### 5.2 The "I don't know" option (diagnostic + practice only)
A dedicated IDK answer distinguishes *"I have no idea"* from *"I guessed and got lucky/unlucky"* — which are completely different signals for the mastery model:
- IDK → strong, clean negative evidence on that skill (better than a wrong guess, which is noisy, and far better than a lucky right guess, which is silently poisonous).
- Selecting IDK in practice immediately shows the explanation and queues the skill for the teach step (5.5) — no shame framing, it's presented as the fast lane to fixing gaps.
- The mastery model weights IDK ≠ wrong-answer ≠ timeout distinctly.
- Deliberately absent from exam mode to keep the mock authentic and to train real test-day strategy.

### 5.3 Question Engine
- Original + AI-generated questions built against the CED via the agent pipeline (Section 7). Every question tagged: subject → unit → topic → CED skill code, difficulty, question type, stimulus type, time estimate.
- Full-length mocks assembled to match the real exam blueprint (CED unit weightings), plus custom quizzes.
- STEM figures produced by the parameterized template + deterministic diagram rendering system (Section 9); humanities document sets produced by the document-set assembly pipeline (Section 8).

### 5.4 Scoring & FRQ Feedback (the moat)
- **MCQ:** instant scoring, per-question explanation, distractor analysis — in STEM, each distractor maps to a *known misconception*.
- **FRQ (AI-graded):** graded against the actual rubric structure per question type; returns points per rubric row, quoted evidence from the student's answer, and 2–3 concrete revision suggestions. Calibrated against College Board's published scored samples (evaluation reference only). "Regrade with explanation" + point disputes.
- Grader inputs are treated as untrusted by default (basic prompt-injection hardening: student text is data, never instructions; grading is per-student so any successful manipulation affects only that student's own feedback — see 7.4). Low priority beyond that: a student gaming their own practice grade only cheats themselves.

### 5.5 The full learning loop: test → diagnose → **teach** → re-test
Diagnosis without remediation is a dead end, so between "you're weak on Unit 4" and the re-test queue sits a teach step:
- **AI-generated targeted explanations:** short, skill-specific explainers generated on demand from the taxonomy + the student's actual errors ("here's the misconception your last three misses share").
- **Curated link-outs:** mapped OpenStax sections and vetted free videos per CED topic (curated once per subject by the content team, stored in the taxonomy DB).
- **Worked examples:** for STEM, the template engine renders a fully worked variant of the missed skill, step by step.
- Then the re-test queue fires on the spaced schedule (1 → 3 → 7 days) with fresh variants.

### 5.6 Scan-and-Grade (the vision system)
Students can photograph **any completed work** and have it graded — modern vision models are fully capable of this, and it's a flagship differentiator:
- **Native hybrid FRQs:** handwritten answers to our own FRQs → photo → vision grading against our rubric (the default hybrid flow).
- **Bring-your-own test:** photos of a completed paper practice test from anywhere — a prep book, a teacher-given mock, released materials the student printed. The pipeline extracts the questions and the student's responses, grades MCQs (against a supplied key when available, otherwise solves them), evaluates FRQ work against the appropriate rubric type, and **imports the results into the same mastery map** — so outside practice feeds the weak-topic engine instead of vanishing.
- **Pipeline (extends R2, Section 7.4):** capture UX (multi-page, deskew, glare warnings) → page segmentation → transcription of typed/handwritten/mathematical content → question-type classification → grading → mastery import.
- **Data handling:** captured images are stored in **Supabase Storage** (private bucket, short-lived signed URLs — consistent with the infrastructure section, §11). The student's *responses* and derived skill tags are stored; third-party *question content* from uploads is processed transiently for grading and not retained, republished, or added to our bank (grading a student's own work is their use; we don't harvest others' content — consistent with Section 10).
- **Confidence gating:** low-confidence extractions ask the student to confirm ("did you answer B on #14?") rather than silently mis-import.

### 5.7 Projected AP score methodology
- Projection = section scores → composite → 1–5 via **last year's released/derived curve for that subject, weighted slightly stricter** — an intentional bias so students are over-prepared rather than flattered. A student who consistently projects a 4 here should feel the real exam was easier than practice.
- The strictness offset is a single tunable constant per subject, documented in the scoring service, revisited each summer when new curve information lands (Curriculum/Calibration ingestion cycle, 7.1).
- Always labeled as an estimate; the score report shows the projection as a range, not a false-precision point.

### 5.8 Diagnostic onboarding (student-side cold start)
A new user's mastery map is empty, so onboarding is a 20–30 minute adaptive diagnostic (with IDK enabled) that seeds the map: broad unit coverage first, then drill-down where answers wobble. Pre-launch difficulty tags are teacher-estimated; item statistics recalibrate them once real answer data accumulates (7.4, R4).

### 5.9 Adaptive Re-testing & Weak Topic Detection
- Every miss (and every IDK) enters the **re-test queue** on the spaced schedule; STEM re-tests serve *fresh template variants* — no memorizing answers.
- **Weak topic flags:** heatmap by CED unit/skill; misconception-level flags in STEM. **Smart drills** and exam-date-driven study plans.

### 5.10 Teacher/Class Layer (Phase 2)
- Classes, assigned mocks/drills, class heatmaps, grade export. Scope note: we are a practice tool, not a proctoring system — no integrity claims for teacher-assigned mocks.

## 6. Data & Content Sourcing (what we collect and why)

Where the raw material comes from — the highest-value sources are public and safe. **The question bank is built on original + AI-generated content; no scraping or republishing of third-party prep content.**

1. **The CED — the foundation.** Free official Course and Exam Description per subject: every unit, topic, learning objective, skill code, essential knowledge statement, exam weighting, question format. The *specification* questions must satisfy.
2. **Released FRQs + scoring guidelines + scored samples — the calibration set.** Posted publicly each year with chief reader reports and real scored student samples. Used to (a) teach our prompts the rubric logic (rubric *structures* are functional, not copyrightable expression), (b) benchmark the AI grader against real reader scores, (c) link students out to College Board's own site. Internal evaluation reference only — never republished, never trained on.
3. **Open-licensed textbooks — the substance.** OpenStax (mostly CC BY) covers most big APs; LibreTexts as a second pool. Verify each license. Also the backbone of the teach step's link-outs (5.5).
4. **Public domain + government sources — the stimulus material.** National Archives / Library of Congress primary sources (real DBQ material); Supreme Court opinions, Constitution, Federalist Papers for AP Gov; Census/CDC/NOAA/USGS datasets for Stats/Bio/Enviro; Project Gutenberg for pre-1930 English passages.
5. **AP teachers — the quality layer.** 2–3 experienced teachers per subject, ideally former official AP Readers: review templates/questions/document sets, write originals, sanity-check grading.
6. **Our own students — the improvement engine.** Item statistics improve the bank; human-verified grades accumulate into the proprietary golden dataset (7.7).

**Pipeline:** CED defines what to test → OpenStax/public domain provides substance and stimulus → agents generate candidates → teachers review → released samples calibrate the grader → student data refines everything.

## 7. AI Agent & Data Pipeline Architecture (the core asset)

Data is the moat, and the moat is built by a fleet of narrow, specialized agents — not one general chatbot. Design principles:

- **Narrow agents, fixed versioned system prompts, structured outputs.** Every agent has one job, a version-controlled prompt in a prompt registry, and must emit JSON matching a schema. No free-text handoffs.
- **Agents propose; deterministic code and humans dispose.** LLMs author and flag; solvers verify math; renderers draw; teachers approve. Nothing reaches a student without machine verification and (at the template level) human review.
- **Provenance on everything:** `{source, url, license, collected_date, allowed_uses}`, enforced at the pipeline level (7.8).
- **Evaluate before deploy:** every prompt/model change runs the regression harness (7.9) first.
- **Model-provider abstraction:** all agents call through one internal LLM client layer so models can be swapped per-agent (frontier for generation, cheaper for classification) and provider changes don't ripple.

### 7.1 Layer 1 — Ingestion agents (scheduled, not real-time)

**I1: Curriculum Parser.** Official CED PDFs → full structured taxonomy (units, topics, learning objectives, essential knowledge, skill codes, weightings, formats) → taxonomy DB. Fixed prompt + PDF tools + strict schema; runs per subject per year; human spot-checks the diff vs. last year. Every downstream agent consumes this — the single source of truth for "what an AP question is allowed to test."

**I2: Calibration Harvester.** College Board's public released-materials pages → structured calibration records `{year, subject, question, rubric_rows, sample_response, awarded_score, reader_commentary}`. Internal-only DB, `allowed_uses: [internal_eval]` — never displayed, never trained on. Runs seasonally (new materials land each summer). Also captures curve/score-distribution information feeding the projection constant (5.7).

**I3: Stimulus Curator.** OpenStax/LibreTexts, LOC, National Archives, Gutenberg, government data portals → license-verified stimulus library with provenance and ready-made attribution strings, tagged to taxonomy. **Default-deny** on unclear licenses; human verifies everything that passes. Also curates the teach-step link-out map (5.5).

### 7.2 Layer 2 — Generation agents

**G1: Template Author** (prompt variant per subject). Authors question *templates*: scenario text with slots, parameter ranges/constraints, solution logic, diagram spec mapping (STEM), distractor bug rules, taxonomy tags. Context via RAG: taxonomy slice, format spec, style guide, in-house exemplars. Output → review queue, never directly to students.

**G2: Diagram Spec Generator.** Emits diagram specs constrained to registered archetype schemas (~40–50 types, typed parameters — Section 9). The agent can only fill schemas; a deterministic SVG renderer draws. Invalid specs rejected at parse time.

**G3: Solver Author.** Drafts the SymPy/NumPy solver per STEM template; sandboxed execution against many sampled parameter sets; cross-checked by Q1; solver code included in human template review. Agent-drafted, machine-tested, human-approved.

**G4: Distractor Engineer.** STEM: applies the bug-rule library so each distractor is *computed* from a specific misconception and tagged with it. Humanities: misconception-based distractors with written rationale per option.

**G5: Document-Set Assembler (humanities — the DBQ problem).** A DBQ isn't one question; it's ~7 curated documents (excerpts, cartoons, data tables) that must *collectively* support thesis, contextualization, sourcing, and complexity arguments. G5 composes candidate document sets from the stimulus library: selects documents spanning required perspectives/periods, trims excerpts to AP-typical length, drafts the prompt, and writes the internal "intended argument map" (which documents support which rubric points) that reviewers grade the set against. Same pattern for AP Lang synthesis-essay source sets (6 coherent sources) and paired-passage questions. Highest human-review burden of any generator — teacher approval is per document set, and the intended-argument map is the review rubric.

### 7.3 Layer 3 — QA agents (nothing ships without passing)

**Q1: Deterministic Verifier (code, not an LLM).** Samples parameters → checks physical/logical validity → runs the solver → confirms intended answer and nice-number constraints. Auto-rejects mismatches. SymPy checks the math, never an LLM.

**Q2: Vision Cross-Checker.** Renders the figure, hands image + question text to a vision model: "solve from the figure and text alone." Wrong/impossible solve → spec/prose drift → flagged.

**Q3: Style & Authenticity Critic.** Scores candidates against AP style conventions (stem phrasing, reading level, option parallelism, subject tics) with in-house exemplars as few-shot. Off-style → back to G1 with critique attached.

**Q4: Red-Team Reviewer.** Ambiguity, multiple defensible answers, cultural bias, accessibility issues (e.g., color-only encoding), factual errors, and — for G5 output — document sets that can't actually earn the complexity point. Includes prompt-injection probes for grader-bound content.

**Human gate:** teachers review at the *template* level for STEM (approve one template = bless thousands of verified instances), per-question for humanities MCQ, per-document-set for DBQ/synthesis. Approval rates per agent version are tracked; a rising rejection rate is an alarm on that agent's prompt.

### 7.4 Layer 4 — Runtime agents (student-facing loop)

**R1: FRQ Grader (typed).** Per question type: fixed grading prompt + RAG-retrieved rubric + calibration exemplars. Strict JSON: per-rubric-row decision, evidence quoted from the student's answer, confidence. Low confidence → human queue. **Hardening:** student text is delimited as data and never treated as instructions; injection cases live in the eval harness. Blast radius is inherently per-student (grading one answer affects only that student's feedback), so this stays a basic-hygiene item, not a deep workstream — a student gaming their own practice grade mostly cheats themselves.

**R2: Vision Grader / Scan-and-Grade.** Two-stage: (1) capture + segmentation + transcription of typed/handwritten/mathematical content and drawn diagrams; (2) rubric grading of the transcription with the original image available. Serves both native hybrid FRQs and bring-your-own-test uploads (5.6). Stricter confidence thresholds; low-confidence extractions confirm with the student; early human-graded fallbacks compound the golden dataset. Third-party question content in uploads is processed transiently, never retained or banked.

**R3: Feedback Coach.** Converts grading JSON into student-facing feedback (what earned points, what didn't and why, 2–3 revisions), tone-controlled. Also generates the teach-step explainers (5.5) from the student's actual error pattern. Kept separate from the grader so grading accuracy and feedback quality evolve independently.

**R4: Item Analyst (classical statistics + narrative agent).** Discrimination indices, distractor pick-rates, time distributions, difficulty recalibration (feeds 5.8); the agent writes plain-language weekly reports for the content team.

### 7.5 Orchestration
- Queue-based pipeline, serverless-first: queues live on **Supabase pgmq** (Postgres-native) or **Vercel Queues** — no Redis, no Temporal. Flow: ingestion → generation → QA → review queue; scheduled ingestion runs on **Supabase scheduled functions / Vercel Cron**; agents stay stateless and are invoked as serverless functions enqueued onto the queue; runtime grading runs on its own queue with SLA monitoring.
- Agents are stateless; state lives in the databases. Every invocation logs `{agent, prompt_version, model, inputs_hash, output, cost, latency}`.
- Prompt registry: prompts versioned like code, changelogs, required eval runs before promotion.

### 7.6 Fixed system prompts vs. post-training (fine-tuning)

**Phase 1 (launch through first season): prompt engineering only. No fine-tuning.**
Fixed versioned prompts + few-shot + structured output + RAG over our corpora. Why: no proprietary training data exists yet; task definitions still shift (College Board changed formats 2025→2026 and will again — a fine-tune freezes behavior); frontier upgrades are inherited free; prompt bugs are readable, fine-tune regressions aren't; iteration is hours, not training runs.

**Phase 2: consider fine-tuning per agent only when ALL four hold:**
1. **Volume:** thousands of in-house, human-verified examples of that agent's exact task (teacher approvals, human grades, dispute resolutions). Only in-house/consented data — never third-party or College Board content.
2. **Stability:** the input/output contract unchanged ≥ one exam cycle.
3. **Measured gap:** the harness shows a ceiling prompt iteration demonstrably can't close.
4. **Unit economics:** volume high enough that a fine-tuned smaller model beats prompted frontier calls on cost/latency.

**Likely landing:** FRQ/vision graders = best candidates (highest volume, narrowest task, our human-graded corpus is the right training data, direct margin lever). Style Critic = plausible second. Template Author / Document-Set Assembler = stay on prompted frontier models indefinitely (need breadth and freshness; fine-tuning a generator on its own outputs breeds mode collapse). Deterministic components have nothing to train.

**Standing rules:** prompt-based fallback for every fine-tune; annual refresh aligned to College Board's summer releases; full harness run on every promotion.

### 7.7 The proprietary golden dataset (the compounding asset)
Every human-verified decision is captured as reusable gold: template approvals/rejections *with reasons*, human FRQ grades, resolved disputes, QA failures, confirmed/corrected scan extractions. This corpus powers the eval harness, supplies few-shot exemplars, is the only data future fine-tunes may touch, and is the thing a competitor cannot copy. Structured from day one: every decision recorded against the exact prompt/model/question version it judged.

### 7.8 Data storage & governance
- **Stores:** taxonomy DB; template/question bank (immutable versions — attempts reference the exact version served); stimulus library (license + attribution); calibration DB (internal-only); golden dataset; student event stream (answers, IDKs, timings, misconception tags); mastery store per (student, skill); transient scan-processing store with short TTL.
- **`allowed_uses` enforcement:** assets flagged `display` / `internal_eval` / `train`; pipeline jobs physically cannot read assets lacking the needed flag. Training jobs only see `train`-flagged (in-house + consented) data — the legal policy as an engineering guarantee.
- **Student data:** PII-minimized; account deletion and data-retention workflows built in from the start; under-13 sign-ups blocked (cleanest COPPA posture — AP students are 14+); de-identified for analytical/training use; consent-gated; never sold.

### 7.9 Evaluation harness
- **Golden sets:** calibration FRQs with real reader scores (grader benchmark); teacher-labeled question-quality set (generator/critic benchmark); scan-extraction accuracy set; regression suite of past failures including injection probes.
- **Core metrics:** grader agreement with humans (exact and ±1; target ≥ 90% within ±1), template approval rate by agent version, QA flag rates, vision extraction accuracy + confidence calibration, post-launch distractor pick-rate sanity.
- **Process:** no prompt/model version promotes without meeting or beating the incumbent. Disputes and overrides feed new regression cases weekly.

### 7.10 Cold-start plan (content side)
Seed each launch subject with ~500–800 reviewed MCQs and ~40 reviewed FRQs: agents over-generate 2–3×, QA filters, teachers approve survivors (~40–60 MCQs or ~10 templates/hour of review throughput). First full mock per subject is hand-assembled by a teacher from the approved pool to guarantee blueprint fidelity; assembly automates once the pool is deep. (Student-side cold start: diagnostic onboarding, 5.8.)

## 8. Humanities Generation (the non-STEM hard problem)

STEM's hard problem is figures (Section 9); humanities' hard problem is *stimulus composition*:
- **DBQs:** ~7 documents that must span perspectives and collectively enable every rubric point — handled by G5 with intended-argument maps as the review artifact.
- **AP Lang synthesis:** 6 coherent sources on one debatable issue, mixed genres (article, chart, cartoon).
- **Passage-based MCQ sets:** passages need authentic period complexity — sourced from public domain (Gutenberg, archives) rather than generated, then question sets written against them.
- **Leakage reality:** static humanities questions leak permanently once screenshotted (STEM templates are naturally resistant via infinite variants). Mitigations: large rotation pools, per-user sampling so no two students see identical mock compositions, exam-mode watermarking of rendered stimulus, leak monitoring (periodic search for our question text), and honest acceptance that some attrition is the cost of business — the moat is the loop and the grader, not any single question.

## 9. STEM Question Generation Architecture (Diagrams & Numeric Questions)

AP Physics (and much of Calc/Chem/Stats) depends on figures, and image models fail at them (hallucinated labels, impossible angles, figure/number mismatches). The solution, executed by agents G2–G4 and Q1–Q2:

### 9.1 Core principle: generate diagram *specifications*, not images
The AI outputs a spec — `{type: "inclined_plane", angle: 30, mass: 5.0, friction: 0.2}` — and a deterministic SVG renderer draws it identically every time. Question text and figure derive from the same parameters: one source of truth, zero mismatched figures.

### 9.2 The diagram taxonomy is finite
~**40–50 archetypes** cover essentially everything (mined from the CED + a decade of released exams):
- **Mechanics:** inclined planes, Atwood machines/pulleys, blocks in contact, springs, pendulums, circular motion, projectiles, rotation, collision frames.
- **Graphs:** x-t, v-t, a-t, F-x curves; energy/momentum bar charts (trivial — parameterized function plots styled like AP figures).
- **E&M:** circuits (series/parallel/RC), point charges, field lines, particle in a field, force on a wire.
- **Waves/optics:** standing waves, pulses, ray diagrams, interference. **Fluids:** pipes, manometers, buoyancy. **Modern:** energy-level diagrams.

Each archetype = one parameterized SVG React component. Real AP figures are minimalist black line art — easy to recreate faithfully. ~15 archetypes cover most of AP Physics 1; each ≈ 1–2 days of component work. Chem/Calc notation notes: mhchem/KaTeX for chemical equations; graph-sketch FRQ types get the digital sketch tool (Section 4).

### 9.3 Parameterized question templates (the real unlock)
Template = scenario text with slots + diagram spec mapping + parameter ranges + solution formula + distractor rules. One approved template → thousands of instances, constrained so answers are AP-clean (2.5 m/s², not 2.4837…) and physically valid (tension positive, μ ≤ tan θ at rest). Powers re-testing with fresh variants and makes the STEM bank leak-proof.

### 9.4 Machine verification (physics' superpower)
Every instance runs through SymPy/NumPy before reaching a student; mismatches auto-reject. Symbolic questions validate via symbolic equivalence. Answer keys are *provably* correct.

### 9.5 Distractors computed from bug rules
Sign flip → distractor A; cos-for-sin → B; unit slip → C. Authentic distractors that reveal the exact misconception when picked.

### 9.6 QA loop
Vision cross-check (solve from figure alone) + template-level teacher review + post-launch item statistics.

### 9.7 FRQ handling for hybrid STEM
Mirror the real hybrid exam: FRQ on screen, handwritten on paper, photo upload, vision grading (R2) — plus the optional digital FBD/graph-sketch practice tool.

### 9.8 Build order
Kinematics graphs + inclined planes → FBDs, projectiles, pulleys → circuits → waves/optics.

## 10. Legal & Compliance

*(General information, not legal advice — budget a real IP lawyer before launch.)*

- **Trademarks.** "Bluebook" and "AP" are College Board trademarks. Standard disclaimer in all materials; "realistic digital exam interface" in public language; recreate the *functional* experience with our own visual design — never their logo, name, or exact assets.
- **Free ≠ free to reuse.** Prep-company content (Princeton Review, Barron's, Kaplan, Fiveable, Knowt) is copyrighted even when free, with ToS prohibiting commercial reuse. College Board's released FRQs are publicly posted but copyrighted; republishing inside a paid product invites a cease-and-desist.
- **No training on third-party content.** Fair use for AI training is actively contested; the exposure layers (acquisition/ToS, training posture, memorized outputs) make it a bad bet for a directly substitutive edtech product. **Policy: never train on competitor or College Board banks** — enforced via `allowed_uses` flags (7.8). Released samples are evaluation reference only.
- **Scan-and-Grade nuance:** grading a student's own responses to third-party questions is the student's use of their own materials; we process uploaded question content transiently and never retain, republish, or bank it (5.6).
- **Safely usable:** facts, concepts, skills, question formats, rubric structures; CC-licensed content per terms; public domain and US government materials; link-outs to College Board's own pages.
- **Minors' data:** under-13 blocked; FERPA-conscious for school adoption; state student-privacy laws; minimal collection; deletion workflows; never sold.
- **AI grading disclaimers:** projections and AI grades are estimates, not official scores — stated everywhere, with the projection shown as a range (5.7).

## 11. Technical Architecture (Web First)

### Frontend
- **React + TypeScript** (Next.js). Exam session as a **state machine** (XState/Zustand): timers, section locks, answer state, autosave, accommodation multipliers (1.5x/2x).
- **Desmos API** embed; KaTeX/MathJax + mhchem; equation editor; rich-text-lite FRQ editor; multi-page photo capture flow (deskew, glare detection) for Scan-and-Grade.
- **Parameterized SVG diagram component library** (Section 9); digital FBD/graph-sketch practice tool.
- **Offline resilience:** local autosave (IndexedDB) + sync.
- **Accessibility:** WCAG-conscious rendering, screen-reader/TTS-friendly question markup.

### Backend
- **Vercel** hosts a **Next.js app + serverless API routes** (web-first; webworker/Cron for scheduled jobs). **Supabase** provides **Postgres + Auth + Storage (+ pgmq queues)**. Sessions/exam timers live in Postgres (epoch-based) — no Redis dependency.
- **Agent pipeline** per Section 7: prompt registry, serverless functions + queue workers, sandboxed solver execution, model-provider abstraction layer, eval harness as CI for prompts.
- **Scoring service:** MCQ inline; FRQ/vision grading async on the grading queue (queue → grader agents → rubric JSON → stored + benchmarked); projection service with per-subject curve constants (5.7).
- **Analytics:** event stream (answers, IDKs, timings) → mastery model per (student, skill, misconception). Recency-weighted accuracy first; BKT/Elo later.

### Infrastructure: Supabase + Vercel + Cloudflare

- **Connection modes:** scripts (`db:check`, `db:migrate`, `seed`) use the session/direct connection at port 5432 via `DATABASE_URL` (see `.env.example`). Vercel serverless functions use the **transaction pooler** with a small max-connections setting and SSL required.
- **RLS posture:** public read for display content (questions, diagrams); owner-scoped access for student data (events, mastery, misconception stats). The service-role key is reserved for the golden dataset and internal jobs — server-side only, never shipped to the client.
- **Storage:** a private uploads bucket with short-lived signed URLs for Scan-and-Grade images; a public bucket for generated diagram SVGs and rendered assets.
- **Domain/DNS via Cloudflare:** apex (via CNAME/ALIAS flattening) and `www` point at Vercel; TLS is Vercel-managed. Cloudflare can optionally proxy in front for CDN/DDoS/WAF — note the apex requires flattening since CNAMEs aren't legal at a zone apex.
- **Local dev without Docker:** develop against a cloud Supabase dev workspace with `.env` `DATABASE_URL`. The Supabase CLI's local mode requires Docker, so it is not used.
- **Deploy gating:** `db:migrate` and `seed` print PENDING-DEPLOY and exit 0 when the database is unreachable, so CI/docs pipelines never hard-fail before the Supabase project is provisioned.

### Cross-platform later
Web-first responsive → Capacitor wrapper or React Native if native feel is demanded. A desktop/tablet-optimized PWA likely covers 90% first; the phone's main job early is the Scan-and-Grade camera flow, which works fine as a responsive web capture.

## 12. Operating Context (kept brief — engineering-relevant only)

- **Pricing shape:** free tier (limited bank, 1 mock/subject, MCQ scoring, one free AI-graded FRQ) → premium season pass. Engineering consequence: per-grade cost matters; cache/batch grading, cap free-tier regrades; fine-tuned grader (7.6) is the long-term margin lever.
- **Differentiation:** exam experience + grader + coach in one loop; provably correct STEM keys; misconception-level diagnostics; Scan-and-Grade. The durable moat is the golden dataset (7.7).
- **Watch item:** College Board improving AP Classroom / adding AI grading; formats shift yearly → annual refresh cycle is a standing engineering commitment.

## 13. Success Metrics

- Activation: % of signups finishing the diagnostic; % finishing a full mock.
- Learning: accuracy lift on re-tested topics; FRQ point improvement mock-over-mock; IDK-rate decline per skill after the teach step.
- Trust: grader agreement with humans (≥ 90% within ±1 point per FRQ); scan-extraction confirmation rate; dispute rate trending down; projection error vs. real scores (measured each July when students report actuals — projections should land at-or-below real scores given the strictness bias).
- Pipeline health: template approval rate trending up; QA flag rates; cost per AI grade.

## 14. Roadmap (calendar-anchored to the May 2027 exams)

The season is the deadline. It is July 2026; exams are early–mid May 2027. Working backward:

**Now → end of Aug 2026 (Phase 0 — Validation):**
- Bluebook-style interface prototype (timer, navigator, mark-for-review, eliminator, two-pane).
- One 15-question APUSH mini-mock + one AI-graded SAQ.
- Inclined-plane template end-to-end (G1→G2→G3→Q1→render) as the STEM proof.
- Curriculum Parser run on two CEDs; calibration DB seeded with 5 years of released materials.
- 20 beta students (recruit as school starts — students are thinking about APs again).

**Sep → Dec 2026 (Phase 1 — MVP, subject #1 live):**
- Full agent layers I1–I3, G1–G5, Q1–Q4, R1/R3 with human review gates; prompt registry + eval harness v1.
- Exam/practice/diagnostic modes incl. IDK; teach step v1 (AI explainers + OpenStax link-outs); re-test queue; accounts, autosave, payments.
- **Hard gate: public launch by late December** to catch New-Year's-resolution studiers. Cut scope, not the date: teacher dashboards, second subject, and the FBD sketch tool are all cuttable; the mock + grader + loop are not.

**Jan → Feb 2027 (Phase 2 — Expansion during peak season):**
- Subjects 2–4 including one hybrid STEM subject: R2 Scan-and-Grade live + first ~15 diagram archetypes.
- Study plans keyed to exam dates; accommodations modes; leak monitoring; golden-dataset tooling.

**Mar → May 2027 (Peak + hardening):**
- Full-mock capacity scaling (grading queue SLAs), projection tuning, dispute workflow, no risky changes after mid-April — stability freeze into exam weeks.

**Summer 2027 (Phase 3 reset):**
- Ingest new released materials + curves; annual refresh; first fine-tuning evaluation for the grader against 7.6 criteria; SAT/PSAT expansion decision (fall season = second revenue window); school sales motion for the new school year.

## 15. Key Risks

1. **The calendar** — miss the late-December launch and the season (and a year of data accumulation) slips. Mitigation: the cut-scope-not-date gate above.
2. **Legal (trademark/copyright/training data)** — Section 10; `allowed_uses` enforcement makes policy an engineering guarantee.
3. **AI grader trust** — calibration benchmarks, visible rubric reasoning, confidence-gated human fallback, dispute workflow.
4. **Vision extraction accuracy** (Scan-and-Grade) — capture UX quality, confirmation prompts on low confidence, human fallback early; every correction compounds the golden dataset.
5. **Bank leakage (humanities)** — rotation pools, per-user sampling, watermarking, monitoring; STEM immune via templates.
6. **Agent quality drift** — prompt registry + regression harness; no promotion without beating the incumbent.
7. **College Board format changes** — annual refresh budget aligned to summer releases (already shifted 2025→2026).

## 16. Immediate Next Steps

1. Pick launch subject #1; run the Curriculum Parser on its CED; seed the calibration DB.
2. Build the interface prototype — the demo that sells the whole idea.
3. Build the inclined-plane template end to end as the STEM proof.
4. Write the FRQ grading prompt for one question type; benchmark against the calibration set.
5. Stand up the prompt registry + eval harness skeleton before writing a second agent prompt.
6. Prototype the Scan-and-Grade capture → transcription → grade path on real handwritten samples (your own practice work is fine) to de-risk R2 early.
7. IP lawyer conversation: trademark language, sourcing, minors' data, Scan-and-Grade posture.
8. Recruit 20 beta students as the school year starts.
