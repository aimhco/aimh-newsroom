# German GPT-Live Evidence-First Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one fully German AIMH Newsroom GPT-Live video that reuses the approved evidence-first Version A source footage and presentation, uses the configured AIMH ElevenLabs voice, retains original English source dialogue with German subtitles, passes automated and visual QA, and is not uploaded.

**Architecture:** Add a German production manifest beside the immutable English manifest, make the existing Remotion plate renderer accept an explicit production/visual-content context, and add a narrow local assembly path for the single German version. The German path copies and verifies approved evidence inputs, synthesizes German narration, renders localized plates, burns German subtitles into the two official clips, concatenates the nine timeline segments, and reuses the established FFmpeg logo/outro/audio contracts for finishing.

**Tech Stack:** TypeScript, React 19, Remotion 4, ElevenLabs Multilingual v2, FFmpeg/FFprobe, whisper.cpp CLI for transcript QA, Vitest, pnpm

---

## File Map

- `src/production/gptLiveGerman/content.ts`: German claims-preserving narration, visual copy, evidence editorial copy, UI labels, and production manifest.
- `src/production/gptLiveGerman/subtitles.ts`: Exact German subtitle cues and deterministic SRT serialization for the two official clips.
- `src/production/gptLiveGerman/assets.ts`: Immutable approved-asset inventory, SHA-256 verification, and safe copy into the German episode.
- `src/production/gptLiveGerman/prepare.ts`: German source matrix, speech script, ElevenLabs synthesis, narration slates, localized plate rendering, and prepared report.
- `src/production/gptLiveGerman/renderSegments.ts`: Burned subtitle clips and localized narration segment muxing.
- `src/production/gptLiveGerman/assemble.ts`: Local visual concat, program-audio plan, logo/outro finishing, and render report.
- `src/production/gptLiveGerman/qa.ts`: German editorial/voice checks, final media contract, baseline integrity, SSIM source framing, contact sheet, boundary frames, audio tail, and QA report.
- `src/production/gptLiveGerman/cli.ts`: `prepare`, `render`, `qa`, and `all` commands only; no upload command.
- `src/production/gptLive/types.ts`: Localized renderer-label type.
- `src/production/gptLive/evidence.ts`: Allow evidence lookup and inspection against an explicit manifest.
- `src/production/gptLive/tellaPlan.ts`: Accept an explicit production while preserving the English default.
- `src/production/gptLive/renderPlates.ts`: Accept an explicit production, visual content, and German renderer labels.
- `src/production/gptLive/motion/Root.tsx`: Carry localized UI labels in Remotion props.
- `src/production/gptLive/motion/GptLivePlate.tsx`: Pass localized UI labels to the scene renderer.
- `src/production/gptLive/motion/SceneRenderer.tsx`: Pass localized evidence/source labels into evidence and non-evidence scenes.
- `src/production/gptLive/motion/scenePrimitives.tsx`: Render `DER BELEG` and `QUELLE` instead of hard-coded English when requested.
- `src/production/gptLive/motion/scenes/ConversationScenes.tsx`: Use the localized source label.
- `src/production/gptLive/motion/scenes/EditorialScenes.tsx`: Use localized source labels for both evidence columns.
- `src/production/gptLive/motion/scenes/ProductScenes.tsx`: Use the localized source label.
- `tests/gptLiveGermanContent.test.ts`: German editorial, source, timeline, and subtitle contracts.
- `tests/gptLiveGermanRender.test.ts`: Renderer-context and asset-copy contracts.
- `tests/gptLiveGermanAssembly.test.ts`: FFmpeg subtitle, segment, concat, and finishing contracts.
- `tests/gptLiveGermanQa.test.ts`: QA report, immutable baseline, and no-upload contracts.
- `package.json`: German production commands.
- `episodes/2026-07-13-gpt-live-de/`: Generated, untracked production assets and reports.
- `RESULTS.md`: Builder verification record required by the peer-review workflow.
- `REVIEW.md`: Independent critic pass required by the peer-review workflow.

## Approved German Editorial Copy

Use the following narration verbatim unless pronunciation QA requires a speech-only phonetic spelling. Visible and report copy must retain the spelling below.

