/**
 * Euclidean Rhythm Sequencer
 * 
 * Uses the Bjorklund algorithm to distribute pulses evenly across steps.
 * Each pulse triggers a chord from the modal harmony system.
 */

import * as Harmony from './modal-harmony.js';

/**
 * Bjorklund's algorithm for generating Euclidean rhythms
 * Distributes k pulses as evenly as possible over n steps
 */
function bjorklund(pulses, steps) {
  if (pulses >= steps) {
    return new Array(steps).fill(true);
  }
  if (pulses === 0) {
    return new Array(steps).fill(false);
  }
  
  // Build pattern using Bjorklund's algorithm
  let pattern = [];
  let counts = [];
  let remainders = [];
  
  let divisor = steps - pulses;
  remainders.push(pulses);
  let level = 0;
  
  while (remainders[level] > 1) {
    counts.push(Math.floor(divisor / remainders[level]));
    remainders.push(divisor % remainders[level]);
    divisor = remainders[level];
    level++;
  }
  counts.push(divisor);
  
  // Build the pattern
  function build(level) {
    if (level === -1) {
      pattern.push(false);
    } else if (level === -2) {
      pattern.push(true);
    } else {
      for (let i = 0; i < counts[level]; i++) {
        build(level - 1);
      }
      if (remainders[level] !== 0) {
        build(level - 2);
      }
    }
  }
  
  build(level);
  
  // The algorithm builds it backwards, so reverse
  return pattern.reverse();
}

/**
 * Rotate an array by n positions
 */
function rotateArray(arr, n) {
  const len = arr.length;
  if (len === 0) return arr;
  n = ((n % len) + len) % len; // Handle negative rotation
  return [...arr.slice(n), ...arr.slice(0, n)];
}

export class EuclideanSequencer {
  constructor(audioEngine, mMax = 6) {
    this.audioEngine = audioEngine;
    this.mMax = mMax;
    this.f0 = 200;
    
    // Euclidean parameters
    this.steps = 16;         // Total steps in pattern
    this.pulses = 4;         // Number of active pulses
    this.rotation = 0;       // Pattern rotation offset
    
    // Generated pattern (true = pulse, false = rest)
    this.pattern = [];
    this.manualOverrides = new Set(); // Steps that user has manually toggled
    
    // Playback state
    this.currentStep = 0;
    this.isPlaying = false;
    
    // Timing
    this.bpm = 120;
    this.subdivision = 1;    // 1 = quarter notes, 2 = eighth notes, 4 = sixteenth
    
    // Sound settings
    this.chordPreset = 'fundamental';  // Which chord to trigger
    this.velocity = 1.0;
    this.useChordSustain = false;
    
    // Swing (0-1, 0.5 = no swing)
    this.swing = 0.5;
    
    // Timer
    this.intervalId = null;
    this.nextStepTime = 0;
    this.lookAhead = 25;     // ms to look ahead for scheduling
    this.scheduleAhead = 0.1; // seconds to schedule ahead
    
    // Callbacks
    this.onStepChange = null;
    this.onPatternChange = null;
    this.onPulse = null;  // Called when a pulse (active step) triggers - can be used to advance chord sequencer
    
    // Mode: 'internal' uses chord preset, 'external' calls onPulse only
    this.triggerMode = 'internal';
    
    // Generate initial pattern
    this.regeneratePattern();
  }
  
  /**
   * Get interval between steps in milliseconds
   */
  get stepIntervalMs() {
    const quarterNoteMs = 60000 / this.bpm;
    return quarterNoteMs / this.subdivision;
  }
  
  /**
   * Regenerate the Euclidean pattern
   */
  regeneratePattern() {
    // Generate base Euclidean pattern
    const basePattern = bjorklund(this.pulses, this.steps);
    
    // Apply rotation
    const rotatedPattern = rotateArray(basePattern, this.rotation);
    
    // Apply manual overrides
    this.pattern = rotatedPattern.map((val, i) => {
      if (this.manualOverrides.has(i)) {
        return !val; // Toggle the step
      }
      return val;
    });
    
    if (this.onPatternChange) {
      this.onPatternChange(this.pattern);
    }
  }
  
