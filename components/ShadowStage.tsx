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

// Distance helper
const dist = (p1: Landmark, p2: Landmark) => {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
};

export default function ShadowStage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const mergedRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState('加载模型中...');
  const [state, setState] = useState<'loading' | 'idle' | 'ready'>('loading');
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');

  // Story state
  const [step, setStep] = useState<number>(1);
  const [playerRole, setPlayerRole] = useState<'rabbit' | 'tortoise'>('rabbit');
  const [hasHand, setHasHand] = useState(false);

  // Story action triggers
  const [rabbitAsleep, setRabbitAsleep] = useState(false);
  const [showWarning, setShowWarning] = useState(false);

  // DOM element Refs for high-performance direct styling updates (bypassing React 60fps re-renders)
  const rabbitRef = useRef<HTMLDivElement>(null);
  const tortoiseRef = useRef<HTMLDivElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressTextRef = useRef<HTMLSpanElement>(null);

  // Refs for animation frame ticking to prevent React stale state closures
  const stepRef = useRef(1);
  const playerRoleRef = useRef<'rabbit' | 'tortoise'>('rabbit');
  const rabbitXRef = useRef(10);
  const tortoiseXRef = useRef(5);
  const matchDurationRef = useRef(0); // in ms
  const rabbitAsleepRef = useRef(false);

  const trackingRef = useRef<{
    hasHand: boolean;
    fingerState: [boolean, boolean, boolean, boolean, boolean];
    centroid: Landmark | null;
  }>({
    hasHand: false,
    fingerState: [false, false, false, false, false],
    centroid: null
  });

  // Keep refs synchronized
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    playerRoleRef.current = playerRole;
  }, [playerRole]);

  // Load MediaPipe scripts on load
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

  const resetRace = useCallback(() => {
    const currentStep = stepRef.current;
    
    if (currentStep === 2) {
      rabbitXRef.current = 10;
      tortoiseXRef.current = 5;
    } else if (currentStep === 3) {
      rabbitXRef.current = 60;
      tortoiseXRef.current = 48;
      rabbitAsleepRef.current = false;
      setRabbitAsleep(false);
    } else if (currentStep === 4) {
      rabbitXRef.current = 60;
      tortoiseXRef.current = 60;
    } else if (currentStep === 5) {
      rabbitXRef.current = 60;
      tortoiseXRef.current = 90;
    }

    setShowWarning(false);

    // Allow React to mount step nodes before directly updating style left parameters
    setTimeout(() => {
      if (rabbitRef.current) {
        rabbitRef.current.style.left = `${rabbitXRef.current}%`;
        const label = rabbitRef.current.querySelector('.runner-label');
        const isAsleep = currentStep >= 3;
        if (label) label.textContent = `Rabbit ${rabbitXRef.current}%${isAsleep ? ' (Asleep)' : ''}`;
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
      rabbitXRef.current = 60;
      tortoiseXRef.current = 48;
      rabbitAsleepRef.current = false;
      setRabbitAsleep(false);
    } else if (newStep === 4) {
      rabbitXRef.current = 60;
      tortoiseXRef.current = 60;
    } else if (newStep === 5) {
      rabbitXRef.current = 60;
      tortoiseXRef.current = 90;
    }

    setTimeout(() => {
      if (newStep === 1) {
        if (progressFillRef.current) progressFillRef.current.style.width = '0%';
        if (progressTextRef.current) progressTextRef.current.textContent = 'Pose hold: 0%';
      } else if (newStep >= 2) {
        if (rabbitRef.current) {
          const rx = rabbitXRef.current;
          rabbitRef.current.style.left = `${rx}%`;
          const label = rabbitRef.current.querySelector('.runner-label');
          const isAsleep = newStep >= 3;
          if (label) label.textContent = `Rabbit ${rx}%${isAsleep ? ' (Asleep)' : ''}`;
        }
        if (tortoiseRef.current) {
          const tx = tortoiseXRef.current;
          tortoiseRef.current.style.left = `${tx}%`;
          const label = tortoiseRef.current.querySelector('.runner-label');
          if (label) label.textContent = `Tortoise ${tx}%`;
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
      trackingRef.current = {
        hasHand: false,
        fingerState: [false, false, false, false, false],
        centroid: null
      };
      setStatus('把手伸到镜头前');
      setState('idle');
      return;
    }

    const hand = hands[0];
    const centroid = hand[9]; // MCP joint center

    const indexExt  = hand[8].y  < hand[6].y  - 0.01;
    const middleExt = hand[12].y < hand[10].y - 0.01;
    const ringExt   = hand[16].y < hand[14].y - 0.01;
    const pinkyExt  = hand[20].y < hand[18].y - 0.01;
    
    const palmCx = hand[9];
    const thumbExt = dist(hand[4], palmCx) > dist(hand[3], palmCx) * 1.04;

    trackingRef.current = {
      hasHand: true,
      fingerState: [thumbExt, indexExt, middleExt, ringExt, pinkyExt],
      centroid
    };

    let scale = 1;
    for (const h of hands) {
      scale = Math.max(scale, drawHandMask(maskCtx, h, width, height));
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

  // Main Logic Game Loop
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const track = trackingRef.current;
      const currentStep = stepRef.current;
      const currentRole = playerRoleRef.current;

      // Lenient finger status matches
      const [_, indexExt, middleExt, ringExt, pinkyExt] = track.fingerState;
      let isMatching = false;
      if (track.hasHand) {
        if (currentRole === 'rabbit') {
          // Rabbit matching (Index & Middle UP, Ring & Pinky curled)
          isMatching = indexExt && middleExt && !ringExt && !pinkyExt;
        } else {
          // Tortoise matching (Index, Middle, Ring, Pinky UP)
          isMatching = indexExt && middleExt && ringExt && pinkyExt;
        }
      }

      if (currentStep === 1) {
        if (track.hasHand && isMatching) {
          matchDurationRef.current = Math.min(800, matchDurationRef.current + dt * 1000);
          if (matchDurationRef.current >= 800) {
            // Auto-Transition to Step 2
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
        
        const progressPercent = Math.min(100, Math.round((matchDurationRef.current / 800) * 100));
        if (progressFillRef.current) progressFillRef.current.style.width = `${progressPercent}%`;
        if (progressTextRef.current) progressTextRef.current.textContent = `Pose hold: ${progressPercent}%`;
      } 
      
      else if (currentStep === 2) {
        setShowWarning(!isMatching && track.hasHand);

        if (rabbitXRef.current < 60) {
          const tortoiseSpeed = 3.5;
          const rabbitSpeed = 4.2;

          if (currentRole === 'rabbit') {
            if (track.hasHand && track.centroid) {
              const rawX = 1 - track.centroid.x;
              const normalizedX = Math.max(0, Math.min(1, (rawX - 0.2) / 0.6));
              const targetX = 10 + normalizedX * 50;
              rabbitXRef.current = rabbitXRef.current + (targetX - rabbitXRef.current) * 0.12;
            }
            const nextTortoiseX = tortoiseXRef.current + tortoiseSpeed * dt;
            const maxAllowedTortoiseX = Math.max(5, rabbitXRef.current - 12);
            tortoiseXRef.current = Math.min(nextTortoiseX, maxAllowedTortoiseX);
          } else {
            // Tortoise Role
            if (track.hasHand && track.centroid) {
              const rawX = 1 - track.centroid.x;
              const normalizedX = Math.max(0, Math.min(1, (rawX - 0.2) / 0.6));
              const targetX = 5 + normalizedX * 85;
              const maxAllowedTortoiseX = Math.max(5, rabbitXRef.current - 12);
              const lerpedTortoiseX = tortoiseXRef.current + (targetX - tortoiseXRef.current) * 0.12;
              tortoiseXRef.current = Math.min(lerpedTortoiseX, maxAllowedTortoiseX);
            }
            rabbitXRef.current = Math.min(90, rabbitXRef.current + rabbitSpeed * dt);
          }

          // Direct DOM style updates for runners X positions
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

          // Auto-Transition to Step 3 when Rabbit reaches 60%
          if (rabbitXRef.current >= 60) {
            setStep(3);
            stepRef.current = 3;
            rabbitXRef.current = 60; // Locked at 60%
            tortoiseXRef.current = 48; // Capped at 48% (60 - 12)
            matchDurationRef.current = 0;
            rabbitAsleepRef.current = false;
            setRabbitAsleep(false);

            setTimeout(() => {
              if (rabbitRef.current) {
                rabbitRef.current.style.left = '60%';
                const label = rabbitRef.current.querySelector('.runner-label');
                if (label) label.textContent = `Rabbit 60% (Asleep)`;
              }
              if (tortoiseRef.current) {
                tortoiseRef.current.style.left = '48%';
                const label = tortoiseRef.current.querySelector('.runner-label');
                if (label) label.textContent = `Tortoise 48%`;
              }
            }, 0);
          }
        }
      } 
      
      else if (currentStep === 3) {
        if (currentRole === 'rabbit') {
          // Sleeping gesture match check: fist ✊ (all main fingers folded)
          const isFist = track.hasHand && !indexExt && !middleExt && !ringExt && !pinkyExt;
          setShowWarning(!isFist && track.hasHand);

          if (track.hasHand && isFist) {
            matchDurationRef.current = Math.min(800, matchDurationRef.current + dt * 1000);
            if (matchDurationRef.current >= 800 && !rabbitAsleepRef.current) {
              rabbitAsleepRef.current = true;
              setRabbitAsleep(true);
              matchDurationRef.current = 0;
            }
          } else {
            if (!rabbitAsleepRef.current) {
              matchDurationRef.current = Math.max(0, matchDurationRef.current - dt * 1000);
            }
          }

          // Update Progress DOM elements directly
          const progressPercent = Math.min(100, Math.round((matchDurationRef.current / 800) * 100));
          if (progressFillRef.current) progressFillRef.current.style.width = `${progressPercent}%`;
          if (progressTextRef.current) progressTextRef.current.textContent = `Sleeping pose hold: ${progressPercent}%`;

          // If asleep, Tortoise crawls forward automatically
          if (rabbitAsleepRef.current) {
            const tortoiseSpeed = 2.5;
            tortoiseXRef.current = Math.min(60, tortoiseXRef.current + tortoiseSpeed * dt);
          }
        } else {
          // Tortoise Role: Rabbit sleeps automatically. User controls Tortoise crawls X from 48% to 60%
          rabbitAsleepRef.current = true;
          if (track.hasHand && track.centroid) {
            const rawX = 1 - track.centroid.x;
            const normalizedX = Math.max(0, Math.min(1, (rawX - 0.2) / 0.6));
            const targetX = 48 + normalizedX * 14; 
            tortoiseXRef.current = tortoiseXRef.current + (targetX - tortoiseXRef.current) * 0.12;
          }
        }

        // Direct DOM updates for runners positions
        if (rabbitRef.current) {
          rabbitRef.current.style.left = '60%';
          const label = rabbitRef.current.querySelector('.runner-label');
          if (label) label.textContent = `Rabbit 60% (Asleep)`;
        }
        if (tortoiseRef.current) {
          const tx = Math.round(tortoiseXRef.current);
          tortoiseRef.current.style.left = `${tx}%`;
          const label = tortoiseRef.current.querySelector('.runner-label');
          if (label) label.textContent = `Tortoise ${tx}%`;
        }

        // Auto-Transition to Step 4 when tortoise passes rabbit
        if (tortoiseXRef.current >= 60) {
          setStep(4);
          stepRef.current = 4;
          tortoiseXRef.current = 60;
          setTimeout(() => {
            if (rabbitRef.current) rabbitRef.current.style.left = '60%';
            if (tortoiseRef.current) tortoiseRef.current.style.left = '60%';
          }, 0);
        }
      } 
      
      else if (currentStep === 4) {
        if (currentRole === 'rabbit') {
          // AI Tortoise advances automatically from 60% to 90%
          const tortoiseSpeed = 3.0;
          tortoiseXRef.current = Math.min(90, tortoiseXRef.current + tortoiseSpeed * dt);
        } else {
          // Tortoise Role: User controls Tortoise crawl from 60% to 90%
          if (track.hasHand && track.centroid) {
            const rawX = 1 - track.centroid.x;
            const normalizedX = Math.max(0, Math.min(1, (rawX - 0.2) / 0.6));
            const targetX = 60 + normalizedX * 30; 
            tortoiseXRef.current = tortoiseXRef.current + (targetX - tortoiseXRef.current) * 0.12;
          }
        }

        // Direct DOM updates for runners positions
        if (rabbitRef.current) {
          rabbitRef.current.style.left = '60%';
          const label = rabbitRef.current.querySelector('.runner-label');
          if (label) label.textContent = `Rabbit 60% (Asleep)`;
        }
        if (tortoiseRef.current) {
          const tx = Math.round(tortoiseXRef.current);
          tortoiseRef.current.style.left = `${tx}%`;
          const label = tortoiseRef.current.querySelector('.runner-label');
          if (label) label.textContent = `Tortoise ${tx}%`;
        }

        // Auto-Transition to Step 5 when Tortoise reaches 90%
        if (tortoiseXRef.current >= 90) {
          setStep(5);
          stepRef.current = 5;
          setTimeout(() => {
            if (rabbitRef.current) rabbitRef.current.style.left = '60%';
            if (tortoiseRef.current) {
              tortoiseRef.current.style.left = '90%';
              const label = tortoiseRef.current.querySelector('.runner-label');
              if (label) label.textContent = `Tortoise 90%`;
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
      <video ref={videoRef} className="camera" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="shadow-canvas" />

      {/* Header bar */}
      <header className="topbar">
        <div className="brand">
          Shadow <span>Play</span>
        </div>
        <div className="status" data-state={state}>
          <span className="status-dot" />
          <span>{status}</span>
        </div>
      </header>

      {/* Start screen prompt */}
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

      {/* Step 1 Target Gesture Guidance Overlay - Fades away when user starts mimicking (hand detected) */}
      {started && step === 1 && (
        <div className={`guide-overlay ${hasHand ? 'hidden' : ''}`}>
          <div className="guide-card">
            <div className="guide-emoji">{playerRole === 'rabbit' ? '🐰' : '🐢'}</div>
            <h3 className="guide-title">{playerRole === 'rabbit' ? 'Rabbit Gesture Guide' : 'Tortoise Gesture Guide'}</h3>
            <p className="guide-desc">
              {playerRole === 'rabbit' 
                ? 'Imitate the rabbit shape: stretch Index & Middle fingers up, and keep Ring & Pinky curled.' 
                : 'Imitate the tortoise shape: stretch Index, Middle, Ring and Pinky flat.'}
            </p>
            <p style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 'bold', margin: '4px 0 0 0' }}>
              Bring your hand to the camera to hide this guide and see your shadow.
            </p>
          </div>
        </div>
      )}

      {/* Step 3 Target Sleeping Pose Guidance Overlay */}
      {started && step === 3 && playerRole === 'rabbit' && !rabbitAsleep && (
        <div className={`guide-overlay ${hasHand ? 'hidden' : ''}`}>
          <div className="guide-card">
            <div className="guide-emoji">✊</div>
            <h3 className="guide-title">Rabbit Nap Guide</h3>
            <p className="guide-desc">
              Make a fist ✊ (curl all 4 fingers) to decide to sleep under the tree.
            </p>
            <p style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 'bold', margin: '4px 0 0 0' }}>
              Bring your hand to the camera to see your shadow and trigger the nap.
            </p>
          </div>
        </div>
      )}

      {/* Warning Toast (Step 2 Pose Loss warning) */}
      {started && step === 2 && showWarning && (
        <div className="warning-toast">
          ⚠️ Pose lost! Maintain {playerRole === 'rabbit' ? 'Rabbit 🐰' : 'Tortoise 🐢'} gesture shape
        </div>
      )}

      {/* Warning Toast (Step 3 Fist Loss warning) */}
      {started && step === 3 && playerRole === 'rabbit' && !rabbitAsleep && showWarning && (
        <div className="warning-toast">
          ⚠️ Pose lost! Make a fist ✊ to fall asleep
        </div>
      )}

      {/* Simplified Right Control Panel */}
      {started && (
        <div className="interactive-panel">
          <div className="panel-title">
            <span>Story Logic Control</span>
            <span className="step-badge">Step {step} / 5</span>
          </div>

          {/* Role selection hook (Perspective Switch) */}
          <div className="perspective-selector">
            <button
              className={`role-btn ${playerRole === 'rabbit' ? 'active' : ''}`}
              onClick={() => {
                setPlayerRole('rabbit');
                resetRace();
              }}
            >
              🐰 Rabbit View
            </button>
            <button
              className={`role-btn ${playerRole === 'tortoise' ? 'active' : ''}`}
              onClick={() => {
                setPlayerRole('tortoise');
                resetRace();
              }}
            >
              🐢 Tortoise View
            </button>
          </div>

          {/* Matching status indicator during Step 1 */}
          {step === 1 && (
            <div className="match-status-bar">
              <span ref={progressTextRef} style={{ fontSize: '12px', fontWeight: 'bold' }}>
                Pose hold: 0%
              </span>
              <div className="progress-bar-bg">
                <div ref={progressFillRef} className="progress-bar-fill" style={{ width: '0%' }} />
              </div>
            </div>
          )}

          {/* Step 3 matching status */}
          {step === 3 && (
            <div>
              <div className="section-title">3. Decision to Sleep Page</div>
              <p style={{ fontSize: '12px', margin: '0 0 10px 0', color: 'var(--ink)', lineHeight: '1.4' }}>
                {playerRole === 'rabbit' 
                  ? (rabbitAsleep 
                      ? 'Rabbit has fallen asleep! The Tortoise is catching up automatically...' 
                      : 'Make a fist gesture ✊ to rest under the tree.') 
                  : 'Rabbit is asleep at 60%. Control Tortoise to catch up!'}
              </p>
              
              {playerRole === 'rabbit' && !rabbitAsleep && (
                <div className="match-status-bar">
                  <span ref={progressTextRef} style={{ fontSize: '12px', fontWeight: 'bold' }}>
                    Sleeping pose hold: 0%
                  </span>
                  <div className="progress-bar-bg">
                    <div ref={progressFillRef} className="progress-bar-fill" style={{ width: '0%' }} />
                  </div>
                </div>
              )}
              
              {rabbitAsleep && (
                <p style={{ fontSize: '11px', color: '#4a8c54', fontWeight: 'bold', margin: 0 }}>
                  🐰 Rabbit is napping. 🐢 Tortoise is crawling...
                </p>
              )}
            </div>
          )}

          {/* Step 4 details */}
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

          {/* Step 5 details */}
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

          {/* Navigation Controls */}
          <div className="nav-controls">
            <button
              className="btn-secondary"
              disabled={step === 1}
              onClick={() => handleStepChange(step - 1)}
            >
              Prev Step
            </button>
            <button
              className="btn-primary"
              disabled={step === 5 || step === 2 || (step === 3 && !rabbitAsleep)}
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

      {/* Racetrack Overlay (Steps 2, 3, 4 only) */}
      {started && (step === 2 || step === 3 || step === 4) && (
        <div className="racetrack-container">
          <div className="racetrack-title">
            <span>
              {step === 2 && `Racetrack (Move hand left/right to control ${playerRole === 'rabbit' ? '🐰' : '🐢'})`}
              {step === 3 && (playerRole === 'rabbit' ? 'Rabbit is deciding to sleep' : 'Tortoise is catching up')}
              {step === 4 && (playerRole === 'rabbit' ? 'Tortoise is advancing steadily' : 'Crawl Tortoise to finish')}
            </span>
            <span className="finish-label">Goal: {step === 4 ? '90%' : '60%'}</span>
          </div>
          <div className="racetrack">
            <div className="track-line" />
            <div className="finish-line" style={{ right: step === 4 ? '10%' : '40%' }} />
            
            <div ref={rabbitRef} className="runner" style={{ left: '10%' }}>
              <span className="runner-avatar">🐰</span>
              <span className="runner-label">Rabbit 10%</span>
            </div>

            <div ref={tortoiseRef} className="runner" style={{ left: '5%' }}>
              <span className="runner-avatar">🐢</span>
              <span className="runner-label">Tortoise 5%</span>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
