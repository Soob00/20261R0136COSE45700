'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getBaseVRM } from '@/lib/vrm-ref';
import { loadGLB } from '@/lib/glb-loader';
import { useEditorStore } from '@/stores/editorStore';
import {
  resolveAccessoryAttachment,
  resolveAccessoryRuntimePreset,
  type ResolvedAccessoryAttachment,
} from '@/lib/accessory-attachment';
import type { AccessoryInstance } from '@/lib/accessory-attachment';
import type { VRM } from '@pixiv/three-vrm';

interface AttachedAccessoryState {
  instanceId: string;
  group: THREE.Group;
  assetUrl: string;
  anchorBone: string;
  resolvedTransformKey: string;
}

function resolveAccessoryAssetUrl(assetModelPath: string): string {
  if (/^(https?:)?\/\//i.test(assetModelPath) || assetModelPath.startsWith('/')) {
    return assetModelPath;
  }
  return `/api/accessory-render/file?path=${encodeURIComponent(assetModelPath)}`;
}

function resolveAnchorObject(vrm: VRM, requestedName: string): THREE.Object3D {
  const humanoid = (vrm as VRM & { humanoid?: { humanBones?: Record<string, { node?: THREE.Object3D }> } }).humanoid;
  
  // 1. Check standard VRM humanoid bone first
  const humanoidNode = humanoid?.humanBones?.[requestedName]?.node;
  if (humanoidNode) {
    return humanoidNode;
  }

  // 2. Fallback to exact object name match
  let found: THREE.Object3D | null = null;
  vrm.scene.traverse((object) => {
    if (!found && object.name === requestedName) {
      found = object;
    }
  });

  if (found) {
    return found;
  }

  const headNode = humanoid?.humanBones?.head?.node ?? null;
  if (headNode) {
    console.warn(`[AccessoryAttachment] anchor "${requestedName}" not found, fallback to head`);
    return headNode;
  }

  console.warn(`[AccessoryAttachment] anchor "${requestedName}" not found, fallback to vrm.scene`);
  return vrm.scene;
}

function buildTransformKey(resolved: ResolvedAccessoryAttachment): string {
  return JSON.stringify({
    anchorBone: resolved.anchorBone,
    scale: resolved.finalTransform.scale,
    rotation: resolved.finalTransform.rotation,
    offset: resolved.finalTransform.offset,
  });
}

function applyResolvedTransform(group: THREE.Group, resolved: ResolvedAccessoryAttachment): void {
  group.scale.set(
    resolved.finalTransform.scale[0],
    resolved.finalTransform.scale[1],
    resolved.finalTransform.scale[2],
  );
  group.rotation.set(
    THREE.MathUtils.degToRad(resolved.finalTransform.rotation[0]),
    THREE.MathUtils.degToRad(resolved.finalTransform.rotation[1]),
    THREE.MathUtils.degToRad(resolved.finalTransform.rotation[2]),
  );
  group.position.set(
    resolved.finalTransform.offset[0],
    resolved.finalTransform.offset[1],
    resolved.finalTransform.offset[2],
  );
}

