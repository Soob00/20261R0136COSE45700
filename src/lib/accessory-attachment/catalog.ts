import { PRESET_ITEMS } from '@/data/presets';
import type { AccessoryCategory } from '@/types/accessory';
import type { AccessoryRuntimePresetRef } from './types';
import { resolveDefaultAttachmentSpec } from './defaults';

const FALLBACK_ASSET_PATHS: Partial<Record<AccessoryCategory, string>> = {
  glasses: 'outputs\\glasses_only_001\\glb_raw\\acc_001_raw.glb',
};

export function resolveAccessoryRuntimePreset(
  presetId: string,
  category: AccessoryCategory,
): AccessoryRuntimePresetRef | null {
  const preset = PRESET_ITEMS.find((item) => item.id === presetId && item.category === 'accessory');
  const attachment = resolveDefaultAttachmentSpec(category);
  
  let assetModelPath = preset?.meshUrl ?? FALLBACK_ASSET_PATHS[category];
  if (presetId.startsWith('/api/') || presetId.startsWith('http') || presetId.startsWith('/models/')) {
    assetModelPath = presetId;
  }

  if (!assetModelPath) {
    return null;
  }

  return {
    presetId,
    category,
    assetModelPath,
    attachment,
  };
}
