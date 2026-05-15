export function isYouTubeWatchUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const pathSegments = url.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    const firstPathSegment = pathSegments[0]?.toLowerCase();
    const hasVideoIdSegment = (segment: string | undefined) =>
      typeof segment === "string" && /^[A-Za-z0-9_-]{6,}$/.test(segment);
    if (host === "youtu.be") {
      return hasVideoIdSegment(firstPathSegment);
    }
    if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return false;
    const path = url.pathname.toLowerCase();
    if (path === "/watch") return hasVideoIdSegment(url.searchParams.get("v")?.trim());
    if (path.startsWith("/shorts/")) {
      return hasVideoIdSegment(firstPathSegment === "shorts" ? pathSegments[1] : undefined);
    }
    if (path.startsWith("/live/")) {
      return hasVideoIdSegment(firstPathSegment === "live" ? pathSegments[1] : undefined);
    }
    return false;
  } catch {
    return false;
  }
}
