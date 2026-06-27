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

type Locale = 'en' | 'zh';
type StatusKey = 'loading' | 'ready' | 'modelFailed' | 'showHand' | 'shadowReady';
type ErrorKey = 'modelLoadFailed' | 'insecureContext' | 'cameraFailed';

const COPY = {
  en: {
    status: {
      loading: 'Loading model...',
      ready: 'Ready',
      modelFailed: 'Model failed to load',
      showHand: 'Show your hand to the camera',
      shadowReady: (count: number) => `${count} hand${count === 1 ? '' : 's'} - shadow ready`,
    },
    error: {
      modelLoadFailed: 'MediaPipe failed to load. Check your network and refresh.',
      insecureContext: 'Camera access requires localhost or HTTPS. Open the app with npm run dev.',
      cameraFailed: 'Camera failed to start',
    },
    startCopy: 'Turn on the camera and cast your hand shadow onto the wall. This build keeps the core tracking stage ready for gameplay.',
    startButton: 'Start Camera',
    languageName: 'English',
    switchLanguage: 'Switch language',
  },
  zh: {
    status: {
      loading: '加载模型中...',
      ready: '准备就绪',
      modelFailed: '模型加载失败',
      showHand: '把手伸到镜头前',
      shadowReady: (count: number) => `${count} 只手 - 影子已生成`,
    },
    error: {
      modelLoadFailed: 'MediaPipe 加载失败，请检查网络后刷新。',
      insecureContext: '摄像头需要 localhost 或 HTTPS。请使用 npm run dev 打开本地页面。',
      cameraFailed: '摄像头启动失败',
    },
    startCopy: '打开摄像头，把手影投到墙面上。这里先保留最核心的识别和呈现框架。',
    startButton: '开启摄像头',
    languageName: '简体中文',
    switchLanguage: '切换语言',
  },
} as const;

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
  const [locale, setLocale] = useState<Locale>('en');
  const [statusKey, setStatusKey] = useState<StatusKey>('loading');
  const [handCount, setHandCount] = useState(0);
  const [state, setState] = useState<'loading' | 'idle' | 'ready'>('loading');
  const [started, setStarted] = useState(false);
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);
  const [errorDetail, setErrorDetail] = useState('');
  const copy = COPY[locale];
  const status =
    statusKey === 'shadowReady' ? copy.status.shadowReady(handCount) : copy.status[statusKey];
  const error = errorKey ? (errorDetail || copy.error[errorKey]) : '';

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await SCRIPT_URLS.reduce((chain, src) => chain.then(() => loadScript(src)), Promise.resolve());
        if (!cancelled) {
          setState('idle');
          setStatusKey('ready');
        }
      } catch {
        if (!cancelled) {
          setState('idle');
          setStatusKey('modelFailed');
          setErrorKey('modelLoadFailed');
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
      setStatusKey('showHand');
      setState('idle');
      return;
    }

    let scale = 1;
    const now = performance.now();
    const tuningNow = DEFAULT_TUNING;
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

    setHandCount(hands.length);
    setStatusKey('shadowReady');
    setState('ready');
  }, []);

  const startCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !window.Hands || !window.Camera) return;
    setErrorKey(null);
    setErrorDetail('');

    if (location.protocol === 'file:' || !window.isSecureContext) {
      setErrorKey('insecureContext');
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
      setStatusKey('showHand');
      setState('idle');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setErrorKey('cameraFailed');
      setErrorDetail(message);
    }
  }, [renderShadow]);

  const toggleLocale = useCallback(() => {
    setLocale((current) => (current === 'en' ? 'zh' : 'en'));
  }, []);

  return (
    <main className="stage">
      <video ref={videoRef} className="camera" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="shadow-canvas" />
      <header className="topbar">
        <div className="brand">
          Shadow <span>Play</span>
        </div>
        <div className="top-actions">
          <button
            className="language-button"
            type="button"
            aria-label={copy.switchLanguage}
            title={copy.switchLanguage}
            onClick={toggleLocale}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="globe-icon">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18" />
              <path d="M12 3c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9" />
              <path d="M12 3c-2.5 2.4-3.8 5.4-3.8 9s1.3 6.6 3.8 9" />
            </svg>
            <span>{locale === 'en' ? 'EN' : '中文'}</span>
          </button>
          <div className="status" data-state={state}>
            <span className="status-dot" />
            <span>{status}</span>
          </div>
        </div>
      </header>

      {!started && (
        <div className="start">
          <section className="start-panel">
            <h1 className="start-title">ShadowPlay</h1>
            <p className="start-copy">{copy.startCopy}</p>
            <button className="start-button" disabled={state === 'loading'} onClick={startCamera}>
              {copy.startButton}
            </button>
            <p className="error">{error}</p>
          </section>
        </div>
      )}

    </main>
  );
}