export function AccessoryAttachment() {
  const { scene } = useThree();
  const attachedRef = useRef<Map<string, AttachedAccessoryState>>(new Map());
  const dirtyRef = useRef(true);
  const reconcilingRef = useRef(false);
  const reconcileTokenRef = useRef(0);

  useEffect(() => {
    const unsubscribe = useEditorStore.subscribe(() => {
      dirtyRef.current = true;
    });

    return () => {
      unsubscribe();
      for (const attached of attachedRef.current.values()) {
        attached.group.parent?.remove(attached.group);
      }
      attachedRef.current.clear();
    };
  }, [scene]);

  useFrame(() => {
    if (!dirtyRef.current || reconcilingRef.current) {
      return;
    }

    const baseVrm = getBaseVRM();
    if (!baseVrm) {
      return;
    }

    dirtyRef.current = false;
    reconcilingRef.current = true;
    const token = ++reconcileTokenRef.current;

    const reconcile = async () => {
      try {
        const state = useEditorStore.getState();
        const desiredInstances = state.accessoryInstances.filter((instance) => instance.enabled);
        const desiredById = new Map<string, AccessoryInstance>(
          desiredInstances.map((instance) => [instance.instanceId, instance]),
        );

        for (const [instanceId, attached] of attachedRef.current.entries()) {
          if (!desiredById.has(instanceId)) {
            console.log(`[AccessoryAttachment] remove instance=${instanceId}`);
            attached.group.parent?.remove(attached.group);
            attachedRef.current.delete(instanceId);
          }
        }

        for (const instance of desiredInstances) {
          try {
            const runtimePreset = resolveAccessoryRuntimePreset(instance.presetId, instance.category);
            if (!runtimePreset?.assetModelPath) {
              console.warn(
                `[AccessoryAttachment] preset resolve failed presetId=${instance.presetId} category=${instance.category}`,
              );
              const existing = attachedRef.current.get(instance.instanceId);
              if (existing) {
                existing.group.parent?.remove(existing.group);
                attachedRef.current.delete(instance.instanceId);
              }
              continue;
            }

            const resolved = resolveAccessoryAttachment(instance, runtimePreset.attachment);
            const assetUrl = resolveAccessoryAssetUrl(runtimePreset.assetModelPath);
            const transformKey = buildTransformKey(resolved);
            const existing = attachedRef.current.get(instance.instanceId);

            if (
              existing &&
              existing.assetUrl === assetUrl &&
              existing.anchorBone === resolved.anchorBone &&
              existing.resolvedTransformKey === transformKey
            ) {
              continue;
            }

            if (existing) {
              console.log(`[AccessoryAttachment] update instance=${instance.instanceId}`);
              existing.group.parent?.remove(existing.group);
              attachedRef.current.delete(instance.instanceId);
            } else {
              console.log(`[AccessoryAttachment] add instance=${instance.instanceId}`);
            }

            const loadedGroup = await loadGLB(assetUrl);
            if (token !== reconcileTokenRef.current) {
              return;
            }

            loadedGroup.traverse((object) => {
              const mesh = object as THREE.Mesh;
              if (mesh.isMesh) {
                mesh.frustumCulled = false;
              }
            });

            // 1. Auto Normalization (Scale to 1.0, Center Pivot)
            const box = new THREE.Box3().setFromObject(loadedGroup);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            const normalizedRoot = new THREE.Group();
            normalizedRoot.name = `NormalizedRoot:${instance.instanceId}`;

            const maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim > 0) {
              normalizedRoot.scale.setScalar(1.0 / maxDim);
            }
            
            loadedGroup.position.copy(center).multiplyScalar(-1);
            normalizedRoot.add(loadedGroup);

            // 2. Apply Preset/Instance Transform
            const attachmentRoot = new THREE.Group();
            attachmentRoot.name = `AccessoryAttachmentRoot:${instance.instanceId}`;
            applyResolvedTransform(attachmentRoot, resolved);
            attachmentRoot.add(normalizedRoot);

            const anchorObject = resolveAnchorObject(baseVrm, resolved.anchorBone);

            // 3. Dynamic Bone Length Offset (e.g., slide down forearm to wrist)
            const isLeftArm = resolved.anchorBone === 'leftLowerArm';
            const isRightArm = resolved.anchorBone === 'rightLowerArm';
            if (isLeftArm || isRightArm) {
              const childBoneName = isLeftArm ? 'leftHand' : 'rightHand';
              const childObject = resolveAnchorObject(baseVrm, childBoneName);
              if (childObject && childObject !== anchorObject) {
                const wristOffset = childObject.position.clone();
                wristOffset.multiplyScalar(0.9); // Place at 90% of forearm length
                attachmentRoot.position.add(wristOffset);
              }
            }

            anchorObject.add(attachmentRoot);

            attachedRef.current.set(instance.instanceId, {
              instanceId: instance.instanceId,
              group: attachmentRoot,
              assetUrl,
              anchorBone: resolved.anchorBone,
              resolvedTransformKey: transformKey,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown_error';
            console.warn(
              `[AccessoryAttachment] load failed instance=${instance.instanceId} presetId=${instance.presetId}: ${message}`,
            );
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown_error';
        console.warn(`[AccessoryAttachment] reconcile failed: ${message}`);
      } finally {
        reconcilingRef.current = false;
        if (dirtyRef.current) {
          return;
        }
      }
    };

    void reconcile();
  });

  return null;
}
