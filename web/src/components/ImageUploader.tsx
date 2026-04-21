import { useCallback, useEffect, useId, useRef, useState } from 'react';

interface Props {
  onImageSelected: (img: HTMLImageElement) => void;
  onError?: (message: string) => void;
  isProcessing: boolean;
  processingLabel?: string;
}

const IMAGE_EXTENSION_PATTERN = /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;
const MAX_IMAGE_FILE_BYTES = 50 * 1024 * 1024;
const IMAGE_LOAD_TIMEOUT_MS = 30_000;

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSION_PATTERN.test(file.name);
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export default function ImageUploader({
  onImageSelected,
  onError,
  isProcessing,
  processingLabel,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputId = useId();
  const objectUrlRef = useRef<string | null>(null);

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => revokeObjectUrl, [revokeObjectUrl]);

  const handleFile = useCallback(
    (file: File) => {
      if (!isImageFile(file)) {
        revokeObjectUrl();
        onError?.('画像ファイルを選択してください。JPEG、PNG、WebP、HEICなどの写真に対応しています。');
        return;
      }

      if (file.size === 0) {
        revokeObjectUrl();
        onError?.(
          '画像ファイルを取得できませんでした。iCloud写真の場合は、写真を端末にダウンロードしてからもう一度選択してください。',
        );
        return;
      }

      if (file.size > MAX_IMAGE_FILE_BYTES) {
        revokeObjectUrl();
        onError?.(
          `画像ファイルが大きすぎます（${formatMegabytes(file.size)}MB）。写真アプリでJPEGとして保存し直すか、少し小さくしてから試してください。`,
        );
        return;
      }

      revokeObjectUrl();

      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;
      const img = new Image();
      let settled = false;
      const loadTimeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        if (objectUrlRef.current === objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrlRef.current = null;
        }
        onError?.(
          '画像の読み込みに時間がかかりすぎています。iCloud写真の場合は端末にダウンロードしてから、またはJPEG/PNGで保存し直してから試してください。',
        );
      }, IMAGE_LOAD_TIMEOUT_MS);
      img.decoding = 'async';
      img.onload = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(loadTimeout);
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        if (width <= 0 || height <= 0) {
          if (objectUrlRef.current === objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrlRef.current = null;
          }
          onError?.(
            '画像サイズを読み取れませんでした。写真を端末に保存し直すか、JPEG/PNGで書き出してから試してください。',
          );
          return;
        }
        onImageSelected(img);
      };
      img.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(loadTimeout);
        if (objectUrlRef.current === objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrlRef.current = null;
        }
        onError?.(
          '画像を読み込めませんでした。Safariの場合は、写真アプリでJPEGまたはPNGとして保存し直してから試してください。',
        );
      };
      img.src = objectUrl;
    },
    [onError, onImageSelected, revokeObjectUrl],
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
    <label
      htmlFor={inputId}
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
      aria-disabled={isProcessing}
    >
      <input
        id={inputId}
        type="file"
        accept="image/*,.heic,.heif"
        className="sr-only"
        disabled={isProcessing}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.currentTarget.value = '';
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
          <p className="text-lg">写真をドロップ または クリックして選択</p>
          <p className="mt-2 text-sm text-slate-500">
            正面寄りで1人だけ写った写真だと精度が安定します
          </p>
        </div>
      )}
    </label>
  );
}
