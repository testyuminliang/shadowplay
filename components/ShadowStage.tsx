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

// Tortoise static position per background (null = not shown).
// left/bottom/width are CSS percentage strings.
const TORTOISE_POS: (React.CSSProperties | null)[] = [
  { left: '6%',  bottom: '24%', width: '18%' }, // bg1 — race start (far behind)
  null,                                           // bg2 — sleep scene
  { left: '32%', bottom: '24%', width: '20%' }, // bg3 — tortoise mid-path
  { left: '58%', bottom: '24%', width: '20%' }, // bg4 — finish, tortoise wins
];

// Rabbit config per background.
// fixedLeft = undefined  →  hand controls horizontal position
// fixedLeft = string     →  static position (e.g. sleeping)
type RabbitCfg = { src: string; bottom: string; width: string; fixedLeft?: string };
const RABBIT_CFG: (RabbitCfg | null)[] = [
  { src: '/兔子奔跑-removebg-preview.png', bottom: '24%', width: '26%' },               // bg1: hand-controlled
  { src: '/兔子睡觉-removebg-preview.png', bottom: '22%', width: '22%', fixedLeft: '38%' }, // bg2: static sleep
  null,                                                                                    // bg3: no rabbit
  { src: '/兔子奔跑-removebg-preview.png', bottom: '24%', width: '24%', fixedLeft: '32%' }, // bg4: static finish
];

// Horizontal range the rabbit can move across (as % of screen width).
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

export default function ShadowStage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const mergedRef = useRef<HTMLCanvasElement | null>(null);
  const filterRef = useRef<Map<string, OneEuro>>(new Map());
  const tuningRef = useRef<ShadowTuning>(DEFAULT_TUNING);
  const rabbitRef = useRef<HTMLImageElement>(null);
  const bgIndexRef = useRef(0);
  const [status, setStatus] = useState('加载模型中...');
  const [state, setState] = useState<'loading' | 'idle' | 'ready'>('loading');
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');
  const [tuning, setTuning] = useState<ShadowTuning>(DEFAULT_TUNING);
  const [bgIndex, setBgIndex] = useState(0);

  // Keep bgIndexRef in sync so renderShadow (a stable callback) can read it.
  useEffect(() => { bgIndexRef.current = bgIndex; }, [bgIndex]);

  const updateTuning = useCallback((key: keyof ShadowTuning, value: number) => {
    setTuning((current) => {
      const next = { ...current, [key]: value };
      tuningRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await SCRIPT_URLS.reduce((chain, src) => chain.then(() => loadScript(src)), Promise.resolve());
        if (!cancelled) {
          setState('idle');
          setStatus('准备就绪');
        }
      } catch {
        if (!cancelled) {
          setState('idle');
          setStatus('模型加载失败');
          setError('MediaPipe 加载失败，请检查网络后刷新。');
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

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
      setStatus('把手伸到镜头前');
      setState('idle');
      return;
    }

    let scale = 1;
    const now = performance.now();
    const tuningNow = tuningRef.current;
    for (let index = 0; index < hands.length; index += 1) {
      const key = handedness[index]?.label ?? `hand-${index}`;
      scale = Math.max(
        scale,
        drawHandMask(maskCtx, hands[index], maskWidth, maskHeight, key, now, filterRef.current, tuningNow),
      );
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

    // Drive rabbit position from wrist X on hand-controlled backgrounds.
    const rabbitCfg = RABBIT_CFG[bgIndexRef.current];
    if (rabbitCfg && !rabbitCfg.fixedLeft && rabbitRef.current) {
      // MediaPipe X is in original (unmirrored) camera space; mirror it to match
      // the canvas's scaleX(-1) so the rabbit follows the visible shadow.
      const rawX = 1 - hands[0][0].x;
      let filter = filterRef.current.get('rabbit:x');
      if (!filter) { filter = new OneEuro(); filterRef.current.set('rabbit:x', filter); }
      const smoothX = filter.filter(rawX, now);
      const leftPct = RABBIT_LEFT_MIN + smoothX * (RABBIT_LEFT_MAX - RABBIT_LEFT_MIN);
      rabbitRef.current.style.left = `${leftPct.toFixed(2)}%`;
    }
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
      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.55,
        minTrackingConfidence: 0.45,
      });
      hands.onResults(renderShadow);

      const camera = new window.Camera(video, {
        onFrame: async () => {
          await hands.send({ image: video });
        },
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

  return (
    <main className="stage">
      <img src={BACKGROUNDS[bgIndex]} className="stage-bg" alt="" />

      {/* Tortoise — static NPC */}
      {TORTOISE_POS[bgIndex] && (
        <img src="/乌龟奔跑-removebg-preview.png" className="stage-sprite" style={TORTOISE_POS[bgIndex]!} alt="" />
      )}

      {/* Rabbit — hand-controlled left on bg1, static elsewhere */}
      {RABBIT_CFG[bgIndex] && (
        <img
          ref={rabbitRef}
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
        <div className="brand">
          Shadow <span>Play</span>
        </div>
        <div className="status" data-state={state}>
          <span className="status-dot" />
          <span>{status}</span>
        </div>
        <button
          className="bg-next-btn"
          onClick={() => setBgIndex((i) => (i + 1) % BACKGROUNDS.length)}
          title="Switch background"
        >
          {bgIndex + 1} / {BACKGROUNDS.length} &nbsp;›
        </button>
      </header>

      {!started && (
        <div className="start">
          <section className="start-panel">
            <h1 className="start-title">ShadowPlay</h1>
            <p className="start-copy">打开摄像头，把手影投到墙面上。这里先保留最核心的识别和呈现框架。</p>
            <button className="start-button" disabled={state === 'loading'} onClick={startCamera}>
              开启摄像头
            </button>
            <p className="error">{error}</p>
          </section>
        </div>
      )}

      {started && (
        <section className="tuning-panel" aria-label="手影参数">
          <TuneSlider
            label="手指粗细"
            value={tuning.thickness}
            min={0.65}
            max={1.35}
            step={0.01}
            display={tuning.thickness.toFixed(2)}
            onChange={(value) => updateTuning('thickness', value)}
          />
          <TuneSlider
            label="指尖大小"
            value={tuning.tipScale}
            min={0}
            max={1.8}
            step={0.01}
            display={tuning.tipScale.toFixed(2)}
            onChange={(value) => updateTuning('tipScale', value)}
          />
          <TuneSlider
            label="融合阈值"
            value={tuning.mergeThreshold}
            min={40}
            max={130}
            step={1}
            display={String(tuning.mergeThreshold)}
            onChange={(value) => updateTuning('mergeThreshold', value)}
          />
          <TuneSlider
            label="融合强度"
            value={tuning.mergeBlur}
            min={0.015}
            max={0.075}
            step={0.001}
            display={tuning.mergeBlur.toFixed(3)}
            onChange={(value) => updateTuning('mergeBlur', value)}
          />
          <TuneSlider
            label="边缘柔化"
            value={tuning.edgeBlur}
            min={0}
            max={8}
            step={0.1}
            display={tuning.edgeBlur.toFixed(1)}
            onChange={(value) => updateTuning('edgeBlur', value)}
          />
        </section>
      )}
    </main>
  );
}

function TuneSlider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="tune">
      <span className="tune-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="tune-value">{display}</span>
    </label>
  );
}
