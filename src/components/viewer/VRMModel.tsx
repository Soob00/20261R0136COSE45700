'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useVRM } from '@/hooks/useVRM';
import { useEditorStore } from '@/stores/editorStore';
import { setBaseVRM } from '@/lib/vrm-ref';
import { applyMaterialColor, applyMaterialProperty, applyMaterialTexture, detectMaterials } from '@/lib/vrm/materials';
import type { DetectedMaterial } from '@/lib/vrm/materials';
import type { VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';

interface VRMModelProps {
  url: string;
  onLoaded?: (
    expressionNames: string[],
    morphTargetNames: string[],
    boneNames: string[],
    detectedMaterials: DetectedMaterial[]
  ) => void;
}

export function VRMModel({ url, onLoaded }: VRMModelProps) {
  const { vrm, expressionNames, morphTargetNames, error } = useVRM(url);
  const vrmRef = useRef<VRM | null>(null);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const prevMaterialsRef = useRef<string>('');
  const prevMorphKeysRef = useRef<Set<string>>(new Set());
  // Track which slots are skin category
  const skinSlotsRef = useRef<Set<string>>(new Set());
  // Track applied texture URLs to avoid reloading
  const appliedTexturesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (vrm) {
      vrmRef.current = vrm;
      setBaseVRM(vrm);

      const boneNames: string[] = [];
      if (vrm.humanoid) {
        const humanBones = vrm.humanoid.humanBones;
        for (const boneName of Object.keys(humanBones)) {
          if (humanBones[boneName as keyof typeof humanBones]?.node) {
            boneNames.push(boneName);
          }
        }
      }

      const detectedMats = detectMaterials(vrm);

      // Cache skin slot names for use in useFrame
      skinSlotsRef.current = new Set(
        detectedMats.filter((m) => m.category === 'skin').map((m) => m.slotName)
      );

      // Blank out EyeHighlight texture — handled via stamps instead
      const blankCanvas = document.createElement('canvas');
      blankCanvas.width = 1; blankCanvas.height = 1;
      applyMaterialTexture(vrm, 'BaseTexture_Static_EyeHighlight', blankCanvas.toDataURL('image/png'));

      console.log('[VRM] Loaded successfully');
      console.log('[VRM] Expressions:', expressionNames);
      console.log('[VRM] MorphTargets:', morphTargetNames);
      console.log('[VRM] Bones:', boneNames);
      console.log('[VRM] Skin slots:', Array.from(skinSlotsRef.current));
      onLoadedRef.current?.(expressionNames, morphTargetNames, boneNames, detectedMats);
    }
    return () => {
      setBaseVRM(null);
    };
  }, [vrm, expressionNames, morphTargetNames]);

  // Hide/show VRM's built-in hair, outfit, and body meshes based on custom selections
  const prevHideHair = useRef(false);
  const prevHideOutfit = useRef(false);
  const prevHideBody = useRef(false);

  useFrame((_, delta) => {
    const currentVrm = vrmRef.current;
    if (!currentVrm) return;

    const { morphTargets, boneScales, materials, hairFrontUrl, hairBackUrl, outfitUrl } = useEditorStore.getState();

    // Toggle built-in hair visibility
    const hideHair = !!(hairFrontUrl || hairBackUrl);
    if (hideHair !== prevHideHair.current) {
      prevHideHair.current = hideHair;
      currentVrm.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          if (mat && /HAIR/i.test(mat.name)) {
            mesh.visible = !hideHair;
          }
        }
      });
    }

    // Toggle built-in outfit visibility
    const hideOutfit = !!outfitUrl;
    if (hideOutfit !== prevHideOutfit.current) {
      prevHideOutfit.current = hideOutfit;
      currentVrm.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          if (mat && /CLOTH/i.test(mat.name)) {
            mesh.visible = !hideOutfit;
          }
        }
      });
    }

    // Toggle base body skin visibility — the outfit VRM provides its own
    // fitted body mesh, so hide the base body to prevent poke-through.
    const hideBody = !!outfitUrl;
    if (hideBody !== prevHideBody.current) {
      prevHideBody.current = hideBody;
      currentVrm.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          // Hide body SKIN materials but keep face/eye SKIN visible
          if (mat && /SKIN/i.test(mat.name) && /Body/i.test(mat.name)) {
            mat.visible = !hideBody;
          }
        }
      });
    }

    // Separate expression-managed names from raw morph targets
    const expressionSet = new Set<string>();
    if (currentVrm.expressionManager) {
      for (const expr of currentVrm.expressionManager.expressions) {
        expressionSet.add(expr.expressionName);
      }
    }

    // Apply VRM Expression API (only for registered expressions)
    if (currentVrm.expressionManager) {
      for (const [name, value] of Object.entries(morphTargets)) {
        if (expressionSet.has(name)) {
          currentVrm.expressionManager.setValue(name, value);
        }
      }
    }

    // Apply bone scales via VRM Humanoid
    if (currentVrm.humanoid) {
      const humanBones = currentVrm.humanoid.humanBones;
      for (const [boneName, scale] of Object.entries(boneScales)) {
        const boneEntry = humanBones[boneName as keyof typeof humanBones];
        if (boneEntry?.node) {
          boneEntry.node.scale.set(scale.x, scale.y, scale.z);
        }
      }
    }

    // Apply material changes (only when changed to avoid per-frame overhead)
    const materialKey = JSON.stringify(materials);
    if (materialKey !== prevMaterialsRef.current) {
      prevMaterialsRef.current = materialKey;
      for (const [slotName, slot] of Object.entries(materials)) {
        const isSkin = skinSlotsRef.current.has(slotName);
        if (slot.color) {
          applyMaterialColor(currentVrm, slotName, slot.color as string, isSkin);
        }
        if (slot.shadingToony !== undefined) {
          applyMaterialProperty(currentVrm, slotName, 'shadingToony', slot.shadingToony as number);
        }
        if (slot.shadingShift !== undefined) {
          applyMaterialProperty(currentVrm, slotName, 'shadingShift', slot.shadingShift as number);
        }
        if (slot.rimLightingMix !== undefined) {
          applyMaterialProperty(currentVrm, slotName, 'rimLightingMix', slot.rimLightingMix as number);
        }
        // Apply texture if URL changed
        const textureUrl = slot.textureUrl as string | undefined;
        const prevUrl = appliedTexturesRef.current[slotName];
        if (textureUrl && textureUrl !== prevUrl) {
          applyMaterialTexture(currentVrm, slotName, textureUrl);
          appliedTexturesRef.current[slotName] = textureUrl;
        } else if (!textureUrl && prevUrl) {
          // Texture removed — clear tracking (restore handled by removeMaterialTexture if needed)
          delete appliedTexturesRef.current[slotName];
        }
      }
    }

    // Update VRM internals (expressions, spring bones, etc.)
    currentVrm.update(delta);

    // Track which morph keys were applied so we can reset removed ones on undo
    const currentMorphKeys = new Set(Object.keys(morphTargets));
    const removedKeys: string[] = [];
    for (const key of prevMorphKeysRef.current) {
      if (!currentMorphKeys.has(key)) {
        removedKeys.push(key);
      }
    }
    prevMorphKeysRef.current = currentMorphKeys;

    // Apply raw morphTargetInfluences (face_*, body_* from Blender)
    currentVrm.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        // Reset morph targets that were removed (e.g. by undo)
        for (const name of removedKeys) {
          if (!expressionSet.has(name)) {
            const index = mesh.morphTargetDictionary[name];
            if (index !== undefined) {
              mesh.morphTargetInfluences[index] = 0;
            }
          }
        }
        // Apply current morph targets
        for (const [name, value] of Object.entries(morphTargets)) {
          if (!expressionSet.has(name)) {
            const index = mesh.morphTargetDictionary[name];
            if (index !== undefined) {
              mesh.morphTargetInfluences[index] = value;
            }
          }
        }
      }
    });
  });

  if (error) {
    console.error('VRM load error:', error);
    return null;
  }

  if (!vrm) return null;

  return <primitive object={vrm.scene} />;
}
