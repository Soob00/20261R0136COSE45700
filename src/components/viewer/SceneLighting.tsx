'use client';

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';

export function SceneLighting() {
  const { scene } = useThree();

  useEffect(() => {
    // Dreamy pastel studio background — soft candy lavender/pink
    scene.background = new THREE.Color(0xfbeef6);

    // Soft matching fog for gentle depth
    scene.fog = new THREE.Fog(0xfbeef6, 5, 14);

    return () => {
      scene.background = null;
      scene.fog = null;
    };
  }, [scene]);

  return (
    <>
      {/* Key light — warm, slightly right */}
      <directionalLight
        position={[3, 4, 2]}
        intensity={1.8}
        color="#fff5ee"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      {/* Fill light — cool blue tint from left */}
      <directionalLight position={[-3, 2, -1]} intensity={0.6} color="#c4d4ff" />
      {/* Rim light — purple accent from behind */}
      <directionalLight position={[0, 3, -4]} intensity={0.8} color="#a78bfa" />
      {/* Bottom bounce light */}
      <directionalLight position={[0, -1, 2]} intensity={0.15} color="#e8d5f5" />
      {/* Ambient — soft, bright for a clean pastel studio */}
      <ambientLight intensity={0.6} color="#fff0f7" />
      {/* Hemisphere for sky/ground color blend — candy pink ground bounce */}
      <hemisphereLight args={['#ffe4f3', '#f6d8e8', 0.55]} />
    </>
  );
}
