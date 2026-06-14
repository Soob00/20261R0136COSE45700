'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { loadVRM } from '@/lib/vrm/loader';
import { loadGLB } from '@/lib/glb-loader';

export interface AccessoryRenderSpec {
  sampleId: string;
  category: string;
  avatarTemplateId?: string;
  assetModelPath: string;
  baseAvatarModelPath: string;
  anchorBone: string;
  attachRegion: string;
  pivotPolicy: string;
  scale: number | [number, number, number];
  rotation: [number, number, number];
  offset: [number, number, number];
  placementSource: string;
  cameraView: string;
  renderWidth: number;
  renderHeight: number;
  cameraDistance?: number;
  cameraFov?: number;
  lightPreset?: string;
  background: string;
  inputSource: string;
}

type BoundsTuple = { min: [number, number, number]; max: [number, number, number] };
type SizeTuple = { width: number; height: number; depth: number };
type CandidateFrontPlaneMode = 'maxZ' | 'minZ';
type CandidateForwardSign = 1 | -1;
type AxisName = 'x' | 'y' | 'z';
type RotationTuple = [number, number, number];

interface PlacementCandidateResult {
  frontPlaneMode: CandidateFrontPlaneMode;
  forwardSign: CandidateForwardSign;
  rotationLabel: string;
  rotationOffset: RotationTuple;
  finalRotation: RotationTuple;
  recenterOffset: [number, number, number];
  finalOffset: [number, number, number];
  baseScale: number;
  autoFitScale: number;
  finalScale: number;
  projectedBBox: [number, number, number, number] | null;
  projectedAreaRatio: number;
  worldCenter: [number, number, number];
  inFrame: boolean;
  targetScreenX: number;
  targetScreenY: number;
  headProjectedWidth: number;
  accessoryAheadOfHead: boolean;
  depthDeltaZ: number;
  projectedAspectRatio: number;
  thinAxis: AxisName;
  wideAxis: AxisName;
  visualAnchorY: number;
  templeAnchorY: number;
  semanticAnchorSource: string;
  semanticSampleCount: number;
  thinAxisCameraAlignment: number;
  wideAxisScreenAlignment: number;
  score: number;
  rejected: boolean;
  rejectReason: string | null;
}

export interface AccessoryRenderResult {
  ok: boolean;
  stage: 'loading' | 'ready' | 'failed';
  specPath: string;
  inFrame: boolean | null;
  projectedBBox: [number, number, number, number] | null;
  projectedAreaRatio: number | null;
  anchorBoneRequested: string | null;
  anchorBoneResolved: string | null;
  warnings: string[];
  error: string | null;
  assetBounds?: BoundsTuple;
  assetSize?: SizeTuple;
  assetCenter?: [number, number, number];
  baseScale?: number;
  autoFitScale?: number;
  finalScale?: number;
  recenterOffset?: [number, number, number];
  normalizedAssetCenter?: [number, number, number];
  frontPlaneZ?: number;
  baseOffset?: [number, number, number];
  categoryOffset?: [number, number, number];
  finalOffset?: [number, number, number];
  finalRotation?: [number, number, number];
  pivotPolicyApplied?: string;
  placementStrategy?: string;
  anchorWorldPosition?: [number, number, number];
  renderTarget?: [number, number, number];
  accessoryWorldBounds?: BoundsTuple;
  accessoryWorldCenter?: [number, number, number];
  accessoryAheadOfHead?: boolean;
  depthDeltaZ?: number;
  renderTargetSource?: string;
  headBounds?: BoundsTuple;
  headSize?: SizeTuple;
  headCenterWorld?: [number, number, number];
  headBoundsSource?: string;
  eyeLineY?: number;
  headProjectedWidth?: number;
  targetScreenX?: number;
  targetScreenY?: number;
  glassesVisualAnchorY?: number;
  glassesTempleAnchorY?: number;
  glassesSemanticAnchorSource?: string;
  glassesSemanticSampleCount?: number;
  selectedCandidateIndex?: number;
  selectedFrontPlaneMode?: CandidateFrontPlaneMode;
  selectedForwardSign?: CandidateForwardSign;
  selectedRotationLabel?: string;
  selectedScore?: number;
  selectedCandidateRejectMargin?: number;
  placementCandidates?: PlacementCandidateResult[];
}

interface AccessoryRenderSceneProps {
  spec: AccessoryRenderSpec;
  specPath: string;
  baseAvatarUrl: string;
  accessoryUrl: string;
  onResult: (result: AccessoryRenderResult) => void;
}

interface HeadMetrics {
  bounds: THREE.Box3;
  boundsTuple: BoundsTuple;
  size: SizeTuple;
  centerWorld: [number, number, number];
  source: string;
  eyeLineY: number;
  eyeCenterWorld?: [number, number, number];
  eyeSource?: string;
}

interface GlassesPlacementCandidate {
  root: THREE.Group;
  frontPlaneMode: CandidateFrontPlaneMode;
  forwardSign: CandidateForwardSign;
  rotationLabel: string;
  rotationOffset: RotationTuple;
  finalRotation: RotationTuple;
  thinAxis: AxisName;
  wideAxis: AxisName;
  visualAnchorY: number;
  templeAnchorY: number;
  semanticAnchorSource: string;
  semanticSampleCount: number;
  recenterOffset: [number, number, number];
  finalOffset: [number, number, number];
  baseScale: number;
  autoFitScale: number;
  finalScale: number;
}

interface LoadedState {
  requestedAnchor: string;
  resolvedAnchorName: string | null;
  warnings: string[];
  renderMetadata: RenderMetadata;
  headMetrics?: HeadMetrics;
  placementParent: THREE.Object3D;
  glassesCandidates?: GlassesPlacementCandidate[];
  selectedPlacementRoot?: THREE.Object3D;
  selectionResolved: boolean;
}

interface RenderMetadata {
  assetBounds?: BoundsTuple;
  assetSize?: SizeTuple;
  assetCenter?: [number, number, number];
  baseScale?: number;
  autoFitScale?: number;
  finalScale?: number;
  recenterOffset?: [number, number, number];
  normalizedAssetCenter?: [number, number, number];
  frontPlaneZ?: number;
  baseOffset?: [number, number, number];
  categoryOffset?: [number, number, number];
  finalOffset?: [number, number, number];
  finalRotation?: [number, number, number];
  pivotPolicyApplied?: string;
  placementStrategy?: string;
  anchorWorldPosition?: [number, number, number];
  renderTarget?: [number, number, number];
  accessoryWorldBounds?: BoundsTuple;
  accessoryWorldCenter?: [number, number, number];
  renderTargetSource?: string;
  headBounds?: BoundsTuple;
  headSize?: SizeTuple;
  headCenterWorld?: [number, number, number];
  headBoundsSource?: string;
  eyeLineY?: number;
  eyeCenterWorld?: [number, number, number];
  eyeSource?: string;
  headProjectedWidth?: number;
  targetScreenX?: number;
  targetScreenY?: number;
  glassesVisualAnchorY?: number;
  glassesTempleAnchorY?: number;
  glassesSemanticAnchorSource?: string;
  glassesSemanticSampleCount?: number;
  selectedCandidateIndex?: number;
  selectedFrontPlaneMode?: CandidateFrontPlaneMode;
  selectedForwardSign?: CandidateForwardSign;
  selectedRotationLabel?: string;
  selectedScore?: number;
  selectedCandidateRejectMargin?: number;
  placementCandidates?: PlacementCandidateResult[];
}

