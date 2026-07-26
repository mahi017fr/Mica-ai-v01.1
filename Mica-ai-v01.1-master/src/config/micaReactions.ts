/**
 * Single source of truth for every "reaction" Mica can perform: which Live2D
 * motion(s) can play, which voice line plays alongside it, and what text
 * shows in the floating speech bubble above her head.
 *
 * LANGUAGE CONTRACT (voice vs. subtitle):
 *   Voice clips (voiceFiles) are spoken in Japanese — see public/voices/README.md
 *   for the recommended Japanese lines to generate for each clip. `bubbleTexts`
 *   is the subtitle track: it must ALWAYS be the plain-English translation of
 *   whatever the audio is saying, never romanized Japanese (no "Konnichiwa",
 *   "Yatta", "Ja ne", etc.) — the person reading the bubble should never need to
 *   know Japanese. This holds even if the voice toggle is muted or a clip fails
 *   to load: the bubble is driven independently of whether audio playback
 *   actually succeeds.
 *
 * MOTION SELECTION (pooled + randomized):
 *   Each reaction below no longer points at one fixed motion clip. It instead
 *   declares:
 *     - `motionCandidates`: the default/primary clip(s) for this reaction —
 *       always available immediately, even before the model's real
 *       motion3.json has been re-fetched (see motionCatalog.ts).
 *     - `motionTags`: semantic tags (see TAGS_BY_FILE in motionCatalog.ts)
 *       used to pull in any *other* clip the live model declares that's
 *       tagged compatible with this reaction — e.g. "happy" also matches the
 *       greeting-wave and tap-giggle clips, since both read as cheerful too.
 *   At playback time (pickMotion, below) these two lists are merged into one
 *   pool and one entry is chosen at random, avoiding whichever clip that same
 *   reaction played last time — so a reaction firing repeatedly across a chat
 *   session (e.g. several "happy" replies in a row) doesn't always show the
 *   exact same animation. Reactions with only one compatible clip (e.g.
 *   "thinking", "surprise" — the model only ships one of each) simply always
 *   play that one clip; there's nothing to rotate.
 *
 * HOW TO ADD A NEW EMOTION / VOICE PACK LATER (no changes needed anywhere else
 * in the code):
 *   1. Drop one or more Japanese voice clips in /public/voices/, named
 *      <your_key>_1.mp3, <your_key>_2.mp3, etc. (one file is fine too — just
 *      list one path; up to 4 variants keeps a repeated reaction from sounding
 *      identical every time).
 *   2. Add one entry below with a new key: list those files in voiceFiles, and
 *      write their English translations in bubbleTexts.
 *   3. Set motionCandidates to the closest existing clip(s) from the table in
 *      motionCatalog.ts (it does not need to be unique to this reaction), and
 *      motionTags to whatever tag(s) best describe the mood — any other
 *      matching clip the model ships gets pulled into the rotation pool
 *      automatically.
 *   4. If it's an emotion the AI itself should be able to pick, add the key to
 *      LLM_EMOTION_KEYS as well and it will automatically be offered to the
 *      model in api/bot/chat.ts's system prompt.
 * Nothing in Live2DCharacter.tsx or AIBuddy.tsx needs to change — both just look
 * keys up in this table, and both fail soft (missing/failed audio → silent
 * bubble on a timer; missing/invalid motion → falls back to Idle) so a
 * half-finished pack never crashes playback.
 *
 * Koharu ships no .exp3.json expression files, so mood is conveyed entirely
 * through {motion + voice + bubble text} rather than facial expression swaps.
 * The model also has no dedicated "crying" clip, so "sad" intentionally reuses
 * the FlickDown (confused-looking) motion — the voice line and bubble text are
 * what actually distinguish "sad" from "confused" to the person watching. This
 * is the general pattern for every reaction: if no exact animation exists for
 * a voice pack entry, reuse the closest suitable one (idle, neutral, giggle,
 * happy, thinking, etc.) rather than leaving it unset.
 */

import { findClipsByTags, type MotionClip } from "./motionCatalog";

/** The language every voiceFiles clip is spoken in. bubbleTexts must always be
 *  the English translation of that audio, regardless of this value. */
export const VOICE_AUDIO_LANGUAGE = "ja" as const;

export interface MotionCandidate {
  group: string;
  index: number;
}

