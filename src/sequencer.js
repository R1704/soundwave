/**
 * Chord Progression Sequencer
 * 
 * Timeline-based movement through modal chord space with voice leading
 */

import * as Harmony from './modal-harmony.js';

export class ChordSequencer {
  constructor(audioEngine, mMax = 6) {
    this.audioEngine = audioEngine;
    this.mMax = mMax;
    this.f0 = 200;
    
    // Sequence data
    this.steps = [];          // Array of { chord, duration, name }
    this.currentStep = 0;
    this.isPlaying = false;
    this.isPaused = false;
    
    // Timing
    this.bpm = 60;            // Beats per minute
    this.stepsPerBeat = 1;    // Steps per beat (1 = quarter note per chord)
    this.voiceLeadingSteps = 8; // Interpolation steps between chords
    
    // Voice leading state
    this.voiceLeadingPath = null;
    this.voiceLeadingIndex = 0;
    this.lastUpdateTime = 0;
    
    // Callbacks
    this.onStepChange = null;
    this.onPlaybackEnd = null;
    
    // Animation frame handle
    this.animationFrame = null;
  }
  
  /**
   * Get step duration in milliseconds
   */
  get stepDurationMs() {
    return (60000 / this.bpm) / this.stepsPerBeat;
  }
  
  /**
   * Get voice leading update interval in milliseconds
   */
  get voiceLeadingIntervalMs() {
    return this.stepDurationMs / this.voiceLeadingSteps;
  }
  
  /**
   * Add a chord to the sequence
   */
  addStep(chord, name = null) {
    this.steps.push({
      chord,
      name: name || `Step ${this.steps.length + 1}`,
      duration: 1  // In beats
    });
    return this.steps.length - 1;
  }
  
  /**
   * Add a chord preset by name
   */
  addPreset(presetName) {
    const chord = Harmony.getChordPreset(presetName, this.f0);
    if (chord) {
      return this.addStep(chord, presetName);
    }
    return -1;
  }
  
  /**
   * Remove a step
   */
  removeStep(index) {
    if (index >= 0 && index < this.steps.length) {
      this.steps.splice(index, 1);
      if (this.currentStep >= this.steps.length) {
        this.currentStep = Math.max(0, this.steps.length - 1);
      }
    }
  }
  
  /**
   * Clear all steps
   */
  clear() {
    this.stop();
    this.steps = [];
    this.currentStep = 0;
  }
  
  /**
   * Set BPM
   */
  setBPM(bpm) {
    this.bpm = Math.max(20, Math.min(300, bpm));
  }
  
  /**
   * Start playback
   */
  play() {
    if (this.steps.length === 0) return;
    
    if (this.isPaused) {
      this.isPaused = false;
    } else {
      this.currentStep = 0;
      this.startCurrentStep();
    }
    
    this.isPlaying = true;
    this.lastUpdateTime = performance.now();
    this.scheduleUpdate();
  }
  
  /**
   * Pause playback
   */
  pause() {
    this.isPaused = true;
    this.isPlaying = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }
  
  /**
   * Stop playback
   */
  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this.currentStep = 0;
    this.voiceLeadingPath = null;
    this.voiceLeadingIndex = 0;
    
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    
    this.audioEngine.clearChord();
  }
  
  /**
   * Jump to a specific step
   */
  jumpTo(stepIndex) {
    if (stepIndex >= 0 && stepIndex < this.steps.length) {
      this.currentStep = stepIndex;
      this.startCurrentStep();
    }
  }
  
  /**
   * Start playing the current step
   */
  startCurrentStep() {
    const step = this.steps[this.currentStep];
    if (!step) return;
    
    // Set up voice leading to next chord
    const nextStep = this.steps[(this.currentStep + 1) % this.steps.length];
    if (nextStep && this.steps.length > 1) {
      this.voiceLeadingPath = Harmony.generateVoiceLeading(
        step.chord, 
        nextStep.chord, 
        this.voiceLeadingSteps,
        this.f0
      );
    } else {
      this.voiceLeadingPath = [step.chord];
    }
    
    this.voiceLeadingIndex = 0;
    this.playCurrentVoiceLeadingStep();
    
    if (this.onStepChange) {
      this.onStepChange(this.currentStep, step);
    }
  }
  
  /**
   * Play the current voice leading interpolation step
   */
  playCurrentVoiceLeadingStep() {
    if (!this.voiceLeadingPath || this.voiceLeadingIndex >= this.voiceLeadingPath.length) {
      return;
    }
    
    const chord = this.voiceLeadingPath[this.voiceLeadingIndex];
    const amplitudes = Harmony.chordToAmplitudes(chord, this.mMax, this.mMax);
    this.audioEngine.setChord(amplitudes, true);
  }
  
  /**
   * Schedule the next update
   */
  scheduleUpdate() {
    this.animationFrame = requestAnimationFrame((time) => this.update(time));
  }
  
  /**
   * Update loop
   */
  update(time) {
    if (!this.isPlaying || this.isPaused) return;
    
    const elapsed = time - this.lastUpdateTime;
    
    // Check if it's time to advance voice leading
    if (elapsed >= this.voiceLeadingIntervalMs) {
      this.lastUpdateTime = time;
      this.voiceLeadingIndex++;
      
      if (this.voiceLeadingIndex >= this.voiceLeadingSteps) {
        // Move to next step
        this.currentStep++;
        
        if (this.currentStep >= this.steps.length) {
          // End of sequence
          this.currentStep = 0;
          
          if (this.onPlaybackEnd) {
            this.onPlaybackEnd();
          }
        }
        
        this.startCurrentStep();
      } else {
        this.playCurrentVoiceLeadingStep();
      }
    }
    
    this.scheduleUpdate();
  }
  
  /**
   * Get sequence info for UI
   */
  getSequenceInfo() {
    return this.steps.map((step, i) => ({
      index: i,
      name: step.name,
      isActive: i === this.currentStep,
      chord: step.chord,
      classification: Harmony.classifyChord(step.chord)
    }));
  }
  
  /**
   * Create a preset progression
   */
  static createPresetProgression(name, audioEngine, mMax = 6) {
    const seq = new ChordSequencer(audioEngine, mMax);
    
    const progressions = {
      // Simple progression - stays near fundamental
      simple: ['fundamental', 'square', 'diagonal', 'fundamental'],
      
      // Symmetric journey - explores symmetric shapes across grid
      symmetric: ['fundamental', 'cross', 'diamond', 'star', 'perimeter', 'fundamental'],
      
      // Complexity build - adds more modes progressively
      building: ['fundamental', 'horizontal', 'square', 'star', 'grid', 'all_odd'],
      
      // Geometric dance - moves through geometric patterns
      geometric: ['square', 'diamond', 'cross', 'star', 'spiral', 'square'],
      
      // Tension-release - builds to full grid then resolves
      tension: ['fundamental', 'diagonal', 'all_odd', 'grid', 'star', 'diagonal', 'fundamental'],
      
      // Full exploration - traverses the entire 6×6 space
      exploration: ['fundamental', 'lean_right', 'diagonal', 'perimeter', 'all_even', 'grid', 'star', 'fundamental'],
    };
    
    const presets = progressions[name] || progressions.simple;
    presets.forEach(p => seq.addPreset(p));
    
    return seq;
  }
}
