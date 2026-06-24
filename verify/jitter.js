const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Users/m-yu/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[PAGEERROR]', e.message));
  await page.goto('http://localhost:8080/nail-tryon-poc.html', { waitUntil:'networkidle2' });
  await new Promise(r=>setTimeout(r,1200));

  const result = await page.evaluate(async () => {
    // Controllable clock so dt simulates real 30fps (synchronous loop otherwise gives dt≈0)
    let clock = 1000;
    const realNow = performance.now.bind(performance);
    performance.now = () => clock;

    function setSmooth(v){
      const s=document.getElementById('smoothSlider');
      s.value=String(v); s.dispatchEvent(new Event('input',{bubbles:true}));
    }
    // deterministic pseudo-noise (no Math.random dependence on determinism needed, but keep stable)
    let seed=12345; const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
    const noise=(amp)=> (rnd()-0.5)*2*amp;

    function frame(){
      // still hand: index finger pointing up, fingertip jittering ±0.004 normalized (~3px @720)
      const L=(x,y,z)=>({x,y,z});
      const lm=new Array(21).fill(0).map(()=>L(0.5,0.5,0));
      lm[0]=L(0.5,0.85,0);
      const jx=noise(0.004), jy=noise(0.004);
      // index 5..8
      lm[5]=L(0.5,0.60,0); lm[6]=L(0.5,0.48,0);
      lm[7]=L(0.5+jx*0.5,0.36+jy*0.5,0); lm[8]=L(0.5+jx,0.24+jy,0);
      return lm;
    }
    function nailCenterX(){
      // sample painted centroid in index nail region
      const c=document.getElementById('overlay'), cx=c.getContext('2d');
      const W=c.width,H=c.height;
      const x0=Math.round(0.5*W)-40, y0=Math.round(0.27*H)-40;
      const d=cx.getImageData(x0,y0,80,80).data;
      let sx=0,sy=0,n=0;
      for(let yy=0;yy<80;yy++)for(let xx=0;xx<80;xx++){
        const i=(yy*80+xx)*4+3; if(d[i]>0){ sx+=xx; sy+=yy; n++; }
      }
      return n? {x:x0+sx/n, y:y0+sy/n, n} : null;
    }
    function std(arr){ const m=arr.reduce((a,b)=>a+b,0)/arr.length; return Math.sqrt(arr.reduce((a,b)=>a+(b-m)*(b-m),0)/arr.length); }

    async function measure(smoothVal){
      setSmooth(smoothVal);
      // reset filter state by toggling smooth off then on doesn't clear; instead warm up
      const xs=[], ys=[];
      for(let i=0;i<90;i++){
        clock += 33;                       // ~30 fps
        window.onResults({ multiHandLandmarks:[frame()] });
        if(i>=30){ const c=nailCenterX(); if(c){ xs.push(c.x); ys.push(c.y); } }  // skip warm-up
      }
      return { stdX:+std(xs).toFixed(2), stdY:+std(ys).toFixed(2), samples:xs.length };
    }

    const off = await measure(0);
    const on  = await measure(85);
    performance.now = realNow;
    return { off, on };
  });

  console.log('[jitter of drawn nail center across frames]');
  console.log('  Smooth=0  (raw): ', JSON.stringify(result.off));
  console.log('  Smooth=85 (on):  ', JSON.stringify(result.on));
  const rx = (result.off.stdX/Math.max(result.on.stdX,0.001)).toFixed(1);
  const ry = (result.off.stdY/Math.max(result.on.stdY,0.001)).toFixed(1);
  console.log(`  → jitter reduced ~${rx}x (x), ~${ry}x (y)`);

  await browser.close();
})();
