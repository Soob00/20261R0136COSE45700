'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { WebGLCheck } from '@/components/viewer/WebGLCheck';
import { MorphTargetSlider } from '@/components/editor/MorphTargetSlider';
import { CollapsibleSection } from '@/components/editor/CollapsibleSection';
import { MaterialEditor } from '@/components/editor/MaterialEditor';
import { TextureStampEditor } from '@/components/editor/TextureStampEditor';
import { VersionPanel } from '@/components/editor/VersionPanel';
import { TemplateSelector } from '@/components/editor/TemplateSelector';
import { PresetGrid } from '@/components/editor/PresetGrid';
import { AccessoryFitPanel } from '@/components/editor/AccessoryFitPanel';
import { AccessoryUpload } from '@/components/editor/AccessoryUpload';
import { ReferenceModelUpload } from '@/components/editor/ReferenceModelUpload';
import { FaceFeatureApply } from '@/components/editor/FaceFeatureApply';
import { SliderSearch } from '@/components/editor/SliderSearch';
import { QuickPresets } from '@/components/editor/QuickPresets';
import { MotionPanel } from '@/components/editor/MotionPanel';
import BackgroundTasks from '@/components/editor/BackgroundTasks';
import { ViewerToolbar } from '@/components/viewer/ViewerToolbar';
import { useEditorStore } from '@/stores/editorStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useCanvasScreenshot } from '@/hooks/useCanvasScreenshot';
import { useVersionSync } from '@/hooks/useVersionSync';
import { useAPI } from '@/lib/api';
import { TEMPLATES } from '@/data/templates';
import type { DetectedMaterial } from '@/lib/vrm/materials';
import type { TemplateMetadata } from '@/types/template';
import { recommendHairPreset } from '@/lib/hair-matching';
import { getBaseVRM } from '@/lib/vrm-ref';
import {
  User,
  Smile,
  Palette,
  Shirt,
  Upload,
  PanelLeftClose,
  PanelLeft,
  RotateCcw,
  History,
  LayoutTemplate,
  Undo2,
  Redo2,
  Sparkles,
  Layers2,
  PersonStanding,
} from 'lucide-react';
import type { ThreeJSViewerHandle } from '@/components/viewer/ThreeJSViewer';

const ThreeJSViewer = dynamic(
  () => import('@/components/viewer/ThreeJSViewer').then((m) => ({ default: m.ThreeJSViewer })),
  { ssr: false }
);

const DEFAULT_MODEL_URL = (process.env.NEXT_PUBLIC_ASSET_BASE_URL ?? '').replace(/\/$/, '') + '/models/CustomizableCharacter.vrm';
// Force Turbopack cache invalidation


