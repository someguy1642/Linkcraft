import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Image as ImageIcon, X } from 'lucide-react';
import type { ShortLink } from '../shared/types';
import { buildShortUrl } from '../utils/clipboard';
import { useToast } from './ToastProvider';

interface QrModalProps {
  link: ShortLink | null;
  onClose: () => void;
}

export function QrModal({ link, onClose }: QrModalProps) {
  const { showToast } = useToast();
  const [fgColor, setFgColor] = useState('#0f172a');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [logoMode, setLogoMode] = useState<'none' | 'monogram' | 'custom'>('none');
  const [customLogoDataUrl, setCustomLogoDataUrl] = useState<string>('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const shortUrl = link ? buildShortUrl(link.code) : '';

  // Focus trap & Escape handling
  useEffect(() => {
    if (!link) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      prevFocus?.focus();
    };
  }, [link, onClose]);

  const drawQrToCanvas = async (canvas: HTMLCanvasElement, size: number) => {
    await QRCode.toCanvas(canvas, shortUrl, {
      width: size,
      margin: 2,
      errorCorrectionLevel: logoMode === 'none' ? 'M' : 'H',
      color: {
        dark: fgColor,
        light: bgColor,
      },
    });

    if (logoMode === 'none') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const badgeSize = Math.round(size * 0.22);
    const x = Math.round((size - badgeSize) / 2);
    const y = Math.round((size - badgeSize) / 2);
    const radius = Math.round(badgeSize * 0.22);

    // Clean quiet box around center overlay so QR remains scannable
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(x - 6, y - 6, badgeSize + 12, badgeSize + 12, radius);
    ctx.fill();

    if (logoMode === 'monogram') {
      ctx.fillStyle = fgColor;
      ctx.beginPath();
      ctx.roundRect(x, y, badgeSize, badgeSize, radius - 2);
      ctx.fill();

      ctx.fillStyle = bgColor;
      ctx.font = `700 ${Math.round(badgeSize * 0.54)}px "Plus Jakarta Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('L', size / 2, size / 2 + 1);
    } else if (logoMode === 'custom' && customLogoDataUrl) {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(x, y, badgeSize, badgeSize, radius - 2);
          ctx.clip();
          ctx.drawImage(img, x, y, badgeSize, badgeSize);
          ctx.restore();
          resolve();
        };
        img.onerror = () => resolve();
        img.src = customLogoDataUrl;
      });
    }
  };

  useEffect(() => {
    if (!link || !canvasRef.current) return;
    void drawQrToCanvas(canvasRef.current, 260);
  }, [link, shortUrl, fgColor, bgColor, logoMode, customLogoDataUrl]);

  if (!link) return null;

  const handleDownloadPng = async () => {
    const offscreen = document.createElement('canvas');
    offscreen.width = 1024;
    offscreen.height = 1024;
    await drawQrToCanvas(offscreen, 1024);
    const dataUrl = offscreen.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `qr-${link.code}-1024.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Downloaded 1024×1024 PNG QR code', 'success');
  };

  const handleDownloadSvg = async () => {
    let svg = await QRCode.toString(shortUrl, {
      type: 'svg',
      margin: 2,
      errorCorrectionLevel: logoMode === 'none' ? 'M' : 'H',
      color: { dark: fgColor, light: bgColor },
    });

    if (logoMode === 'monogram') {
      const overlay = `<rect x="38%" y="38%" width="24%" height="24%" rx="4" fill="${bgColor}"/><rect x="40%" y="40%" width="20%" height="20%" rx="3" fill="${fgColor}"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="11%" fill="${bgColor}">L</text></svg>`;
      svg = svg.replace('</svg>', overlay);
    }

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qr-${link.code}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Downloaded scalable SVG QR code', 'success');
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCustomLogoDataUrl(reader.result);
        setLogoMode('custom');
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-modal-title"
        className="animate-scale-pop w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <h2 id="qr-modal-title" className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              QR Code Studio
            </h2>
            <p className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">{shortUrl}</p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close QR Code Studio"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          {/* Live Canvas Preview */}
          <div className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
            <canvas
              ref={canvasRef}
              width={260}
              height={260}
              aria-label={`QR code preview for ${shortUrl}`}
              className="h-[220px] w-[220px] rounded-lg"
            />
          </div>

          {/* Customization Controls */}
          <div className="flex-1 space-y-4 w-full">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="qr-fg-color"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Foreground
                </label>
                <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 dark:border-slate-700">
                  <input
                    id="qr-fg-color"
                    type="color"
                    value={fgColor}
                    onChange={(e) => setFgColor(e.target.value)}
                    className="h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  <span className="font-mono text-xs text-slate-700 truncate dark:text-slate-300">{fgColor}</span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="qr-bg-color"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Background
                </label>
                <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 dark:border-slate-700">
                  <input
                    id="qr-bg-color"
                    type="color"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  <span className="font-mono text-xs text-slate-700 truncate dark:text-slate-300">{bgColor}</span>
                </div>
              </div>
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Center Logo Overlay
              </span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setLogoMode('none')}
                  className={`min-h-[36px] rounded-md border px-3 text-xs font-medium ${
                    logoMode === 'none'
                      ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                      : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  None
                </button>
                <button
                  type="button"
                  onClick={() => setLogoMode('monogram')}
                  className={`min-h-[36px] rounded-md border px-3 text-xs font-medium ${
                    logoMode === 'monogram'
                      ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                      : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  Monogram
                </button>
                <label className="min-h-[36px] inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Upload Logo</span>
                  <input type="file" accept="image/*" onChange={handleLogoUpload} className="sr-only" />
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={handleDownloadPng}
                className="min-h-[44px] inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 whitespace-nowrap dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Download PNG (1024px)</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadSvg}
                className="min-h-[44px] inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Download Vector SVG</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