  /**
   * Toggle a step manually
   */
  toggleStep(index) {
    if (index < 0 || index >= this.steps) return;
    
    if (this.manualOverrides.has(index)) {
      this.manualOverrides.delete(index);
    } else {
      this.manualOverrides.add(index);
    }
    
    this.regeneratePattern();
  }
  
  /**
   * Set a step to a specific value
   */
  setStep(index, active) {
    if (index < 0 || index >= this.steps) return;
    
    const basePattern = bjorklund(this.pulses, this.steps);
    const rotatedPattern = rotateArray(basePattern, this.rotation);
    const baseValue = rotatedPattern[index];
    
    if (active !== baseValue) {
      this.manualOverrides.add(index);
    } else {
      this.manualOverrides.delete(index);
    }
    
    this.regeneratePattern();
  }
  
  /**
   * Clear all manual overrides
   */
  clearOverrides() {
    this.manualOverrides.clear();
    this.regeneratePattern();
  }
  
  /**
   * Set number of steps
   */
  setSteps(n) {
    this.steps = Math.max(1, Math.min(32, n));
    this.pulses = Math.min(this.pulses, this.steps);
    this.rotation = this.rotation % this.steps;
    this.manualOverrides.clear();
    this.regeneratePattern();
  }
  
  /**
   * Set number of pulses
   */
  setPulses(k) {
    this.pulses = Math.max(0, Math.min(this.steps, k));
    this.manualOverrides.clear();
    this.regeneratePattern();
  }
  
  /**
   * Set rotation
   */
  setRotation(r) {
    this.rotation = ((r % this.steps) + this.steps) % this.steps;
    this.manualOverrides.clear();
    this.regeneratePattern();
  }
  
  /**
   * Set BPM
   */
  setBPM(bpm) {
    this.bpm = Math.max(20, Math.min(300, bpm));
  }
  
  /**
   * Set subdivision
   */
  setSubdivision(sub) {
    this.subdivision = Math.max(1, Math.min(4, sub));
  }
  
  /**
   * Set the chord preset to use
   */
  setChordPreset(name) {
    this.chordPreset = name;
  }
  
  /**
   * Start playback
   */
  play() {
    if (this.isPlaying) return;
    
    this.isPlaying = true;
    this.currentStep = 0;
    this.nextStepTime = performance.now();
    
    // Use a tight interval for accurate timing
    this.intervalId = setInterval(() => this.scheduler(), this.lookAhead);
    
    // Trigger first step immediately if it's active
    this.triggerCurrentStep();
  }
  
  /**
   * Stop playback
   */
  stop() {
    this.isPlaying = false;
    this.currentStep = 0;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.audioEngine.clearChord();
    
    if (this.onStepChange) {
      this.onStepChange(this.currentStep, false);
    }
  }
  
