import React, { useEffect, useRef, useState } from "react";
import { MicaAvatar } from "./MicaCharacter";

/**
 * Shared "face snapshot" cache — a single PNG captured off of the first `focus="face"`
 * Live2D instance that finishes rendering (in practice: the header avatar). Small avatar
 * spots that repeat a lot (one per chat message) reuse this cached image via
 * <MicaFaceSnapshot /> below instead of each spinning up their own full PIXI Application —
 * every Live2D instance owns a real WebGL context, and browsers cap how many of those can
 * exist at once (commonly ~16), so one-per-message would eventually start silently
 * breaking older ones exactly like the header avatar did before this fix.
 */
let cachedFaceSnapshot: string | null = null;
const snapshotListeners = new Set<(url: string) => void>();

function publishFaceSnapshot(url: string) {
  cachedFaceSnapshot = url;
  snapshotListeners.forEach((fn) => fn(url));
}

/**
 * Live2D-powered character, replacing the old hand-drawn SVG chibi (MicaCharacter.tsx).
 *
 * Uses pixi-live2d-display (https://github.com/guansss/pixi-live2d-display) on top of
 * pixi.js to render a real Cubism 4 Live2D model — the same tech behind most VTuber /
 * AI-companion "buddy" characters. Breathing, blinking, and idle sway all come free from
 * the model's built-in "Idle" motion group + physics rig, so it reads as genuinely alive
 * instead of a manually keyframed drawing.
 *
 * Model: "Koharu" (Cubism 4), self-hosted under public/live2d/koharu/ (see that folder's
 * koharu.live.json for the original nizima LIVE license terms). Swap MODEL_URL below to
 * point at a different self-hosted model/character if needed.
 *
 * Requires (see index.html): the Cubism Core runtime script tag loaded globally before
 * this component mounts.
 */

const MODEL_URL = "/live2d/koharu/koharu.model3.json";

// Koharu ships no .exp3.json expression files at all (unlike the old "Haru" sample this
// component originally targeted), so mood can only be conveyed through body/head motion,
// voice, and the speech bubble — not facial expression swaps.
//
// Every reaction (a *pool* of compatible motion clips + voice lines + bubble text) is
// defined once, centrally, in src/config/micaReactions.ts — this file just plays whatever
// reaction key it's told to, randomly rotating across that reaction's compatible clips
// each time (see pickMotion there). Which clips actually exist on the model is detected
// at runtime from koharu.model3.json itself (src/config/motionCatalog.ts), not hardcoded
// here, so a model/motion-pack swap is picked up automatically.
import { getReaction, pickVoiceFile, pickMotion, type MicaReaction } from "../config/micaReactions";

let librariesPromise: Promise<{ PIXI: any; Live2DModel: any }> | null = null;

// Whether her voice clips are muted, per the "Mica Voice" toggle on the Settings page.
// Read fresh at the moment each clip starts (clips are only 1-3s, so no need to update
// an already-playing clip's volume live).
function readMicaVoiceEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem("mica_voice_enabled") !== "false";
}

/** Loads pixi.js + pixi-live2d-display exactly once and wires the global PIXI reference
 *  the way pixi-live2d-display expects (it auto-registers its Ticker/interaction plugins
 *  off of a global `window.PIXI`), regardless of how many <Live2DCharacter /> instances
 *  end up mounted across the app. */
function loadLibraries() {
  if (!librariesPromise) {
    librariesPromise = (async () => {
      const PIXI = await import("pixi.js");
      (window as any).PIXI = PIXI;
      // @ts-ignore — pixi-live2d-display/cubism4 has no bundled TS types for this subpath
      const live2d = await import("pixi-live2d-display/cubism4");
      return { PIXI, Live2DModel: live2d.Live2DModel };
    })();
  }
  return librariesPromise;
}