| Scene | German narration |
| --- | --- |
| `hook` | Das war keine vorbereitete Übersetzung. ChatGPT hörte auf Französisch zu und sprach fast gleichzeitig auf Englisch. Und Live-Übersetzung ist nur eine von mehreren Fähigkeiten, die GPT-Live plötzlich möglich macht. |
| `full_duplex` | Der entscheidende Begriff ist Full Duplex. Ältere Sprachassistenten funktionierten wie ein Walkie-Talkie: Du hast gesprochen, aufgehört, gewartet – und erst dann antwortete die Maschine. GPT-Live funktioniert eher wie ein Telefonat. Es kann weiter zuhören, während es spricht. Du kannst es also unterbrechen, dich korrigieren, die Richtung ändern oder kurz nachdenken, ohne das Gespräch neu zu starten. |
| `use_cases` | Das ermöglicht weit mehr als flüssigeren Smalltalk. Du kannst ein Gespräch übersetzen, während es stattfindet, eine Sprache in schnellen Rollenspielen üben, eine chaotische Idee laut durchdenken, ohne unterbrochen zu werden, oder eine weitere Bitte äußern, während ChatGPT schon sucht. Das Gespräch läuft weiter, schwierigere Antworten können im Hintergrund von einem stärkeren Modell kommen, und für Wetter, Karten, Sport oder Aktien zeigt Voice visuelle Karten, wenn ein Bild mehr sagt als Worte. |
| `evidence` | Tom's Guide spielte schnelle spanische WM-Kommentare ab und berichtete, dass GPT-Live den Beitrag fortlaufend ins Englische übertrug. Auch OpenAIs eigene Tests zeigen einen großen Sprung beim wissenschaftlichen Denken auf Expertenniveau. Das sind allerdings vom Anbieter veröffentlichte Ergebnisse, keine unabhängige Bestätigung. |
| `availability` | Du kannst GPT-Live jetzt in ChatGPT Voice im Web, auf dem iPhone und unter Android ausprobieren. Kostenlose Konten erhalten GPT-Live-1 mini. Go, Plus und Pro erhalten GPT-Live-1. Unter Einstellungen, dann Voice, findest du die Option Live. Zum Start fehlen weiterhin Live-Video und Bildschirmfreigabe, verbundene Apps und Plugins; einige ChatGPT-Arbeitsbereiche und Werkzeuge werden ebenfalls noch nicht unterstützt. |
| `future` | Spannend wird, was als Nächstes kommt: Sprache, die Aktionen auslöst; Software, die relevante Informationen von sich aus anspricht; und Gespräche, die ohne Unterbrechung zwischen Sprachen wechseln. OpenAI will GPT-Live bald über die API anbieten. Die verwandten Realtime-Werkzeuge zeigen schon heute die Richtung: Reiseänderungen, Terminplanung, Kundensupport und mehrsprachige Arbeit. |
| `cta` | Der Durchbruch ist nicht, dass ChatGPT menschlicher klingt. Der Durchbruch ist, dass du nicht mehr wie eine Maschine sprechen musst, um es zu benutzen. Probiere in Voice eine echte Aufgabe: Übersetze ein Gespräch, denke ein ungeordnetes Problem laut durch oder unterbrich ChatGPT mitten in einer Antwort. Schreib mir in die Kommentare, was GPT-Live für dich möglich gemacht hat – oder was es deiner Meinung nach künftig möglich machen wird. |

Use these complete visible-copy decisions:

- Hook: `LIVE-ÜBERSETZUNG`, `HÖRT FRANZÖSISCH / SPRICHT ENGLISCH`, `HÖRT ZU`, `AUF FRANZÖSISCH`, `SPRICHT`, `AUF ENGLISCH`, `LIVE-EINGABE`, `GLEICHZEITIG`.
- Full duplex: `FULL DUPLEX`, `ZUHÖREN UND SPRECHEN KÖNNEN SICH ÜBERLAPPEN.`, `FRÜHER / WALKIE-TALKIE`, `DU SPRICHST`, `WARTEN`, `DAS MODELL SPRICHT`, `JETZT / GLEICHZEITIGE SPUREN`, `ZUHÖREN`, `SPRECHEN`, `UNTERBRECHUNG ERKANNT / KURS KORRIGIERT`.
- Use cases: `SECHS DINGE ZUM AUSPROBIEREN`, `SECHS SCHNELLE BEISPIELE`, `LIVE-ÜBERSETZUNG`, `SPRACH-ROLLENSPIEL`, `CHAOTISCHE IDEE`, `UNTERBRECHEN + SUCHEN`, `VISUELLE KARTEN`, `ARBEIT IM HINTERGRUND`.
- Evidence: `BERICHTETE BELEGE`, `TOM'S GUIDE BERICHTET`, `FORTLAUFENDE ENGLISCHE ÜBERTRAGUNG`, `VON OPENAI BERICHTET`, `GPT-LIVE-1 VS. ADVANCED VOICE MODE`, `BEI GPQA`, `Keine unabhängige Bestätigung.`
- Availability: `VERFÜGBARKEIT`, `JETZT IN CHATGPT VOICE TESTEN`, `KOSTENLOS`, `GO / PLUS / PRO`, `WO`, `EINSTELLUNGEN > VOICE > LIVE`, `EINSCHRÄNKUNGEN ZUM START`, `KEIN LIVE-VIDEO ODER SCREENSHARING`, `KEINE VERBUNDENEN APPS ODER PLUGINS`, `EINIGE ARBEITSBEREICHE + TOOLS FEHLEN`.
- Future: `WAS ALS NÄCHSTES KOMMT`, `SPRACHE UND SYSTEME WIRKEN IN BEIDE RICHTUNGEN`, flows `SPRACHE → AKTION`, `SYSTEME → SPRACHE`, `SPRACHE → SPRACHE`.
- CTA: `DIE KERNAUSSAGE`, `DU MUSST NICHT MEHR WIE EINE MASCHINE SPRECHEN.`, `GESPRÄCH ÜBERSETZEN`, `CHAOTISCHES PROBLEM DURCHDENKEN`, `MITTEN IN DER ANTWORT UNTERBRECHEN`, `WAS HAT GPT-LIVE FÜR DICH MÖGLICH GEMACHT – ODER WAS WIRD ES NOCH MÖGLICH MACHEN?`.
- Renderer UI labels: `DER BELEG` and `QUELLE`.

Use these German evidence-band takeaways and details in the existing evidence order:

