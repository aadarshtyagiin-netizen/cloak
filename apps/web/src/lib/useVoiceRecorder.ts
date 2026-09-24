import { useRef, useState } from 'react';

export interface VoiceRecording {
  blob: Blob;
  durationMs: number;
  waveform: number[];
}

/**
 * Records mic audio via MediaRecorder and samples a coarse amplitude waveform
 * from a Web Audio AnalyserNode. stop() resolves with the recording; cancel()
 * discards it. Fully client-side — the blob is uploaded by the caller.
 */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [supported] = useState(
    () => typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof MediaRecorder !== 'undefined',
  );

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const waveRef = useRef<number[]>([]);
  const startRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const rafRef = useRef<number | undefined>(undefined);
  const ctxRef = useRef<AudioContext | null>(null);

  function cleanup(): void {
    window.clearInterval(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void ctxRef.current?.close().catch(() => undefined);
    streamRef.current = null;
    ctxRef.current = null;
    recRef.current = null;
  }

  async function start(): Promise<boolean> {
    if (!supported || recording) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      waveRef.current = [];

      const rec = new MediaRecorder(stream);
      recRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start();

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      let lastSample = 0;
      const sample = (): void => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) * (v - 128);
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (now - lastSample > 120) {
          waveRef.current.push(Math.min(100, Math.round(rms * 3)));
          lastSample = now;
        }
        rafRef.current = requestAnimationFrame(sample);
      };
      rafRef.current = requestAnimationFrame(sample);

      startRef.current = Date.now();
      setElapsedMs(0);
      timerRef.current = window.setInterval(() => setElapsedMs(Date.now() - startRef.current), 200);
      setRecording(true);
      return true;
    } catch {
      cleanup();
      return false;
    }
  }

  function stop(): Promise<VoiceRecording | null> {
    return new Promise((resolve) => {
      const rec = recRef.current;
      if (!rec) {
        resolve(null);
        return;
      }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        const durationMs = Date.now() - startRef.current;
        const waveform = waveRef.current.slice();
        cleanup();
        setRecording(false);
        setElapsedMs(0);
        resolve(blob.size > 0 ? { blob, durationMs, waveform } : null);
      };
      rec.stop();
    });
  }

  function cancel(): void {
    const rec = recRef.current;
    if (rec) {
      rec.onstop = () => cleanup();
      try {
        rec.stop();
      } catch {
        cleanup();
      }
    } else {
      cleanup();
    }
    setRecording(false);
    setElapsedMs(0);
  }

  return { supported, recording, elapsedMs, start, stop, cancel };
}
