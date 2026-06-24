const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Users/m-yu/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const fakeHand = `(() => {
  function lmk(x,y,z){return {x,y,z};}
  const lm = new Array(21).fill(0).map(()=>lmk(0.5,0.5,0));
  lm[0]=lmk(0.5,0.9,0);
  lm[5]=lmk(0.5,0.6,0); lm[6]=lmk(0.5,0.45,0); lm[7]=lmk(0.5,0.32,0); lm[8]=lmk(0.5,0.20,0);
  return lm;
})()`;

function countPainted(){
  const c = document.getElementById('overlay');
  const cx = c.getContext('2d');
  const d = cx.getImageData(0,0,c.width,c.height).data;
  let n=0; for(let i=3;i<d.length;i+=4){ if(d[i]>0) n++; }
  return n;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--no-sandbox'],
  });

  // ---- TEST A: slider now affects rendering (localhost) ----
  const p1 = await browser.newPage();
  p1.on('pageerror', e => console.log('[PAGEERROR]', e.message));
  await p1.goto('http://localhost:8080/nail-tryon-poc.html', { waitUntil:'networkidle2' });
  await new Promise(r=>setTimeout(r,1500));

  const sliderResult = await p1.evaluate((fh, cpSrc) => {
    const countPainted = eval('(' + cpSrc + ')');
    const lm = eval(fh);
    // size = 30
    document.getElementById('sizeSlider').value='30';
    document.getElementById('sizeSlider').dispatchEvent(new Event('input',{bubbles:true}));
    window.onResults({ multiHandLandmarks:[lm] });
    const small = countPainted();
    // size = 100
    document.getElementById('sizeSlider').value='100';
    document.getElementById('sizeSlider').dispatchEvent(new Event('input',{bubbles:true}));
    window.onResults({ multiHandLandmarks:[lm] });
    const big = countPainted();
    return { small, big, grew: big > small * 1.5 };
  }, fakeHand, countPainted.toString());
  console.log('[SLIDER NOW WORKS?]', JSON.stringify(sliderResult));

  // ---- TEST B: file:// shows the localhost hint instead of starting camera ----
  const p2 = await browser.newPage();
  await p2.goto('file:///Users/m-yu/nail/files/nail-tryon-poc.html', { waitUntil:'networkidle2' });
  await new Promise(r=>setTimeout(r,1500));
  await p2.click('#startBtn');
  await new Promise(r=>setTimeout(r,800));
  const fileResult = await p2.evaluate(() => ({
    startMsg: document.getElementById('startMsg').textContent,
    hintShown: document.getElementById('startHint').style.display,
    hintHasLocalhost: document.getElementById('startHint').textContent.includes('localhost'),
    cameraStarted: !!document.getElementById('video').srcObject,
  }));
  console.log('[FILE:// GUARD]', JSON.stringify(fileResult));

  await browser.close();
})();
