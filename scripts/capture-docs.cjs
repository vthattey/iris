// Captures the README images into docs/images. Requires Playwright and ffmpeg.
//   npm run examples && node scripts/capture-docs.cjs
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const { mkdirSync, rmSync, existsSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs/images');
const frames = path.join(root, 'out/frames');
const example = 'file://' + path.join(root, 'out/examples/payments.html');
const java = 'file://' + path.join(root, 'out/examples/java-monolith.html');

async function open(page, url, id) {
  await page.goto('about:blank');
  await page.goto(`${url}#${id}`);
  await page.waitForFunction(() => document.querySelectorAll('#viewport [data-id]').length > 0);
  await page.waitForTimeout(250);
}
async function click(page, id) {
  await page.click(`#viewport [data-id="${id}"]`);
  await page.waitForFunction((c) => document.querySelector(`[data-id="${c}"]`)?.getAttribute('aria-expanded') === 'true', id);
  await page.waitForTimeout(250);
}
async function fit(page) { await page.click('#fit'); await page.waitForTimeout(150); }

(async () => {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();

  // Stills, 2x for sharp README images
  const still = await browser.newPage({ viewport: { width: 1200, height: 720 }, deviceScaleFactor: 2 });
  const shots = [
    [example, 'payment-classes', ['pkg.service', 'PaymentServiceImpl'], 'class-diagram'],
    [example, 'payment-sequence', ['m0', 'm0.0'], 'sequence-diagram'],
    [example, 'payment-flow', ['risk', 'save'], 'activity-diagram'],
    [example, 'payments-components', ['mono', 'core'], 'component-diagram'],
    [example, 'transaction-states', ['PROCESSING'], 'state-diagram'],
    [example, 'payments-er', ['transactions', 'accounts'], 'er-diagram'],
    [java, 'flow-PaymentController-create', ['m0', 'm0.0'], 'analyzed-java-flow'],
    [java, 'er', ['transactions', 'accounts'], 'analyzed-java-er'],
  ];
  for (const [url, id, clicks, name] of shots) {
    await open(still, url, id);
    for (const c of clicks) await click(still, c);
    await fit(still);
    await still.screenshot({ path: path.join(outDir, `${name}.png`) });
    console.log(`docs/images/${name}.png`);
  }

  // Animated hero: open the class diagram one level at a time
  if (existsSync(frames)) rmSync(frames, { recursive: true });
  mkdirSync(frames, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
  let n = 0;
  const snap = async (hold) => { for (let i = 0; i < hold; i++) await page.screenshot({ path: path.join(frames, `f${String(n++).padStart(3, '0')}.png`) }); };
  await open(page, example, 'payment-classes');
  await fit(page); await snap(6);
  for (const id of ['pkg.service', 'PaymentServiceImpl', 'pkg.domain']) {
    await fit(page);
    const box = await page.locator(`#viewport [data-id="${id}"]`).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(20, box.height / 2));
    await snap(3);
    await click(page, id);
    await fit(page);
    await snap(7);
  }
  await open(page, example, 'payment-sequence');
  await fit(page); await snap(5);
  for (const id of ['m0', 'm0.0', 'm0.0.3']) {
    await fit(page);
    await click(page, id);
    await fit(page);
    await snap(7);
  }
  const gif = path.join(outDir, 'iris-demo.gif');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '4', '-i', path.join(frames, 'f%03d.png'),
    '-vf', 'scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', gif]);
  console.log('docs/images/iris-demo.gif');
  await browser.close();
})();
