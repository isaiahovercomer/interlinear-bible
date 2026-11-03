// Tiny damped-spring integrator (semi-implicit Euler, fixed 4ms sub-steps).
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Animate a scalar from `from` to `to`. `velocity` in px/s.
 * Default k=420, c=38 → damping ratio ≈ 0.93: settles in ~300ms with no visible overshoot
 * on a plain snap, but a fast fling still carries through.
 */
export function spring({ from, to, velocity = 0, stiffness = 420, damping = 38, mass = 1, onUpdate, onDone }) {
  if (reducedMotion.matches) { onUpdate(to); onDone?.(); return { stop() {} }; }
  let x = from, v = velocity, last = performance.now(), raf = 0, done = false;
  const step = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = (-stiffness * (x - to) - damping * v) / mass;
      v += a * h;
      x += v * h;
    }
    if (Math.abs(v) < 8 && Math.abs(x - to) < 0.4) { done = true; onUpdate(to); onDone?.(); return; }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return { stop() { if (!done) cancelAnimationFrame(raf); done = true; }, get running() { return !done; } };
}
