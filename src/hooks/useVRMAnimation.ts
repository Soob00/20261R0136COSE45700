import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

interface GltfData {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  restWorldMap: Map<string, THREE.Quaternion>;
  hipRestWorldPos: THREE.Vector3;
  animatedBonesByClip: Set<string>[];
}

interface AnimState {
  mixer: THREE.AnimationMixer;
  animatedBoneNames: Set<string>;
}

/** Extract the Y-axis twist component of a quaternion (swing-twist decomposition). */
function yTwist(q: THREE.Quaternion): THREE.Quaternion {
  const tw = new THREE.Quaternion(0, q.y, 0, q.w);
  return tw.lengthSq() < 1e-10 ? new THREE.Quaternion() : tw.normalize();
}

function getVrmParentWorldQ(
  bone: THREE.Object3D,
  vrmWorldMap: Map<string, THREE.Quaternion>,
): THREE.Quaternion {
  let node = bone.parent;
  while (node) {
    const q = vrmWorldMap.get(node.name);
    if (q) return q.clone();
    node = node.parent;
  }
  return new THREE.Quaternion();
}

export function useVRMAnimation(
  vrm: VRM | null,
  animationUrl: string | null,
  animationIndex = 0,
  onClipsLoaded?: (names: string[]) => void,
) {
  const gltfRef = useRef<GltfData | null>(null);
  const stateRef = useRef<AnimState | null>(null);
  const animationIndexRef = useRef(animationIndex);

  // VRM hip bone rest position — captured once so we can compute position deltas.
  const vrmHipRestPosRef = useRef<THREE.Vector3 | null>(null);
  useEffect(() => {
    if (!vrm) return;
    const hip = vrm.scene.getObjectByName('J_Bip_C_Hips');
    if (hip) vrmHipRestPosRef.current = hip.position.clone();
  }, [vrm]);

  // ── Load GLB once per URL ──────────────────────────────────────────────────
  useEffect(() => {
    if (!vrm || !animationUrl) return;

    const loader = new GLTFLoader();
    let cancelled = false;

    loader.loadAsync(animationUrl).then((gltf) => {
      if (cancelled) return;
      if (!gltf.animations.length) {
        console.warn('[VRMAnimation] No animations:', animationUrl);
        return;
      }

      const animScene = gltf.scene;
      animScene.updateMatrixWorld(true);

      // Rest-pose world quaternions for every J_Bip_* bone.
      const restWorldMap = new Map<string, THREE.Quaternion>();
      animScene.traverse((obj) => {
        if (obj.name.startsWith('J_Bip_')) {
          const q = new THREE.Quaternion();
          obj.getWorldQuaternion(q);
          restWorldMap.set(obj.name, q.clone());
        }
      });

      // Hip rest world position (Armature scale=100 → getWorldPosition returns meters).
      const hipBone = animScene.getObjectByName('J_Bip_C_Hips');
      const hipRestWorldPos = new THREE.Vector3();
      hipBone?.getWorldPosition(hipRestWorldPos);

      // Which bones have animation tracks (per clip).
      const animatedBonesByClip = gltf.animations.map((clip) => {
        const names = new Set<string>();
        clip.tracks.forEach((t) => names.add(t.name.slice(0, t.name.lastIndexOf('.'))));
        return names;
      });

      // Finger animation diagnostic.
      const fingerKeywords = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
      const fingerFound: string[] = [];
      gltf.animations.forEach((clip) => {
        clip.tracks.forEach((t) => {
          if (fingerKeywords.some((k) => t.name.includes(k))) {
            fingerFound.push(`"${clip.name}": ${t.name}`);
          }
        });
      });
      if (fingerFound.length) {
        console.log('[VRMAnimation] Finger tracks found — will animate:', fingerFound);
      } else {
        console.log('[VRMAnimation] No finger animation tracks in GLB (손가락 트랙 없음).');
      }

      gltfRef.current = { scene: animScene, clips: gltf.animations, restWorldMap, hipRestWorldPos, animatedBonesByClip };
      onClipsLoaded?.(gltf.animations.map((c) => c.name));

      if (animationIndexRef.current >= 0) switchClip(animationIndexRef.current);
      console.log('[VRMAnimation] Loaded:', gltf.animations.map((c) => c.name));
    }).catch((err) => {
      if (!cancelled) console.error('[VRMAnimation] Load failed:', err);
    });

    return () => {
      cancelled = true;
      stateRef.current?.mixer.stopAllAction();
      stateRef.current = null;
      gltfRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrm, animationUrl]);

  // ── Handle index changes (including −1 = default pose) ────────────────────
  useEffect(() => {
    if (!vrm) return;
    animationIndexRef.current = animationIndex;

    if (animationIndex < 0) {
      // Default pose: re-enable VRM's own humanoid management.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (vrm.humanoid as any).autoUpdateHumanBones = true;
      stateRef.current?.mixer.stopAllAction();
      stateRef.current = null;
      vrm.scene.quaternion.copy(_faceForward);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vrm.humanoid as any).autoUpdateHumanBones = false;
    if (gltfRef.current) switchClip(animationIndex);

    return () => {
      // Restore humanoid management when vrm changes or component unmounts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (vrm.humanoid as any).autoUpdateHumanBones = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrm, animationIndex]);

  function switchClip(index: number) {
    const data = gltfRef.current;
    if (!data) return;
    const idx = Math.min(index, data.clips.length - 1);
    stateRef.current?.mixer.stopAllAction();
    const mixer = new THREE.AnimationMixer(data.scene);
    mixer.clipAction(data.clips[idx]).play();
    stateRef.current = { mixer, animatedBoneNames: data.animatedBonesByClip[idx] };
    console.log(`[VRMAnimation] Playing "${data.clips[idx].name}"`);
  }

  // ── Per-frame retargeting ──────────────────────────────────────────────────
  const _animWorldQ = new THREE.Quaternion();
  const _hipWorldPos = new THREE.Vector3();
  const _faceForward = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

  useFrame((_, delta) => {
    const state = stateRef.current;
    const data = gltfRef.current;
    if (!state || !data || !vrm) return;

    state.mixer.update(delta);
    data.scene.updateMatrixWorld(true);

    const vrmWorldMap = new Map<string, THREE.Quaternion>();

    data.scene.traverse((animObj) => {
      if (!animObj.name.startsWith('J_Bip_')) return;

      const vrmBone = vrm.scene.getObjectByName(animObj.name) as THREE.Object3D | null;
      if (!vrmBone) return;

      const parentWorldQ = getVrmParentWorldQ(vrmBone, vrmWorldMap);

      if (state.animatedBoneNames.has(animObj.name)) {
        // Animated bone: world-space delta = animWorldQ * inv(restWorldQ).
        animObj.getWorldQuaternion(_animWorldQ);
        const restWorldQ = data.restWorldMap.get(animObj.name);
        if (!restWorldQ) return;

        const deltaQ = _animWorldQ.clone().multiply(restWorldQ.clone().invert());
        vrmWorldMap.set(animObj.name, deltaQ.clone());
        vrmBone.quaternion.copy(parentWorldQ.clone().invert().multiply(deltaQ));

        if (animObj.name === 'J_Bip_C_Hips') {
          // ── Hip position: only Y delta (in-place + origin) ─────────────────
          if (vrmHipRestPosRef.current) {
            animObj.getWorldPosition(_hipWorldPos);
            const posDelta = _hipWorldPos.clone().sub(data.hipRestWorldPos);
            posDelta.x = 0; // strip X root motion
            posDelta.z = 0; // strip Z root motion
            vrmBone.position.copy(vrmHipRestPosRef.current).add(posDelta);
          }

          // ── Facing forward: cancel hip Y twist, then flip 180° to face -Z ──
          vrm.scene.quaternion.copy(yTwist(deltaQ).invert().multiply(_faceForward));
        }
      } else {
        // Unanimated bone (e.g. fingers): copy animation rest-pose local rotation.
        // The GLB bakes Unity's natural hand curl into these rotations.
        vrmBone.quaternion.copy(animObj.quaternion);
        vrmWorldMap.set(animObj.name, parentWorldQ.clone().multiply(animObj.quaternion));
      }
    });
  });
}
