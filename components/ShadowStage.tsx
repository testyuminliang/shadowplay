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

const TORTOISE_POS: (React.CSSProperties | null)[] = [
  { left: '6%',  bottom: '24%', width: '18%' },
  null,
  { left: '32%', bottom: '24%', width: '20%' },
  { left: '58%', bottom: '24%', width: '20%' },
];

type RabbitCfg = { src: string; bottom: string; width: string; fixedLeft?: string };
const RABBIT_CFG: (RabbitCfg | null)[] = [
  { src: '/兔子奔跑-removebg-preview.png', bottom: '24%', width: '26%' },
  { src: '/兔子睡觉-removebg-preview.png', bottom: '22%', width: '22%', fixedLeft: '38%' },
  null,
  { src: '/兔子奔跑-removebg-preview.png', bottom: '24%', width: '24%', fixedLeft: '32%' },
];

const RABBIT_LEFT_MIN = 5;
const RABBIT_LEFT_MAX = 72;

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

const dist = (p1: Landmark, p2: Landmark) => {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
};

export default function ShadowStage() {
  // Canvas / video refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const mergedRef = useRef<HTMLCanvasElement | null>(null);
  const filterRef = useRef<Map<string, OneEuro>>(new Map());
  const tuningRef = useRef<ShadowTuning>(DEFAULT_TUNING);

  // MediaPipe / UI state
  const [status, setStatus] = useState('加载模型中...');
  const [state, setState] = useState<'loading' | 'idle' | 'ready'>('loading');
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');
  const [tuning, setTuning] = useState<ShadowTuning>(DEFAULT_TUNING);

  // Background / sprite state (from wan branch)
  const [bgIndex, setBgIndex] = useState(0);
  const bgIndexRef = useRef(0);
  useEffect(() => { bgIndexRef.current = bgIndex; }, [bgIndex]);

  // Story state
  const [step, setStep] = useState<number>(1);
  const [playerRole, setPlayerRole] = useState<'rabbit' | 'tortoise'>('rabbit');
  const [hasHand, setHasHand] = useState(false);
  const [showWarning, setShowWarning] = useState(false);

  // DOM refs for direct high-frequency style updates (bypasses React re-renders)
  const rabbitRef = useRef<HTMLDivElement>(null);
  const tortoiseRef = useRef<HTMLDivElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressTextRef = useRef<HTMLSpanElement>(null);

  // Refs for rAF tick — prevents stale closures
  const stepRef = useRef(1);
  const playerRoleRef = useRef<'rabbit' | 'tortoise'>('rabbit');
  const rabbitXRef = useRef(10);
  const tortoiseXRef = useRef(5);
  const matchDurationRef = useRef(0);

  const trackingRef = useRef<{
    hasHand: boolean;
    fingerState: [boolean, boolean, boolean, boolean, boolean];
    centroid: Landmark | null;
  }>({
    hasHand: false,
    fingerState: [false, false, false, false, false],
    centroid: null,
  });

  // Keep step/role refs in sync
  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => { playerRoleRef.current = playerRole; }, [playerRole]);

  // Sync background image with story step
  useEffect(() => {
    if (step <= 2) setBgIndex(0);
    else if (step === 3) setBgIndex(1);
    else if (step === 4) setBgIndex(2);
    else setBgIndex(3);
  }, [step]);

  const updateTuning = useCallback((key: keyof ShadowTuning, value: number) => {
    setTuning((current) => {
      const next = { ...current, [key]: value };
      tuningRef.current = next;
      return next;
    });
  }, []);

  // Load MediaPipe scripts
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        await SCRIPT_URLS.reduce((chain, src) => chain.then(() => loadScript(src)), Promise.resolve());
        if (!cancelled) { setState('idle'); setStatus('准备就绪'); }
      } catch {
        if (!cancelled) { setState('idle'); setStatus('模型加载失败'); setError('MediaPipe 加载失败，请检查网络后刷新。'); }
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  const resetRace = useCallback(() => {
    const currentStep = stepRef.current;

    if (currentStep === 2) {
      rabbitXRef.current = 10;
      tortoiseXRef.current = 5;
    } else if (currentStep === 3) {
      tortoiseXRef.current = 5;
    } else if (currentStep === 4) {
      rabbitXRef.current = 90;
      tortoiseXRef.current = 90;
    } else if (currentStep === 5) {
      rabbitXRef.current = 90;
      tortoiseXRef.current = 95;
    }

    setShowWarning(false);

    setTimeout(() => {
      if (currentStep >= 2 && currentStep !== 3) {
        if (rabbitRef.current) {
          rabbitRef.current.style.left = `${rabbitXRef.current}%`;
          const label = rabbitRef.current.querySelector('.runner-label');
          if (label) label.textContent = `Rabbit ${rabbitXRef.current}%${currentStep >= 3 ? ' (Asleep)' : ''}`;
        }
      }
      if (tortoiseRef.current) {
        tortoiseRef.current.style.left = `${tortoiseXRef.current}%`;
        const label = tortoiseRef.current.querySelector('.runner-label');
        if (label) label.textContent = `Tortoise ${tortoiseXRef.current}%`;
      }
    }, 0);
  }, []);

  const handleStepChange = useCallback((newStep: number) => {
    setStep(newStep);
    matchDurationRef.current = 0;

    if (newStep === 1) {
      rabbitXRef.current = 10;
      tortoiseXRef.current = 5;
    } else if (newStep === 2) {
      rabbitXRef.current = 10;
      tortoiseXRef.current = 5;
    } else if (newStep === 3) {
      tortoiseXRef.current = 5;
    } else if (newStep === 4) {
      rabbitXRef.current = 90;
      tortoiseXRef.current = 90;
    } else if (newStep === 5) {
      rabbitXRef.current = 90;
      tortoiseXRef.current = 95;
    }

    setTimeout(() => {
      if (newStep === 1) {
        if (progressFillRef.current) progressFillRef.current.style.width = '0%';
        if (progressTextRef.current) progressTextRef.current.textContent = 'Pose hold: 0%';
      } else if (newStep === 2) {
        if (rabbitRef.current) {
          rabbitRef.current.style.left = `${rabbitXRef.current}%`;
          const label = rabbitRef.current.querySelector('.runner-label');
          if (label) label.textContent = `Rabbit ${rabbitXRef.current}%`;
        }
        if (tortoiseRef.current) {
          tortoiseRef.current.style.left = `${tortoiseXRef.current}%`;
          const label = tortoiseRef.current.querySelector('.runner-label');
          if (label) label.textContent = `Tortoise ${tortoiseXRef.current}%`;
        }
      } else if (newStep === 3) {
        if (tortoiseRef.current) {
          tortoiseRef.current.style.left = `${tortoiseXRef.current}%`;
          const label = tortoiseRef.current.querySelector('.runner-label');
          if (label) label.textContent = `Tortoise ${tortoiseXRef.current}%`;
        }
      } else if (newStep >= 4) {
        if (rabbitRef.current) {
          rabbitRef.current.style.left = `${rabbitXRef.current}%`;
          const label = rabbitRef.current.querySelector('.runner-label');
          if (label) label.textContent = `Rabbit ${rabbitXRef.current}% (Asleep)`;
        }
        if (tortoiseRef.current) {
          tortoiseRef.current.style.left = `${tortoiseXRef.current}%`;
          const label = tortoiseRef.current.querySelector('.runner-label');
          if (label) label.textContent = `Tortoise ${tortoiseXRef.current}%`;
        }
      }
    }, 0);
  }, []);

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
      trackingRef.current = { hasHand: false, fingerState: [false, false, false, false, false], centroid: null };
      setStatus('把手伸到镜头前');
      setState('idle');
      return;
    }

    const hand = hands[0];
    const centroid = hand[9];

    const indexExt  = hand[8].y  < hand[6].y  - 0.01;
    const middleExt = hand[12].y < hand[10].y - 0.01;
    const ringExt   = hand[16].y < hand[14].y - 0.01;
    const pinkyExt  = hand[20].y < hand[18].y - 0.01;

    const palmCx = hand[9];
    const thumbExt = dist(hand[4], palmCx) > dist(hand[3], palmCx) * 1.04;

    trackingRef.current = {
      hasHand: true,
      fingerState: [thumbExt, indexExt, middleExt, ringExt, pinkyExt],
      centroid,
    };

    let scale = 1;
    const now = performance.now();
    const tuningNow = tuningRef.current;
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

    setStatus(`${hands.length} 只手 - 影子已生成`);
    setState('ready');
  }, []);

  const startCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !window.Hands || !window.Camera) return;
    setError('');

    if (location.protocol === 'file:' || !window.isSecureContext) {
      setError('摄像头需要 localhost 或 HTTPS。请使用 npm run dev 打开本地页面。');
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
      setStatus('把手伸到镜头前');
      setState('idle');
    } catch (err) {
      const message = err instanceof Error ? err.message : '摄像头启动失败';
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
      const currentRole = playerRoleRef.current;

      const [, indexExt, middleExt, ringExt, pinkyExt] = track.fingerState;
      let isMatching = false;
      if (track.hasHand) {
        if (currentRole === 'rabbit') {
          isMatching = indexExt && middleExt && !ringExt && !pinkyExt;
        } else {
          isMatching = indexExt && middleExt && ringExt && pinkyExt;
        }
      }

      // ── Step 1: pose detection ───────────────────────────────────────────
      if (currentStep === 1) {
        if (track.hasHand && isMatching) {
          matchDurationRef.current = Math.min(800, matchDurationRef.current + dt * 1000);
          if (matchDurationRef.current >= 800) {
            setStep(2);
            stepRef.current = 2;
            rabbitXRef.current = 10;
            tortoiseXRef.current = 5;
            matchDurationRef.current = 0;
            setTimeout(() => {
              if (rabbitRef.current) rabbitRef.current.style.left = '10%';
              if (tortoiseRef.current) tortoiseRef.current.style.left = '5%';
            }, 0);
          }
        } else {
          matchDurationRef.current = Math.max(0, matchDurationRef.current - dt * 1000);
        }
        const pct = Math.min(100, Math.round((matchDurationRef.current / 800) * 100));
        if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`;
        if (progressTextRef.current) progressTextRef.current.textContent = `Pose hold: ${pct}%`;
      }

      // ── Step 2: race ─────────────────────────────────────────────────────
      else if (currentStep === 2) {
        setShowWarning(!isMatching && track.hasHand);

        if (rabbitXRef.current < 90) {
          const tortoiseSpeed = 3.5;
          const rabbitSpeed = 4.2;

          if (currentRole === 'rabbit') {
            if (track.hasHand && track.centroid) {
              const rawX = 1 - track.centroid.x;
              const normalizedX = Math.max(0, Math.min(1, (rawX - 0.2) / 0.6));
              // Target overshoots to 96% so lerp can cross the 90% threshold
              const targetX = 10 + normalizedX * 86;
              rabbitXRef.current = rabbitXRef.current + (targetX - rabbitXRef.current) * 0.12;
            }
            const nextTX = tortoiseXRef.current + tortoiseSpeed * dt;
            tortoiseXRef.current = Math.min(nextTX, Math.max(5, rabbitXRef.current - 12));
          } else {
            if (track.hasHand && track.centroid) {
              const rawX = 1 - track.centroid.x;
              const normalizedX = Math.max(0, Math.min(1, (rawX - 0.2) / 0.6));
              const targetX = 5 + normalizedX * 85;
              const lerpedTX = tortoiseXRef.current + (targetX - tortoiseXRef.current) * 0.12;
              tortoiseXRef.current = Math.min(lerpedTX, Math.max(5, rabbitXRef.current - 12));
            }
            rabbitXRef.current = Math.min(90, rabbitXRef.current + rabbitSpeed * dt);
          }

          const rx = Math.round(rabbitXRef.current);
          const tx = Math.round(tortoiseXRef.current);
          if (rabbitRef.current) {
            rabbitRef.current.style.left = `${rx}%`;
            const label = rabbitRef.current.querySelector('.runner-label');
            if (label) label.textContent = `Rabbit ${rx}%`;
          }
          if (tortoiseRef.current) {
            tortoiseRef.current.style.left = `${tx}%`;
            const label = tortoiseRef.current.querySelector('.runner-label');
            if (label) label.textContent = `Tortoise ${tx}%`;
          }

          // Rabbit reaches far right → advance to step 3, no need to wait for tortoise
          if (rabbitXRef.current >= 90) {
            setStep(3);
            stepRef.current = 3;
            rabbitXRef.current = 90;
            tortoiseXRef.current = Math.min(tortoiseXRef.current, 78);
            matchDurationRef.current = 0;
            setTimeout(() => {
              if (tortoiseRef.current) {
                const tx2 = Math.round(tortoiseXRef.current);
                tortoiseRef.current.style.left = `${tx2}%`;
                const label = tortoiseRef.current.querySelector('.runner-label');
                if (label) label.textContent = `Tortoise ${tx2}%`;
              }
            }, 0);
          }
        }
      }

      // ── Step 3: tortoise auto-advances when hand detected, rabbit is fixed ──
      else if (currentStep === 3) {
        if (track.hasHand) {
          // Tortoise moves automatically — not hand-position controlled
          tortoiseXRef.current = Math.min(90, tortoiseXRef.current + 12 * dt);
        }

        if (tortoiseRef.current) {
          const tx = Math.round(tortoiseXRef.current);
          tortoiseRef.current.style.left = `${tx}%`;
          const label = tortoiseRef.current.querySelector('.runner-label');
          if (label) label.textContent = `Tortoise ${tx}%`;
        }

        // Tortoise reaches far right → step 4
        if (tortoiseXRef.current >= 90) {
          setStep(4);
          stepRef.current = 4;
          tortoiseXRef.current = 90;
          setTimeout(() => {
            if (tortoiseRef.current) tortoiseRef.current.style.left = '90%';
          }, 0);
        }
      }

      // ── Step 4: tortoise steadily walks to finish ────────────────────────
      else if (currentStep === 4) {
        if (currentRole === 'rabbit') {
          tortoiseXRef.current = Math.min(95, tortoiseXRef.current + 3.0 * dt);
        } else {
          if (track.hasHand && track.centroid) {
            const rawX = 1 - track.centroid.x;
            const normalizedX = Math.max(0, Math.min(1, (rawX - 0.2) / 0.6));
            const targetX = 90 + normalizedX * 5;
            tortoiseXRef.current = tortoiseXRef.current + (targetX - tortoiseXRef.current) * 0.12;
          }
        }

        if (rabbitRef.current) {
          rabbitRef.current.style.left = '90%';
          const label = rabbitRef.current.querySelector('.runner-label');
          if (label) label.textContent = `Rabbit 90% (Asleep)`;
        }
        if (tortoiseRef.current) {
          const tx = Math.round(tortoiseXRef.current);
          tortoiseRef.current.style.left = `${tx}%`;
          const label = tortoiseRef.current.querySelector('.runner-label');
          if (label) label.textContent = `Tortoise ${tx}%`;
        }

        if (tortoiseXRef.current >= 95) {
          setStep(5);
          stepRef.current = 5;
          setTimeout(() => {
            if (rabbitRef.current) rabbitRef.current.style.left = '90%';
            if (tortoiseRef.current) {
              tortoiseRef.current.style.left = '95%';
              const label = tortoiseRef.current.querySelector('.runner-label');
              if (label) label.textContent = `Tortoise 95%`;
            }
          }, 0);
        }
      }

      setHasHand(track.hasHand);
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <main className="stage">
      {/* Background per step */}
      <img src={BACKGROUNDS[bgIndex]} className="stage-bg" alt="" />

      {/* Tortoise static sprite (steps 1, 4, 5) */}
      {TORTOISE_POS[bgIndex] && (
        <img src="/乌龟奔跑-removebg-preview.png" className="stage-sprite" style={TORTOISE_POS[bgIndex]!} alt="" />
      )}

      {/* Rabbit sprite — hand-controlled on step 2 (bg1), static elsewhere */}
      {RABBIT_CFG[bgIndex] && (
        <img
          src={RABBIT_CFG[bgIndex]!.src}
          className="stage-sprite"
          style={{
            bottom: RABBIT_CFG[bgIndex]!.bottom,
            width:  RABBIT_CFG[bgIndex]!.width,
            left:   RABBIT_CFG[bgIndex]!.fixedLeft ?? '40%',
          }}
          alt=""
        />
      )}

      <video ref={videoRef} className="camera" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="shadow-canvas" />

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
            <p className="start-copy">打开摄像头，把手影投到墙面上。</p>
            <button className="start-button" disabled={state === 'loading'} onClick={startCamera}>
              开启摄像头
            </button>
            <p className="error">{error}</p>
          </section>
        </div>
      )}

      {/* Step 1: gesture guide overlay */}
      {started && step === 1 && (
        <div className={`guide-overlay ${hasHand ? 'hidden' : ''}`}>
          <div className="guide-card">
            <div className="guide-emoji">{playerRole === 'rabbit' ? '🐰' : '🐢'}</div>
            <h3 className="guide-title">{playerRole === 'rabbit' ? 'Rabbit Gesture Guide' : 'Tortoise Gesture Guide'}</h3>
            <p className="guide-desc">
              {playerRole === 'rabbit'
                ? 'Stretch Index & Middle fingers up, keep Ring & Pinky curled.'
                : 'Stretch Index, Middle, Ring and Pinky flat.'}
            </p>
            <p style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 'bold', margin: '4px 0 0 0' }}>
              Bring your hand to the camera to see your shadow.
            </p>
          </div>
        </div>
      )}

      {/* Step 3: hint */}
      {started && step === 3 && (
        <div className="warning-toast" style={{ background: '#4a8c54', borderColor: '#2d6b37' }}>
          🐢 Move your hand in front of camera — Tortoise advances automatically!
        </div>
      )}

      {/* Step 2: pose warning */}
      {started && step === 2 && showWarning && (
        <div className="warning-toast">
          ⚠️ Pose lost! Maintain {playerRole === 'rabbit' ? 'Rabbit 🐰' : 'Tortoise 🐢'} gesture shape
        </div>
      )}

      {/* Right control panel */}
      {started && (
        <div className="interactive-panel">
          <div className="panel-title">
            <span>Story Logic Control</span>
            <span className="step-badge">Step {step} / 5</span>
          </div>

          <div className="perspective-selector">
            <button
              className={`role-btn ${playerRole === 'rabbit' ? 'active' : ''}`}
              onClick={() => { setPlayerRole('rabbit'); resetRace(); }}
            >
              🐰 Rabbit View
            </button>
            <button
              className={`role-btn ${playerRole === 'tortoise' ? 'active' : ''}`}
              onClick={() => { setPlayerRole('tortoise'); resetRace(); }}
            >
              🐢 Tortoise View
            </button>
          </div>

          {step === 1 && (
            <div className="match-status-bar">
              <span ref={progressTextRef} style={{ fontSize: '12px', fontWeight: 'bold' }}>Pose hold: 0%</span>
              <div className="progress-bar-bg">
                <div ref={progressFillRef} className="progress-bar-fill" style={{ width: '0%' }} />
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="section-title">3. Decision to Sleep Page</div>
              <p style={{ fontSize: '12px', margin: '0 0 10px 0', color: 'var(--ink)', lineHeight: '1.4' }}>
                Rabbit is sleeping. Show your hand to make the Tortoise advance!
              </p>
              <p style={{ fontSize: '11px', color: '#4a8c54', fontWeight: 'bold', margin: 0 }}>
                🐢 Tortoise auto-moves when hand detected.
              </p>
            </div>
          )}

          {step === 4 && (
            <div>
              <div className="section-title">4. Tortoise Steady Walk</div>
              <p style={{ fontSize: '12px', margin: '0 0 10px 0', color: 'var(--ink)', lineHeight: '1.4' }}>
                {playerRole === 'rabbit'
                  ? 'Rabbit is asleep. The Tortoise crawls past and heads to the finish line!'
                  : 'Rabbit is asleep. Move hand left/right to crawl Tortoise to the finish line.'}
              </p>
              <div style={{ textAlign: 'center', fontSize: '24px', margin: '8px 0' }}>🐢💨 ... 🐰💤</div>
            </div>
          )}

          {step === 5 && (
            <div>
              <div className="section-title">5. Finish Line Page</div>
              <p style={{ fontSize: '12px', margin: '0 0 10px 0', color: 'var(--ink)', lineHeight: '1.4' }}>
                The Tortoise wins the race! The Rabbit woke up too late.
              </p>
              <div style={{ textAlign: 'center', fontSize: '32px', margin: '12px 0' }}>🐢🏆 🐰😢</div>
              <p style={{ fontSize: '12px', fontWeight: 'bold', color: '#68ae72', textAlign: 'center' }}>
                Story Completed!
              </p>
            </div>
          )}

          <div className="nav-controls">
            <button className="btn-secondary" disabled={step === 1} onClick={() => handleStepChange(step - 1)}>
              Prev Step
            </button>
            <button
              className="btn-primary"
              disabled={step === 5 || step === 2 || step === 3}
              onClick={() => handleStepChange(step + 1)}
            >
              {step === 5 ? 'Done' : 'Next Step'}
            </button>
          </div>

          <button
            className="btn-secondary"
            style={{ width: '100%', fontSize: '11px', padding: '6px' }}
            onClick={() => handleStepChange(1)}
          >
            Restart Story
          </button>
        </div>
      )}

      {/* Racetrack overlay (steps 2, 3, 4) — logic debug visualization */}
      {started && (step === 2 || step === 3 || step === 4) && (
        <div className="racetrack-container">
          <div className="racetrack-title">
            <span>
              {step === 2 && `Racetrack (Move hand left/right to control ${playerRole === 'rabbit' ? '🐰' : '🐢'})`}
              {step === 3 && 'Tortoise is catching up (hand detected = auto-advance)'}
              {step === 4 && (playerRole === 'rabbit' ? 'Tortoise is advancing steadily' : 'Crawl Tortoise to finish')}
            </span>
            <span className="finish-label">Goal: {step === 4 ? 'Finish' : '90%'}</span>
          </div>
          <div className="racetrack">
            <div className="track-line" />
            <div className="finish-line" style={{ right: step === 4 ? '5%' : '10%' }} />

            {step !== 3 && (
              <div ref={rabbitRef} className="runner" style={{ left: '10%' }}>
                <span className="runner-avatar">🐰</span>
                <span className="runner-label">Rabbit 10%</span>
              </div>
            )}

            <div ref={tortoiseRef} className="runner" style={{ left: step === 3 ? `${tortoiseXRef.current}%` : '5%' }}>
              <span className="runner-avatar">🐢</span>
              <span className="runner-label">Tortoise 5%</span>
            </div>
          </div>
        </div>
      )}

      {started && (
        <section className="tuning-panel" aria-label="手影参数">
          <TuneSlider label="手指粗细" value={tuning.thickness} min={0.65} max={1.35} step={0.01} display={tuning.thickness.toFixed(2)} onChange={(v) => updateTuning('thickness', v)} />
          <TuneSlider label="指尖大小" value={tuning.tipScale} min={0} max={1.8} step={0.01} display={tuning.tipScale.toFixed(2)} onChange={(v) => updateTuning('tipScale', v)} />
          <TuneSlider label="融合阈值" value={tuning.mergeThreshold} min={40} max={130} step={1} display={String(tuning.mergeThreshold)} onChange={(v) => updateTuning('mergeThreshold', v)} />
          <TuneSlider label="融合强度" value={tuning.mergeBlur} min={0.015} max={0.075} step={0.001} display={tuning.mergeBlur.toFixed(3)} onChange={(v) => updateTuning('mergeBlur', v)} />
          <TuneSlider label="边缘柔化" value={tuning.edgeBlur} min={0} max={8} step={0.1} display={tuning.edgeBlur.toFixed(1)} onChange={(v) => updateTuning('edgeBlur', v)} />
        </section>
      )}
    </main>
  );
}

function TuneSlider({
  label, value, min, max, step, display, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; display: string; onChange: (value: number) => void;
}) {
  return (
    <label className="tune">
      <span className="tune-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="tune-value">{display}</span>
    </label>
  );
}
