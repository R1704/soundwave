/**
 * Audio engine for modal drum / cymatic synthesizer
 */

import { createModes, setMicPosition, serializeForWorklet } from './modes.js';

export class AudioEngine {
  constructor() {
    this.audioContext = null;
    this.workletNode = null;
    this.modalState = null;
    this.isReady = false;
    this.onAmplitudes = null;
    
    // Effects nodes
    this.dryGain = null;
    this.wetGain = null;
    this.convolver = null;
    this.transientGain = null;
    this.masterGain = null;
    
    this.params = {
      f0: 200,
      mMax: 6,  // Expanded from 4 to 6
      nMax: 6,  // Expanded from 4 to 6
      decayBase: 2.0,
      micX: 0.37,  // Avoid nodal lines (not 1/2, 1/3, 1/4, 1/5, 1/6)
      micY: 0.41,  // Avoid nodal lines
      clickGain: 0.1,
      reverbMix: 0.3,
      transientAmount: 0.2
    };
  }
  
  async init() {
    if (this.audioContext) return;
    
    this.audioContext = new AudioContext();
    await this.audioContext.audioWorklet.addModule('src/audio-worklet.js');
    
    this.workletNode = new AudioWorkletNode(this.audioContext, 'modal-drum-processor', {
      outputChannelCount: [2]
    });
    
    // Create effects chain
    this.setupEffectsChain();
    
    this.workletNode.port.onmessage = (event) => {
      const { type, data } = event.data;
      if (type === 'ready') {
        this.isReady = true;
      } else if (type === 'amplitudes' && this.onAmplitudes) {
        this.onAmplitudes(data);
      }
    };
    
    this.modalState = createModes(
      this.params.mMax,
      this.params.nMax,
      this.params.f0,
      this.audioContext.sampleRate,
      this.params.decayBase
    );
    
    setMicPosition(this.modalState, this.params.micX, this.params.micY);
    
    this.workletNode.port.postMessage({
      type: 'init',
      data: serializeForWorklet(this.modalState)
    });
    
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }
  
  /**
   * Set up the effects chain: worklet -> dry/wet split -> reverb -> master
   */
  setupEffectsChain() {
    // Dry path
    this.dryGain = this.audioContext.createGain();
    this.dryGain.gain.value = 1 - this.params.reverbMix;
    
    // Wet path (reverb)
    this.wetGain = this.audioContext.createGain();
    this.wetGain.gain.value = this.params.reverbMix;
    
    this.convolver = this.audioContext.createConvolver();
    this.convolver.buffer = this.createReverbImpulse(2.0, 4.0);
    
    // Master output
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 1.0;
    
    // Connect: worklet -> dry -> master
    //                  -> wet -> convolver -> master
    this.workletNode.connect(this.dryGain);
    this.workletNode.connect(this.wetGain);
    
    this.dryGain.connect(this.masterGain);
    this.wetGain.connect(this.convolver);
    this.convolver.connect(this.masterGain);
    
    this.masterGain.connect(this.audioContext.destination);
  }
  
  /**
   * Create a synthetic reverb impulse response
   */
  createReverbImpulse(decay = 2.0, duration = 3.0) {
    const sampleRate = this.audioContext.sampleRate;
    const length = sampleRate * duration;
    const impulse = this.audioContext.createBuffer(2, length, sampleRate);
    
    for (let channel = 0; channel < 2; channel++) {
      const channelData = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        // Exponential decay with noise
        const envelope = Math.exp(-t * decay);
        // Add early reflections
        const earlyReflections = i < sampleRate * 0.1 ? 
          Math.sin(i * 0.01) * 0.3 * Math.exp(-t * 10) : 0;
        // Random diffuse tail
        const diffuse = (Math.random() * 2 - 1) * envelope;
        channelData[i] = (diffuse + earlyReflections) * 0.5;
      }
    }
    
