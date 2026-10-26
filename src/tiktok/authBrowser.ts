/**
 * argv for macOS `open`. A named app becomes `open -a <app> <url>` so the
 * Authorize page opens in the browser that holds the creator's TikTok session.
 * An empty value falls back to the default browser, matching an unset env var.
 */
export function browserOpenArgs(browserApp: string | undefined, authorizeUrl: string): string[] {
  if (!browserApp) return [authorizeUrl];
  return ['-a', browserApp, authorizeUrl];
}
