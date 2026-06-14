const PRESET_COLOR_NAME_TO_HEX: Record<string, string> = {
  black: '#111111',
  white: '#F5F5F5',
  gray: '#9CA3AF',
  grey: '#9CA3AF',
  silver: '#C0C0C0',
  gold: '#D4AF37',
  beige: '#D6C4A1',
  brown: '#8B5E3C',
  red: '#EF4444',
  orange: '#F97316',
  yellow: '#EAB308',
  green: '#22C55E',
  mint: '#6EE7B7',
  blue: '#3B82F6',
  'light blue': '#93C5FD',
  'sky blue': '#7DD3FC',
  navy: '#1E3A8A',
  purple: '#8B5CF6',
  pink: '#F9A8D4',
  'hot pink': '#EC4899',
};

const HEX_PATTERN = /^#?[0-9a-fA-F]{6}$/;

function normalizeHex(hex: string): string | null {
  const trimmed = hex.trim();
  if (!HEX_PATTERN.test(trimmed)) return null;
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return withHash.toUpperCase();
}

function normalizeColorName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function mapRawColorToHex(rawColor: string): string | null {
  const normalizedHex = normalizeHex(rawColor);
  if (normalizedHex) return normalizedHex;

  const normalizedName = normalizeColorName(rawColor);
  return PRESET_COLOR_NAME_TO_HEX[normalizedName] ?? null;
}

export function normalizeRawColors(rawColors: string[]): string[] {
  const deduped = new Set<string>();

  for (const rawColor of rawColors) {
    const mapped = mapRawColorToHex(rawColor);
    if (mapped) deduped.add(mapped);
  }

  return [...deduped];
}

export function normalizePresetPaletteHexes(hexes: string[]): string[] {
  const deduped = new Set<string>();

  for (const hex of hexes) {
    const normalized = normalizeHex(hex);
    if (normalized) deduped.add(normalized);
  }

  return [...deduped];
}

export function normalizePresetDominantColorHex(hex: string | null): string | null {
  if (!hex) return null;
  return normalizeHex(hex);
}

export const ACCESSORY_COLOR_NAME_TO_HEX = PRESET_COLOR_NAME_TO_HEX;