interface SemanticAnchorPoint {
  x: number;
  y: number;
  z: number;
}

interface GlassesSemanticAnchors {
  lensAnchorY: number;
  templeAnchorY: number;
  source: string;
  sampleCount: number;
}

function degToRad(rotation: [number, number, number]): [number, number, number] {
  return [
    THREE.MathUtils.degToRad(rotation[0]),
    THREE.MathUtils.degToRad(rotation[1]),
    THREE.MathUtils.degToRad(rotation[2]),
  ];
}

function toTuple3(vector: THREE.Vector3): [number, number, number] {
  return [
    Number(vector.x.toFixed(6)),
    Number(vector.y.toFixed(6)),
    Number(vector.z.toFixed(6)),
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeDegrees(value: number): number {
  let next = value % 360;
  if (next > 180) next -= 360;
  if (next <= -180) next += 360;
  return Number(next.toFixed(6));
}

function addRotation(base: RotationTuple, offset: RotationTuple): RotationTuple {
  return [
    normalizeDegrees(base[0] + offset[0]),
    normalizeDegrees(base[1] + offset[1]),
    normalizeDegrees(base[2] + offset[2]),
  ];
}

function axisVector(axis: AxisName): THREE.Vector3 {
  if (axis === 'x') return new THREE.Vector3(1, 0, 0);
  if (axis === 'y') return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(0, 0, 1);
}

function axisOrderBySize(size?: SizeTuple): { thinAxis: AxisName; wideAxis: AxisName } {
  const entries: Array<{ axis: AxisName; value: number }> = [
    { axis: 'x', value: size?.width ?? 0 },
    { axis: 'y', value: size?.height ?? 0 },
    { axis: 'z', value: size?.depth ?? 0 },
  ];
  entries.sort((a, b) => a.value - b.value);
  return {
    thinAxis: entries[0]?.axis ?? 'z',
    wideAxis: entries[entries.length - 1]?.axis ?? 'x',
  };
}

function buildGlassesRotationPresets(thinAxis: AxisName): Array<{ label: string; offset: RotationTuple }> {
  const presets: Array<{ label: string; offset: RotationTuple }> = [];
  const pushPreset = (label: string, offset: RotationTuple) => {
    const key = `${offset[0]}:${offset[1]}:${offset[2]}`;
    if (presets.some((preset) => `${preset.offset[0]}:${preset.offset[1]}:${preset.offset[2]}` === key)) {
      return;
    }
    presets.push({ label, offset });
  };

  if (thinAxis === 'y') {
    pushPreset('thin_y_pitch_pos_90', [90, 0, 0]);
    pushPreset('thin_y_pitch_neg_90', [-90, 0, 0]);
    pushPreset('thin_y_pitch_pos_90_roll_180', [90, 0, 180]);
    pushPreset('thin_y_pitch_neg_90_roll_180', [-90, 0, 180]);
  } else if (thinAxis === 'x') {
    pushPreset('thin_x_yaw_pos_90', [0, 90, 0]);
    pushPreset('thin_x_yaw_neg_90', [0, -90, 0]);
    pushPreset('thin_x_yaw_pos_90_roll_180', [0, 90, 180]);
    pushPreset('thin_x_yaw_neg_90_roll_180', [0, -90, 180]);
  } else {
    pushPreset('thin_z_identity', [0, 0, 0]);
    pushPreset('thin_z_yaw_180', [0, 180, 0]);
    pushPreset('thin_z_roll_180', [0, 0, 180]);
    pushPreset('thin_z_yaw_180_roll_180', [0, 180, 180]);
  }

  pushPreset('fallback_identity', [0, 0, 0]);
  pushPreset('fallback_yaw_180', [0, 180, 0]);
  pushPreset('fallback_roll_180', [0, 0, 180]);
  return presets;
}

function resolveAnchorBone(vrm: VRM, requestedName: string): THREE.Object3D | null {
  const humanoid = (vrm as VRM & { humanoid?: { humanBones?: Record<string, { node?: THREE.Object3D }> } }).humanoid;
  const headNode = humanoid?.humanBones?.head?.node ?? null;
  if (requestedName === 'head' && headNode) {
    return headNode;
  }

  let found: THREE.Object3D | null = null;
  vrm.scene.traverse((object) => {
    if (!found && object.name === requestedName) {
      found = object;
    }
  });
  if (found) {
    return found;
  }

  return headNode;
}

function resolveEyeNodes(vrm: VRM): { leftEye: THREE.Object3D | null; rightEye: THREE.Object3D | null } {
  const humanoid = (vrm as VRM & { humanoid?: { humanBones?: Record<string, { node?: THREE.Object3D }> } }).humanoid;
  return {
    leftEye: humanoid?.humanBones?.leftEye?.node ?? null,
    rightEye: humanoid?.humanBones?.rightEye?.node ?? null,
  };
}

function boxToBoundsTuple(bounds: THREE.Box3): BoundsTuple {
  return {
    min: toTuple3(bounds.min),
    max: toTuple3(bounds.max),
  };
}

function boxToSizeTuple(bounds: THREE.Box3): SizeTuple {
  const size = new THREE.Vector3();
  bounds.getSize(size);
  return {
    width: Number(size.x.toFixed(6)),
    height: Number(size.y.toFixed(6)),
    depth: Number(size.z.toFixed(6)),
  };
}

function computeBoundsMetadata(bounds: THREE.Box3): Pick<RenderMetadata, 'assetBounds' | 'assetSize' | 'assetCenter'> {
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  return {
    assetBounds: boxToBoundsTuple(bounds),
    assetSize: boxToSizeTuple(bounds),
    assetCenter: toTuple3(center),
  };
}

function computeWeightedMedian(
  entries: Array<{ value: number; weight: number }>,
  fallback: number,
): number {
  if (entries.length === 0) {
    return fallback;
  }

  const sorted = [...entries]
    .filter((entry) => Number.isFinite(entry.value) && Number.isFinite(entry.weight) && entry.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (sorted.length === 0) {
    return fallback;
  }

  const totalWeight = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return fallback;
  }

  let cumulative = 0;
  for (const entry of sorted) {
    cumulative += entry.weight;
    if (cumulative >= totalWeight * 0.5) {
      return entry.value;
    }
  }

  return sorted[sorted.length - 1]?.value ?? fallback;
}

function collectAccessoryLocalPoints(
  root: THREE.Object3D,
  maxSamples = 12000,
): SemanticAnchorPoint[] {
  root.updateWorldMatrix(true, true);
  const inverseRootMatrix = root.matrixWorld.clone().invert();
  const meshes: THREE.Mesh[] = [];
  let totalVertexCount = 0;

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) {
      return;
    }
    const position = mesh.geometry.getAttribute('position');
    if (!position || position.count === 0) {
      return;
    }
    meshes.push(mesh);
    totalVertexCount += position.count;
  });

  if (meshes.length === 0 || totalVertexCount === 0) {
    return [];
  }

  const stride = Math.max(1, Math.ceil(totalVertexCount / maxSamples));
  const point = new THREE.Vector3();
  const points: SemanticAnchorPoint[] = [];

  meshes.forEach((mesh) => {
    const position = mesh.geometry.getAttribute('position');
    if (!position) {
      return;
    }

    for (let index = 0; index < position.count; index += stride) {
      point.fromBufferAttribute(position, index);
      point.applyMatrix4(mesh.matrixWorld);
      point.applyMatrix4(inverseRootMatrix);
      points.push({
        x: Number(point.x.toFixed(6)),
        y: Number(point.y.toFixed(6)),
        z: Number(point.z.toFixed(6)),
      });
    }
  });

  return points;
}

