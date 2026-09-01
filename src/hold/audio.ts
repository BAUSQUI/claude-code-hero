import { HOLD } from './config';
import { asset } from './paths';

/**
 * Sound for the piece. Two looping layers through one context:
 *
 *   chaosSource   -> chaosGain   -.
 *   ambientSource -> ambientGain  |
 *                                  >-- masterGain -> destination
 *   grabSource    -> grabGain    -'
 *
 * The layers say different things. The CHAOS loop is the unresolved thought,
 * so it dies when the thought resolves. The AMBIENT bed is the room, so it
 * never stops — and because it is still there once the chaos has gone, the
 * resolution reveals it rather than silencing everything. It swells slightly
 * at that moment instead of fading, which is the sound of relief.
 *
 * The two buffers are different lengths and will drift against each other.
 * That is deliberate: nothing here tries to keep them in phase.
 *
 * masterGain is what the mute control moves, so one toggle governs both.
 *
 * Three rules shape the whole class:
 *
 *  - NOTHING plays before a real user gesture. The context is created
 *    suspended and only resumed from a pointerdown/keydown/scroll, because
 *    browsers reject audio that starts on its own and the rejection is a
 *    promise nobody is obliged to catch.
 *  - Audio is never load-bearing. Every entry point swallows its own failure:
 *    a missing file, a decode error or a blocked context leaves the page
 *    working in silence.
 *  - The visitor opts IN. Default state is muted, and the choice is
 *    remembered for the session.
 */

/** One looping layer: its buffer, its voice, and its own place in the graph. */
interface Layer {
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  gain: GainNode | null;
  started: boolean;
  /** Decoded length, seconds — read it to tune the loop points by ear. */
  duration: number;
}

const newLayer = (): Layer => ({
  buffer: null,
  source: null,
  gain: null,
  started: false,
  duration: 0,
});

export class ChaosAudio {
  /** Public so the levels can be automated from outside. */
  masterGain: GainNode | null = null;
  chaosGain: GainNode | null = null;
  ambientGain: GainNode | null = null;
  grabGain: GainNode | null = null;

  private ctx: AudioContext | null = null;
  private chaos = newLayer();
  private ambient = newLayer();
  /** One-shot: only the buffer is kept, since every hit needs a new source. */
  private grabBuffer: AudioBuffer | null = null;
  private lastGrabAt = -1;
  /** True while the thought is being carried — the chaos stays down. */
  private ducked = false;

  private muted = true;
  /** False while the tab is hidden or the hero is off screen. */
  private allowed = true;
  /** True once resolution has begun — the chaos never returns after this. */
  private ended = false;
  private unlocked = false;

  private button: HTMLButtonElement | null = null;
  private readonly storeKey = 'hold.audio.muted';

  constructor() {
    if (!HOLD.audio.audioEnabled) return;

    // Default MUTED; a stored choice wins. Storage can throw in private
    // modes, so a failure just leaves the default in place.
    try {
      this.muted = sessionStorage.getItem(this.storeKey) !== 'off';
    } catch {
      this.muted = true;
    }

    this.buildToggle();

    // The first gesture anywhere is what unlocks audio. Registered once, and
    // removed as soon as it fires.
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('scroll', unlock);
      void this.unlock();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('scroll', unlock, { passive: true });

    void this.load();
  }

  // --- graph ---------------------------------------------------------------

