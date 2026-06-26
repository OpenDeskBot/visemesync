/** 为 README 生成各情绪表情动画 GIF（需本地 HTTP 服务） */
import puppeteer from "puppeteer";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs", "emotions");
const BASE = process.env.PREVIEW_URL || "http://127.0.0.1:8088/";
const GIF_FPS = 10;

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sceneTotalMs(frames) {
  if (!frames?.length) return 800;
  return frames.reduce((s, f) => s + Math.max(16, f.ms ?? 800), 0);
}

async function pngsToGif(framePaths, gifPath) {
  const dir = path.dirname(gifPath);
  const pattern = path.join(dir, "_tmp_%03d.png");
  for (let i = 0; i < framePaths.length; i += 1) {
    await writeFile(path.join(dir, `_tmp_${String(i).padStart(3, "0")}.png`), framePaths[i]);
  }
  const palette = path.join(dir, "_palette.png");
  spawnSync(
    "ffmpeg",
    ["-y", "-framerate", String(GIF_FPS), "-i", pattern, "-vf", "palettegen", palette],
    { stdio: "ignore" },
  );
  spawnSync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      String(GIF_FPS),
      "-i",
      pattern,
      "-i",
      palette,
      "-lavfi",
      "paletteuse",
      "-loop",
      "0",
      gifPath,
    ],
    { stdio: "ignore" },
  );
  for (let i = 0; i < framePaths.length; i += 1) {
    await unlink(path.join(dir, `_tmp_${String(i).padStart(3, "0")}.png`)).catch(() => {});
  }
  await unlink(palette).catch(() => {});
}

async function captureEmotionGif(page, emotion, index) {
  const items = await page.$$("#scene-list .list-item");
  if (!items[index]) return false;

  await page.evaluate(() => {
    if (window.__vsPlaybackTimer) clearInterval(window.__vsPlaybackTimer);
  });
  await items[index].click();
  await wait(350);

  const totalMs = sceneTotalMs(emotion.frames);
  const frameInterval = Math.max(50, Math.round(1000 / GIF_FPS));
  const frameCount = Math.max(2, Math.ceil(totalMs / frameInterval) + 1);

  const playBtn = await page.$("#btn-play-scene");
  if (playBtn) await playBtn.click();
  await wait(120);

  const frames = [];
  for (let i = 0; i < frameCount; i += 1) {
    const el = await page.$("#play-canvas");
    if (el) frames.push(await el.screenshot({ type: "png" }));
    await wait(frameInterval);
  }

  const stopBtn = await page.$("#btn-stop-play");
  if (stopBtn) await stopBtn.click();
  await wait(80);

  const gifPath = path.join(DOCS, `${emotion.name}.gif`);
  await pngsToGif(frames, gifPath);
  return true;
}

async function openDefaultProject(page) {
  await wait(800);
  const catalogCard = await page.$("#catalog-list .project-card");
  if (!catalogCard) return false;
  await catalogCard.click();
  await wait(400);
  const name = `preview-${Date.now().toString(36)}`;
  await page.waitForSelector("#save-as-filename", { visible: true, timeout: 5000 });
  await page.click("#save-as-filename", { clickCount: 3 });
  await page.type("#save-as-filename", name);
  await page.click("#btn-save-as-confirm");
  await wait(900);
  return true;
}

async function main() {
  const doc = JSON.parse(await readFile(path.join(ROOT, "data", "deskbot-default.json"), "utf8"));
  const emotions = doc.emotions || [];
  await mkdir(DOCS, { recursive: true });

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });

  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 30000 });
  if (!(await openDefaultProject(page))) {
    throw new Error("无法打开内置模板，请确认 data/projects.json 与 HTTP 服务正常");
  }
  await page.click('button[data-tab="scene"]');
  await wait(400);

  for (let i = 0; i < emotions.length; i += 1) {
    const em = emotions[i];
    const ok = await captureEmotionGif(page, em, i);
    console.log(ok ? `✓ ${em.name}.gif (${em.title})` : `✗ ${em.name}`);
  }

  await browser.close();
  console.log(`Emotion GIFs written to docs/emotions/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
