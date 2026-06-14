import type {
  AccessoryCategory,
  AttachRegion,
  PivotPolicy,
} from '@/types/accessory';

export type AttachPreviewMode =
  | '3d_avatar_render'
  | 'base_avatar_image'
  | '2d_fallback';

export type PlacementSource =
  | 'config_default'
  | 'preset_default'
  | 'manual_override';

export interface AccessoryAttachmentSpec {
  category: AccessoryCategory;
  avatarTemplateId?: string;
  anchorBone: string;
  attachRegion: AttachRegion;
  pivotPolicy: PivotPolicy;
  scale: number | [number, number, number];
  rotation: [number, number, number];
  offset: [number, number, number];
  placementSource?: PlacementSource;
}

export interface AccessoryAdjustment {
  scaleMultiplier: [number, number, number];
  rotationDelta: [number, number, number];
  offsetDelta: [number, number, number];
}

export interface AccessoryPlacementBase {
  scale: number | [number, number, number];
  rotation: [number, number, number];
  offset: [number, number, number];
}

export interface AccessoryRuntimePresetRef {
  presetId: string;
  category: AccessoryCategory;
  assetModelPath?: string;
  attachment: AccessoryAttachmentSpec;
}

export interface AccessoryInstance {
  instanceId: string;
  presetId: string;
  category: AccessoryCategory;
  enabled: boolean;
  adjustment: AccessoryAdjustment;
}

export interface ResolvedAccessoryTransform {
  scale: [number, number, number];
  rotation: [number, number, number];
  offset: [number, number, number];
}

export interface ResolvedAccessoryAttachment {
  instanceId: string;
  presetId: string;
  category: AccessoryCategory;
  enabled: boolean;
  anchorBone: string;
  attachRegion: AttachRegion;
  pivotPolicy: PivotPolicy;
  finalTransform: ResolvedAccessoryTransform;
}
