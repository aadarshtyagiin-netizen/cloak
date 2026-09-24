// Browser + sound notifications. Sound is a synthesized WebAudio "ping" so no
// asset is needed. Both are gated by user toggles (see the UI store) and browser
// permission. Kept side-effect-free until explicitly called.

let audioCtx: AudioContext | null = null;

export function playPing(): void {
  try {
    audioCtx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 660;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.start(t);
    osc.stop(t + 0.26);
  } catch {
    /* audio unavailable */
  }
}

export async function requestNotifyPermission(): Promise<void> {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  } catch {
    /* ignore */
  }
}

export function showBrowserNotification(title: string, body: string): void {
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      // eslint-disable-next-line no-new
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  } catch {
    /* ignore */
  }
}
