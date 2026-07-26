import React from "react";

interface GlowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * "outline"  -> dark neumorphic surface, coral border + glow (default)
   * "solid"    -> filled coral-red button with glow
   */
  variant?: "outline" | "solid";
  children: React.ReactNode;
}

/**
 * Neumorphic / Soft-UI button for dark mode.
 * Background: #0B0F17 family, Accent: #6C5CE0 (coral red).
 *
 * Usage:
 *   <GlowButton onClick={handleClick}>Sign in</GlowButton>
 *   <GlowButton variant="solid">Get started</GlowButton>
 */
export default function GlowButton({
  variant = "outline",
  className = "",
  children,
  ...rest
}: GlowButtonProps) {
  const base = variant === "solid" ? "btn-neu-solid" : "btn-neu";
  return (
    <button className={`${base} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
