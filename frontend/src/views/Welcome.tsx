// Välkomstsida (splash) som visas när appen öppnas, före inloggning. Illustrationen är en
// inbäddad SVG i appens färgtema – inga externa bilder. "Kom igång" tar vidare till inloggningen.

export function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <main className="app-shell welcome">
      <HeroArt />
      <h1 className="welcome-title">Matchupplevelse</h1>
      <p className="welcome-tagline">
        Hur kändes matchen? I ungdomsfotbollen räknas inte mål – ledarens upplevelse är det som
        betyder något. Rapportera på en enkel 3-gradig skala, så ser förbundet hur jämna serierna
        är.
      </p>

      <div className="welcome-scale">
        <span className="welcome-chip">
          <span aria-hidden="true">⬅️🏆</span> Hemmalaget vann stort
        </span>
        <span className="welcome-chip">
          <span aria-hidden="true">⚖️</span> Jämn match
        </span>
        <span className="welcome-chip">
          <span aria-hidden="true">🏆➡️</span> Bortalaget vann stort
        </span>
      </div>

      <button type="button" className="welcome-cta" onClick={onStart}>
        Kom igång
      </button>
    </main>
  );
}

/** Inbäddad illustration: en kvällsplan med boll och den 3-gradiga skalan. Rent dekorativ. */
function HeroArt() {
  return (
    <svg
      className="hero-art"
      viewBox="0 0 480 240"
      role="img"
      aria-label="Illustration av en fotbollsplan med en boll och matchupplevelseskalan"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#161b22" />
          <stop offset="1" stopColor="#1b2a4a" />
        </linearGradient>
        <linearGradient id="pitch" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f7a3f" />
          <stop offset="1" stopColor="#15592e" />
        </linearGradient>
        <radialGradient id="glow" cx="0.5" cy="0.2" r="0.8">
          <stop offset="0" stopColor="#1f6feb" stopOpacity="0.35" />
          <stop offset="1" stopColor="#1f6feb" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Himmel och ljussken */}
      <rect x="0" y="0" width="480" height="150" fill="url(#sky)" />
      <rect x="0" y="0" width="480" height="150" fill="url(#glow)" />

      {/* Plan med perspektiv */}
      <polygon points="0,150 480,150 480,240 0,240" fill="url(#pitch)" />
      {/* Mittlinje och mittcirkel */}
      <line x1="0" y1="178" x2="480" y2="178" stroke="#dff5e6" strokeOpacity="0.5" strokeWidth="2" />
      <ellipse cx="240" cy="178" rx="52" ry="16" fill="none" stroke="#dff5e6" strokeOpacity="0.5" strokeWidth="2" />
      {/* Strafflinjer vänster/höger */}
      <polygon points="0,160 70,160 40,220 0,220" fill="none" stroke="#dff5e6" strokeOpacity="0.4" strokeWidth="2" />
      <polygon points="480,160 410,160 440,220 480,220" fill="none" stroke="#dff5e6" strokeOpacity="0.4" strokeWidth="2" />

      {/* Boll */}
      <g transform="translate(240 150)">
        <ellipse cx="0" cy="26" rx="20" ry="6" fill="#000" fillOpacity="0.25" />
        <circle cx="0" cy="0" r="22" fill="#f4f6f8" stroke="#cfd6dd" strokeWidth="1.5" />
        <polygon points="0,-9 9,-2 6,9 -6,9 -9,-2" fill="#0d1117" />
        <path d="M0,-22 L0,-9 M9,-2 L21,-7 M6,9 L15,18 M-6,9 L-15,18 M-9,-2 L-21,-7"
          stroke="#0d1117" strokeWidth="1.5" fill="none" />
      </g>

      {/* Tre stjärnor för den 3-gradiga skalan */}
      <g transform="translate(0 44)">
        <Star x={120} fill="#2ea043" />
        <Star x={240} fill="#d29922" />
        <Star x={360} fill="#f85149" />
      </g>
    </svg>
  );
}

function Star({ x, fill }: { x: number; fill: string }) {
  const pts = [
    [0, -16],
    [4.7, -5],
    [16, -5],
    [7, 2],
    [10, 13],
    [0, 6],
    [-10, 13],
    [-7, 2],
    [-16, -5],
    [-4.7, -5],
  ]
    .map((p) => p.join(','))
    .join(' ');
  return (
    <g transform={`translate(${x} 0)`}>
      <polygon points={pts} fill={fill} fillOpacity="0.9" />
    </g>
  );
}
