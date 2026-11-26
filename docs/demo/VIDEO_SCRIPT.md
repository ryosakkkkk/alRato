# alRato demo video: what is on screen

**Length: 2:02**, under the 3:00 contest limit. The video has **English captions burned in** and **no narration**. [`subtitles-en.srt`](subtitles-en.srt) is the same text as a file: upload it as a caption track only if you do not use the burned-in captions, never both.

## How it was made

- **Desktop only.** Recorded on a Windows computer in Microsoft Edge, 1280 × 720, against the hosted app at `alrato-e3564.web.app`. No phone shots.
- **Real cloud model.** Every receipt, hint and connection on screen is what the app produced during that run. Nothing is staged, edited or mocked.
- **Cuts remove waiting, never results.** Waits on a real model call are cut. The receipts, latencies and text that appear are untouched.
- **No Gemini Nano on that computer.** So every AI answer in the video came from the cloud model, and the video says so (1:48). The on-device route is covered by the automated tests and by the virtual-machine runs described in the README. The video does not show an on-device receipt, because none was produced.
- **Generated board, not a photo.** The whiteboard is a generated image, and the captions say so. The private note uses a board image generated for the test.
- **Consent.** The app asks before the first cloud call (0:20). The presenter accepted it on screen.

## Shot list

| Time | On screen | Caption (abridged) |
|---|---|---|
| 0:00 | Title card | Snap the board. Stay in class. Understand it al rato. |
| 0:05 | Home screen | Every class ends the same way: the board fills up, the phones come out, and the photo lands in a camera roll. |
| 0:11 | Library with two sample notes | alRato turns each photo into an organized note. These two are sample notes. |
| 0:15 | Home, "Add the Bellman board" | A generated whiteboard stands in for a real photo. |
| 0:20 | Consent sheet, accepted | The app asks before any cloud model is used. |
| 0:26 | Note page: reading, then organizing (wait cut) | Reading the board runs on the cloud model. |
| 0:35 | Receipt "In the cloud", reason shown | Reading handwriting prefers the cloud. The receipt shows the route the SDK actually took. |
| 0:43 | "Give me a hint" → Nudge, "I need another hint" → Hint | This note is an exercise, so it gets a hint ladder. It teaches instead of answering. |
| 0:57 | "Connected to your note" → "See original note" | It connects the exercise to a note you already have, so the weighted average note appears even though the words differ. |
| 1:08 | Practice: question, See answer, I remembered | Practice turns the note into a question you answer from memory. |
| 1:17 | Review scheduled | The review comes back over the following days. |
| 1:23 | Capture screen, network off: photo saved and waiting | Now the connection drops. A new photo is saved at once and waits. |
| 1:33 | Back online: the note finishes by itself | Back online, the note finishes by itself, with no taps. |
| 1:38 | Capture with "Keep on this device" checked | A handwritten board stands in for a real photo. This one is marked private. |
| 1:41 | Private note: "Private note. It stays here until this device has a local AI model." | Mark a note private and it never leaves this device. |
| 1:48 | Caption only | On a computer with Gemini Nano, the same hints run locally. This recording was made on a computer without it, so every answer here came from the cloud model. |
| 1:55 | Title card and project line | Snap it now. Understand it al rato. Open source (Apache-2.0) · Built with Firebase AI Logic · alrato-e3564.web.app |

## What the video does not show

- An on-device receipt ("On this device · nothing sent"). That needs a computer with Gemini Nano.
- A phone, the camera, or a real photo.
- Sync between devices.

## Rules we kept

1. Every receipt on screen comes from the run.
2. No on-device receipt appears unless Gemini Nano produced it. None does here.
3. No third-party logos. Firebase appears as text only.
4. No personal data: a fresh browser profile, no account, no name or email on screen.
