import micaLogo from "../../assets/images/mica2ndlogo.png";

/**
 * Visual-only left panel of the login split layout.
 *
 * Purely presentational: dark black surface, purple/blue light diffusion and a
 * halftone dot pattern with the original MICA logo centered on top.
 * Contains no interactive elements, no state and no authentication logic.
 * Hidden below the `lg` breakpoint so mobile only renders the login form.
 */
export default function MicaBrandPanel() {
  return (
    <aside
      aria-hidden="true"
      className="relative hidden lg:flex w-[38%] xl:w-[40%] shrink-0 items-center justify-center overflow-hidden bg-black"
    >
      {/* Purple / blue light diffusion — dark, soft and continuously drifting */}
      <div className="absolute inset-0 pointer-events-none mica-brand-aurora" />

      {/* Halftone dot pattern — large field, masked so it dissolves into black */}
      <div
        className="absolute inset-0 pointer-events-none mica-dots-drift"
        style={{
          backgroundImage: "radial-gradient(rgba(196,181,253,0.75) 1px, transparent 1.4px)",
          backgroundSize: "15px 15px",
          opacity: 0.45,
          WebkitMaskImage:
            "radial-gradient(80% 70% at 25% 20%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.45) 45%, transparent 80%)",
          maskImage:
            "radial-gradient(80% 70% at 25% 20%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.45) 45%, transparent 80%)",
        }}
      />

      {/* Halftone dot pattern — finer field in the opposite corner */}
      <div
        className="absolute inset-0 pointer-events-none mica-dots-drift-slow"
        style={{
          backgroundImage: "radial-gradient(rgba(147,197,253,0.6) 0.8px, transparent 1.2px)",
          backgroundSize: "9px 9px",
          opacity: 0.3,
          WebkitMaskImage:
            "radial-gradient(70% 60% at 85% 85%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.4) 50%, transparent 82%)",
          maskImage:
            "radial-gradient(70% 60% at 85% 85%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.4) 50%, transparent 82%)",
        }}
      />

      {/* Subtle black areas / vignette — keeps the edges quiet and premium */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 50%, transparent 25%, rgba(0,0,0,0.55) 78%, rgba(0,0,0,0.9) 100%)," +
            "linear-gradient(90deg, rgba(0,0,0,0.35) 0%, transparent 30%, transparent 68%, rgba(0,0,0,0.55) 84%, rgba(0,0,0,0.95) 96%, #000 100%)",
        }}
      />

      {/* MICA logo — original asset, centered vertically and horizontally */}
      <div className="relative z-10 flex w-[56%] max-w-[340px] flex-col items-center">
        <img
          src={micaLogo}
          alt="MICA"
          draggable={false}
          className="w-full select-none mica-logo-pulse"
        />
        <span className="mt-3 text-xs font-normal tracking-[0.18em] text-zinc-400/70">
          Mica-ai-v0.1.1
        </span>
      </div>
    </aside>
  );
}
