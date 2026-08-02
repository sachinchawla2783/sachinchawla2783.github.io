const TONES = [
  ["#E2DED4", "#A9A192"],
  ["#EFEDE7", "#87806F"],
  ["#CBC5B6", "#4E4839"],
  ["#F5F3EF", "#69624F"],
] as const;

function hashIndex(seed: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % mod;
}

export function ProductVisual({
  seed,
  className = "",
  priority = false,
}: {
  seed: string;
  className?: string;
  priority?: boolean;
}) {
  const [from, to] = TONES[hashIndex(seed, TONES.length)] ?? TONES[0];
  const rotate = (hashIndex(seed + "r", 7) - 3) * 1.4;

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ background: `linear-gradient(160deg, ${from} 0%, ${to} 100%)` }}
      aria-hidden={!priority}
    >
      <svg
        viewBox="0 0 200 320"
        className="absolute inset-0 h-full w-full"
        style={{ transform: `rotate(${rotate}deg) scale(1.05)` }}
        preserveAspectRatio="xMidYMid meet"
      >
        <rect x="70" y="40" width="60" height="220" rx="4" fill="none" stroke="#0A0A08" strokeOpacity="0.55" strokeWidth="1" />
        <rect x="82" y="20" width="36" height="26" rx="2" fill="none" stroke="#0A0A08" strokeOpacity="0.55" strokeWidth="1" />
        <line x1="70" y1="120" x2="130" y2="120" stroke="#0A0A08" strokeOpacity="0.3" strokeWidth="0.75" />
        <line x1="70" y1="160" x2="130" y2="160" stroke="#0A0A08" strokeOpacity="0.3" strokeWidth="0.75" />
        <line x1="70" y1="200" x2="130" y2="200" stroke="#0A0A08" strokeOpacity="0.3" strokeWidth="0.75" />
        <rect x="76" y="130" width="48" height="70" fill="#0A0A08" fillOpacity="0.08" />
      </svg>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-multiply"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