  /**
   * Pause playback
   */
  pause() {
    this.isPlaying = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  
  /**
   * Scheduler - called frequently to check if next step should be triggered
   */
  scheduler() {
    const now = performance.now();
    
    while (this.nextStepTime < now + this.scheduleAhead * 1000) {
      this.advanceStep();
      
      // Calculate next step time with swing
      let interval = this.stepIntervalMs;
      if (this.currentStep % 2 === 1 && this.swing !== 0.5) {
        // Apply swing to off-beats
        interval *= (this.swing * 2);
      }
      
      this.nextStepTime += interval;
    }
  }
  
  /**
   * Advance to next step and trigger if active
   */
  advanceStep() {
    this.currentStep = (this.currentStep + 1) % this.steps;
    this.triggerCurrentStep();
  }
  
  /**
   * Trigger the current step if it's active
   */
  triggerCurrentStep() {
    const isActive = this.pattern[this.currentStep];
    
    if (this.onStepChange) {
      this.onStepChange(this.currentStep, isActive);
    }
    
    if (isActive) {
      this.triggerSound();
    }
  }
  
  /**
   * Trigger the sound for a pulse
   */
  triggerSound() {
    // Call external pulse handler first (for chord sequencer integration)
    if (this.onPulse) {
      this.onPulse(this.currentStep);
    }
    
    // Only trigger internal sound if in internal mode
    if (this.triggerMode === 'external') {
      return; // External mode - let onPulse handler do everything
    }
    
    const chord = Harmony.getChordPreset(this.chordPreset, this.f0);
    if (!chord) return;
    
    const amplitudes = Harmony.chordToAmplitudes(chord, this.mMax, this.mMax);
    
    // Scale by velocity
    for (let i = 0; i < amplitudes.length; i++) {
      amplitudes[i] *= this.velocity;
    }
    
    this.audioEngine.setChord(amplitudes, this.useChordSustain);
    
    // If not sustaining, clear after a short time
    if (!this.useChordSustain) {
      setTimeout(() => {
        // Only clear if we're still on the same step
        this.audioEngine.clearChord();
      }, this.stepIntervalMs * 0.8);
    }
  }
  
  /**
   * Set trigger mode
   * @param {string} mode - 'internal' or 'external'
   */
  setTriggerMode(mode) {
    this.triggerMode = mode;
  }
  
  /**
   * Get current pattern as string (for display)
   */
  getPatternString() {
    return this.pattern.map(p => p ? '●' : '○').join('');
  }
  
  /**
   * Get Euclidean notation string
   */
  getNotation() {
    return `E(${this.pulses},${this.steps})${this.rotation > 0 ? `+${this.rotation}` : ''}`;
  }
  
  /**
   * Load a preset rhythm
   */
  loadPreset(name) {
    const presets = {
      'son-clave': { steps: 16, pulses: 5, rotation: 0 },      // E(5,16) - Cuban son clave
      'rumba': { steps: 16, pulses: 5, rotation: 3 },          // E(5,16)+3 - Rumba clave  
      'bossa': { steps: 16, pulses: 5, rotation: 2 },          // Bossa nova
      'tresillo': { steps: 8, pulses: 3, rotation: 0 },        // E(3,8) - Tresillo
      'cinquillo': { steps: 8, pulses: 5, rotation: 0 },       // E(5,8) - Cinquillo
      'four-floor': { steps: 4, pulses: 4, rotation: 0 },      // E(4,4) - Four on the floor
      'backbeat': { steps: 4, pulses: 2, rotation: 1 },        // E(2,4)+1 - Backbeat
      'waltz': { steps: 6, pulses: 2, rotation: 0 },           // E(2,6) - Waltz-like
      'aksak': { steps: 9, pulses: 4, rotation: 0 },           // E(4,9) - Aksak rhythm
      'outside': { steps: 13, pulses: 5, rotation: 0 },        // E(5,13) - Unusual meter
    };
    
    const preset = presets[name];
    if (preset) {
      this.steps = preset.steps;
      this.pulses = preset.pulses;
      this.rotation = preset.rotation;
      this.manualOverrides.clear();
      this.regeneratePattern();
      return true;
    }
    return false;
  }
  
  /**
   * Get list of available presets
   */
  static getPresetNames() {
    return [
      { id: 'son-clave', name: 'Son Clave E(5,16)' },
      { id: 'rumba', name: 'Rumba E(5,16)+3' },
      { id: 'bossa', name: 'Bossa Nova E(5,16)+2' },
      { id: 'tresillo', name: 'Tresillo E(3,8)' },
      { id: 'cinquillo', name: 'Cinquillo E(5,8)' },
      { id: 'four-floor', name: 'Four on Floor E(4,4)' },
      { id: 'backbeat', name: 'Backbeat E(2,4)+1' },
      { id: 'waltz', name: 'Waltz E(2,6)' },
      { id: 'aksak', name: 'Aksak E(4,9)' },
      { id: 'outside', name: 'Outside E(5,13)' },
    ];
  }
}
