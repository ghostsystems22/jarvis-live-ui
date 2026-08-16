import { useEffect, useRef } from 'react';

type Particle = {
  phi: number;
  theta: number;
  size: number;
  alpha: number;
  drift: number;
  driftSpeed: number;
};

type CoreTone = 'idle' | 'listening' | 'speaking';

type ParticleSphereProps = {
  tone?: CoreTone;
};

export default function ParticleSphere({ tone = 'idle' }: ParticleSphereProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loopRef = useRef<((t: number) => void) | null>(null);
  const rafRef = useRef<number | null>(null);
  const spherePointsRef = useRef<Particle[]>([]);
  const rotationRef = useRef(0);
  const timeMsRef = useRef(0);
  const sphereScaleRef = useRef(1);
  const toneRef = useRef<CoreTone>(tone);

  useEffect(() => {
    toneRef.current = tone;
  }, [tone]);

  useEffect(() => {
    let s = 7;
    const rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    const gauss = () => {
      let u = 0;
      let v = 0;
      while (u === 0) u = rand();
      while (v === 0) v = rand();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };

    spherePointsRef.current = [];
    for (let i = 0; i < 2200; i += 1) {
      const phi = Math.acos(2 * rand() - 1);
      const theta = rand() * Math.PI * 2;
      spherePointsRef.current.push({
        phi,
        theta,
        size: 0.7 + rand() * 0.9,
        alpha: 0.25 + rand() * 0.25,
        drift: rand() * Math.PI * 2,
        driftSpeed: 0.4 + rand() * 0.5,
      });
    }
    for (let pole = 0; pole < 2; pole += 1) {
      for (let i = 0; i < 3600; i += 1) {
        let phi = Math.abs(gauss()) * 0.42;
        if (pole === 1) phi = Math.PI - phi;
        const theta = rand() * Math.PI * 2;
        spherePointsRef.current.push({
          phi,
          theta,
          size: 0.6 + rand() * 1.4,
          alpha: 0.35 + rand() * 0.5,
          drift: rand() * Math.PI * 2,
          driftSpeed: 0.4 + rand() * 0.5,
        });
      }
    }

    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    canvas.width = 640;
    canvas.height = 640;

    const W = canvas.width;
    const H = canvas.height;
    const R = W * 0.4;
    const cx = W / 2;
    const cy = H / 2;
    let last = performance.now();

    const loop = (t: number) => {
      t = t || performance.now();
      const dt = Math.min(64, t - last);
      last = t;

      const coreTone = toneRef.current;
      const isListening = coreTone === 'listening';
      const isSpeaking = coreTone === 'speaking';
      const speed = 0.00016;
      rotationRef.current += dt * speed;
      timeMsRef.current += dt;
      const targetScale = isSpeaking ? 1.1 : isListening ? 1.03 : 1;
      sphereScaleRef.current += (targetScale - sphereScaleRef.current) * Math.min(1, dt * 0.006);

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = 0; i < spherePointsRef.current.length; i += 1) {
        const p = spherePointsRef.current[i];
        const th = p.theta + rotationRef.current;
        const x = Math.sin(p.phi) * Math.cos(th);
        const z = Math.sin(p.phi) * Math.sin(th);
        const drift = Math.sin(timeMsRef.current * 0.00025 * p.driftSpeed + p.drift) * 0.05;
        const y = Math.cos(p.phi) + drift;
        const depth = (z + 1) / 2;
        const Rs = R * sphereScaleRef.current;
        const px = cx + x * Rs;
        const py = cy - y * Rs;
        const size = p.size * (0.6 + depth * 0.8);
        let r = 242;
        let g = 242;
        let b = 242;
        if (isSpeaking) {
          r = 242;
          g = 197;
          b = 194;
        } else if (isListening) {
          r = 190;
          g = 219;
          b = 255;
        }
        const a = p.alpha * (0.35 + depth * 0.65);
        ctx.beginPath();
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
      rafRef.current = window.requestAnimationFrame(loop);
    };

    const safeLoop = (t: number) => {
      try {
        loop(t);
      } catch {
        rafRef.current = window.requestAnimationFrame(safeLoop);
      }
    };

    loopRef.current = safeLoop;
    safeLoop(last);

    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      loopRef.current = null;
    };
  }, []);

  return (
    <div className="sphere-wrap" aria-label="Jarvis particle sphere" role="img">
      <canvas ref={canvasRef} className="sphere-canvas" />
    </div>
  );
}
