/**
 * Chord Articulator
 * 
 * Transforms chord triggers into expressive, timed sequences.
 * Supports strum, arpeggio, and various articulation styles.
 */

/**
 * Articulation modes
 */
export const ArticulationMode = {
  INSTANT: 'instant',      // All modes at once (default)
  STRUM: 'strum',          // Spread modes over time (like guitar strum)
  ARPEGGIO: 'arpeggio',    // Cycle through modes repeatedly
};

/**
 * Direction for strum/arpeggio
 */
export const Direction = {
  LOW_TO_HIGH: 'low-high',    // Low frequencies first
  HIGH_TO_LOW: 'high-low',    // High frequencies first
  OUT_TO_IN: 'out-in',        // Outer modes (high m,n) to fundamental
  IN_TO_OUT: 'in-out',        // Fundamental to outer modes
  RANDOM: 'random',           // Random order
};

/**
 * Arpeggio patterns
 */
export const ArpeggioPattern = {
  UP: 'up',
  DOWN: 'down',
  UP_DOWN: 'up-down',
  DOWN_UP: 'down-up',
  RANDOM: 'random',
};

/**
 * Sort modes by frequency (for strum direction)
 */
function sortModesByFrequency(modes, direction, f0 = 200, mMax = 6) {
  // Calculate frequency for each mode and compute grid index
  const modesWithFreq = modes.map((mode) => {
    const freq = f0 * Math.sqrt(mode.m * mode.m + mode.n * mode.n) / Math.SQRT2;
    // Grid index for 6x6 (or mMax x mMax) grid
    const gridIndex = (mode.n - 1) * mMax + (mode.m - 1);
    return { ...mode, freq, gridIndex };
  });
  
  switch (direction) {
    case Direction.LOW_TO_HIGH:
      modesWithFreq.sort((a, b) => a.freq - b.freq);
      break;
      
    case Direction.HIGH_TO_LOW:
      modesWithFreq.sort((a, b) => b.freq - a.freq);
      break;
      
    case Direction.IN_TO_OUT:
      // Sort by m+n (fundamental = 1,1 = 2, outer = higher sums)
      modesWithFreq.sort((a, b) => (a.m + a.n) - (b.m + b.n));
      break;
      
    case Direction.OUT_TO_IN:
      modesWithFreq.sort((a, b) => (b.m + b.n) - (a.m + a.n));
      break;
      
    case Direction.RANDOM:
      // Fisher-Yates shuffle
      for (let i = modesWithFreq.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [modesWithFreq[i], modesWithFreq[j]] = [modesWithFreq[j], modesWithFreq[i]];
      }
      break;
  }
  
  return modesWithFreq;
}

/**
 * Main Chord Articulator class
 */
export class ChordArticulator {
  constructor(audioEngine, mMax = 6) {
    this.audioEngine = audioEngine;
    this.mMax = mMax;
    this.f0 = 200;
    
    // Articulation settings
    this.mode = ArticulationMode.INSTANT;
    this.direction = Direction.LOW_TO_HIGH;
    
    // Strum parameters
    this.strumTime = 150;      // Total strum duration in ms (increased for audible effect)
    this.strumCurve = 'linear'; // linear, exponential, log
    
    // Arpeggio parameters
    this.arpeggioPattern = ArpeggioPattern.UP;
    this.arpeggioRate = 120;   // BPM for arpeggio
    this.arpeggioOctaves = 1;  // How many times to cycle
    this.arpeggioHold = true;  // Hold previous notes or single-note
    
    // Velocity/gain curves
    this.brightness = 0.5;     // 0 = warm (low modes), 1 = bright (high modes)
    this.velocitySpread = 0.2; // Random velocity variation per mode
    
    // State
    this.scheduledTimeouts = [];
    this.arpeggioInterval = null;
    this.arpeggioIndex = 0;
    this.arpeggioDirection = 1; // 1 = up, -1 = down
    this.currentChord = null;
    this.sortedModes = [];
    
    // Callbacks
    this.onModeTriggered = null; // Called when each mode fires (for UI feedback)
  }
  