1. `Live-Übersetzung ohne Gesprächspausen.` / `Offizielle GPT-Live-Demonstration von OpenAI.`
2. `Unterbrechen und umlenken, ohne neu anzufangen.` / `Offizielle GPT-Live-Demonstration von OpenAI.`
3. `Gleichzeitig zuhören und sprechen.` / `Darum fühlt sich GPT-Live eher wie ein Telefonat als wie ein Walkie-Talkie an.`
4. `Eine Live-Übertragung wurde fortlaufend übersetzt.` / `Tom's Guide berichtete über eine englische Übertragung schneller spanischer WM-Kommentare.`
5. `OpenAI meldet stärkeres wissenschaftliches Denken.` / `Der GPQA-Wert stammt vom Anbieter und ist keine unabhängige Bestätigung.`
6. `Kostenlos: mini. Bezahlte Tarife: GPT-Live-1.` / `Zugang und Einschränkungen bleiben neben der Erklärung sichtbar.`
7. `Sprache wird zur Schnittstelle für Aktionen.` / `Realtime-Werkzeuge weisen auf Terminplanung, Support, Reiseänderungen und mehrsprachige Arbeit hin.`
8. `GPT-Live kommt in die API.` / `OpenAI bietet Entwicklern und Unternehmen eine Benachrichtigungsliste an.`

---

### Task 1: Add and Validate the German Editorial Manifest

**Files:**
- Create: `src/production/gptLiveGerman/content.ts`
- Create: `tests/gptLiveGermanContent.test.ts`

- [ ] **Step 1: Write failing German-manifest tests**

Test exact production identity, one visual variant, source access date, claim preservation, German narration, informal address, exact timeline replacement, German evidence copy, and absence of English editorial labels:

```ts
expect(GPT_LIVE_GERMAN_CONTENT.id).toBe("2026-07-13-gpt-live-de");
expect(GPT_LIVE_GERMAN_CONTENT.variants).toEqual(["dynamic_editorial"]);
expect(GPT_LIVE_GERMAN_CONTENT.sources.every((source) => source.accessedAt === "2026-07-13")).toBe(true);
expect(GPT_LIVE_GERMAN_CONTENT.claims).toEqual(GPT_LIVE_CONTENT.claims);
expect(GPT_LIVE_GERMAN_CONTENT.narration).toHaveLength(7);
expect(GPT_LIVE_GERMAN_CONTENT.narration.map(({ text }) => text).join(" ")).toContain("du nicht mehr wie eine Maschine");
expect(GPT_LIVE_GERMAN_UI_LABELS).toEqual({ evidence: "DER BELEG", source: "QUELLE" });
expect(JSON.stringify(GPT_LIVE_GERMAN_VISUAL_CONTENT)).not.toMatch(/THE EVIDENCE|SOURCE \/|SIX THINGS|TRY IT NOW/);
expect(() => validateProductionManifest(GPT_LIVE_GERMAN_CONTENT)).not.toThrow();
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
corepack pnpm vitest run tests/gptLiveGermanContent.test.ts
```

Expected: FAIL because `gptLiveGerman/content.ts` does not exist.

- [ ] **Step 3: Implement the complete German manifest**

Derive immutable source footage, claims, branding, and clip timings from the approved manifest; replace only localized fields:

```ts
const narration = [
  { id: "narration_hook", kind: "narration", scene: "hook", claimIds: ["claim_translation"], text: GERMAN_NARRATION.hook },
  { id: "narration_full_duplex", kind: "narration", scene: "full_duplex", claimIds: ["claim_full_duplex"], text: GERMAN_NARRATION.full_duplex },
  { id: "narration_use_cases", kind: "narration", scene: "use_cases", claimIds: ["claim_translation", "claim_delegation", "claim_visuals"], text: GERMAN_NARRATION.use_cases },
  { id: "narration_evidence", kind: "narration", scene: "evidence", claimIds: ["claim_world_cup", "claim_benchmark"], text: GERMAN_NARRATION.evidence },
  { id: "narration_availability", kind: "narration", scene: "availability", claimIds: ["claim_access", "claim_limits"], text: GERMAN_NARRATION.availability },
  { id: "narration_future", kind: "narration", scene: "future", claimIds: ["claim_direction", "claim_api_soon"], text: GERMAN_NARRATION.future },
  { id: "narration_cta", kind: "narration", scene: "cta", claimIds: ["claim_full_duplex"], text: GERMAN_NARRATION.cta }
] as const satisfies readonly NarrationSpec[];

const narrationById = new Map(narration.map((item) => [item.id, item]));
const timeline = GPT_LIVE_CONTENT.timeline.map((item) =>
  item.kind === "source_clip" ? item : narrationById.get(item.id)!
);

export const GPT_LIVE_GERMAN_CONTENT = {
  ...GPT_LIVE_CONTENT,
  id: "2026-07-13-gpt-live-de",
  variants: ["dynamic_editorial"],
  sources: GPT_LIVE_CONTENT.sources.map((source) => ({ ...source, accessedAt: "2026-07-13" })),
  claims: GPT_LIVE_CONTENT.claims,
  narration,
  timeline,
  evidence: localizedEvidence
} as const satisfies GptLiveProduction;
```

Define every narration, visible-copy, and evidence string exactly as listed in the approved-copy section above. Call `validateProductionManifest(GPT_LIVE_GERMAN_CONTENT)` at module initialization.

- [ ] **Step 4: Run the focused tests**

```bash
corepack pnpm vitest run tests/gptLiveGermanContent.test.ts tests/gptLiveContent.test.ts
```

Expected: PASS, confirming the German manifest and unchanged English manifest both validate.

- [ ] **Step 5: Commit**

```bash
git add src/production/gptLiveGerman/content.ts tests/gptLiveGermanContent.test.ts
git commit -m "feat: define German GPT-Live editorial manifest"
```

### Task 2: Make the Approved Renderer Localization-Aware

