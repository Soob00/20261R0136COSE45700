import type { MorphTargetMap, BoneScaleMap, MaterialMap } from './editor';

export type PresetCategory = 'hair' | 'outfit' | 'accessory' | (string & {});

export interface PresetItem {
  id: string;
  name: string;
  category: PresetCategory;
  thumbnailUrl: string;
  meshUrl?: string;
  hairBackUrl?: string;
  blendShapeKey?: string;
}

export type QuickPresetCategory = 'face' | 'style';

export interface QuickPreset {
  id: string;
  name: string;
  description?: string;
  category?: QuickPresetCategory;
  isBuiltIn: boolean;
  values: {
    morphTargets?: MorphTargetMap;
    boneScales?: BoneScaleMap;
    materials?: MaterialMap;
    hairFrontUrl?: string | null;
    hairBackUrl?: string | null;
    outfitUrl?: string | null;
  };
}