const MORPH_LABELS: Record<string, string> = {
  face_eye_size: '눈 크기',
  face_eye_width: '눈 가로폭',
  face_eye_height: '눈 세로폭',
  face_eye_tilt: '눈매 각도',
  face_eye_spacing: '눈 간격',
  face_nose_height: '코 높이',
  face_nose_width: '코 너비',
  face_nose_length: '코 길이',
  face_jaw_width: '턱 너비',
  face_jaw_length: '턱 길이',
  face_chin_shape: '턱 끝 형태',
  face_cheek_fullness: '볼 볼륨',
  face_lip_thickness: '입술 두께',
  face_lip_width: '입 너비',
  face_forehead_height: '이마 높이',
  face_forehead_width: '이마 너비',
  face_eyebrow_height: '눈썹 높이',
  face_eyebrow_thickness: '눈썹 두께',
  Eye_Width: '눈 가로폭',
  Eye_WidthV: '눈 세로폭',
  Eye_Height: '눈 높이 (위치)',
  Eye_Dist: '눈 사이 간격',
  Eye_Rot: '눈 회전',
  Eye_FrontHeight: '눈 앞머리 높이',
  Eye_FrontFlat: '눈 앞머리 곡선 완화',
  Eye_TailHeight: '눈꼬리 곡선 완화',
  Eye_TopLidFlat: '윗눈꺼풀 평평하게',
  Eye_LowerLidFlat: '아래 눈꺼풀 평평하게',
  Eye_TopLidDown: '윗눈꺼풀 내리기',
  Eye_LowerLidUp: '아래 눈꺼풀 올리기',
  Eye_PupilWidth: '눈동자 가로폭',
  Eye_PupilWidthV: '눈동자 세로폭',
  Brow_Dist: '눈썹 간격',
  Brow_Height: '눈썹 높이 (위치)',
  Brow_Rot: '눈썹 회전',
  Brow_Width: '눈썹 가로폭',
  Brow_WidthV: '눈썹 세로폭',
  Nose_Height: '코 높이',
  Nose_Width: '코 너비',
  Nose_UnderNose: '코 밑 높이',
  Mouth_Width: '입 너비',
  Mouth_Height: '입 높이 (위치)',
  Mouth_Corner: '입꼬리',
  Face_JawLine: '턱선 날렵하게',
  Face_Cheek: '볼살 부풀리기',
  Face_Roundness: '얼굴형 둥글게',
  Face_ChinWidth: '턱 가로폭',
};

// Morph target slider ranges from keyData spec
// (-1:1) for bidirectional morphs, (0:1) for unidirectional morphs
const MORPH_RANGES: Record<string, { min: number; max: number }> = {
  Eye_Width:       { min: -1, max: 1 },
  Eye_WidthV:      { min: -1, max: 1 },
  Eye_Height:      { min: -1, max: 1 },
  Eye_Dist:        { min: -1, max: 1 },
  Eye_Rot:         { min: -1, max: 1 },
  Eye_FrontHeight: { min: -1, max: 1 },
  Eye_FrontFlat:   { min: 0,  max: 1 },
  Eye_TailHeight:  { min: -1, max: 1 },
  Eye_TopLidFlat:  { min: 0,  max: 1 },
  Eye_LowerLidFlat:{ min: 0,  max: 1 },
  Eye_TopLidDown:  { min: 0,  max: 1 },
  Eye_LowerLidUp:  { min: 0,  max: 1 },
  Eye_PupilWidth:  { min: -1, max: 1 },
  Eye_PupilWidthV: { min: -1, max: 1 },
  Brow_Dist:       { min: -1, max: 1 },
  Brow_Height:     { min: -1, max: 1 },
  Brow_Rot:        { min: -1, max: 1 },
  Brow_Width:      { min: -1, max: 1 },
  Brow_WidthV:     { min: -1, max: 1 },
  Nose_Height:     { min: -1, max: 1 },
  Nose_Width:      { min: 0,  max: 1 },
  Nose_UnderNose:  { min: -1, max: 1 },
  Mouth_Width:     { min: -1, max: 1 },
  Mouth_Height:    { min: -1, max: 1 },
  Mouth_Corner:    { min: -1, max: 1 },
  Face_JawLine:    { min: 0,  max: 1 },
  Face_Cheek:      { min: 0,  max: 1 },
  Face_Roundness:  { min: 0,  max: 1 },
  Face_ChinWidth:  { min: 0,  max: 1 },
};


type TabId = 'face' | 'expressions' | 'material' | 'style' | 'texture' | 'motion' | 'version';

const TAB_CONFIG: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'face',        label: '얼굴',   icon: User           },
  { id: 'style',       label: '스타일', icon: Shirt          },
  { id: 'material',    label: '재질',   icon: Palette        },
  { id: 'texture',     label: '텍스처', icon: Layers2        },
  { id: 'expressions', label: '표정',   icon: Smile          },
  { id: 'motion',      label: '모션',   icon: PersonStanding },
  { id: 'version',     label: '버전',   icon: History        },
];

