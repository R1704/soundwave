/**
 * Main application - Modal Harmonic Synthesizer
 * 
 * Integrates:
 * - Modal drum physics (square membrane)
 * - Modal harmony theory (geometric music)
 * - Chord voicings and voice leading
 * - Chord progression sequencer
 * - Euclidean rhythm sequencer
 * - Cymatics visualization
 */

import { AudioEngine } from './audio-engine.js';
import { WebGLRenderer } from './webgl-renderer.js';
import * as Harmony from './modal-harmony.js';
import { ChordSequencer } from './sequencer.js';
import { EuclideanSequencer } from './euclidean-sequencer.js';
import { ChordArticulator, ArticulationMode, Direction, ArpeggioPattern } from './chord-articulator.js';

class ModalHarmonicApp {
  constructor() {
    this.canvas = document.getElementById('membrane-canvas');
    this.startButton = document.getElementById('start-button');
    this.statusEl = document.getElementById('status');
    
    this.audioEngine = new AudioEngine();
    this.renderer = null;
    this.isRunning = false;
    this.amplitudes = null;
    this.gridSize = 64;
    this.mMax = 6;  // Mode grid size (6×6 = 36 modes)
    
    // Cymatics mode state
    this.driveEnabled = false;
    this.driveFreq = 200;
    
    // Chord state
    this.activeChord = null;
    this.chordSustain = false;
    this.selectedModes = new Set();  // For building custom chords
    this.currentScale = null;        // Current modal scale
    
    // Sequencer
    this.sequencer = null;
    
    // Articulator
    this.articulator = null;
    
    this.setupEventListeners();
  }
  
  setupEventListeners() {
    this.startButton.addEventListener('click', () => this.start());
    
    // Gain
    document.getElementById('gain-slider')?.addEventListener('input', (e) => {
      const gain = parseFloat(e.target.value);
      this.audioEngine.setGain(gain);
      document.getElementById('gain-value').textContent = gain.toFixed(2);
    });
    
    // Reverb
    document.getElementById('reverb-slider')?.addEventListener('input', (e) => {
      const mix = parseFloat(e.target.value);
      this.audioEngine.setReverbMix(mix);
      document.getElementById('reverb-value').textContent = Math.round(mix * 100) + '%';
    });
    
    // Transient
    document.getElementById('transient-slider')?.addEventListener('input', (e) => {
      const amount = parseFloat(e.target.value);
      this.audioEngine.setTransientAmount(amount);
      document.getElementById('transient-value').textContent = Math.round(amount * 100) + '%';
    });
    
    // Mic position
    document.getElementById('mic-x-slider')?.addEventListener('input', () => this.updateMicPosition());
    document.getElementById('mic-y-slider')?.addEventListener('input', () => this.updateMicPosition());
    
    // Visual controls
    document.getElementById('height-slider')?.addEventListener('input', (e) => {
      if (this.renderer) {
        this.renderer.heightScale = parseFloat(e.target.value);
        document.getElementById('height-value').textContent = e.target.value;
      }
    });
    
    document.getElementById('smoothing-slider')?.addEventListener('input', (e) => {
      if (this.renderer) {
        // Slider controls the fall rate (decay smoothness)
        // Higher values = smoother, slower decay
        this.renderer.fallRate = parseFloat(e.target.value);
        document.getElementById('smoothing-value').textContent = e.target.value;
      }
    });
    
    document.getElementById('grid-select')?.addEventListener('change', (e) => {
      this.gridSize = parseInt(e.target.value);
      if (this.renderer) this.renderer.setGridSize(this.gridSize);
    });
    
    document.getElementById('rotate-toggle')?.addEventListener('change', (e) => {
      if (this.renderer) this.renderer.autoRotate = e.target.checked;
    });
    
    document.getElementById('reset-camera')?.addEventListener('click', () => {
      if (this.renderer) {
        this.renderer.resetCamera();
        document.getElementById('rotate-toggle').checked = true;
      }
    });
    
    // Cymatics drive controls
    document.getElementById('drive-toggle')?.addEventListener('change', (e) => {
      this.driveEnabled = e.target.checked;
      this.updateDrive();
    });
    
    document.getElementById('drive-freq-slider')?.addEventListener('input', (e) => {
      this.driveFreq = parseFloat(e.target.value);
      document.getElementById('drive-freq-value').textContent = this.driveFreq.toFixed(0) + ' Hz';
      this.updateDrive();
    });
    
    document.getElementById('drive-amp-slider')?.addEventListener('input', (e) => {
      const amp = parseFloat(e.target.value);
      document.getElementById('drive-amp-value').textContent = amp.toFixed(3);
      this.updateDrive();
    });
    
    // Chord controls
    document.getElementById('scale-select')?.addEventListener('change', (e) => {
      this.setScale(e.target.value);
    });
    
    document.getElementById('chord-sustain')?.addEventListener('change', (e) => {
      this.chordSustain = e.target.checked;
      if (!this.chordSustain && this.activeChord) {
        this.audioEngine.clearChord();
        this.activeChord = null;
        this.updateModeGridHighlight();
      }
    });
    
    document.getElementById('clear-chord')?.addEventListener('click', () => {
      this.clearChord();
    });
    
    document.getElementById('play-chord')?.addEventListener('click', () => {
      this.replayCurrentChord();
    });
    
    // ADSR envelope controls
    const updateEnvelope = () => this.updateEnvelope();
    document.getElementById('env-attack')?.addEventListener('input', updateEnvelope);
    document.getElementById('env-decay')?.addEventListener('input', updateEnvelope);
    document.getElementById('env-sustain')?.addEventListener('input', updateEnvelope);
    document.getElementById('env-release')?.addEventListener('input', updateEnvelope);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeydown(e));
    document.addEventListener('keyup', (e) => this.handleKeyup(e));
    
