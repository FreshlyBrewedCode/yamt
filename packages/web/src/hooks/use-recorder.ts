import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { isBusy, levelOf, micError, pickMimeType, type RecorderState, recorderReducer } from "@/lib/recorder";

export interface Recording {
  blob: Blob;
  mimeType: string;
  startedAt: number;
  durationMs: number;
}

/** How many level bars the meter shows (the newest on the right). */
export const LEVEL_BARS = 22;
const LEVEL_EVERY_MS = 120;

/**
 * The in-app recorder: MediaRecorder (audio/mp4 on iOS, WebM elsewhere), a level meter from a
 * Web Audio AnalyserNode, a screen wake lock while recording (where the browser has one), and
 * the duration. Stopping hands the recording to `onRecorded`. iOS stops a PWA's recording when
 * the screen locks or the app goes to the background: the recorder then stops itself and keeps
 * what it has, rather than losing it.
 */
export function useRecorder(onRecorded: (r: Recording) => void) {
  const [state, dispatch] = useReducer(recorderReducer, { phase: "idle" } as RecorderState);
  const [levels, setLevels] = useState<number[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const session = useRef<{
    stream: MediaStream;
    recorder: MediaRecorder;
    audio: AudioContext | null;
    wakeLock: WakeLockSentinel | null;
    raf: number;
    tick: ReturnType<typeof setInterval>;
    startedAt: number;
  } | null>(null);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  const teardown = useCallback(() => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    cancelAnimationFrame(s.raf);
    clearInterval(s.tick);
    for (const t of s.stream.getTracks()) t.stop();
    void s.audio?.close().catch(() => {});
    void s.wakeLock?.release().catch(() => {});
  }, []);

  const start = useCallback(async () => {
    if (session.current) return;
    dispatch({ type: "start" });
    setLevels([]);
    setElapsedMs(0);
    let stream: MediaStream;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("This browser can't record audio.");
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      dispatch({ type: "denied", error: micError(e) });
      return;
    }
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      for (const t of stream.getTracks()) t.stop();
      dispatch({ type: "denied", error: micError(e) });
      return;
    }
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || chunks[0]?.type || "audio/mp4";
      const blob = new Blob(chunks, { type });
      teardown();
      dispatch({ type: "finished" });
      if (blob.size > 0)
        onRecordedRef.current({ blob, mimeType: type, startedAt, durationMs: Date.now() - startedAt });
    };
    recorder.onerror = (ev) => {
      teardown();
      dispatch({ type: "failed", error: micError((ev as unknown as { error?: unknown }).error ?? ev) });
    };

    // the level meter: optional, recording works without it
    let audio: AudioContext | null = null;
    let raf = 0;
    try {
      audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      audio.createMediaStreamSource(stream).connect(analyser);
      const frame = new Uint8Array(analyser.fftSize);
      let last = 0;
      const loop = (t: number) => {
        if (t - last >= LEVEL_EVERY_MS) {
          last = t;
          analyser.getByteTimeDomainData(frame);
          const level = levelOf(frame);
          setLevels((l) => [...l.slice(-(LEVEL_BARS - 1)), level]);
        }
        raf = requestAnimationFrame(loop);
        if (session.current) session.current.raf = raf;
      };
      raf = requestAnimationFrame(loop);
    } catch {
      audio = null;
    }

    const tick = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    session.current = { stream, recorder, audio, wakeLock: null, raf, tick, startedAt };
    recorder.start(1000);
    dispatch({ type: "granted", at: startedAt });

    // keep the screen on while recording (iOS 16.4+ in standalone mode, Chromium)
    try {
      const lock = await navigator.wakeLock?.request("screen");
      if (lock && session.current) session.current.wakeLock = lock;
      else void lock?.release();
    } catch {
      // not available or refused: the visible note covers it
    }
  }, [teardown]);

  const stop = useCallback(() => {
    const s = session.current;
    if (!s || s.recorder.state === "inactive") return;
    dispatch({ type: "stop" });
    s.recorder.stop();
  }, []);

  const dismiss = useCallback(() => dispatch({ type: "dismiss" }), []);

  // leaving the app ends an iOS PWA's recording anyway: stop cleanly and keep what was recorded
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", stop);
    };
  }, [stop]);

  // leaving the screen stops (and keeps) a running recording
  useEffect(() => () => stop(), [stop]);

  return { state, busy: isBusy(state), levels, elapsedMs, start, stop, dismiss };
}
