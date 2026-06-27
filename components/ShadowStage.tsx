'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Landmark = { x: number; y: number; z?: number };
type HandsResult = {
  multiHandLandmarks?: Landmark[][];
  multiHandedness?: Array<{ label?: string; score?: number }>;
};

declare global {
  interface Window {
    Hands?: new (config: { locateFile: (file: string) => string }) => {
      setOptions: (options: Record<string, unknown>) => void;
      onResults: (callback: (result: HandsResult) => void) => void;
      send: (input: { image: HTMLVideoElement }) => Promise<void>;
    };
    Camera?: new (
      video: HTMLVideoElement,
      config: { onFrame: () => Promise<void>; width: number; height: number },
    ) => { start: () => void };
  }
}

const BACKGROUNDS = ['/背景1.png', '/背景2.png', '/背景3.png', '/背景4.png'];

const RABBIT_RUN = '/兔子奔跑-removebg-preview.png';
const RABBIT_SLEEP = '/兔子睡觉-removebg-preview.png';
const TORTOISE_RUN = '/乌龟奔跑-removebg-preview.png';
const RABBIT_GESTURE_GUIDE = '/rabbit-gesture-original.png';
const RABBIT_GESTURE_FALLBACK = '/rabbit-gesture-guide.svg';

const SCRIPT_URLS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3/camera_utils.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js',
];

const MB_SCALE = 0.5;
const SHADOW_SIZE = 1.18;
const SHADOW_DARKNESS = 0.86;
const LIGHT_OFFSET = 22;

type ShadowTuning = {
  thickness: number;
  tipScale: number;
  mergeThreshold: number;
  mergeBlur: number;
  edgeBlur: number;
};

const DEFAULT_TUNING: ShadowTuning = {
  thickness: 0.68,
  tipScale: 0.35,
  mergeThreshold: 50,
  mergeBlur: 0.062,
  edgeBlur: 3,
};

const PALM = [0, 1, 2, 5, 9, 13, 17];
const BONES: Array<[number, number, number]> = [
  [0, 5, 0.2],
  [0, 9, 0.2],
  [0, 13, 0.19],
  [0, 17, 0.18],
  [5, 9, 0.18],
  [9, 13, 0.17],
  [13, 17, 0.16],
  [0, 1, 0.15],
  [1, 2, 0.14],
  [2, 3, 0.13],
  [3, 4, 0.115],
  [5, 6, 0.13],
  [6, 7, 0.118],
  [7, 8, 0.105],
  [9, 10, 0.13],
  [10, 11, 0.118],
  [11, 12, 0.105],
  [13, 14, 0.122],
  [14, 15, 0.11],
  [15, 16, 0.098],
  [17, 18, 0.112],
  [18, 19, 0.1],
  [19, 20, 0.088],
];
const JOINTS: Array<[number, number]> = [
  [0, 0.165],
  [1, 0.105],
  [5, 0.12],
  [9, 0.12],
  [13, 0.112],
  [17, 0.105],
];
const TIPS: Array<[number, number]> = [
  [4, 0.102],
  [8, 0.095],
  [12, 0.095],
  [16, 0.088],
  [20, 0.082],
];
const EURO_BETA = 0.6;
const EURO_DCUTOFF = 1.0;

function euroMinCutoff() {
  return Math.exp((1 - 0.55) * Math.log(8) + 0.55 * Math.log(0.4));
}

class OneEuro {
  private xp: number | null = null;
  private dp = 0;
  private tp: number | null = null;

  private alpha(cutoff: number, dt: number) {
    return 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  }

  filter(value: number, time: number) {
    if (this.tp === null || this.xp === null) {
      this.tp = time;
      this.xp = value;
      return value;
    }

    let dt = (time - this.tp) / 1000;
    if (!(dt > 0)) dt = 1 / 60;
    this.tp = time;

    const dx = (value - this.xp) / dt;
    const ad = this.alpha(EURO_DCUTOFF, dt);
    this.dp = ad * dx + (1 - ad) * this.dp;

    const a = this.alpha(euroMinCutoff() + EURO_BETA * Math.abs(this.dp), dt);
    this.xp = a * value + (1 - a) * this.xp;
    return this.xp;
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function hull(points: Array<{ x: number; y: number }>) {
  if (points.length < 3) return points.slice();

  let left = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].x < points[left].x) left = i;
  }

  const out: Array<{ x: number; y: number }> = [];
  let current = left;
  do {
    out.push(points[current]);
    let next = (current + 1) % points.length;
    for (let i = 0; i < points.length; i += 1) {
      const cross =
        (points[next].x - points[current].x) * (points[i].y - points[current].y) -
        (points[next].y - points[current].y) * (points[i].x - points[current].x);
      if (cross < 0) next = i;
    }
    current = next;
  } while (current !== left);

  return out;
}

