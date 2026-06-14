import { useState, useRef } from 'react';
import { Upload, Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import type { PresetItem } from '@/types/preset';

type UploadStatus = 'idle' | 'pending' | 'uploading' | 'processing' | 'success' | 'error';

export function AccessoryUpload() {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [accessoryName, setAccessoryName] = useState<string>('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceSingleAccessory = useEditorStore((s) => s.replaceSingleAccessory);
  const addCustomPreset = useEditorStore((s) => s.addCustomPreset);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isGlb = file.name.toLowerCase().endsWith('.glb');
    const isImage = file.name.toLowerCase().match(/\.(png|jpe?g|webp)$/i);

    if (!isGlb && !isImage) {
      setStatus('error');
      setErrorMessage('GLB 파일 또는 이미지 파일(.png, .jpg, .jpeg, .webp)만 업로드할 수 있습니다.');
      return;
    }

    setSelectedFile(file);
    // Remove extension for default name
    const defaultName = file.name.replace(/\.[^/.]+$/, "");
    setAccessoryName(defaultName);
    setStatus('pending');
    setErrorMessage('');
  };

  const cancelUpload = () => {
    setSelectedFile(null);
    setAccessoryName('');
    setStatus('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile) return;

    const isGlb = selectedFile.name.toLowerCase().endsWith('.glb');
    const type = isGlb ? 'glb' : 'image';
    
    try {
      setStatus(type === 'image' ? 'processing' : 'uploading');
      setErrorMessage('');

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('type', type);

      const res = await fetch('/api/accessory-generate', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setStatus('success');
      
      const customId = `custom-acc-${Date.now()}`;
      
      addCustomPreset({
        id: data.url, // We use URL as id so the catalog resolves it
        name: accessoryName.trim() || '커스텀 악세사리',
        category: 'accessory',
        thumbnailUrl: '', // Could generate a thumbnail, but leave empty for now
        meshUrl: data.url,
      });

      // 장착
      replaceSingleAccessory({
        presetId: data.url,
        category: 'glasses', // 임시로 모두 안경 카테고리로 지정
      });

      // 3초 후 초기화
      setTimeout(() => {
        setStatus('idle');
        setSelectedFile(null);
        setAccessoryName('');
      }, 3000);
      if (fileInputRef.current) fileInputRef.current.value = '';

    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error.message || 'An error occurred');
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-border/40 bg-card/40 p-4">
      <h3 className="mb-3 text-sm font-medium text-foreground/90">악세사리 추가</h3>
      
      {status === 'pending' && selectedFile ? (
        <div className="flex flex-col gap-3 p-3 border rounded-lg bg-background/50">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">{selectedFile.name}</span>
            <button onClick={cancelUpload} className="p-1 rounded-md hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">악세사리 이름</label>
            <input 
              type="text" 
              value={accessoryName}
              onChange={(e) => setAccessoryName(e.target.value)}
              className="w-full text-xs bg-background border border-border/50 rounded p-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="이름을 입력하세요"
            />
          </div>
          <button 
            onClick={handleUploadSubmit}
            className="w-full mt-1 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-xs py-1.5 font-medium transition-colors"
          >
            {selectedFile.name.toLowerCase().endsWith('.glb') ? 'GLB 업로드' : 'Varco 3D로 생성하기'}
          </button>
        </div>
      ) : (
        <div 
          className="relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border/50 bg-background/50 p-6 transition-colors hover:bg-accent/20"
          onClick={() => status === 'idle' || status === 'error' ? fileInputRef.current?.click() : null}
        >
          <input 
            type="file" 
            ref={fileInputRef}
            className="hidden" 
            accept=".glb,.png,.jpg,.jpeg,.webp"
            onChange={handleFileChange}
            disabled={status === 'uploading' || status === 'processing'}
          />

          {status === 'idle' && (
            <>
              <Upload className="mb-2 h-6 w-6 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground font-medium">클릭하거나 파일을 드래그하여 업로드</p>
              <p className="mt-1.5 text-[10px] text-muted-foreground/60 text-center max-w-[220px]">
                추가하고 싶은 악세사리의 이미지나 glb 파일을 자유롭게 업로드 하세요.
              </p>
            </>
          )}

          {status === 'uploading' && (
            <div className="flex flex-col items-center gap-2 text-primary">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-xs font-medium">GLB 파일 업로드 중...</span>
            </div>
          )}

          {status === 'processing' && (
            <div className="flex flex-col items-center gap-2 text-primary text-center">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-xs font-medium">악세사리 3D화 하는 중이에요.</span>
              <span className="text-[10px] text-primary/60">입체화에는 약 2~3분 정도 걸려요</span>
            </div>
          )}

          {status === 'success' && (
            <div className="flex flex-col items-center gap-2 text-emerald-500">
              <CheckCircle2 className="h-6 w-6" />
              <span className="text-xs font-medium">성공적으로 적용되었습니다!</span>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center gap-2 text-destructive text-center">
              <AlertCircle className="h-6 w-6" />
              <span className="text-xs font-medium">업로드/생성 실패</span>
              <p className="text-[10px] opacity-80 max-w-[200px] break-words">{errorMessage}</p>
              <button 
                onClick={(e) => { e.stopPropagation(); setStatus('idle'); }} 
                className="mt-2 px-3 py-1 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded text-[10px]"
              >
                다시 시도
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
