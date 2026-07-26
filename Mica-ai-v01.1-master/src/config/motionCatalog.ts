/**
 * Live2D motion catalog for the Koharu model — DETECTED, not hand-copied.
 *
 * Instead of trusting a comment somewhere that lists "the model has these
 * clips", this module fetches the model's own koharu.model3.json at runtime
 * and builds the real list of every motion group/clip it currently declares.
 * micaReactions.ts then builds each reaction's pool of compatible animations
 * from that detected list (via tags, see below) instead of a single
 * hardcoded index — so:
 *   - if the model file ever changes (clips added/removed/re-grouped), the
 *     app picks that up automatically without a code change, and
 *   - nothing that ships with the model can silently sit unused (see
 *     checkForUnusedMotions below).
 *
 * The one piece of information a .motion3.json file genuinely can't tell us
 * is what a clip *feels* like (Cubism motion clips carry no mood metadata) —
 * TAGS_BY_FILE is the single hand-authored place that knowledge lives.
 * Everything else here (which groups/indices/files actually exist) is
 * detected from the live model file.
 */

export interface MotionClip {
  group: string;
  index: number;
  file: string;
  tags: string[];
}

const MODEL_URL = "/live2d/koharu/koharu.model3.json";

/** What each clip feels like, keyed by filename (stable even if a future
 *  model3.json re-shuffles which group a file lives under). Every reaction's
 *  `motionTags` in micaReactions.ts is matched against these — a clip with no
 *  entry here is flagged by checkForUnusedMotions() instead of quietly never
 *  being played by anything. */
const TAGS_BY_FILE: Record<string, string[]> = {
  "motion/01.motion3.json": ["greeting", "happy"],
  "motion/02.motion3.json": ["tap", "happy"],
  "motion/03.motion3.json": ["happy"],
  "motion/05.motion3.json": ["goodbye"],
  "motion/04.motion3.json": ["thinking"],
  "motion/07.motion3.json": ["surprise"],
  "motion/08.motion3.json": ["confused", "sad"],
  "motion/09.motion3.json": ["neutral"],
  "motion/06.motion3.json": ["idle", "neutral"],
  "motion/idle.motion3.json": ["idle", "neutral"],
  "motion/idle_02.motion3.json": ["idle", "neutral"],
};

function buildFromGroups(groups: Record<string, string[]>): MotionClip[] {
  const clips: MotionClip[] = [];
  for (const [group, files] of Object.entries(groups)) {
    files.forEach((file, index) => {
      clips.push({ group, index, file, tags: TAGS_BY_FILE[file] ?? [] });
    });
  }
  return clips;
}

/** Static mirror of the shipped koharu.model3.json. Used the instant this
 *  module loads — before the real fetch below resolves — and as the
 *  permanent fallback if that fetch ever fails (offline, model swapped for
 *  one that 404s the request, etc.), so a reaction never has to block on a
 *  network round trip and a fetch failure never breaks playback. */
const STATIC_FALLBACK: MotionClip[] = buildFromGroups({
  Tap: [
    "motion/01.motion3.json",
    "motion/02.motion3.json",
    "motion/03.motion3.json",
    "motion/05.motion3.json",
  ],
  FlickLeft: ["motion/04.motion3.json"],
  Idle: ["motion/06.motion3.json", "motion/idle.motion3.json", "motion/idle_02.motion3.json"],
  FlickUp: ["motion/07.motion3.json"],
  FlickDown: ["motion/08.motion3.json"],
  FlickRight: ["motion/09.motion3.json"],
});

let resolvedCatalog: MotionClip[] = STATIC_FALLBACK;
let catalogPromise: Promise<MotionClip[]> | null = null;

/** Kicks off (once) fetching the live model3.json and re-detecting every
 *  motion clip it actually declares. Safe to call repeatedly — later calls
 *  reuse the same in-flight/resolved promise. Never throws: any fetch/parse
 *  problem just keeps the static fallback list above in place, so animation
 *  playback is never gated on this succeeding. */
export function detectMotionCatalog(): Promise<MotionClip[]> {
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    try {
      const res = await fetch(MODEL_URL);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      const motions = json?.FileReferences?.Motions;
      if (!motions || typeof motions !== "object") throw new Error("model3.json has no Motions block");

      const groups: Record<string, string[]> = {};
      for (const [group, entries] of Object.entries<any>(motions)) {
        if (!Array.isArray(entries)) continue;
        groups[group] = entries
          .map((e) => e?.File)
          .filter((f: unknown): f is string => typeof f === "string");
      }

      const detected = buildFromGroups(groups);
      if (detected.length === 0) throw new Error("model3.json declares zero motion clips");

      resolvedCatalog = detected;
      checkForUnusedMotions(detected);
      return detected;
    } catch (err) {
      console.warn(
        "[Mica] could not detect the live motion catalog from koharu.model3.json — falling back to the built-in list so playback still works.",
        err,
      );
      return STATIC_FALLBACK;
    }
  })();
  return catalogPromise;
}

/** Synchronous read of whatever catalog is currently known: the static
 *  mirror until detectMotionCatalog() resolves, the real detected one after.
 *  Reaction pools are built from this, so even the very first reaction
 *  (which can fire before that fetch finishes) still gets a correct pool. */
export function getMotionCatalog(): MotionClip[] {
  return resolvedCatalog;
}

/** Every clip in the catalog whose tags overlap with `tags`, in catalog
 *  order. This is how each reaction's compatible-animation pool is built —
 *  see buildMotionPool in micaReactions.ts. */
export function findClipsByTags(tags: string[]): MotionClip[] {
  if (tags.length === 0) return [];
  const wanted = new Set(tags);
  return getMotionCatalog().filter((clip) => clip.tags.some((t) => wanted.has(t)));
}

/** Dev-time safety net for "detect and use every animation already included
 *  ... do not leave existing motions unused": logs which detected clips carry
 *  no tag in TAGS_BY_FILE, meaning no reaction can ever reach them. Purely
 *  informational — never affects playback — so a new model/motion pack drop
 *  is loud about needing a tag, instead of silently going unused forever. */
function checkForUnusedMotions(clips: MotionClip[]) {
  const untagged = clips.filter((c) => c.tags.length === 0);
  if (untagged.length > 0) {
    console.warn(
      "[Mica] these motion clips exist on the model but have no tags in motionCatalog.ts, so no reaction will ever pick them:",
      untagged.map((c) => `${c.group}[${c.index}] (${c.file})`),
    );
  }
}

// Fire off detection the moment this module is first imported (app startup),
// so by the time any real reaction fires, the pools below are already built
// from the actual live model instead of just the static mirror.
void detectMotionCatalog();