**Files:**
- Modify: `src/production/gptLive/types.ts`
- Modify: `src/production/gptLive/evidence.ts`
- Modify: `src/production/gptLive/tellaPlan.ts`
- Modify: `src/production/gptLive/renderPlates.ts`
- Modify: `src/production/gptLive/motion/Root.tsx`
- Modify: `src/production/gptLive/motion/GptLivePlate.tsx`
- Modify: `src/production/gptLive/motion/SceneRenderer.tsx`
- Modify: `src/production/gptLive/motion/scenePrimitives.tsx`
- Modify: `src/production/gptLive/motion/scenes/ConversationScenes.tsx`
- Modify: `src/production/gptLive/motion/scenes/EditorialScenes.tsx`
- Modify: `src/production/gptLive/motion/scenes/ProductScenes.tsx`
- Create: `tests/gptLiveGermanRender.test.ts`

- [ ] **Step 1: Write failing renderer-context tests**

Require seven German jobs, German props, one variant, and preserved English defaults:

```ts
const jobs = buildPlateRenderJobs({
  episodeDir: "/episode",
  narrationRecords: germanRecords,
  evidenceDimensions,
  production: GPT_LIVE_GERMAN_CONTENT,
  visualContent: GPT_LIVE_GERMAN_VISUAL_CONTENT,
  uiLabels: GPT_LIVE_GERMAN_UI_LABELS
});

expect(jobs).toHaveLength(7);
expect(new Set(jobs.map(({ variant }) => variant))).toEqual(new Set(["dynamic_editorial"]));
expect(jobs[0]!.inputProps.uiLabels).toEqual({ evidence: "DER BELEG", source: "QUELLE" });
expect(jobs[0]!.inputProps.sceneContent.header).toBe("LIVE-ÜBERSETZUNG");
expect(buildPlateRenderJobs(englishOptions)).toHaveLength(14);
```

Add component-contract tests showing `EditorialBand` renders the supplied evidence label and `sourceLine()` renders the supplied source label.

- [ ] **Step 2: Run tests and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveGermanRender.test.ts tests/gptLiveMotion.test.ts
```

Expected: FAIL because renderer context and localized UI labels are not accepted.

- [ ] **Step 3: Add explicit renderer labels**

Add this type and English default:

```ts
export interface GptLiveUiLabels {
  readonly evidence: string;
  readonly source: string;
}

export const DEFAULT_GPT_LIVE_UI_LABELS: GptLiveUiLabels = {
  evidence: "THE EVIDENCE",
  source: "SOURCE"
};
```

Extend `GptLivePlateProps` with `uiLabels`, pass the labels through `GptLivePlate`, `SceneRenderer`, `SceneFrameProps`, `EvidenceSequence`, `EvidenceLayout`, and `EditorialBand`, then replace hard-coded `THE EVIDENCE` and `SOURCE /` with supplied values. Preserve the English default in `DEFAULT_PROPS`.

- [ ] **Step 4: Parameterize production and visual content**

Add optional explicit context with current English defaults:

```ts
export interface BuildPlateRenderJobsOptions {
  readonly episodeDir: string;
  readonly narrationRecords: readonly PlateNarrationRecord[];
  readonly evidenceDimensions: EvidenceAssetDimensionsByPath;
  readonly production?: GptLiveProduction;
  readonly visualContent?: GptLiveVisualContent;
  readonly uiLabels?: GptLiveUiLabels;
}
```

Use `production.narration`, `production.variants`, `production.evidence`, and `visualContent[narration.scene]` throughout job creation. Update `evidenceForScene(scene, evidenceItems)` and `buildTellaPlan({ ..., production })` so default English callers remain unchanged. Change `TellaNarrationClipPlan.variants` to `Readonly<Partial<Record<GptLiveVariant, TellaVariantPlate>>>`; the English manifest still produces both keys, while German produces only `dynamic_editorial`.

- [ ] **Step 5: Run focused and regression tests**

```bash
corepack pnpm vitest run tests/gptLiveGermanRender.test.ts tests/gptLiveMotion.test.ts tests/gptLiveContent.test.ts
corepack pnpm lint
```

Expected: PASS with no English renderer regression.

- [ ] **Step 6: Commit**

```bash
git add src/production/gptLive tests/gptLiveGermanRender.test.ts tests/gptLiveMotion.test.ts
git commit -m "refactor: localize GPT-Live renderer context"
```

### Task 3: Define German Subtitles and Verify Approved Inputs

**Files:**
- Create: `src/production/gptLiveGerman/subtitles.ts`
- Create: `src/production/gptLiveGerman/assets.ts`
- Modify: `tests/gptLiveGermanContent.test.ts`
- Modify: `tests/gptLiveGermanRender.test.ts`

- [ ] **Step 1: Write failing subtitle and asset-integrity tests**

```ts
expect(GERMAN_SUBTITLES.clip_translation).toEqual([
  { startSeconds: 0, endSeconds: 3.5, text: "Hallo, Chat. Hier ist Alyssa. Kannst du mich hören?" },
  { startSeconds: 3.54, endSeconds: 7.93, text: "Heute erzähle ich dir von meinem Lieblingsessen." },
  { startSeconds: 7.93, endSeconds: 9.55, text: "Ich liebe Eier." },
  { startSeconds: 9.72, endSeconds: 12.35, text: "Besonders liebe ich Omeletts." }
]);
expect(serializeSrt(GERMAN_SUBTITLES.clip_interruption)).toContain("Kannst du das einfacher erklären?");
await expect(copyVerifiedAsset(tamperedFixture)).rejects.toThrow("approved asset hash mismatch");
```

- [ ] **Step 2: Run and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveGermanContent.test.ts tests/gptLiveGermanRender.test.ts
```

Expected: FAIL because subtitle and approved-asset modules are absent.