// The Cubism Core runtime is a single global engine (window.Live2DCubismCore) that gets
// started up the first time any model is parsed. When two <Live2DCharacter /> instances
// mount at the same moment (e.g. the header avatar + the big panel character both appear
// the instant the chat panel opens), calling Live2DModel.from() on both at once races
// against that shared global init and one of them can silently fail to render (shows up
// as a blank/black canvas). Funneling every load through this one queue forces them to
// happen one after another instead, which avoids the race entirely.
let modelLoadQueue: Promise<any> = Promise.resolve();
function queueModelLoad(
  Live2DModel: any,
  url: string,
  options?: Record<string, unknown>,
): Promise<any> {
  const runLoad = () => Live2DModel.from(url, options);
  const result = modelLoadQueue.then(runLoad, runLoad);
  // Keep the queue alive even if this particular load fails, so later loads aren't stuck
  // waiting on a rejected promise forever.
  modelLoadQueue = result.catch(() => {});
  return result;
}

/** Fires a specific AI-chosen emotion (from the LLM's reply) — motion, voice clip, and
 *  speech-bubble text are all looked up from that single key in micaReactions.ts. `nonce`
 *  should change (e.g. Date.now()) every time, even if `key` repeats back-to-back, so the
 *  reaction re-triggers instead of being ignored as an unchanged prop. */
export interface MicaEmotionTrigger {
  key: string;
  nonce: number;
}

interface Live2DCharacterProps {
  width?: number;
  height?: number;
  /** Direct tap/click on her — plays the "tap" reaction (motion + giggle voice + bubble). */
  bounce?: boolean;
  /** Greeting wave when the chat panel opens — "greeting" reaction. */
  greet?: boolean;
  /** AI is composing a reply — "thinking" reaction, then hands back to Idle. */
  thinking?: boolean;
  /** AI's reply just arrived and is being shown — "neutral" reaction (closest available
   *  "talking" gesture; the model has no real talk/lip-sync motion). Prefer the generic
   *  `emotion` prop below when the AI has classified a more specific mood. */
  talking?: boolean;
  /** Reply finished successfully / explicitly happy — "happy" reaction. */
  celebrate?: boolean;
  /** Chat panel is closing — "goodbye" reaction. */
  goodbye?: boolean;
  /** Important/notable event — "surprise" reaction. */
  surprise?: boolean;
  /** An error occurred — "confused" reaction. */
  confused?: boolean;
  /** The AI (or user) is visibly sad/disappointed — "sad" reaction. Model has no dedicated
   *  cry motion, so this reuses the confused-looking clip with a different voice/bubble. */
  sad?: boolean;
  /** Generic, extensible reaction trigger — pass whatever emotion key the LLM returned
   *  (see LLM_EMOTION_KEYS in micaReactions.ts) and it plays automatically, including any
   *  new emotions added to that config later with zero code changes here. */
  emotion?: MicaEmotionTrigger | null;
  /** "full" frames the whole standing character (default). "face" zooms in tight on the
   *  head/shoulders — used for small round avatar spots (header icon, chat bubbles) where
   *  a distant full-body shot would just look like an unrecognizable smudge. */
  focus?: "full" | "face";
  /** When true, throws in small random idle variety every several seconds while nothing
   *  else is happening (including occasional soft humming sounds), so she reads as
   *  breathing and reacting on her own instead of sitting frozen between interactions. */
  lively?: boolean;
  className?: string;
  onTap?: () => void;
}

