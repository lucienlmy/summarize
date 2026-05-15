import { describe, expect, it } from "vitest";
import { isYouTubeWatchUrl } from "../apps/chrome-extension/src/lib/youtube-url.js";

describe("chrome/youtube-url", () => {
  it("accepts YouTube video URLs", () => {
    expect(isYouTubeWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeWatchUrl("https://youtu.be/dQw4w9WgXcQ?t=5")).toBe(true);
    expect(isYouTubeWatchUrl("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeWatchUrl("https://youtube.com/live/dQw4w9WgXcQ")).toBe(true);
  });

  it("rejects malicious YouTube-like hostnames", () => {
    expect(isYouTubeWatchUrl("https://youtube.com.attacker.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(isYouTubeWatchUrl("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(isYouTubeWatchUrl("https://attacker-youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
  });

  it("rejects YouTube container URLs without a video id", () => {
    expect(isYouTubeWatchUrl("https://youtu.be/")).toBe(false);
    expect(isYouTubeWatchUrl("https://youtu.be/watch?v=abcdefghijk")).toBe(false);
    expect(isYouTubeWatchUrl("https://www.youtube.com/watch?v=1")).toBe(false);
    expect(isYouTubeWatchUrl("https://www.youtube.com/watch?v=watch")).toBe(false);
    expect(isYouTubeWatchUrl("https://www.youtube.com/shorts/")).toBe(false);
    expect(isYouTubeWatchUrl("https://www.youtube.com/live/")).toBe(false);
    expect(isYouTubeWatchUrl("https://www.youtube.com/playlist?list=abc")).toBe(false);
  });
});