function resolveGlassesSemanticAnchors(
  root: THREE.Object3D,
  bounds: THREE.Box3,
): GlassesSemanticAnchors {
  const width = Math.max(bounds.max.x - bounds.min.x, 1e-6);
  const height = Math.max(bounds.max.y - bounds.min.y, 1e-6);
  const depth = Math.max(bounds.max.z - bounds.min.z, 1e-6);
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const fallbackLensAnchorY = bounds.min.y + (height * 0.46);
  const fallbackTempleAnchorY = bounds.min.y + (height * 0.62);
  const points = collectAccessoryLocalPoints(root);

  if (points.length === 0) {
    return {
      lensAnchorY: Number(fallbackLensAnchorY.toFixed(6)),
      templeAnchorY: Number(fallbackTempleAnchorY.toFixed(6)),
      source: 'bbox_fallback_no_points',
      sampleCount: 0,
    };
  }

  const centerEntries: Array<{ value: number; weight: number }> = [];
  const sideEntries: Array<{ value: number; weight: number }> = [];

  points.forEach((point) => {
    const normalizedX = Math.abs((point.x - centerX) / (width * 0.5));
    const minZDistance = Math.abs(point.z - bounds.min.z) / depth;
    const maxZDistance = Math.abs(point.z - bounds.max.z) / depth;
    const shellWeight = Math.max(
      clamp(1 - (minZDistance / 0.35), 0, 1),
      clamp(1 - (maxZDistance / 0.35), 0, 1),
    );

    if (normalizedX <= 0.42) {
      const centerWeight = clamp(1 - (normalizedX / 0.42), 0, 1);
      const weight = (0.2 + (centerWeight * 0.8)) * (0.25 + (shellWeight * 0.75));
      if (weight > 0) {
        centerEntries.push({ value: point.y, weight });
      }
    }

    if (normalizedX >= 0.28 && normalizedX <= 0.88) {
      const sideWeight = clamp((normalizedX - 0.28) / 0.60, 0, 1);
      const weight = (0.15 + (sideWeight * 0.85)) * (0.25 + (shellWeight * 0.75));
      if (weight > 0) {
        sideEntries.push({ value: point.y, weight });
      }
    }
  });

  return {
    lensAnchorY: Number(computeWeightedMedian(centerEntries, fallbackLensAnchorY).toFixed(6)),
    templeAnchorY: Number(computeWeightedMedian(sideEntries, fallbackTempleAnchorY).toFixed(6)),
    source: 'vertex_weighted_median_v1',
    sampleCount: points.length,
  };
}

function buildProjectedBoxFromBounds(
  bounds: THREE.Box3,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
) {
  if (bounds.isEmpty()) {
    return {
      inFrame: false,
      projectedBBox: [0, 0, 0, 0] as [number, number, number, number],
      projectedAreaRatio: 0,
      projectedCenterX: 0,
      projectedCenterY: 0,
      projectedWidth: 0,
      projectedHeight: 0,
      warnings: ['empty_bounds'],
    };
  }

  const corners = [
    new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
    new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
    new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
    new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
    new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
    new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
    new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
    new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
  ];

  const projected = corners.map((corner) => corner.clone().project(camera));
  const finitePoints = projected.filter((point) =>
    Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
  );
  if (finitePoints.length === 0) {
    return {
      inFrame: false,
      projectedBBox: [0, 0, 0, 0] as [number, number, number, number],
      projectedAreaRatio: 0,
      projectedCenterX: 0,
      projectedCenterY: 0,
      projectedWidth: 0,
      projectedHeight: 0,
      warnings: ['projection_failed'],
    };
  }

  const screenPoints = finitePoints.map((point) => ({
    x: ((point.x + 1) / 2) * viewportWidth,
    y: ((1 - point.y) / 2) * viewportHeight,
    z: point.z,
  }));

  const minX = Math.min(...screenPoints.map((point) => point.x));
  const maxX = Math.max(...screenPoints.map((point) => point.x));
  const minY = Math.min(...screenPoints.map((point) => point.y));
  const maxY = Math.max(...screenPoints.map((point) => point.y));

  const clippedMinX = THREE.MathUtils.clamp(minX, 0, viewportWidth);
  const clippedMaxX = THREE.MathUtils.clamp(maxX, 0, viewportWidth);
  const clippedMinY = THREE.MathUtils.clamp(minY, 0, viewportHeight);
  const clippedMaxY = THREE.MathUtils.clamp(maxY, 0, viewportHeight);

  const projectedWidth = Math.max(0, clippedMaxX - clippedMinX);
  const projectedHeight = Math.max(0, clippedMaxY - clippedMinY);
  const projectedAreaRatio = Number(
    ((projectedWidth * projectedHeight) / Math.max(1, viewportWidth * viewportHeight)).toFixed(6),
  );
  const inDepthRange = screenPoints.some((point) => point.z >= -1 && point.z <= 1);
  const intersectsViewport = projectedWidth > 0 && projectedHeight > 0;

  return {
    inFrame: inDepthRange && intersectsViewport,
    projectedBBox: [
      Math.round(clippedMinX),
      Math.round(clippedMinY),
      Math.round(projectedWidth),
      Math.round(projectedHeight),
    ] as [number, number, number, number],
    projectedAreaRatio,
    projectedCenterX: Number(((clippedMinX + clippedMaxX) / 2).toFixed(6)),
    projectedCenterY: Number(((clippedMinY + clippedMaxY) / 2).toFixed(6)),
    projectedWidth: Number(projectedWidth.toFixed(6)),
    projectedHeight: Number(projectedHeight.toFixed(6)),
    warnings: [] as string[],
  };
}

