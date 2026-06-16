'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useSearchParams } from 'next/navigation';
import { AccessoryRenderScene, type AccessoryRenderResult, type AccessoryRenderSpec } from '@/components/viewer/AccessoryRenderScene';

declare global {
  interface Window {
    __ACCESSORY_RENDER_RESULT__?: AccessoryRenderResult;
  }
}

function toFileUrl(path: string): string {
  return `/api/accessory-render/file?path=${encodeURIComponent(path)}`;
}

function AccessoryRenderPageInner() {
  const searchParams = useSearchParams();
  const specPath = searchParams.get('spec') ?? '';
  const [spec, setSpec] = useState<AccessoryRenderSpec | null>(null);
  const [result, setResult] = useState<AccessoryRenderResult>({
    ok: false,
    stage: 'loading',
    specPath,
    inFrame: null,
    projectedBBox: null,
    projectedAreaRatio: null,
    anchorBoneRequested: null,
    anchorBoneResolved: null,
    warnings: [],
    error: null,
  });

  useEffect(() => {
    window.__ACCESSORY_RENDER_RESULT__ = result;
  }, [result]);

  useEffect(() => {
    let cancelled = false;

    async function loadSpec() {
      if (!specPath) {
        setResult({
          ok: false,
          stage: 'failed',
          specPath,
          inFrame: false,
          projectedBBox: null,
          projectedAreaRatio: null,
          anchorBoneRequested: null,
          anchorBoneResolved: null,
          warnings: [],
          error: 'missing_spec_query',
        });
        return;
      }

      try {
        const response = await fetch(`/api/accessory-render/spec?path=${encodeURIComponent(specPath)}`, {
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error(`spec_fetch_failed:${response.status}`);
        }
        const data = await response.json() as AccessoryRenderSpec;
        if (!cancelled) {
          setSpec(data);
        }
      } catch (error) {
        if (cancelled) return;
        setResult({
          ok: false,
          stage: 'failed',
          specPath,
          inFrame: false,
          projectedBBox: null,
          projectedAreaRatio: null,
          anchorBoneRequested: null,
          anchorBoneResolved: null,
          warnings: [],
          error: error instanceof Error ? error.message : 'spec_fetch_failed',
        });
      }
    }

    loadSpec();
    return () => {
      cancelled = true;
    };
  }, [specPath]);

  const baseAvatarUrl = useMemo(
    () => spec ? toFileUrl(spec.baseAvatarModelPath) : '',
    [spec],
  );
  const accessoryUrl = useMemo(
    () => spec ? toFileUrl(spec.assetModelPath) : '',
    [spec],
  );

  const width = spec?.renderWidth ?? 1024;
  const height = spec?.renderHeight ?? 1024;
  const cameraDistance = spec?.cameraDistance ?? 1.8;
  const cameraFov = spec?.cameraFov ?? 30;
  const marker = result.stage === 'ready' ? 'ready' : result.stage === 'failed' ? 'failed' : 'loading';

  return (
    <main
      style={{
        margin: 0,
        width: '100vw',
        minHeight: '100vh',
        background: '#0f1218',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
      }}
    >
      <div
        id="accessory-render-root"
        data-render-status={marker}
        style={{ width, height, position: 'relative' }}
      >
        {spec ? (
          <Canvas
            camera={{ position: [0, 1.2, cameraDistance], fov: cameraFov }}
            gl={{ powerPreference: 'high-performance', antialias: true, preserveDrawingBuffer: true, alpha: true }}
            style={{ width: '100%', height: '100%' }}
          >
            <Suspense fallback={null}>
              <AccessoryRenderScene
                spec={spec}
                specPath={specPath}
                baseAvatarUrl={baseAvatarUrl}
                accessoryUrl={accessoryUrl}
                onResult={setResult}
              />
            </Suspense>
          </Canvas>
        ) : null}
        <div id="render-status" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0 }}>
          {marker}
        </div>
      </div>
    </main>
  );
}

export default function AccessoryRenderPage() {
  return (
    <Suspense fallback={null}>
      <AccessoryRenderPageInner />
    </Suspense>
  );
}