  /**
   * Calculate per-mode gain based on brightness curve
   */
  calculateModeGain(mode, baseAmplitude) {
    const normalizedFreq = Math.sqrt(mode.m * mode.m + mode.n * mode.n) / (this.mMax * Math.SQRT2);
    
    // Brightness curve: 0.5 = flat, 0 = low boost, 1 = high boost
    let gain = 1.0;
    if (this.brightness < 0.5) {
      // Boost lows, attenuate highs
      const lowBoost = 1 - this.brightness * 2; // 1 at brightness=0, 0 at 0.5
      gain = 1 + lowBoost * (1 - normalizedFreq);
    } else {
      // Boost highs, attenuate lows  
      const highBoost = (this.brightness - 0.5) * 2; // 0 at brightness=0.5, 1 at 1.0
      gain = 1 + highBoost * normalizedFreq;
    }
    
    // Add random velocity spread
    const randomFactor = 1 + (Math.random() - 0.5) * this.velocitySpread * 2;
    
    return baseAmplitude * gain * randomFactor;
  }
  
  /**
   * Play a chord with current articulation settings
   * @param {Object} chord - Chord object with modes array
   * @param {number} velocity - Overall velocity (0-1)
   */
  playChord(chord, velocity = 1.0) {
    // Cancel any ongoing articulation
    this.stop();
    
    this.currentChord = chord;
    
    if (!chord || !chord.modes || chord.modes.length === 0) {
      return;
    }
    
    // Sort modes for strum/arpeggio direction
    this.sortedModes = sortModesByFrequency(chord.modes, this.direction, this.f0, this.mMax);
    
    switch (this.mode) {
      case ArticulationMode.INSTANT:
        this.playInstant(velocity);
        break;
        
      case ArticulationMode.STRUM:
        this.playStrum(velocity);
        break;
        
      case ArticulationMode.ARPEGGIO:
        this.playArpeggio(velocity);
        break;
    }
  }
  
  /**
   * Play all modes instantly
   */
  playInstant(velocity) {
    const amplitudes = new Float32Array(this.mMax * this.mMax);
    
    for (const mode of this.sortedModes) {
      const index = (mode.n - 1) * this.mMax + (mode.m - 1);
      const gain = this.calculateModeGain(mode, mode.amplitude || 1.0);
      amplitudes[index] = gain * velocity;
    }
    
    this.audioEngine.setChord(amplitudes, true);
    
    if (this.onModeTriggered) {
      this.onModeTriggered(this.sortedModes.map(m => m.gridIndex), 'all');
    }
  }
  
  /**
   * Play modes spread over time (strum)
   */
  playStrum(velocity) {
    const numModes = this.sortedModes.length;
    console.log('playStrum: numModes=', numModes, 'strumTime=', this.strumTime);
    if (numModes === 0) return;
    
    // Calculate delay for each mode
    const delays = this.calculateStrumDelays(numModes);
    console.log('playStrum delays:', delays);
    
    // Schedule each mode - use exciteModes for impulse-based triggering
    this.sortedModes.forEach((mode, i) => {
      const delay = delays[i];
      
      const timeoutId = setTimeout(() => {
        const index = (mode.n - 1) * this.mMax + (mode.m - 1);
        const gain = this.calculateModeGain(mode, mode.amplitude || 1.0);
        
        // Create impulse array for just this mode
        const impulseAmps = new Float32Array(this.mMax * this.mMax);
        impulseAmps[index] = gain * velocity;
        
        // Use exciteModes to add impulses (not setChord which sets sustain targets)
        this.audioEngine.exciteModes(impulseAmps);
        
        // Callback for UI - use gridIndex for correct cell highlight
        if (this.onModeTriggered) {
          this.onModeTriggered([mode.gridIndex], 'strum');
        }
      }, delay);
      
      this.scheduledTimeouts.push(timeoutId);
    });
  }
  