function buildProjectedVisibility(
  object: THREE.Object3D,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
) {
  return buildProjectedBoxFromBounds(
    new THREE.Box3().setFromObject(object),
    camera,
    viewportWidth,
    viewportHeight,
  );
}

function computeWorldBoundsMetadata(object: THREE.Object3D): Pick<RenderMetadata, 'accessoryWorldBounds' | 'accessoryWorldCenter'> {
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) {
    return {};
  }

  const center = new THREE.Vector3();
  bounds.getCenter(center);
  return {
    accessoryWorldBounds: boxToBoundsTuple(bounds),
    accessoryWorldCenter: toTuple3(center),
  };
}

function collectHeadMetrics(
  anchor: THREE.Object3D,
  eyeNodes?: { leftEye: THREE.Object3D | null; rightEye: THREE.Object3D | null },
): HeadMetrics {
  const fallbackWidth = 0.20;
  const fallbackHeight = 0.24;
  const fallbackDepth = 0.20;
  const bounds = new THREE.Box3();
  let hasMeshDescendant = false;

  anchor.traverse((object) => {
    if (object === anchor) {
      return;
    }
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) {
      return;
    }
    mesh.geometry.computeBoundingBox();
    if (!mesh.geometry.boundingBox) {
      return;
    }
    const worldBounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    bounds.union(worldBounds);
    hasMeshDescendant = true;
  });

  let source = 'head_descendant_meshes';
  if (!hasMeshDescendant || bounds.isEmpty()) {
    const position = new THREE.Vector3();
    anchor.getWorldPosition(position);
    const half = new THREE.Vector3(fallbackWidth / 2, fallbackHeight / 2, fallbackDepth / 2);
    bounds.min.copy(position.clone().sub(half));
    bounds.max.copy(position.clone().add(half));
    source = 'head_fallback_size';
  }

  const center = new THREE.Vector3();
  bounds.getCenter(center);
  const size = boxToSizeTuple(bounds);
  let eyeLineY = Number((bounds.min.y + size.height * 0.60).toFixed(6));
  let eyeCenterWorld: [number, number, number] | undefined;
  let eyeSource = 'head_bounds_ratio';

  const leftEye = eyeNodes?.leftEye ?? null;
  const rightEye = eyeNodes?.rightEye ?? null;
  if (leftEye && rightEye) {
    const leftPos = new THREE.Vector3();
    const rightPos = new THREE.Vector3();
    leftEye.getWorldPosition(leftPos);
    rightEye.getWorldPosition(rightPos);
    const avg = leftPos.clone().add(rightPos).multiplyScalar(0.5);
    eyeLineY = Number(avg.y.toFixed(6));
    eyeCenterWorld = toTuple3(avg);
    eyeSource = 'vrm_eye_bones';
  }

  return {
    bounds,
    boundsTuple: boxToBoundsTuple(bounds),
    size,
    centerWorld: toTuple3(center),
    source,
    eyeLineY,
    eyeCenterWorld,
    eyeSource,
  };
}

function createPlacementRoot(
  accessoryRoot: THREE.Object3D,
  recenterOffset: [number, number, number],
  finalScale: number | [number, number, number],
  finalOffset: [number, number, number],
  rotation: [number, number, number],
): THREE.Group {
  const placementRoot = new THREE.Group();
  placementRoot.name = 'AccessoryPlacementRoot';
  const normalizedRoot = new THREE.Group();
  normalizedRoot.name = 'AccessoryNormalizedRoot';
  placementRoot.add(normalizedRoot);
  normalizedRoot.add(accessoryRoot);

  accessoryRoot.position.set(recenterOffset[0], recenterOffset[1], recenterOffset[2]);
  if (Array.isArray(finalScale)) {
    normalizedRoot.scale.set(finalScale[0], finalScale[1], finalScale[2]);
  } else {
    normalizedRoot.scale.setScalar(finalScale);
  }
  const rotationRad = degToRad(rotation);
  placementRoot.rotation.set(rotationRad[0], rotationRad[1], rotationRad[2]);
  placementRoot.position.set(finalOffset[0], finalOffset[1], finalOffset[2]);
  return placementRoot;
}

