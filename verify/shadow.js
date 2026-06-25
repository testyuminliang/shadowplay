// Verifies the ShadowPlay POC shadow-rendering pipeline end-to-end WITHOUT a real
// camera: it injects a realistic 21-point hand into onResults() and reads back the
// #shadow canvas pixels to confirm a silhouette was actually drawn.
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME = process.env.CHROME_PATH || '/Users/m-yu/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const URL = process.env.URL || 'http://localhost:8090/shadowplay-poc.html';

// A plausible open right hand (MediaPipe normalized coords, origin top-left).
const HAND = [
  [0.50,0.90],                                  // 0 wrist
  [0.42,0.82],[0.36,0.74],[0.32,0.67],[0.29,0.60], // 1-4 thumb
  [0.46,0.62],[0.45,0.50],[0.44,0.42],[0.43,0.35], // 5-8 index
  [0.52,0.60],[0.52,0.47],[0.52,0.38],[0.52,0.30], // 9-12 middle
  [0.58,0.62],[0.59,0.50],[0.60,0.42],[0.61,0.36], // 13-16 ring
  [0.63,0.66],[0.66,0.56],[0.68,0.49],[0.70,0.44], // 17-20 pinky
].map(([x,y]) => ({ x, y, z: 0 }));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', err => console.log(`[PAGEERROR] ${err.message}`));
  page.on('console', m => { if (m.type()==='error') console.log(`[console.error] ${m.text()}`); });

  try { await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 }); }
  catch (e) { console.log(`[GOTO ERROR] ${e.message}`); }
  await new Promise(r => setTimeout(r, 3500)); // let MediaPipe init

  const result = await page.evaluate((hand) => {
    const out = { handsReady: window.handsReady, onResultsType: typeof window.onResults };
    // hide the start overlay so a screenshot shows the wall + shadow
    const ov = document.getElementById('startOverlay'); if (ov) ov.style.display = 'none';
    if (typeof window.onResults !== 'function') return out;

    // drive the real render path with synthetic landmarks
    window.onResults({ multiHandLandmarks: [hand], multiHandedness: [{ label: 'Right', score: 0.99 }] });

    const c = document.getElementById('shadow');
    const g = c.getContext('2d');
    const { width: w, height: h } = c;
    const data = g.getImageData(0, 0, w, h).data;
    let painted = 0, minX = w, minY = h, maxX = 0, maxY = 0, alphaSum = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = data[(y*w + x)*4 + 3];
      if (a > 10) { painted++; alphaSum += a; if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y; }
    }
    out.canvas = { w, h };
    out.shadowPixels = painted;
    out.coverage = +(painted / (w*h) * 100).toFixed(2);
    out.avgAlpha = painted ? +(alphaSum/painted).toFixed(1) : 0;
    out.bbox = painted ? { minX, minY, maxX, maxY, wpx: maxX-minX, hpx: maxY-minY } : null;
    out.statusText = document.querySelector('#status .status-text')?.textContent;
    return out;
  }, HAND);

  console.log('[RESULT]', JSON.stringify(result, null, 2));

  // visual confirmation
  await page.screenshot({ path: __dirname + '/shadow-proof.png' });
  console.log('[screenshot] verify/shadow-proof.png');

  // verdict
  const ok = result.shadowPixels > 5000 && result.coverage < 60 && result.bbox && result.bbox.hpx > 200;
  console.log(ok ? '\n✅ PASS — hand landmarks produced a shadow silhouette.'
                 : '\n❌ FAIL — no plausible silhouette rendered.');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
