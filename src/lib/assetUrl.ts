const BASE = (process.env.NEXT_PUBLIC_ASSET_BASE_URL ?? '').replace(/\/$/, '');

export function assetUrl(path: string): string {
  return `${BASE}${path}`;
}
