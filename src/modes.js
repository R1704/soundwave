/**
 * Modal synthesis data structures for a square membrane
 * 
 * Square membrane with fixed edges on unit square [0,1]×[0,1]
 * Mode shapes: φ_{m,n}(x,y) = sin(mπx)·sin(nπy)
 * Frequencies: f_{m,n} = f₀ · √(m² + n²) / √2
 */

/**
 * Create the modal data structure for all modes
 * @param {number} mMax - Maximum m index (1 to mMax)
 * @param {number} nMax - Maximum n index (1 to nMax)
 * @param {number} f0 - Fundamental frequency (1,1) mode in Hz
 * @param {number} sampleRate - Audio sample rate
 * @param {number} decayBase - Base decay time in seconds for (1,1) mode
 * @param {number} gridX - Visual grid resolution X
 * @param {number} gridY - Visual grid resolution Y
 * @returns {object} Modal synthesis state
 */
export function createModes(mMax, nMax, f0, sampleRate, decayBase = 2.0, gridX = 64, gridY = 64) {
  const modes = [];
  const dt = 1.0 / sampleRate;
  const sqrt2 = Math.sqrt(2);

  for (let m = 1; m <= mMax; m++) {
    for (let n = 1; n <= nMax; n++) {
      // Frequency: f_{m,n} = f₀ · √(m² + n²) / √2
      const freq = f0 * Math.sqrt(m * m + n * n) / sqrt2;

      // Higher modes decay faster (realistic damping)
      // decay time ∝ 1/frequency
      const decayTime = decayBase * f0 / freq;

      // Resonator coefficients
      // R = exp(-1/(decayTime * sampleRate)) per sample
      // For decay envelope: amplitude = exp(-t/decayTime)
      const R = Math.exp(-dt / decayTime);
      const omega = 2 * Math.PI * freq / sampleRate;
      const Rcos = R * Math.cos(omega);
      const R2 = R * R;

      // Precompute mode shape on visual grid
      const phi = new Float32Array(gridX * gridY);
      for (let iy = 0; iy < gridY; iy++) {
        const y = iy / (gridY - 1);
        for (let ix = 0; ix < gridX; ix++) {
          const x = ix / (gridX - 1);
          phi[iy * gridX + ix] = Math.sin(m * Math.PI * x) * Math.sin(n * Math.PI * y);
        }
      }

      modes.push({
        m,
        n,
        freq,
        // Resonator coefficients
        R,
        Rcos,
        R2,
        omega,
        // Resonator state (y[n-1], y[n-2])
        y1: 0,
        y2: 0,
        // Input gain
        g: 1.0,
        // Mic gain (set by setMicPosition)
        micGain: 0,
        // Pending impulse from click
        pendingPulse: 0,
        // Precomputed mode shape grid
        phi,
        // For amplitude readback to visuals
        currentAmplitude: 0
      });
    }
  }

  return {
    modes,
    mMax,
    nMax,
    f0,
    sampleRate,
    gridX,
    gridY,
    // Height field for visual reconstruction
    height: new Float32Array(gridX * gridY)
  };
}

/**
 * Set microphone position - determines which modes contribute to output
 * @param {object} state - Modal state from createModes
 * @param {number} x - X position [0,1]
 * @param {number} y - Y position [0,1]
 */
export function setMicPosition(state, x, y) {
  for (const mode of state.modes) {
    mode.micGain = Math.sin(mode.m * Math.PI * x) * Math.sin(mode.n * Math.PI * y);
  }
}

/**
 * Excite modes from a click/strike at position (x, y)
 * @param {object} state - Modal state from createModes
 * @param {number} x - X position [0,1]
 * @param {number} y - Y position [0,1]
 * @param {number} gain - Click intensity
 */
export function exciteModes(state, x, y, gain = 1.0) {
  for (const mode of state.modes) {
    // Impulse amplitude = mode shape value at click position
    const phi = Math.sin(mode.m * Math.PI * x) * Math.sin(mode.n * Math.PI * y);
    mode.pendingPulse += gain * phi;
  }
}

/**
 * Process one audio sample through all resonators
 * @param {object} state - Modal state from createModes
 * @returns {number} Output sample
 */
export function processAudioSample(state) {
  let out = 0;

  for (const mode of state.modes) {
    // 2nd-order IIR resonator:
    // y[n] = 2·R·cos(ω)·y[n-1] - R²·y[n-2] + g·x[n]
    const x_in = mode.pendingPulse;
    const y_new = 2 * mode.Rcos * mode.y1 - mode.R2 * mode.y2 + mode.g * x_in;

    mode.y2 = mode.y1;
    mode.y1 = y_new;
    mode.pendingPulse = 0;

    // Store for visual readback
    mode.currentAmplitude = y_new;

    // Mix to output weighted by mic position
    out += mode.micGain * y_new;
  }

  return out;
}

/**
 * Process a block of audio samples
 * @param {object} state - Modal state from createModes
 * @param {Float32Array} output - Output buffer to fill
 */
export function processAudioBlock(state, output) {
  for (let i = 0; i < output.length; i++) {
    output[i] = processAudioSample(state);
  }
}

/**
 * Reconstruct height field from current modal amplitudes
 * @param {object} state - Modal state from createModes
 * @returns {Float32Array} Height field (gridX × gridY)
 */
export function updateHeightField(state) {
  const { modes, height, gridX, gridY } = state;
  const len = gridX * gridY;

  // Clear height field
  for (let i = 0; i < len; i++) {
    height[i] = 0;
  }

  // Sum mode contributions: u(x,y) = Σ y_{m,n} · φ_{m,n}(x,y)
  for (const mode of modes) {
    const amp = mode.currentAmplitude;
    const phi = mode.phi;
    for (let i = 0; i < len; i++) {
      height[i] += amp * phi[i];
    }
  }

  return height;
}

/**
 * Get mode info for debugging/display
 * @param {object} state - Modal state from createModes
 * @returns {Array} Mode info array
 */
export function getModeInfo(state) {
  return state.modes.map(m => ({
    m: m.m,
    n: m.n,
    freq: m.freq.toFixed(1),
    amplitude: m.currentAmplitude.toFixed(4)
  }));
}

/**
 * Reset all resonator states (silence)
 * @param {object} state - Modal state from createModes
 */
export function resetModes(state) {
  for (const mode of state.modes) {
    mode.y1 = 0;
    mode.y2 = 0;
    mode.pendingPulse = 0;
    mode.currentAmplitude = 0;
  }
}

/**
 * Serialize state for transfer to AudioWorklet
 * @param {object} state - Modal state from createModes
 * @returns {object} Serializable mode data
 */
export function serializeForWorklet(state) {
  return {
    modes: state.modes.map(m => ({
      m: m.m,
      n: m.n,
      freq: m.freq,
      R: m.R,
      Rcos: m.Rcos,
      R2: m.R2,
      g: m.g,
      micGain: m.micGain
    })),
    mMax: state.mMax,
    nMax: state.nMax,
    f0: state.f0,
    sampleRate: state.sampleRate
  };
}
