'use client';

import { Suspense, useRef, useImperativeHandle, forwardRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { Stats } from '@react-three/drei';
import { VRMModel } from './VRMModel';
import { HairAttachment } from './HairAttachment';
import { OutfitAttachment } from './OutfitAttachment';
import { AccessoryAttachment } from './AccessoryAttachment';
import { CameraControls } from './CameraControls';
import { SceneLighting } from './SceneLighting';
import type { DetectedMaterial } from '@/lib/vrm/materials';

interface ThreeJSViewerProps {
  modelUrl: string;
  animationUrl?: string;
  onModelLoaded?: (
    expressionNames: string[],
    morphTargetNames: string[],
    boneNames: string[],
    detectedMaterials: DetectedMaterial[]
  ) => void;
  showStats?: boolean;
  showGrid?: boolean;
}

export interface ThreeJSViewerHandle {
  resetCamera: () => void;
}

export const ThreeJSViewer = forwardRef<ThreeJSViewerHandle, ThreeJSViewerProps>(
  function ThreeJSViewer({ modelUrl, animationUrl, onModelLoaded, showStats = false, showGrid = true }, ref) {
    const cameraControlsRef = useRef<{ reset: () => void }>(null);

    useImperativeHandle(ref, () => ({
      resetCamera: () => {
        cameraControlsRef.current?.reset();
      },
    }));

    return (
      <Canvas
        camera={{ position: [0, 1.2, 2], fov: 35 }}
        gl={{ powerPreference: 'high-performance', antialias: true, preserveDrawingBuffer: true }}
        style={{ width: '100%', height: '100%' }}
      >
        <SceneLighting />
        <CameraControls ref={cameraControlsRef} />
        <Suspense fallback={null}>
          <VRMModel url={modelUrl} animationUrl={animationUrl} onLoaded={onModelLoaded} />
          <HairAttachment />
          <OutfitAttachment />
          <AccessoryAttachment />
        </Suspense>
        {showGrid && <gridHelper args={[10, 20, '#f0a8d0', '#f6d0e6']} />}
        {showStats && <Stats />}
      </Canvas>
    );
  }
);
