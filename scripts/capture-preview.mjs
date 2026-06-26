/** 生成 README 预览截图与 GIF（需本地 HTTP 服务） */
import puppeteer from "puppeteer";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const BASE = process.env.PREVIEW_URL || "http://127.0.0.1:8088/";

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function captureFrames(page, canvasSel, count, intervalMs) {
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    const el = await page.$(canvasSel);
    if (el) frames.push(await el.screenshot({ type: "png" }));
    await wait(intervalMs);
  }
  return frames;
}

async function main() {
  await mkdir(DOCS, { recursive: true });

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });

  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 30000 });
  await wait(800);

  await page.screenshot({ path: path.join(DOCS, "preview-main.png"), fullPage: false });

  // 情绪表情 Tab + 时间轴
  await page.click('button[data-tab="scene"]');
  await wait(500);
  const sceneItems = await page.$$("#scene-list .list-item");
  if (sceneItems.length > 1) await sceneItems[1].click();
  await wait(400);
  await page.screenshot({ path: path.join(DOCS, "preview-emotion.png"), fullPage: false });

  // 播放预览 GIF（play-canvas）
  const playBtn = await page.$("#btn-play-scene");
  if (playBtn) {
    await playBtn.click();
    await wait(200);
    const frames = await captureFrames(page, "#play-canvas", 12, 120);
    const framePaths = [];
    for (let i = 0; i < frames.length; i += 1) {
      const fp = path.join(DOCS, `_gif_${String(i).padStart(2, "0")}.png`);
      await writeFile(fp, frames[i]);
      framePaths.push(fp);
    }
    const gifPath = path.join(DOCS, "preview-animation.gif");
    const palette = path.join(DOCS, "_palette.png");
    spawnSync("ffmpeg", ["-y", "-framerate", "8", "-i", path.join(DOCS, "_gif_%02d.png"), "-vf", "palettegen", palette], { stdio: "ignore" });
    spawnSync(
      "ffmpeg",
      ["-y", "-framerate", "8", "-i", path.join(DOCS, "_gif_%02d.png"), "-i", palette, "-lavfi", "paletteuse", gifPath],
      { stdio: "ignore" },
    );
    for (const fp of framePaths) await import("node:fs/promises").then(({ unlink }) => unlink(fp).catch(() => {}));
    await import("node:fs/promises").then(({ unlink }) => unlink(palette).catch(() => {}));
  }

  // OLED 画布特写（当前帧）
  const canvasShot = await page.$("#face-canvas");
  if (canvasShot) {
    await canvasShot.screenshot({ path: path.join(DOCS, "preview-canvas.png"), type: "png" });
  }

  await browser.close();
  console.log("Preview assets written to docs/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
