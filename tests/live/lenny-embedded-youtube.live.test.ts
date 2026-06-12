import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/run.js";

const LIVE = process.env.SUMMARIZE_LIVE_TEST === "1";

(LIVE ? describe : describe.skip)("live Lenny article with embedded YouTube", () => {
  it("combines the article and caption transcript without media transcription", async () => {
    let stdoutText = "";
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutText += chunk.toString();
        callback();
      },
    });
    const stderr = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const url = "https://www.lennysnewsletter.com/p/anthropics-cpo-heres-what-comes-next";
    const home = mkdtempSync(join(tmpdir(), "summarize-lenny-live-"));

    try {
      await runCli(["--json", "--extract", "--format", "text", "--timeout", "30s", url], {
        env: { ...process.env, HOME: home },
        fetch: globalThis.fetch.bind(globalThis),
        stdout,
        stderr,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }

    const parsed = JSON.parse(stdoutText) as {
      input: { embeddedVideo: string };
      extracted: {
        content: string;
        transcriptSource: string | null;
        transcriptCharacters: number | null;
        transcriptionProvider: string | null;
        video: { kind: string; url: string } | null;
        diagnostics: {
          embeddedVideo?: {
            detected: boolean;
            used: boolean;
            composition: string;
          };
        };
      };
    };

    expect(parsed.input.embeddedVideo).toBe("auto");
    expect(parsed.extracted.video).toEqual({
      kind: "youtube",
      url: "https://www.youtube.com/watch?v=DKrBGOFs0GY",
    });
    expect(["youtubei", "captionTracks"]).toContain(parsed.extracted.transcriptSource);
    expect(parsed.extracted.transcriptCharacters ?? 0).toBeGreaterThan(50_000);
    expect(parsed.extracted.transcriptionProvider).toBeNull();
    expect(parsed.extracted.content).toContain("Article:");
    expect(parsed.extracted.content).toContain("Embedded video transcript");
    expect(parsed.extracted.diagnostics.embeddedVideo).toMatchObject({
      detected: true,
      used: true,
      composition: "both",
    });
  }, 45_000);
});