function buildGlassesPlacementCandidates(
  baseAccessory: THREE.Object3D,
  spec: AccessoryRenderSpec,
  headMetrics: HeadMetrics,
): {
  candidates: GlassesPlacementCandidate[];
  renderMetadata: RenderMetadata;
} {
  const bounds = new THREE.Box3().setFromObject(baseAccessory);
  const boundsMetadata = computeBoundsMetadata(bounds);
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const semanticAnchors = resolveGlassesSemanticAnchors(baseAccessory, bounds);
  const visualAnchorY = semanticAnchors.lensAnchorY;
  const templeAnchorY = semanticAnchors.templeAnchorY;
  const maxZ = bounds.max.z;
  const minZ = bounds.min.z;
  const assetWidth = Math.max(boundsMetadata.assetSize?.width ?? 0, 1e-6);
  const baseScale = Number((Array.isArray(spec.scale) ? spec.scale[0] : spec.scale).toFixed(6));
  const targetGlassesWidth = headMetrics.size.width * 1.05;
  const autoFitScale = Number(clamp(targetGlassesWidth / assetWidth, 0.05, 4.0).toFixed(6));
  const finalScale = Number((baseScale * autoFitScale).toFixed(6));
  const baseOffset: [number, number, number] = [...spec.offset];
  const eyeAnchorDeltaY = Number(
    (
      (headMetrics.eyeCenterWorld?.[1] ?? headMetrics.eyeLineY) -
      headMetrics.centerWorld[1]
    ).toFixed(6),
  );
  const baseRotation = spec.rotation.map((value) => Number(value.toFixed(6))) as RotationTuple;
  const { thinAxis, wideAxis } = axisOrderBySize(boundsMetadata.assetSize);
  const rotationPresets = buildGlassesRotationPresets(thinAxis);
  const depthDistance = Number((headMetrics.size.depth * 0.55).toFixed(6));

  const candidates: GlassesPlacementCandidate[] = [];
  (['maxZ', 'minZ'] as CandidateFrontPlaneMode[]).forEach((frontPlaneMode) => {
    ([1, -1] as CandidateForwardSign[]).forEach((forwardSign) => {
      rotationPresets.forEach(({ label, offset }) => {
        const frontPlaneZ = frontPlaneMode === 'maxZ' ? maxZ : minZ;
        const recenterOffset: [number, number, number] = [
          Number((-centerX).toFixed(6)),
          Number((-visualAnchorY).toFixed(6)),
          Number((-frontPlaneZ).toFixed(6)),
        ];
        const finalOffset: [number, number, number] = [
          Number(baseOffset[0].toFixed(6)),
          Number(eyeAnchorDeltaY.toFixed(6)),
          Number((forwardSign * depthDistance).toFixed(6)),
        ];
        const finalRotation = addRotation(baseRotation, offset);
        const candidateRoot = createPlacementRoot(
          baseAccessory.clone(),
          recenterOffset,
          finalScale,
          finalOffset,
          finalRotation,
        );
        candidates.push({
          root: candidateRoot,
          frontPlaneMode,
          forwardSign,
          rotationLabel: label,
          rotationOffset: offset,
          finalRotation,
          thinAxis,
          wideAxis,
          visualAnchorY: Number(visualAnchorY.toFixed(6)),
          templeAnchorY: Number(templeAnchorY.toFixed(6)),
          semanticAnchorSource: semanticAnchors.source,
          semanticSampleCount: semanticAnchors.sampleCount,
          recenterOffset,
          finalOffset,
          baseScale,
          autoFitScale,
          finalScale,
        });
      });
    });
  });

  return {
    candidates,
    renderMetadata: {
      ...boundsMetadata,
      baseScale,
      autoFitScale,
      finalScale,
      normalizedAssetCenter: [0, 0, 0],
      frontPlaneZ: undefined,
      baseOffset: [
        Number(baseOffset[0].toFixed(6)),
        Number(eyeAnchorDeltaY.toFixed(6)),
        Number(baseOffset[2].toFixed(6)),
      ],
      finalRotation: baseRotation,
      pivotPolicyApplied: 'glasses_candidate_search_v3_semantic_anchor',
      placementStrategy: 'glasses_candidate_search_v3_semantic_anchor',
      headBounds: headMetrics.boundsTuple,
      headSize: headMetrics.size,
      headCenterWorld: headMetrics.centerWorld,
      headBoundsSource: headMetrics.source,
      eyeLineY: headMetrics.eyeLineY,
      eyeCenterWorld: headMetrics.eyeCenterWorld,
      eyeSource: headMetrics.eyeSource,
      glassesVisualAnchorY: Number(visualAnchorY.toFixed(6)),
      glassesTempleAnchorY: Number(templeAnchorY.toFixed(6)),
      glassesSemanticAnchorSource: semanticAnchors.source,
      glassesSemanticSampleCount: semanticAnchors.sampleCount,
      renderTargetSource: 'head_eye_line',
    },
  };
}

function buildDefaultPlacement(
  accessoryRoot: THREE.Object3D,
  spec: AccessoryRenderSpec,
): {
  placementRoot: THREE.Group;
  renderMetadata: RenderMetadata;
} {
  const bounds = new THREE.Box3().setFromObject(accessoryRoot);
  const boundsMetadata = computeBoundsMetadata(bounds);
  const baseOffset: [number, number, number] = [...spec.offset];
  const specScaleArray = Array.isArray(spec.scale) ? spec.scale : [spec.scale, spec.scale, spec.scale];
  const placementRoot = createPlacementRoot(accessoryRoot, [0, 0, 0], specScaleArray as [number, number, number], baseOffset, spec.rotation);
  const rotation = degToRad(spec.rotation).map((value) => Number(value.toFixed(6))) as [number, number, number];

  return {
    placementRoot,
    renderMetadata: {
      ...boundsMetadata,
      baseScale: Number(specScaleArray[0].toFixed(6)),
      autoFitScale: 1,
      finalScale: Number(specScaleArray[0].toFixed(6)),
      recenterOffset: [0, 0, 0],
      normalizedAssetCenter: boundsMetadata.assetCenter,
      frontPlaneZ: boundsMetadata.assetBounds?.max[2],
      baseOffset,
      categoryOffset: [0, 0, 0],
      finalOffset: baseOffset,
      finalRotation: rotation,
      pivotPolicyApplied: spec.pivotPolicy,
      placementStrategy: 'spec_direct_v1',
      renderTargetSource: 'accessory_bounds_center',
    },
  };
}

function resolveRenderTarget(
  accessory: THREE.Object3D,
  anchor: THREE.Object3D | null,
  category: string,
  headMetrics?: HeadMetrics,
): { target: THREE.Vector3; source: string } {
  const target = new THREE.Vector3();
  if (category === 'glasses' && headMetrics) {
    if (headMetrics.eyeCenterWorld) {
      target.set(
        headMetrics.eyeCenterWorld[0],
        headMetrics.eyeCenterWorld[1],
        headMetrics.eyeCenterWorld[2],
      );
    } else {
      target.set(
        headMetrics.centerWorld[0],
        headMetrics.eyeLineY,
        headMetrics.centerWorld[2],
      );
    }
    return { target, source: 'head_eye_line' };
  }

  if (category === 'glasses' && anchor) {
    anchor.getWorldPosition(target);
    target.y += 0.005;
    return { target, source: 'anchor_head' };
  }

  const accessoryBounds = new THREE.Box3().setFromObject(accessory);
  if (!accessoryBounds.isEmpty()) {
    accessoryBounds.getCenter(target);
    return { target, source: 'accessory_bounds_center' };
  }
  if (anchor) {
    anchor.getWorldPosition(target);
    return { target, source: 'anchor_fallback' };
  }

  accessory.getWorldPosition(target);
  return { target, source: 'accessory_position' };
}

function applyCameraFraming(
  camera: THREE.Camera,
  target: THREE.Vector3,
  cameraDistance: number,
  cameraView: string,
): void {
  if (!(camera instanceof THREE.PerspectiveCamera)) {
    camera.lookAt(target);
    return;
  }

  const resolvedDistance = Math.max(0.25, cameraDistance);
  const nextPosition = new THREE.Vector3();

  if (cameraView === 'left') {
    nextPosition.set(target.x - resolvedDistance, target.y + 0.02, target.z + 0.04);
  } else if (cameraView === 'right') {
    nextPosition.set(target.x + resolvedDistance, target.y + 0.02, target.z + 0.04);
  } else {
    nextPosition.set(target.x, target.y + 0.02, target.z + resolvedDistance);
  }

  camera.position.copy(nextPosition);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
}

