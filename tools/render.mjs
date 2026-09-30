// tools/render.mjs — render a project with headless Chrome/Chromium.
//
//   node tools/render.mjs --project=<dir> --style=watercolor --sheet=0.5,2,4,6       contact sheet  → <project>/out/sheet_<style>.jpg
//   node tools/render.mjs --project=<dir> --board=2,5 --styles=watercolor,ink,pixel  style board    → <project>/out/style_board.jpg
//   node tools/render.mjs --project=<dir> --style=pixel --stills=1,3                  full-size PNGs → <project>/out/stills_<style>/
//   node tools/render.mjs --project=<dir> --style=watercolor --bench                  speed test (24 frames)
//   node tools/render.mjs --project=<dir> --style=watercolor --all                    all frames + MP4 → <project>/out/<title>_<style>.mp4
//      (--frames[=a:b] and --encode run the two halves separately; frames are resumable)
//   node tools/render.mjs --batch=<film>/shots --all                                    every sub-folder that has a scenes.js
//
// --style defaults to the `style: '...'` given in the project's project({...}) call, else watercolor.
//
// Options: --workers=3  --soft (software GL, for machines without a GPU)  --chrome=<path>  --pd=1 (pixel density)
// Drivers: uses puppeteer-core (npm install in tools/) or falls back to Playwright (local or global install).
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync, renameSync, readdirSync, appendFileSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const WORKERS = +(args.workers || 3);
let PROJECT, STYLE, OUT, LOG;
function useProject(dir) {
  PROJECT = resolve(dir); OUT = join(PROJECT, 'out'); mkdirSync(OUT, { recursive: true }); LOG = join(OUT, 'render_log.txt');
  const m = existsSync(join(PROJECT, 'scenes.js')) && readFileSync(join(PROJECT, 'scenes.js'), 'utf8').match(/\bstyle\s*:\s*['"](\w+)['"]/);
  STYLE = args.style || (m && m[1]) || 'watercolor';
}
const PROJECTS = args.batch
  ? readdirSync(resolve(args.batch)).map(d => join(resolve(args.batch), d)).filter(d => existsSync(join(d, 'scenes.js'))).sort()
  : [args.project || join(REPO, 'examples', 'spirochete')];
useProject(PROJECTS[0]);
const log = (...m) => { const s = m.join(' '); console.log(s); appendFileSync(LOG, `[${new Date().toLocaleString()}] ${s}\n`); };
const times = s => String(s).split(',').map(Number);

// ---------- driver ----------
async function getDriver() {
  try { const m = (await import('puppeteer-core')).default; return { name: 'puppeteer-core', needsExe: true, launch: o => m.launch({ executablePath: o.exe, headless: true, protocolTimeout: 0, args: o.args }) }; } catch {}
  const pw = m => ({ name: 'playwright', needsExe: false, launch: o => m.chromium.launch({ executablePath: o.exe || undefined, headless: true, args: o.args }) });
  for (const spec of ['playwright', 'playwright-core']) { try { return pw(await import(spec)); } catch {} }
  try { const root = execSync('npm root -g').toString().trim(); return pw(await import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href)); } catch {}
  throw new Error('需要 puppeteer-core 或 playwright：在 tools/ 目录运行 npm install');
}
function findChrome() {
  const c = [args.chrome, process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  return c.find(p => existsSync(p));
}
async function ffmpegBin() { try { return (await import('ffmpeg-static')).default; } catch { return 'ffmpeg'; } }

// ---------- local server: repo at /, project at /project/ ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const [root, rel] = u.startsWith('/project/') ? [PROJECT, u.slice(9)] : [REPO, u.slice(1)];
  const p = resolve(root, rel);
  if (!p.startsWith(root) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const pageURL = style => `http://127.0.0.1:${server.address().port}/engine/studio.html?project=/project&style=${style}&render&pd=${args.pd || 1}`;

const driver = await getDriver(), exe = findChrome();
if (driver.needsExe && !exe) { log('找不到 Chrome/Edge，请用 --chrome=路径 指定'); process.exit(1); }
const gpuArgs = args.soft ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : (process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu-rasterization'] : ['--enable-gpu-rasterization']);
const browser = await driver.launch({ exe, args: ['--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--window-size=1920,1080', ...gpuArgs] });
log(`驱动 ${driver.name} · 浏览器 ${exe || '(Playwright 自带)'} · ${PROJECTS.length} 个项目`);

async function openPage(style, tag = '') {
  const page = await browser.newPage();
  page.on('pageerror', e => log(`[页面错误${tag}]`, e.message));
  page.on('console', m => { const ty = typeof m.type === 'function' ? m.type() : m.type; if (ty === 'error') log(`[console${tag}]`, m.text()); });
  await page.goto(pageURL(style), { waitUntil: 'load' });
  const t0 = Date.now();
  while (!(await page.evaluate(() => !!window.ready))) { if (Date.now() - t0 > 600000) throw new Error('页面 10 分钟未就绪'); await new Promise(r => setTimeout(r, 200)); }
  return page;
}
const b64 = url => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
const run = (cmd, a) => new Promise((ok, bad) => { const p = spawn(cmd, a, { stdio: 'inherit' }); p.on('close', c => c ? bad(new Error(cmd + ' exited ' + c)) : ok()); });
const frameDir = style => join(OUT, style, 'frames');

async function frames(style, range, limit) {
  const page0 = await openPage(style), info = await page0.evaluate(() => window.projectInfo());
  log(`GPU: ${await page0.evaluate(() => window.gpuInfo())}`);
  const n = Math.round(info.duration * info.fps), [a, b] = range ? String(range).split(':').map(Number) : [0, info.duration];
  const dir = frameDir(style); mkdirSync(dir, { recursive: true });
  const todo = [];
  for (let i = Math.round(a * info.fps); i < Math.min(n, Math.round(b * info.fps)) && todo.length < (limit || 1e9); i++) {
    const f = join(dir, `f${String(i).padStart(5, '0')}.jpg`); if (!existsSync(f) || statSync(f).size < 1000) todo.push(i);
  }
  log(`[${style}] 需要渲染 ${todo.length} 帧，${WORKERS} 个并行`);
  let done = 0; const start = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const page = w === 0 ? page0 : await openPage(style, '#' + w);
    while (todo.length) {
      const i = todo.shift(), f = join(dir, `f${String(i).padStart(5, '0')}.jpg`);
      writeFileSync(f + '.tmp', b64(await page.evaluate(([t]) => window.renderAt(t, 'image/jpeg', .94), [i / info.fps]))); renameSync(f + '.tmp', f);
      if (++done % 24 === 0 || !todo.length) log(`[${style}] ${done} 帧 · 平均 ${((Date.now() - start) / done / 1000).toFixed(2)} 秒/帧`);
    }
    await page.close();
  }));
  return info;
}
async function encode(style, info) {
  const dir = frameDir(style), out = join(OUT, `${info.title}_${style}.mp4`);
  const a = ['-y', '-loglevel', 'error', '-framerate', String(info.fps), '-i', join(dir, 'f%05d.jpg')];
  const audio = info.audio && join(PROJECT, info.audio);
  if (audio && existsSync(audio)) a.push('-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest');
  a.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
  await run(await ffmpegBin(), a); log('成片：' + out);
}
async function sheet(style, ts, file) {
  const page = await openPage(style), r = await page.evaluate(([t, c, w]) => window.renderSheet(t, c, w), [ts, +(args.cols || 3), +(args.w || 640)]);
  writeFileSync(file, b64(r.url)); log(`预览图 ${file} · 每帧 ${r.ms.join('/')} ms`); await page.close();
}
async function board(styles, ts) {
  const rows = [];
  for (const s of styles) {
    const page = await openPage(s), r = await page.evaluate(([t, c, w]) => window.renderSheet(t, c, w), [ts, ts.length, 640]);
    rows.push({ style: s, url: r.url }); log(`[${s}] 样片完成 · 每帧 ${r.ms.join('/')} ms`); await page.close();
  }
  const page = await browser.newPage();
  const url = await page.evaluate(async ([rows, cols]) => {
    const w = 640, h = 360, lab = 44, cv = document.createElement('canvas'); cv.width = cols * w; cv.height = rows.length * (h + lab);
    const c = cv.getContext('2d'); c.fillStyle = '#16141c'; c.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < rows.length; i++) {
      const img = new Image(); img.src = rows[i].url; await img.decode();
      c.fillStyle = '#eee'; c.font = '600 26px sans-serif'; c.fillText(`${i + 1}. ${rows[i].style}`, 14, i * (h + lab) + 31);
      c.drawImage(img, 0, i * (h + lab) + lab);
    }
    return cv.toDataURL('image/jpeg', .9);
  }, [rows, ts.length]);
  const file = join(OUT, 'style_board.jpg'); writeFileSync(file, b64(url)); log('风格样片：' + file); await page.close();
}