  /**
   * Calculate strum delays based on curve type
   */
  calculateStrumDelays(numModes) {
    const delays = [];
    
    for (let i = 0; i < numModes; i++) {
      const t = i / Math.max(1, numModes - 1); // 0 to 1
      
      let delay;
      switch (this.strumCurve) {
        case 'exponential':
          // Slow start, fast end
          delay = Math.pow(t, 2) * this.strumTime;
          break;
          
        case 'log':
          // Fast start, slow end
          delay = Math.sqrt(t) * this.strumTime;
          break;
          
        case 'linear':
        default:
          delay = t * this.strumTime;
          break;
      }
      
      delays.push(delay);
    }
    
    return delays;
  }
  
  /**
   * Play modes in repeating arpeggio pattern
   */
  playArpeggio(velocity) {
    const numModes = this.sortedModes.length;
    if (numModes === 0) return;
    
    this.arpeggioIndex = 0;
    this.arpeggioDirection = 1;
    
    const intervalMs = 60000 / this.arpeggioRate; // Convert BPM to ms
    
    // Trigger first note immediately
    this.triggerArpeggioNote(velocity);
    
    // Set up interval for subsequent notes
    this.arpeggioInterval = setInterval(() => {
      this.advanceArpeggio();
      this.triggerArpeggioNote(velocity);
    }, intervalMs);
  }
  
  /**
   * Advance arpeggio index based on pattern
   */
  advanceArpeggio() {
    const numModes = this.sortedModes.length;
    
    switch (this.arpeggioPattern) {
      case ArpeggioPattern.UP:
        this.arpeggioIndex = (this.arpeggioIndex + 1) % numModes;
        break;
        
      case ArpeggioPattern.DOWN:
        this.arpeggioIndex = (this.arpeggioIndex - 1 + numModes) % numModes;
        break;
        
      case ArpeggioPattern.UP_DOWN:
        this.arpeggioIndex += this.arpeggioDirection;
        if (this.arpeggioIndex >= numModes - 1) {
          this.arpeggioDirection = -1;
          this.arpeggioIndex = numModes - 1;
        } else if (this.arpeggioIndex <= 0) {
          this.arpeggioDirection = 1;
          this.arpeggioIndex = 0;
        }
        break;
        
      case ArpeggioPattern.DOWN_UP:
        this.arpeggioIndex -= this.arpeggioDirection;
        if (this.arpeggioIndex <= 0) {
          this.arpeggioDirection = -1;
          this.arpeggioIndex = 0;
        } else if (this.arpeggioIndex >= numModes - 1) {
          this.arpeggioDirection = 1;
          this.arpeggioIndex = numModes - 1;
        }
        break;
        
      case ArpeggioPattern.RANDOM:
        this.arpeggioIndex = Math.floor(Math.random() * numModes);
        break;
    }
  }
  
  /**
   * Trigger current arpeggio note
   */
  triggerArpeggioNote(velocity) {
    const mode = this.sortedModes[this.arpeggioIndex];
    if (!mode) return;
    
    const amplitudes = new Float32Array(this.mMax * this.mMax);
    
    if (this.arpeggioHold) {
      // In hold mode, keep previous notes ringing
      // Copy current state from audio engine (would need to track this)
      // For now, we just add the new note
    }
    
    const index = (mode.n - 1) * this.mMax + (mode.m - 1);
    const gain = this.calculateModeGain(mode, mode.amplitude || 1.0);
    amplitudes[index] = gain * velocity;
    
    // Trigger single mode
    this.audioEngine.exciteModes(amplitudes);
    
    if (this.onModeTriggered) {
      this.onModeTriggered([mode.gridIndex], 'arpeggio');
    }
  }
  
  /**
   * Stop current articulation
   */
  stop() {
    // Clear scheduled strum timeouts
    for (const id of this.scheduledTimeouts) {
      clearTimeout(id);
    }
    this.scheduledTimeouts = [];
    
    // Clear arpeggio interval
    if (this.arpeggioInterval) {
      clearInterval(this.arpeggioInterval);
      this.arpeggioInterval = null;
    }
    
    this.currentChord = null;
  }
  
  /**
   * Set articulation mode
   */
  setMode(mode) {
    this.mode = mode;
  }
  
  /**
   * Set strum/arpeggio direction
   */
  setDirection(direction) {
    this.direction = direction;
  }
  
  /**
   * Set strum time in ms
   */
  setStrumTime(ms) {
    this.strumTime = Math.max(0, Math.min(500, ms));
  }
  