- [ ] **Step 3: Add exact subtitle cues**

Define the translation cues above and these interruption cues:

```ts
clip_interruption: [
  { startSeconds: 0, endSeconds: 0.80, text: "Kannst du das einfacher erklären?" },
  { startSeconds: 1.26, endSeconds: 5.47, text: "Klar. Kannst du erklären, was ein Full-Duplex-Sprachmodell ist?" },
  { startSeconds: 5.58, endSeconds: 7.86, text: "Ja. Stell dir ein normales Telefonat mit einem Freund vor." },
  { startSeconds: 8.18, endSeconds: 10.16, text: "Du kannst gleichzeitig zuhören und sprechen." },
  { startSeconds: 10.72, endSeconds: 11.96, text: "Das ist Full Duplex." }
]
```

`serializeSrt()` must validate finite nonnegative, ordered, nonoverlapping cues and emit `HH:MM:SS,mmm --> HH:MM:SS,mmm` with a trailing newline.

- [ ] **Step 4: Add the immutable approved-asset inventory**

Pin the approved source hashes:

```ts
export const APPROVED_ASSET_SHA256 = {
  "source/clip_translation.mp4": "4429e60a545cdb07741ef4e33760fb9c0db6ac94837685ffced69b475356b3a5",
  "source/clip_interruption.mp4": "dfc9cc9a547382750079457547695cade17587b54e6420417b36924982e581bb",
  "evidence/openai-gpt-live-full-duplex.png": "3e9e7679a6ba64fa75e416397295f9a378fd4d1cef946ce87662eeeaf71991d1",
  "evidence/toms-guide-world-cup-translation.png": "e6a58eecd2584f6c5bf2a1c5f7262c56b1824e73c3fdc289263ccbcfda3e4467",
  "evidence/openai-gpt-live-evaluations.png": "aef1dae52c20e132243fab496f706c5504640773ef613e4896214ed23c7afb18",
  "evidence/openai-chatgpt-voice-availability.png": "e74242fb42cff9b64165654f56c89e02ea15b3c77c30d7940e6778bb09f5631f",
  "evidence/openai-realtime-future.png": "ab9d3eaf4d77fd4f69764d11ed31319c0b03ce61d5bcc4b35402d904b69f692a",
  "evidence/openai-gpt-live-api-soon.png": "e321a7e78eaba5ef59e9f1bd049f29ddfd9bcb85ec4dc0f4652f82cb9741be2c"
} as const;
```

Implement `copyApprovedAssets()` with `lstat`, no-follow regular-file checks, SHA-256 before and after copy, destination containment under the German episode, and no writes to the approved source episode.

- [ ] **Step 5: Run focused tests**

```bash
corepack pnpm vitest run tests/gptLiveGermanContent.test.ts tests/gptLiveGermanRender.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/production/gptLiveGerman/subtitles.ts src/production/gptLiveGerman/assets.ts tests/gptLiveGermanContent.test.ts tests/gptLiveGermanRender.test.ts
git commit -m "feat: verify German GPT-Live source inputs"
```

### Task 4: Prepare German Narration and Localized Plates

**Files:**
- Create: `src/production/gptLiveGerman/prepare.ts`
- Modify: `tests/gptLiveGermanRender.test.ts`

- [ ] **Step 1: Write failing preparation tests**

Test that preparation requires ElevenLabs, writes seven German chunks, uses `eleven_multilingual_v2`, never returns placeholders, passes the German renderer context, and writes research/source reports with 2026-07-13 access dates.

```ts
expect(buildGermanSpeechScript().narration).toHaveLength(7);
expect(buildGermanSpeechScript().voice.provider).toBe("elevenlabs");
expect(buildSpeechRequestBody(buildGermanSpeechScript().narration[0]!.text, env)).toMatchObject({
  model_id: "eleven_multilingual_v2"
});
expect(buildSpeechRequestBody(buildGermanSpeechScript().narration[0]!.text, env)).not.toHaveProperty("language_code");
await expect(prepareGermanGptLive(missingCredentials)).rejects.toThrow("ElevenLabs credentials are required");
```

ElevenLabs' current API documentation states that German is supported by Multilingual v2 and that `language_code` is not supported by this model, so German is selected from the German text rather than a forced request field.

- [ ] **Step 2: Run and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveGermanRender.test.ts tests/voice.test.ts
```

Expected: FAIL because German preparation is absent.

- [ ] **Step 3: Implement the German speech script and reports**

Build the `ScriptFile` from `GPT_LIVE_GERMAN_CONTENT.narration`. Keep the approved visible text in `reports/script.de.json`; apply speech-only replacements in the ElevenLabs input:

```ts
export const germanSpeechText = (text: string): string => text
  .replaceAll("ChatGPT", "Chat G P T")
  .replaceAll("GPT-Live", "G P T Live")
  .replaceAll("GPQA", "G P Q A")
  .replaceAll("API", "A P I");
