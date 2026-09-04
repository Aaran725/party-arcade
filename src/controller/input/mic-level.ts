/** Must be called from inside a user-gesture handler (e.g. a button tap) on iOS. */
export async function requestMicPermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop()); // just probing for the grant — the game starts its own stream when it actually needs one
    return true;
  } catch {
    return false;
  }
}

/**
 * Streams the phone's microphone amplitude as a 0-100 number, computed entirely
 * on-device via Web Audio's AnalyserNode — raw audio is never transmitted, only the
 * derived level. A different capture pathway from motion.ts (device orientation) and
 * draw-capture.ts (touch), reflecting a third sensor this app has never used.
 */
export class MicLevelCapture {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array | null = null;
  private rafId = 0;
  private running = false;
  // Subtracted from every raw reading once ambient calibration has run — a loud room or
  // a more sensitive mic no longer just wins by default. Left at 0 (no-op) if a caller
  // never bothers to calibrate, so this stays backwards-compatible.
  private ambientFloor = 0;

  private rawLevel(): number {
    if (!this.analyser || !this.data) return 0;
    this.analyser.getByteTimeDomainData(this.data);
    let sumSquares = 0;
    for (const v of this.data) {
      const norm = (v - 128) / 128;
      sumSquares += norm * norm;
    }
    const rms = Math.sqrt(sumSquares / this.data.length);
    return Math.max(0, Math.min(100, Math.round(rms * 300))); // scale factor tuned so a raised speaking voice lands mid-range
  }

  /** Acquires the mic and sets up the analyser without starting the streaming loop yet — lets a caller run calibrateAmbient() against real analyser data before onLevel callbacks begin. Must be called from inside a user-gesture handler (e.g. a button tap) on iOS. */
  private async open(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.ctx = new AudioContext();
      const source = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);
      this.data = new Uint8Array(this.analyser.frequencyBinCount);
      return true;
    } catch {
      return false;
    }
  }

  /** Starts the actual streaming loop against an already-open() (or already-calibrated) mic. */
  beginStreaming(onLevel: (level: number) => void): void {
    this.running = true;
    const loop = () => {
      if (!this.running || !this.analyser || !this.data) return;
      const level = Math.max(0, Math.min(100, this.rawLevel() - this.ambientFloor));
      onLevel(level);
      this.rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  /** Must be called from inside a user-gesture handler (e.g. a button tap) on iOS. */
  async start(onLevel: (level: number) => void): Promise<boolean> {
    const ok = await this.open();
    if (ok) this.beginStreaming(onLevel);
    return ok;
  }

  /**
   * Acquires the mic (if not already open) and samples raw level for `durationMs`,
   * storing the average as a floor subtracted from every future reading — so a
   * naturally loud room or an extra-sensitive mic doesn't just win by default. Call
   * this instead of `start()`, then call `beginStreaming()` once calibration
   * resolves. Same shape as PointerCalibration's `.calibrate()`.
   */
  async calibrateAmbient(durationMs: number): Promise<boolean> {
    if (!this.analyser && !(await this.open())) return false;
    const samples: number[] = [];
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const sample = () => {
        samples.push(this.rawLevel());
        if (performance.now() - start >= durationMs) {
          resolve();
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    this.ambientFloor = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
    return true;
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.data = null;
  }
}
