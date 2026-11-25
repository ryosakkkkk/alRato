# Devpost submission: alRato

Ready-to-paste text for every field of the #BuildHybridAI entry. Copy what is inside each box. The notes outside the boxes are for you and do not go on Devpost.

## Submission status

Last updated November 25, 2026. Done: the hosted app, the Firebase project with AI Logic and App Check, the public repository, Devpost steps 1 and 2. Still open: the demo video (upload it to YouTube, then add its link to the README and to step 3), the eligibility checkboxes in step 4, and the final submit.

| Contest requirement | Where it is met |
|---|---|
| Public repository with a visible open source license | [`LICENSE`](../../LICENSE) (Apache-2.0) |
| Firebase AI Logic imported and really called | [`src/ai/engine.ts`](../../src/ai/engine.ts) |
| English description: how AI Logic is used, features, value | Section 3 and the [README](../../README.md) |
| Video of 3 minutes or less, in English or with English subtitles | [`docs/demo/VIDEO_SCRIPT.md`](../demo/VIDEO_SCRIPT.md) (2:45) |
| App supports English | English and Spanish ([`src/i18n/`](../../src/i18n)) |
| App Check | [`src/firebase/app.ts`](../../src/firebase/app.ts) |
| No keys, secrets or personal data | Config comes from a git-ignored `.env.local` |
| No third-party logos as endorsement | Text mentions only, with a trademark note in the README |
| AI coding assistants disclosed | Sections 3 and 7, and the README |

---

## 1. Project name

```text
alRato
```

## 2. Elevator pitch

176 characters (limit: 200).

```text
Snap the board, stay in class. Later, alRato reads it, links it to a note you already have and coaches you with hints, on your device when it can and in the cloud when it must.
```

## 3. Project story

<!-- MEASURE: when you have real on-device and cloud numbers, add them to "Accomplishments". Do not add any before they are measured. -->

````markdown
## Inspiration

When the professor finishes a board, the phones go up. The photo lands in a camera roll between screenshots and memes, and for many of us that is the last time we see it. We wanted to keep that two-second habit, because it lets you stay in the class, and fix what comes after it.

We read the research before designing anything, and it changed the product. The evidence on photographing lectures is mixed: in-person experiments found it can hurt memory for the photographed material, and online experiments found it can help (Trego et al., 2025; Ditta et al., 2023). What is well supported is what has to happen next: trying to recall material instead of rereading it (Roediger & Karpicke, 2006) and spacing that practice over time (Cepeda et al., 2006). Prior knowledge helps when it is activated and relevant, not automatically (Brod, 2021). And in a field experiment, unguarded AI help raised practice grades by 48% and then lowered exam grades by 17% (Bastani et al., 2025).

So alRato is not a better camera or a faster answer machine. It is the part that comes back *al rato*, Latin American Spanish for "in a little while".

## What it does

A student photographs the board and looks back up. That is all they do in class. Later, alRato:

1. **Reads** the photo, including handwriting and math, into editable text with LaTeX.
2. **Organizes** it by subject and topic, and extracts two things note apps usually do not: what the note *teaches* and what it *needs* as prior knowledge.
3. **Helps without giving the answer away.** On an exercise, the student climbs a ladder: nudge, hint, first step, full solution.
4. **Connects** the note to one they already have. On-device retrieval matches what this note *needs* against what older notes *teach*. A Bellman equation exercise links to the student's old weighted-average note, because probabilities act as weights, even though the two notes share almost no words.
5. **Schedules practice**, so the student recalls the idea again over the following days and weeks.