```

Generate `reports/research.md` with the four canonical sources, access date, approved claim IDs, and the explicit note that official video audio stays English while AIMH editorial copy and subtitles are German. Generate `reports/source-matrix.md` from the German manifest.

- [ ] **Step 4: Implement preparation orchestration**

`prepareGermanGptLive()` must:

1. Validate absolute contained episode and approved-source directories.
2. Require readable FFmpeg, FFprobe, logo, outro, `ELEVENLABS_API_KEY`, and `ELEVENLABS_VOICE_ID`.
3. Copy and verify approved source/evidence assets.
4. Inspect copied evidence against `GPT_LIVE_GERMAN_CONTENT.evidence`.
5. Synthesize all seven speech-script chunks through the existing adapter.
6. Reject any provider other than `elevenlabs`, any warning, missing file, empty file, or count mismatch.
7. Create narration slates with `buildNarrationSlateArgs()`.
8. Render plates with explicit German production, visual content, and UI labels.
9. Write `production.json`, `voice/narration.json`, `reports/script.de.json`, `reports/research.md`, `reports/source-matrix.md`, and `reports/prepared.json` atomically.

- [ ] **Step 5: Run focused and regression tests**

```bash
corepack pnpm vitest run tests/gptLiveGermanRender.test.ts tests/voice.test.ts tests/gptLiveMotion.test.ts
corepack pnpm lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/production/gptLiveGerman/prepare.ts tests/gptLiveGermanRender.test.ts
git commit -m "feat: prepare German GPT-Live narration"
```

### Task 5: Render Subtitled Source and German Narration Segments

**Files:**
- Create: `src/production/gptLiveGerman/renderSegments.ts`
- Create: `tests/gptLiveGermanAssembly.test.ts`

- [ ] **Step 1: Write failing FFmpeg-argument tests**

Require bottom-safe German subtitles, original source audio, normalized output, and exact plate/voice muxing:

```ts
const args = buildSubtitledClipArgs({ inputPath, srtPath, outputPath });
expect(args.join(" ")).toContain("subtitles=");
expect(args.join(" ")).toContain("FontName=Inter");
expect(args.join(" ")).toContain("FontSize=42");
expect(args).toEqual(expect.arrayContaining(["-map", "0:v:0", "-map", "0:a:0", "-ar", "48000", "-ac", "2"]));

expect(buildNarrationSegmentArgs({ platePath, voicePath, durationSeconds: 12.3, outputPath }))
  .toEqual(expect.arrayContaining(["-map", "0:v:0", "-map", "1:a:0", "-t", "12.300"]));
```

- [ ] **Step 2: Run and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveGermanAssembly.test.ts
```

Expected: FAIL because segment rendering is absent.

- [ ] **Step 3: Implement subtitle clip rendering**

Write both SRT files under `subtitles/`, then run FFmpeg with:

```text
subtitles=<escaped-srt-path>:force_style='FontName=Inter,FontSize=42,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=64,Alignment=2'
```

Map original video and audio, encode H.264 CRF 18/yuv420p/30 fps/BT.709 and AAC 192k/48 kHz/stereo, and preserve each source clip's measured duration within 0.10 seconds.

- [ ] **Step 4: Implement narration segment rendering**

For each narration item, mux the localized silent plate with its German MP3 into `segments/<narration-id>.mp4`, encode AAC 192k/48 kHz/stereo, and require video/audio/container durations within 0.10 seconds of the voice duration.

The segment order is exactly:

```ts
export const GERMAN_SEGMENT_ORDER = [
  "clip_translation",
  "narration_hook",
  "clip_interruption",
  "narration_full_duplex",
  "narration_use_cases",
  "narration_evidence",
  "narration_availability",
  "narration_future",
  "narration_cta"
] as const;
```

- [ ] **Step 5: Run focused tests**

```bash
corepack pnpm vitest run tests/gptLiveGermanAssembly.test.ts tests/gptLiveMedia.test.ts
corepack pnpm lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/production/gptLiveGerman/renderSegments.ts tests/gptLiveGermanAssembly.test.ts
git commit -m "feat: render German GPT-Live segments"
```

### Task 6: Assemble and Finish the German Video Locally

**Files:**
- Create: `src/production/gptLiveGerman/assemble.ts`
- Modify: `tests/gptLiveGermanAssembly.test.ts`

- [ ] **Step 1: Write failing local-assembly tests**

Require nine ordered visual inputs, no time stretching, audited segment audio, established logo/outro finishing, and the final path:

```ts
expect(buildProgramVisualArgs(segments, outputPath).join(" ")).toContain("concat=n=9:v=1:a=0");
expect(buildGermanProgramAudioPlan(segments).clipOrder).toEqual(GERMAN_SEGMENT_ORDER);
expect(buildGermanProgramAudioPlan(segments).tellaInputAudioUsed).toBe(false);
expect(germanFinalPath(episodeDir)).toBe(join(episodeDir, "final", "gpt-live-de.mp4"));
```