export interface MicaReaction {
  /** Human-readable label, used only in comments/debugging and as the key
   *  under which "last motion/voice played" is remembered for rotation. */
  label: string;
  /** Default/primary clip(s) for this reaction — always in the pool. Every
   *  reaction, including the idle check-in hums, has at least one candidate
   *  (directly or via motionTags below) so idle check-ins play a real
   *  animation instead of standing static — see MICA_REACTIONS.idle_hum1/2. */
  motionCandidates: MotionCandidate[];
  /** Tags (see motionCatalog.ts) used to pull in any other model-declared
   *  clip that's compatible with this reaction, for rotation variety. */
  motionTags: string[];
  /** How long (ms) to let the clip play before explicitly handing control back to Idle. */
  durationMs: number;
  /** One of these is picked at random each time this reaction fires. */
  bubbleTexts: string[];
  /** One of these is picked at random each time this reaction fires (filenames under
   *  /public/voices/) — having several variants keeps repeated reactions (e.g. "happy"
   *  firing many times over a chat session) from sounding identical every time. */
  voiceFiles: string[];
  /** How long (ms) the speech bubble stays up if the audio file is missing/fails to
   *  load (normally the bubble instead follows the real audio's "ended" event). */
  fallbackBubbleMs: number;
}

export const MICA_REACTIONS: Record<string, MicaReaction> = {
  // --- UI-driven reactions (panel open/close, direct taps) ---
  greeting: {
    label: "Greeting",
    motionCandidates: [{ group: "Tap", index: 0 }], // 01.motion3.json
    motionTags: ["greeting"],
    durationMs: 3000,
    bubbleTexts: ["Hello!", "Welcome back!"],
    voiceFiles: ["greeting_1.mp3", "greeting_2.mp3", "greeting_3.mp3", "greeting_4.mp3"],
    fallbackBubbleMs: 2200,
  },
  tap: {
    label: "Petted / direct tap",
    motionCandidates: [{ group: "Tap", index: 1 }], // 02.motion3.json
    motionTags: ["tap"],
    durationMs: 4000,
    bubbleTexts: ["Hehe~", "Tee-hee! That tickles!"],
    voiceFiles: ["tap_giggle_1.mp3", "tap_giggle_2.mp3", "tap_giggle_3.mp3", "tap_giggle_4.mp3"],
    fallbackBubbleMs: 1600,
  },
  goodbye: {
    label: "Goodbye",
    motionCandidates: [{ group: "Tap", index: 3 }], // 05.motion3.json
    motionTags: ["goodbye"],
    durationMs: 4600,
    bubbleTexts: ["Bye bye!", "See you soon!"],
    voiceFiles: ["goodbye_1.mp3", "goodbye_2.mp3", "goodbye_3.mp3", "goodbye_4.mp3"],
    fallbackBubbleMs: 2200,
  },

  // --- Emotions the AI itself can choose after every reply (see LLM_EMOTION_KEYS) ---
  happy: {
    label: "Happy",
    motionCandidates: [{ group: "Tap", index: 2 }], // 03.motion3.json
    // Also matches 01 (greeting-wave) and 02 (tap-giggle) — both read as
    // cheerful too, so "happy" rotates across all three instead of always
    // showing the same clip.
    motionTags: ["happy"],
    durationMs: 3000,
    bubbleTexts: ["Yay~!", "Woohoo!"],
    voiceFiles: ["happy_1.mp3", "happy_2.mp3", "happy_3.mp3", "happy_4.mp3"],
    fallbackBubbleMs: 2000,
  },
  thinking: {
    label: "Thinking",
    motionCandidates: [{ group: "FlickLeft", index: 0 }], // 04.motion3.json
    motionTags: ["thinking"],
    durationMs: 3200,
    bubbleTexts: ["Hmm...", "Let me think..."],
    voiceFiles: ["thinking_1.mp3", "thinking_2.mp3", "thinking_3.mp3", "thinking_4.mp3"],
    fallbackBubbleMs: 1500,
  },
  surprise: {
    label: "Surprise",
    motionCandidates: [{ group: "FlickUp", index: 0 }], // 07.motion3.json
    motionTags: ["surprise"],
    durationMs: 3000,
    bubbleTexts: ["Whoa?!", "No way!"],
    voiceFiles: ["surprise_1.mp3", "surprise_2.mp3", "surprise_3.mp3", "surprise_4.mp3"],
    fallbackBubbleMs: 1200,
  },
  confused: {
    label: "Confused / error",
    motionCandidates: [{ group: "FlickDown", index: 0 }], // 08.motion3.json
    motionTags: ["confused"],
    durationMs: 1900,
    bubbleTexts: ["Uh oh...", "Huh...?"],
    voiceFiles: ["confused_1.mp3", "confused_2.mp3", "confused_3.mp3", "confused_4.mp3"],
    fallbackBubbleMs: 1500,
  },
  sad: {
    label: "Sad",
    motionCandidates: [{ group: "FlickDown", index: 0 }], // 08.motion3.json — no dedicated cry clip, reused deliberately
    motionTags: ["sad"],
    durationMs: 1900,
    bubbleTexts: ["...Sniff", "Aww..."],
    voiceFiles: ["sad_1.mp3", "sad_2.mp3", "sad_3.mp3", "sad_4.wav"],
    fallbackBubbleMs: 2200,
  },
  neutral: {
    label: "Neutral reply",
    motionCandidates: [{ group: "FlickRight", index: 0 }], // 09.motion3.json — closest available "talking" gesture
    // Also matches the Idle group's own clips (06, idle, idle_02) — a subtle
    // idle-like glance reads fine for an unremarkable reply, and it puts
    // those clips to explicit use as one-shot gestures too, not just as the
    // library's automatic background loop. Gives "neutral" 4 clips to rotate
    // across instead of always showing the same one.
    motionTags: ["neutral"],
    durationMs: 2000,
    bubbleTexts: ["Mm-hm.", "Got it!"],
    voiceFiles: ["neutral_1.mp3", "neutral_2.mp3", "neutral_3.mp3", "neutral_4.mp3"],
    fallbackBubbleMs: 1500,
  },

  // --- Idle "aliveness" check-ins — behave exactly like any other AI reaction: a real
  // animation plays alongside the voice + subtitle, not just a sound with her standing
  // static. `motionTags: ["idle"]` pulls in all three of the model's own Idle-group clips
  // (06, idle, idle_02) as a rotation pool — a soft, idle-appropriate gesture rather than
  // anything dramatic, which fits a background "just checking in" moment. Playing them
  // through the normal playReaction()/triggerMotionClip() pipeline (same as every other
  // reaction here) means: eye/head/body pointer-tracking (autoInteract) is never touched
  // and keeps running through the clip exactly as it does during any other reaction; the
  // clip auto-hands control back to Idle once durationMs elapses, which for these two IS
  // just another Idle-group motion — so the "return to normal idle" is an inherently
  // smooth Idle→Idle blend, not a hard cut. No motionCandidates default is needed since
  // the idle tag alone already resolves to a real pool.
  idle_hum1: {
    label: "Idle hum",
    motionCandidates: [],
    motionTags: ["idle"],
    durationMs: 1800,
    bubbleTexts: ["Mmm~"],
    voiceFiles: ["idle_hum1_1.mp3", "idle_hum1_2.mp3", "idle_hum1_3.mp3", "idle_hum1_4.mp3"],
    fallbackBubbleMs: 1500,
  },
  idle_hum2: {
    label: "Idle breath",
    motionCandidates: [],
    motionTags: ["idle"],
    durationMs: 1800,
    bubbleTexts: ["...", "Hmm~"],
    voiceFiles: ["idle_hum2_1.mp3", "idle_hum2_2.mp3", "idle_hum2_3.mp3", "idle_hum2_4.mp3"],
    fallbackBubbleMs: 1500,
  },
};

