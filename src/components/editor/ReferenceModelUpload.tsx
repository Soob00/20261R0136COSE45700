'use client';

import { useState, useCallback, useRef } from 'react';
import { Upload, Loader2, CheckCircle2, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { loadVRM } from '@/lib/vrm/loader';
import { detectMaterials } from '@/lib/vrm/materials';
import { recommendHairPreset, recommendHairPresetFromImage, matchHairPresetsFromColor, hexToHsl } from '@/lib/hair-matching';
import { PRESET_ITEMS } from '@/data/presets';
import { useEditorStore } from '@/stores/editorStore';
import type { HairRecommendation } from '@/types/editor';
import type { TextureResult, HairMatchResult, PipelineResult } from '@/types/pipeline';
import * as THREE from 'three';

type Status = 'idle' | 'loading' | 'success' | 'error';
type TextureStatus = 'idle' | 'loading' | 'success' | 'error';

interface Result {
  presetName: string;
  confidence: string;
  extractedColor: string;
}

const CONFIDENCE_LABELS: Record<string, string> = {
  high: '높음',
  medium: '보통',
  low: '낮음',
};

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];
const MODEL_EXTENSIONS = ['.vrm', '.glb'];
const ACCEPTED_EXTENSIONS = [...IMAGE_EXTENSIONS, ...MODEL_EXTENSIONS];

