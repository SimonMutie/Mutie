import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { REPLAY_EVENT, WELCOME_HEADING, WELCOME_LINE, introAlreadyShown, introAppliesHere, introSoundEnabled, markIntroShown, playOpeningTone, preloadWelcome, setIntroSoundEnabled, speakWelcome, stopWelcome } from "../intro";
import "./IntroOverlay.css";

/**
 * The opening sequence shown when the site is opened: the eye of the mark
 * opens, the welcome appears (and is spoken, where the browser allows
 * sound), then the view passes through the pupil into the site.
 *
 * It sits on top of the app, which loads underneath in the meantime, so it
 * adds no waiting of its own. It plays once per browser tab, can be skipped
 * with a click or any key, and never appears on shared-link pages.
 */

type Phase = "playing" | "leaving" | "skipped" | "gone";

// The welcome is 22 words and is fully on screen about 1.7 s in. The zoom
// waits long enough after that for it to be read at an unhurried pace
// (roughly five seconds); anyone who has seen it can click to skip.
const HOLD_MS = 6500;
const LEAVE_MS = 2300; // the zoom through the pupil, then the fade (see IntroOverlay.css)
const SKIP_MS = 240;
const REDUCED_HOLD_MS = 6000;

export default function IntroOverlay() {
  // Decided once, when the page loads; "Play it now" in Settings can start it again.
  const shouldPlay = useRef<boolean | null>(null);
  if (shouldPlay.current === null) shouldPlay.current = introAppliesHere() && !introAlreadyShown();
  const [phase, setPhase] = useState<Phase>(shouldPlay.current ? "playing" : "gone");
  const [run, setRun] = useState(0); // bumped to replay
  const [soundOn, setSoundOn] = useState(introSoundEnabled);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const eyeRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const skip = useCallback(() => {
    clearTimers();
    setPhase((p) => (p === "gone" ? p : "skipped"));
    timers.current.push(setTimeout(() => setPhase("gone"), SKIP_MS));
  }, []);

  // "Replay" from Settings.
  useEffect(() => {
    const replay = () => {
      clearTimers();
      shouldPlay.current = true;
      setSoundBlocked(false);
      setSoundOn(introSoundEnabled());
      setPhase("playing");
      setRun((n) => n + 1);
    };
    window.addEventListener(REPLAY_EVENT, replay);
    return () => window.removeEventListener(REPLAY_EVENT, replay);
  }, []);

  // The sequence itself.
  // Runs once per play (page load, or a replay) — deliberately not tied to
  // `phase`, so that moving from "playing" to "leaving" does not cancel the
  // timer that finally removes the overlay.
  useEffect(() => {
    if (!shouldPlay.current) return;
    markIntroShown();
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    preloadWelcome();
    playOpeningTone();
    let cancelled = false;
    timers.current.push(
      setTimeout(() => {
        void speakWelcome().then((result) => !cancelled && setSoundBlocked(result === "blocked"));
      }, 700)
    );

    timers.current.push(
      setTimeout(
        () => {
          // How far the pupil-sized disc must grow to cover the whole screen from where the eye sits.
          const eye = eyeRef.current;
          if (eye) {
            const r = eye.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const farthest = Math.max(Math.hypot(cx, cy), Math.hypot(window.innerWidth - cx, cy), Math.hypot(cx, window.innerHeight - cy), Math.hypot(window.innerWidth - cx, window.innerHeight - cy));
            eye.style.setProperty("--intro-flood-scale", String(Math.ceil((farthest / (r.width * 0.085)) * 1.05)));
            // The opening in the screen starts at the pupil and grows to cover the farthest corner.
            const root = eye.closest(".intro") as HTMLElement | null;
            root?.style.setProperty("--intro-cx", `${cx}px`);
            root?.style.setProperty("--intro-cy", `${cy}px`);
            root?.style.setProperty("--intro-hole-max", `${Math.ceil(farthest * 1.05)}px`);
          }
          // The 3D map listens for this and zooms in from far out while the screen opens.
          window.dispatchEvent(new Event("lens:intro-reveal"));
          setPhase("leaving");
          timers.current.push(setTimeout(() => setPhase("gone"), reduced ? 420 : LEAVE_MS));
        },
        reduced ? REDUCED_HOLD_MS : HOLD_MS
      )
    );

    return () => {
      cancelled = true;
      clearTimers();
    };
  }, [run]);

  // Any key skips — except the keys used to reach and press the two buttons.
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab" || e.key === "Shift" || ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement | null)?.closest?.(".intro__controls"))) return;
      skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, skip]);

  if (phase === "gone") return null;

  function toggleSound(e: React.MouseEvent) {
    e.stopPropagation(); // a click on the button is not a skip
    if (soundBlocked) {
      // The browser would not start sound by itself; this click allows it.
      setSoundBlocked(false);
      playOpeningTone();
      void speakWelcome();
      return;
    }
    const next = !soundOn;
    setSoundOn(next);
    setIntroSoundEnabled(next);
    if (!next) stopWelcome();
    else {
      playOpeningTone(); // so switching sound on is heard straight away
      void speakWelcome();
    }
  }

  return (
    <div className={`intro${phase === "leaving" ? " intro--leaving" : ""}${phase === "skipped" ? " intro--skipped" : ""}`} key={run} role="dialog" aria-label={WELCOME_HEADING} onClick={skip}>
      <div className="intro__stage">
        <div className="intro__eye" ref={eyeRef} aria-hidden="true">
          <RealisticEye />
        </div>
        <div className="intro__words">
          <h1>
            Welcome to The <span>Lens</span>
          </h1>
          <p>{WELCOME_LINE}</p>
        </div>
      </div>
      <div className="intro__controls">
        <button type="button" onClick={toggleSound}>
          {soundBlocked ? (
            <>
              <Volume2 size={15} /> Play the welcome
            </>
          ) : soundOn ? (
            <>
              <Volume2 size={15} /> Sound on
            </>
          ) : (
            <>
              <VolumeX size={15} /> Sound off
            </>
          )}
        </button>
        <button type="button" onClick={skip}>
          Skip
        </button>
      </div>
    </div>
  );
}