  /** Build the context and both layers. Failure here means silence, not a
   *  broken page, so every step is allowed to give up quietly. */
  private async load(): Promise<void> {
    try {
      const Ctx =
        window.AudioContext ??
        (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      // created suspended: nothing can sound until a gesture resumes it
      this.ctx = new Ctx();
      if (this.ctx.state === 'running') await this.ctx.suspend().catch(() => {});

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0;
      this.masterGain.connect(this.ctx.destination);

      this.chaosGain = this.ctx.createGain();
      this.chaosGain.gain.value = 0;
      this.chaosGain.connect(this.masterGain);
      this.chaos.gain = this.chaosGain;

      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.value = 0;
      this.ambientGain.connect(this.masterGain);
      this.ambient.gain = this.ambientGain;

      // the one-shot bus sits at its level permanently; each hit is a new
      // source through it, so nothing here needs to be ramped
      this.grabGain = this.ctx.createGain();
      this.grabGain.gain.value = HOLD.audio.grabVolume;
      this.grabGain.connect(this.masterGain);

      // Fetched in parallel; each starts as soon as IT is ready, so the far
      // larger ambient file cannot hold up the chaos loop.
      await Promise.all([
        this.decodeInto(this.chaos, asset('audio/chaos-loop.mp3')),
        this.decodeInto(this.ambient, asset('audio/ambient.mp3')),
        this.decodeGrab(asset('audio/grab.mp3')),
      ]);
    } catch {
      /* no audio: the page is unaffected */
    }
  }

  private async decodeInto(layer: Layer, url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok || !this.ctx) return;
      layer.buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      layer.duration = layer.buffer.duration;
      // the gesture may well have happened while this was still decoding
      if (this.unlocked) this.startAll();
    } catch {
      /* this layer stays silent; the other one is unaffected */
    }
  }

  /** The one-shot is decoded ONCE and kept; each hit reuses this buffer. */
  private async decodeGrab(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok || !this.ctx) return;
      this.grabBuffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      /* no grab sound; everything else is unaffected */
    }
  }

  /** Resume the context and start whatever has decoded. Safe to repeat. */
  private async unlock(): Promise<void> {
    this.unlocked = true;
    if (!this.ctx) return;
    try {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.startAll();
    } catch {
      /* blocked: stay silent */
    }
  }

  private startAll(): void {
    if (!this.unlocked) return;
    const A = HOLD.audio;
    // the chaos belongs to the unresolved thought — past that point it is
    // never started, even if its buffer only just arrived
    if (!this.ended) {
      this.startLayer(this.chaos, A.loopStart, A.loopEnd, this.chaosLevel(), A.fadeInDuration);
    }
    this.startLayer(
      this.ambient,
      A.ambientLoopStart,
      A.ambientLoopEnd,
      this.ambientLevel(),
      A.ambientFadeIn,
    );
    this.applyMaster();
  }

  /**
   * Start one layer's looping source. The loop points are set explicitly
   * rather than left at the buffer's full length: MP3 encoders pad both ends
   * of the file, and looping across that padding is what clicks.
   */
  private startLayer(
    layer: Layer,
    loopStart: number,
    loopEnd: number,
    level: number,
    fade: number,
  ): void {
    if (layer.started || !layer.buffer || !layer.gain || !this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = layer.buffer;
    src.loop = true;
    src.loopStart = Math.max(0, loopStart);
    src.loopEnd =
      loopEnd > src.loopStart
        ? loopEnd
        : Math.max(src.loopStart + 0.05, layer.buffer.duration - loopStart);
    src.connect(layer.gain);
    try {
      src.start(0, src.loopStart);
    } catch {
      return;
    }
    layer.source = src;
    layer.started = true;
    this.ramp(layer.gain, level, fade);
  }

  // --- levels --------------------------------------------------------------

  /**
   * Ramp a gain to a value. Always a ramp, never a jump — and always FROM
   * the live value, so a change mid-fade continues from where it is rather
   * than restarting.
   */
  private ramp(node: GainNode | null, to: number, seconds: number): void {
    if (!node || !this.ctx) return;
    const now = this.ctx.currentTime;
    const g = node.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(to, Math.max(now + seconds, now + 0.001));
  }

  /**
   * What the chaos should be sitting at right now. Silent once resolved;
   * ducked (or silenced, if `chaosStopsOnGrab`) while the thought is being
   * carried; otherwise full.
   */
  private chaosLevel(): number {
    const A = HOLD.audio;
    if (this.ended) return 0;
    if (this.ducked) return A.chaosStopsOnGrab ? 0 : A.chaosVolume * A.chaosDuckLevel;
    return A.chaosVolume;
  }

  /** The bed sits higher once the noise has gone. */
  private ambientLevel(): number {
    return this.ended ? HOLD.audio.ambientResolvedVolume : HOLD.audio.ambientVolume;
  }

  /** Mute and visibility both live on the master, so they move both layers. */
  private applyMaster(seconds?: number): void {
    const A = HOLD.audio;
    const open = !this.muted && this.allowed;
    this.ramp(this.masterGain, open ? 1 : 0, seconds ?? (open ? A.fadeInDuration : A.fadeOutDuration));
  }

  // --- state from the page -------------------------------------------------

  /**
   * The thought has been taken hold of. Fires the one-shot and ducks the
   * chaos underneath it.
   *
   * The duck is applied on EVERY call; only the sound is rate-limited. A
   * re-grab inside the guard window still needs the level to be right, it
   * just must not stack another hit on top of the last one.
   */
  grab(): void {
    const A = HOLD.audio;
    this.ducked = true;
    this.ramp(this.chaosGain, this.chaosLevel(), A.chaosDuckDuration);

    if (!this.ctx || !this.grabBuffer || !this.grabGain) return;
    const now = this.ctx.currentTime;
    if (this.lastGrabAt >= 0 && now - this.lastGrabAt < A.grabRetrigger) return;
    this.lastGrabAt = now;
    // source nodes are single-use, so every hit gets a fresh one off the
    // buffer that was decoded at load
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.grabBuffer;
      src.connect(this.grabGain);
      src.start();
    } catch {
      /* a failed one-shot must not disturb the beds */
    }
  }

  /**
   * The grab was abandoned — dropped back into the head, or the hold let go
   * before it committed. The chaos comes back with the thought. Deliberately
   * does NOT re-fire the sound: that belongs to taking hold, not returning.
   */
  releaseGrab(): void {
    if (!this.ducked) return;
    this.ducked = false;
    this.ramp(this.chaosGain, this.chaosLevel(), HOLD.audio.chaosRestoreDuration);
  }

  /**
   * Resolution has begun. The chaos fades out and does not come back; the
   * ambient does the opposite and swells, so what the fade uncovers is a
   * room rather than silence.
   */
  endChaos(): void {
    if (this.ended) return;
    this.ended = true;
    const A = HOLD.audio;
    this.ramp(this.chaosGain, this.chaosLevel(), A.fadeOutDuration);
    this.ramp(this.ambientGain, this.ambientLevel(), A.ambientSwellDuration);
  }

  /** Reset (the piece was regrabbed before resolution). */
  restoreChaos(): void {
    if (!this.ended) return;
    this.ended = false;
    const A = HOLD.audio;
    this.ramp(this.chaosGain, this.chaosLevel(), A.fadeInDuration);
    this.ramp(this.ambientGain, this.ambientLevel(), A.ambientSwellDuration);
    // the buffer may have arrived after resolution, when startAll skipped it
    this.startLayer(this.chaos, A.loopStart, A.loopEnd, this.chaosLevel(), A.fadeInDuration);
  }

  /**
   * Driven by the same visibility + hero-in-view signal that pauses the
   * render loop, so nothing plays for a hero nobody is looking at. Both
   * layers duck together, because it is the master that moves.
   */
  setAllowed(on: boolean): void {
    if (on === this.allowed) return;
    this.allowed = on;
    this.applyMaster(on ? HOLD.audio.fadeInDuration : 0.2);
    // suspending the context while away also stops it burning CPU
    if (!this.ctx) return;
    if (on) {
      if (this.chaos.started || this.ambient.started) void this.ctx.resume().catch(() => {});
    } else {
      window.setTimeout(() => {
        if (!this.allowed && this.ctx) void this.ctx.suspend().catch(() => {});
      }, 250);
    }
  }

  // --- control -------------------------------------------------------------

  private setMuted(next: boolean): void {
    this.muted = next;
    try {
      sessionStorage.setItem(this.storeKey, next ? 'on' : 'off');
    } catch {
      /* storage unavailable — the session just won't remember */
    }
    this.paintToggle();
    // unmuting is also a gesture, so it can be what unlocks the context
    if (!next) void this.unlock();
    this.applyMaster();
  }

  /**
   * Icon-only toggle in the hero's bottom-right. Muted colour at rest,
   * brightening on hover — present enough to find, quiet enough to ignore.
   */
  private buildToggle(): void {
    const host = document.querySelector('.hero') as HTMLElement | null;
    if (!host) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.style.cssText = [
      'position:absolute',
      'right:0',
      'bottom:12px',
      'z-index:7',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'width:32px',
      'height:32px',
      'padding:0',
      'border:none',
      'border-radius:8px',
      'background:transparent',
      'cursor:pointer',
      'color:rgba(250,249,245,0.38)',
      'transition:color 0.2s ease,background 0.2s ease',
    ].join(';');
    b.addEventListener('pointerenter', () => {
      b.style.color = 'rgba(250,249,245,0.9)';
      b.style.background = 'rgba(250,249,245,0.06)';
    });
    b.addEventListener('pointerleave', () => {
      b.style.color = 'rgba(250,249,245,0.38)';
      b.style.background = 'transparent';
    });
    // must not start a drag on the scribble underneath
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', () => this.setMuted(!this.muted));

    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(b);
    this.button = b;
    this.paintToggle();
  }

  private paintToggle(): void {
    if (!this.button) return;
    const on = !this.muted;
    this.button.setAttribute('aria-label', on ? 'Mute sound' : 'Unmute sound');
    this.button.setAttribute('aria-pressed', String(on));
    this.button.title = on ? 'Mute' : 'Unmute';
    const wave = on
      ? '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'
      : '<path d="m17 9 5 5m0-5-5 5"/>';
    this.button.innerHTML =
      `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="display:block">` +
      `<path d="M11 5 6 9H2v6h4l5 4z"/>${wave}</svg>`;
  }
}
