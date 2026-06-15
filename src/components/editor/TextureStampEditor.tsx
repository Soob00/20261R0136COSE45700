'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Trash2, Plus, RefreshCw, Check, RotateCcw, Pencil, Undo2 } from 'lucide-react';
import { getBaseVRM } from '@/lib/vrm-ref';
import { applyMaterialTexture } from '@/lib/vrm/materials';
import { useEditorStore } from '@/stores/editorStore';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type StampShape = 'circle' | 'oval' | 'star' | 'heart' | 'diamond';

interface StampOriginal {
  shape: StampShape;
  x: number; y: number; sizeX: number; sizeY: number;
  color: string; opacity: number; rotation: number;
}

interface StampItem {
  id: string;
  shape: StampShape;
  x: number;       // 0–1 normalised (left→right)
  y: number;       // 0–1 normalised (top→bottom)
  sizeX: number;   // half-width  as fraction of canvas width
  sizeY: number;   // half-height as fraction of canvas height
  color: string;
  opacity: number; // 0–1
  rotation: number;// degrees, 0–359
  source?: 'ai';
  original?: StampOriginal;
}

type DragMode = 'move' | 'resize';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const TEXTURE_SLOTS = [
  { id: 'BaseTexture_Generate_Face',    label: '얼굴 피부', texW: 1024, texH: 1024, pattern: /Face_00_SKIN/i },
  { id: 'BaseTexture_Generate_Pupil',   label: '눈동자',    texW: 1024, texH: 512,  pattern: /EyeIris|Iris_00_EYE/i },
  { id: 'BaseTexture_Generate_Eyebrow', label: '눈썹',      texW: 1024, texH: 256,  pattern: /FaceBrow|Brow_00_FACE/i },
] as const;

const SHAPES: { id: StampShape; label: string; char: string }[] = [
  { id: 'circle',  label: '원',     char: '●' },
  { id: 'oval',    label: '타원',   char: '⬭' },
  { id: 'star',    label: '별',     char: '★' },
  { id: 'heart',   label: '하트',   char: '♥' },
  { id: 'diamond', label: '마름모', char: '◆' },
];

const CANVAS_W     = 280;
const BOX_PAD      = 7;
const MIN_BOX_HALF = 12;
const HANDLE_HS    = 5;
const DEL_R        = 8;
const MIN_STAMP_SIZE = 0.003;

// ─────────────────────────────────────────────────────────────────────────────
// Draw helpers
// ─────────────────────────────────────────────────────────────────────────────
function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number) {
  ctx.beginPath();
  const inner = outerR * 0.45;
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : inner;
    if (i === 0) ctx.moveTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    else          ctx.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
  }
  ctx.closePath();
}

function drawHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // x offsets halved so width (1.62r) ≈ height (1.485r) → roughly 1:1 like ♥
  const s = r * 0.9;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.85);
  ctx.bezierCurveTo(cx - s * 0.75, cy + s * 0.2, cx - s * 0.9, cy - s * 0.8, cx, cy - s * 0.25);
  ctx.bezierCurveTo(cx + s * 0.9, cy - s * 0.8, cx + s * 0.75, cy + s * 0.2, cx, cy + s * 0.85);
  ctx.closePath();
}

// translate → rotate → scale(rx,ry) → draw unit shape at origin
function drawShape(ctx: CanvasRenderingContext2D, s: StampItem, px: number, py: number, rx: number, ry: number) {
  ctx.save();
  ctx.globalAlpha = s.opacity;
  ctx.fillStyle   = s.color;
  ctx.translate(px, py);
  if (s.rotation) ctx.rotate((s.rotation * Math.PI) / 180);
  ctx.scale(rx, ry); // unit shape → actual size (non-uniform allowed)
  switch (s.shape) {
    case 'circle':
    case 'oval':
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); break;
    case 'star':
      drawStar(ctx, 0, 0, 1); ctx.fill(); break;
    case 'heart':
      drawHeart(ctx, 0, 0, 1); ctx.fill(); break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(0,    -1);
      ctx.lineTo(0.65,  0);
      ctx.lineTo(0,     1);
      ctx.lineTo(-0.65, 0);
      ctx.closePath();
      ctx.fill();
      break;
  }
  ctx.restore();
}

// bounding box half-sizes in canvas units (non-uniform)
function boxHalfXY(s: StampItem, cw: number, ch: number) {
  return {
    hx: Math.max(s.sizeX * cw + BOX_PAD, MIN_BOX_HALF),
    hy: Math.max(s.sizeY * ch + BOX_PAD, MIN_BOX_HALF),
  };
}

