/**
 * AudioWorklet processor for modal drum synthesis
 * 
 * Supports:
 * - Impulse excitation (click/strike)
 * - Continuous sinusoidal drive (cymatics mode)
 * - Chord sustain with smooth voice leading transitions
 * - Per-mode amplitude normalization
 * - Soft limiter to prevent clipping
 */

class ModalDrumProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    
    this.modes = null;
    this.initialized = false;
    
    // Amplitude snapshot for visualization
    this.snapshotInterval = 128;
    this.sampleCounter = 0;
    
    // Output gain
    this.masterGain = 0.15;
    
    // Continuous drive (cymatics mode)
    this.driveEnabled = false;
    this.driveFreq = 200;
    this.driveAmp = 0.01;
    this.drivePhase = 0;
    this.driveX = 0.5;
    this.driveY = 0.5;
    
    // Chord sustain mode
    this.chordMode = false;
    this.targetAmplitudes = null;
    this.currentAmplitudes = null;
    this.chordAttack = 0.002;       // Attack rate per sample
    this.chordRelease = 0.005;      // Release rate per sample
    this.chordSustainLevel = 0.02;  // Continuous excitation level
    this.chordPhases = null;        // Phase accumulators for each mode
    
    // Normalization
    this.peakTracker = 0;
    this.peakDecay = 0.9999;
    
    this.port.onmessage = (event) => {
      const { type, data } = event.data;
      
      switch (type) {
        case 'init':
          this.initModes(data);
          break;
        case 'excite':
          this.exciteModes(data.x, data.y, data.gain);
          break;
        case 'exciteMode':
          this.exciteSingleMode(data.m, data.n, data.gain);
          break;
        case 'setMic':
          this.setMicPosition(data.x, data.y);
          break;
        case 'setGain':
          this.masterGain = data.gain;
          break;
        case 'setDrive':
          this.driveEnabled = data.enabled;
          this.driveFreq = data.freq || this.driveFreq;
          this.driveAmp = data.amp || this.driveAmp;
          this.driveX = data.x ?? this.driveX;
          this.driveY = data.y ?? this.driveY;
          break;
        case 'setChord':
          this.setChord(data.amplitudes, data.sustain);
          break;
        case 'setChordParams':
          if (data.attack !== undefined) this.chordAttack = data.attack;
          if (data.release !== undefined) this.chordRelease = data.release;
          if (data.sustain !== undefined) this.chordSustainLevel = data.sustain;
          break;
        case 'clearChord':
          this.clearChord();
          break;
        case 'reset':
          this.resetModes();
          break;
      }
    };
  }
  
  initModes(data) {
    const numModes = data.modes.length;
    
    this.modes = data.modes.map(m => ({
      m: m.m,
      n: m.n,
      freq: m.freq,
      omega: 2 * Math.PI * m.freq / sampleRate,
      R: m.R,
      Rcos: m.Rcos,
      R2: m.R2,
      g: m.g,
      micGain: m.micGain,
      y1: 0,
      y2: 0,
      pendingPulse: 0,
      currentAmplitude: 0,
      peakAmp: 0.001
    }));
    
    // Initialize chord amplitude arrays
    this.targetAmplitudes = new Float32Array(numModes);
    this.currentAmplitudes = new Float32Array(numModes);
    this.chordPhases = new Float32Array(numModes);
    
    this.initialized = true;
    this.port.postMessage({ type: 'ready' });
  }
  
  exciteModes(x, y, gain = 0.1) {
    if (!this.modes) return;
    
    for (const mode of this.modes) {
      const phi = Math.sin(mode.m * Math.PI * x) * Math.sin(mode.n * Math.PI * y);
      const modeScale = 1.0 / Math.sqrt(mode.m * mode.m + mode.n * mode.n);
      mode.pendingPulse += gain * phi * modeScale;
    }
  }
  
  exciteSingleMode(m, n, gain = 0.1) {
    if (!this.modes) return;
    
    for (const mode of this.modes) {
      if (mode.m === m && mode.n === n) {
        mode.pendingPulse += gain;
        break;
      }
    }
  }
  
  setChord(amplitudes, sustain = true) {
    if (!this.modes || !this.targetAmplitudes) return;
    
    this.chordMode = sustain;
    
    for (let i = 0; i < this.modes.length; i++) {
      this.targetAmplitudes[i] = amplitudes[i] || 0;
      
      if (!sustain && amplitudes[i] > 0) {
        this.modes[i].pendingPulse += amplitudes[i] * 0.15;
      }
    }
  }
  
  clearChord() {
    if (!this.targetAmplitudes) return;
    
    this.chordMode = false;
    for (let i = 0; i < this.targetAmplitudes.length; i++) {
      this.targetAmplitudes[i] = 0;
    }
  }
  
  setMicPosition(x, y) {
    if (!this.modes) return;
    
    for (const mode of this.modes) {
      mode.micGain = Math.sin(mode.m * Math.PI * x) * Math.sin(mode.n * Math.PI * y);
    }
  }
  
  resetModes() {
    if (!this.modes) return;
    
    for (const mode of this.modes) {
      mode.y1 = 0;
      mode.y2 = 0;
      mode.pendingPulse = 0;
      mode.currentAmplitude = 0;
      mode.peakAmp = 0.001;
    }
    this.peakTracker = 0;
    this.clearChord();
    
    if (this.chordPhases) {
      for (let i = 0; i < this.chordPhases.length; i++) {
        this.chordPhases[i] = 0;
      }
    }
  }
  
  softLimit(x) {
    if (Math.abs(x) < 0.5) return x;
    return Math.tanh(x);
  }
  
  process(inputs, outputs, parameters) {
    if (!this.initialized || !this.modes) {
      return true;
    }
    
    const output = outputs[0];
    const channel = output[0];
    if (!channel) return true;
    
    const dt = 1.0 / sampleRate;
    
    for (let i = 0; i < channel.length; i++) {
      let sample = 0;
      
      // Continuous drive signal (cymatics mode)
      let driveSignal = 0;
      if (this.driveEnabled) {
        driveSignal = this.driveAmp * Math.sin(this.drivePhase);
        this.drivePhase += 2 * Math.PI * this.driveFreq * dt;
        if (this.drivePhase > 2 * Math.PI) this.drivePhase -= 2 * Math.PI;
      }
      
      for (let j = 0; j < this.modes.length; j++) {
        const mode = this.modes[j];
        
        // Smooth chord amplitude envelope (voice leading)
        if (this.currentAmplitudes && this.targetAmplitudes) {
          const target = this.targetAmplitudes[j];
          const current = this.currentAmplitudes[j];
          
          if (target > current) {
            this.currentAmplitudes[j] = Math.min(target, current + this.chordAttack);
          } else if (target < current) {
            this.currentAmplitudes[j] = Math.max(target, current - this.chordRelease);
          }
        }
        
        // Build input signal
        let x_in = mode.pendingPulse;
        
        // Add continuous drive at drive position
        if (this.driveEnabled) {
          const drivePhi = Math.sin(mode.m * Math.PI * this.driveX) * 
                          Math.sin(mode.n * Math.PI * this.driveY);
          x_in += driveSignal * drivePhi;
        }
        
        // Add chord sustain excitation (at mode's natural frequency)
        if (this.chordMode && this.currentAmplitudes && this.chordPhases) {
          const chordAmp = this.currentAmplitudes[j];
          if (chordAmp > 0.001) {
            x_in += chordAmp * this.chordSustainLevel * Math.sin(this.chordPhases[j]);
            this.chordPhases[j] += mode.omega;
            if (this.chordPhases[j] > 2 * Math.PI) {
              this.chordPhases[j] -= 2 * Math.PI;
            }
          }
        }
        
        // 2nd-order IIR resonator
        const y_new = 2 * mode.Rcos * mode.y1 - mode.R2 * mode.y2 + mode.g * x_in;
        
        mode.y2 = mode.y1;
        mode.y1 = y_new;
        mode.pendingPulse = 0;
        
        // Track peak amplitude for this mode
        const absY = Math.abs(y_new);
        mode.peakAmp = Math.max(mode.peakAmp * 0.9999, absY);
        
        // Normalize by peak for visualization
        const normalizedAmp = y_new / Math.max(mode.peakAmp, 0.001);
        mode.currentAmplitude = normalizedAmp;
        
        // Mix to output
        sample += mode.micGain * y_new;
      }
      
      // Track overall peak for auto-gain
      const absSample = Math.abs(sample);
      this.peakTracker = Math.max(this.peakTracker * this.peakDecay, absSample);
      
      // Auto-normalize
      const autoGain = this.peakTracker > 0.01 ? 0.5 / this.peakTracker : 1.0;
      sample *= Math.min(autoGain, 10.0);
      
      // Apply master gain and soft limit
      channel[i] = this.softLimit(sample * this.masterGain);
      
      // Send amplitude snapshot
      this.sampleCounter++;
      if (this.sampleCounter >= this.snapshotInterval) {
        this.sampleCounter = 0;
        this.sendAmplitudeSnapshot();
      }
    }
    
    // Copy to other channels
    for (let ch = 1; ch < output.length; ch++) {
      output[ch].set(channel);
    }
    
    return true;
  }
  
  sendAmplitudeSnapshot() {
    if (!this.modes) return;
    
    const amplitudes = new Float32Array(this.modes.length);
    for (let i = 0; i < this.modes.length; i++) {
      amplitudes[i] = this.modes[i].currentAmplitude;
    }
    
    this.port.postMessage({
      type: 'amplitudes',
      data: amplitudes
    });
  }
}

registerProcessor('modal-drum-processor', ModalDrumProcessor);
