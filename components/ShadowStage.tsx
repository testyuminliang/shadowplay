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

const SCRIPT_URLS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3/camera_utils.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js',
];

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
  [3, 4, 0.105],
  [5, 6, 0.13],
  [6, 7, 0.116],
  [7, 8, 0.098],
  [9, 10, 0.13],
  [10, 11, 0.116],
  [11, 12, 0.098],
  [13, 14, 0.12],
  [14, 15, 0.106],
  [15, 16, 0.09],
  [17, 18, 0.11],
  [18, 19, 0.096],
  [19, 20, 0.08],
];
const JOINTS: Array<[number, number]> = [
  [0, 0.16],
  [1, 0.1],
  [5, 0.116],
  [9, 0.116],
  [13, 0.108],
  [17, 0.1],
];
const TIPS: Array<[number, number]> = [
  [4, 0.052],
  [8, 0.05],
  [12, 0.05],
  [16, 0.046],
  [20, 0.042],
];

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
) {
  const points = landmarks.map((point) => ({ x: point.x * width, y: point.y * height }));
  const palmSpan = Math.hypot(points[9].x - points[0].x, points[9].y - points[0].y) || 1;
  const palmHull = hull(PALM.map((index) => points[index]));
  const center = palmHull.reduce(
    (sum, point) => ({ x: sum.x + point.x / palmHull.length, y: sum.y + point.y / palmHull.length }),
    { x: 0, y: 0 },
  );

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
    ctx.lineWidth = palmSpan * weight;
    ctx.beginPath();
    ctx.moveTo(points[from].x, points[from].y);
    ctx.lineTo(points[to].x, points[to].y);
    ctx.stroke();
  }

  for (const [index, radius] of JOINTS) {
    ctx.beginPath();
    ctx.arc(points[index].x, points[index].y, palmSpan * radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const [index, radius] of TIPS) {
    ctx.beginPath();
    ctx.arc(points[index].x, points[index].y, palmSpan * radius, 0, Math.PI * 2);
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
  const [status, setStatus] = useState('加载模型中...');
  const [state, setState] = useState<'loading' | 'idle' | 'ready'>('loading');
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');

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
    if (mask.width !== width || mask.height !== height) {
      mask.width = width;
      mask.height = height;
      merged.width = width;
      merged.height = height;
    }

    const ctx = canvas.getContext('2d');
    const maskCtx = mask.getContext('2d');
    const mergedCtx = merged.getContext('2d', { willReadFrequently: true });
    if (!ctx || !maskCtx || !mergedCtx) return;

    ctx.clearRect(0, 0, width, height);
    maskCtx.clearRect(0, 0, width, height);
    const hands = result.multiHandLandmarks ?? [];

    if (!hands.length) {
      setStatus('把手伸到镜头前');
      setState('idle');
      return;
    }

    let scale = 1;
    for (const hand of hands) {
      scale = Math.max(scale, drawHandMask(maskCtx, hand, width, height));
    }

    mergedCtx.clearRect(0, 0, width, height);
    mergedCtx.save();
    mergedCtx.filter = `blur(${Math.max(2, scale * 0.045)}px)`;
    mergedCtx.drawImage(mask, 0, 0);
    mergedCtx.restore();

    const image = mergedCtx.getImageData(0, 0, width, height);
    const data = image.data;
    for (let i = 3; i < data.length; i += 4) {
      data[i] = data[i] > 86 ? 255 : 0;
    }
    mergedCtx.putImageData(image, 0, 0);

    ctx.save();
    ctx.globalAlpha = 0.86;
    ctx.filter = 'blur(3px)';
    const offset = Math.max(16, scale * 0.16);
    ctx.translate(width / 2 + offset, height / 2 + offset * 0.66);
    ctx.scale(1.16, 1.16);
    ctx.translate(-width / 2, -height / 2);
    ctx.drawImage(merged, 0, 0);
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
    </main>
  );
}