/** Reaction keys the LLM is allowed to pick after a reply (see api/bot/chat.ts).
 *  Kept separate from MICA_REACTIONS' full key list because "greeting"/"goodbye"/"tap"
 *  are UI-driven (panel open/close, direct pets) and should never be picked by the model. */
export const LLM_EMOTION_KEYS = ["happy", "thinking", "surprise", "confused", "sad", "neutral"] as const;
export type LlmEmotionKey = (typeof LLM_EMOTION_KEYS)[number];

/** Idle hum keys, picked from randomly by the idle-aliveness timer. */
export const IDLE_HUM_KEYS = ["idle_hum1", "idle_hum2"];

/** Synonyms/near-misses for reaction keys that aren't an exact MICA_REACTIONS
 *  entry — e.g. if the LLM (or a typo, or a future voice pack) sends "joy" or
 *  "shocked" instead of "happy"/"surprise". getReaction() checks this before
 *  giving up and falling back to "neutral", so a close-but-not-exact key still
 *  gets the closest matching animation instead of a generic one. */
const REACTION_ALIASES: Record<string, string> = {
  joy: "happy", joyful: "happy", excited: "happy", cheerful: "happy", glad: "happy",
  giggle: "tap", giggling: "tap", ticklish: "tap", petted: "tap",
  pondering: "thinking", curious: "thinking", considering: "thinking", wondering: "thinking",
  shocked: "surprise", startled: "surprise", amazed: "surprise", astonished: "surprise",
  puzzled: "confused", unsure: "confused", uncertain: "confused", error: "confused",
  upset: "sad", disappointed: "sad", down: "sad", sorry: "sad", apologetic: "sad",
  hello: "greeting", hi: "greeting", welcome: "greeting",
  bye: "goodbye", farewell: "goodbye", leaving: "goodbye",
  idle: "neutral", calm: "neutral", ok: "neutral", okay: "neutral", talking: "neutral",
};