export default function DevViewerPage() {
  const [modelUrl, setModelUrl] = useState(DEFAULT_MODEL_URL);
  const [modelName, setModelName] = useState('CustomizableCharacter.vrm');
  const [expressionNames, setExpressionNames] = useState<string[]>([]);
  const [morphTargetNames, setMorphTargetNames] = useState<string[]>([]);
  const [availableBones, setAvailableBones] = useState<string[]>([]);
  const [detectedMaterials, setDetectedMaterials] = useState<DetectedMaterial[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('face');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModifiedOnly, setShowModifiedOnly] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>('customizable-default');
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const [apiTemplates, setApiTemplates] = useState<TemplateMetadata[]>(TEMPLATES);
  const isResizing = useRef(false);

  const api = useAPI();
  const { loadVersionsFromServer } = useVersionSync();

  // Fetch templates from backend
  useEffect(() => {
    let cancelled = false;
    api.template.listTemplates().then((templates) => {
      if (!cancelled && templates.length > 0) {
        setApiTemplates(templates);
      }
    }).catch((e) => {
      // Silently fall back to static templates
    });
    return () => { cancelled = true; };
  }, [api]);

  // Load versions from backend on mount
  useEffect(() => {
    loadVersionsFromServer();
  }, [loadVersionsFromServer]);

  const resetAll = useEditorStore((s) => s.resetAll);
  const resetMorphTargets = useEditorStore((s) => s.resetMorphTargets);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const saveVersion = useEditorStore((s) => s.saveVersion);
  const morphTargets = useEditorStore((s) => s.morphTargets);
  const baselineMorphTargets = useEditorStore((s) => s.baselineMorphTargets);
  const setHairRecommendation = useEditorStore((s) => s.setHairRecommendation);
  const viewerRef = useRef<ThreeJSViewerHandle>(null);
  const { capture } = useCanvasScreenshot();

  const handleModelLoaded = useCallback(
    (
      expressions: string[],
      morphs: string[],
      bones: string[],
      materials: DetectedMaterial[]
    ) => {
      setExpressionNames(expressions);
      setMorphTargetNames(morphs);
      setAvailableBones(bones);
      setDetectedMaterials(materials);

      // Run hair matching after VRM scene is fully set up
      requestAnimationFrame(() => {
        const vrm = getBaseVRM();
        if (vrm) {
          const recommendation = recommendHairPreset(vrm, materials);
          setHairRecommendation(recommendation);
        }
      });
    },
    [setHairRecommendation]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith('.vrm') || file.name.endsWith('.glb'))) {
        const url = URL.createObjectURL(file);
        resetAll();
        setExpressionNames([]);
        setMorphTargetNames([]);
        setAvailableBones([]);
        setDetectedMaterials([]);
        setModelUrl(url);
        setModelName(file.name);
      }
    },
    [resetAll]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleTemplateSelect = useCallback(
    (template: TemplateMetadata) => {
      resetAll();
      setExpressionNames([]);
      setMorphTargetNames([]);
      setAvailableBones([]);
      setDetectedMaterials([]);
      setModelUrl(template.vrmUrl);
      setModelName(template.name);
      setCurrentTemplateId(template.id);
      setShowTemplateSelector(false);
    },
    [resetAll]
  );

  const handleCaptureScreenshot = useCallback(async () => {
    return capture(128);
  }, [capture]);

  const handleSaveVersion = useCallback(async () => {
    const thumbnail = await capture(128);
    saveVersion(undefined, thumbnail);
  }, [capture, saveVersion]);

  // Sidebar resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const handleMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(300, Math.min(480, startWidth + ev.clientX - startX));
      setSidebarWidth(newWidth);
    };
    const handleUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [sidebarWidth]);

  // Keyboard shortcuts
  useKeyboardShortcuts(
    useMemo(
      () => ({
        onUndo: undo,
        onRedo: redo,
        onSave: handleSaveVersion,
        onResetCamera: () => viewerRef.current?.resetCamera(),
        onToggleGrid: () => setShowGrid((g) => !g),
        onToggleSidebar: () => setSidebarOpen((o) => !o),
        onSwitchTab: (index: number) => {
          if (index >= 0 && index < TAB_CONFIG.length) {
            setActiveTab(TAB_CONFIG[index].id);
          }
        },
      }),
      [undo, redo, handleSaveVersion]
    )
  );

  // Filter morphs
  const CUSTOM_FACE_MORPHS = new Set([
    'Eye_Width', 'Eye_WidthV', 'Eye_Height', 'Eye_Dist', 'Eye_Rot',
    'Eye_FrontHeight', 'Eye_FrontFlat', 'Eye_TailHeight',
    'Eye_TopLidFlat', 'Eye_LowerLidFlat', 'Eye_TopLidDown', 'Eye_LowerLidUp',
    'Eye_PupilWidth', 'Eye_PupilWidthV',
    'Brow_Dist', 'Brow_Height', 'Brow_Rot', 'Brow_Width', 'Brow_WidthV',
    'Nose_Height', 'Nose_Width', 'Nose_UnderNose',
    'Mouth_Width', 'Mouth_Height', 'Mouth_Corner',
    'Face_JawLine', 'Face_Cheek', 'Face_Roundness', 'Face_ChinWidth',
  ]);
  const faceMorphs = morphTargetNames.filter((n) => n.startsWith('face_') || CUSTOM_FACE_MORPHS.has(n));
  const expressionSet = new Set(expressionNames);
  const otherMorphs = morphTargetNames.filter(
    (n) => !n.startsWith('face_') && !n.startsWith('body_') && !CUSTOM_FACE_MORPHS.has(n) && !expressionSet.has(n)
  );

  // Search & filter
  const filterMorphs = useCallback(
    (names: string[]) => {
      let filtered = names;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter((n) => {
          const label = MORPH_LABELS[n] ?? n;
          return label.toLowerCase().includes(q) || n.toLowerCase().includes(q);
        });
      }
      if (showModifiedOnly) {
        filtered = filtered.filter((n) => (morphTargets[n] ?? 0) !== 0);
      }
      return filtered;
    },
    [searchQuery, showModifiedOnly, morphTargets]
  );

  const modifiedMorphCount = morphTargetNames.filter((n) => (morphTargets[n] ?? 0) !== 0).length;

  const tabCounts: Record<string, number> = {
    face: faceMorphs.length,
    expressions: expressionNames.length + otherMorphs.length,
    material: detectedMaterials.length,
    style: 0,
    version: useEditorStore.getState().versions.length,
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ===== Sidebar ===== */}
      <div
        className="flex flex-col border-r border-border/50 bg-card/80 backdrop-blur-md transition-all duration-300 relative shrink-0 z-20"
        style={{ width: sidebarOpen ? sidebarWidth : 0 }}
      >
        {sidebarOpen && (
          <>
            {/* --- Branding Header --- */}
            <div className="px-4 py-4 border-b border-border/50 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl candy-gradient flex items-center justify-center shadow-pop animate-float">
                    <Sparkles className="w-5 h-5 text-primary-foreground" />
                  </div>
                  <div>
                    <h1 className="font-heading text-base font-bold text-foreground tracking-tight leading-none">
                      Avatar Studio
                    </h1>
                    <p className="text-[11px] text-muted-foreground font-semibold mt-0.5">
                      나만의 귀여운 캐릭터 ✨
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
                  title="패널 닫기 (S)"
                  aria-label="사이드바 닫기"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              </div>

              {/* Model info + Undo/Redo bar */}
              <div className="flex items-center justify-between mt-3 gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-6 h-6 rounded-md bg-accent/50 flex items-center justify-center shrink-0">
                    <Sparkles className="w-3 h-3 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] text-foreground/80 font-medium truncate" title={modelName}>
                      {modelName}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => setShowTemplateSelector(!showTemplateSelector)}
                    className="p-1.5 text-muted-foreground hover:text-foreground border border-border/50 rounded-md hover:border-primary/30 hover:bg-accent/30 transition-all"
                    title="템플릿 선택"
                    aria-label="템플릿 선택"
                    aria-expanded={showTemplateSelector}
                  >
                    <LayoutTemplate className="w-3.5 h-3.5" />
                  </button>
                  <div className="w-px h-4 bg-border/50 mx-1" />
                  <button
                    onClick={undo}
                    disabled={!canUndo()}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-all"
                    title="실행 취소 (Ctrl+Z)"
                    aria-label="실행 취소"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={redo}
                    disabled={!canRedo()}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-all"
                    title="다시 실행 (Ctrl+Shift+Z)"
                    aria-label="다시 실행"
                  >
                    <Redo2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Template selector (overlay) */}
            {showTemplateSelector && (
              <div className="px-4 py-3 border-b border-border/50 bg-accent/20 shrink-0">
                <TemplateSelector
                  currentTemplateId={currentTemplateId}
                  onSelect={handleTemplateSelect}
                  templates={apiTemplates}
                />
              </div>
            )}

            {/* --- Tabs --- */}
            <div className="flex gap-1 px-3 py-2.5 border-b border-border/50 shrink-0 overflow-x-auto scrollbar-none">
              {TAB_CONFIG.map((tab, index) => {
                const Icon = tab.icon;
                const count = tabCounts[tab.id] || 0;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold transition-all whitespace-nowrap shrink-0 ${
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-soft'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
                    }`}
                    title={`${tab.label} (${index + 1})`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                    {count > 0 && (
                      <span
                        className={`text-[10px] min-w-[18px] text-center px-1 py-0.5 rounded-full font-bold ${
                          isActive
                            ? 'bg-primary-foreground/25 text-primary-foreground'
                            : 'bg-secondary text-secondary-foreground'
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* --- Search & Reset (morph tabs only) --- */}
            {['face', 'expressions'].includes(activeTab) && (
              <div className="px-4 py-3 border-b border-border/50 shrink-0 space-y-2">
                <SliderSearch
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  showModifiedOnly={showModifiedOnly}
                  onToggleModifiedOnly={() => setShowModifiedOnly(!showModifiedOnly)}
                  modifiedCount={modifiedMorphCount}
                />
                <button
                  onClick={resetMorphTargets}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold bg-secondary text-secondary-foreground rounded-full hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  {Object.keys(baselineMorphTargets || {}).length > 0
                    ? '레퍼런스 기준으로 초기화'
                    : '전체 초기화'}
                </button>
              </div>
            )}

            {/* --- Tab Content --- */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
              {/* Loading state */}
              {availableBones.length === 0 && expressionNames.length === 0 && !['version', 'style', 'motion'].includes(activeTab) && (
                <div className="flex flex-col items-center justify-center py-16 text-center" role="status">
                  <div className="w-16 h-16 rounded-3xl candy-gradient flex items-center justify-center mb-4 shadow-pop animate-float motion-reduce:animate-none">
                    <Sparkles className="w-7 h-7 text-primary-foreground" />
                  </div>
                  <p className="text-sm font-bold text-foreground/80">
                    아바타를 불러오는 중이에요...
                  </p>
                  <p className="text-[12px] text-muted-foreground mt-1.5 max-w-[210px] leading-relaxed">
                    잠깐만 기다려 주세요! 곧 귀여운 편집 옵션이 나타나요 💕
                  </p>
                </div>
              )}

              {/* Face Tab */}
              {activeTab === 'face' && (() => {
                const filtered = filterMorphs(faceMorphs);
                const eyeMorphs = filtered.filter((n) => n.startsWith('Eye_'));
                const browMorphs = filtered.filter((n) => n.startsWith('Brow_'));
                const noseMorphs = filtered.filter((n) => n.startsWith('Nose_'));
                const mouthMorphs = filtered.filter((n) => n.startsWith('Mouth_'));
                const faceShapeMorphs = filtered.filter((n) => n.startsWith('Face_') || n.startsWith('face_'));
                const hasAny = filtered.length > 0;

                return (
                  <>
                    <QuickPresets />
                    {hasAny ? (
                      <>
                        {eyeMorphs.length > 0 && (
                          <CollapsibleSection title="눈" count={eyeMorphs.length}>
                            {eyeMorphs.map((name) => (
                              <MorphTargetSlider key={name} name={name} label={MORPH_LABELS[name] || name} min={MORPH_RANGES[name]?.min ?? 0} max={MORPH_RANGES[name]?.max ?? 1} />
                            ))}
                          </CollapsibleSection>
                        )}
                        {browMorphs.length > 0 && (
                          <CollapsibleSection title="눈썹" count={browMorphs.length}>
                            {browMorphs.map((name) => (
                              <MorphTargetSlider key={name} name={name} label={MORPH_LABELS[name] || name} min={MORPH_RANGES[name]?.min ?? 0} max={MORPH_RANGES[name]?.max ?? 1} />
                            ))}
                          </CollapsibleSection>
                        )}
                        {noseMorphs.length > 0 && (
                          <CollapsibleSection title="코" count={noseMorphs.length}>
                            {noseMorphs.map((name) => (
                              <MorphTargetSlider key={name} name={name} label={MORPH_LABELS[name] || name} min={MORPH_RANGES[name]?.min ?? 0} max={MORPH_RANGES[name]?.max ?? 1} />
                            ))}
                          </CollapsibleSection>
                        )}
                        {mouthMorphs.length > 0 && (
                          <CollapsibleSection title="입" count={mouthMorphs.length}>
                            {mouthMorphs.map((name) => (
                              <MorphTargetSlider key={name} name={name} label={MORPH_LABELS[name] || name} min={MORPH_RANGES[name]?.min ?? 0} max={MORPH_RANGES[name]?.max ?? 1} />
                            ))}
                          </CollapsibleSection>
                        )}
                        {faceShapeMorphs.length > 0 && (
                          <CollapsibleSection title="얼굴형" count={faceShapeMorphs.length}>
                            {faceShapeMorphs.map((name) => (
                              <MorphTargetSlider key={name} name={name} label={MORPH_LABELS[name] || name} min={MORPH_RANGES[name]?.min ?? 0} max={MORPH_RANGES[name]?.max ?? 1} />
                            ))}
                          </CollapsibleSection>
                        )}
                      </>
                    ) : (
                      availableBones.length > 0 && !searchQuery && !showModifiedOnly && (
                        <div className="rounded-xl border border-border/30 bg-accent/20 p-4">
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            이 모델에는 얼굴 편집용 morph target이 없습니다.
                            Blender에서 Shape Key를 추가한 VRM 모델을 드롭하여 테스트하세요.
                          </p>
                        </div>
                      )
                    )}
                  </>
                );
              })()}

              {/* Expressions Tab */}
              {activeTab === 'expressions' && (
                <>
                  {filterMorphs(expressionNames).length > 0 && (
                    <CollapsibleSection title="표정" count={filterMorphs(expressionNames).length}>
                      {filterMorphs(expressionNames).map((name) => (
                        <MorphTargetSlider key={`expr-${name}`} name={name} />
                      ))}
                    </CollapsibleSection>
                  )}
                  {filterMorphs(otherMorphs).length > 0 && (
                    <CollapsibleSection
                      title="기타 Morph Targets"
                      count={filterMorphs(otherMorphs).length}
                      defaultOpen={false}
                    >
                      {filterMorphs(otherMorphs).map((name) => (
                        <MorphTargetSlider key={`morph-${name}`} name={name} />
                      ))}
                    </CollapsibleSection>
                  )}
                </>
              )}

              {/* Material Tab */}
              {activeTab === 'material' && (
                <MaterialEditor detectedMaterials={detectedMaterials} />
              )}

              {/* Texture Stamp Tab — always mounted to preserve stamp state across tab switches */}
              <div className={activeTab !== 'texture' ? 'hidden' : undefined}>
                <TextureStampEditor isActive={activeTab === 'texture'} />
              </div>

              {/* Style Tab */}
              {activeTab === 'style' && (
                <>
                  <ReferenceModelUpload />
                  <FaceFeatureApply />
                  <AccessoryUpload />
                  <PresetGrid />
                  <AccessoryFitPanel />
                </>
              )}

              {/* Motion Tab */}
              {activeTab === 'motion' && <MotionPanel />}

              {/* Version Tab */}
              {activeTab === 'version' && (
                <VersionPanel onCaptureScreenshot={handleCaptureScreenshot} />
              )}
            </div>

            {/* --- Bottom Status Bar --- */}
            <div className="px-4 py-2.5 border-t border-border/40 shrink-0 bg-secondary/30">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-foreground/70 flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${modifiedMorphCount > 0 ? 'bg-primary' : 'bg-mint'}`} />
                  {modifiedMorphCount > 0
                    ? `${modifiedMorphCount}곳 꾸미는 중 💖`
                    : '준비 완료!'}
                </p>
                <p className="text-[10px] text-muted-foreground/70 font-mono">
                  R G S 1-5 · Ctrl+Z/S
                </p>
              </div>
            </div>
          </>
        )}

        {/* Resize handle */}
        {sidebarOpen && (
          <div
            className="absolute right-0 top-0 bottom-0 w-4 -mr-1.5 cursor-col-resize z-30 group flex items-center justify-center"
            onMouseDown={handleResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="사이드바 크기 조절"
          >
            <div className="w-0.5 h-full bg-transparent group-hover:bg-primary/40 group-active:bg-primary/60 transition-colors" />
          </div>
        )}
      </div>

      {/* ===== 3D Viewport ===== */}
      <div
        className="flex-1 relative min-w-0"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* Sidebar toggle (when closed) */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute top-3 left-3 z-10 p-2.5 rounded-2xl glass shadow-soft text-foreground/70 hover:text-primary transition-all"
            title="패널 열기 (S)"
            aria-label="사이드바 열기"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}

        {/* Viewer Toolbar */}
        <ViewerToolbar
          showGrid={showGrid}
          onToggleGrid={() => setShowGrid(!showGrid)}
          onResetCamera={() => viewerRef.current?.resetCamera()}
        />

        {/* 3D Canvas */}
        <WebGLCheck>
          <ThreeJSViewer
            ref={viewerRef}
            modelUrl={modelUrl}
            onModelLoaded={handleModelLoaded}
            showStats={false}
            showGrid={showGrid}
          />
        </WebGLCheck>

        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-primary/10 backdrop-blur-sm border-[3px] border-dashed border-primary/50 rounded-3xl m-3 pointer-events-none">
            <div className="flex flex-col items-center gap-3">
              <div className="w-20 h-20 rounded-3xl candy-gradient flex items-center justify-center shadow-pop animate-float">
                <Upload className="w-9 h-9 text-primary-foreground" />
              </div>
              <p className="text-base font-bold text-primary">
                여기에 쏙! 놓아주세요 🎀
              </p>
              <p className="text-xs font-semibold text-primary/60">
                VRM / GLB 파일로 아바타를 바꿔요
              </p>
            </div>
          </div>
        )}

        {/* Bottom info */}
        {!isDragging && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
            <div className="px-3.5 py-1.5 rounded-full glass shadow-soft text-[11px] font-semibold text-foreground/60 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-mint animate-pulse motion-reduce:animate-none" />
              VRM/GLB 파일을 드롭하면 아바타가 바뀌어요
            </div>
          </div>
        )}
      </div>

      <BackgroundTasks />
    </div>
  );
}
