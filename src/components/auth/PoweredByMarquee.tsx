const STACK = [
  "Privy",
  "Arc",
  "Groq",
  "Rialo",
  "Latch",
  "AGP",
  "Firebase",
  "Neon Database",
  "OpenAI",
  "Alchemy",
  "Circle Arc",
  "Claude",
];

/**
 * Visual-only "Powered by" footer for the login page.
 *
 * Purely presentational: a subtle tech-stack label above a continuously
 * scrolling (right -> left) marquee of partner/stack names. The list is
 * rendered twice so the translateX(-50%) loop is seamless. Contains no
 * interactive elements, no state and no authentication logic.
 */
export default function PoweredByMarquee() {
  const renderRow = (rowIndex: number) => (
    <div key={rowIndex} className="flex shrink-0 items-center" aria-hidden={rowIndex === 1}>
      {STACK.map((name) => (
        <span
          key={name}
          className="flex items-center whitespace-nowrap px-4 text-[11px] font-medium tracking-wide text-white/35 sm:px-5 sm:text-xs"
        >
          {name}
        </span>
      ))}
    </div>
  );

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-6 pb-5 sm:px-10 sm:pb-6">
      {/* Continuous right -> left marquee */}
      <div
        className="relative w-full overflow-hidden"
        style={{
          WebkitMaskImage:
            "linear-gradient(90deg, transparent 0%, rgba(0,0,0,1) 10%, rgba(0,0,0,1) 90%, transparent 100%)",
          maskImage:
            "linear-gradient(90deg, transparent 0%, rgba(0,0,0,1) 10%, rgba(0,0,0,1) 90%, transparent 100%)",
        }}
      >
        <div className="mica-poweredby-marquee flex w-max">
          {renderRow(0)}
          {renderRow(1)}
        </div>
      </div>
    </div>
  );
}