  /**
   * Set strum curve type
   */
  setStrumCurve(curve) {
    this.strumCurve = curve;
  }
  
  /**
   * Set arpeggio rate in BPM
   */
  setArpeggioRate(bpm) {
    this.arpeggioRate = Math.max(30, Math.min(480, bpm));
    
    // If arpeggio is playing, restart with new rate
    if (this.arpeggioInterval && this.currentChord) {
      this.stop();
      this.playArpeggio(1.0);
    }
  }
  
  /**
   * Set arpeggio pattern
   */
  setArpeggioPattern(pattern) {
    this.arpeggioPattern = pattern;
  }
  
  /**
   * Set brightness (0 = warm, 1 = bright)
   */
  setBrightness(value) {
    this.brightness = Math.max(0, Math.min(1, value));
  }
  
  /**
   * Set velocity spread (humanization)
   */
  setVelocitySpread(value) {
    this.velocitySpread = Math.max(0, Math.min(1, value));
  }
  
  /**
   * Load preset articulation
   */
  loadPreset(name) {
    const presets = {
      'plucky': {
        mode: ArticulationMode.STRUM,
        strumTime: 50,
        direction: Direction.LOW_TO_HIGH,
        brightness: 0.75,
        strumCurve: 'exponential'
      },
      'soft': {
        mode: ArticulationMode.STRUM,
        strumTime: 300,
        direction: Direction.HIGH_TO_LOW,
        brightness: 0.25,
        strumCurve: 'log'
      },
      'strum-up': {
        mode: ArticulationMode.STRUM,
        strumTime: 180,
        direction: Direction.LOW_TO_HIGH,
        brightness: 0.5,
        strumCurve: 'linear'
      },
      'strum-down': {
        mode: ArticulationMode.STRUM,
        strumTime: 180,
        direction: Direction.HIGH_TO_LOW,
        brightness: 0.5,
        strumCurve: 'linear'
      },
      'arp-up': {
        mode: ArticulationMode.ARPEGGIO,
        arpeggioPattern: ArpeggioPattern.UP,
        arpeggioRate: 180,
        direction: Direction.LOW_TO_HIGH,
        brightness: 0.6
      },
      'arp-down': {
        mode: ArticulationMode.ARPEGGIO,
        arpeggioPattern: ArpeggioPattern.DOWN,
        arpeggioRate: 180,
        direction: Direction.LOW_TO_HIGH,
        brightness: 0.6
      },
      'arp-updown': {
        mode: ArticulationMode.ARPEGGIO,
        arpeggioPattern: ArpeggioPattern.UP_DOWN,
        arpeggioRate: 150,
        direction: Direction.LOW_TO_HIGH,
        brightness: 0.5
      },
      'scatter': {
        mode: ArticulationMode.STRUM,
        strumTime: 350,
        direction: Direction.RANDOM,
        brightness: 0.5,
        velocitySpread: 0.5,
        strumCurve: 'linear'
      },
      'instant': {
        mode: ArticulationMode.INSTANT,
        brightness: 0.5
      }
    };
    
    const preset = presets[name];
    if (preset) {
      if (preset.mode !== undefined) this.mode = preset.mode;
      if (preset.strumTime !== undefined) this.strumTime = preset.strumTime;
      if (preset.direction !== undefined) this.direction = preset.direction;
      if (preset.brightness !== undefined) this.brightness = preset.brightness;
      if (preset.strumCurve !== undefined) this.strumCurve = preset.strumCurve;
      if (preset.arpeggioPattern !== undefined) this.arpeggioPattern = preset.arpeggioPattern;
      if (preset.arpeggioRate !== undefined) this.arpeggioRate = preset.arpeggioRate;
      if (preset.velocitySpread !== undefined) this.velocitySpread = preset.velocitySpread;
    }
    
    return preset;
  }
  
  /**
   * Get list of available presets
   */
  static getPresetNames() {
    return ['instant', 'plucky', 'soft', 'strum-up', 'strum-down', 'arp-up', 'arp-down', 'arp-updown', 'scatter'];
  }
}
