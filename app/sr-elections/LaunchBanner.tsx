// app/sr-elections/LaunchBanner.tsx
//
// The "nominations are coming" banner, launched with fanfare: the tile zooms in
// and shakes while two confetti cannons at
// the bottom corners fire up and inward, sweeping their angle so the burst arcs
// across the screen, then the pieces flutter down. Plain <canvas>, no library.
//
// Plays once per browser session per `id` (so a refresh doesn't replay it), and
// never for anyone whose device asks to reduce motion; waits until the page is
// visible if it was opened in a background tab. The 🎉 button replays it.

'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

// Portal palette (tailwind.config.ts) plus a soft cream.
const COLORS = ['#c33249', '#e8a94c', '#702c4e', '#7a2331', '#b9762e', '#f7e0e4', '#fbe8d2'];

type Piece = {
  x: number; y: number; vx: number; vy: number;
  size: number; color: string; shape: 'rect' | 'circle' | 'strip';
  rot: number; vrot: number; wobble: number; vwobble: number; life: number;
};

const GRAVITY = 0.32;
const DRAG = 0.985;
const DURATION_MS = 4200;
const SWEEP_MS = 800;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function LaunchBanner({ id, children }: { id: string; children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(false);
  const stopRef = useRef<(() => void) | null>(null);
  // waiting: hidden until the launch starts · launching: zoom + shake playing
  // · still: shown plainly (already seen this session, or reduced motion)
  const [phase, setPhase] = useState<'waiting' | 'launching' | 'still'>('waiting');
  const [play, setPlay] = useState(0);
  const [showCanvas, setShowCanvas] = useState(false);

  const fire = useCallback(() => {
    if (runningRef.current || prefersReducedMotion()) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    runningRef.current = true;
    setShowCanvas(true);

    {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const resize = () => {
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      window.addEventListener('resize', resize);

      const W = () => window.innerWidth;
      const H = () => window.innerHeight;
      // Fewer pieces on small screens. Launch speed comes from the screen
      // height (v = sqrt(2gh), plus headroom for air drag) so the burst
      // reaches the top of any screen.
      const perShot = W() < 640 ? 4 : 7;
      const speed = Math.max(16, Math.min(36, Math.sqrt(2 * GRAVITY * H()) * 1.4));

      const pieces: Piece[] = [];
      const spawn = (fromLeft: boolean, progress: number) => {
        // Sweep: start steep (75° from horizontal), end flatter (50°), aimed inward.
        const angleDeg = 75 - 25 * progress + (Math.random() - 0.5) * 14;
        const a = (angleDeg * Math.PI) / 180;
        const v = speed * (0.75 + Math.random() * 0.45);
        for (let i = 0; i < perShot; i++) {
          const r = Math.random();
          pieces.push({
            x: fromLeft ? -10 : W() + 10,
            y: H() + 10,
            vx: Math.cos(a) * v * (fromLeft ? 1 : -1),
            vy: -Math.sin(a) * v,
            size: 7 + Math.random() * 8,
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            shape: r < 0.5 ? 'rect' : r < 0.8 ? 'strip' : 'circle',
            rot: Math.random() * Math.PI,
            vrot: (Math.random() - 0.5) * 0.3,
            wobble: Math.random() * Math.PI * 2,
            vwobble: 0.08 + Math.random() * 0.1,
            life: 1,
          });
        }
      };

      const start = performance.now();
      let last = start;
      let frame = 0;

      const tick = (now: number) => {
        const elapsed = now - start;
        const step = Math.min(2, (now - last) / 16.67); // frame-rate independent
        last = now;

        if (elapsed < SWEEP_MS && frame % 2 === 0) {
          const p = elapsed / SWEEP_MS;
          spawn(true, p);
          spawn(false, p);
        }
        frame++;

        ctx.clearRect(0, 0, W(), H());
        const fadeStart = DURATION_MS - 900;
        for (const pc of pieces) {
          pc.vx *= Math.pow(DRAG, step);
          pc.vy = pc.vy * Math.pow(DRAG, step) + GRAVITY * step;
          // Once falling, flutter sideways like paper.
          pc.wobble += pc.vwobble * step;
          pc.x += (pc.vx + (pc.vy > 0 ? Math.sin(pc.wobble) * 1.2 : 0)) * step;
          pc.y += Math.min(pc.vy, 6) * step;
          pc.rot += pc.vrot * step;
          if (elapsed > fadeStart) pc.life = Math.max(0, 1 - (elapsed - fadeStart) / 900);

          ctx.save();
          ctx.globalAlpha = pc.life;
          ctx.translate(pc.x, pc.y);
          ctx.rotate(pc.rot);
          ctx.fillStyle = pc.color;
          const flip = Math.abs(Math.cos(pc.wobble)); // 3D-ish tumble
          if (pc.shape === 'circle') {
            ctx.beginPath();
            ctx.ellipse(0, 0, pc.size / 2.4, (pc.size / 2.4) * Math.max(0.3, flip), 0, 0, Math.PI * 2);
            ctx.fill();
          } else if (pc.shape === 'strip') {
            ctx.fillRect(-pc.size / 2, -pc.size / 8, pc.size * 1.3, (pc.size / 4) * Math.max(0.3, flip));
          } else {
            ctx.fillRect(-pc.size / 2, -pc.size / 2 * Math.max(0.3, flip), pc.size, pc.size * Math.max(0.3, flip));
          }
          ctx.restore();
        }

        if (elapsed < DURATION_MS) {
          frameId = requestAnimationFrame(tick);
        } else {
          stop();
        }
      };

      let frameId = requestAnimationFrame(tick);
      const stop = () => {
        cancelAnimationFrame(frameId);
        window.removeEventListener('resize', resize);
        ctx.clearRect(0, 0, W(), H());
        runningRef.current = false;
        stopRef.current = null;
        setShowCanvas(false);
      };
      stopRef.current = stop;
    }
  }, []);

  // Leaving the page mid-launch stops the animation loop.
  useEffect(() => () => stopRef.current?.(), []);

  // The full launch: the tile zooms in and shakes (CSS, restarted via `play`),
  // and the confetti fires as the tile lands.
  const launch = useCallback(() => {
    setPhase('launching');
    setPlay((n) => n + 1);
    window.setTimeout(fire, 320);
  }, [fire]);

  useEffect(() => {
    const key = `acad-sr-launch-${id}`;
    let seen = false;
    try {
      seen = window.sessionStorage.getItem(key) === '1';
    } catch {
      // storage blocked: just play it
    }
    if (seen || prefersReducedMotion()) {
      setPhase('still');
      return;
    }

    let cancelled = false;
    let timer = 0;
    let frame1 = 0;
    let frame2 = 0;
    const go = () => {
      if (cancelled) return;
      document.removeEventListener('visibilitychange', onVisible);
      // Two frames after mount, so the layout has settled: the sidebar restores
      // its width right after load, and animating while the layout shifts left
      // the tile's text drawn in its old position.
      frame1 = requestAnimationFrame(() => {
        frame2 = requestAnimationFrame(() => {
          // Marked as seen only when it actually plays, so a cancelled first
          // attempt (React may mount twice in development) doesn't skip it.
          try {
            window.sessionStorage.setItem(key, '1');
          } catch {
            // fine: it may play again next refresh
          }
          launch();
        });
      });
    };
    // Opened in a background tab? Wait until the student can actually see it.
    const onVisible = () => {
      if (document.visibilityState === 'visible') go();
    };
    if (document.visibilityState === 'visible') timer = window.setTimeout(go, 150);
    else document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id, launch]);

  return (
    <>
      {/* Always mounted (so it's ready the instant the launch starts), hidden when idle. */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 z-50 h-full w-full ${showCanvas ? '' : 'hidden'}`}
      />
      <div
        key={play}
        className={`sr-launch card relative overflow-hidden p-4 pr-12 text-sm text-inkSoft border-brand-100 bg-brand-50 ${
          phase === 'waiting' ? 'opacity-0' : phase === 'launching' ? 'sr-launch-in' : ''
        }`}
      >
        {children}
        <button
          type="button"
          onClick={launch}
          title="Celebrate again"
          aria-label="Play the confetti again"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-base transition hover:bg-brand-100 active:scale-90"
        >
          🎉
        </button>
      </div>
    </>
  );
}