function stabilizeProjectionState(
  placementParent: THREE.Object3D,
  camera: THREE.Camera,
  target: THREE.Vector3,
  cameraDistance: number,
  cameraView: string,
): void {
  placementParent.updateWorldMatrix(true, true);
  applyCameraFraming(camera, target, cameraDistance, cameraView);
  camera.updateMatrixWorld(true);
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.updateProjectionMatrix();
  }
  placementParent.updateWorldMatrix(true, true);
}

function evaluateGlassesCandidate(
  candidate: GlassesPlacementCandidate,
  placementParent: THREE.Object3D,
  anchor: THREE.Object3D | null,
  spec: AccessoryRenderSpec,
  headMetrics: HeadMetrics,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
): PlacementCandidateResult & {
  centerXError: number;
  centerYError: number;
} {
  placementParent.add(candidate.root);
  const targetInfo = resolveRenderTarget(candidate.root, anchor, spec.category, headMetrics);
  stabilizeProjectionState(
    placementParent,
    camera,
    targetInfo.target,
    spec.cameraDistance ?? 1.8,
    spec.cameraView,
  );

  const candidateBounds = new THREE.Box3().setFromObject(candidate.root);
  const candidateCenter = new THREE.Vector3();
  candidateBounds.getCenter(candidateCenter);
  const candidateProjection = buildProjectedBoxFromBounds(candidateBounds, camera, viewportWidth, viewportHeight);
  const headProjection = buildProjectedBoxFromBounds(headMetrics.bounds, camera, viewportWidth, viewportHeight);
  const candidateQuaternion = new THREE.Quaternion();
  candidate.root.getWorldQuaternion(candidateQuaternion);
  const cameraForward = new THREE.Vector3();
  camera.getWorldDirection(cameraForward);
  const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const thinAxisWorld = axisVector(candidate.thinAxis).applyQuaternion(candidateQuaternion).normalize();
  const wideAxisWorld = axisVector(candidate.wideAxis).applyQuaternion(candidateQuaternion).normalize();
  const thinAxisCameraAlignment = Number(Math.abs(thinAxisWorld.dot(cameraForward)).toFixed(6));
  const wideAxisScreenAlignment = Number(Math.abs(wideAxisWorld.dot(cameraRight)).toFixed(6));

  const targetWorld = new THREE.Vector3(
    headMetrics.eyeCenterWorld?.[0] ?? headMetrics.centerWorld[0],
    headMetrics.eyeCenterWorld?.[1] ?? headMetrics.eyeLineY,
    headMetrics.eyeCenterWorld?.[2] ?? headMetrics.centerWorld[2],
  );
  const targetProjected = targetWorld.clone().project(camera);
  const targetScreenX = Number((((targetProjected.x + 1) / 2) * viewportWidth).toFixed(6));
  const targetScreenY = Number((((1 - targetProjected.y) / 2) * viewportHeight).toFixed(6));

  placementParent.remove(candidate.root);

  const depthDeltaZ = Number((candidateCenter.z - headMetrics.centerWorld[2]).toFixed(6));
  const accessoryAheadOfHead = depthDeltaZ > 0;
  const projectedAspectRatio = Number(
    (
      candidateProjection.projectedWidth /
      Math.max(candidateProjection.projectedHeight, 1e-6)
    ).toFixed(6),
  );
  let rejected = false;
  let rejectReason: string | null = null;
  if (!candidateProjection.inFrame) {
    rejected = true;
    rejectReason = 'out_of_frame';
  } else if (!accessoryAheadOfHead) {
    rejected = true;
    rejectReason = 'behind_head_center';
  } else if (wideAxisScreenAlignment < 0.55) {
    rejected = true;
    rejectReason = 'wide_axis_not_screen_aligned';
  } else if (candidateProjection.projectedHeight < 10) {
    rejected = true;
    rejectReason = 'projected_height_too_small';
  } else if (candidateProjection.projectedWidth < 40) {
    rejected = true;
    rejectReason = 'projected_width_too_small';
  } else if (candidateProjection.projectedAreaRatio <= 0) {
    rejected = true;
    rejectReason = 'projected_area_zero';
  } else if (projectedAspectRatio < 1.8) {
    rejected = true;
    rejectReason = 'projected_aspect_too_tall';
  }

  const centerXError = Math.abs(candidateProjection.projectedCenterX - targetScreenX);
  const centerYError = Math.abs(candidateProjection.projectedCenterY - targetScreenY);
  const headProjectedWidth = Math.max(headProjection.projectedWidth, 1e-6);
  const widthRatio = candidateProjection.projectedWidth / headProjectedWidth;
  const widthFitError = Math.abs(widthRatio - 0.72);
  const areaValue = candidateProjection.projectedAreaRatio;
  const areaFitError = areaValue < 0.005 ? 0.005 - areaValue : areaValue > 0.035 ? areaValue - 0.035 : 0;
  const frontDirectionScore = accessoryAheadOfHead ? 1 : 0;
  const aspectRatioError = projectedAspectRatio < 2.2 ? 2.2 - projectedAspectRatio : projectedAspectRatio > 4.8 ? projectedAspectRatio - 4.8 : 0;
  const thinAxisPenalty = thinAxisCameraAlignment > 0.65 ? thinAxisCameraAlignment - 0.65 : 0;

  const centerXScore = clamp(1 - centerXError / 120, 0, 1);
  const centerYScore = clamp(1 - centerYError / 120, 0, 1);
  const widthFitScore = clamp(1 - widthFitError / 0.18, 0, 1);
  const areaFitScore = clamp(1 - areaFitError / 0.03, 0, 1);
  const aspectRatioScore = clamp(1 - aspectRatioError / 1.6, 0, 1);
  const score = rejected
    ? 0
    : Number((
      (centerXScore * 0.23) +
      (centerYScore * 0.23) +
      (widthFitScore * 0.18) +
      (areaFitScore * 0.08) +
      (aspectRatioScore * 0.18) +
      (wideAxisScreenAlignment * 0.05) +
      (frontDirectionScore * 0.10) -
      (thinAxisPenalty * 0.12)
    ).toFixed(6));

  return {
    frontPlaneMode: candidate.frontPlaneMode,
    forwardSign: candidate.forwardSign,
    rotationLabel: candidate.rotationLabel,
    rotationOffset: candidate.rotationOffset,
    finalRotation: candidate.finalRotation,
    recenterOffset: candidate.recenterOffset,
    finalOffset: candidate.finalOffset,
    baseScale: candidate.baseScale,
    autoFitScale: candidate.autoFitScale,
    finalScale: candidate.finalScale,
    projectedBBox: candidateProjection.projectedBBox,
    projectedAreaRatio: candidateProjection.projectedAreaRatio,
    worldCenter: toTuple3(candidateCenter),
    inFrame: candidateProjection.inFrame,
    targetScreenX,
    targetScreenY,
    headProjectedWidth: Number(headProjectedWidth.toFixed(6)),
    accessoryAheadOfHead,
    depthDeltaZ,
    projectedAspectRatio,
    thinAxis: candidate.thinAxis,
    wideAxis: candidate.wideAxis,
    visualAnchorY: candidate.visualAnchorY,
    templeAnchorY: candidate.templeAnchorY,
    semanticAnchorSource: candidate.semanticAnchorSource,
    semanticSampleCount: candidate.semanticSampleCount,
    thinAxisCameraAlignment,
    wideAxisScreenAlignment,
    score,
    rejected,
    rejectReason,
    centerXError,
    centerYError,
  };
}

