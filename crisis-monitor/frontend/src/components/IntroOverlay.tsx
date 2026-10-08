import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { REPLAY_EVENT, WELCOME_HEADING, WELCOME_LINE, introAlreadyShown, introAppliesHere, introSoundEnabled, markIntroShown, playOpeningTone, preloadWelcome, setIntroSoundEnabled, speakWelcome, stopWelcome } from "../intro";
import RealisticEye from "./RealisticEye";
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
          <RealisticEye id="intro-eye" />
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

