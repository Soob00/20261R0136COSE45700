import type { VRM } from '@pixiv/three-vrm';
import type { MToonMaterial } from '@pixiv/three-vrm-materials-mtoon';
import * as THREE from 'three';

// `instanceof MToonMaterial` can fail across bundler chunk boundaries (duplicate
// module instances), so detect MToon materials by their `isMToonMaterial` flag instead.
function isMToonMaterial(mat: THREE.Material): mat is MToonMaterial {
  return (mat as { isMToonMaterial?: boolean }).isMToonMaterial === true;
}

export interface DetectedMaterial {
  slotName: string;
  label: string;
  category: 'skin' | 'hair' | 'eye' | 'cloth' | 'other';
  color: string; // hex
  shadingToony: number; // 0~1, 카툰 음영 강도 (0: 부드러운 그라데이션, 1: 또렷한 경계)
  shadingShift: number; // -1~1, 명암 경계 위치 이동
  rimLightingMix: number; // 0~1, 림 라이트(외곽광) 혼합 비율
  linkedSlots?: string[];
}

// ---- Helpers ----

function colorToHex(color: THREE.Color): string {
  return '#' + color.getHexString();
}

function hexToColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

function isEyeOrHairMaterial(matName: string): boolean {
  const n = matName.toLowerCase();
  // Only exclude materials that are CLEARLY eye or hair
  return /\beye\b|iris|pupil|cornea|sclera|eyeball|hair|bangs|wig|strand|fringe|tress|locks|mane|髪/i.test(n) && !/eyebrow|eyelash|eyelid/i.test(n);
}

function classifyMaterial(matName: string, meshName: string): DetectedMaterial['category'] {
  const n = (matName + ' ' + meshName).toLowerCase();
  if (/\beye\b|iris|pupil|cornea|sclera|eyeball/i.test(n) && !/eyebrow|eyelash|eyelid/i.test(n)) return 'eye';
  if (/hair|bangs|ponytail|braid|wig|strand|fringe|tress|locks|mane|髪/i.test(n)) return 'hair';
  if (/cloth|shirt|pant|dress|outfit|jacket|shoe|boot|sock|glove|hat|skirt|belt|uniform|costume/i.test(n)) return 'cloth';
  if (/skin|face|body|neck|arm|leg|hand|foot|feet|head|torso|chest|finger|toe|ear|nose|lip|cheek|chin|jaw|forehead|shoulder|elbow|knee|ankle|wrist|flesh|brow|mouth/i.test(n)) return 'skin';
  return 'other';
}

function categoryLabel(cat: DetectedMaterial['category']): string {
  return { skin: '피부', hair: '머리카락', eye: '눈동자', cloth: '의상', other: '기타' }[cat] ?? cat;
}

/**
 * Collect EVERY material reference from the VRM scene.
 * Returns an array of { mat, meshName } for every material on every mesh.
 */
function collectAllMaterialRefs(vrm: VRM): { mat: THREE.Material; meshName: string }[] {
  const results: { mat: THREE.Material; meshName: string }[] = [];

  vrm.scene.traverse((object) => {
    // Check for any object that has a material property
    const obj = object as unknown as { isMesh?: boolean; isSkinnedMesh?: boolean; material?: THREE.Material | THREE.Material[]; name: string };
    if (!obj.material) return;

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (mat) {
        results.push({ mat, meshName: obj.name || '' });
      }
    }
  });

  return results;
}

// ---- Public API ----

export function detectMaterials(vrm: VRM): DetectedMaterial[] {
  const allRefs = collectAllMaterialRefs(vrm);

  console.log(`[Materials] Found ${allRefs.length} total material refs across all meshes`);

  // Deduplicate by name for UI display
  const matMap = new Map<string, {
    mat: THREE.Material;
    meshNames: string[];
    category: DetectedMaterial['category'];
  }>();

  for (const { mat, meshName } of allRefs) {
    const name = mat.name || `unnamed_${mat.uuid.slice(0, 8)}`;
    const existing = matMap.get(name);
    if (existing) {
      if (!existing.meshNames.includes(meshName)) {
        existing.meshNames.push(meshName);
      }
    } else {
      matMap.set(name, {
        mat,
        meshNames: [meshName],
        category: classifyMaterial(name, meshName),
      });
    }
  }

  // Build results
  const results: DetectedMaterial[] = [];
  const skinSlots: string[] = [];

  for (const [name, { mat, category }] of matMap) {
    let color = '#ffffff';
    let shadingToony = 0.9;
    let shadingShift = 0;
    let rimLightingMix = 1;

    if (isMToonMaterial(mat)) {
      color = mat.color ? colorToHex(mat.color) : '#ffffff';
      shadingToony = mat.shadingToonyFactor ?? 0.9;
      shadingShift = mat.shadingShiftFactor ?? 0;
      rimLightingMix = mat.rimLightingMixFactor ?? 1;
    } else {
      const std = mat as THREE.MeshStandardMaterial;
      if (std.color) color = colorToHex(std.color);
    }

    results.push({
      slotName: name,
      label: `${categoryLabel(category)} (${name})`,
      category,
      color,
      shadingToony,
      shadingShift,
      rimLightingMix,
    });

    if (category === 'skin') skinSlots.push(name);
  }

  // Link all skin
  if (skinSlots.length > 1) {
    for (const r of results) {
      if (r.category === 'skin') {
        r.linkedSlots = skinSlots.filter((s) => s !== r.slotName);
      }
    }
  }

  const order: Record<string, number> = { skin: 0, hair: 1, eye: 2, cloth: 3, other: 4 };
  results.sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9));

  // Detailed debug log
  for (const [name, { category, meshNames }] of matMap) {
    console.log(`[Materials] ${category.padEnd(6)} | "${name}" | meshes: ${meshNames.join(', ')}`);
  }

  return results;
}