/** Safe lookup with a guaranteed fallback so a typo'd/unknown key from the LLM (or
 *  anywhere else) never crashes playback. Tries, in order: an exact key match, a
 *  known alias/synonym (closest matching animation), then finally the generic
 *  "neutral" reaction — so playback always resolves to *something* reasonable. */
export function getReaction(key: string | undefined | null): MicaReaction {
  if (key) {
    const normalized = key.trim().toLowerCase();
    if (MICA_REACTIONS[normalized]) return MICA_REACTIONS[normalized];
    const alias = REACTION_ALIASES[normalized];
    if (alias && MICA_REACTIONS[alias]) return MICA_REACTIONS[alias];
  }
  return MICA_REACTIONS.neutral;
}

/** Picks one voice-file variant at random from a reaction's list. When there's more than
 *  one option and a `lastFile` is passed, avoids repeating that exact same clip twice in a
 *  row, so back-to-back "happy" reactions (for example) don't sound identical. */
export function pickVoiceFile(reaction: MicaReaction, lastFile?: string | null): string | null {
  const files = reaction.voiceFiles;
  if (files.length === 0) return null; // incomplete pack entry — caller falls back to bubble-only
  if (files.length <= 1) return files[0];
  const choices = lastFile ? files.filter((f) => f !== lastFile) : files;
  const pool = choices.length > 0 ? choices : files;
  return pool[Math.floor(Math.random() * pool.length)];
}

function motionKey(c: MotionCandidate): string {
  return `${c.group}#${c.index}`;
}

/** Merges a reaction's default candidates with whatever the live motion
 *  catalog additionally matches by tag, de-duplicated (defaults first). This
 *  is the reaction's full "compatible animations" pool. */
function buildMotionPool(reaction: MicaReaction): MotionCandidate[] {
  const fromTags: MotionCandidate[] = findClipsByTags(reaction.motionTags).map(
    (c: MotionClip) => ({ group: c.group, index: c.index }),
  );
  const merged = [...reaction.motionCandidates, ...fromTags];
  const seen = new Set<string>();
  const pool: MotionCandidate[] = [];
  for (const candidate of merged) {
    const key = motionKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push(candidate);
  }
  return pool;
}

/** Picks one compatible motion clip at random from a reaction's full pool
 *  (defaults + tag-matched catalog clips). When there's more than one option
 *  and a `lastKey` is passed (this reaction's own previous pick, from
 *  `key` in the returned result), avoids repeating that exact same clip
 *  twice in a row — the same anti-repetition pattern as pickVoiceFile, so a
 *  reaction firing many times across a chat session shows real variety
 *  instead of the same animation on loop. Returns `candidate: null` only if a
 *  reaction's pool ends up genuinely empty (no default candidates and no tag
 *  match found in the catalog) — the caller (playReaction) treats that as
 *  "skip the motion, still play voice/bubble" rather than erroring, so a
 *  future motionless-by-design reaction is still safe to add. */
export function pickMotion(
  reaction: MicaReaction,
  lastKey?: string | null,
): { candidate: MotionCandidate | null; key: string | null } {
  const pool = buildMotionPool(reaction);
  if (pool.length === 0) return { candidate: null, key: null };
  const keyed = pool.map((c) => ({ candidate: c, key: motionKey(c) }));
  const choices = lastKey ? keyed.filter((k) => k.key !== lastKey) : keyed;
  const finalPool = choices.length > 0 ? choices : keyed;
  return finalPool[Math.floor(Math.random() * finalPool.length)];
}