/** A drawn, lifelike eye: shaded almond sclera with fine veins, a fibrous teal iris with a limbal ring, a deep pupil with
 *  catchlights, a lid crease and lash line. The whole eyeball squashes shut for the blinks (see IntroOverlay.css). */
function RealisticEye() {
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
        <clipPath id="eye-open">
          <path d="M22 112 C 92 22, 308 22, 378 112 C 308 200, 92 200, 22 112 Z" />
        </clipPath>
        <radialGradient id="eye-sclera" cx="50%" cy="50%" r="60%">
          <stop offset="0" stopColor="#f6f3ee" />
          <stop offset="0.65" stopColor="#e6dfd6" />
          <stop offset="1" stopColor="#c9b3a8" />
        </radialGradient>
        <radialGradient id="eye-iris" cx="50%" cy="50%" r="50%">
          <stop offset="0.3" stopColor="#d6b45c" />
          <stop offset="0.42" stopColor="#7fd1c0" />
          <stop offset="0.75" stopColor="#139c94" />
          <stop offset="0.93" stopColor="#0a4a5a" />
          <stop offset="1" stopColor="#04202a" />
        </radialGradient>
        <radialGradient id="eye-pupil" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000" />
          <stop offset="0.8" stopColor="#02080c" />
          <stop offset="1" stopColor="#0b1d24" />
        </radialGradient>
        <linearGradient id="eye-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a0f0c" stopOpacity="0.62" />
          <stop offset="0.38" stopColor="#1a0f0c" stopOpacity="0.1" />
          <stop offset="0.8" stopColor="#1a0f0c" stopOpacity="0" />
          <stop offset="1" stopColor="#1a0f0c" stopOpacity="0.28" />
        </linearGradient>
        <radialGradient id="eye-skin" cx="50%" cy="50%" r="55%">
          <stop offset="0.55" stopColor="#2b1f1c" stopOpacity="0" />
          <stop offset="1" stopColor="#2b1f1c" stopOpacity="0.55" />
        </radialGradient>
        <filter id="eye-soft" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
      </defs>

      {/* soft skin shadow around the opening */}
      <ellipse cx="200" cy="112" rx="196" ry="104" fill="url(#eye-skin)" />
      {/* brow-side crease above the lid */}
      <path d="M44 96 C 110 4, 290 4, 356 96" stroke="#3a2a25" strokeWidth="2.2" strokeLinecap="round" opacity="0.7" filter="url(#eye-soft)" />

      <g className="intro__lids">
        <g className="intro__ball">
          <g clipPath="url(#eye-open)">
            <rect x="0" y="0" width="400" height="220" fill="url(#eye-sclera)" />
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
              <circle cx="200" cy="110" r="64" fill="url(#eye-iris)" />
              <g strokeWidth="0.9" strokeLinecap="round">
                {fibres.map((f, i) => (
                  <line key={i} x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} stroke={f.dark ? "#052a33" : "#c8f2e8"} opacity={f.dark ? 0.42 : 0.28} />
                ))}
              </g>
              {/* collarette and limbal ring */}
              <circle cx="200" cy="110" r="33" stroke="#e8cf8a" strokeWidth="1.4" opacity="0.5" />
              <circle cx="200" cy="110" r="63" stroke="#02161d" strokeWidth="5" opacity="0.85" />
              <circle className="intro__pupil" cx="200" cy="110" r="25" fill="url(#eye-pupil)" />
              {/* catchlights */}
              <ellipse cx="178" cy="88" rx="13" ry="8" fill="#fff" opacity="0.85" transform="rotate(-28 178 88)" />
              <circle cx="221" cy="128" r="4.5" fill="#fff" opacity="0.6" />
            </g>

            {/* the upper lid's shadow falling on the eye */}
            <rect x="0" y="0" width="400" height="220" fill="url(#eye-shade)" />
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
