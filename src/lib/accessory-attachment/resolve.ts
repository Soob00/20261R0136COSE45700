import type {
  AccessoryAdjustment,
  AccessoryAttachmentSpec,
  AccessoryInstance,
  ResolvedAccessoryAttachment,
  ResolvedAccessoryTransform,
} from './types';

export function createDefaultAccessoryAdjustment(): AccessoryAdjustment {
  return {
    scaleMultiplier: [1, 1, 1],
    rotationDelta: [0, 0, 0],
    offsetDelta: [0, 0, 0],
  };
}

export function resolveAccessoryTransform(
  spec: AccessoryAttachmentSpec,
  adjustment: AccessoryAdjustment,
): ResolvedAccessoryTransform {
  const baseScale = Array.isArray(spec.scale) 
    ? spec.scale 
    : [spec.scale, spec.scale, spec.scale];

  return {
    scale: [
      Number((baseScale[0] * adjustment.scaleMultiplier[0]).toFixed(6)),
      Number((baseScale[1] * adjustment.scaleMultiplier[1]).toFixed(6)),
      Number((baseScale[2] * adjustment.scaleMultiplier[2]).toFixed(6)),
    ],
    rotation: [
      Number((spec.rotation[0] + adjustment.rotationDelta[0]).toFixed(6)),
      Number((spec.rotation[1] + adjustment.rotationDelta[1]).toFixed(6)),
      Number((spec.rotation[2] + adjustment.rotationDelta[2]).toFixed(6)),
    ],
    offset: [
      Number((spec.offset[0] + adjustment.offsetDelta[0]).toFixed(6)),
      Number((spec.offset[1] + adjustment.offsetDelta[1]).toFixed(6)),
      Number((spec.offset[2] + adjustment.offsetDelta[2]).toFixed(6)),
    ],
  };
}

export function resolveAccessoryAttachment(
  instance: AccessoryInstance,
  spec: AccessoryAttachmentSpec,
): ResolvedAccessoryAttachment {
  return {
    instanceId: instance.instanceId,
    presetId: instance.presetId,
    category: instance.category,
    enabled: instance.enabled,
    anchorBone: spec.anchorBone,
    attachRegion: spec.attachRegion,
    pivotPolicy: spec.pivotPolicy,
    finalTransform: resolveAccessoryTransform(spec, instance.adjustment),
  };
}
