# alRato demo video script

**Length: 2:45.** The contest limit is 3:00. Narration is in English, and [`subtitles-en.srt`](subtitles-en.srt) matches it line by line.

| Part | Time | What a judge should take away |
|---|---|---|
| The human problem | 0:00–0:29 | Students photograph the board and move on |
| Cloud route | 0:29–0:49 | Real `inferenceSource` on a receipt |
| Hint ladder | 0:49–1:06 | It teaches instead of answering |
| The connection | 1:06–1:27 | The non-obvious idea |
| On-device route | 1:27–1:41 | Same app, real `inferenceSource`, nothing sent |
| Airplane mode | 1:41–1:58 | It keeps working, or waits and resumes |
| Privacy | 1:58–2:18 | The SDK behavior we guard against |
| Practice | 2:18–2:32 | The photo becomes learning |
| Close | 2:32–2:45 | Name and promise |

## Rules for filming

1. **Every receipt on screen must be real.** Do not stage, edit or mock a receipt, a latency or a byte count. The narration avoids quoting numbers so that whatever the app shows is the truth.
2. **Do not show an on-device receipt unless Gemini Nano really produced it.** If you cannot get the hardware, use the [fallback](#if-you-cannot-get-gemini-nano-hardware).
3. **No third-party logos.** Say "Firebase AI Logic" in words or plain text. Keep the Firebase console, brand logos and browser start pages out of the frame.
4. **No personal data.** Use a clean browser profile, hide notifications, and keep faces, names, emails, your university and your city out of the frame.

## Equipment

### For the on-device shots (7, 8 and 9)

You need one computer that meets Chrome's requirements for Gemini Nano. **The computer used to develop alRato does not meet them, so plan to borrow one**, for example a friend's laptop or a lab machine.

| Item | What you need |
|---|---|
| Computer | Windows 10 or 11, macOS 13+, Linux, or a Chromebook Plus |
| Browser | Chrome 148 or later, desktop version |
| Disk | At least 22 GB free on the volume with the Chrome profile |
| Hardware | A GPU with more than 4 GB of VRAM, **or** 16 GB of RAM with at least 4 CPU cores |
| Network | An unmetered connection for the first model download. Do this the day before |
| Screen recorder | OBS Studio or the recorder built into the operating system |

To confirm the machine works before filming day:

1. In alRato, open **Your AI** and click **Download on-device AI**.
2. Open `chrome://on-device-internals` and check that the model is ready.
3. In the DevTools console, run `await LanguageModel.availability()`. It should return `available`.
4. In the app, the badge should say **On-device AI ready**.

### For everything else

- A phone with a camera and Chrome, for the capture, cloud and queue shots
- A phone stand or tripod
- A real whiteboard or chalkboard with the Bellman exercise written by hand, plus a handwritten weighted-average note
- A quiet room and a USB microphone, or a phone recording voice memos close to your mouth
- A video editor that can import `.srt` files

### The day before

- [ ] Deploy the app and open it on both devices, so the service worker is installed.
- [ ] Download Gemini Nano on the laptop.
- [ ] Run the whole demo once with the real models. Check that the Bellman note connects to the weighted-average note.
- [ ] Turn on Do Not Disturb on both devices.
- [ ] Clear old data in **Your AI > Erase everything on this device**, and load the sample notes again before each take.

## Shot list

### Shot 1 · 0:00–0:09 · The board fills up

**Picture:** A real classroom or whiteboard, filmed over the shoulder. A hand finishes writing. A phone rises and takes the photo. Keep the shutter sound.

**Narration:** Every class ends the same way. The board fills up, the phones come out, and the photo lands in a camera roll.

### Shot 2 · 0:09–0:17 · The camera roll

**Picture:** Screen recording of a phone gallery, scrolling past photos of boards mixed with screenshots. Use only your own images. The scroll slows and stops on a blurry board.

**Narration:** For many of us, that's the last time we see it. It feels like studying, but nothing has happened yet.

### Shot 3 · 0:17–0:29 · Two seconds

**Picture:** Same classroom. The phone opens alRato and goes to **Capture**. Tap the shutter. The note is saved at once and the phone goes down. On-screen text, plain: **al rato = "in a little while"**.

**Narration:** alRato keeps the two-second habit. Snap the board and look back up. "Al rato" is Latin American Spanish for "in a little while", and that's when the work happens.

### Shot 4 · 0:29–0:49 · Cloud route, with a real receipt

**Picture:** Phone screen recording, later, away from class. The note shows **Reading your photo…**, then the transcription with rendered math. Zoom in on the receipt: **In the cloud**, the size sent, **photo included**, the time. Tap it to reveal the reason and the model name.

**Narration:** Later, it reads the photo, math included. Built on Firebase AI Logic, alRato picks an inference mode for each task. Reading handwriting prefers the cloud, so this receipt says In the cloud, with the bytes sent and the time. That label is the real inference source from the SDK.

### Shot 5 · 0:49–1:06 · The hint ladder

**Picture:** On the Bellman exercise, tap **Give me a hint**. The **Nudge** card appears. Pause on it. Tap **I need another hint**, and the **Hint** card appears. Show the button that leads to the next rung, without opening the full solution.

**Narration:** It won't just hand over the answer. In one large field study, unguarded AI raised practice scores and then lowered exam scores. So alRato gives you a ladder: a nudge, a hint, a first step, and only then the full solution.

### Shot 6 · 1:06–1:27 · The connection

**Picture:** The moment to get right. Slow zoom into the card **Connected to your note**, showing the thumbnail of the old *Weighted average* note. Tap **See original note**. Show both formulas side by side. In post, circle $P(s'|s)$ on the board and $w_i$ on the old note, and draw a line between them.

**Narration:** Here's the moment we built this for. This exercise looks new, but you already have a note on weighted averages, and alRato finds it, by matching what this note needs against what your older notes teach, right on your device. The probabilities are the weights.

### Shot 7 · 1:27–1:41 · On-device route, with a real receipt

**Picture:** Laptop with Gemini Nano, with the badge **On-device AI ready** visible. Open the same exercise and ask for a hint. Zoom in on the receipt: **On this device · nothing sent**, with the time. Next to it, DevTools > Network filtered to `generateContent`, empty.

**Narration:** On a laptop with Gemini Nano, the same hint runs locally. The receipt now says On this device, nothing sent. Same code, same schema, a different route for this task.

### Shot 8 · 1:41–1:58 · Airplane mode

**Picture:** Show the toggle for real. Turn off Wi-Fi on the laptop and ask for the next hint. It answers, and the receipt says **On this device**. Tap it: "You are offline, so Gemini Nano handled it right here." Cut to the phone in airplane mode. Take a photo: "Saved. alRato will read it when you are back online." Turn airplane mode off and let the note finish on its own, with no taps.

**Narration:** Now we cut the network. The laptop keeps answering. The phone has no local model, so it saves the note and waits. When the connection comes back, the note finishes by itself.

### Shot 9 · 1:58–2:18 · Privacy, and the SDK behavior

**Picture:** On the phone, turn on **Keep on this device** and take a photo. It waits: "Private note. It stays here until this device has a local AI model." Cut to the laptop, where a private note runs and the receipt says **On this device**. Then a clean code shot of `assertOnDevicePossible` in `src/ai/engine.ts`, followed by the terminal running `npx vitest run tests/engine.test.ts`, with the "privacy gate" tests passing.

**Narration:** Some notes should never leave your device. Mark one private and it runs locally, or it waits. We found that the SDK's device-only mode can reach the cloud in browsers without the Prompt API, so alRato blocks that call before it happens.

### Shot 10 · 2:18–2:32 · Practice

**Picture:** Tap **Practice**. A short question appears. Type an answer, tap **See answer**, then **I remembered**. The app returns home with the review scheduled.

**Narration:** Finally, the note becomes practice. You try to recall it, check yourself, and it comes back days later. Recall and spacing are two of the best-supported study techniques we have.

### Shot 11 · 2:32–2:45 · Close

**Picture:** The alRato wordmark on the app's cream background. Plain text underneath: **Snap it now. Understand it al rato.** Then a smaller line: **Open source (Apache-2.0) · Built with Firebase AI Logic**. No logos. Hold for the last two seconds with no narration.

**Narration:** alRato is open source. Snap it now. Understand it al rato.

## If you cannot get Gemini Nano hardware

Do not fake Shots 7 and 8. Keep the phone shots of the queue and replace the laptop shots with the automated tests running the real SDK against a stubbed Prompt API. Replace the narration of Shot 7 with this line, and update its cues in the subtitle file:

> We could not film Gemini Nano on our own hardware, so here is the same code path running through the real SDK in our tests. On a supported laptop, this receipt says On this device, nothing sent.

Mention it in the Devpost description too, so that the video and the text say the same thing.