// Selection box + handles drawn in stamp's rotated local space
function drawStamp(
  ctx: CanvasRenderingContext2D,
  s: StampItem,
  cw: number, ch: number,
  selected: boolean,
) {
  const px = s.x * cw, py = s.y * ch;
  drawShape(ctx, s, px, py, s.sizeX * cw, s.sizeY * ch);
  if (!selected) return;

  const { hx, hy } = boxHalfXY(s, cw, ch);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate((s.rotation * Math.PI) / 180);

  // dashed selection rectangle
  ctx.save();
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(-hx, -hy, hx * 2, hy * 2);
  ctx.restore();

  // corner handles: TL, BL, BR
  const corners: [number, number][] = [[-hx, -hy], [-hx, hy], [hx, hy]];
  for (const [cx, cy] of corners) {
    ctx.save();
    ctx.fillStyle   = '#ffffff';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth   = 1.5;
    ctx.fillRect(cx - HANDLE_HS, cy - HANDLE_HS, HANDLE_HS * 2, HANDLE_HS * 2);
    ctx.strokeRect(cx - HANDLE_HS, cy - HANDLE_HS, HANDLE_HS * 2, HANDLE_HS * 2);
    ctx.restore();
  }

  // delete button at TR corner (hx, -hy)
  ctx.save();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(hx, -hy, DEL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 2;
  ctx.lineCap     = 'round';
  const d = 4;
  ctx.beginPath();
  ctx.moveTo(hx - d, -hy - d); ctx.lineTo(hx + d, -hy + d);
  ctx.moveTo(hx + d, -hy - d); ctx.lineTo(hx - d, -hy + d);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Hit-test helpers — all work in the stamp's rotated local space
// ─────────────────────────────────────────────────────────────────────────────
function toLocal(ex: number, ey: number, s: StampItem, cw: number, ch: number) {
  const dx = ex - s.x * cw, dy = ey - s.y * ch;
  const rad = -(s.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return { lx: dx * cos - dy * sin, ly: dx * sin + dy * cos };
}

function hitDeleteBtn(ex: number, ey: number, s: StampItem, cw: number, ch: number): boolean {
  const { lx, ly } = toLocal(ex, ey, s, cw, ch);
  const { hx, hy } = boxHalfXY(s, cw, ch);
  return Math.hypot(lx - hx, ly + hy) <= DEL_R + 3;
}

function hitCorner(ex: number, ey: number, s: StampItem, cw: number, ch: number): boolean {
  const { lx, ly } = toLocal(ex, ey, s, cw, ch);
  const { hx, hy } = boxHalfXY(s, cw, ch);
  const corners: [number, number][] = [[-hx, -hy], [-hx, hy], [hx, hy]];
  return corners.some(([cx, cy]) => Math.abs(lx - cx) <= HANDLE_HS + 3 && Math.abs(ly - cy) <= HANDLE_HS + 3);
}

function hitBody(ex: number, ey: number, s: StampItem, cw: number, ch: number): boolean {
  const { lx, ly } = toLocal(ex, ey, s, cw, ch);
  const { hx, hy } = boxHalfXY(s, cw, ch);
  return lx >= -hx && lx <= hx && ly >= -hy && ly <= hy;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export function TextureStampEditor({ isActive = false }: { isActive?: boolean }) {
  const proposedStamps   = useEditorStore((s) => s.proposedStamps);
  const setProposedStamps = useEditorStore((s) => s.setProposedStamps);

  const [slotIdx,      setSlotIdx]      = useState(0);
  const [stamps,       setStamps]       = useState<StampItem[]>([]);
  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [activeShape,  setActiveShape]  = useState<StampShape>('circle');
  const [color,        setColor]        = useState('#ffffff');
  const [size,         setSize]         = useState(0.05);
  const [opacity,      setOpacity]      = useState(1.0);
  const [rotation,     setRotation]     = useState(0);
  const [applyDone,    setApplyDone]    = useState(false); // 2-sec feedback
  const [isEditMode,   setIsEditMode]   = useState(true);  // false = 적용 모드
  const [baseImage,    setBaseImage]    = useState<CanvasImageSource | null>(null);
  const [loadingBase,  setLoadingBase]  = useState(false);
  const [initialUrl,    setInitialUrl]    = useState<string | null>(null);
  // HTMLImageElement loaded from initialUrl — used as canvas base in edit mode
  const [initialHtmlImage, setInitialHtmlImage] = useState<HTMLImageElement | null>(null);
  // stack of stamp snapshots saved on each Apply; rollback pops the top
  const [stampHistory, setStampHistory] = useState<StampItem[][]>([]);

  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const dragRef         = useRef<{ id: string; mode: DragMode; ox: number; oy: number } | null>(null);
  // snapshot of stamps as they were when last Apply was confirmed
  const lastAppliedRef  = useRef<StampItem[]>([]);
  // per-slot AI stamp originals — never cleared by rollback/reset, only updated when pipeline injects new stamps
  const aiOriginalsRef  = useRef<Record<string, StampItem[]>>({});
  // per-slot clean pipeline URL (before stamps) — used as initialUrl to avoid editing on a stamped base
  const pipelineUrlsRef = useRef<Record<string, string>>({});
  // mirror of stamps state — readable synchronously inside effects/callbacks
  const stampsRef       = useRef<StampItem[]>([]);
  // timer ID for pending auto-apply (setTimeout after stamp injection)
  const pendingApplyRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ID of the slotIdx-effect 300ms loadBaseTexture(true) timer — cancelled on AI inject
  const loadBaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slot   = TEXTURE_SLOTS[slotIdx];
  const aspect = slot.texH / slot.texW;
  const cw     = CANVAS_W;
  const ch     = Math.round(CANVAS_W * aspect);

  // ── when tab becomes active and texture not yet captured, retry load ─────────
  useEffect(() => {
    if (isActive && !initialUrl) loadBaseTexture(true);
  }, [isActive]); // eslint-disable-line

  // ── load HTMLImageElement from initialUrl ──────────────────────────────────
  useEffect(() => {
    if (!initialUrl) { setInitialHtmlImage(null); return; }
    const img = new Image();
    img.onload = () => setInitialHtmlImage(img);
    img.src = initialUrl;
  }, [initialUrl]);

  // ── keep stampsRef in sync so effects/callbacks can read latest stamps ──────
  useEffect(() => { stampsRef.current = stamps; }, [stamps]);


  // ── sync controls → selected stamp ────────────────────────────────────────
  const selectedStamp = stamps.find(s => s.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedStamp) return;
    setColor(selectedStamp.color);
    setSize(Math.max(selectedStamp.sizeX, selectedStamp.sizeY));
    setOpacity(selectedStamp.opacity);
    setRotation(selectedStamp.rotation);
    setActiveShape(selectedStamp.shape);
  }, [selectedId]); // eslint-disable-line

  const patchSelected = useCallback((patch: Partial<StampItem>) => {
    if (!selectedId) return;
    setStamps(prev => prev.map(s => s.id === selectedId ? { ...s, ...patch } : s));
  }, [selectedId]);

  // ── capture current base as data URL (for initialUrl) ─────────────────────
  const captureBaseAsUrl = useCallback((img: CanvasImageSource | null): string | null => {
    if (!img) return null;
    const off = document.createElement('canvas');
    off.width = slot.texW; off.height = slot.texH;
    const ctx = off.getContext('2d');
    if (!ctx) return null;
    try { ctx.drawImage(img, 0, 0, slot.texW, slot.texH); } catch { return null; }
    return off.toDataURL('image/png');
  }, [slot]);

  // ── load base texture from VRM ─────────────────────────────────────────────
  const loadBaseTexture = useCallback((captureInitial = false) => {
    const vrm = getBaseVRM();
    if (!vrm) return;
    setLoadingBase(true);

    const { pattern } = TEXTURE_SLOTS[slotIdx];
    let found = false;

    (vrm as any).scene.traverse((obj: any) => {
      if (found || !obj.isMesh) return;
      const mats: any[] = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!mat || !pattern.test(mat.name)) continue;
        const tex = mat.map ?? mat.colorTexture ?? null;
        if (tex?.image) {
          const img = tex.image as CanvasImageSource;
          setBaseImage(img);
          if (captureInitial) setInitialUrl(captureBaseAsUrl(img));
          found = true;
          break;
        }
      }
    });

    setLoadingBase(false);
  }, [slotIdx, captureBaseAsUrl]);

  useEffect(() => {
    setBaseImage(null);
    setStamps([]);
    setSelectedId(null);
    setIsEditMode(true);
    setInitialUrl(null);
    setStampHistory([]);
    lastAppliedRef.current = [];
    if (loadBaseTimerRef.current) clearTimeout(loadBaseTimerRef.current);

    const slotId = TEXTURE_SLOTS[slotIdx].id;
    const aiStamps = aiOriginalsRef.current[slotId];

    if (aiStamps && aiStamps.length > 0) {
      // AI stamps exist for this slot — restore applied state without re-rendering to VRM
      // Use the clean pipeline URL (before stamps) so editing is based on the unstamped texture
      const url = pipelineUrlsRef.current[slotId]
               ?? useEditorStore.getState().materials[slotId]?.textureUrl
               ?? null;
      if (url) setInitialUrl(url);
      setStamps([...aiStamps]);
      lastAppliedRef.current = [...aiStamps];
      setIsEditMode(false);
      // Just refresh baseImage (VRM already has stamps applied)
      loadBaseTimerRef.current = setTimeout(() => {
        loadBaseTimerRef.current = null;
        loadBaseTexture();
      }, 200);
    } else {
      loadBaseTimerRef.current = setTimeout(() => {
        loadBaseTimerRef.current = null;
        loadBaseTexture(true);
      }, 300);
    }

    return () => {
      if (loadBaseTimerRef.current) { clearTimeout(loadBaseTimerRef.current); loadBaseTimerRef.current = null; }
    };
  }, [slotIdx, loadBaseTexture]);

  // ── render a stamp list onto the initial texture and push to VRM ────────────
  const renderStampsToVRM = useCallback((stampList: StampItem[]) => {
    const vrm = getBaseVRM();
    if (!vrm) return;
    const doRender = (base: CanvasImageSource | null) => {
      const off = document.createElement('canvas');
      off.width = slot.texW; off.height = slot.texH;
      const ctx = off.getContext('2d');
      if (!ctx) return;
      if (base) { try { ctx.drawImage(base, 0, 0, slot.texW, slot.texH); } catch {} }
      for (const s of stampList) {
        drawShape(ctx, s, s.x * slot.texW, s.y * slot.texH, s.sizeX * slot.texW, s.sizeY * slot.texH);
      }
      const dataUrl = off.toDataURL('image/png');
      applyMaterialTexture(vrm, slot.id, dataUrl);
      // Update store so viewer treats this as the authoritative texture
      useEditorStore.getState().setSlotTextureUrl(slot.id, dataUrl);
      setTimeout(() => loadBaseTexture(), 200);
    };
    if (initialUrl) {
      const img = new Image();
      img.onload = () => doRender(img);
      img.src = initialUrl;
    } else {
      doRender(baseImage);
    }
  }, [slot, initialUrl, baseImage, loadBaseTexture]);

  // ── inject proposed stamps from pipeline result ────────────────────────────
  // Fires once when pipeline proposes stamps.
  // ALL slots: store originals in aiOriginalsRef + apply to VRM via setTimeout(0).
  // Active slot: also update editor UI (stamps list, applied mode, initialUrl).
  // Clears proposedStamps all at once to avoid re-triggering.
  useEffect(() => {
    if (!proposedStamps || Object.keys(proposedStamps).length === 0) return;
    const currentSlotId = TEXTURE_SLOTS[slotIdx].id;
    const store = useEditorStore.getState();

    for (const [sid, entries] of Object.entries(proposedStamps)) {
      if (!entries || entries.length === 0) continue;
      const info = TEXTURE_SLOTS.find(s => s.id === sid);
      if (!info) continue;
      const url = store.materials[sid]?.textureUrl ?? null;
      if (!url) continue;

      const newStamps: StampItem[] = entries.map((e) => {
        const orig: StampOriginal = {
          shape: e.shape, x: e.x, y: e.y,
          sizeX: e.size, sizeY: e.size,
          color: e.color, opacity: e.opacity, rotation: e.rotation,
        };
        return { id: crypto.randomUUID(), ...orig, source: 'ai', original: orig };
      });

      aiOriginalsRef.current[sid] = newStamps;
      pipelineUrlsRef.current[sid] = url; // preserve clean URL before stamps are applied

      // Apply to VRM after current React commit (setTimeout 0)
      const snapStamps = [...newStamps];
      const snapInfo   = info;
      const snapUrl    = url;
      const isCurrent  = sid === currentSlotId;

      const applyFn = () => {
        const vrm = getBaseVRM();
        if (!vrm) return;
        const img = new Image();
        img.onload = () => {
          const off = document.createElement('canvas');
          off.width = snapInfo.texW; off.height = snapInfo.texH;
          const ctx = off.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, off.width, off.height);
          for (const s of snapStamps) {
            drawShape(ctx, s, s.x * off.width, s.y * off.height, s.sizeX * off.width, s.sizeY * off.height);
          }
          const dataUrl = off.toDataURL('image/png');
          applyMaterialTexture(vrm, snapInfo.id, dataUrl);
          // Update store so viewer treats stamped texture as authoritative
          useEditorStore.getState().setSlotTextureUrl(snapInfo.id, dataUrl);
          if (isCurrent) setTimeout(() => loadBaseTexture(), 200);
        };
        img.src = snapUrl;
      };

      if (isCurrent) {
        if (pendingApplyRef.current) clearTimeout(pendingApplyRef.current);
        pendingApplyRef.current = setTimeout(() => { pendingApplyRef.current = null; applyFn(); }, 0);
      } else {
        setTimeout(applyFn, 0);
      }
    }

    // Update editor UI for the active slot
    const currentAI = aiOriginalsRef.current[currentSlotId] ?? [];
    if (currentAI.length > 0) {
      const nonAI      = stampsRef.current.filter(s => s.source !== 'ai');
      const allCurrent = [...currentAI, ...nonAI];
      setStamps(allCurrent);
      const prevSnap = [...lastAppliedRef.current];
      lastAppliedRef.current = allCurrent;
      setStampHistory(h => [...h, prevSnap]);
      setIsEditMode(false);
      setSelectedId(null);
      if (loadBaseTimerRef.current) { clearTimeout(loadBaseTimerRef.current); loadBaseTimerRef.current = null; }
      // Use pipelineUrlsRef — guaranteed clean (before stamps), falls back to store
      const currentUrl = pipelineUrlsRef.current[currentSlotId]
                      ?? store.materials[currentSlotId]?.textureUrl
                      ?? null;
      if (currentUrl) setInitialUrl(currentUrl);
    }

    // Clear ALL at once — prevents re-triggering from partial removal
    setProposedStamps(null);
  }, [proposedStamps]); // eslint-disable-line

  // ── canvas render ──────────────────────────────────────────────────────────
  // edit mode: initial texture + stamps (live preview)
  // applied mode: baseImage only (VRM result, stamps already baked in)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cw, ch);

    const src = isEditMode ? (initialHtmlImage ?? baseImage) : baseImage;
    if (src) {
      try { ctx.drawImage(src, 0, 0, cw, ch); } catch {}
    } else {
      const cell = 12;
      for (let row = 0; row < ch; row += cell) {
        for (let col = 0; col < cw; col += cell) {
          ctx.fillStyle = ((col / cell + row / cell) % 2 === 0) ? '#e5e7eb' : '#d1d5db';
          ctx.fillRect(col, row, cell, cell);
        }
      }
    }

    if (isEditMode) {
      for (const s of stamps) drawStamp(ctx, s, cw, ch, s.id === selectedId);
    }
  }, [stamps, selectedId, cw, ch, baseImage, isEditMode, initialHtmlImage]);

  // ── coordinate helper ──────────────────────────────────────────────────────
  const getPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const el = canvasRef.current!;
    const rect = el.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (el.width  / rect.width),
      y: (e.clientY - rect.top)  * (el.height / rect.height),
    };
  }, []);

  // ── mouse events (edit mode only) ─────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isEditMode) return;
    e.preventDefault();
    const { x, y } = getPos(e);

    if (selectedStamp && hitDeleteBtn(x, y, selectedStamp, cw, ch)) {
      setStamps(prev => prev.filter(s => s.id !== selectedStamp.id));
      setSelectedId(null);
      return;
    }
    if (selectedStamp && hitCorner(x, y, selectedStamp, cw, ch)) {
      dragRef.current = { id: selectedStamp.id, mode: 'resize', ox: x, oy: y };
      return;
    }
    for (let i = stamps.length - 1; i >= 0; i--) {
      const s = stamps[i];
      if (hitBody(x, y, s, cw, ch)) {
        setSelectedId(s.id);
        dragRef.current = { id: s.id, mode: 'move', ox: x - s.x * cw, oy: y - s.y * ch };
        return;
      }
    }
    setSelectedId(null);
  }, [isEditMode, getPos, selectedStamp, stamps, cw, ch]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isEditMode || !dragRef.current) return;
    const { x, y } = getPos(e);
    const { id, mode, ox, oy } = dragRef.current;

    if (mode === 'move') {
      setStamps(prev => prev.map(s => s.id !== id ? s : {
        ...s,
        x: Math.max(0, Math.min(1, (x - ox) / cw)),
        y: Math.max(0, Math.min(1, (y - oy) / ch)),
      }));
    } else {
      const s = stamps.find(st => st.id === id);
      if (!s) return;
      const { lx, ly } = toLocal(x, y, s, cw, ch);
      setStamps(prev => prev.map(st => st.id !== id ? st : {
        ...st,
        sizeX: Math.max(MIN_STAMP_SIZE, Math.min(0.45, (Math.abs(lx) - BOX_PAD) / cw)),
        sizeY: Math.max(MIN_STAMP_SIZE, Math.min(0.45, (Math.abs(ly) - BOX_PAD) / ch)),
      }));
    }
  }, [isEditMode, getPos, stamps, cw, ch]);

  const handleMouseUp = useCallback(() => { dragRef.current = null; }, []);

  // ── add stamp ──────────────────────────────────────────────────────────────
  const addStamp = useCallback(() => {
    const id = crypto.randomUUID();
    const sY = activeShape === 'oval' ? size * 0.55 : size;
    setStamps(prev => [...prev, {
      id, shape: activeShape,
      x: 0.5 + (Math.random() - 0.5) * 0.1,
      y: 0.5 + (Math.random() - 0.5) * 0.1,
      sizeX: size, sizeY: sY, color, opacity, rotation,
    }]);
    setSelectedId(id);
  }, [activeShape, size, color, opacity, rotation]);

  // ── keyboard delete (edit mode only) ──────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        !isEditMode ||
        !(e.key === 'Delete' || e.key === 'Backspace') ||
        !selectedId ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;
      setStamps(prev => prev.filter(s => s.id !== selectedId));
      setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isEditMode, selectedId]);

  // ── apply: render stamps onto initial texture → VRM, enter applied mode ───
  const handleApply = useCallback(() => {
    if (stamps.length === 0) return;
    renderStampsToVRM(stamps);
    const prevSnapshot = [...lastAppliedRef.current];
    lastAppliedRef.current = [...stamps];
    setStampHistory(h => [...h, prevSnapshot]);
    setIsEditMode(false);
    setSelectedId(null);
    setApplyDone(true);
    setTimeout(() => setApplyDone(false), 2000);
  }, [stamps, renderStampsToVRM]);

  // ── enter edit mode: all stamps become editable again ─────────────────────
  const handleEnterEdit = useCallback(() => {
    setIsEditMode(true);
    setSelectedId(null);
  }, []);

  // ── rollback: restore previous applied stamp state ────────────────────────
  // AI stamps always revert to their originals; non-AI stamps restore from history.
  const handleRollback = useCallback(() => {
    const vrm = getBaseVRM();
    if (!vrm || stampHistory.length === 0) return;

    const histSnap = stampHistory[stampHistory.length - 1];
    setStampHistory(h => h.slice(0, -1));

    // Merge: AI originals (reverted) + non-AI stamps from history snapshot
    const aiOriginals = (aiOriginalsRef.current[slot.id] ?? []).map(
      s => ({ ...s, ...(s.original ?? {}) })
    );
    const nonAI = histSnap.filter(s => s.source !== 'ai');
    const merged = [...aiOriginals, ...nonAI];

    lastAppliedRef.current = merged;
    setStamps(merged);
    setSelectedId(null);

    if (merged.length === 0 && initialUrl) {
      applyMaterialTexture(vrm, slot.id, initialUrl);
      setTimeout(() => loadBaseTexture(), 200);
    } else {
      renderStampsToVRM(merged);
    }
  }, [stampHistory, slot, initialUrl, renderStampsToVRM]);

  // ── reset: restore AI stamps from originals (even if manually deleted), delete user stamps
  const handleReset = useCallback(() => {
    const vrm = getBaseVRM();
    if (!vrm || !initialUrl) return;
    applyMaterialTexture(vrm, slot.id, initialUrl);
    // Use aiOriginalsRef so manually-deleted AI stamps are also recovered
    const aiOriginals = (aiOriginalsRef.current[slot.id] ?? []).map(
      s => ({ ...s, ...(s.original ?? {}) })
    );
    setStamps(aiOriginals);
    setSelectedId(null);
    setIsEditMode(true);
    setStampHistory([]);
    lastAppliedRef.current = [];
    setTimeout(() => loadBaseTexture(), 200);
  }, [initialUrl, slot, loadBaseTexture]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Texture slot selector ── */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">편집 텍스처</label>
        <div className="flex gap-1.5">
          <select
            className="flex-1 text-sm border border-border rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            value={slotIdx}
            onChange={e => setSlotIdx(Number(e.target.value))}
          >
            {TEXTURE_SLOTS.map((t, i) => (
              <option key={t.id} value={i}>{t.label} ({t.texW}×{t.texH})</option>
            ))}
          </select>
          <button
            onClick={() => loadBaseTexture()}
            title="현재 텍스처 다시 불러오기"
            className="px-2 py-1.5 rounded-md border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingBase ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {!baseImage && (
          <p className="text-[10px] text-muted-foreground/50">
            VRM 로드 후 새로고침 버튼을 눌러 현재 텍스처를 불러오세요
          </p>
        )}
      </div>

      {/* ── Mode indicator ── */}
      <div className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-border/40 bg-muted/20">
        <span className={`w-2 h-2 rounded-full shrink-0 ${isEditMode ? 'bg-primary' : 'bg-emerald-500'}`} />
        <span className="text-xs font-medium flex-1">
          {isEditMode ? '편집 모드' : '적용 모드'}
        </span>
        <span className="text-[10px] text-muted-foreground/50">
          {isEditMode ? '스탬프를 배치하고 적용하세요' : '편집을 눌러 스탬프를 수정하세요'}
        </span>
      </div>

      {/* ── Shape selector & controls (edit mode only) ── */}
      {isEditMode && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">도형</label>
            <div className="grid grid-cols-5 gap-1">
              {SHAPES.map(sh => (
                <button
                  key={sh.id}
                  title={sh.label}
                  onClick={() => {
                    setActiveShape(sh.id);
                    patchSelected({ shape: sh.id });
                  }}
                  className={`flex flex-col items-center gap-0.5 py-1.5 text-base rounded-md border transition-colors ${
                    (selectedStamp ? selectedStamp.shape : activeShape) === sh.id
                      ? 'bg-primary/15 border-primary text-primary'
                      : 'border-border/60 bg-background text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {sh.char}
                  <span className="text-[9px]">{sh.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground w-10 shrink-0">색상</label>
              <input
                type="color"
                value={selectedStamp ? selectedStamp.color : color}
                onChange={e => { setColor(e.target.value); patchSelected({ color: e.target.value }); }}
                className="w-8 h-7 rounded cursor-pointer border border-border p-0.5 bg-transparent"
              />
              <span className="text-xs text-muted-foreground font-mono">
                {selectedStamp ? selectedStamp.color : color}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground w-10 shrink-0">크기</label>
              <input
                type="range" min={MIN_STAMP_SIZE * 100} max={40} step={0.1}
                value={(selectedStamp ? Math.max(selectedStamp.sizeX, selectedStamp.sizeY) : size) * 100}
                onChange={e => {
                  const v = Math.max(MIN_STAMP_SIZE, Number(e.target.value) / 100);
                  setSize(v);
                  if (selectedStamp) {
                    const cur = Math.max(selectedStamp.sizeX, selectedStamp.sizeY) || v;
                    const scale = v / cur;
                    patchSelected({ sizeX: selectedStamp.sizeX * scale, sizeY: selectedStamp.sizeY * scale });
                  }
                }}
                className="flex-1 h-1.5 accent-primary"
              />
              <span className="text-xs text-primary font-mono w-8 text-right">
                {((selectedStamp ? Math.max(selectedStamp.sizeX, selectedStamp.sizeY) : size) * 100).toFixed(1)}%
              </span>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground w-10 shrink-0">투명도</label>
              <input
                type="range" min={10} max={100} step={1}
                value={(selectedStamp ? selectedStamp.opacity : opacity) * 100}
                onChange={e => {
                  const v = Number(e.target.value) / 100;
                  setOpacity(v);
                  patchSelected({ opacity: v });
                }}
                className="flex-1 h-1.5 accent-primary"
              />
              <span className="text-xs text-primary font-mono w-8 text-right">
                {Math.round((selectedStamp ? selectedStamp.opacity : opacity) * 100)}%
              </span>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground w-10 shrink-0">회전</label>
              <input
                type="range" min={0} max={359} step={1}
                value={selectedStamp ? selectedStamp.rotation : rotation}
                onChange={e => {
                  const v = Number(e.target.value);
                  setRotation(v);
                  patchSelected({ rotation: v });
                }}
                className="flex-1 h-1.5 accent-primary"
              />
              <span className="text-xs text-primary font-mono w-8 text-right">
                {selectedStamp ? selectedStamp.rotation : rotation}°
              </span>
            </div>
          </div>
        </>
      )}

      {/* ── Canvas ── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">
            미리보기
            <span className="ml-1 text-[10px] text-muted-foreground/50">({stamps.length}개)</span>
          </label>
          {isEditMode && (
            <div className="flex items-center gap-2">
              {stamps.length > 0 && (
                <button
                  onClick={() => { setStamps([]); setSelectedId(null); }}
                  className="text-[10px] text-destructive hover:opacity-70 transition-opacity"
                >
                  전체 삭제
                </button>
              )}
              <button
                onClick={addStamp}
                className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/30"
              >
                <Plus className="w-3 h-3" />
                스탬프 추가
              </button>
            </div>
          )}
        </div>

        <div className={`rounded-lg overflow-hidden border shadow-sm ${isEditMode ? 'border-border' : 'border-emerald-500/30'}`}>
          <canvas
            ref={canvasRef}
            width={cw}
            height={ch}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={`w-full h-auto block select-none ${isEditMode ? 'cursor-default' : 'cursor-not-allowed'}`}
          />
        </div>

        <p className="text-[10px] text-muted-foreground/50 text-center">
          {isEditMode
            ? (selectedId
                ? '드래그로 이동 · 모서리 핸들로 크기 조정 · 빨간 × 버튼으로 삭제'
                : '스탬프를 클릭하여 선택 · 상단 "스탬프 추가" 버튼으로 추가')
            : '적용 모드 — 편집 버튼을 눌러 스탬프를 수정하세요'}
        </p>
      </div>

      {/* ── Stamp list ── */}
      {stamps.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">배치된 스탬프</label>
          <div className="space-y-1 max-h-36 overflow-y-auto scrollbar-thin">
            {stamps.map((s, i) => {
              const sh = SHAPES.find(x => x.id === s.shape);
              return (
                <div
                  key={s.id}
                  onClick={() => isEditMode && setSelectedId(s.id)}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border transition-colors ${
                    isEditMode
                      ? s.id === selectedId
                        ? 'bg-primary/10 border-primary/50 cursor-pointer'
                        : 'border-border/40 hover:bg-accent/50 cursor-pointer'
                      : 'border-border/20 bg-muted/20 cursor-default'
                  }`}
                >
                  <div
                    className="w-3.5 h-3.5 rounded-full shrink-0 border border-border/50"
                    style={{ backgroundColor: s.color, opacity: s.opacity }}
                  />
                  <span className="text-xs flex-1 flex items-center gap-1">
                    {sh?.char} {sh?.label}
                    {s.source === 'ai' && (
                      <span className="text-[9px] px-1 py-0 rounded bg-violet-500/15 text-violet-500 font-medium shrink-0">AI</span>
                    )}
                    <span className="text-muted-foreground/50">#{i + 1}</span>
                  </span>
                  {isEditMode ? (
                    <>
                      <span className="text-[10px] text-muted-foreground/40 font-mono shrink-0">
                        {Math.round(s.x * 100)},{Math.round(s.y * 100)}
                      </span>
                      {s.rotation !== 0 && (
                        <span className="text-[10px] text-muted-foreground/40 font-mono shrink-0">
                          {s.rotation}°
                        </span>
                      )}
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setStamps(prev => prev.filter(x => x.id !== s.id));
                          if (selectedId === s.id) setSelectedId(null);
                        }}
                        className="text-muted-foreground/30 hover:text-destructive transition-colors shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-600 font-medium shrink-0">
                      적용됨
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Action buttons ── */}
      {isEditMode ? (
        <button
          onClick={handleApply}
          disabled={stamps.length === 0}
          className={`w-full py-2 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
            stamps.length === 0
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : applyDone
                ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm'
          }`}
        >
          {applyDone ? (
            <><Check className="w-4 h-4" /> 적용 완료</>
          ) : (
            'VRM 텍스처에 적용'
          )}
        </button>
      ) : (
        <div className="flex gap-1.5">
          <button
            onClick={handleEnterEdit}
            className="flex-1 py-2 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-1.5 bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30"
          >
            <Pencil className="w-4 h-4" />
            편집
          </button>
          {stampHistory.length > 0 && (
            <button
              onClick={handleRollback}
              className="flex-1 py-2 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-1.5 border border-amber-400/50 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
            >
              <Undo2 className="w-4 h-4" />
              되돌리기 ({stampHistory.length})
            </button>
          )}
        </div>
      )}

      {/* ── Reset ── */}
      {initialUrl && (
        <button
          onClick={handleReset}
          title={stamps.some(s => s.source === 'ai') ? 'AI 스탬프는 처음 값으로 복원, 직접 추가한 스탬프는 삭제됩니다' : '모든 스탬프를 삭제하고 텍스처를 초기화합니다'}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-border bg-background text-muted-foreground hover:bg-accent text-xs font-medium transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          처음으로 초기화
          {stamps.some(s => s.source === 'ai') && (
            <span className="text-[9px] px-1 py-0 rounded bg-violet-500/15 text-violet-500 font-medium">AI 복원</span>
          )}
        </button>
      )}
    </div>
  );
}