export const Live2DCharacter: React.FC<Live2DCharacterProps> = ({
  width = 140,
  height = 220,
  bounce = false,
  greet = false,
  thinking = false,
  talking = false,
  celebrate = false,
  goodbye = false,
  surprise = false,
  confused = false,
  sad = false,
  emotion = null,
  focus = "full",
  lively = false,
  className = "",
  onTap,
}) => {
  // A wrapper div, not a <canvas>, is what we hold a ref to. PIXI creates its own fresh
  // <canvas> internally on every effect run and we mount that into the wrapper. This
  // matters because React 19 runs effects twice in development (mount → cleanup →
  // mount); if two PIXI.Application instances are ever pointed at the *same* physical
  // canvas element, the browser only ever gives out one WebGL context for that canvas,
  // so the second Application's renderer ends up fighting the first one for GL resources
  // (textures/buffers get created under one context and used under the other) — which is
  // exactly the "object does not belong to this context" flood. A brand-new canvas per
  // mount sidesteps the problem entirely, in dev and in production alike.
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<any>(null);
  const modelRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // Mouse-over blush: a soft pink glow on her cheeks while the cursor is over her face.
  const [hovering, setHovering] = useState(false);
  // Tap-on-head "shy" reaction: a stronger blush + a brief bashful head-dip, then she
  // settles back. Purely a CSS reaction layered on top of the Live2D canvas — the model's
  // own physics/idle rig would fight and win against directly poking its internal
  // parameters every frame, so this fakes the same feeling with a transform instead.
  const [shy, setShy] = useState(false);
  const shyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending "hand control back to Idle" timer from the last triggerMotionClip() call —
  // see that function below for why this is needed (Idle won't resume on its own).
  const motionReturnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Incremented on every triggerMotionClip() call so an older call's motion() promise
  // (which resolves asynchronously) can tell it's been superseded by a newer reaction and
  // no-op instead of yanking her back to Idle after the newer motion already started.
  const motionCallIdRef = useRef(0);
  // Where the cheek blush overlay should actually sit, computed from the model's real
  // on-canvas position/size once it loads (see the mount effect below) — replaces guessed
  // container-relative percentages that only looked right for one particular focus mode.
  const [cheekLayout, setCheekLayout] = useState<{
    topPct: number;
    leftPct: number;
    rightPct: number;
    sizePx: number;
  } | null>(null);
  // Where the speech bubble should anchor (just above the head) — computed alongside
  // cheekLayout from the model's real on-canvas geometry, so it lines up correctly in
  // both "full" and "face" focus modes.
  const [bubbleAnchor, setBubbleAnchor] = useState<{ topPct: number; centerXPct: number } | null>(
    null,
  );
  // Current speech bubble text + visibility. Shown the instant a reaction's voice starts,
  // hidden the instant it ends — see playReaction() below.
  const [bubbleText, setBubbleText] = useState<string | null>(null);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  // The one <audio> element currently playing a reaction's voice line, so a new reaction
  // firing mid-clip can stop the previous one instead of overlapping voices.
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const bubbleHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the last-played emotion nonce so the generic `emotion` prop only fires once
  // per change, even though its `key` can legitimately repeat back-to-back.
  const lastEmotionNonceRef = useRef<number | null>(null);
  // Remembers the last voice-file variant played per reaction label, so pickVoiceFile can
  // avoid repeating the exact same clip twice in a row for the same reaction.
  const lastVoiceFileRef = useRef<Record<string, string>>({});
  // Remembers the last motion clip played per reaction label (as a "group#index" key), so
  // pickMotion can avoid repeating the exact same animation twice in a row for the same
  // reaction — this is what makes repeated reactions (several "happy"s in a row, etc.)
  // rotate through their compatible clips instead of looking identical every time.
  const lastMotionKeyRef = useRef<Record<string, string>>({});

  // Plays one specific motion clip once, then explicitly hands control back to the Idle
  // group after that clip's real duration. This explicit hand-back matters: these clips
  // don't return to Idle on their own once started, so without it she'd get stuck holding
  // the last pose (or looping it) instead of settling back into breathing/idle sway.
  const triggerMotionClip = (group: string, index: number, durationMs: number) => {
    const model = modelRef.current;
    if (!model) return;
    if (motionReturnTimeoutRef.current) clearTimeout(motionReturnTimeoutRef.current);
    // Every reaction's candidate clips are matched against the model's real motion3.json
    // clips (see motionCatalog.ts/micaReactions.ts), but this stays defensive for the case
    // a future voice pack entry points at a clip that doesn't exist on whatever model is
    // currently loaded (e.g. a model swap that dropped a motion group) — the animation
    // should degrade to Idle rather than leave her stuck mid-pose or not moving at all.
    // model.motion() resolves a Promise<boolean> (true if the clip started, false if that
    // group/index wasn't found) rather than throwing, so both paths are handled below.
    const callId = ++motionCallIdRef.current;
    Promise.resolve(model.motion(group, index))
      .then((started: boolean) => {
        if (motionCallIdRef.current !== callId) return; // superseded by a newer reaction
        if (started === false) {
          console.warn(`[Mica] animation "${group}"[${index}] not found on model, falling back to Idle.`);
          modelRef.current?.motion("Idle");
          return;
        }
        motionReturnTimeoutRef.current = setTimeout(() => {
          modelRef.current?.motion("Idle");
        }, durationMs);
      })
      .catch((err: unknown) => {
        if (motionCallIdRef.current !== callId) return;
        console.warn(`[Mica] animation "${group}"[${index}] failed to play, falling back to Idle.`, err);
        modelRef.current?.motion("Idle");
      });
  };

  // The one function everything (taps, greet/goodbye, thinking/talking, and the AI's own
  // chosen emotion) routes through: plays the motion, plays the matching voice clip, and
  // shows/hides the speech bubble in sync with that voice — so every reaction always gets
  // all three at once, and adding a brand-new emotion later needs no changes here at all,
  // only a new entry in micaReactions.ts.
  const playReaction = (reaction: MicaReaction) => {
    // Randomly rotates across every compatible clip this reaction has (its default
    // candidate(s) plus anything else the live model catalog tags as a match — see
    // pickMotion/buildMotionPool in micaReactions.ts), avoiding whichever clip this same
    // reaction played last time so back-to-back firings (several "happy"s in a row, etc.)
    // don't always show the identical animation. Reactions with only one compatible clip
    // (the model just doesn't ship more) simply keep playing that one, same as before.
    const { candidate, key } = pickMotion(reaction, lastMotionKeyRef.current[reaction.label]);
    if (candidate) {
      lastMotionKeyRef.current[reaction.label] = key!;
      triggerMotionClip(candidate.group, candidate.index, reaction.durationMs);
    }

    // Pick one of the reaction's bubble lines (the English translation/subtitle — the
    // voice clip itself is Japanese) at random for a little natural variety. This is
    // set/shown independently of whether the audio below actually plays, so the subtitle
    // is always visible even with voice muted or a clip missing.
    const text =
      reaction.bubbleTexts[Math.floor(Math.random() * reaction.bubbleTexts.length)] ??
      reaction.bubbleTexts[0];

    if (bubbleHideTimeoutRef.current) clearTimeout(bubbleHideTimeoutRef.current);
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }

    setBubbleText(text);
    setBubbleVisible(true);

    const hideBubble = () => setBubbleVisible(false);
    const giveUp = () => {
      // Clip missing/failed to load (e.g. a placeholder hasn't been replaced yet, or a
      // pack entry has no files at all) — fail soft and just time the bubble out on its
      // own instead of leaving it stuck up forever.
      bubbleHideTimeoutRef.current = setTimeout(hideBubble, reaction.fallbackBubbleMs);
    };

    // Swaps a clip's extension (mp3 <-> wav) as a last-resort retry, in case a pack mixes
    // formats or a filename was entered with the wrong one — keeps a single typo'd
    // extension from silently dropping an otherwise-present voice line.
    const siblingExtensionFile = (file: string): string | null => {
      if (file.endsWith(".mp3")) return file.slice(0, -4) + ".wav";
      if (file.endsWith(".wav")) return file.slice(0, -4) + ".mp3";
      return null;
    };

    const playFile = (file: string, isRetry: boolean) => {
      try {
        const audio = new Audio(`/voices/${file}`);
        audio.volume = readMicaVoiceEnabled() ? 1 : 0;
        activeAudioRef.current = audio;
        audio.addEventListener("ended", hideBubble);
        audio.addEventListener("error", () => {
          const sibling = !isRetry ? siblingExtensionFile(file) : null;
          if (sibling) playFile(sibling, true);
          else giveUp();
        });
        audio.play().catch(() => {
          // Autoplay can be blocked before the user has interacted with the page at all —
          // still show the bubble for a bit so the reaction reads visually even with no sound.
          giveUp();
        });
      } catch {
        giveUp();
      }
    };

    const chosenFile = pickVoiceFile(reaction, lastVoiceFileRef.current[reaction.label]);
    if (!chosenFile) {
      // Reaction has no voice clips configured at all (e.g. a brand-new pack entry
      // mid-setup) — still show the bubble, just with no audio to sync to.
      giveUp();
      return;
    }
    lastVoiceFileRef.current[reaction.label] = chosenFile;
    playFile(chosenFile, false);
  };

  // Mount: spin up a PIXI application scoped to this canvas and load the Live2D model into it.
  useEffect(() => {
    let cancelled = false;
    let app: any = null;

    (async () => {
      try {
        const { PIXI, Live2DModel } = await loadLibraries();
        if (cancelled || !containerRef.current) return;

        app = new PIXI.Application({
          width,
          height,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
        });
        if (cancelled) {
          app.destroy(true, { children: true });
          return;
        }
        appRef.current = app;
        containerRef.current.appendChild(app.view as HTMLCanvasElement);

        // autoInteract turns on pointer tracking (her gaze/head subtly follows the cursor)
        // and tap hit-testing, on top of the breathing/blink physics she already gets for
        // free from the model rig — this is what actually sells "she's watching you" rather
        // than just idling in place.
        const model = await queueModelLoad(Live2DModel, MODEL_URL, {
          autoInteract: true,
        });
        if (cancelled) {
          model.destroy();
          return;
        }

        modelRef.current = model;
        app.stage.addChild(model);

        // Capture native size *before* touching scale, since width/height getters reflect the
        // current scale — reading them again after scaling would double-apply it.
        const nativeWidth = model.width;
        const nativeHeight = model.height;

        // Exact "touches every edge" fit — the reference every other scale is built from.
        const exactFitScale = Math.min(width / nativeWidth, height / nativeHeight);

        // Baseline "fit the whole body in frame" scale, deliberately smaller than an exact
        // fit (this is what the face-crop zoom below is built from — a tighter fit here
        // would make FACE_ZOOM overshoot the head).
        const fullBodyScale = exactFitScale * 0.55;

        // How far down from the top of the model canvas the head sits, as a fraction of
        // total model height — used both to frame the face-crop and to place the cheek
        // blush over the actual rendered head instead of a guessed container position.
        // Cubism artboards usually have blank padding above the character for hair/physics
        // motion range, so this is a starting estimate — nudge it up (smaller) if the face
        // crop/blush sits too high, or down (larger) if it sits too low.
        const HEAD_CENTER_Y = 0.14;
        // How wide the head is relative to the whole model width — used to size/space the
        // cheek blush relative to the actual head instead of the full body/container.
        const HEAD_WIDTH_FRACTION = 0.34;

        let scale: number;
        if (focus === "face") {
          // Zoom tight on the head/shoulders instead of showing the whole standing body —
          // for small round avatar spots, a distant full-body shot just reads as a blur.
          // FACE_ZOOM controls how much tighter than the full-body fit this is.
          const FACE_ZOOM = 5;
          scale = fullBodyScale * FACE_ZOOM;
          model.scale.set(scale);
          model.x = (width - nativeWidth * scale) / 2;
          model.y = height / 2 - HEAD_CENTER_Y * nativeHeight * scale;
        } else {
          // Full-body framing: fill almost the entire box (small margin so nothing gets
          // clipped by antialiasing/physics sway at the edges) instead of the much smaller
          // fullBodyScale above — that padding is what left a big empty, but still
          // draggable, gap around her. Anchored to the bottom edge (feet at the floor)
          // rather than vertically centered, so there's no empty strip below her feet
          // either — the visible character now fills the clickable/draggable box.
          scale = exactFitScale * 0.92;
          model.scale.set(scale);
          model.x = (width - nativeWidth * scale) / 2;
          model.y = height - nativeHeight * scale;
        }

        // Derive the cheek blush's real on-screen spot from the model's actual position/
        // scale (rather than a fixed guess per focus mode) — this keeps it sitting on her
        // face whether she's cropped tight or shown full-body/small, since a full-body head
        // is a much smaller target than a tight face crop.
        const headCenterYPx = model.y + HEAD_CENTER_Y * nativeHeight * scale;
        const headWidthPx = nativeWidth * scale * HEAD_WIDTH_FRACTION;
        const modelCenterX = model.x + (nativeWidth * scale) / 2;
        const cheekSizePx = headWidthPx * 0.42;
        const cheekOffsetX = headWidthPx * 0.36;
        setCheekLayout({
          topPct: (headCenterYPx / height) * 100,
          leftPct: ((modelCenterX - cheekOffsetX - cheekSizePx / 2) / width) * 100,
          rightPct:
            ((width - (modelCenterX + cheekOffsetX + cheekSizePx / 2)) / width) * 100,
          sizePx: cheekSizePx,
        });

        // Bubble sits just above the top of the head — a bit higher than the cheek
        // center, since the cheeks sit mid-face rather than at the very crown.
        const headTopPx = headCenterYPx - headWidthPx * 0.9;
        setBubbleAnchor({
          topPct: (headTopPx / height) * 100,
          centerXPct: (modelCenterX / width) * 100,
        });

        model.on("hit", () => {
          playReaction(getReaction("tap"));
          onTap?.();
          // Bashful reaction: eyes-down head dip + full blush, then back to normal.
          if (shyTimeoutRef.current) clearTimeout(shyTimeoutRef.current);
          setShy(true);
          shyTimeoutRef.current = setTimeout(() => setShy(false), 900);
        });

        setReady(true);

        // Capture a reusable snapshot off the first face-crop instance that loads, so
        // repeated small avatar spots (chat bubbles) can reuse a plain <img> instead of
        // each opening their own WebGL context.
        if (focus === "face" && !cachedFaceSnapshot) {
          try {
            app.renderer.render(app.stage);
            const extract =
              (app.renderer as any).plugins?.extract ||
              (app.renderer as any).extract;
            const snapshotCanvas = extract.canvas(app.stage);
            publishFaceSnapshot(snapshotCanvas.toDataURL("image/png"));
          } catch (snapshotErr) {
            // Non-critical — message bubbles just keep using the SVG fallback if this fails.
            console.warn("Live2D face snapshot capture failed:", snapshotErr);
          }
        }
      } catch (err) {
        // Most likely cause: no network access to the CDN model / Cubism Core script.
        // Fail soft — keep layout stable instead of crashing the chat UI.
        console.error("Live2D model failed to load:", err);
        if (!cancelled) {
          setFailed(true);
          // A PIXI Application may already have been created and its (empty) canvas
          // appended before the failure — without this it's left behind as a permanent
          // blank/black square instead of falling back to the placeholder below.
          if (app) {
            try {
              containerRef.current?.removeChild(app.view as HTMLCanvasElement);
            } catch {
              // already detached — nothing to do
            }
            app.destroy(true, { children: true });
          }
          appRef.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
      if (shyTimeoutRef.current) clearTimeout(shyTimeoutRef.current);
      if (motionReturnTimeoutRef.current) clearTimeout(motionReturnTimeoutRef.current);
      if (bubbleHideTimeoutRef.current) clearTimeout(bubbleHideTimeoutRef.current);
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }
      modelRef.current?.destroy?.();
      appRef.current?.destroy?.(true, { children: true });
      modelRef.current = null;
      appRef.current = null;
      setCheekLayout(null);
      setBubbleAnchor(null);
      setBubbleVisible(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, focus]);

  // Direct tap/click on her — "tap" reaction (motion + giggle voice + bubble).
  useEffect(() => {
    if (!ready || !modelRef.current || !bounce) return;
    playReaction(getReaction("tap"));
  }, [bounce, ready]);

  // Greeting wave when the chat panel opens — "greeting" reaction.
  useEffect(() => {
    if (!ready || !modelRef.current || !greet) return;
    playReaction(getReaction("greeting"));
  }, [greet, ready]);

  // AI is composing a reply — "thinking" reaction once, then explicitly back to Idle
  // (handled inside triggerMotionClip) even if `thinking` is still true by then, since
  // this clip is a one-shot gesture rather than something meant to hold/loop for the wait.
  useEffect(() => {
    if (!ready || !modelRef.current || !thinking) return;
    playReaction(getReaction("thinking"));
  }, [thinking, ready]);

  // AI's reply just arrived and is being shown — "neutral" reaction (closest available
  // "talking" gesture; the model has no real talk/lip-sync motion). Skipped whenever the
  // more specific `emotion` prop is also set for this same reply, so the two don't both
  // fire and overlap/cut each other's voice off.
  useEffect(() => {
    if (!ready || !modelRef.current || !talking || emotion) return;
    playReaction(getReaction("neutral"));
  }, [talking, ready, emotion]);

  // Reply finished successfully / explicitly happy — "happy" reaction.
  useEffect(() => {
    if (!ready || !modelRef.current || !celebrate) return;
    playReaction(getReaction("happy"));
  }, [celebrate, ready]);

  // Chat panel is closing — "goodbye" reaction.
  useEffect(() => {
    if (!ready || !modelRef.current || !goodbye) return;
    playReaction(getReaction("goodbye"));
  }, [goodbye, ready]);

  // Important/notable event — "surprise" reaction.
  useEffect(() => {
    if (!ready || !modelRef.current || !surprise) return;
    playReaction(getReaction("surprise"));
  }, [surprise, ready]);

  // An error occurred — "confused" reaction.
  useEffect(() => {
    if (!ready || !modelRef.current || !confused) return;
    playReaction(getReaction("confused"));
  }, [confused, ready]);

  // Visibly sad/disappointed — "sad" reaction (shares the confused-looking motion clip,
  // but its own voice line + bubble text is what actually reads as "sad" to the viewer).
  useEffect(() => {
    if (!ready || !modelRef.current || !sad) return;
    playReaction(getReaction("sad"));
  }, [sad, ready]);

  // Generic, extensible emotion trigger — whatever key the AI itself picked for its last
  // reply (see LLM_EMOTION_KEYS in micaReactions.ts / AIBuddy.tsx). Guarded by `nonce` so
  // the same emotion firing twice in a row (e.g. two "happy" replies back to back) still
  // re-triggers instead of being ignored as an unchanged prop.
  useEffect(() => {
    if (!ready || !modelRef.current || !emotion) return;
    if (lastEmotionNonceRef.current === emotion.nonce) return;
    lastEmotionNonceRef.current = emotion.nonce;
    playReaction(getReaction(emotion.key));
  }, [emotion, ready]);

  // Idle "aliveness" loop: while lively is on and nothing else is driving her, flash a
  // random small expression every so often and let it fade back to neutral — reads as her
  // reacting/glancing around on her own instead of sitting frozen between interactions.
  // Koharu has no expression files, so expression() is currently a harmless no-op — kept
  // as-is (existing idle system preserved) rather than repurposed into a motion trigger,
  // since that wasn't part of what was approved here.
  useEffect(() => {
    if (!ready || !lively) return;
    let cancelled = false;
    let flashTimeout: ReturnType<typeof setTimeout> | null = null;
    const busy = () =>
      bounce || greet || thinking || talking || celebrate || goodbye || surprise || confused || sad;

    const scheduleNext = () => {
      const delay = 6000 + Math.random() * 8000;
      flashTimeout = setTimeout(() => {
        if (cancelled || !modelRef.current || busy()) {
          scheduleNext();
          return;
        }
        modelRef.current.expression(undefined);
        flashTimeout = setTimeout(() => {
          scheduleNext();
        }, 1600);
      }, delay);
    };
    scheduleNext();

    return () => {
      cancelled = true;
      if (flashTimeout) clearTimeout(flashTimeout);
    };
  }, [ready, lively, bounce, greet, thinking, talking, celebrate, goodbye, surprise, confused, sad]);

  // Idle "aliveness" check-in: a soft, occasional hum/breath moment while she's just
  // standing there idling — NOT too often (60-120s apart, randomized) so it stays a
  // subtle touch rather than an annoyance. Routes through the exact same playReaction()
  // used by every other reaction (tap, happy, thinking, ...), so it gets a real rotating
  // Live2D animation + voice + English subtitle together, not just a sound played over a
  // static pose — see the idle_hum1/idle_hum2 entries in micaReactions.ts for the motion
  // pool. Suppressed the same way as the flash loop above whenever something else is
  // actively happening to her.
  useEffect(() => {
    if (!ready || !lively) return;
    let cancelled = false;
    let humTimeout: ReturnType<typeof setTimeout> | null = null;
    const busy = () =>
      bounce || greet || thinking || talking || celebrate || goodbye || surprise || confused || sad;

    const scheduleNext = () => {
      const delay = 60000 + Math.random() * 60000;
      humTimeout = setTimeout(() => {
        if (cancelled || !modelRef.current || busy()) {
          scheduleNext();
          return;
        }
        const humKey = Math.random() < 0.5 ? "idle_hum1" : "idle_hum2";
        playReaction(getReaction(humKey));
        scheduleNext();
      }, delay);
    };
    scheduleNext();

    return () => {
      cancelled = true;
      if (humTimeout) clearTimeout(humTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, lively, bounce, greet, thinking, talking, celebrate, goodbye, surprise, confused, sad]);

  // Blush strength: a faint glow just from hovering, a stronger one while shy. Stays 0
  // until cheekLayout is computed from the real model geometry, so it never flashes in
  // the wrong spot for an instant before that's ready.
  const blushOpacity = cheekLayout ? (shy ? 0.85 : hovering ? 0.4 : 0) : 0;

  return (
    <div
      className={className}
      style={{ width, height, position: "relative" }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div
        ref={containerRef}
        style={{
          width,
          height,
          cursor: "pointer",
          transform: shy ? "translateY(5%) rotate(-3deg)" : "none",
          transition: "transform 0.35s ease-out",
        }}
      />

      {/* Blush overlay: fades in on hover, fully appears on the bashful head-tap reaction.
          Position/size come from cheekLayout — the model's actual on-canvas head rect —
          so the blush lands on her cheeks whether she's cropped tight or shown full-body. */}
      {cheekLayout && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ opacity: blushOpacity, transition: "opacity 0.25s ease" }}
          aria-hidden
        >
          <div
            style={{
              position: "absolute",
              top: `${cheekLayout.topPct}%`,
              left: `${cheekLayout.leftPct}%`,
              width: cheekLayout.sizePx,
              height: cheekLayout.sizePx * 0.65,
              borderRadius: "9999px",
              background:
                "radial-gradient(circle, rgba(108, 92, 224,0.75) 0%, rgba(108, 92, 224,0) 70%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: `${cheekLayout.topPct}%`,
              right: `${cheekLayout.rightPct}%`,
              width: cheekLayout.sizePx,
              height: cheekLayout.sizePx * 0.65,
              borderRadius: "9999px",
              background:
                "radial-gradient(circle, rgba(108, 92, 224,0.75) 0%, rgba(108, 92, 224,0) 70%)",
            }}
          />
        </div>
      )}
      {/* Speech bubble: appears the instant a reaction's voice starts and disappears the
          instant it ends (see playReaction above). Anchored just above her head using the
          same real model geometry as the cheek blush, so it tracks correctly whether she's
          shown full-body or face-cropped. */}
      {bubbleAnchor && bubbleText && (
        <div
          className="absolute pointer-events-none z-10"
          style={{
            top: `${bubbleAnchor.topPct}%`,
            left: `${bubbleAnchor.centerXPct}%`,
            transform: `translate(-50%, -100%) scale(${bubbleVisible ? 1 : 0.85})`,
            opacity: bubbleVisible ? 1 : 0,
            transition: "opacity 0.18s ease, transform 0.18s ease",
          }}
          aria-live="polite"
        >
          <div
            className="relative px-3 py-1.5 rounded-2xl whitespace-nowrap text-[11px] font-medium shadow-lg"
            style={{
              background: "#F8FAFC",
              color: "#241E3D",
              border: "1.5px solid #7C3AED",
            }}
          >
            {bubbleText}
            <div
              className="absolute left-1/2"
              style={{
                bottom: -6,
                width: 10,
                height: 10,
                marginLeft: -5,
                background: "#F8FAFC",
                borderRight: "1.5px solid #7C3AED",
                borderBottom: "1.5px solid #7C3AED",
                transform: "rotate(45deg)",
              }}
            />
          </div>
        </div>
      )}

      {!ready && !failed && (
        <div
          className="absolute inset-0 flex items-end justify-center pb-2 pointer-events-none"
          aria-hidden
        >
          <div className="w-8 h-8 rounded-full border-2 border-[#94A3B8]/30 border-t-[#94A3B8] animate-spin" />
        </div>
      )}
    </div>
  );
};

export default Live2DCharacter;

/**
 * Lightweight avatar for spots that repeat a lot — chat message bubbles, typing indicator,
 * etc. Shows the shared Live2D face snapshot (see cache above) as a plain <img> once it's
 * available; falls back to the old hand-drawn SVG avatar for the brief moment before that
 * first snapshot has been captured, so nothing ever renders blank.
 */
export const MicaFaceSnapshot: React.FC<{
  size?: number;
  className?: string;
}> = ({ size = 24, className = "" }) => {
  const [url, setUrl] = useState<string | null>(cachedFaceSnapshot);

  useEffect(() => {
    if (url) return;
    const listener = (u: string) => setUrl(u);
    snapshotListeners.add(listener);
    return () => {
      snapshotListeners.delete(listener);
    };
  }, [url]);

  if (!url) {
    return <MicaAvatar size={size} className={className} />;
  }

  return (
    <img
      src={url}
      width={size}
      height={size}
      alt="Mica"
      className={`rounded-full object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
};