function selectGlassesCandidate(
  candidates: GlassesPlacementCandidate[],
  placementParent: THREE.Object3D,
  anchor: THREE.Object3D | null,
  spec: AccessoryRenderSpec,
  headMetrics: HeadMetrics,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
) {
  const evaluated = candidates.map((candidate, index) => ({
    index,
    ...evaluateGlassesCandidate(
      candidate,
      placementParent,
      anchor,
      spec,
      headMetrics,
      camera,
      viewportWidth,
      viewportHeight,
    ),
  }));

  const compare = (a: typeof evaluated[number], b: typeof evaluated[number]) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.centerYError !== b.centerYError) return a.centerYError - b.centerYError;
    if (a.centerXError !== b.centerXError) return a.centerXError - b.centerXError;
    if (b.thinAxisCameraAlignment !== a.thinAxisCameraAlignment) return b.thinAxisCameraAlignment - a.thinAxisCameraAlignment;
    if (b.wideAxisScreenAlignment !== a.wideAxisScreenAlignment) return b.wideAxisScreenAlignment - a.wideAxisScreenAlignment;
    if (a.frontPlaneMode !== b.frontPlaneMode) return a.frontPlaneMode === 'minZ' ? -1 : 1;
    if (a.forwardSign !== b.forwardSign) return a.forwardSign === -1 ? -1 : 1;
    return a.index - b.index;
  };

  const valid = evaluated.filter((candidate) => !candidate.rejected).sort(compare);
  if (valid.length > 0) {
    const selected = valid[0];
    const runnerUp = valid[1];
    return {
      selected,
      selectedRoot: candidates[selected.index].root,
      placementCandidates: evaluated.map(({ centerXError: _cx, centerYError: _cy, ...rest }) => rest),
      selectedCandidateRejectMargin: runnerUp ? Number((selected.score - runnerUp.score).toFixed(6)) : Number(selected.score.toFixed(6)),
      warnings: [] as string[],
    };
  }

  const fallback = [...evaluated].sort((a, b) => {
    const fallbackPriority = (candidate: typeof evaluated[number]) => {
      if (candidate.accessoryAheadOfHead && candidate.projectedAspectRatio >= 2.2) return 0;
      if (candidate.accessoryAheadOfHead && candidate.projectedAspectRatio >= 1.8) return 1;
      if (candidate.accessoryAheadOfHead) return 2;
      if (candidate.rejectReason === 'projected_aspect_too_tall') return 3;
      if (candidate.rejectReason === 'thin_axis_not_camera_aligned') return 4;
      if (candidate.rejectReason === 'behind_head_center') return 5;
      if (candidate.rejectReason === 'out_of_frame') return 6;
      return 7;
    };
    if (fallbackPriority(a) !== fallbackPriority(b)) {
      return fallbackPriority(a) - fallbackPriority(b);
    }
    return compare(a, b);
  })[0];

  return {
    selected: fallback,
    selectedRoot: candidates[fallback.index].root,
    placementCandidates: evaluated.map(({ centerXError: _cx, centerYError: _cy, ...rest }) => rest),
    selectedCandidateRejectMargin: 0,
    warnings: ['no_valid_glasses_candidate'],
  };
}

