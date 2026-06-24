const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Users/m-yu/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    window.__errs = [];
    window.addEventListener('error', e => window.__errs.push(String(e.message)));
  });
  page.on('pageerror', err => console.log(`[PAGEERROR] ${err.message}`));

  await page.goto('http://localhost:8080/nail-tryon-poc.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // 1. Click Open Camera
  await page.click('#startBtn');
  await new Promise(r => setTimeout(r, 3000));

  const afterCam = await page.evaluate(() => ({
    overlayDisplay: document.getElementById('startOverlay').style.display,
    videoHasStream: !!document.getElementById('video').srcObject,
    videoW: document.getElementById('video').videoWidth,
    statusText: document.querySelector('#status .status-text')?.textContent,
    errs: window.__errs,
  }));
  console.log('[AFTER CAMERA]', JSON.stringify(afterCam, null, 2));

  // 2. Slider bug test: change Size slider to 100, see if internal sizeScale updates
  const sliderTest = await page.evaluate(() => {
    const s = document.getElementById('sizeSlider');
    s.value = '100';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      windowSizeScale: window.sizeScale,        // global property set by handler
      sizeValLabel: document.getElementById('sizeVal').textContent,
    };
  });
  console.log('[SLIDER]', JSON.stringify(sliderTest, null, 2));

  // 3. Does the rendering function actually read the updated value?
  //    Check whether `sizeScale` referenced inside drawNails is the same binding window.sizeScale touches.
  const bindingTest = await page.evaluate(() => {
    // Try to read the lexical sizeScale via a function that the script exposes? It doesn't.
    // Instead, detect: top-level `let` is NOT a window property initially.
    return {
      typeofWindowSizeScale: typeof window.sizeScale,
    };
  });
  console.log('[BINDING]', JSON.stringify(bindingTest, null, 2));

  // 4. Inject fake landmarks and call onResults to see if it draws without throwing
  const drawTest = await page.evaluate(() => {
    // Build a plausible right hand, fingers extended, pointing up
    function lmk(x,y,z){return {x,y,z};}
    // 21 landmarks; give index finger a clear DIP->TIP segment
    const lm = new Array(21).fill(0).map(()=>lmk(0.5,0.5,0));
    lm[0]=lmk(0.5,0.9,0);   // wrist
    // index: mcp5, pip6, dip7, tip8
    lm[5]=lmk(0.5,0.6,0); lm[6]=lmk(0.5,0.45,0); lm[7]=lmk(0.5,0.32,0); lm[8]=lmk(0.5,0.20,0);
    // middle
    lm[9]=lmk(0.55,0.6,0); lm[10]=lmk(0.55,0.43,0); lm[11]=lmk(0.55,0.30,0); lm[12]=lmk(0.55,0.18,0);
    try {
      window.onResults({ multiHandLandmarks: [lm] });
    } catch(e) { return { threw: String(e) }; }
    // Sample a canvas pixel near where index nail should be
    const c = document.getElementById('overlay');
    const cx = c.getContext('2d');
    // index tip ~ (0.5*w, 0.2*h); nail center between dip(0.32) and tip(0.2) at offset .72
    const w=c.width,h=c.height;
    const px = Math.round(0.5*w), py = Math.round((0.32 + (0.20-0.32)*0.72)*h);
    const d = cx.getImageData(px-2,py-2,5,5).data;
    let painted=false;
    for(let i=3;i<d.length;i+=4){ if(d[i]>0){painted=true;break;} }
    return { canvasW:w, canvasH:h, sampleAt:[px,py], paintedNearIndexNail:painted };
  });
  console.log('[DRAW]', JSON.stringify(drawTest, null, 2));

  await browser.close();
})();