- [ ] **Step 2: Run and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveGermanAssembly.test.ts tests/gptLiveFinish.test.ts
```

Expected: FAIL because the local assembler is absent.

- [ ] **Step 3: Implement the visual program concat**

Decode the nine segment videos and concatenate their video streams with `setpts=PTS-STARTPTS` into `exports/gpt-live-de-program.mp4`. Encode H.264 CRF 18, medium preset, yuv420p, 30 fps, BT.709, no audio, and `+faststart`. The measured program duration must equal the sum of measured segment durations within 0.25 seconds.

- [ ] **Step 4: Implement audited program audio and finishing**

Build a `ProgramAudioPlan` whose input indexes start at 2, whose paths point to the nine segment files, and whose kinds match the German timeline. Derive source intervals from the measured timeline, measure both subtitled source clips with `measureIntervalLoudness()`, and call `deriveSharedSourceGains(intervals, measurements, measurements)` for the single version.

Reuse `buildFinishFfmpegArgs()` with:

```ts
{
  inputPath: programPath,
  logoPath: env.AIMH_LOGO_PATH!,
  outroMusicPath: env.AIMH_OUTRO_MUSIC_PATH!,
  outputPath: join(episodeDir, "final", "gpt-live-de.mp4"),
  durationSeconds: programDuration,
  outroDurationSeconds: GPT_LIVE_GERMAN_CONTENT.audio.outroDurationSeconds,
  sourceGains,
  programAudio
}
```

Write `reports/render.json` with segment order, segment durations, source-gain measurements, program duration, final duration, SHA-256 values, logo settings, and outro timing.

- [ ] **Step 5: Run focused and regression tests**

```bash
corepack pnpm vitest run tests/gptLiveGermanAssembly.test.ts tests/gptLiveFinish.test.ts
corepack pnpm lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/production/gptLiveGerman/assemble.ts tests/gptLiveGermanAssembly.test.ts
git commit -m "feat: assemble German GPT-Live video"
```

### Task 7: Add German-Specific QA and Visual Reports

**Files:**
- Create: `src/production/gptLiveGerman/qa.ts`
- Create: `tests/gptLiveGermanQa.test.ts`

- [ ] **Step 1: Write failing QA tests**

Require exact final media, seven ElevenLabs chunks, German editorial content, baseline hashes, subtitle files, source fullscreen samples, contact sheet, boundary frames, tail signal, no upload fields, and a passing verdict only when all checks are true.

```ts
expect(assertGermanEditorialCopy(GPT_LIVE_GERMAN_CONTENT)).not.toThrow();
expect(() => assertGermanEditorialCopy(englishFixture)).toThrow("English editorial copy remains");
expect(() => assertApprovedInputs(APPROVED_ASSET_SHA256, tamperedHashes)).toThrow("Approved input changed");
expect(buildGermanQaReport(passingFixture).checks).toEqual({
  editorialGerman: true,
  elevenLabsNarration: true,
  subtitlesPresent: true,
  mediaContract: true,
  sourceFullscreen: true,
  boundaryFramesNonblank: true,
  tailSignalPresent: true,
  approvedInputsUnchanged: true,
  uploadDisabled: true
});
```

- [ ] **Step 2: Run and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveGermanQa.test.ts
```

Expected: FAIL because German QA is absent.

- [ ] **Step 3: Implement automated media and integrity QA**

Use `inspectFinalMediaFile()` and `assertFinalMediaContract()` to require H.264, 1920x1080, 30 fps, yuv420p, BT.709, AAC 192k, 48 kHz stereo, and synchronized stream durations. Require total duration between 160 and 190 seconds.

Rehash the approved source episode and both approved English final paths; require source/evidence hashes from `APPROVED_ASSET_SHA256` and approved English final SHA-256 `2b745fbd7643cb163b18a42d626236136ac847e45e741a3eaca13e788ec679fb`.

Require all seven voice chunks to report `elevenlabs`, have no warnings, use `eleven_multilingual_v2` cache metadata, and contain nonempty files.

- [ ] **Step 4: Implement visual, subtitle, and audio QA artifacts**

- Generate `reports/visual/contact-sheet.png` with 12 evenly spaced 480x270 samples in a 4x3 tile.
- Extract two frames around each of the eight scene boundaries and reject frames with luma variance below the established nonblank threshold.
- Compare the upper 760 pixels of the local program's translation/interruption intervals against the approved source clips at 10, 50, and 90 percent using SSIM; require all six samples at or above 0.90. This excludes the intentional German subtitle band while proving full-screen source framing.
- Extract the final eight seconds to `reports/visual/tail.wav` and require a nonzero audio signal.
- Record the two SRT paths and cue counts in `reports/qa.json`.

- [ ] **Step 5: Add transcript-assisted German voice QA**

Support `WHISPER_CLI_PATH` and `WHISPER_MODEL_PATH`. Transcribe the seven narration MP3s with language `de`, write JSON transcripts under `reports/transcripts/`, and require German-language output plus recognition of the normalized key-term set `ChatGPT`, `GPT Live`, `Tom's Guide`, `Full Duplex`, `GPQA`, and `API` across the combined transcripts. Keep the generated transcript artifacts even if a term check fails so pronunciation can be corrected narrowly.

- [ ] **Step 6: Run focused tests**

```bash
corepack pnpm vitest run tests/gptLiveGermanQa.test.ts tests/gptLiveQa.test.ts tests/gptLiveFinish.test.ts
corepack pnpm lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/production/gptLiveGerman/qa.ts tests/gptLiveGermanQa.test.ts
git commit -m "feat: verify German GPT-Live production"
```

### Task 8: Add the No-Upload German Production CLI