    // Sequencer controls
    document.getElementById('seq-play')?.addEventListener('click', () => this.sequencerPlay());
    document.getElementById('seq-stop')?.addEventListener('click', () => this.sequencerStop());
    document.getElementById('seq-clear')?.addEventListener('click', () => this.sequencerClear());
    document.getElementById('seq-add-step')?.addEventListener('click', () => this.sequencerAddCurrentChord());
    document.getElementById('seq-bpm')?.addEventListener('input', (e) => {
      const bpm = parseInt(e.target.value);
      if (this.sequencer) this.sequencer.setBPM(bpm);
      document.getElementById('seq-bpm-value').textContent = bpm;
    });
    document.getElementById('seq-preset')?.addEventListener('change', (e) => {
      if (e.target.value) this.loadSequencerPreset(e.target.value);
    });
    
    // Articulation controls
    this.setupArticulationListeners();
    
    window.addEventListener('resize', () => {
      if (this.renderer) this.renderer.resize();
    });
  }
  
  handleKeydown(e) {
    if (!this.isRunning) return;
    
    // Number keys 1-9 for chord presets
    const presetMap = {
      '1': 'fundamental',
      '2': 'diagonal',
      '3': 'horizontal',
      '4': 'vertical',
      '5': 'cross',
      '6': 'square',
      '7': 'diamond',
      '8': 'star',
      '9': 'grid',
      '0': 'full'
    };
    
    if (presetMap[e.key]) {
      e.preventDefault();
      this.playChordPreset(presetMap[e.key]);
    }
    
    // Space to clear
    if (e.key === ' ') {
      e.preventDefault();
      this.clearChord();
    }
    
    // Arrow keys for voice leading
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.shiftChord(1, 0);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.shiftChord(-1, 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.shiftChord(0, -1);  // Up arrow moves to lower n (higher on screen)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.shiftChord(0, 1);   // Down arrow moves to higher n (lower on screen)
    }
  }
  
  handleKeyup(e) {
    // If not sustaining, clear chord on key release
    if (!this.chordSustain && this.activeChord) {
      // Only for number keys
      if (/[0-9]/.test(e.key)) {
        this.clearChord();
      }
    }
  }
  
  updateDrive() {
    if (!this.audioEngine.workletNode) return;
    const driveAmp = parseFloat(document.getElementById('drive-amp-slider')?.value || 0.01);
    this.audioEngine.setDrive(this.driveEnabled, this.driveFreq, driveAmp, 0.5, 0.5);
    
    if (this.driveEnabled) {
      this.setStatus(`Cymatics mode: ${this.driveFreq.toFixed(0)} Hz`);
    }
  }
  
  setScale(scaleName) {
    if (scaleName === 'chromatic') {
      this.currentScale = null;
    } else {
      this.currentScale = Harmony.createScale(scaleName, this.mMax);
    }
    this.updateModeGridHighlight();
    this.setStatus(`Scale: ${scaleName}`);
  }
  
  setupModeGrid() {
    const grid = document.getElementById('mode-info');
    if (!grid) return;
    
    const cells = grid.querySelectorAll('.mode-cell');
    cells.forEach((cell, index) => {
      // Single click: excite mode (impulse)
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.shiftKey) {
          // Shift+click: toggle in chord builder
          this.toggleModeInChord(index);
        } else {
          this.exciteMode(index);
        }
      });
      
      // Right click: toggle in chord
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.toggleModeInChord(index);
      });
    });
  }
  
  setupChordPalette() {
    const palette = document.getElementById('chord-palette');
    if (!palette) {
      console.warn('setupChordPalette: palette element not found');
      return;
    }
    
    const presets = ['fundamental', 'diagonal', 'horizontal', 'vertical', 
                     'cross', 'square', 'diamond', 'star', 'grid'];
    
    console.log('Setting up chord palette with', presets.length, 'presets');
    
    presets.forEach((name, i) => {
      const btn = palette.querySelector(`[data-chord="${name}"]`);
      if (btn) {
        console.log('Found button for:', name);
        btn.addEventListener('mousedown', () => {
          console.log('Chord button clicked:', name);
          this.playChordPreset(name);
        });
        btn.addEventListener('mouseup', () => {
          if (!this.chordSustain) this.clearChord();
        });
        btn.addEventListener('mouseleave', () => {
          if (!this.chordSustain) this.clearChord();
        });
      } else {
        console.warn('Button not found for:', name);
      }
    });
  }
  
  exciteMode(index) {
    if (!this.isRunning) return;
    
    const mMax = this.mMax;
    let m = (index % mMax) + 1;
    let n = Math.floor(index / mMax) + 1;
    
    // If scale is active and mode is not in scale, snap to nearest
    if (this.currentScale && !this.currentScale.contains(m, n)) {
      const [nearestM, nearestN] = this.currentScale.nearest(m, n);
      m = nearestM;
      n = nearestN;
      // Update index for visual feedback
      index = (n - 1) * mMax + (m - 1);
    }
    
    this.audioEngine.exciteMode(m, n, 0.15);
    
    const mode = Harmony.createMode(m, n);
    this.setStatus(`Mode (${m},${n}) — ${mode.freq.toFixed(0)} Hz — ${mode.nodalLines} nodes`);
    
    // Visual feedback
    this.flashModeCell(index);
  }
  
  toggleModeInChord(index) {
    const mMax = this.mMax;
    const m = (index % mMax) + 1;
    const n = Math.floor(index / mMax) + 1;
    const key = `${m},${n}`;
    
    if (this.selectedModes.has(key)) {
      this.selectedModes.delete(key);
    } else {
      this.selectedModes.add(key);
    }
    
    // Build and play the custom chord
    if (this.selectedModes.size > 0) {
      const indices = Array.from(this.selectedModes).map(k => {
        const [m, n] = k.split(',').map(Number);
        return [m, n, 1.0];
      });
      const chord = Harmony.createChord(indices);
      this.playChord(chord);
      
      const classification = Harmony.classifyChord(chord);
      this.setStatus(`Custom ${classification.type} — ${classification.complexity} — ${chord.symmetryClass}`);
    } else {
      this.clearChord();
    }
    
    this.updateModeGridHighlight();
  }
  
  playChordPreset(name) {
    console.log('playChordPreset called:', name);
    const chord = Harmony.getChordPreset(name);
    if (!chord) {
      console.warn('playChordPreset: chord not found for', name);
      return;
    }
    
    console.log('Playing chord:', name, 'with', chord.modes.length, 'modes');
    
    this.selectedModes.clear();
    for (const mode of chord.modes) {
      this.selectedModes.add(`${mode.m},${mode.n}`);
    }
    
    this.playChord(chord);
    
    const classification = Harmony.classifyChord(chord);
    this.setStatus(`${name} — ${classification.complexity} — ${chord.symmetryClass}`);
    
    this.updateModeGridHighlight();
  }
  
  playChord(chord) {
    if (!this.isRunning) {
      console.warn('playChord: not running');
      return;
    }
    
    this.activeChord = chord;
    
    // Use articulator if available and not in instant mode
    console.log('playChord: articulator=', !!this.articulator, 'mode=', this.articulator?.mode);
    
    if (this.articulator && this.articulator.mode !== 'instant') {
      console.log('playChord via articulator:', this.articulator.mode, 'strumTime=', this.articulator.strumTime);
      this.articulator.playChord(chord, 1.0);
    } else {
      // Direct playback (instant mode or no articulator)
      const amplitudes = Harmony.chordToAmplitudes(chord, this.mMax, this.mMax);
      console.log('playChord direct:', chord.modes.length, 'modes, sustain=', this.chordSustain);
      this.audioEngine.setChord(amplitudes, this.chordSustain);
    }
  }
  
  shiftChord(dm, dn) {
    if (!this.activeChord) return;
    
    // Shift all modes in the chord, clamped to new 6×6 range
    const newIndices = [];
    for (const mode of this.activeChord.modes) {
      const newM = Math.max(1, Math.min(this.mMax, mode.m + dm));
      const newN = Math.max(1, Math.min(this.mMax, mode.n + dn));
      newIndices.push([newM, newN, mode.amplitude]);
    }
    
    const newChord = Harmony.createChord(newIndices);
    
    // Update selected modes
    this.selectedModes.clear();
    for (const mode of newChord.modes) {
      this.selectedModes.add(`${mode.m},${mode.n}`);
    }
    
    this.playChord(newChord);
    this.updateModeGridHighlight();
    
    const direction = dm > 0 ? '→' : dm < 0 ? '←' : dn < 0 ? '↑' : '↓';
    this.setStatus(`Voice leading ${direction}`);
  }
  
  replayCurrentChord() {
    if (!this.isRunning) return;
    
    // If we have selected modes, rebuild and play the chord
    if (this.selectedModes.size > 0) {
      const indices = Array.from(this.selectedModes).map(k => {
        const [m, n] = k.split(',').map(Number);
        return [m, n, 1.0];
      });
      const chord = Harmony.createChord(indices);
      this.activeChord = chord;
      const amplitudes = Harmony.chordToAmplitudes(chord, this.mMax, this.mMax);
      this.audioEngine.setChord(amplitudes, this.chordSustain);
      
      const classification = Harmony.classifyChord(chord);
      this.setStatus(`Playing ${classification.type}`);
    } else if (this.activeChord) {
      // Replay the active chord
      const amplitudes = Harmony.chordToAmplitudes(this.activeChord, this.mMax, this.mMax);
      this.audioEngine.setChord(amplitudes, this.chordSustain);
      this.setStatus('Replaying chord');
    } else {
      this.setStatus('Select modes first (shift+click)');
    }
  }
  
  updateEnvelope() {
    const attack = parseFloat(document.getElementById('env-attack')?.value || 0.01);
    const decay = parseFloat(document.getElementById('env-decay')?.value || 0.02);
    const sustain = parseFloat(document.getElementById('env-sustain')?.value || 0.02);
    const release = parseFloat(document.getElementById('env-release')?.value || 0.01);
    
    // Update display values
    document.getElementById('env-attack-val').textContent = (attack * 1000).toFixed(0) + 'ms';
    document.getElementById('env-decay-val').textContent = (decay * 1000).toFixed(0) + 'ms';
    document.getElementById('env-sustain-val').textContent = sustain.toFixed(3);
    document.getElementById('env-release-val').textContent = (release * 1000).toFixed(0) + 'ms';
    
    // Convert time in seconds to per-sample rate
    // rate = 1 / (timeInSeconds * sampleRate)
    // Use 48000 as typical sample rate
    const sampleRate = 48000;
    const attackRate = 1 / (Math.max(attack, 0.001) * sampleRate);
    const releaseRate = 1 / (Math.max(release, 0.001) * sampleRate);
    
    console.log('updateEnvelope: attack=', attack, 'release=', release, 'sustainLevel=', sustain);
    console.log('  -> attackRate=', attackRate.toExponential(2), 'releaseRate=', releaseRate.toExponential(2));
    
    this.audioEngine.setChordParams(attackRate, releaseRate, sustain);
    
    // Draw ADSR visualization
    this.drawADSR(attack, decay, sustain, release);
  }
  
  drawADSR(a, d, s, r) {
    const canvas = document.getElementById('adsr-display');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    // Normalize times for display (max envelope = 0.4s total for display)
    const totalTime = a + d + 0.1 + r; // 0.1s sustain display
    const scale = w / Math.max(totalTime, 0.1);
    
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    // Start at bottom left
    ctx.moveTo(0, h);
    
    // Attack: rise to peak
    const attackX = a * scale;
    ctx.lineTo(attackX, h * 0.1);
    
    // Decay: fall to sustain level
    const sustainY = h * (1 - s * 10); // Scale sustain for visibility
    const decayX = attackX + d * scale;
    ctx.lineTo(decayX, sustainY);
    
    // Sustain: hold level
    const sustainX = decayX + 0.1 * scale;
    ctx.lineTo(sustainX, sustainY);
    
    // Release: fall to zero
    const releaseX = sustainX + r * scale;
    ctx.lineTo(releaseX, h);
    
    ctx.stroke();
    
    // Fill under curve
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(74, 158, 255, 0.2)';
    ctx.fill();
  }
  
  clearChord() {
    this.activeChord = null;
    this.selectedModes.clear();
    this.audioEngine.clearChord();
    this.updateModeGridHighlight();
    this.setStatus('Drag to orbit • Click to strike • Keys 1-9 for chords');
  }
  
  // ========== SEQUENCER METHODS ==========
  
  initSequencer() {
    this.sequencer = new ChordSequencer(this.audioEngine, this.mMax);
    
    // Set up callbacks
    this.sequencer.onStepChange = (stepIndex, step) => {
      this.updateSequencerUI();
      this.setStatus(`Seq: ${step.name} (${stepIndex + 1}/${this.sequencer.steps.length})`);
      
      // Update mode grid to show current chord
      this.selectedModes.clear();
      for (const mode of step.chord.modes) {
        this.selectedModes.add(`${mode.m},${mode.n}`);
      }
      this.updateModeGridHighlight();
    };
    
    this.sequencer.onPlaybackEnd = () => {
      // Loop playback
    };
    
    this.updateSequencerUI();
  }
  
  sequencerPlay() {
    if (!this.sequencer) this.initSequencer();
    if (this.sequencer.steps.length === 0) {
      this.setStatus('Add chords to sequence first!');
      return;
    }
    
    // Enable sustain for sequencer playback
    const sustainCheckbox = document.getElementById('chord-sustain');
    if (sustainCheckbox) sustainCheckbox.checked = true;
    this.chordSustain = true;
    
    this.sequencer.play();
    this.updateSequencerUI();
  }
  
  sequencerStop() {
    if (this.sequencer) {
      this.sequencer.stop();
      this.updateSequencerUI();
      this.selectedModes.clear();
      this.updateModeGridHighlight();
      this.setStatus('Sequencer stopped');
    }
  }
  
  sequencerClear() {
    if (this.sequencer) {
      this.sequencer.clear();
      this.updateSequencerUI();
      this.setStatus('Sequence cleared');
    }
  }
  
  sequencerAddCurrentChord() {
    if (!this.sequencer) this.initSequencer();
    
    // If there's an active chord, add it
    if (this.activeChord) {
      const classification = Harmony.classifyChord(this.activeChord);
      this.sequencer.steps.push({
        chord: this.activeChord,
        name: classification.type,
        duration: 1
      });
      this.updateSequencerUI();
      this.setStatus(`Added ${classification.type} to sequence`);
    } else {
      this.setStatus('Play a chord first, then add it');
    }
  }
  
  loadSequencerPreset(presetName) {
    if (!presetName) return;
    
    this.sequencer = ChordSequencer.createPresetProgression(presetName, this.audioEngine, this.mMax);
    
    // Set up callbacks
    this.sequencer.onStepChange = (stepIndex, step) => {
      this.updateSequencerUI();
      this.setStatus(`Seq: ${step.name} (${stepIndex + 1}/${this.sequencer.steps.length})`);
      
      this.selectedModes.clear();
      for (const mode of step.chord.modes) {
        this.selectedModes.add(`${mode.m},${mode.n}`);
      }
      this.updateModeGridHighlight();
    };
    
    this.updateSequencerUI();
    this.setStatus(`Loaded "${presetName}" progression`);
    
    // Reset dropdown
    const dropdown = document.getElementById('seq-preset');
    if (dropdown) dropdown.value = '';
  }
  
  updateSequencerUI() {
    const timeline = document.getElementById('seq-timeline');
    if (!timeline || !this.sequencer) return;
    
    timeline.innerHTML = '';
    
    this.sequencer.steps.forEach((step, i) => {
      const stepEl = document.createElement('div');
      stepEl.className = 'seq-step' + (i === this.sequencer.currentStep && this.sequencer.isPlaying ? ' active' : '');
      stepEl.innerHTML = `
        <span class="seq-step-num">${i + 1}</span>
        <span class="seq-step-name">${step.name}</span>
        <button class="seq-step-remove" data-index="${i}">×</button>
      `;
      
      // Click to jump
      stepEl.addEventListener('click', (e) => {
        if (!e.target.classList.contains('seq-step-remove')) {
          this.sequencer.jumpTo(i);
        }
      });
      
      // Remove button
      stepEl.querySelector('.seq-step-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        this.sequencer.removeStep(i);
        this.updateSequencerUI();
      });
      
      timeline.appendChild(stepEl);
    });
    
    // Update play button state
    const playBtn = document.getElementById('seq-play');
    if (playBtn) {
      playBtn.textContent = this.sequencer.isPlaying ? '⏸' : '▶';
    }
  }
  
  // ========== EUCLIDEAN SEQUENCER METHODS ==========
  
  initEuclideanSequencer() {
    this.euclidean = new EuclideanSequencer(this.audioEngine, this.mMax);
    this.chordQueue = [];           // Queue of chords to cycle through
    this.chordQueueIndex = 0;       // Current position in queue
    
    // Set up callbacks
    this.euclidean.onPatternChange = (pattern) => {
      this.updateEuclideanStepsUI();
    };
    
    this.euclidean.onStepChange = (stepIndex, isActive) => {
      this.updateEuclideanCurrentStep(stepIndex);
    };
    
    // Pulse callback - triggers next chord from queue
    this.euclidean.onPulse = (stepIndex) => {
      this.triggerNextChordFromQueue();
    };
    
    // Always use external mode - Euclidean controls all chord triggering
    this.euclidean.setTriggerMode('external');
    
    // Initialize UI elements
    this.setupEuclideanUI();
    this.updateEuclideanStepsUI();
    this.updateChordQueueUI();
  }
  
  /**
   * Trigger the next chord from the queue
   */
  triggerNextChordFromQueue() {
    if (this.chordQueue.length === 0) {
      // No queue - use the selected chord preset from dropdown
      const chordSelect = document.getElementById('euc-chord');
      const presetName = chordSelect?.value || 'fundamental';
      const chord = Harmony.getChordPreset(presetName);
      if (chord) {
        this.playChordWithArticulation(chord);
        this.setStatus(`Euclidean: ${presetName}`);
      }
      return;
    }
    
    // Get chord from queue
    const queueItem = this.chordQueue[this.chordQueueIndex];
    if (queueItem) {
      this.playChordWithArticulation(queueItem.chord);
      
      // Update UI to show current chord
      this.selectedModes.clear();
      for (const mode of queueItem.chord.modes) {
        this.selectedModes.add(`${mode.m},${mode.n}`);
      }
      this.updateModeGridHighlight();
      this.updateChordQueueUI();
      this.setStatus(`${queueItem.name} (${this.chordQueueIndex + 1}/${this.chordQueue.length})`);
      
      // Advance to next chord (loop)
      this.chordQueueIndex = (this.chordQueueIndex + 1) % this.chordQueue.length;
    }
  }
  
  /**
   * Play chord through articulator
   */
  playChordWithArticulation(chord) {
    this.activeChord = chord;
    
    if (this.articulator && this.articulator.mode !== 'instant') {
      this.articulator.playChord(chord, 1.0);
    } else {
      const amplitudes = Harmony.chordToAmplitudes(chord, this.mMax, this.mMax);
      this.audioEngine.setChord(amplitudes, true);
    }
  }
  
  /**
   * Add current chord to queue
   */
  addChordToQueue() {
    // Get selected chord from dropdown
    const select = document.getElementById('euc-chord-select');
    const chordName = select?.value || 'cluster';
    
    const chord = Harmony.getChordPreset(chordName);
    if (!chord) {
      this.setStatus('Chord not found: ' + chordName);
      return;
    }
    
    this.chordQueue.push({
      chord: chord,
      name: chordName
    });
    
    this.updateChordQueueUI();
    this.setStatus(`Added ${chordName} to queue (${this.chordQueue.length} chords)`);
  }
  
  /**
   * Remove chord from queue by index
   */
  removeChordFromQueue(index) {
    if (index >= 0 && index < this.chordQueue.length) {
      this.chordQueue.splice(index, 1);
      if (this.chordQueueIndex >= this.chordQueue.length) {
        this.chordQueueIndex = 0;
      }
      this.updateChordQueueUI();
    }
  }
  
  /**
   * Clear chord queue
   */
  clearChordQueue() {
    this.chordQueue = [];
    this.chordQueueIndex = 0;
    this.updateChordQueueUI();
  }
  
  /**
   * Load a preset chord progression
   */
  loadChordQueuePreset(presetName) {
    const presets = {
      'simple': ['fundamental', 'diagonal', 'cross', 'fundamental'],
      'symmetric': ['fundamental', 'cross', 'square', 'cross'],
      'geometric': ['diagonal', 'horizontal', 'vertical', 'diamond'],
      'tension': ['fundamental', 'star', 'diamond', 'cross', 'fundamental']
    };
    
    const chordNames = presets[presetName];
    if (!chordNames) return;
    
    this.chordQueue = chordNames.map(name => {
      const chord = Harmony.getChordPreset(name);
      return { chord, name };
    }).filter(item => item.chord);
    
    this.chordQueueIndex = 0;
    this.updateChordQueueUI();
    this.setStatus(`Loaded ${presetName} progression (${this.chordQueue.length} chords)`);
  }
  
  /**
   * Update chord queue UI
   */
  updateChordQueueUI() {
    const container = document.getElementById('euc-chord-queue');
    if (!container) return;
    
    if (this.chordQueue.length === 0) {
      container.innerHTML = '<div class="chord-queue-empty">Select chord → + Add</div>';
      return;
    }
    
    container.innerHTML = '';
    this.chordQueue.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'chord-queue-item' + (i === this.chordQueueIndex ? ' current' : '');
      el.innerHTML = `<span>${item.name}</span><span class="remove" data-index="${i}">✕</span>`;
      
      el.querySelector('.remove').addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeChordFromQueue(i);
      });
      
      container.appendChild(el);
    });
  }
  
  setupEuclideanUI() {
    // Steps slider
    const stepsSlider = document.getElementById('euc-steps');
    const stepsVal = document.getElementById('euc-steps-val');
    stepsSlider?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      stepsVal.textContent = val;
      this.euclidean.setSteps(val);
      
      // Update pulses max
      const pulsesSlider = document.getElementById('euc-pulses');
      if (pulsesSlider) {
        pulsesSlider.max = val;
        if (parseInt(pulsesSlider.value) > val) {
          pulsesSlider.value = val;
          document.getElementById('euc-pulses-val').textContent = val;
        }
      }
      
      // Update rotation max
      const rotSlider = document.getElementById('euc-rotation');
      if (rotSlider) {
        rotSlider.max = val - 1;
        if (parseInt(rotSlider.value) >= val) {
          rotSlider.value = 0;
          document.getElementById('euc-rotation-val').textContent = '0';
          this.euclidean.setRotation(0);
        }
      }
      
      this.updateEuclideanNotation();
    });
    
    // Pulses slider
    const pulsesSlider = document.getElementById('euc-pulses');
    const pulsesVal = document.getElementById('euc-pulses-val');
    pulsesSlider?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      pulsesVal.textContent = val;
      this.euclidean.setPulses(val);
      this.updateEuclideanNotation();
    });
    
    // Rotation slider
    const rotSlider = document.getElementById('euc-rotation');
    const rotVal = document.getElementById('euc-rotation-val');
    rotSlider?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      rotVal.textContent = val;
      this.euclidean.setRotation(val);
      this.updateEuclideanNotation();
    });
    
    // BPM slider
    const bpmSlider = document.getElementById('euc-bpm');
    const bpmVal = document.getElementById('euc-bpm-val');
    bpmSlider?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      bpmVal.textContent = val;
      this.euclidean.setBPM(val);
    });
    
    // Play button
    document.getElementById('euc-play')?.addEventListener('click', () => {
      if (this.euclidean.isPlaying) {
        this.euclidean.pause();
        document.getElementById('euc-play').textContent = '▶ Play';
        document.getElementById('euc-play').classList.remove('playing');
      } else {
        this.euclidean.play();
        document.getElementById('euc-play').textContent = '⏸ Pause';
        document.getElementById('euc-play').classList.add('playing');
      }
    });
    
    // Stop button
    document.getElementById('euc-stop')?.addEventListener('click', () => {
      this.euclidean.stop();
      this.chordQueueIndex = 0;
      this.audioEngine.clearChord();
      document.getElementById('euc-play').textContent = '▶ Play';
      document.getElementById('euc-play').classList.remove('playing');
      this.updateEuclideanCurrentStep(-1);
      this.updateChordQueueUI();
    });
    
    // Reset button (clear manual overrides)
    document.getElementById('euc-reset')?.addEventListener('click', () => {
      this.euclidean.clearOverrides();
      this.chordQueueIndex = 0; // Reset chord index too
      this.updateEuclideanNotation();
      this.updateChordQueueUI();
    });
    
    // Chord queue controls
    document.getElementById('euc-add-chord')?.addEventListener('click', () => {
      this.addChordToQueue();
    });
    
    document.getElementById('euc-clear-chords')?.addEventListener('click', () => {
      this.clearChordQueue();
    });
    
    document.getElementById('euc-chord-preset')?.addEventListener('change', (e) => {
      if (e.target.value) {
        this.loadChordQueuePreset(e.target.value);
        e.target.value = ''; // Reset dropdown
      }
    });
    
    // Chord select (used when queue is empty)
    document.getElementById('euc-chord')?.addEventListener('change', (e) => {
      // Just stores the selection, used when queue is empty
    });
    
    // Preset rhythms
    document.getElementById('euc-preset')?.addEventListener('change', (e) => {
      if (e.target.value) {
        this.euclidean.loadPreset(e.target.value);
        
        // Update sliders to match
        document.getElementById('euc-steps').value = this.euclidean.steps;
        document.getElementById('euc-steps-val').textContent = this.euclidean.steps;
        document.getElementById('euc-pulses').value = this.euclidean.pulses;
        document.getElementById('euc-pulses').max = this.euclidean.steps;
        document.getElementById('euc-pulses-val').textContent = this.euclidean.pulses;
        document.getElementById('euc-rotation').value = this.euclidean.rotation;
        document.getElementById('euc-rotation').max = this.euclidean.steps - 1;
        document.getElementById('euc-rotation-val').textContent = this.euclidean.rotation;
        
        this.updateEuclideanNotation();
        e.target.value = ''; // Reset dropdown
      }
    });
  }
  
  updateEuclideanStepsUI() {
    const container = document.getElementById('euc-steps-display');
    if (!container || !this.euclidean) return;
    
    container.innerHTML = '';
    
    const totalSteps = this.euclidean.pattern.length;
    
    // Determine row size - split evenly when > 16 steps
    let stepsPerRow;
    if (totalSteps <= 16) {
      stepsPerRow = totalSteps; // Single row
    } else if (totalSteps <= 32) {
      stepsPerRow = Math.ceil(totalSteps / 2); // Two equal rows (16+16 for 32)
    } else {
      stepsPerRow = 16; // Max 16 per row
    }
    
    let currentRow = null;
    
    this.euclidean.pattern.forEach((active, i) => {
      // Start a new row when needed
      if (i % stepsPerRow === 0) {
        currentRow = document.createElement('div');
        currentRow.className = 'euclidean-row';
        container.appendChild(currentRow);
      }
      
      const step = document.createElement('div');
      step.className = 'euclidean-step' + (active ? ' active' : '');
      step.textContent = i + 1;
      step.dataset.index = i;
      
      // Check if this is a manual override
      if (this.euclidean.manualOverrides.has(i)) {
        step.classList.add('manual-override');
      }
      
      // Click to toggle
      step.addEventListener('click', () => {
        this.euclidean.toggleStep(i);
        this.updateEuclideanNotation();
      });
      
      currentRow.appendChild(step);
    });
  }
  
  updateEuclideanCurrentStep(stepIndex) {
    const container = document.getElementById('euc-steps-display');
    if (!container) return;
    
    const steps = container.querySelectorAll('.euclidean-step');
    steps.forEach((step, i) => {
      step.classList.toggle('current', i === stepIndex);
    });
  }
  
  updateEuclideanNotation() {
    const notation = document.getElementById('euc-notation');
    if (notation && this.euclidean) {
      let text = this.euclidean.getNotation();
      if (this.euclidean.manualOverrides.size > 0) {
        text += '*'; // Indicate manual overrides
      }
      notation.textContent = text;
    }
  }
  
  // ========== ARTICULATOR METHODS ==========
  
  initArticulator() {
    this.articulator = new ChordArticulator(this.audioEngine, this.mMax);
    
    // Set up callbacks for UI feedback
    this.articulator.onModeTriggered = (modeIndices, type) => {
      // Flash the triggered modes in the grid
      for (const idx of modeIndices) {
        this.flashModeCell(idx);
      }
    };
    
    // Apply initial UI values
    this.updateArticulatorFromUI();
  }
  
  setupArticulationListeners() {
    // Mode buttons (Instant/Strum/Arpeggio)
    document.querySelectorAll('.articulation-mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.articulation-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const mode = btn.dataset.mode;
        if (this.articulator) {
          this.articulator.setMode(mode);
        }
      });
    });
    
    // Strum time slider
    document.getElementById('artic-strum-time')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      document.getElementById('artic-strum-time-val').textContent = val + 'ms';
      if (this.articulator) this.articulator.setStrumTime(val);
    });
    
    // Brightness slider
    document.getElementById('artic-brightness')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      document.getElementById('artic-brightness-val').textContent = val + '%';
      if (this.articulator) this.articulator.setBrightness(val / 100);
    });
    
    // Arp rate slider
    document.getElementById('artic-arp-rate')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      document.getElementById('artic-arp-rate-val').textContent = val + ' BPM';
      if (this.articulator) this.articulator.setArpeggioRate(val);
    });
    
    // Humanize slider
    document.getElementById('artic-humanize')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      document.getElementById('artic-humanize-val').textContent = val + '%';
      if (this.articulator) this.articulator.setVelocitySpread(val / 100);
    });
    
    // Direction buttons
    document.querySelectorAll('.direction-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.direction-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const dir = btn.dataset.dir;
        if (this.articulator) this.articulator.setDirection(dir);
      });
    });
    
    // Arp pattern buttons
    document.querySelectorAll('.arp-pattern-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.arp-pattern-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const pattern = btn.dataset.pattern;
        if (this.articulator) this.articulator.setArpeggioPattern(pattern);
      });
    });
    
    // Preset buttons
    document.querySelectorAll('.artic-preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.artic-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const preset = btn.dataset.preset;
        if (this.articulator) {
          this.articulator.loadPreset(preset);
          this.updateArticulationUI();
        }
      });
    });
  }
  
  updateArticulatorFromUI() {
    if (!this.articulator) return;
    
    const strumTime = parseInt(document.getElementById('artic-strum-time')?.value ?? 60);
    const brightness = parseInt(document.getElementById('artic-brightness')?.value ?? 50);
    const arpRate = parseInt(document.getElementById('artic-arp-rate')?.value ?? 240);
    const humanize = parseInt(document.getElementById('artic-humanize')?.value ?? 20);
    
    this.articulator.setStrumTime(strumTime);
    this.articulator.setBrightness(brightness / 100);
    this.articulator.setArpeggioRate(arpRate);
    this.articulator.setVelocitySpread(humanize / 100);
  }
  
  updateArticulationUI() {
    if (!this.articulator) return;
    
    // Update sliders
    const strumEl = document.getElementById('artic-strum-time');
    if (strumEl) {
      strumEl.value = this.articulator.strumTime;
      document.getElementById('artic-strum-time-val').textContent = this.articulator.strumTime + 'ms';
    }
    
    const brightEl = document.getElementById('artic-brightness');
    if (brightEl) {
      brightEl.value = Math.round(this.articulator.brightness * 100);
      document.getElementById('artic-brightness-val').textContent = Math.round(this.articulator.brightness * 100) + '%';
    }
    
    const arpRateEl = document.getElementById('artic-arp-rate');
    if (arpRateEl) {
      arpRateEl.value = this.articulator.arpeggioRate;
      document.getElementById('artic-arp-rate-val').textContent = this.articulator.arpeggioRate + ' BPM';
    }
    
    // Update mode buttons
    document.querySelectorAll('.articulation-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === this.articulator.mode);
    });
    
    // Update direction buttons
    document.querySelectorAll('.direction-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.dir === this.articulator.direction);
    });
    
    // Update arp pattern buttons
    document.querySelectorAll('.arp-pattern-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pattern === this.articulator.arpeggioPattern);
    });
  }
  
  /**
   * Play a chord through the articulator
   */
  playChordArticulated(chord, velocity = 1.0) {
    if (this.articulator) {
      this.articulator.playChord(chord, velocity);
    } else {
      // Fallback to direct playback
      const amplitudes = Harmony.chordToAmplitudes(chord, this.mMax, this.mMax);
      this.audioEngine.setChord(amplitudes, this.chordSustain);
    }
  }
  
  /**
   * Stop articulator (arpeggio, strum in progress)
   */
  stopArticulator() {
    if (this.articulator) {
      this.articulator.stop();
    }
  }
  
  flashModeCell(index) {
    const grid = document.getElementById('mode-info');
    const cells = grid?.querySelectorAll('.mode-cell');
    if (cells?.[index]) {
      // Bright flash for triggered mode
      cells[index].style.background = '#ff6b4a';
      cells[index].style.transform = 'scale(1.15)';
      cells[index].style.boxShadow = '0 0 12px #ff6b4a';
      cells[index].style.zIndex = '10';
      setTimeout(() => { 
        cells[index].style.transform = '';
        cells[index].style.boxShadow = '';
        cells[index].style.zIndex = '';
        if (!this.selectedModes.has(this.indexToKey(index))) {
          cells[index].style.background = ''; 
        }
      }, 150);
    }
  }
  
  indexToKey(index) {
    const mMax = this.mMax;
    const m = (index % mMax) + 1;
    const n = Math.floor(index / mMax) + 1;
    return `${m},${n}`;
  }
  
  updateModeGridHighlight() {
    const grid = document.getElementById('mode-info');
    const cells = grid?.querySelectorAll('.mode-cell');
    if (!cells) return;
    
    cells.forEach((cell, index) => {
      const key = this.indexToKey(index);
      const [m, n] = key.split(',').map(Number);
      
      // Check if mode is in current scale
      const inScale = !this.currentScale || this.currentScale.contains(m, n);
      
      if (this.selectedModes.has(key)) {
        // Selected mode (in chord)
        cell.style.background = '#4a9eff';
        cell.style.color = '#fff';
        cell.style.opacity = '1';
      } else if (!inScale) {
        // Not in scale - dim it
        cell.style.background = '#1a1a25';
        cell.style.color = '#444';
        cell.style.opacity = '0.5';
      } else {
        // In scale but not selected
        cell.style.background = '';
        cell.style.color = '';
        cell.style.opacity = '1';
      }
    });
  }
  
  updateMicPosition() {
    const micX = parseFloat(document.getElementById('mic-x-slider')?.value ?? 0.3);
    const micY = parseFloat(document.getElementById('mic-y-slider')?.value ?? 0.4);
    this.audioEngine.setMicPosition(micX, micY);
    document.getElementById('mic-x-value').textContent = micX.toFixed(2);
    document.getElementById('mic-y-value').textContent = micY.toFixed(2);
  }
  
  async start() {
    if (this.isRunning) return;
    
    try {
      this.setStatus('Initializing...');
      await this.audioEngine.init();
      
      // Initialize renderer with grid size and mode count
      this.renderer = new WebGLRenderer(this.canvas, this.gridSize, this.mMax, this.mMax);
      this.renderer.onStrike = (x, y) => this.exciteAt(x, y);
      
      this.audioEngine.onAmplitudes = (amps) => { this.amplitudes = amps; };
      
      this.updateMicPosition();
      this.setupModeGrid();
      this.setupChordPalette();
      this.initSequencer();
      this.initEuclideanSequencer();
      this.initArticulator();
      
      // Apply initial slider values
      if (document.getElementById('height-slider')) {
        this.renderer.heightScale = parseFloat(document.getElementById('height-slider').value);
      }
      if (document.getElementById('smoothing-slider')) {
        this.renderer.fallRate = parseFloat(document.getElementById('smoothing-slider').value);
      }
      
      // Initialize ADSR display
      this.updateEnvelope();
      
      this.isRunning = true;
      this.startButton.style.display = 'none';
      this.setStatus('Drag to orbit • Click to strike • Keys 1-9 for chords');
      
      this.renderLoop(0);
      
    } catch (err) {
      this.setStatus('Error: ' + err.message);
      console.error(err);
    }
  }
  
  exciteAt(x, y) {
    x = Math.max(0.05, Math.min(0.95, x));
    y = Math.max(0.05, Math.min(0.95, y));
    this.audioEngine.excite(x, y);
    this.setStatus(`Strike at (${x.toFixed(2)}, ${y.toFixed(2)})`);
  }
  
  renderLoop(timestamp) {
    if (!this.isRunning) return;
    
    const time = timestamp / 1000;
    
    // Pass amplitudes directly to GPU - no CPU height field computation
    if (this.amplitudes) {
      this.renderer.updateAmplitudes(this.amplitudes);
    }
    
    this.renderer.render(time);
    requestAnimationFrame((t) => this.renderLoop(t));
  }
  
  setStatus(msg) {
    if (this.statusEl) this.statusEl.textContent = msg;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new ModalHarmonicApp();
});
