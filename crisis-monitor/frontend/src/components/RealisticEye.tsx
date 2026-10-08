
/** A drawn, lifelike eye: shaded almond sclera with fine veins, a fibrous teal iris with a limbal ring, a deep pupil with
 *  catchlights, a lid crease and lash line. The whole eyeball squashes shut for the blinks (see IntroOverlay.css). */
export default function RealisticEye({ id = "eye", iris = { gold: "#d6b45c", light: "#7fd1c0", mid: "#139c94", dark: "#0a4a5a", rim: "#04202a" } }: { id?: string; iris?: { gold: string; light: string; mid: string; dark: string; rim: string } }) {
  const fibres = Array.from({ length: 72 }, (_, i) => {
    const a = (i / 72) * Math.PI * 2;
    const r1 = 26 + (i % 3) * 3;
    const r2 = 58 - (i % 4) * 2;
    return { x1: 200 + Math.cos(a) * r1, y1: 110 + Math.sin(a) * r1, x2: 200 + Math.cos(a) * r2, y2: 110 + Math.sin(a) * r2, dark: i % 2 === 0 };
  });
  const lashes = Array.from({ length: 15 }, (_, i) => {
    const t = (i + 1) / 16;
    const x = 40 + t * 320;
    const y = 110 - Math.sin(t * Math.PI) * 78 + (t < 0.5 ? 4 : 4);
    const dx = (t - 0.5) * 14;
    return { x, y, x2: x + dx, y2: y - 11 - Math.sin(t * Math.PI) * 5 };
  });
  return (
    <svg viewBox="0 0 400 220" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={`${id}-open`}>
          <path d="M22 112 C 92 22, 308 22, 378 112 C 308 200, 92 200, 22 112 Z" />
        </clipPath>
        <radialGradient id={`${id}-sclera`} cx="50%" cy="50%" r="60%">
          <stop offset="0" stopColor="#f6f3ee" />
          <stop offset="0.65" stopColor="#e6dfd6" />
          <stop offset="1" stopColor="#c9b3a8" />
        </radialGradient>
        <radialGradient id={`${id}-iris`} cx="50%" cy="50%" r="50%">
          <stop offset="0.3" stopColor={iris.gold} />
          <stop offset="0.42" stopColor={iris.light} />
          <stop offset="0.75" stopColor={iris.mid} />
          <stop offset="0.93" stopColor={iris.dark} />
          <stop offset="1" stopColor={iris.rim} />
        </radialGradient>
        <radialGradient id={`${id}-pupil`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000" />
          <stop offset="0.8" stopColor="#02080c" />
          <stop offset="1" stopColor="#0b1d24" />
        </radialGradient>
        <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a0f0c" stopOpacity="0.62" />
          <stop offset="0.38" stopColor="#1a0f0c" stopOpacity="0.1" />
          <stop offset="0.8" stopColor="#1a0f0c" stopOpacity="0" />
          <stop offset="1" stopColor="#1a0f0c" stopOpacity="0.28" />
        </linearGradient>
        <radialGradient id={`${id}-skin`} cx="50%" cy="50%" r="55%">
          <stop offset="0.55" stopColor="#2b1f1c" stopOpacity="0" />
          <stop offset="1" stopColor="#2b1f1c" stopOpacity="0.55" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
      </defs>

      {/* soft skin shadow around the opening */}
      <ellipse cx="200" cy="112" rx="196" ry="104" fill={`url(#${id}-skin)`} />
      {/* brow-side crease above the lid */}
      <path d="M44 96 C 110 4, 290 4, 356 96" stroke="#3a2a25" strokeWidth="2.2" strokeLinecap="round" opacity="0.7" filter={`url(#${id}-soft)`} />

      <g className="intro__lids">
        <g className="intro__ball">
          <g clipPath={`url(#${id}-open)`}>
            <rect x="0" y="0" width="400" height="220" fill={`url(#${id}-sclera)`} />
            {/* fine red veins at the corners */}
            <g stroke="#b9575a" strokeWidth="0.8" opacity="0.28" strokeLinecap="round">
              <path d="M30 112 C 50 104, 70 110, 92 100" />
              <path d="M34 118 C 56 122, 74 116, 98 124" />
              <path d="M52 108 C 62 100, 74 98, 86 92" />
              <path d="M370 112 C 350 106, 330 112, 310 102" />
              <path d="M366 120 C 346 124, 328 118, 306 126" />
            </g>
            {/* caruncle: the pink fold at the inner corner */}
            <ellipse cx="42" cy="114" rx="15" ry="11" fill="#d98c88" opacity="0.8" />
            <ellipse cx="40" cy="113" rx="7" ry="5" fill="#f0b4ae" opacity="0.7" />

            <g className="intro__iris">
              <circle cx="200" cy="110" r="64" fill={`url(#${id}-iris)`} />
              <g strokeWidth="0.9" strokeLinecap="round">
                {fibres.map((f, i) => (
                  <line key={i} x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} stroke={f.dark ? "#052a33" : "#c8f2e8"} opacity={f.dark ? 0.42 : 0.28} />
                ))}
              </g>
              {/* collarette and limbal ring */}
              <circle cx="200" cy="110" r="33" stroke="#e8cf8a" strokeWidth="1.4" opacity="0.5" />
              <circle cx="200" cy="110" r="63" stroke="#02161d" strokeWidth="5" opacity="0.85" />
              <circle className="intro__pupil" cx="200" cy="110" r="25" fill={`url(#${id}-pupil)`} />
              {/* catchlights */}
              <ellipse cx="178" cy="88" rx="13" ry="8" fill="#fff" opacity="0.85" transform="rotate(-28 178 88)" />
              <circle cx="221" cy="128" r="4.5" fill="#fff" opacity="0.6" />
            </g>

            {/* the upper lid's shadow falling on the eye */}
            <rect x="0" y="0" width="400" height="220" fill={`url(#${id}-shade)`} />
          </g>
          {/* lash line and lashes */}
          <path d="M22 112 C 92 22, 308 22, 378 112" stroke="#0d0807" strokeWidth="6.5" strokeLinecap="round" />
          <path d="M22 112 C 92 200, 308 200, 378 112" stroke="#3a2a25" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
          <g stroke="#0d0807" strokeWidth="2" strokeLinecap="round" opacity="0.9">
            {lashes.map((l, i) => (
              <line key={i} x1={l.x} y1={l.y} x2={l.x2} y2={l.y2} />
            ))}
          </g>
        </g>
      </g>
    </svg>
  );
}