Every AI answer carries a receipt: where it really ran (the SDK's `inferenceSource`), how many bytes left the device, and how long it took.

## How we built it

The heart of alRato is **Firebase AI Logic hybrid inference, used per task** instead of with one global setting. A single policy function, `decideRoute()` in `src/ai/router.ts`, picks an SDK inference mode for each call:

- **Private notes** use `ONLY_ON_DEVICE`. If the device has no model, they wait, even on a perfect connection.
- **Reading handwriting and math** uses `PREFER_IN_CLOUD`, because quality matters most there and nobody is waiting for it. On paid mobile data it prefers the device.
- **Organizing a note** uses `PREFER_IN_CLOUD`, because its kind and links decide what the student sees next. **Short hints** use `PREFER_ON_DEVICE`: no network, no API cost.
- **No route available:** the note waits in a queue and resumes by itself.

`src/ai/engine.ts` runs that decision through `getGenerativeModel` with `inCloudParams` and `onDeviceParams`. One JSON Schema configures both routes (`responseSchema` in the cloud, `responseConstraint` on Gemini Nano), so the app handles a single shape. App Check with reCAPTCHA Enterprise protects the cloud route, and Remote Config can swap models and tune thresholds without a rebuild.

The client is React 19, TypeScript and Vite, packaged as an installable PWA. Notes live in IndexedDB through Dexie, and KaTeX renders the math. Optional Google sign-in and Firestore sync let a student snap on a phone and study on a laptop with on-device AI; private notes are never synced. The interface and the model's answers work in English and Spanish.

We built alRato with **Claude Code**, an AI coding assistant, and we disclose that here and in the repository.

## Challenges we ran into

**A "device only" mode that was not.** The docs say `ONLY_ON_DEVICE` throws when no local model exists. Reading the SDK source, we found that in version 13.4, a browser without the Prompt API gets no Chrome adapter, and a request with no adapter goes straight to the cloud. On any phone, a private note would have left the device with no error. We added a gate that refuses the call before the SDK runs, a second check on `inferenceSource`, and a test that pins the behavior against the real SDK.

**A small model got the kind wrong.** In a real on-device run, Gemini Nano filed a worked exercise as a formula in three of four tries. Organizing now runs in the cloud when it is allowed, the instructions say what counts as an exercise, and the student can change the type with one tap before hints start.

**Failure is not the same as unavailability.** The SDK falls back when a model is missing, but not when an on-device call fails or returns weak output. We handle that ourselves, and never for private notes.

**Two very different models, one product.** A small local model and a large cloud model do not behave alike. Shared schemas, strict validators and a cloud retry keep the output usable, and the model can only cite notes we offered it, so a hallucinated reference can never become a link.

**Finding prerequisites, not lookalikes.** Similar text would never connect a Bellman equation to a weighted average. Extracting what each note needs and teaches, with canonical English keys so Spanish and English notes can match, solved that without embeddings and without sending the library anywhere.

**Testing without the hardware.** Our computers and phones cannot run Gemini Nano, so we ran the real model in a free cloud virtual machine with 4 CPU cores and 16 GB of RAM, using Chrome 158 on Linux. It downloaded the model and answered real prompts. Those runs are single samples, so we present them as proof that the route works, not as a benchmark.

## Accomplishments that we're proud of

- A privacy promise enforced in several independent layers and tested against the real SDK, including a behavior the documentation does not describe.
- Receipts that report what actually happened, from the SDK itself.
- A complete product rather than a demo: capture, offline queue, library, hint ladder, connections, spaced practice, two languages, and one-tap data deletion.
- A connection feature that works from what a student already knows, built on published learning research and honest about its limits.

## What we learned

- Hybrid is not a fallback flag. It is a policy, and each task deserves its own answer on latency, cost and privacy.
- A queue changes what latency means. Reading a photo can take its time because the student has already looked away. A hint cannot.
- Read the SDK. The most important thing we found was not in the docs.
- The research is more careful than the slogans. Prior knowledge does not help automatically, and photos do not simply help or hurt. Taking that seriously made the product better.

## What's next

- Run alRato with real students, and measure whether it changes how often they return to their notes and how well they recall them.
- Measure latency and transcription quality on real hardware, for both routes.
- Evaluate how often "Connected to your note" picks the right note.
- Fit the review schedule to real data instead of fixed intervals.
- Use local models on phones as soon as mobile browsers offer them. The router already has a place for them.

## References

Bastani et al. (2025), *PNAS* 122(26). Brod (2021), *npj Science of Learning* 6, 24. Cepeda et al. (2006), *Psychological Bulletin* 132(3). Ditta, Soares & Storm (2023), *JARMAC* 12(3). Roediger & Karpicke (2006), *Psychological Science* 17(3). Trego, Soares & Ditta (2025), *Behavioral Sciences* 15(5). Full list with DOIs in the repository README.
````

## 4. Built with

```text
firebase-ai-logic, gemini, gemini-nano, chrome-prompt-api, firebase, firebase-app-check, firebase-remote-config, firebase-hosting, firebase-authentication, cloud-firestore, recaptcha-enterprise, react, typescript, vite, indexeddb, dexie, katex, pwa, workbox, vitest, claude-code
```

Remove `firebase-hosting` if you do not deploy there.

## 5. "Try it out" links

```text
https://alrato-e3564.web.app
https://github.com/ryosakkkkk/alRato
```

## 6. Testing instructions for judges

````markdown
**No account or setup is needed.** Open https://alrato-e3564.web.app in any modern browser.

**The five-minute path**

1. Click **Try it with sample notes**. Two notes appear: *Weighted average* and *Ohm's law*.
2. Click **Add the Bellman board**. This creates a new board photo that goes through the real AI pipeline.
3. Wait for reading and organizing to finish. Each step leaves a receipt.
4. Click **Give me a hint**, then **I need another hint**. If the model labeled the note as something other than an exercise, use the button shown, or set the type under **⋮ > Edit labels**.
5. Look for **Connected to your note**, linking to *Weighted average*.
6. Click any receipt to see why that route was chosen and which model answered.
7. Click **Practice**, try the question, reveal the answer and rate yourself.

**See each route**

- **Cloud:** use a phone, or any browser without Gemini Nano. The receipt says *In the cloud* with the bytes sent, and DevTools > Network shows a `generateContent` request.
- **On-device:** use desktop Chrome 148 or later, with 22 GB free and either a GPU with more than 4 GB of VRAM or 16 GB of RAM and 4 CPU cores. Open **Your AI** and click **Download on-device AI**. The receipt then says *On this device, nothing sent*, and no `generateContent` request appears.
- **Private note:** turn on **Keep on this device** before taking a photo. With Gemini Nano it runs locally. Without it, the note waits and no request is sent.
- **Offline:** set DevTools > Network to **Offline**. With Gemini Nano, hints keep working. Without it, a new photo waits, then finishes by itself when you go back online.

**If you cannot run Gemini Nano**, the privacy gate and the routing policy are covered by automated tests that use the real Firebase SDK with a stubbed Prompt API:

```bash
git clone https://github.com/ryosakkkkk/alRato
cd alRato
npm install
npm test
```

Full instructions are in the README, under "Testing instructions for judges".
````

## 7. What was built during the submission period

```text
alRato was written from scratch during the submission period, starting from an empty folder. This includes the React app, the per-task hybrid router and engine on Firebase AI Logic, the privacy gate that guards against the SDK's cloud path for ONLY_ON_DEVICE, the offline queue, teaches/needs retrieval, the Socratic hint ladder, spaced practice, the receipts, the English and Spanish interface, optional Google sign-in with Firestore sync, the automated tests, the Firebase configuration, and the documentation.

Pre-existing work is limited to third-party open source libraries, listed with their licenses in the README: the Firebase JS SDK, React, Dexie, KaTeX, Vite, vite-plugin-pwa with Workbox, TypeScript, Vitest, jsdom, fake-indexeddb, and the Fraunces, Inter and Caveat fonts.

The project was built with Claude Code, an AI coding assistant.
```
