import type {
  AccessoryCategory,
  AttachRegion,
  PivotPolicy,
} from '@/types/accessory';
import type { AccessoryAttachmentSpec } from './types';

const DEFAULT_PIVOT_POLICY: PivotPolicy = 'object_center';

const DEFAULT_ANCHOR_BONE_BY_REGION: Record<AttachRegion, string> = {
  face_center: 'head',
  head_side_upper_left: 'head',
  head_side_upper_right: 'head',
  head_top: 'head',
};

const DEFAULT_ROTATION_BY_REGION: Record<AttachRegion, [number, number, number]> = {
  face_center: [0, 0, 0],
  head_side_upper_left: [0, 0, -12],
  head_side_upper_right: [0, 0, 12],
  head_top: [0, 0, 0],
};

const HAIR_ACCESSORY_OFFSET_BY_REGION: Record<AttachRegion, [number, number, number]> = {
  face_center: [0, 0, 0],
  head_side_upper_left: [-0.09, 0.12, 0.0],
  head_side_upper_right: [0.09, 0.12, 0.0],
  head_top: [0.0, 0.18, 0.0],
};

const CATEGORY_DEFAULTS: Record<AccessoryCategory, {
  attachRegion: AttachRegion;
  scale: number;
  offsetByRegion: Record<AttachRegion, [number, number, number]>;
}> = {
  glasses: {
    attachRegion: 'face_center',
    scale: [0.22, 0.26, 0.15],
    offsetByRegion: {
      face_center: [0.01, 0.06, -0.03],
      head_side_upper_left: [0.01, 0.06, -0.03],
      head_side_upper_right: [0.01, 0.06, -0.03],
      head_top: [0.01, 0.06, -0.03],
    },
  },
  hairpin: {
    attachRegion: 'head_side_upper_left',
    scale: 0.35,
    offsetByRegion: HAIR_ACCESSORY_OFFSET_BY_REGION,
  },
  hair_clip: {
    attachRegion: 'head_side_upper_left',
    scale: 0.4,
    offsetByRegion: HAIR_ACCESSORY_OFFSET_BY_REGION,
  },
  hair_bow: {
    attachRegion: 'head_top',
    scale: 0.55,
    offsetByRegion: HAIR_ACCESSORY_OFFSET_BY_REGION,
  },
};

export function resolveDefaultAnchorBone(region: AttachRegion): string {
  return DEFAULT_ANCHOR_BONE_BY_REGION[region] ?? 'head';
}

export function resolveDefaultAttachmentSpec(
  category: AccessoryCategory,
  region?: AttachRegion,
): AccessoryAttachmentSpec {
  const categoryDefaults = CATEGORY_DEFAULTS[category];
  const attachRegion = category === 'glasses'
    ? 'face_center'
    : (region ?? categoryDefaults.attachRegion);

  return {
    category,
    anchorBone: resolveDefaultAnchorBone(attachRegion),
    attachRegion,
    pivotPolicy: DEFAULT_PIVOT_POLICY,
    scale: categoryDefaults.scale,
    rotation: category === 'glasses' ? [0, 180, 0] : (DEFAULT_ROTATION_BY_REGION[attachRegion] ?? [0, 0, 0]),
    offset: categoryDefaults.offsetByRegion[attachRegion] ?? [0, 0, 0],
    placementSource: 'config_default',
  };
}