/**
 * Apply skin color to ALL materials on the VRM, EXCEPT clearly eye/hair materials.
 * This is the nuclear approach - any material that isn't clearly non-skin gets recolored.
 */
export function applySkinColor(vrm: VRM, hex: string): void {
  const newColor = hexToColor(hex);
  const darkColor = newColor.clone().multiplyScalar(0.7);
  const details: string[] = [];

  vrm.scene.traverse((object) => {
    const obj = object as unknown as { material?: THREE.Material | THREE.Material[]; name?: string };
    if (!obj.material) return;

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (let i = 0; i < mats.length; i++) {
      const mat = mats[i];
      if (!mat) continue;

      const meshName = obj.name || '?';
      const matType = mat.constructor.name;

      // Only skip materials that are CLEARLY eye or hair
      if (isEyeOrHairMaterial(mat.name)) {
        details.push(`SKIP ${matType} "${mat.name}" on "${meshName}"`);
        continue;
      }

      // Try every possible way to set the color
      let success = false;

      // Method 1: MToonMaterial specific
      if (isMToonMaterial(mat)) {
        mat.color.set(newColor);
        if (mat.shadeColorFactor) mat.shadeColorFactor.set(darkColor);
        // Direct uniform manipulation
        const u = mat.uniforms as Record<string, { value: unknown }> | undefined;
        if (u) {
          for (const key of Object.keys(u)) {
            const val = u[key]?.value;
            if (val instanceof THREE.Color) {
              const kl = key.toLowerCase();
              if (kl.includes('shade')) {
                val.set(darkColor);
              } else if (kl.includes('lit') || kl.includes('color') || kl.includes('diffuse')) {
                val.set(newColor);
              }
            }
          }
        }
        mat.uniformsNeedUpdate = true;
        mat.needsUpdate = true;
        success = true;
      }

      // Method 2: Standard material color property
      const anyMat = mat as unknown as Record<string, unknown>;
      if (anyMat.color && anyMat.color instanceof THREE.Color) {
        (anyMat.color as THREE.Color).set(newColor);
        mat.needsUpdate = true;
        success = true;
      }

      // Method 3: For ShaderMaterial that isn't MToon
      if ('uniforms' in mat) {
        const shaderMat = mat as THREE.ShaderMaterial;
        if (shaderMat.uniforms) {
          for (const key of Object.keys(shaderMat.uniforms)) {
            const val = shaderMat.uniforms[key]?.value;
            if (val instanceof THREE.Color) {
              const kl = key.toLowerCase();
              if (!kl.includes('shade') && !kl.includes('emission') && !kl.includes('rim') && !kl.includes('outline')) {
                val.set(newColor);
              } else if (kl.includes('shade')) {
                val.set(darkColor);
              }
            }
          }
          shaderMat.uniformsNeedUpdate = true;
          success = true;
        }
      }

      details.push(`${success ? 'OK' : 'FAIL'} ${matType} "${mat.name}" on "${meshName}"`);
    }
  });

  console.log(`[Skin] Color → ${hex}, ${details.length} materials processed:`);
  for (const d of details) console.log(`  ${d}`);
}

/**
 * Apply color to a specific named material slot (non-skin).
 */
export function applyMaterialColor(vrm: VRM, slotName: string, hex: string, isSkin = false): void {
  if (isSkin) {
    applySkinColor(vrm, hex);
    return;
  }

  const newColor = hexToColor(hex);

  vrm.scene.traverse((object) => {
    const obj = object as unknown as { material?: THREE.Material | THREE.Material[] };
    if (!obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat || mat.name !== slotName) continue;

      if (isMToonMaterial(mat)) {
        mat.color.copy(newColor);
        if (mat.uniforms?.['litFactor']) mat.uniforms['litFactor'].value.copy(newColor);
        mat.uniformsNeedUpdate = true;
        mat.needsUpdate = true;
      } else if ('color' in mat && (mat as THREE.MeshStandardMaterial).color) {
        (mat as THREE.MeshStandardMaterial).color.copy(newColor);
        mat.needsUpdate = true;
      }
    }
  });
}

