import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  activateTabByUrl,
  closeExtension,
  getBackground,
  getBrowserFromProject,
  launchExtension,
  openExtensionPage,
  seedSettings,
  sendPanelMessage,
  waitForActiveTabUrl,
} from "./helpers/extension-harness";
import { getPanelModel, getPanelSummaryMarkdown } from "./helpers/panel-hooks";

const LIVE = process.env.SUMMARIZE_LIVE_BROWSER_MEDIA === "1";
const SPEECH =
  "Summarize browser media transcription works without a daemon. The purple telescope is beside the orange piano.";

test("transcribes embedded browser media through MediaBunny and local Whisper", async ({
  browserName: _browserName,
}, testInfo) => {
  test.skip(!LIVE, "Set SUMMARIZE_LIVE_BROWSER_MEDIA=1 to run local browser media transcription.");
  test.skip(testInfo.project.name !== "chromium", "Local browser Whisper is Chrome-only.");
  test.skip(!hasCommand("say") || !hasCommand("ffmpeg"), "macOS say and ffmpeg are required.");
  test.setTimeout(10 * 60 * 1000);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "summarize-browser-media-"));
  const aiffPath = path.join(tmpDir, "speech.aiff");
  const mediaPath = path.join(tmpDir, "speech.m4a");
  const mp3Path = path.join(tmpDir, "speech.mp3");
  const mp4Path = path.join(tmpDir, "speech.mp4");
  run("say", ["-v", "Samantha", "-o", aiffPath, SPEECH]);
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    aiffPath,
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    mediaPath,
  ]);
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    aiffPath,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "96k",
    mp3Path,
  ]);
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    aiffPath,
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
    mp4Path,
  ]);

  const mediaByPath = new Map([
    ["/speech.m4a", { bytes: fs.readFileSync(mediaPath), contentType: "audio/mp4" }],
    ["/speech.mp3", { bytes: fs.readFileSync(mp3Path), contentType: "audio/mpeg" }],
    ["/speech.mp4", { bytes: fs.readFileSync(mp4Path), contentType: "video/mp4" }],
  ]);
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title></title></head>
  <body>
    <audio controls preload="auto" src="/speech.m4a"></audio>
  </body>
</html>`;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const media = mediaByPath.get(url.pathname);
    if (media) {
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/u);
      if (range) {
        const start = Number(range[1]);
        const end = range[2]
          ? Math.min(media.bytes.length - 1, Number(range[2]))
          : media.bytes.length - 1;
        const body = media.bytes.subarray(start, end + 1);
        response.writeHead(206, {
          "accept-ranges": "bytes",
          "content-length": body.length,
          "content-range": `bytes ${start}-${end}/${media.bytes.length}`,
          "content-type": media.contentType,
        });
        response.end(body);
        return;
      }
      response.writeHead(200, {
        "accept-ranges": "bytes",
        "content-length": media.bytes.length,
        "content-type": media.contentType,
      });
      response.end(media.bytes);
      return;
    }
    const body = Buffer.from(html);
    response.writeHead(200, {
      "content-length": body.length,
      "content-type": "text/html; charset=utf-8",
    });
    response.end(body);
  });
  const serverUrl = await listen(server);
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await seedSettings(harness, {
      token: "",
      autoSummarize: false,
      extendedLogging: true,
      slidesEnabled: false,
      slideRuntime: "browser",
      maxChars: 20_000,
    });
    const contentPage = await harness.context.newPage();
    await contentPage.goto(serverUrl, { waitUntil: "domcontentloaded" });
    await contentPage.waitForFunction(() => {
      const media = document.querySelector("audio");
      return Boolean(media && Number.isFinite(media.duration) && media.duration > 0);
    });
    const panel = await openExtensionPage(harness, "sidepanel.html", "#title");
    await activateTabByUrl(harness, serverUrl);
    await sendPanelMessage(panel, {
      type: "panel:summarize",
      refresh: true,
      inputMode: "video",
    });

    await expect
      .poll(async () => await getPanelModel(panel), { timeout: 8 * 60 * 1000 })
      .toBe("Browser");

    const background = await getBackground(harness);
    const readDiagnosticsNewestFirst = async () =>
      await background.evaluate(async () => {
        const stored = await chrome.storage.session.get("summarize:extension-logs");
        const lines = Array.isArray(stored["summarize:extension-logs"])
          ? (stored["summarize:extension-logs"] as string[])
          : [];
        return lines
          .toReversed()
          .map((line) => {
            try {
              return JSON.parse(line) as Record<string, unknown>;
            } catch {
              return null;
            }
          })
          .filter(
            (entry) =>
              entry?.event === "extract:browser-media:transcript" ||
              entry?.event === "extract:browser-media:local-transcript-failed",
          );
      });
    await expect
      .poll(async () => (await readDiagnosticsNewestFirst()).length, { timeout: 5_000 })
      .toBe(1);
    const diagnostic = (await readDiagnosticsNewestFirst())[0];
    if (diagnostic?.event === "extract:browser-media:local-transcript-failed") {
      throw new Error(`Local browser media transcription failed: ${String(diagnostic.error)}`);
    }
    expect(diagnostic).toMatchObject({
      decoder: "mediabunny-webcodecs",
      mediaInput: "url-range",
      mediaSource: "embedded",
    });

    const summary = (await getPanelSummaryMarkdown(panel)).toLowerCase();
    expect(summary).toMatch(/purple|telescope|orange piano/u);

    for (const pathname of ["speech.mp3", "speech.mp4"]) {
      const directUrl = new URL(pathname, serverUrl).href;
      const previousCount = (await readDiagnosticsNewestFirst()).length;
      await contentPage.goto(directUrl, { waitUntil: "domcontentloaded" });
      await activateTabByUrl(harness, directUrl);
      await waitForActiveTabUrl(harness, directUrl);
      await sendPanelMessage(panel, {
        type: "panel:summarize",
        refresh: true,
        inputMode: "video",
      });

      await expect
        .poll(async () => (await readDiagnosticsNewestFirst()).length, {
          timeout: 8 * 60 * 1000,
        })
        .toBe(previousCount + 1);
      const directDiagnostic = (await readDiagnosticsNewestFirst())[0];
      if (directDiagnostic?.event === "extract:browser-media:local-transcript-failed") {
        throw new Error(
          `Local browser media transcription failed: ${String(directDiagnostic.error)}`,
        );
      }
      expect(directDiagnostic).toMatchObject({
        decoder: "mediabunny-webcodecs",
        mediaInput: "url-range",
        mediaSource: "direct",
      });
    }
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDir, { force: true, recursive: true });
  }
});

function hasCommand(command: string): boolean {
  const locator = process.platform === "win32" ? "where" : "which";
  return spawnSync(locator, [command], { stdio: "ignore" }).status === 0;
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status === 0) return;
  throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
}

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve local media server port."));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}/`);
    });
  });
}
