import React, { useState, useEffect } from "react";
import { motion } from "motion/react";

/**
 * Mica — an illustrated, gradient-shaded chibi character built entirely out of SVG
 * primitives (no external image asset). The gradients + layered shading fake a soft
 * "3D render" look while staying lightweight, and every part is animatable
 * independently (blinking, waving, breathing, bouncing) so she reads as alive
 * rather than a static picture.
 */

interface MicaFigureProps {
  size?: number;
  bounce?: boolean; // big "bored" jump
  wave?: boolean; // waving hello
  className?: string;
}

const HAIR_DARK = "#5847B8";
const HAIR_MID = "#6C5CE0";
const HAIR_LIGHT = "#7C3AED";
const DRESS_DARK = "#6C5CE0";
const DRESS_LIGHT = "#7C3AED";
const SKIN = "#7C3AED";
const SKIN_SHADE = "#7C3AED";

export const MicaFigure: React.FC<MicaFigureProps> = ({ size = 150, bounce = false, wave = false, className = "" }) => {
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const scheduleBlink = () => {
      const delay = 2400 + Math.random() * 3200;
      setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        setTimeout(() => {
          if (!cancelled) setBlink(false);
        }, 140);
        scheduleBlink();
      }, delay);
    };
    scheduleBlink();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <motion.svg
      viewBox="0 0 200 340"
      width={size}
      height={(size * 340) / 200}
      className={className}
      animate={bounce ? { y: [0, -22, 0, -10, 0] } : { y: [0, -3, 0] }}
      transition={
        bounce
          ? { duration: 0.75, ease: "easeInOut" }
          : { duration: 2.6, repeat: Infinity, ease: "easeInOut" }
      }
    >
      <defs>
        <radialGradient id="micaShadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0B0F17" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0B0F17" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="micaHair" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={HAIR_LIGHT} />
          <stop offset="100%" stopColor={HAIR_DARK} />
        </linearGradient>
        <linearGradient id="micaDress" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={DRESS_LIGHT} />
          <stop offset="100%" stopColor={DRESS_DARK} />
        </linearGradient>
        <linearGradient id="micaSkin" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={SKIN} />
          <stop offset="100%" stopColor={SKIN_SHADE} />
        </linearGradient>
      </defs>

      {/* Ground contact shadow */}
      <ellipse cx="100" cy="322" rx="46" ry="9" fill="url(#micaShadow)" />

      {/* Back twin-tails (behind body) */}
      <path d="M62 96 C40 120 34 170 46 222 C52 210 60 200 64 190 C56 160 58 122 62 96 Z" fill="url(#micaHair)" />
      <path d="M138 96 C160 120 166 170 154 222 C148 210 140 200 136 190 C144 160 142 122 138 96 Z" fill="url(#micaHair)" />

      {/* Legs */}
      <rect x="78" y="228" width="18" height="70" rx="9" fill="#1C2235" />
      <rect x="104" y="228" width="18" height="70" rx="9" fill="#1C2235" />
      {/* Shoes */}
      <ellipse cx="87" cy="303" rx="14" ry="9" fill={DRESS_DARK} />
      <ellipse cx="113" cy="303" rx="14" ry="9" fill={DRESS_DARK} />

      {/* Left arm (viewer's left), resting */}
      <motion.g style={{ transformOrigin: "72px 148px" }}>
        <rect x="63" y="145" width="16" height="62" rx="8" fill="url(#micaSkin)" />
      </motion.g>

      {/* Dress / body */}
      <path
        d="M70 132 C70 118 84 108 100 108 C116 108 130 118 130 132 L138 216 C138 228 122 236 100 236 C78 236 62 228 62 216 Z"
        fill="url(#micaDress)"
      />
      {/* Collar bow */}
      <path d="M92 122 L100 130 L108 122 L100 116 Z" fill={DRESS_DARK} />
      <circle cx="100" cy="124" r="3.5" fill="#fff" opacity="0.85" />

      {/* Right arm (viewer's right) — waves when active */}
      <motion.g
        style={{ transformOrigin: "128px 148px" }}
        animate={wave ? { rotate: [0, -55, -25, -55, 0] } : { rotate: 0 }}
        transition={wave ? { duration: 0.9, repeat: 1, ease: "easeInOut" } : { duration: 0.3 }}
      >
        <rect x="121" y="145" width="16" height="62" rx="8" fill="url(#micaSkin)" />
      </motion.g>

      {/* Neck */}
      <rect x="92" y="96" width="16" height="18" fill="url(#micaSkin)" />

      {/* Head */}
      <circle cx="100" cy="76" r="40" fill="url(#micaSkin)" />

      {/* Hair back cap (behind face, above head) */}
      <path
        d="M58 70 C54 34 76 8 100 8 C124 8 146 34 142 70 C140 54 128 44 100 44 C72 44 60 54 58 70 Z"
        fill="url(#micaHair)"
      />
      {/* Side hair strands framing face */}
      <path d="M58 66 C52 84 52 100 58 112 C64 100 64 84 66 68 Z" fill="url(#micaHair)" />
      <path d="M142 66 C148 84 148 100 142 112 C136 100 136 84 134 68 Z" fill="url(#micaHair)" />
      {/* Front bangs */}
      <path
        d="M62 58 C70 40 86 30 100 30 C114 30 130 40 138 58 C126 48 112 44 100 44 C88 44 74 48 62 58 Z"
        fill="url(#micaHair)"
      />

      {/* Blush */}
      <ellipse cx="80" cy="86" rx="6" ry="3.5" fill="#7C3AED" opacity="0.55" />
      <ellipse cx="120" cy="86" rx="6" ry="3.5" fill="#7C3AED" opacity="0.55" />

      {/* Eyes (blink = squashed to a lash line) */}
      <motion.g animate={{ scaleY: blink ? 0.08 : 1 }} style={{ transformOrigin: "88px 76px" }} transition={{ duration: 0.08 }}>
        <ellipse cx="88" cy="76" rx="5" ry="7" fill="#161A2B" />
        <circle cx="90" cy="73" r="1.6" fill="#fff" />
      </motion.g>
      <motion.g animate={{ scaleY: blink ? 0.08 : 1 }} style={{ transformOrigin: "112px 76px" }} transition={{ duration: 0.08 }}>
        <ellipse cx="112" cy="76" rx="5" ry="7" fill="#161A2B" />
        <circle cx="114" cy="73" r="1.6" fill="#fff" />
      </motion.g>

      {/* Mouth */}
      <path d="M92 92 Q100 98 108 92" stroke="#6C5CE0" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </motion.svg>
  );
};

