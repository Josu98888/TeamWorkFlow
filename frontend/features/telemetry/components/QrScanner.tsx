'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/shared/components/Button';

// Minimal typing of the native Shape Detection API (not part of the TS DOM lib).
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null;
}

/** True when the browser can scan QR codes with the camera (native `BarcodeDetector` + `getUserMedia`). */
export const canScanQr = () =>
  getDetectorCtor() !== null && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** Camera preview that reports the first QR code it reads. Callers render it only when `canScanQr()`. */
export function QrScanner({ onDetected, onClose }: { onDetected: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const Detector = getDetectorCtor();
    if (!Detector) return;
    const detector = new Detector({ formats: ['qr_code'] });
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (media) => {
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = media;
        await video.play();
        timer = window.setInterval(() => {
          detector
            .detect(video)
            .then((codes) => {
              const value = codes[0]?.rawValue;
              if (value && !stopped) onDetected(value);
            })
            .catch(() => undefined);
        }, 300);
      })
      .catch(() => setError('No pudimos usar la cámara. Revisá el permiso o ingresá el código a mano.'));

    return () => {
      stopped = true;
      if (timer !== undefined) window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onDetected]);

  return (
    <div className="space-y-2">
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        <video ref={videoRef} muted playsInline className="aspect-square w-full rounded-lg bg-black object-cover" />
      )}
      <Button className="w-full py-2" onClick={onClose}>
        Cerrar cámara
      </Button>
    </div>
  );
}
