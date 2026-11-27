# alRato demo video: what is on screen

**Length: 2:52**, under the 3:00 contest limit. The video has **English captions burned in** and **no narration**. [`subtitles-en.srt`](subtitles-en.srt) is the same text as a file: upload it as a caption track only if you do not use the burned-in captions, never both.

## How it was made

- **Desktop only.** Recorded on a Windows computer in Microsoft Edge, 1280 × 720, against the hosted app at `alrato-e3564.web.app` (dark theme, prompt version `2026-11-g`). No phone shots.
- **Real cloud model.** Every receipt, hint, connection and the full solution on screen is what the app produced during that run. Nothing is staged, edited or mocked.
- **Cuts remove waiting, never results.** Waits on a real model call are cut. The receipts, latencies and text that appear are untouched.
- **Played at 1.55× speed.** The recorder captures every frame and runs slower than normal use, so the footage is sped up to fit the limit. Where a caption would then be too short to read, the frame under it is held a little longer.
- **The opening example is built in.** The board at 0:12 (−x² − 2x = −3) is a fixed example that ships with the app, and the caption says so. Its graph is partly under the caption, and the device's check of its answers is not legible in the video.
- **No Gemini Nano on that computer.** So every AI answer in the video came from the cloud model, and the video says so (2:35). The on-device route is covered by the automated tests and by the virtual-machine runs described in the README. The video does not show an on-device receipt, because none was produced.
- **Generated board, not a photo.** The whiteboard is a generated image, and the captions say so. The private note uses a board image generated for the test.
- **Consent.** The app asks before the first cloud call (0:37). It was accepted on screen.

## Shot list

| Time | On screen | Caption (abridged) |
|---|---|---|
| 0:00 | Title card | Snap the board. Stay in class. Understand it al rato. |
| 0:05 | Home screen, dark theme | Every class ends the same way: the photo lands in a camera roll. |
| 0:12 | Built-in example: the equation transforms step by step, then the parabola is drawn | When alRato solves an exercise, the equation transforms step by step and the graph is drawn. This is a built-in example. |
| 0:26 | Library with two sample notes | These two are sample notes that ship with the app. |
| 0:32 | Home, "Add the Bellman board" | A generated whiteboard stands in for a real photo. |
| 0:37 | Consent sheet, accepted | The app asks before any cloud model is used. |
| 0:44 | Note page: reading, then organizing (wait cut) | Reading the board runs on the cloud model. |
| 0:48 | Receipt "In the cloud", reason shown | The receipt shows the route the SDK actually took. |
| 0:58 | "Give me a hint" → Nudge, "I need another hint" → Hint | It gets a hint ladder. It teaches instead of answering. |
| 1:13 | "Connected to your note" → "See original note" | It connects the exercise to a note you already have. |
| 1:34 | First step, then "Show the full solution": the board writes V(s) = 0.7 · (2 + 0.9 · 10) = 7.7 step by step | The full solution is long reasoning, so it goes to the cloud model. It plays on the board, one step at a time. |
| 1:46 | Practice: question, See answer, I remembered | Practice turns the note into a question you answer from memory. |
| 1:58 | Review scheduled | The review comes back over the following days. |
| 2:05 | Capture screen, network off: photo saved and waiting | Now the connection drops. A new photo is saved at once and waits. |
| 2:17 | Back online: the note finishes by itself | Back online, the note finishes by itself, with no taps. |
| 2:22 | Capture with "Keep on this device" checked | This one is marked private before it is saved. |
| 2:28 | Private note: "Private note. It stays here until this device has a local AI model." | Mark a note private and it never leaves this device. |
| 2:36 | Caption only | On a computer with Gemini Nano, the same hints run locally. Every answer here came from the cloud model. |
| 2:44 | Title card and project line | Snap it now. Understand it al rato. Open source (Apache-2.0) · Built with Firebase AI Logic · alrato-e3564.web.app |

## What the video does not show

- An on-device receipt ("On this device · nothing sent"). That needs a computer with Gemini Nano.
- The device's own check of a cloud solution in legible form ("Checked on this device, without AI: f(−3) = 0 · f(1) = 0"). It appears in the app under any solution whose exercise is a function or an equation in x; the Bellman exercise is neither.
- A phone, the camera, or a real photo.
- Sync between devices.

## Rules we kept

1. Every receipt on screen comes from the run.
2. No on-device receipt appears unless Gemini Nano produced it. None does here.
3. No third-party logos. Firebase appears as text only.
4. No personal data: a fresh browser profile, no account, no name or email on screen.