function drawHandMask(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  width: number,
  height: number,
  key: string,
  time: number,
  filters: Map<string, OneEuro>,
  tuning: ShadowTuning,
) {
  const smooth = (filterKey: string, value: number) => {
    let filter = filters.get(filterKey);
    if (!filter) {
      filter = new OneEuro();
      filters.set(filterKey, filter);
    }
    return filter.filter(value, time);
  };

  const points = landmarks.map((point, index) => ({
    x: smooth(`${key}:${index}:x`, point.x) * width,
    y: smooth(`${key}:${index}:y`, point.y) * height,
  }));
  const palmSpan = Math.hypot(points[9].x - points[0].x, points[9].y - points[0].y) || 1;
  const palmHull = hull(PALM.map((index) => points[index]));
  const center = palmHull.reduce(
    (sum, point) => ({ x: sum.x + point.x / palmHull.length, y: sum.y + point.y / palmHull.length }),
    { x: 0, y: 0 },
  );

  const strokeScale = palmSpan * tuning.thickness;

  ctx.save();
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  palmHull.forEach((point, index) => {
    const x = center.x + (point.x - center.x) * 1.12;
    const y = center.y + (point.y - center.y) * 1.12;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();

  for (const [from, to, weight] of BONES) {
    ctx.lineWidth = strokeScale * weight;
    ctx.beginPath();
    ctx.moveTo(points[from].x, points[from].y);
    ctx.lineTo(points[to].x, points[to].y);
    ctx.stroke();
  }

  for (const [index, radius] of JOINTS) {
    ctx.beginPath();
    ctx.arc(points[index].x, points[index].y, strokeScale * radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const [index, radius] of TIPS) {
    ctx.beginPath();
    ctx.arc(points[index].x, points[index].y, strokeScale * radius * tuning.tipScale, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  return palmSpan;
}

export default function ShadowStage() {
  // Canvas / video refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const mergedRef = useRef<HTMLCanvasElement | null>(null);
  const filterRef = useRef<Map<string, OneEuro>>(new Map());

  // MediaPipe / UI state
  const [status, setStatus] = useState('Loading model...');
  const [state, setState] = useState<'loading' | 'idle' | 'ready'>('loading');
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');

  // Background / sprite state (from wan branch)
  const [bgIndex, setBgIndex] = useState(0);
  const bgIndexRef = useRef(0);
  useEffect(() => { bgIndexRef.current = bgIndex; }, [bgIndex]);

  // Story state
  const [step, setStep] = useState<number>(0);
  const [hasHand, setHasHand] = useState(false);

  // DOM refs for direct high-frequency style updates (bypasses React re-renders)
  const rabbitRef = useRef<HTMLDivElement>(null);
  const tortoiseRef = useRef<HTMLDivElement>(null);
  const rabbitSpriteRef = useRef<HTMLImageElement>(null);
  const tortoiseSpriteRef = useRef<HTMLImageElement>(null);
  const handCursorRef = useRef<HTMLDivElement>(null);
  const startStoryButtonRef = useRef<HTMLButtonElement>(null);

  // Refs for rAF tick — prevents stale closures
  const stepRef = useRef(0);
  const rabbitXRef = useRef(10);
  const tortoiseXRef = useRef(5);

  const trackingRef = useRef<{
    hasHand: boolean;
    centroid: Landmark | null;
  }>({
    hasHand: false,
    centroid: null,
  });

  // Keep step ref in sync
  useEffect(() => { stepRef.current = step; }, [step]);

  // Sync background image with story step
  useEffect(() => {
    setBgIndex(step <= 0 ? 0 : Math.max(0, Math.min(BACKGROUNDS.length - 1, step - 1)));
  }, [step]);

  const paintRabbit = useCallback((x = rabbitXRef.current, sleeping = false) => {
    const rounded = Math.round(x);
    if (rabbitSpriteRef.current) {
      rabbitSpriteRef.current.style.left = `${rounded}%`;
      rabbitSpriteRef.current.src = sleeping ? RABBIT_SLEEP : RABBIT_RUN;
    }
    if (rabbitRef.current) {
      rabbitRef.current.style.left = `${rounded}%`;
      const label = rabbitRef.current.querySelector('.runner-label');
      if (label) label.textContent = `Rabbit ${rounded}%${sleeping ? ' (Sleeping)' : ''}`;
    }
  }, []);

  const paintTortoise = useCallback((x = tortoiseXRef.current) => {
    const rounded = Math.round(x);
    if (tortoiseSpriteRef.current) {
      tortoiseSpriteRef.current.style.left = `${rounded}%`;
    }
    if (tortoiseRef.current) {
      tortoiseRef.current.style.left = `${rounded}%`;
      const label = tortoiseRef.current.querySelector('.runner-label');
      if (label) label.textContent = `Tortoise ${rounded}%`;
    }
  }, []);

  // Load MediaPipe scripts
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        await SCRIPT_URLS.reduce((chain, src) => chain.then(() => loadScript(src)), Promise.resolve());
        if (!cancelled) { setState('idle'); setStatus('Ready'); }
      } catch {
        if (!cancelled) { setState('idle'); setStatus('Model failed to load'); setError('MediaPipe failed to load. Check your network and refresh.'); }
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  const resetRace = useCallback(() => {
    const currentStep = stepRef.current;

    if (currentStep <= 1) {
      rabbitXRef.current = 10;
      tortoiseXRef.current = 5;
    } else if (currentStep === 2) {
      rabbitXRef.current = 46;
      tortoiseXRef.current = 5;
    } else if (currentStep === 3) {
      rabbitXRef.current = 8;
      tortoiseXRef.current = 0;
    } else if (currentStep >= 4) {
      rabbitXRef.current = 88;
      tortoiseXRef.current = 96;
    }

    setTimeout(() => {
      paintRabbit(rabbitXRef.current, currentStep === 2);
      paintTortoise(tortoiseXRef.current);
    }, 0);
  }, [paintRabbit, paintTortoise]);

  const handleStepChange = useCallback((newStep: number) => {
    setStep(newStep);
    stepRef.current = newStep;

    if (newStep <= 1) {
      rabbitXRef.current = 10;
      tortoiseXRef.current = 5;
    } else if (newStep === 2) {
      rabbitXRef.current = 46;
      tortoiseXRef.current = 5;
    } else if (newStep === 3) {
      rabbitXRef.current = 8;
      tortoiseXRef.current = 0;
    } else if (newStep >= 4) {
      rabbitXRef.current = 88;
      tortoiseXRef.current = 96;
    }

    setTimeout(() => {
      paintRabbit(rabbitXRef.current, newStep === 2);
      paintTortoise(tortoiseXRef.current);
    }, 0);
  }, [paintRabbit, paintTortoise]);

  // MediaPipe hands results callback
  const renderShadow = useCallback((result: HandsResult) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    if (!maskRef.current) maskRef.current = document.createElement('canvas');
    if (!mergedRef.current) mergedRef.current = document.createElement('canvas');
    const mask = maskRef.current;
    const merged = mergedRef.current;
    const maskWidth = Math.round(width * MB_SCALE);
    const maskHeight = Math.round(height * MB_SCALE);
    if (mask.width !== maskWidth || mask.height !== maskHeight) {
      mask.width = maskWidth;
      mask.height = maskHeight;
      merged.width = maskWidth;
      merged.height = maskHeight;
    }

    const ctx = canvas.getContext('2d');
    const maskCtx = mask.getContext('2d');
    const mergedCtx = merged.getContext('2d', { willReadFrequently: true });
    if (!ctx || !maskCtx || !mergedCtx) return;

    ctx.clearRect(0, 0, width, height);
    maskCtx.clearRect(0, 0, maskWidth, maskHeight);
    const hands = result.multiHandLandmarks ?? [];
    const handedness = result.multiHandedness ?? [];

    if (!hands.length) {
      trackingRef.current = { hasHand: false, centroid: null };
      setStatus('Show your hand to the camera');
      setState('idle');
      return;
    }

    const hand = hands[0];
    const centroid = hand[9];

    trackingRef.current = {
      hasHand: true,
      centroid,
    };

    let scale = 1;
    const now = performance.now();
    const tuningNow = DEFAULT_TUNING;
    for (let index = 0; index < hands.length; index += 1) {
      const key = handedness[index]?.label ?? `hand-${index}`;
      scale = Math.max(scale, drawHandMask(maskCtx, hands[index], maskWidth, maskHeight, key, now, filterRef.current, tuningNow));
    }

    mergedCtx.clearRect(0, 0, maskWidth, maskHeight);
    mergedCtx.save();
    mergedCtx.filter = `blur(${Math.max(0.5, scale * tuningNow.mergeBlur)}px)`;
    mergedCtx.drawImage(mask, 0, 0);
    mergedCtx.restore();

    const image = mergedCtx.getImageData(0, 0, maskWidth, maskHeight);
    const data = image.data;
    for (let i = 3; i < data.length; i += 4) {
      data[i] = data[i] >= tuningNow.mergeThreshold ? 255 : 0;
    }
    mergedCtx.putImageData(image, 0, 0);

    ctx.save();
    ctx.globalAlpha = SHADOW_DARKNESS;
    ctx.filter = `blur(${tuningNow.edgeBlur}px)`;
    ctx.translate(width / 2 + LIGHT_OFFSET, height / 2 + LIGHT_OFFSET * 0.7);
    ctx.scale(SHADOW_SIZE, SHADOW_SIZE);
    ctx.translate(-width / 2, -height / 2);
    ctx.drawImage(merged, 0, 0, width, height);
    ctx.restore();

    setStatus(`${hands.length} hand(s) - Shadow active`);
    setState('ready');
  }, []);

  const startCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !window.Hands || !window.Camera) return;
    setError('');

    if (location.protocol === 'file:' || !window.isSecureContext) {
      setError('Camera needs localhost or HTTPS. Please run npm run dev.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      });
      video.srcObject = stream;
      await video.play();

      const hands = new window.Hands({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`,
      });
      hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.55, minTrackingConfidence: 0.45 });
      hands.onResults(renderShadow);

      const camera = new window.Camera(video, {
        onFrame: async () => { await hands.send({ image: video }); },
        width: 1280,
        height: 720,
      });
      camera.start();
      setStarted(true);
      setStatus('Show your hand to the camera');
      setState('idle');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Camera failed to start';
      setError(message);
    }
  }, [renderShadow]);

  // Main game loop
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const track = trackingRef.current;
      const currentStep = stepRef.current;

      // ── Home: touch the Start Story button with the detected hand ────────
      if (currentStep === 0) {
        if (track.hasHand && track.centroid) {
          const pointerX = (1 - track.centroid.x) * window.innerWidth;
          const pointerY = track.centroid.y * window.innerHeight;

          if (handCursorRef.current) {
            handCursorRef.current.style.display = 'block';
            handCursorRef.current.style.left = `${pointerX}px`;
            handCursorRef.current.style.top = `${pointerY}px`;
          }

          const button = startStoryButtonRef.current;
          if (button) {
            const rect = button.getBoundingClientRect();
            const touchingButton =
              pointerX >= rect.left &&
              pointerX <= rect.right &&
              pointerY >= rect.top &&
              pointerY <= rect.bottom;

            if (touchingButton) {
              button.classList.add('is-touched');
              setStep(1);
              stepRef.current = 1;
              rabbitXRef.current = 10;
              tortoiseXRef.current = 5;
              setTimeout(() => {
                paintRabbit(10);
                paintTortoise(5);
              }, 0);
            } else {
              button.classList.remove('is-touched');
            }
          }
        } else {
          if (handCursorRef.current) handCursorRef.current.style.display = 'none';
          startStoryButtonRef.current?.classList.remove('is-touched');
        }
      }

      // ── Page 1: background 1, hand controls rabbit; tortoise is slower ───
      else if (currentStep === 1) {
        if (handCursorRef.current) handCursorRef.current.style.display = 'none';

        if (track.hasHand && track.centroid) {
          const rawX = 1 - track.centroid.x;
          const normalizedX = Math.max(0, Math.min(1, (rawX - 0.18) / 0.64));
          const targetX = 8 + normalizedX * 86;
          rabbitXRef.current = rabbitXRef.current + (targetX - rabbitXRef.current) * 0.14;
        }

        tortoiseXRef.current = Math.min(tortoiseXRef.current + 2.2 * dt, Math.max(5, rabbitXRef.current - 24));
        paintRabbit(rabbitXRef.current);
        paintTortoise(tortoiseXRef.current);

        if (rabbitXRef.current >= 90) {
          setStep(2);
          stepRef.current = 2;
          rabbitXRef.current = 46;
          tortoiseXRef.current = 5;
          setTimeout(() => {
            paintRabbit(46, true);
            paintTortoise(5);
          }, 0);
        }
      }

      // ── Page 2: background 2, sleeping rabbit fixed; hand presence moves tortoise ──
      else if (currentStep === 2) {
        rabbitXRef.current = 46;
        if (track.hasHand) {
          tortoiseXRef.current = Math.min(92, tortoiseXRef.current + 10 * dt);
        }

        paintRabbit(46, true);
        paintTortoise(tortoiseXRef.current);

        if (tortoiseXRef.current >= 90) {
          setStep(3);
          stepRef.current = 3;
          rabbitXRef.current = 8;
          tortoiseXRef.current = 0;
          setTimeout(() => {
            paintRabbit(8);
          }, 0);
        }
      }

      // ── Page 3: background 3, tortoise is absent; hand controls rabbit ───
      else if (currentStep === 3) {
        if (track.hasHand && track.centroid) {
          const rawX = 1 - track.centroid.x;
          const normalizedX = Math.max(0, Math.min(1, (rawX - 0.18) / 0.64));
          const targetX = 8 + normalizedX * 86;
          rabbitXRef.current = rabbitXRef.current + (targetX - rabbitXRef.current) * 0.14;
        }

        paintRabbit(rabbitXRef.current);

        if (rabbitXRef.current >= 90) {
          setStep(4);
          stepRef.current = 4;
          rabbitXRef.current = 88;
          tortoiseXRef.current = 96;
          setTimeout(() => {
            paintRabbit(88);
            paintTortoise(96);
          }, 0);
        }
      }

      // ── Page 4: background 4, lesson ending ──────────────────────────────
      else if (currentStep === 4) {
        paintRabbit(88);
        paintTortoise(96);
      }

      setHasHand(track.hasHand);
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [paintRabbit, paintTortoise]);

  return (
    <main className="stage">
      {/* Background per step */}
      <img src={BACKGROUNDS[bgIndex]} className="stage-bg" alt="" />

      {started && step > 0 && step !== 3 && (
        <img
          ref={tortoiseSpriteRef}
          src={TORTOISE_RUN}
          className="runner-sprite tortoise-sprite"
          style={{ left: `${tortoiseXRef.current}%` }}
          alt=""
        />
      )}
      {started && step > 0 && (
        <img
          ref={rabbitSpriteRef}
          src={step === 2 ? RABBIT_SLEEP : RABBIT_RUN}
          className="runner-sprite rabbit-sprite"
          style={{ left: `${rabbitXRef.current}%` }}
          alt=""
        />
      )}

      <video ref={videoRef} className="camera" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="shadow-canvas" />
      <div ref={handCursorRef} className="hand-cursor" />

      <header className="topbar">
        <div className="brand">Shadow <span>Play</span></div>
        <div className="status" data-state={state}>
          <span className="status-dot" />
          <span>{status}</span>
        </div>
      </header>

      {!started && (
        <div className="start">
          <section className="start-panel">
            <h1 className="start-title">ShadowPlay</h1>
            <p className="start-copy">Open the camera and turn your hand shadow into the Rabbit in the race.</p>
            <button className="start-button" disabled={state === 'loading'} onClick={startCamera}>
              Start Camera
            </button>
            <p className="error">{error}</p>
          </section>
        </div>
      )}

      {/* Tutorial home: gesture guide overlay */}
      {started && step === 0 && (
        <div className="guide-overlay tutorial-overlay">
          <div className="guide-card">
            <img
              className="gesture-guide-image"
              src={RABBIT_GESTURE_GUIDE}
              alt="Rabbit hand shadow gesture guide"
              onError={(event) => {
                event.currentTarget.src = RABBIT_GESTURE_FALLBACK;
              }}
            />
            <h3 className="guide-title">Rabbit Shadow Gesture</h3>
            <p className="guide-desc">
              Make a rabbit shadow with your hand. When your hand is detected, touch the button to begin.
            </p>
            {hasHand ? (
              <button ref={startStoryButtonRef} className="start-story-button" onClick={() => handleStepChange(1)}>
                Start Story
              </button>
            ) : (
              <p className="guide-hint">Bring your hand into the camera.</p>
            )}
          </div>
        </div>
      )}

      {/* Page 2: hint */}
      {started && step === 2 && (
        <div className="warning-toast" style={{ background: '#4a8c54', borderColor: '#2d6b37' }}>
          Hand detected - the Tortoise moves by itself. Do not control it.
        </div>
      )}

      {/* Right control panel */}
      {started && step > 0 && (
        <div className="interactive-panel">
          <div className="panel-title">
            <span>The Tortoise and the Rabbit</span>
            <span className="step-badge">Page {step} / 4</span>
          </div>

          {step === 1 && (
            <div>
              <div className="section-title">1. The Fast Rabbit</div>
              <p style={{ fontSize: '12px', margin: '0 0 10px 0', color: 'var(--ink)', lineHeight: '1.4' }}>
                The Tortoise is always slower than the Rabbit. Move your hand left and right to run the Rabbit to the far right.
              </p>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="section-title">2. The Rabbit Sleeps</div>
              <p style={{ fontSize: '12px', margin: '0 0 10px 0', color: 'var(--ink)', lineHeight: '1.4' }}>
                The Rabbit sleeps in the middle. When your hand appears, only the Tortoise moves forward by itself.
              </p>
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="section-title">3. The Rabbit Wakes Up</div>
              <p style={{ fontSize: '12px', margin: '0 0 10px 0', color: 'var(--ink)', lineHeight: '1.4' }}>
                The Tortoise is not on this page. Move your hand to control the Rabbit and run to the far right.
              </p>
            </div>
          )}

          {step === 4 && (
            <div>
              <div className="section-title">4. Finish Line</div>
              <p style={{ fontSize: '12px', margin: '0 0 10px 0', color: 'var(--ink)', lineHeight: '1.4' }}>
                The lesson of the race: confidence is good, but patience and steady effort win in the end.
              </p>
              <p style={{ fontSize: '12px', fontWeight: 'bold', color: '#68ae72', textAlign: 'center' }}>
                Slow and steady wins the race.
              </p>
            </div>
          )}

          <div className="nav-controls">
            <button className="btn-secondary" disabled={step === 1} onClick={() => handleStepChange(step - 1)}>
              Previous
            </button>
            <button
              className="btn-primary"
              disabled={step === 4 || step === 1 || step === 2 || step === 3}
              onClick={() => handleStepChange(step + 1)}
            >
              {step === 4 ? 'Done' : 'Next'}
            </button>
          </div>

          <button
            className="btn-secondary"
            style={{ width: '100%', fontSize: '11px', padding: '6px' }}
            onClick={() => handleStepChange(0)}
          >
            Back to Tutorial
          </button>
        </div>
      )}

      {/* Racetrack overlay (story pages) — logic debug visualization */}
      {started && step > 0 && step < 4 && (
        <div className="racetrack-container">
          <div className="racetrack-title">
            <span>
              {step === 1 && 'Move your hand left and right to run the Rabbit'}
              {step === 2 && 'Hand visible = Tortoise auto-runs'}
              {step === 3 && 'Only the Rabbit appears. Move it to the right edge'}
            </span>
            <span className="finish-label">Goal: Right edge</span>
          </div>
          <div className="racetrack">
            <div className="track-line" />
            <div className="finish-line" style={{ right: '10%' }} />

            <div ref={rabbitRef} className="runner" style={{ left: `${rabbitXRef.current}%` }}>
                <img className="runner-avatar-img" src={step === 2 ? RABBIT_SLEEP : RABBIT_RUN} alt="" />
                <span className="runner-label">Rabbit 10%</span>
            </div>

            {step !== 3 && (
              <div ref={tortoiseRef} className="runner" style={{ left: `${tortoiseXRef.current}%` }}>
                <img className="runner-avatar-img" src={TORTOISE_RUN} alt="" />
                <span className="runner-label">Tortoise 5%</span>
              </div>
            )}
          </div>
        </div>
      )}

    </main>
  );
}
