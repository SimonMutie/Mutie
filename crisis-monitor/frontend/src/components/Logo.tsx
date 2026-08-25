interface Props {
  size?: number;
  /** Static two-color mark with fixed hex colors (for favicons/exports, where CSS
   *  vars from the app's theme don't resolve) instead of the live theme colors. */
  standalone?: boolean;
}

/** The GlobaLens mark: an eye watching over a globe rendered as its iris, with a
 *  bright pupil/lens-flare highlight at the center — "an eye on the world" and
 *  "a lens focused on it" at once. */
export default function Logo({ size = 28, standalone = false }: Props) {
  const signal = standalone ? "#0d9488" : "var(--signal)";
  const info = standalone ? "#2f66f0" : "var(--info)";

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      {standalone && <rect x="0" y="0" width="40" height="40" rx="9" fill="#f4f6f9" />}

      {/* outer eye / lens aperture */}
      <path
        d="M3 20 Q11 5.5 20 5.5 Q29 5.5 37 20 Q29 34.5 20 34.5 Q11 34.5 3 20 Z"
        stroke={signal}
        strokeWidth="2.3"
        strokeLinejoin="round"
      />

      {/* iris: a globe, so the eye is always watching the whole world */}
      <circle cx="20" cy="20" r="8.6" stroke={info} strokeWidth="1.4" />
      <ellipse cx="20" cy="20" rx="3.5" ry="8.6" stroke={info} strokeWidth="1" opacity="0.6" />
      <path d="M11.4 20H28.6" stroke={info} strokeWidth="1" opacity="0.6" />
      <path d="M12.7 15.2C15.3 17 24.7 17 27.3 15.2" stroke={info} strokeWidth="0.85" opacity="0.42" />
      <path d="M12.7 24.8C15.3 23 24.7 23 27.3 24.8" stroke={info} strokeWidth="0.85" opacity="0.42" />

      {/* pupil + lens-flare highlight */}
      <circle cx="20" cy="20" r="3.4" fill={signal} />
      <circle cx="18.5" cy="18.5" r="1.05" fill="white" opacity="0.9" />
    </svg>
  );
}