export function AccessoryRenderScene({
  spec,
  specPath,
  baseAvatarUrl,
  accessoryUrl,
  onResult,
}: AccessoryRenderSceneProps) {
  const [baseScene, setBaseScene] = useState<THREE.Object3D | null>(null);
  const { camera, size } = useThree();
  const accessoryRef = useRef<THREE.Object3D | null>(null);
  const vrmRef = useRef<VRM | null>(null);
  const anchorRef = useRef<THREE.Object3D | null>(null);
  const loadedStateRef = useRef<LoadedState | null>(null);
  const emittedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    accessoryRef.current = null;
    vrmRef.current = null;
    anchorRef.current = null;
    loadedStateRef.current = null;
    emittedKeyRef.current = null;

    async function load() {
      const warnings: string[] = [];
      try {
        const vrm = await loadVRM(baseAvatarUrl);
        if (cancelled) return;
        const accessoryRoot = await loadGLB(accessoryUrl);
        if (cancelled) return;

        const requestedAnchor = spec.anchorBone;
        const anchor = resolveAnchorBone(vrm, requestedAnchor);
        const placementParent = anchor ?? vrm.scene;
        const eyeNodes = resolveEyeNodes(vrm);
        const headMetrics = anchor ? collectHeadMetrics(anchor, eyeNodes) : undefined;

        let renderMetadata: RenderMetadata;
        let glassesCandidates: GlassesPlacementCandidate[] | undefined;
        let defaultPlacementRoot: THREE.Group | undefined;
        if (spec.category === 'glasses' && headMetrics) {
          const built = buildGlassesPlacementCandidates(accessoryRoot, spec, headMetrics);
          glassesCandidates = built.candidates;
          renderMetadata = built.renderMetadata;
        } else {
          const built = buildDefaultPlacement(accessoryRoot, spec);
          defaultPlacementRoot = built.placementRoot;
          renderMetadata = built.renderMetadata;
        }

        let resolvedAnchorName: string | null = null;
        if (anchor) {
          resolvedAnchorName = anchor.name || requestedAnchor;
        } else {
          resolvedAnchorName = requestedAnchor;
          warnings.push('anchor_bone_not_found');
        }

        if (defaultPlacementRoot) {
          placementParent.add(defaultPlacementRoot);
          accessoryRef.current = defaultPlacementRoot;
        }

        vrmRef.current = vrm;
        anchorRef.current = anchor;
        setBaseScene(vrm.scene);
        loadedStateRef.current = {
          requestedAnchor,
          resolvedAnchorName,
          warnings,
          renderMetadata,
          headMetrics,
          placementParent,
          glassesCandidates,
          selectedPlacementRoot: defaultPlacementRoot,
          selectionResolved: !glassesCandidates,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'render_failed';
        onResult({
          ok: false,
          stage: 'failed',
          specPath,
          inFrame: false,
          projectedBBox: null,
          projectedAreaRatio: null,
          anchorBoneRequested: spec.anchorBone,
          anchorBoneResolved: null,
          warnings,
          error: message,
        });
      }
    }

    load();

    return () => {
      cancelled = true;
      const currentAccessory = accessoryRef.current;
      if (currentAccessory?.parent) {
        currentAccessory.parent.remove(currentAccessory);
      }
      loadedStateRef.current?.glassesCandidates?.forEach((candidate) => {
        if (candidate.root.parent) {
          candidate.root.parent.remove(candidate.root);
        }
      });
      accessoryRef.current = null;
      vrmRef.current = null;
      anchorRef.current = null;
    };
  }, [accessoryUrl, baseAvatarUrl, onResult, spec, specPath]);

  useFrame((_, delta) => {
    vrmRef.current?.update(delta);

    if (!loadedStateRef.current) {
      return;
    }

    const state = loadedStateRef.current;
    const headMetrics = state.headMetrics;
    const anchorWorldPosition = anchorRef.current
      ? (() => {
          const position = new THREE.Vector3();
          anchorRef.current.getWorldPosition(position);
          return toTuple3(position);
        })()
      : undefined;

    if (!state.selectionResolved && spec.category === 'glasses' && state.glassesCandidates && headMetrics) {
      const targetInfo = resolveRenderTarget(state.placementParent, anchorRef.current, spec.category, headMetrics);
      stabilizeProjectionState(
        state.placementParent,
        camera,
        targetInfo.target,
        spec.cameraDistance ?? 1.8,
        spec.cameraView,
      );

      const selection = selectGlassesCandidate(
        state.glassesCandidates,
        state.placementParent,
        anchorRef.current,
        spec,
        headMetrics,
        camera,
        size.width,
        size.height,
      );
      state.placementParent.add(selection.selectedRoot);
      accessoryRef.current = selection.selectedRoot;
      state.selectedPlacementRoot = selection.selectedRoot;
      state.selectionResolved = true;
      state.warnings = [...state.warnings, ...selection.warnings];
      state.renderMetadata = {
        ...state.renderMetadata,
        placementCandidates: selection.placementCandidates,
        selectedCandidateIndex: selection.selected.index,
        selectedFrontPlaneMode: selection.selected.frontPlaneMode,
        selectedForwardSign: selection.selected.forwardSign,
        selectedRotationLabel: selection.selected.rotationLabel,
        selectedScore: selection.selected.score,
        selectedCandidateRejectMargin: selection.selectedCandidateRejectMargin,
        recenterOffset: selection.selected.recenterOffset,
        finalOffset: selection.selected.finalOffset,
        finalRotation: selection.selected.finalRotation,
        glassesVisualAnchorY: selection.selected.visualAnchorY,
        glassesTempleAnchorY: selection.selected.templeAnchorY,
        glassesSemanticAnchorSource: selection.selected.semanticAnchorSource,
        glassesSemanticSampleCount: selection.selected.semanticSampleCount,
        baseScale: selection.selected.baseScale,
        autoFitScale: selection.selected.autoFitScale,
        finalScale: selection.selected.finalScale,
        frontPlaneZ: selection.selected.frontPlaneMode === 'maxZ'
          ? state.renderMetadata.assetBounds?.max[2]
          : state.renderMetadata.assetBounds?.min[2],
      };
    }

    const currentAccessory = accessoryRef.current;
    if (!currentAccessory) {
      return;
    }

    const targetInfo = resolveRenderTarget(currentAccessory, anchorRef.current, spec.category, headMetrics);
    stabilizeProjectionState(
      state.placementParent,
      camera,
      targetInfo.target,
      spec.cameraDistance ?? 1.8,
      spec.cameraView,
    );

    const visibility = buildProjectedVisibility(currentAccessory, camera, size.width, size.height);
    const warnings = [...state.warnings, ...visibility.warnings];
    const worldBoundsMetadata = computeWorldBoundsMetadata(currentAccessory);
    const headProjection = headMetrics
      ? buildProjectedBoxFromBounds(headMetrics.bounds, camera, size.width, size.height)
      : null;
    const accessoryWorldCenter = worldBoundsMetadata.accessoryWorldCenter;
    const accessoryAheadOfHead = Boolean(
      accessoryWorldCenter &&
      headMetrics &&
      accessoryWorldCenter[2] > headMetrics.centerWorld[2],
    );
    const depthDeltaZ = accessoryWorldCenter && headMetrics
      ? Number((accessoryWorldCenter[2] - headMetrics.centerWorld[2]).toFixed(6))
      : undefined;
    const targetProjected = targetInfo.target.clone().project(camera);
    const targetScreenX = Number((((targetProjected.x + 1) / 2) * size.width).toFixed(6));
    const targetScreenY = Number((((1 - targetProjected.y) / 2) * size.height).toFixed(6));

    const payload: AccessoryRenderResult = {
      ok: true,
      stage: 'ready',
      specPath,
      inFrame: visibility.inFrame,
      projectedBBox: visibility.projectedBBox,
      projectedAreaRatio: visibility.projectedAreaRatio,
      anchorBoneRequested: state.requestedAnchor,
      anchorBoneResolved: state.resolvedAnchorName,
      warnings,
      error: null,
      ...state.renderMetadata,
      anchorWorldPosition,
      renderTarget: toTuple3(targetInfo.target),
      renderTargetSource: targetInfo.source,
      headProjectedWidth: headProjection ? headProjection.projectedWidth : undefined,
      targetScreenX,
      targetScreenY,
      accessoryAheadOfHead,
      depthDeltaZ,
      ...worldBoundsMetadata,
    };
    const emittedKey = JSON.stringify(payload);
    if (emittedKey === emittedKeyRef.current) {
      return;
    }
    emittedKeyRef.current = emittedKey;
    onResult(payload);
  });

  const background = useMemo(() => {
    if (spec.background === 'transparent') {
      return null;
    }
    return new THREE.Color(spec.background);
  }, [spec.background]);

  return (
    <>
      {background ? <color attach="background" args={[background]} /> : null}
      <ambientLight intensity={1.15} />
      <directionalLight position={[2.5, 3, 2]} intensity={2.2} />
      <directionalLight position={[-2, 1.5, -2]} intensity={0.65} />
      {baseScene ? <primitive object={baseScene} /> : null}
    </>
  );
}
