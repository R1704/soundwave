/**
 * Main application - Modal Harmonic Synthesizer
 * 
 * Integrates:
 * - Modal drum physics (square membrane)
 * - Modal harmony theory (geometric music)
 * - Chord voicings and voice leading
 * - Cymatics visualization
 */

import { AudioEngine } from './audio-engine.js';
import { WebGLRenderer } from './webgl-renderer.js';
import { updateHeightField } from './modes.js';
import * as Harmony from './modal-harmony.js';

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
    
    // Cymatics mode state
    this.driveEnabled = false;
    this.driveFreq = 200;
    
    // Chord state
    this.activeChord = null;
    this.chordSustain = false;
    this.selectedModes = new Set();  // For building custom chords
    
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
        this.renderer.smoothingFactor = parseFloat(e.target.value);
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
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeydown(e));
    document.addEventListener('keyup', (e) => this.handleKeyup(e));
    
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
      this.shiftChord(0, 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.shiftChord(0, -1);
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
    if (!palette) return;
    
    const presets = ['fundamental', 'diagonal', 'horizontal', 'vertical', 
                     'cross', 'square', 'diamond', 'star', 'grid'];
    
    presets.forEach((name, i) => {
      const btn = palette.querySelector(`[data-chord="${name}"]`);
      if (btn) {
        btn.addEventListener('mousedown', () => this.playChordPreset(name));
        btn.addEventListener('mouseup', () => {
          if (!this.chordSustain) this.clearChord();
        });
        btn.addEventListener('mouseleave', () => {
          if (!this.chordSustain) this.clearChord();
        });
      }
    });
  }
  
  exciteMode(index) {
    if (!this.isRunning) return;
    
    const mMax = 4;
    const m = (index % mMax) + 1;
    const n = Math.floor(index / mMax) + 1;
    
    this.audioEngine.exciteMode(m, n, 0.15);
    
    const mode = Harmony.createMode(m, n);
    this.setStatus(`Mode (${m},${n}) — ${mode.freq.toFixed(0)} Hz — ${mode.nodalLines} nodes`);
    
    // Visual feedback
    this.flashModeCell(index);
  }
  
  toggleModeInChord(index) {
    const mMax = 4;
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
    const chord = Harmony.getChordPreset(name);
    if (!chord) return;
    
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
    if (!this.isRunning) return;
    
    this.activeChord = chord;
    const amplitudes = Harmony.chordToAmplitudes(chord, 4, 4);
    this.audioEngine.setChord(amplitudes, this.chordSustain);
  }
  
  shiftChord(dm, dn) {
    if (!this.activeChord) return;
    
    // Shift all modes in the chord
    const newIndices = [];
    for (const mode of this.activeChord.modes) {
      const newM = Math.max(1, Math.min(4, mode.m + dm));
      const newN = Math.max(1, Math.min(4, mode.n + dn));
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
    
    const direction = dm > 0 ? '→' : dm < 0 ? '←' : dn > 0 ? '↑' : '↓';
    this.setStatus(`Voice leading ${direction}`);
  }
  
  clearChord() {
    this.activeChord = null;
    this.selectedModes.clear();
    this.audioEngine.clearChord();
    this.updateModeGridHighlight();
    this.setStatus('Drag to orbit • Click to strike • Keys 1-9 for chords');
  }
  
  flashModeCell(index) {
    const grid = document.getElementById('mode-info');
    const cells = grid?.querySelectorAll('.mode-cell');
    if (cells?.[index]) {
      cells[index].style.background = '#4a9eff';
      setTimeout(() => { 
        if (!this.selectedModes.has(this.indexToKey(index))) {
          cells[index].style.background = ''; 
        }
      }, 200);
    }
  }
  
  indexToKey(index) {
    const mMax = 4;
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
      if (this.selectedModes.has(key)) {
        cell.style.background = '#4a9eff';
        cell.style.color = '#fff';
      } else {
        cell.style.background = '';
        cell.style.color = '';
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
      
      this.renderer = new WebGLRenderer(this.canvas, this.gridSize);
      this.renderer.onStrike = (x, y) => this.exciteAt(x, y);
      
      this.audioEngine.onAmplitudes = (amps) => { this.amplitudes = amps; };
      
      this.updateMicPosition();
      this.setupModeGrid();
      this.setupChordPalette();
      
      // Apply initial slider values
      if (document.getElementById('height-slider')) {
        this.renderer.heightScale = parseFloat(document.getElementById('height-slider').value);
      }
      if (document.getElementById('smoothing-slider')) {
        this.renderer.smoothingFactor = parseFloat(document.getElementById('smoothing-slider').value);
      }
      
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
    
    if (this.amplitudes && this.audioEngine.modalState) {
      const state = this.audioEngine.modalState;
      for (let i = 0; i < this.amplitudes.length; i++) {
        state.modes[i].currentAmplitude = this.amplitudes[i];
      }
      const heights = updateHeightField(state);
      this.renderer.updateHeights(heights);
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