export function applyMaterialProperty(
  vrm: VRM,
  slotName: string,
  property: 'shadingToony' | 'shadingShift' | 'rimLightingMix',
  value: number
): void {
  vrm.scene.traverse((object) => {
    const obj = object as unknown as { material?: THREE.Material | THREE.Material[] };
    if (!obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat || mat.name !== slotName) continue;
      if (!isMToonMaterial(mat)) continue;

      if (property === 'shadingToony') {
        mat.shadingToonyFactor = value;
      } else if (property === 'shadingShift') {
        mat.shadingShiftFactor = value;
      } else if (property === 'rimLightingMix') {
        mat.rimLightingMixFactor = value;
      }
      mat.uniformsNeedUpdate = true;
      mat.needsUpdate = true;
    }
  });
}

/** Pipeline output key → VRM material name regex */
export const PIPELINE_TEXTURE_PATTERNS: Record<string, RegExp> = {
  'BaseTexture_Generate_Face': /Face_00_SKIN/i,
  'BaseTexture_Generate_Eyebrow': /FaceBrow|Brow_00_FACE/i,
  'BaseTexture_Generate_Eyeline': /FaceEyeline|Eyeline_00_FACE/i,
  'BaseTexture_Generate_Pupil': /EyeIris|Iris_00_EYE/i,
  'BaseTexture_Static_EyeWhite': /EyeWhite/i,
  'BaseTexture_Static_EyeHighlight': /EyeHighlight/i,
  'BaseTexture_Static_MouthInside': /FaceMouth|Mouth_00_FACE/i,
};

/**
 * Apply a texture (from data URL) to a named material slot on the VRM.
 * Backs up the original map to `userData._origMap` for undo support.
 */
export function applyMaterialTexture(
  vrm: VRM,
  slotName: string,
  dataUrl: string,
): void {
  const loader = new THREE.TextureLoader();
  const newTexture = loader.load(dataUrl);
  newTexture.flipY = false;
  newTexture.colorSpace = THREE.SRGBColorSpace;

  // Use regex pattern for pipeline texture keys, exact match otherwise
  const pattern = PIPELINE_TEXTURE_PATTERNS[slotName];
  const matches = (matName: string) =>
    pattern ? pattern.test(matName) : matName === slotName;

  vrm.scene.traverse((object) => {
    const obj = object as unknown as { material?: THREE.Material | THREE.Material[] };
    if (!obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat || !matches(mat.name)) continue;

      const anyMat = mat as THREE.MeshStandardMaterial;

      // Backup original texture for undo
      if (!mat.userData._origMap) {
        mat.userData._origMap = anyMat.map ?? null;
      }

      // Dispose previous non-original texture
      if (anyMat.map && anyMat.map !== mat.userData._origMap) {
        anyMat.map.dispose();
      }

      anyMat.map = newTexture;
      anyMat.needsUpdate = true;
    }
  });
}

/**
 * Remove applied texture from a slot, restoring the original.
 */
export function removeMaterialTexture(vrm: VRM, slotName: string): void {
  const pattern = PIPELINE_TEXTURE_PATTERNS[slotName];
  const matches = (matName: string) =>
    pattern ? pattern.test(matName) : matName === slotName;

  vrm.scene.traverse((object) => {
    const obj = object as unknown as { material?: THREE.Material | THREE.Material[] };
    if (!obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat || !matches(mat.name)) continue;

      const anyMat = mat as THREE.MeshStandardMaterial;
      if (mat.userData._origMap !== undefined) {
        // Dispose current texture if it differs from original
        if (anyMat.map && anyMat.map !== mat.userData._origMap) {
          anyMat.map.dispose();
        }
        anyMat.map = mat.userData._origMap;
        delete mat.userData._origMap;
        anyMat.needsUpdate = true;
      }
    }
  });
}

// Preset color palettes
export const COLOR_PRESETS = {
  skin: [
    '#FFE0BD', '#FFCD94', '#F5C38E',
    '#E0A370', '#C68642', '#8D5524',
  ],
  eye: [
    '#3B2716', '#634E34', '#2E86AB',
    '#2E8B57', '#8B4513', '#4A0080',
    '#1A1A2E', '#C0C0C0',
  ],
  hair: [
    '#090806', '#2C222B', '#71635A',
    '#B7A69E', '#D6C4C2', '#B55239',
    '#8D4A43', '#91672C', '#E6CEA8',
    '#DEBA13',
  ],
} as const;