async function renderProject() {
  if (args.board) await board(String(args.styles || 'watercolor,ink,pixel').split(','), times(args.board));
  else if (args.sheet) await sheet(STYLE, times(args.sheet), args.out ? resolve(args.out) : join(OUT, `sheet_${STYLE}.jpg`));
  else if (args.stills) {
    const page = await openPage(STYLE), dir = join(OUT, `stills_${STYLE}`); mkdirSync(dir, { recursive: true });
    for (const t of times(args.stills)) writeFileSync(join(dir, `t${t.toFixed(2)}.png`), b64(await page.evaluate(([t]) => window.renderAt(t, 'image/png'), [t])));
    log('静帧：' + dir); await page.close();
  } else if (args.bench) await frames(STYLE, null, 24);
  else {
    let info = null;
    if (args.frames || args.all) info = await frames(STYLE, args.frames === true ? null : args.frames);
    if (args.encode || args.all) {
      if (!info) { const p = await openPage(STYLE); info = await p.evaluate(() => window.projectInfo()); await p.close(); }
      await encode(STYLE, info);
    }
  }
}
const T0 = Date.now();
for (const dir of PROJECTS) {
  useProject(dir);
  if (PROJECTS.length > 1) log(`==== ${dir} · ${STYLE} ====`);
  try { await renderProject(); } catch (e) { log('出错：' + (e.stack || e.message)); process.exitCode = 1; }
}
log(`总耗时 ${((Date.now() - T0) / 60000).toFixed(1)} 分钟`);
await browser.close(); server.close();
