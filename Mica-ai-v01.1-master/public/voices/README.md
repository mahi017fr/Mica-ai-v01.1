# Mica's voice clips

Every file in this folder is currently a **silent placeholder** (a few seconds of
silence, generated with ffmpeg) so the app runs end-to-end with no 404s or crashes
even before you've added real audio. Replace them with real recordings and
everything — motion, speech bubble timing, mute toggle — keeps working unchanged,
since the bubble is timed off each clip's real `ended` event.

## Language contract: Japanese audio, English subtitle

The voice clips themselves are meant to be spoken **in Japanese** (see the VOICEVOX
workflow below). The floating speech bubble that appears above Mica's head is a
**subtitle track, always in English** — it's driven by `bubbleTexts` in
`src/config/micaReactions.ts`, completely independent of the audio file, so the
person watching never needs to know Japanese to follow along. When you write a new
Japanese line for a clip, add its English translation to that reaction's
`bubbleTexts` at the same time — never a romanized version of the Japanese (e.g.
write "Hello!", not "Konnichiwa!").

## Multiple variants per reaction

Each reaction has **4 file slots** (`_1` to `_4`) so repeated reactions (e.g. "happy"
firing many times across a chat) don't sound identical every time — the app picks
one at random each time, and avoids repeating the exact same clip twice in a row.
You can use fewer than 4 by just editing `voiceFiles` in
`src/config/micaReactions.ts` — but if you already generated 3-4 lines per emotion,
just name them `_1.mp3` through `_4.mp3` (or however many you have) and they'll be
picked up automatically, no code change needed.

## Which files are which

| Base name | Reaction | Animation played | Suggested Japanese line (audio) | English subtitle (bubble) |
|---|---|---|---|---|
| `greeting_1..4` | Chat panel opens | Tap motion #1 | こんにちは！ / おかえり！ | "Hello!" / "Welcome back!" |
| `tap_giggle_1..4` | Direct tap/pet | Tap motion #2 | えへへ〜 / くすぐったい！ | "Hehe~" / "Tee-hee! That tickles!" |
| `happy_1..4` | AI reply classified as happy | Tap motion #3 | やったー！ / わーい！ | "Yay~!" / "Woohoo!" |
| `goodbye_1..4` | Chat panel closes | Tap motion #4 | またね！ / じゃあね！ | "Bye bye!" / "See you soon!" |
| `thinking_1..4` | AI is composing a reply | FlickLeft motion | うーん… / ちょっと待って… | "Hmm..." / "Let me think..." |
| `surprise_1..4` | AI reply classified as surprised | FlickUp motion | えっ！？ / まさか！ | "Whoa?!" / "No way!" |
| `confused_1..4` | An error occurred | FlickDown motion | あれ…？ / え、なんで？ | "Uh oh..." / "Huh...?" |
| `sad_1..4` | AI reply classified as sad | FlickDown motion (reused — no dedicated cry clip) | しくしく… / かなしいな… | "...Sniff" / "Aww..." |
| `neutral_1..4` | Plain/matter-of-fact reply | FlickRight motion | うん。 / わかった！ | "Mm-hm." / "Got it!" |
| `idle_hum1_1..4` | Occasional idle hum (~60-120s apart) | none (stays on Idle) | ん〜 | "Mmm~" |
| `idle_hum2_1..4` | Occasional idle hum (~60-120s apart) | none (stays on Idle) | ふぅ… | "..." / "Hmm~" |

Every voice file is always tied to one of these reaction keys, and every reaction key
always has an animation — either its own motion clip, or (for `sad`, which has no
dedicated crying animation) the closest suitable one reused from another reaction.
There is never a voice clip without a matching animation to play alongside it.

Keep each clip short (1-3 seconds) — these are reaction stingers, not full sentences.
File names must match exactly (lowercase, `_1.mp3` through `_4.mp3`, `.wav` also
works) — the app loads them from `/voices/<name>` (see `voiceFiles` in
`src/config/micaReactions.ts`). If a specific file 404s, the app automatically tries
the sibling extension (`.mp3` ↔ `.wav`) once before giving up and just timing the
subtitle out on its own — see `playFile`/`giveUp` in `Live2DCharacter.tsx`.

If you renamed your downloaded files differently, either rename them to match this
list, or just edit the `voiceFiles: [...]` array for that reaction in
`src/config/micaReactions.ts` to match whatever filenames you actually used.

## Getting real, natural (non-robotic) voice lines for free

**Recommended: [VOICEVOX](https://voicevox.hiroshiba.jp/)**
- Free, including commercial use (each voice character has its own short credit
  requirement — check the "利用規約" / terms tab for the character you pick).
- Natural, expressive anime-style female voices (e.g. Zundamon, Shikoku Metan,
  Kasukabe Tsumugi) — not flat/robotic like a generic browser TTS.
- Type each short line (e.g. "こんにちは！", "うーん…", "えっ！？", "またね！"),
  generate, and export as WAV, then convert to mp3:
  ```
  ffmpeg -i input.wav -codec:a libmp3lame -q:a 4 greeting.mp3
  ```
- Because these are pre-generated, fixed clips (not live TTS), there's no runtime
  API cost or latency — they're just static assets like any other audio file.

**Alternative:** a licensed free "anime voice pack" (e.g. from itch.io) — double
check the specific license terms allow the way you intend to use it (personal app
vs. distributed/commercial product) before shipping it.

## If a file is missing or fails to load

The app fails soft at every step:
- A single missing/broken file first tries its sibling extension (`.mp3` ↔ `.wav`),
  then gives up and just shows the English subtitle for a fallback duration —
  nothing crashes, it just plays silently.
- A reaction key with no `voiceFiles` entries at all still shows its subtitle, again
  with no audio.
- A motion clip that doesn't exist on the currently-loaded model falls back to the
  Idle animation instead of throwing or leaving her stuck in a pose.

So it's safe to replace these files (or add a whole new voice pack) one reaction at
a time instead of all at once.