**Files:**
- Create: `src/production/gptLiveGerman/cli.ts`
- Modify: `package.json`
- Modify: `tests/gptLiveGermanQa.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Require only `prepare`, `render`, `qa`, and `all`; reject `upload` and reject paths outside the repository `episodes/` root.

```ts
await expect(runGermanCli(["upload"], deps)).rejects.toThrow("Unknown German GPT-Live command: upload");
await expect(runGermanCli(["all", "--episode-dir", "/tmp/outside"], deps)).rejects.toThrow("must remain inside episodes");
expect(packageJson.scripts).toMatchObject({
  "gpt-live-de:prepare": "tsx src/production/gptLiveGerman/cli.ts prepare",
  "gpt-live-de:render": "tsx src/production/gptLiveGerman/cli.ts render",
  "gpt-live-de:qa": "tsx src/production/gptLiveGerman/cli.ts qa",
  "gpt-live-de:all": "tsx src/production/gptLiveGerman/cli.ts all"
});
expect(Object.keys(packageJson.scripts)).not.toContain("gpt-live-de:upload");
```

- [ ] **Step 2: Run and verify failure**

```bash
corepack pnpm vitest run tests/gptLiveGermanQa.test.ts
```

Expected: FAIL because the CLI and scripts are absent.

- [ ] **Step 3: Implement the German CLI**

Default to:

```text
episode: episodes/2026-07-13-gpt-live-de
approved source: .worktrees/gpt-live-tella-ab/episodes/2026-07-10-gpt-live-tella-ab
```

Load the existing `.env` through the current environment loader. `all` calls preparation, segment rendering/assembly, then QA in sequence. The command parser has no upload branch and never imports the YouTube integration.

- [ ] **Step 4: Run focused tests and build**

```bash
corepack pnpm vitest run tests/gptLiveGermanQa.test.ts
corepack pnpm lint
corepack pnpm build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/production/gptLiveGerman/cli.ts package.json tests/gptLiveGermanQa.test.ts
git commit -m "feat: add German GPT-Live production command"
```

### Task 9: Run the Full German Production and Complete QA

**Files:**
- Generate: `episodes/2026-07-13-gpt-live-de/**`
- Modify: `RESULTS.md`
- Modify: `REVIEW.md`

- [ ] **Step 1: Prepare transcript QA tooling outside the repository**

Use the installed `whisper-cli`. Download the multilingual base model to the user cache only if it is absent:

```bash
mkdir -p "$HOME/.cache/whisper"
curl -L --fail --retry 3 \
  -o "$HOME/.cache/whisper/ggml-base.bin" \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

Set:

```bash
export WHISPER_CLI_PATH="$(command -v whisper-cli)"
export WHISPER_MODEL_PATH="$HOME/.cache/whisper/ggml-base.bin"
```

- [ ] **Step 2: Run the full German production**

```bash
corepack pnpm gpt-live-de:all -- \
  --episode-dir episodes/2026-07-13-gpt-live-de \
  --source-episode-dir .worktrees/gpt-live-tella-ab/episodes/2026-07-10-gpt-live-tella-ab
```

Expected: seven noncached-or-valid-cached ElevenLabs German MP3s, two subtitled source clips, seven localized narration plates and segments, one final MP4, and passing `reports/qa.json`. No upload command runs.

- [ ] **Step 3: Inspect generated German editorial assets**

```bash
jq '.narration[] | {id,text}' episodes/2026-07-13-gpt-live-de/production.json
jq '{provider,warnings,chunks:[.chunks[]|{id,durationSeconds,provider,cached}]}' episodes/2026-07-13-gpt-live-de/voice/narration.json
jq '.' episodes/2026-07-13-gpt-live-de/reports/qa.json
ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels -of json episodes/2026-07-13-gpt-live-de/final/gpt-live-de.mp4
```

Expected: German narration, `elevenlabs`, no warnings, all QA checks true, and the approved media contract.

- [ ] **Step 4: Perform visual review**

Open the contact sheet and every boundary frame with `view_image`. Inspect source subtitle frames separately at the midpoint of each official clip. Then play the final video from beginning to end at normal speed and review pacing, subtitle readability, German pronunciation, source-audio transitions, narration endings, and the outro fade. Reject and rerender any English AIMH-authored copy, overflow, collision, unreadable subtitle, blank transition, altered evidence crop, logo obstruction, clipped word, abrupt audio change, or pacing failure.

- [ ] **Step 5: Perform transcript and audio-tail review**

Read every Whisper transcript, compare it with the approved German narration scene, and rerender only any scene with a missing or badly recognized key term. Inspect the final tail waveform and confirm the outro fade is present without truncated CTA speech.

- [ ] **Step 6: Run the complete fresh verification suite**

```bash
corepack pnpm test
corepack pnpm lint
corepack pnpm build
corepack pnpm gpt-live-de:qa -- \
  --episode-dir episodes/2026-07-13-gpt-live-de \
  --source-episode-dir .worktrees/gpt-live-tella-ab/episodes/2026-07-10-gpt-live-tella-ab
git diff --check
```

Expected: all tests pass, typecheck/build pass, fresh German QA passes, and no whitespace errors.

- [ ] **Step 7: Write the Builder result record**

Append to `RESULTS.md`:

```markdown
## German GPT-Live Evidence-First Video — 2026-07-13

### What works
- German narration, editorial copy, subtitles, local rendering, finishing, and QA are verified.

### What's brittle or incomplete
- Official source-page pixels remain English by design; German summaries identify their meaning.

### Known gaps
- The official English speakers are not dubbed or lip-synced.

### Assumptions made
- The configured ElevenLabs voice is the user's approved AIMH voice.
```

Add exact fresh command results and final video SHA-256 beneath the verified-work bullet.

- [ ] **Step 8: Perform the Critic pass and write `REVIEW.md`**

Review every modified source/test file and all generated reports against the approved design. Use the required Critical/Major/Minor/Observations/Verdict structure. Do not fix findings during the critic pass. If a critical or major issue blocks the requested local deliverable, return to Builder mode, fix it, rerun Step 6, and then replace the critic report with a fresh independent pass.

- [ ] **Step 9: Commit production code and review records**

Do not add generated episode media unless the repository policy explicitly tracks it. Commit code, tests, `RESULTS.md`, and `REVIEW.md`:

```bash
git add src/production/gptLive src/production/gptLiveGerman tests package.json pnpm-lock.yaml RESULTS.md REVIEW.md
git commit -m "feat: produce German GPT-Live newsroom video"
```

- [ ] **Step 10: Hand off the local final only**

Provide the absolute clickable path:

`/Users/dennywii/Documents/dev/aimh-newsroom-pipeline/episodes/2026-07-13-gpt-live-de/final/gpt-live-de.mp4`

Also provide duration, SHA-256, QA report path, and review verdict. State explicitly that no upload was performed.
