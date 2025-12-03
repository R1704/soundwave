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
    
    this.params = {
      f0: 200,
      mMax: 4,
      nMax: 4,
      decayBase: 2.0,
      micX: 0.3,
      micY: 0.4,
      clickGain: 0.1
    };
  }
  
  async init() {
    if (this.audioContext) return;
    
    this.audioContext = new AudioContext();
    await this.audioContext.audioWorklet.addModule('src/audio-worklet.js');
    
    this.workletNode = new AudioWorkletNode(this.audioContext, 'modal-drum-processor', {
      outputChannelCount: [2]
    });
    
    this.workletNode.connect(this.audioContext.destination);
    
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
  
  excite(x, y, gain = null) {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({
      type: 'excite',
      data: { x, y, gain: gain ?? this.params.clickGain }
    });
  }
  
  exciteMode(m, n, gain = 0.1) {
    if (!this.workletNode) return;
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
      this.workletNode.port.postMessage({
        type: 'setChord',
        data: { amplitudes: Array.from(amplitudes), sustain }
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
