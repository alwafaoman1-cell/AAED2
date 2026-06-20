// تشغيل صوت قصير للإشعارات عبر WebAudio (بدون الحاجة لملف صوت).
const KEY = "alwafa_notif_sound_v1";
const subs = new Set<() => void>();

export const notificationSound = {
  enabled(): boolean {
    try {
      const v = localStorage.getItem(KEY);
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  },
  setEnabled(v: boolean) {
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch {}
    subs.forEach((f) => f());
  },
  subscribe(cb: () => void) { subs.add(cb); return () => subs.delete(cb); },
  play() {
    if (!this.enabled()) return;
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      // نغمتان قصيرتان (ding-ding)
      const tones = [
        { f: 880, t: now,        d: 0.12 },
        { f: 1320, t: now + 0.14, d: 0.18 },
      ];
      tones.forEach(({ f, t, d }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + d + 0.02);
      });
      setTimeout(() => { ctx.close().catch(() => {}); }, 600);
    } catch {
      // تجاهل (المتصفح قد يمنع التشغيل قبل أول تفاعل من المستخدم)
    }
  },
};
