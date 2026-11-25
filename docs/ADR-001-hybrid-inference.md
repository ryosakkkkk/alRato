# ADR-001: Choose the inference route per task, between the client and the cloud

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-23 |
| **Scope** | Where each AI task in alRato runs |
| **Code** | [`src/ai/router.ts`](../src/ai/router.ts), [`src/ai/engine.ts`](../src/ai/engine.ts) |
| **See also** | [Architecture](ARCHITECTURE.md) · [Versión en español](es/ADR-001-inferencia-hibrida.md) |

## Context

alRato lets a student photograph the board in class and deal with it later. The app reads the photo, organizes it, helps through a hint ladder, links the note to an earlier one and schedules practice. Each of these steps calls a language model, and each has different needs.

The forces that shaped this decision:

1. **Capture happens on a phone, and phone browsers have no local model.** On-device inference through Firebase AI Logic on the web needs Chrome on desktop. [Chrome on Android and iOS is not supported](https://developer.chrome.com/docs/ai/get-started). The cloud route cannot be an afterthought.
2. **Capable desktops can run Gemini Nano for free.** Chrome needs 22 GB free on the profile volume and either a GPU with more than 4 GB of VRAM or 16 GB of RAM with 4 or more CPU cores.
3. **The input is hard.** Boards contain handwriting, math notation and bad lighting, in English or Spanish.
4. **Students pay for data.** A photo is the largest thing the app sends, and connections in a classroom are unreliable.
5. **Some notes are personal.** A student must be able to say "this stays on my device" and have that hold.
6. **Quota is finite.** The default cloud models are [marked "billing not required"](https://firebase.google.com/docs/ai-logic/models) on the Gemini Developer API, which has usage limits. On Nov 24, 2026, Google AI Studio showed 500 requests a day each for `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite`, and 20 a day for `gemini-3.8-flash`, per project and shared by every user.
7. **Attention is the scarcest resource.** Capture has to take seconds, because the student needs to look back at the board.

## Decision

**We choose the inference route per task, using the Firebase AI Logic SDK's four inference modes, through one policy function: `decideRoute()`.** We do not set one mode for the whole app.

| Work | Where it runs | Why |
|---|---|---|
| Capture, image normalization, storage | Client, always | Must be instant and work offline. Photos are the most sensitive data |
| Queue, routing, retries | Client, always | Must work with no network |
| Retrieval (needs against teaches) | Client, always | It reads the whole library, so it should never leave the device |
| Scheduling, validation, rendering | Client, always | No model needed |
| **Reading a photo** | `PREFER_IN_CLOUD`, or `PREFER_ON_DEVICE` on paid data | The hardest task, and nobody is waiting for it |
| **Organizing a note** | `PREFER_ON_DEVICE` | Short, structured and done for every note |
| **Hints** | `PREFER_ON_DEVICE` | Interactive and frequent |
| **Long inputs** | `PREFER_IN_CLOUD` | Over 3,500 characters by default |
| **Private notes, every task** | `ONLY_ON_DEVICE`, or wait | The student's explicit instruction |
| **No route available** | Wait in the queue | Resume when a route opens |
| Attestation, model serving, remote settings | Cloud | App Check, AI Logic, Remote Config |
| Moving notes between a student's devices | Firestore, only if the student opts in | Lets a photo taken on a phone be studied on a laptop with Gemini Nano. Private notes never sync |

Three supporting decisions make this safe:

- **A privacy gate in front of the SDK.** In SDK 13.4, `ONLY_ON_DEVICE` in a browser without the Prompt API silently goes to the cloud: `chromeAdapterFactory` creates no adapter when `LanguageModel` is missing, and `callCloudOrDevice` sends any request without an adapter to the cloud. The [documentation](https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options) says this mode throws. `assertOnDevicePossible()` refuses the call before the SDK runs, and `tests/engine.test.ts` pins the behavior so we notice if it changes.
- **Our own fallback for failed device calls.** The SDK falls back when the model is unavailable, but not when an on-device call fails or returns unusable output. The engine retries those in the cloud, except for private notes.
- **Receipts from the SDK.** Each answer records `response.inferenceSource`, so the interface reports what actually happened instead of what the policy intended.

## How we weighed latency, cost and privacy

| Task | Is someone waiting? | Payload | Quality demand | How often | Default |
|---|---|---|---|---|---|
| Read | No, it runs after class | Large (photo) | Highest | Once per note | Cloud first |
| Organize | Rarely | Small | Moderate | Once per note | Device first |
| Hint | Yes | Small | Moderate | Several per note | Device first |

### Latency

The queue changes what latency means here. **Reading is not interactive.** The student has already gone back to the board, so a network round trip costs them nothing and a slower route is acceptable.

**Hints are interactive.** The student is looking at a problem and waiting. Running them on the device avoids the network entirely, which helps on a bus or on weak campus Wi-Fi. Capture is decoupled from both, so it never waits for a model.

We have not measured on-device or cloud latency yet, so this reasoning is architectural and carries no numbers. <!-- MEASURE: median and p95 latency per task and route, on hardware that meets Chrome's requirements -->

### Cost

There are two budgets, and the student's is the one that matters more.

- **The student's mobile data.** Photos are the largest payload. On a metered connection with a local model available, the router reads the photo on the device (`save_data`).
- **API quota.** Organizing and hints are the most frequent calls. Running them on-device costs no quota and saves it for the task that benefits most from the cloud. A per-browser daily cap (`daily_cloud_cap`, default 40) and a per-model quota check (a model that has used its daily quota is skipped until midnight Pacific time) keep a loop or a bug from draining the shared free tier.
- **The device's cost.** The local model is a one-time download that needs an unmetered connection and a lot of free disk. We never trigger it without a click.

<!-- MEASURE: typical bytes per note on the cloud route, from real receipts -->

### Privacy

- Retrieval reads the student's whole library, so it runs on the device, always.
- A note marked private never gets a mode that can reach the cloud. If the device cannot run it, it waits. We prefer a note that waits over a note that leaks.
- For other notes, only what the task needs is sent. A hint includes at most three related, non-private snippets of 260 characters.
- Any student can see what left the device on the receipt.

### Quality

Reading math and handwriting is the task where model quality matters most, and an error there poisons everything downstream. We do not assume Gemini Nano matches the cloud at it, so reading prefers the cloud whenever the student is not paying for the data. The student can correct any transcription, and an edit restarts the pipeline.

<!-- MEASURE: transcription accuracy on real board photos, cloud against Nano -->

## Alternatives considered

### A. Cloud only

The simplest option, and it would work on every phone. We rejected it because it cannot honor a private note, stops working without a connection, spends quota on small tasks and sends every note to a server even when the task does not need one.

### B. On-device only

The best option for privacy and cost. We rejected it because the device where capture happens, the phone, has no Prompt API in the browser. It would also exclude students whose computers fall below Chrome's hardware requirements, and it would rely on the local model for the hardest task.

### C. Native Android with ML Kit

This was the most serious alternative, because it would put a local model on the phone. We explored it and dropped it for four reasons:

1. **ML Kit text recognition is not built for math notation.** [Text Recognition v2](https://developers.google.com/ml-kit/vision/text-recognition/v2) covers Latin, Chinese, Devanagari, Japanese and Korean scripts. Its documentation describes no support for formulas or equations, and those are the core of our input.
2. **Language coverage does not fit our students.** Google's [Prompt API guide, as archived in April 2026](https://web.archive.org/web/20260417224627/https://developers.google.com/ml-kit/genai/prompt/android/get-started), listed only English and Korean as validated languages. The [current guide](https://developers.google.com/ml-kit/genai/prompt/android/get-started) no longer publishes a list, and the [overview](https://developers.google.com/ml-kit/genai) says availability varies with device configuration and downloaded models. We could not count on Spanish.
3. **Requests are small.** Input must stay [under 4,000 tokens](https://developers.google.com/ml-kit/genai/prompt/android/get-started), which is tight for a note, prior-note candidates and instructions together.
4. **The target student's phone is not supported.** The feature runs only on a [published list of devices](https://developers.google.com/ml-kit/genai), and the phone of the student we designed for is not on it.

A web app also gives us one codebase for phones and desktops and needs no app store. If local models arrive in mobile browsers, the router can use them without changing the policy.

### D. One SDK mode for the whole app

`PREFER_ON_DEVICE` everywhere is one line of code, but it would read handwriting on the local model whenever one exists, even on free Wi-Fi. `PREFER_IN_CLOUD` everywhere would spend quota and add a round trip to every hint. Neither can express "this note must never leave". The value of the hybrid SDK comes from choosing per task.

### E. Our own backend or proxy

A server would allow server-side rate limits and hide prompts. It would also put a new place where student notes pass through, plus code and cost to maintain. Firebase AI Logic with App Check lets the client call the model safely with no server of ours, which fits an app whose premise is that data stays with the student.

### F. Embeddings for retrieval

Embeddings are the usual way to find related notes. They would need either a separate embedding model shipped to the browser or sending the student's notes to the cloud. They also tend to find notes that are *similar*, while we want notes that are *prerequisites*. Matching extracted `needs` against `teaches` runs in any browser, works across languages through canonical English keys, and is easy to explain.

## Consequences

**Positive**

- The app works on any modern browser and gets better on capable hardware.
- Private notes have a real guarantee, backed by a test against the real SDK.
- Quota and mobile data go where they add the most value.
- Every route is visible to the student, and the policy lives in one pure, tested function.

**Negative, and accepted**

- **Two models to support.** Answers can differ in quality between routes. Shared schemas, validators and a cloud retry reduce this but do not remove it.
- **Private notes wait on phones.** Without a local model, a private note stays a photo with no AI help, and because private notes never sync, a laptop cannot process it for the phone. We chose privacy over function here.
- **Privacy starts at capture.** Marking a note private later cannot recall data already sent, and a pipeline already running on it may finish its current sequence in the cloud.
- **Dependence on SDK behavior.** We rely on internals that may change. The pinned test is our alarm.
- **Harder to verify.** Real Gemini Nano needs specific hardware. Our automated tests run the real SDK against a stubbed Prompt API, which proves the integration but not the model's quality or speed.

## Validation still required

We will revisit this decision when we have these measurements. Until then, no document in this project reports them.

- Latency per task and route on real hardware <!-- MEASURE: on-device and cloud latency -->
- Transcription accuracy on real board photos, cloud against Nano <!-- MEASURE: transcription accuracy -->
- Precision of "Connected to your note" on real student notes <!-- MEASURE: connection precision -->
- Bytes sent per note in normal use <!-- MEASURE: bytes per note -->

## References

- Firebase: [Hybrid inference on the web](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started), [configuration options](https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options), [App Check for AI Logic](https://firebase.google.com/docs/ai-logic/app-check), [supported models](https://firebase.google.com/docs/ai-logic/models)
- Chrome: [Get started with built-in AI](https://developer.chrome.com/docs/ai/get-started), [Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
- ML Kit: [Text Recognition v2](https://developers.google.com/ml-kit/vision/text-recognition/v2), [GenAI APIs overview](https://developers.google.com/ml-kit/genai), [Prompt API on Android](https://developers.google.com/ml-kit/genai/prompt/android/get-started)
- Learning science behind the product: see the [references in the README](../README.md#references)
