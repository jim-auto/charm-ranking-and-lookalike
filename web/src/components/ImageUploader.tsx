import { useCallback, useRef, useState } from 'react';

interface Props {
  onImageSelected: (img: HTMLImageElement) => void;
  isProcessing: boolean;
  processingLabel?: string;
}

export default function ImageUploader({
  onImageSelected,
  isProcessing,
  processingLabel,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => onImageSelected(img);
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    },
    [onImageSelected],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div
      className={`rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
        dragOver
          ? 'border-indigo-400 bg-indigo-950/50'
          : 'cursor-pointer border-slate-600 hover:border-slate-400'
      } ${isProcessing ? 'pointer-events-none opacity-60' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onClick={() => {
        if (!isProcessing) inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {isProcessing ? (
        <div className="text-slate-300">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          <p className="text-lg font-medium">{processingLabel ?? '診断中...'}</p>
          <p className="mt-2 text-sm text-slate-500">数秒かかることがあります</p>
        </div>
      ) : (
        <div className="text-slate-400">
          <div className="mb-3 text-4xl">📷</div>
          <p className="text-lg">顔写真をドロップ または クリックして選択</p>
          <p className="mt-2 text-sm text-slate-500">
            正面寄りの単顔写真だと精度が安定します
          </p>
        </div>
      )}
    </div>
  );
}
