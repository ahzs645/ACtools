export function isSupportedAlayaCareUrl(url: string): boolean {
  if (!url) {
    return false;
  }
  return (
    /^https:\/\/[^/]+\.alayacare\.(ca|com|cloud)\//i.test(url) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url)
  );
}

export function normalizeSupportedOrigin(value: string): string {
  let origin: string;
  try {
    origin = new URL(value).origin;
  } catch {
    throw new Error(`Invalid AlayaCare tenant URL: ${value}`);
  }
  if (!isSupportedAlayaCareUrl(`${origin}/`)) {
    throw new Error(`Unsupported AlayaCare tenant URL: ${value}`);
  }
  return origin;
}