    return impulse;
  }
  
  /**
   * Set reverb mix (0 = dry, 1 = wet)
   */
  setReverbMix(mix) {
    this.params.reverbMix = Math.max(0, Math.min(1, mix));
    if (this.dryGain && this.wetGain) {
      this.dryGain.gain.setTargetAtTime(1 - this.params.reverbMix, this.audioContext.currentTime, 0.05);
      this.wetGain.gain.setTargetAtTime(this.params.reverbMix, this.audioContext.currentTime, 0.05);
    }
  }
  
  /**
   * Play a transient (attack noise) for percussive feel
   */
  playTransient(intensity = 1.0) {
    if (!this.audioContext || this.params.transientAmount <= 0) return;
    
    const duration = 0.015; // 15ms noise burst
    const sampleRate = this.audioContext.sampleRate;
    const length = Math.floor(sampleRate * duration);
    
    // Create noise buffer
    const buffer = this.audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Fast attack, exponential decay
      const envelope = Math.exp(-t * 20) * (1 - Math.exp(-t * 200));
      // Filtered noise (less harsh)
      const noise = (Math.random() * 2 - 1);
      data[i] = noise * envelope;
    }
    
    // Create and connect nodes
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    
    const gain = this.audioContext.createGain();
    gain.gain.value = this.params.transientAmount * intensity * 0.3;
    
    // Bandpass filter for click character
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2000 + Math.random() * 1000;
    filter.Q.value = 1.5;
    
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    
    source.start();
    source.stop(this.audioContext.currentTime + duration);
  }
  
  /**
   * Set transient amount (0 = none, 1 = full)
   */
  setTransientAmount(amount) {
    this.params.transientAmount = Math.max(0, Math.min(1, amount));
  }
  
  excite(x, y, gain = null) {
    if (!this.workletNode) return;
    const g = gain ?? this.params.clickGain;
    // Play transient click
    this.playTransient(Math.min(1, g * 10));
    
    this.workletNode.port.postMessage({
      type: 'excite',
      data: { x, y, gain: g }
    });
  }
  
  exciteMode(m, n, gain = 0.1) {
    if (!this.workletNode) return;
    // Play transient click
    this.playTransient(Math.min(1, gain * 5));
    
    this.workletNode.port.postMessage({
      type: 'exciteMode',
      data: { m, n, gain }
    });
  }
  
  setMicPosition(x, y) {
    this.params.micX = x;
    this.params.micY = y;
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'setMic',
        data: { x, y }
      });
    }
  }
  
  setGain(gain) {
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'setGain',
        data: { gain }
      });
    }
  }
  
  /**
   * Enable/disable continuous drive (cymatics mode)
   */
  setDrive(enabled, freq = 200, amp = 0.01, x = 0.5, y = 0.5) {
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'setDrive',
        data: { enabled, freq, amp, x, y }
      });
    }
  }
  
  /**
   * Set a chord (array of mode amplitudes)
   * @param {Float32Array|Array} amplitudes - Amplitude for each mode [0..mMax*nMax-1]
   * @param {boolean} sustain - If true, chord is continuously excited; if false, one-shot impulse
   */
  setChord(amplitudes, sustain = true) {
    if (this.workletNode) {
      const ampArray = Array.from(amplitudes);
      const nonZero = ampArray.filter(a => a > 0).length;
      console.log('AudioEngine.setChord: sending', nonZero, 'non-zero amplitudes, sustain=', sustain);
      this.workletNode.port.postMessage({
        type: 'setChord',
        data: { amplitudes: ampArray, sustain }
      });
    } else {
      console.warn('AudioEngine.setChord: workletNode not ready');
    }
  }
  
  /**
   * Excite specific modes with impulses (additive, doesn't clear existing resonators)
   * Used by arpeggiator for individual note triggers
   * @param {Float32Array|Array} amplitudes - Amplitude for each mode [0..mMax*nMax-1]
   */
  exciteModes(amplitudes) {
    if (this.workletNode) {
      const ampArray = Array.from(amplitudes);
      // Calculate intensity from amplitude sum
      const intensity = Math.min(1, ampArray.reduce((sum, a) => sum + Math.abs(a), 0));
      // Play transient click
      this.playTransient(intensity);
      
      this.workletNode.port.postMessage({
        type: 'exciteModes',
        data: { amplitudes: ampArray }
      });
    }
  }
  
  /**
   * Clear the current chord (fade out)
   */
  clearChord() {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'clearChord' });
    }
  }
  
  /**
   * Set chord envelope parameters
   */
  setChordParams(attack, release, sustain) {
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'setChordParams',
        data: { attack, release, sustain }
      });
    }
  }
  
  reset() {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'reset' });
    }
  }
  
  getModalState() {
    return this.modalState;
  }
  
  get ready() {
    return this.isReady;
  }
  
  get sampleRate() {
    return this.audioContext?.sampleRate ?? 44100;
  }
}