/** Small round headshot crop of Mica, used in the chat panel header and message bubbles. */
export const MicaAvatar: React.FC<{ size?: number; className?: string }> = ({ size = 32, className = "" }) => {
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const scheduleBlink = () => {
      const delay = 2600 + Math.random() * 3000;
      setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        setTimeout(() => {
          if (!cancelled) setBlink(false);
        }, 140);
        scheduleBlink();
      }, delay);
    };
    scheduleBlink();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <svg
      viewBox="52 4 96 118"
      width={size}
      height={size}
      className={`rounded-full ${className}`}
      style={{ background: "linear-gradient(135deg, #161A2B, #0D111D)" }}
    >
      <defs>
        <linearGradient id="micaHairSmall" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={HAIR_LIGHT} />
          <stop offset="100%" stopColor={HAIR_DARK} />
        </linearGradient>
        <linearGradient id="micaSkinSmall" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={SKIN} />
          <stop offset="100%" stopColor={SKIN_SHADE} />
        </linearGradient>
      </defs>
      <circle cx="100" cy="76" r="40" fill="url(#micaSkinSmall)" />
      <path
        d="M58 70 C54 34 76 8 100 8 C124 8 146 34 142 70 C140 54 128 44 100 44 C72 44 60 54 58 70 Z"
        fill="url(#micaHairSmall)"
      />
      <path d="M58 66 C52 84 52 100 58 112 C64 100 64 84 66 68 Z" fill="url(#micaHairSmall)" />
      <path d="M142 66 C148 84 148 100 142 112 C136 100 136 84 134 68 Z" fill="url(#micaHairSmall)" />
      <path
        d="M62 58 C70 40 86 30 100 30 C114 30 130 40 138 58 C126 48 112 44 100 44 C88 44 74 48 62 58 Z"
        fill="url(#micaHairSmall)"
      />
      <ellipse cx="80" cy="86" rx="6" ry="3.5" fill="#7C3AED" opacity="0.55" />
      <ellipse cx="120" cy="86" rx="6" ry="3.5" fill="#7C3AED" opacity="0.55" />
      <g style={{ transformOrigin: "88px 76px", transform: blink ? "scaleY(0.08)" : "scaleY(1)", transition: "transform 0.08s" }}>
        <ellipse cx="88" cy="76" rx="5" ry="7" fill="#161A2B" />
        <circle cx="90" cy="73" r="1.6" fill="#fff" />
      </g>
      <g style={{ transformOrigin: "112px 76px", transform: blink ? "scaleY(0.08)" : "scaleY(1)", transition: "transform 0.08s" }}>
        <ellipse cx="112" cy="76" rx="5" ry="7" fill="#161A2B" />
        <circle cx="114" cy="73" r="1.6" fill="#fff" />
      </g>
      <path d="M92 92 Q100 98 108 92" stroke="#6C5CE0" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
};
