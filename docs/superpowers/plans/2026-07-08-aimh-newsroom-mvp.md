# AIMH Newsroom MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first local-first AIMH Newsroom pipeline that can run from fixtures and produce a complete reviewable episode package.

**Architecture:** A TypeScript CLI orchestrates staged file-producing modules. The dry-run path uses fixtures, deterministic planning, fallback card generation, package-only video-engine integration, QA, and reports so it never blocks on credentials.

**Tech Stack:** Node 24, pnpm, TypeScript, tsx, Vitest, `@resvg/resvg-js` for PNG fallback cards.

---

### Task 1: TDD Baseline

**Files:**
- Create: `tests/redact.test.ts`
- Create: `tests/ranking.test.ts`
- Create: `tests/qa.test.ts`
- Create: `tests/overnight.test.ts`

- [ ] **Step 1: Write failing tests**

Run:

```bash
pnpm test
```

Expected: FAIL because the imported modules do not exist yet.

### Task 2: Core Types And Utilities

**Files:**
- Create: `src/types.ts`
- Create: `src/utils/fs.ts`
- Create: `src/utils/time.ts`
- Create: `src/utils/redact.ts`
- Create: `src/config/env.ts`

- [ ] **Step 1: Implement only the utility functions required by the tests**
- [ ] **Step 2: Run `pnpm test tests/redact.test.ts` and make it pass**

### Task 3: Ranking And QA

**Files:**
- Create: `src/rank/scoreStory.ts`
- Create: `src/qa/qaRunner.ts`

- [ ] **Step 1: Implement ranking formula from the handoff**
- [ ] **Step 2: Implement package QA checks for claims, shots, metadata, and secret text**
- [ ] **Step 3: Run `pnpm test tests/ranking.test.ts tests/qa.test.ts` and make them pass**

### Task 4: Dry-Run Pipeline

**Files:**
- Create: `src/pipeline/overnight.ts`
- Create: `src/cli/index.ts`
- Create: `fixtures/sample-raw-items.jsonl`
- Create: `src/capture/generateFallbackCard.ts`
- Create: `src/integrations/video-engine/detectVideoEngine.ts`
- Create: `src/reports/morningHandoff.ts`
- Create: `src/reports/questionsForDenny.ts`

- [ ] **Step 1: Implement the fixture dry-run spine**
- [ ] **Step 2: Run `pnpm test tests/overnight.test.ts` and make it pass**
- [ ] **Step 3: Run `pnpm newsroom:dry-run` and verify the expected artifact tree exists**

### Task 5: Verification And Handoff

**Files:**
- Modify: `reports/morning-handoff-2026-07-09.md`
- Modify: `CHECKPOINT.md`

- [ ] **Step 1: Run `pnpm lint`**
- [ ] **Step 2: Run `pnpm test`**
- [ ] **Step 3: Run `pnpm build`**
- [ ] **Step 4: Run `pnpm newsroom:dry-run`**
- [ ] **Step 5: Record command results in the morning handoff**
- [ ] **Step 6: Commit the checkpoint**