function isImageFile(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isModelFile(name: string): boolean {
  const lower = name.toLowerCase();
  return MODEL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function ReferenceModelUpload() {
  const [status, setStatus] = useState<Status>('idle');
  const [textureStatus, setTextureStatus] = useState<TextureStatus>('idle');
  const [geminiFallback, setGeminiFallback] = useState(false);

  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const setHairFront = useEditorStore((s) => s.setHairFront);
  const setHairBack = useEditorStore((s) => s.setHairBack);
  const setHairColor = useEditorStore((s) => s.setHairColor);
  const setHairRecommendation = useEditorStore((s) => s.setHairRecommendation);
  const applyTextureResult = useEditorStore((s) => s.applyTextureResult);
  const applyPipelineResult = useEditorStore((s) => s.applyPipelineResult);
  const setProposedStamps = useEditorStore((s) => s.setProposedStamps);

  function applyRecommendation(recommendation: HairRecommendation, applyColor: boolean) {
    const { bestMatch, extractedColor, confidence } = recommendation;

    const preset = PRESET_ITEMS.find((p) => p.id === bestMatch.presetId);

    setHairFront(preset?.meshUrl ?? null);
    setHairBack(preset?.hairBackUrl ?? null);

    // VRM/GLB input: apply extracted color precisely
    // Image input: keep preset's original texture (extracted color is approximate)
    if (applyColor) {
      setHairColor(extractedColor);
    } else {
      setHairColor(null);
    }

    setHairRecommendation(recommendation);

    setResult({
      presetName: preset?.name ?? bestMatch.presetId,
      confidence,
      extractedColor,
    });

    console.log(
      `[ReferenceUpload] Applied: ${preset?.name} (confidence: ${confidence}, color: ${extractedColor}, colorOverride: ${applyColor})`
    );
  }

  const processImageFile = useCallback(
    async (file: File) => {
      setStatus('loading');
      setTextureStatus('loading');

      setResult(null);
      setErrorMsg('');
      setGeminiFallback(false);

      // Run hair matching (client) and texture pipeline (server) in parallel
      const hairPromise = recommendHairPresetFromImage(file);

      const formData = new FormData();
      formData.append('image', file);
      const texturePromise = fetch('/api/pipeline/texture', {
        method: 'POST',
        body: formData,
      }).then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Texture pipeline failed (${res.status})`);
        }
        return res.json() as Promise<TextureResult>;
      });

      // Face-keys extraction (runs in parallel with hair + texture)
      const faceKeysFormData = new FormData();
      faceKeysFormData.append('image', file);
      const faceKeysPromise = fetch('/api/pipeline/face-keys', {
        method: 'POST',
        body: faceKeysFormData,
      }).then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Face keys pipeline failed (${res.status})`);
        }
        return res.json() as Promise<PipelineResult>;
      });

      const [hairResult, textureResult, faceKeysResult] = await Promise.allSettled([
        hairPromise,
        texturePromise,
        faceKeysPromise,
      ]);

      // Apply hair matching result (initial — may be refined by Gemini color below)
      if (hairResult.status === 'fulfilled' && hairResult.value) {
        applyRecommendation(hairResult.value, true);
        setStatus('success');
      } else {
        const reason = hairResult.status === 'rejected'
          ? hairResult.reason?.message
          : '이미지에서 헤어 색상을 감지하지 못했습니다';
        console.error('[ReferenceUpload] Hair matching failed:', reason);
        setStatus('error');
        setErrorMsg(reason ?? '헤어 매칭에 실패했습니다');
      }

      // Apply texture pipeline result
      if (textureResult.status === 'fulfilled') {
        const { textures, features } = textureResult.value;
        const isFallback = !!(features as Record<string, unknown> | null)?._gemini_fallback;
        if (isFallback) {
          setGeminiFallback(true);
          console.warn('[ReferenceUpload] Gemini unavailable — textures generated with defaults');
        }
        if (textures && Object.keys(textures).length > 0) {
          applyTextureResult(textures);
          setTextureStatus('success');
          console.log(`[ReferenceUpload] Textures applied: ${Object.keys(textures).join(', ')}`);
        } else {
          setTextureStatus('error');
          console.warn('[ReferenceUpload] Texture pipeline returned no textures');
        }

        // Proposed stamps (markings + highlights) → stamp editor
        const ps = textureResult.value.proposedStamps;
        if (ps) {
          const total = Object.values(ps).reduce((n, arr) => n + arr.length, 0);
          if (total > 0) {
            setProposedStamps(ps as Record<string, import('@/types/editor').ProposedStampItem[]>);
            console.log(`[ReferenceUpload] Proposed stamps dispatched: ${total}`);
          }
        }

        // Use Gemini visual hair match (direct image-to-thumbnail comparison)
        const hairMatch = textureResult.value.hairMatch as HairMatchResult | null;
        if (hairMatch?.matched_preset && hairMatch.confidence > 0.3) {
          const preset = PRESET_ITEMS.find((p) => p.id === hairMatch.matched_preset);
          if (preset) {
            // Extract hair color from Gemini features for color override
            const geminiFeatures = features as { general?: { hair_color?: number[] } } | null;
            const hairColorRgb = geminiFeatures?.general?.hair_color;
            let extractedColor = '#785947'; // default
            if (hairColorRgb && Array.isArray(hairColorRgb) && hairColorRgb.length === 3) {
              extractedColor = '#' + hairColorRgb.map((c: number) => Math.round(c).toString(16).padStart(2, '0')).join('');
            }

            setHairFront(preset.meshUrl ?? null);
            setHairBack(preset.hairBackUrl ?? null);
            setHairColor(extractedColor);
            setHairRecommendation({
              bestMatch: { presetId: hairMatch.matched_preset, score: hairMatch.confidence, colorScore: 0, geometryScore: hairMatch.confidence },
              allResults: [],
              confidence: hairMatch.confidence > 0.7 ? 'high' : hairMatch.confidence > 0.4 ? 'medium' : 'low',
              extractedColor,
            });
            setResult({
              presetName: preset.name ?? hairMatch.matched_preset,
              confidence: hairMatch.confidence > 0.7 ? 'high' : hairMatch.confidence > 0.4 ? 'medium' : 'low',
              extractedColor,
            });
            setStatus('success');
            console.log(`[ReferenceUpload] Gemini visual match: ${hairMatch.matched_preset} (confidence: ${hairMatch.confidence}, reason: ${hairMatch.reason})`);
          }
        } else {
          // Fallback: color-only re-matching
          const geminiFeatures = features as { general?: { hair_color?: number[] } } | null;
          const hairColorRgb = geminiFeatures?.general?.hair_color;
          if (hairColorRgb && Array.isArray(hairColorRgb) && hairColorRgb.length === 3) {
            const hex = '#' + hairColorRgb.map((c: number) => Math.round(c).toString(16).padStart(2, '0')).join('');
            const hsl = hexToHsl(hex);
            const refined = matchHairPresetsFromColor(hex, hsl);
            console.log(`[ReferenceUpload] Fallback color match: ${hex}`);
            applyRecommendation(refined, true);
            setStatus('success');
          }
        }
      } else {
        setTextureStatus('error');
        console.error('[ReferenceUpload] Texture pipeline failed:', textureResult.reason);
      }

      // Apply face-keys result (morph targets)
      // Priority: texture pipeline (Gemini corrections) > standalone face-keys
      let faceKeysApplied = false;

      // 1st priority: texture pipeline face-keys (includes Gemini face shape corrections)
      if (!faceKeysApplied && textureResult.status === 'fulfilled') {
        const textureFaceKeys = textureResult.value.faceKeys as PipelineResult | null;
        if (textureFaceKeys?.status === 'ok' && textureFaceKeys.avatar_parameters) {
          applyPipelineResult(textureFaceKeys.avatar_parameters);
          faceKeysApplied = true;
          console.log(`[ReferenceUpload] Face keys applied (with Gemini corrections): ${Object.keys(textureFaceKeys.avatar_parameters).length} parameters (template: ${textureFaceKeys.template})`);
        }
      }

      // 2nd priority: standalone face-keys API result
      if (!faceKeysApplied && faceKeysResult.status === 'fulfilled') {
        const faceKeys = faceKeysResult.value;
        if (faceKeys.status === 'ok' && faceKeys.avatar_parameters) {
          applyPipelineResult(faceKeys.avatar_parameters);
          console.log(`[ReferenceUpload] Face keys applied (standalone): ${Object.keys(faceKeys.avatar_parameters).length} parameters (template: ${faceKeys.template})`);
        } else {
          console.warn('[ReferenceUpload] Face keys extraction failed:', faceKeys.error);
        }
      } else if (!faceKeysApplied && faceKeysResult.status === 'rejected') {
        console.error('[ReferenceUpload] Face keys pipeline failed:', faceKeysResult.reason);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setHairFront, setHairBack, setHairColor, setHairRecommendation, applyTextureResult, applyPipelineResult, setProposedStamps],
  );

  const processModelFile = useCallback(
    async (file: File) => {
      setStatus('loading');
      setResult(null);
      setErrorMsg('');

      const blobUrl = URL.createObjectURL(file);

      try {
        const vrm = await loadVRM(blobUrl);
        const materials = detectMaterials(vrm);
        const recommendation = recommendHairPreset(vrm, materials);

        // Dispose VRM scene
        vrm.scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.geometry?.dispose();
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => m?.dispose());
          }
        });

        if (!recommendation) {
          setStatus('error');
          setErrorMsg('헤어 머티리얼을 감지하지 못했습니다');
          return;
        }

        applyRecommendation(recommendation, true);
        setStatus('success');
      } catch (err) {
        console.error('[ReferenceUpload] Model processing failed:', err);
        setStatus('error');
        setErrorMsg('파일 로드에 실패했습니다');
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setHairFront, setHairBack, setHairColor, setHairRecommendation],
  );

  const processFile = useCallback(
    async (file: File) => {
      if (isImageFile(file.name)) {
        return processImageFile(file);
      }
      if (isModelFile(file.name)) {
        return processModelFile(file);
      }
      setStatus('error');
      setErrorMsg('지원하지 않는 파일 형식입니다 (이미지 또는 VRM/GLB)');
    },
    [processImageFile, processModelFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      e.target.value = '';
    },
    [processFile],
  );

  const acceptAttr = ACCEPTED_EXTENSIONS.join(',');

  return (
    <div className="space-y-2">
      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        레퍼런스 업로드
      </label>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragging(false);
        }}
        onClick={() => status !== 'loading' && textureStatus !== 'loading' && inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-1.5 px-3 py-4 rounded-lg border border-dashed cursor-pointer transition-all ${
          isDragging
            ? 'border-primary/60 bg-primary/5'
            : status === 'loading' || textureStatus === 'loading'
            ? 'border-border/30 bg-muted/10 cursor-wait'
            : 'border-border/40 bg-muted/10 hover:border-border/60 hover:bg-muted/20'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={acceptAttr}
          onChange={handleFileInput}
          className="hidden"
        />

        {status === 'loading' || textureStatus === 'loading' ? (
          <>
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
            <span className="text-[11px] text-muted-foreground">
              {status === 'loading' && textureStatus === 'loading'
                ? '헤어 매칭 + 텍스처 생성 중...'
                : textureStatus === 'loading'
                ? '텍스처 생성 중...'
                : '분석 중...'}
            </span>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4 text-muted-foreground/50" />
              <Upload className="w-4 h-4 text-muted-foreground/50" />
            </div>
            <span className="text-[11px] text-muted-foreground">
              이미지 또는 VRM/GLB로 헤어 자동 매칭
            </span>
            <span className="text-[9px] text-muted-foreground/50">
              PNG, JPG, WebP, VRM, GLB
            </span>
          </>
        )}
      </div>

      {/* Result message */}
      {status === 'success' && result && (
        <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-[11px] text-foreground/80 font-medium">
              {result.presetName} 적용됨
            </p>
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full border border-border/50"
                style={{ backgroundColor: result.extractedColor }}
              />
              <span className="text-[10px] text-muted-foreground">
                신뢰도: {CONFIDENCE_LABELS[result.confidence] ?? result.confidence}
              </span>
            </div>
            {textureStatus === 'loading' && (
              <div className="flex items-center gap-1 mt-0.5">
                <Loader2 className="w-3 h-3 text-primary animate-spin" />
                <span className="text-[10px] text-muted-foreground">텍스처 생성 중...</span>
              </div>
            )}
            {textureStatus === 'success' && !geminiFallback && (
              <span className="text-[10px] text-emerald-500">텍스처 적용 완료</span>
            )}
            {textureStatus === 'success' && geminiFallback && (
              <span className="text-[10px] text-amber-500">텍스처 적용됨 (AI 크레딧 부족 — 기본값 사용)</span>
            )}
            {textureStatus === 'error' && (
              <span className="text-[10px] text-amber-500">텍스처 생성 실패 (헤어만 적용됨)</span>
            )}

          </div>
        </div>
      )}

      {status === 'error' && errorMsg && (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
          <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
          <p className="text-[11px] text-destructive/80">{errorMsg}</p>
        </div>
      )}
    </div>
  );
}
