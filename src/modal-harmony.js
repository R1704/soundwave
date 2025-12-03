/**
 * Modal Harmonic System
 * 
 * A music theory of eigenmodes where:
 * - Notes = modes (m,n)
 * - Chords = mode sets with geometric meaning
 * - Harmony = structure of modal adjacency on the lattice
 * - Voice-leading = trajectories in modal amplitude space
 * - Timbre = spatial complexity
 * - Pitch = secondary feature
 */

const sqrt2 = Math.sqrt(2);

/**
 * Calculate mode frequency
 * f_{m,n} = f₀ · √(m² + n²) / √2
 */
export function modeFrequency(m, n, f0 = 200) {
  return f0 * Math.sqrt(m * m + n * n) / sqrt2;
}

/**
 * Mode identity - the fundamental "note" in this system
 */
export function createMode(m, n, f0 = 200) {
  const freq = modeFrequency(m, n, f0);
  return {
    m, n, freq,
    // Symmetry properties
    parity: [(m % 2), (n % 2)],           // [even/odd, even/odd]
    diagonal: m === n,                     // on main diagonal
    antiDiagonal: false,                   // would need rectangular membrane
    sum: m + n,                            // "complexity" measure
    // Spatial properties
    nodalLines: (m - 1) + (n - 1),        // total nodal lines
    horizontalNodes: m - 1,
    verticalNodes: n - 1,
  };
}

// ═══════════════════════════════════════════════════════════════════
// MODAL DISTANCE METRICS
// ═══════════════════════════════════════════════════════════════════

/**
 * Frequency distance (in Hz)
 */
export function frequencyDistance(mode1, mode2) {
  return Math.abs(mode1.freq - mode2.freq);
}

/**
 * Frequency ratio (for harmonic relationships)
 */
export function frequencyRatio(mode1, mode2) {
  const [lo, hi] = mode1.freq < mode2.freq ? [mode1, mode2] : [mode2, mode1];
  return hi.freq / lo.freq;
}

/**
 * Topological distance - Manhattan distance on mode lattice
 * D_topo = |m₁ - m₂| + |n₁ - n₂|
 */
export function topologicalDistance(mode1, mode2) {
  return Math.abs(mode1.m - mode2.m) + Math.abs(mode1.n - mode2.n);
}

/**
 * Euclidean distance on mode lattice
 */
export function latticeDistance(mode1, mode2) {
  const dm = mode1.m - mode2.m;
  const dn = mode1.n - mode2.n;
  return Math.sqrt(dm * dm + dn * dn);
}

/**
 * Symmetry distance - how different are the symmetry properties?
 * Returns 0 for same symmetry class, higher for different
 */
export function symmetryDistance(mode1, mode2) {
  let d = 0;
  // Parity mismatch
  if (mode1.parity[0] !== mode2.parity[0]) d += 1;
  if (mode1.parity[1] !== mode2.parity[1]) d += 1;
  // Diagonal mismatch
  if (mode1.diagonal !== mode2.diagonal) d += 0.5;
  return d;
}

/**
 * Nodal complexity distance
 */
export function nodalDistance(mode1, mode2) {
  return Math.abs(mode1.nodalLines - mode2.nodalLines);
}

/**
 * Combined modal distance with weights
 */
export function modalDistance(mode1, mode2, weights = {}) {
  const w = {
    topo: 1.0,
    symmetry: 0.5,
    nodal: 0.3,
    freq: 0.001,  // Small weight since freq scale is large
    ...weights
  };
  
  return (
    w.topo * topologicalDistance(mode1, mode2) +
    w.symmetry * symmetryDistance(mode1, mode2) +
    w.nodal * nodalDistance(mode1, mode2) +
    w.freq * frequencyDistance(mode1, mode2)
  );
}

// ═══════════════════════════════════════════════════════════════════
// MODAL CONSONANCE
// ═══════════════════════════════════════════════════════════════════

/**
 * Consonance score between two modes (higher = more consonant)
 * Based on:
 * - Frequency ratio simplicity
 * - Symmetry alignment
 * - Pattern similarity
 */
export function consonance(mode1, mode2) {
  // Same mode = perfect unison
  if (mode1.m === mode2.m && mode1.n === mode2.n) return 1.0;
  
  let score = 0;
  
  // 1. Frequency ratio simplicity (like just intonation)
  const ratio = frequencyRatio(mode1, mode2);
  // Check for simple ratios
  const simpleRatios = [1, 2, 1.5, 4/3, 5/4, 6/5, 5/3, 8/5];
  const tolerance = 0.05;
  for (const r of simpleRatios) {
    if (Math.abs(ratio - r) < tolerance || Math.abs(ratio - 1/r) < tolerance) {
      score += 0.3;
      break;
    }
  }
  
  // 2. Same symmetry class = aligned patterns
  if (mode1.parity[0] === mode2.parity[0] && mode1.parity[1] === mode2.parity[1]) {
    score += 0.3;
  }
  
  // 3. Diagonal relationship (same m-n difference)
  if ((mode1.m - mode1.n) === (mode2.m - mode2.n)) {
    score += 0.2;
  }
  
  // 4. Adjacent on lattice = smooth spatial transition
  const topo = topologicalDistance(mode1, mode2);
  if (topo === 1) score += 0.2;
  else if (topo === 2) score += 0.1;
  
  return Math.min(1.0, score);
}

// ═══════════════════════════════════════════════════════════════════
// MODAL INTERVALS
// ═══════════════════════════════════════════════════════════════════

/**
 * Named modal intervals based on lattice movement
 */
export const ModalIntervals = {
  // Unison
  unison: [0, 0],
  
  // Adjacent steps
  horizontalStep: [1, 0],
  verticalStep: [0, 1],
  
  // Diagonal movements
  diagonalAscent: [1, 1],      // "modal fifth" - symmetric growth
  diagonalDescent: [-1, -1],
  
  // Anti-diagonal
  shear: [1, -1],              // change direction, preserve complexity
  antiShear: [-1, 1],
  
  // Larger leaps
  horizontalLeap: [2, 0],
  verticalLeap: [0, 2],
  doubleAscent: [2, 2],        // "modal octave"
  
  // Named by character
  brighten: [1, 0],            // more horizontal nodes
  deepen: [0, 1],              // more vertical nodes
  complexify: [1, 1],          // both
  simplify: [-1, -1],          // reduce both
};

/**
 * Apply interval to a mode, clamped to valid range
 */
export function applyInterval(mode, interval, mMax = 4, nMax = 4) {
  const newM = Math.max(1, Math.min(mMax, mode.m + interval[0]));
  const newN = Math.max(1, Math.min(nMax, mode.n + interval[1]));
  return createMode(newM, newN, mode.freq * sqrt2 / Math.sqrt(mode.m * mode.m + mode.n * mode.n) * Math.sqrt(mMax)); // preserve f0
}

// ═══════════════════════════════════════════════════════════════════
// MODAL CHORDS
// ═══════════════════════════════════════════════════════════════════

/**
 * A modal chord is a set of mode indices with amplitudes
 * C = {(m₁,n₁,A₁), (m₂,n₂,A₂), ...}
 */
export function createChord(modeIndices, f0 = 200) {
  const modes = modeIndices.map(([m, n, amp = 1.0]) => ({
    ...createMode(m, n, f0),
    amplitude: amp
  }));
  
  return {
    modes,
    // Chord properties
    get complexity() {
      return modes.reduce((sum, m) => sum + m.nodalLines * m.amplitude, 0);
    },
    get centroid() {
      // Amplitude-weighted center of mass on lattice
      let totalAmp = 0, mSum = 0, nSum = 0;
      for (const m of modes) {
        totalAmp += m.amplitude;
        mSum += m.m * m.amplitude;
        nSum += m.n * m.amplitude;
      }
      return totalAmp > 0 ? [mSum / totalAmp, nSum / totalAmp] : [0, 0];
    },
    get symmetryClass() {
      // Dominant parity
      let ee = 0, eo = 0, oe = 0, oo = 0;
      for (const m of modes) {
        const p = m.parity[0] * 2 + m.parity[1];
        if (p === 0) ee += m.amplitude;
        else if (p === 1) eo += m.amplitude;
        else if (p === 2) oe += m.amplitude;
        else oo += m.amplitude;
      }
      const max = Math.max(ee, eo, oe, oo);
      if (max === ee) return 'even-even';
      if (max === eo) return 'even-odd';
      if (max === oe) return 'odd-even';
      return 'odd-odd';
    },
    get frequencySpread() {
      if (modes.length < 2) return 0;
      const freqs = modes.map(m => m.freq);
      return Math.max(...freqs) - Math.min(...freqs);
    }
  };
}

/**
 * Preset chord shapes - named by their geometric character
 * Now expanded for 6×6 grid
 */
export const ChordPresets = {
  // Simple shapes
  fundamental: [[1, 1]],
  horizontal: [[1, 1], [2, 1], [3, 1], [4, 1]],
  vertical: [[1, 1], [1, 2], [1, 3], [1, 4]],
  diagonal: [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]],
  
  // Symmetric shapes (centered more)
  cross: [[3, 2], [2, 3], [3, 4], [4, 3], [3, 3]],
  square: [[2, 2], [2, 3], [3, 2], [3, 3]],
  diamond: [[3, 1], [1, 3], [5, 3], [3, 5], [3, 3]],
  
  // Complex shapes spanning the grid
  star: [[1, 1], [1, 5], [5, 1], [5, 5], [3, 3]],
  grid: [[1, 1], [1, 6], [6, 1], [6, 6]],
  full: [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]],
  
  // Asymmetric / tension shapes
  lean_right: [[1, 1], [2, 1], [3, 2], [4, 3], [5, 4]],
  lean_left: [[1, 1], [1, 2], [2, 3], [3, 4], [4, 5]],
  
  // Large symmetric patterns
  all_even: [[2, 2], [2, 4], [4, 2], [4, 4], [2, 6], [6, 2], [4, 6], [6, 4], [6, 6]],
  all_odd: [[1, 1], [1, 3], [3, 1], [3, 3], [1, 5], [5, 1], [3, 5], [5, 3], [5, 5]],
  mixed: [[1, 1], [2, 2], [3, 3], [1, 3], [3, 1], [2, 4], [4, 2]],
  
  // Musical intervals (spaced for harmonic relationships)
  octave_like: [[1, 1], [2, 2], [4, 4]],            // √2 frequency ratios
  fifth_like: [[1, 1], [2, 1], [1, 2], [3, 2]],    // Approximating 3:2
  
  // Edge patterns
  perimeter: [[1, 1], [1, 3], [1, 6], [3, 6], [6, 6], [6, 3], [6, 1], [3, 1]],
  spiral: [[1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2]],
};

/**
 * Get chord preset by name
 */
export function getChordPreset(name, f0 = 200) {
  const indices = ChordPresets[name];
  if (!indices) return null;
  return createChord(indices.map(([m, n]) => [m, n, 1.0]), f0);
}

// ═══════════════════════════════════════════════════════════════════
// VOICE LEADING
// ═══════════════════════════════════════════════════════════════════

/**
 * Calculate voice leading smoothness between two chords
 * Lower = smoother transition
 */
export function voiceLeadingSmoothness(chord1, chord2) {
  // Sum of amplitude changes across all modes
  const allModes = new Map();
  
  for (const m of chord1.modes) {
    const key = `${m.m},${m.n}`;
    allModes.set(key, { m: m.m, n: m.n, amp1: m.amplitude, amp2: 0 });
  }
  
  for (const m of chord2.modes) {
    const key = `${m.m},${m.n}`;
    if (allModes.has(key)) {
      allModes.get(key).amp2 = m.amplitude;
    } else {
      allModes.set(key, { m: m.m, n: m.n, amp1: 0, amp2: m.amplitude });
    }
  }
  
  let totalChange = 0;
  for (const [, data] of allModes) {
    totalChange += Math.abs(data.amp2 - data.amp1);
  }
  
  return totalChange;
}

/**
 * Generate smooth voice leading path between two chords
 * Returns array of intermediate chord states
 */
export function generateVoiceLeading(chord1, chord2, steps = 10, f0 = 200) {
  const path = [];
  
  // Collect all modes from both chords
  const allModes = new Map();
  for (const m of chord1.modes) {
    allModes.set(`${m.m},${m.n}`, { m: m.m, n: m.n, amp1: m.amplitude, amp2: 0 });
  }
  for (const m of chord2.modes) {
    const key = `${m.m},${m.n}`;
    if (allModes.has(key)) {
      allModes.get(key).amp2 = m.amplitude;
    } else {
      allModes.set(key, { m: m.m, n: m.n, amp1: 0, amp2: m.amplitude });
    }
  }
  
  // Generate interpolated chords
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Use smooth easing
    const ease = t * t * (3 - 2 * t); // smoothstep
    
    const indices = [];
    for (const [, data] of allModes) {
      const amp = data.amp1 * (1 - ease) + data.amp2 * ease;
      if (amp > 0.01) {
        indices.push([data.m, data.n, amp]);
      }
    }
    
    path.push(createChord(indices, f0));
  }
  
  return path;
}

/**
 * Find the smoothest voice leading to a target chord
 * from a set of possible source chords
 */
export function findSmoothestPath(sourceChords, targetChord) {
  let best = null;
  let bestSmoothness = Infinity;
  
  for (const source of sourceChords) {
    const s = voiceLeadingSmoothness(source, targetChord);
    if (s < bestSmoothness) {
      bestSmoothness = s;
      best = source;
    }
  }
  
  return { source: best, smoothness: bestSmoothness };
}

// ═══════════════════════════════════════════════════════════════════
// CHORD CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Classify a chord by its geometric properties
 */
export function classifyChord(chord) {
  const modes = chord.modes;
  if (modes.length === 0) return { type: 'silence' };
  if (modes.length === 1) return { type: 'single', character: 'pure' };
  
  // Check for patterns
  const ms = modes.map(m => m.m);
  const ns = modes.map(m => m.n);
  
  const allSameM = ms.every(m => m === ms[0]);
  const allSameN = ns.every(n => n === ns[0]);
  const isDiagonal = modes.every(m => m.m === m.n);
  const isSymmetric = modes.length >= 2 && 
    modes.every(m => modes.some(m2 => m2.m === m.n && m2.n === m.m));
  
  // Nodal complexity
  const totalNodes = modes.reduce((s, m) => s + m.nodalLines, 0);
  const avgNodes = totalNodes / modes.length;
  
  return {
    type: modes.length === 2 ? 'dyad' : modes.length === 3 ? 'triad' : 'cluster',
    isHorizontal: allSameN,
    isVertical: allSameM,
    isDiagonal,
    isSymmetric,
    complexity: avgNodes < 2 ? 'simple' : avgNodes < 4 ? 'moderate' : 'complex',
    symmetryClass: chord.symmetryClass,
    spread: chord.frequencySpread,
  };
}

// ═══════════════════════════════════════════════════════════════════
// MODAL SCALES / PROGRESSIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * A modal scale is a subset of the mode lattice that forms a coherent set
 */
export const ModalScales = {
  // All modes on main diagonal
  diagonal: (mMax) => {
    const modes = [];
    for (let i = 1; i <= mMax; i++) modes.push([i, i]);
    return modes;
  },
  
  // L-shaped: fundamental row + column
  ell: (mMax) => {
    const modes = [[1, 1]];
    for (let i = 2; i <= mMax; i++) {
      modes.push([i, 1]);
      modes.push([1, i]);
    }
    return modes;
  },
  
  // All modes with same parity
  evenEven: (mMax) => {
    const modes = [];
    for (let m = 2; m <= mMax; m += 2) {
      for (let n = 2; n <= mMax; n += 2) {
        modes.push([m, n]);
      }
    }
    return modes;
  },
  
  oddOdd: (mMax) => {
    const modes = [];
    for (let m = 1; m <= mMax; m += 2) {
      for (let n = 1; n <= mMax; n += 2) {
        modes.push([m, n]);
      }
    }
    return modes;
  },
  
  // Modes below complexity threshold
  simple: (mMax, maxNodes = 3) => {
    const modes = [];
    for (let m = 1; m <= mMax; m++) {
      for (let n = 1; n <= mMax; n++) {
        if ((m - 1) + (n - 1) <= maxNodes) {
          modes.push([m, n]);
        }
      }
    }
    return modes;
  },
};

/**
 * A chord progression in modal space
 */
export function createProgression(chordNames, f0 = 200) {
  return chordNames.map(name => getChordPreset(name, f0)).filter(Boolean);
}

/**
 * Generate a progression with smooth voice leading
 */
export function generateSmoothProgression(chords, stepsPerChord = 10, f0 = 200) {
  const fullPath = [];
  
  for (let i = 0; i < chords.length - 1; i++) {
    const path = generateVoiceLeading(chords[i], chords[i + 1], stepsPerChord, f0);
    // Don't duplicate the last step (it's the first of next segment)
    fullPath.push(...path.slice(0, -1));
  }
  // Add final chord
  fullPath.push(chords[chords.length - 1]);
  
  return fullPath;
}

// ═══════════════════════════════════════════════════════════════════
// UTILITY: Convert chord to audio engine format
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert a chord to amplitude array for audio engine
 * @param {object} chord - Chord from createChord
 * @param {number} mMax - Max m index
 * @param {number} nMax - Max n index  
 * @returns {Float32Array} Amplitude for each mode [0..mMax*nMax-1]
 */
export function chordToAmplitudes(chord, mMax = 4, nMax = 4) {
  const amps = new Float32Array(mMax * nMax);
  
  for (const mode of chord.modes) {
    if (mode.m >= 1 && mode.m <= mMax && mode.n >= 1 && mode.n <= nMax) {
      const idx = (mode.n - 1) * mMax + (mode.m - 1);
      amps[idx] = mode.amplitude;
    }
  }
  
  return amps;
}

/**
 * Convert amplitude array back to chord
 */
export function amplitudesToChord(amps, mMax = 4, nMax = 4, f0 = 200, threshold = 0.01) {
  const indices = [];
  
  for (let n = 1; n <= nMax; n++) {
    for (let m = 1; m <= mMax; m++) {
      const idx = (n - 1) * mMax + (m - 1);
      if (amps[idx] > threshold) {
        indices.push([m, n, amps[idx]]);
      }
    }
  }
  
  return createChord(indices, f0);
}

// ═══════════════════════════════════════════════════════════════════
// MODAL SCALES - Subsets of the mode lattice with musical character
// ═══════════════════════════════════════════════════════════════════

/**
 * Scale definitions - each returns array of [m,n] pairs
 * Scales constrain which modes are "in key"
 */
export const ScaleDefinitions = {
  // Full chromatic - all modes
  chromatic: (mMax = 6) => {
    const modes = [];
    for (let n = 1; n <= mMax; n++) {
      for (let m = 1; m <= mMax; m++) {
        modes.push([m, n]);
      }
    }
    return modes;
  },
  
  // Diagonal scale - fundamental harmonics (m=n)
  diagonal: (mMax = 6) => {
    const modes = [];
    for (let i = 1; i <= mMax; i++) {
      modes.push([i, i]);
    }
    return modes;
  },
  
  // Pentatonic - 5 most consonant modes (low complexity, good symmetry)
  pentatonic: () => [[1,1], [1,2], [2,1], [2,2], [3,3]],
  
  // L-shape - fundamental row and column (like a musical "key")
  ell: (mMax = 6) => {
    const modes = [[1, 1]];
    for (let i = 2; i <= mMax; i++) {
      modes.push([i, 1]);
      modes.push([1, i]);
    }
    return modes;
  },
  
  // Symmetric - modes where m=n or one step away
  symmetric: (mMax = 6) => {
    const modes = [];
    for (let i = 1; i <= mMax; i++) {
      modes.push([i, i]);
      if (i < mMax) {
        modes.push([i, i + 1]);
        modes.push([i + 1, i]);
      }
    }
    return modes;
  },
  
  // Odd-only - creates specific interference patterns
  oddOnly: (mMax = 6) => {
    const modes = [];
    for (let m = 1; m <= mMax; m += 2) {
      for (let n = 1; n <= mMax; n += 2) {
        modes.push([m, n]);
      }
    }
    return modes;
  },
  
  // Even-only - different spatial character
  evenOnly: (mMax = 6) => {
    const modes = [];
    for (let m = 2; m <= mMax; m += 2) {
      for (let n = 2; n <= mMax; n += 2) {
        modes.push([m, n]);
      }
    }
    return modes;
  },
  
  // Simple - low nodal complexity (≤3 total nodal lines)
  simple: (mMax = 6, maxNodes = 3) => {
    const modes = [];
    for (let m = 1; m <= mMax; m++) {
      for (let n = 1; n <= mMax; n++) {
        if ((m - 1) + (n - 1) <= maxNodes) {
          modes.push([m, n]);
        }
      }
    }
    return modes;
  },
  
  // Complex - high nodal complexity (≥4 nodal lines)
  complex: (mMax = 6) => {
    const modes = [];
    for (let m = 1; m <= mMax; m++) {
      for (let n = 1; n <= mMax; n++) {
        if ((m - 1) + (n - 1) >= 4) {
          modes.push([m, n]);
        }
      }
    }
    return modes;
  },
  
  // Horizontal - fixed n, varying m (one "row")
  horizontal: (n = 1, mMax = 6) => {
    const modes = [];
    for (let m = 1; m <= mMax; m++) {
      modes.push([m, n]);
    }
    return modes;
  },
  
  // Vertical - fixed m, varying n (one "column")
  vertical: (m = 1, mMax = 6) => {
    const modes = [];
    for (let n = 1; n <= mMax; n++) {
      modes.push([m, n]);
    }
    return modes;
  },
  
  // Harmonic series approximation - modes closest to integer frequency ratios
  harmonic: (f0 = 200, mMax = 6) => {
    const modes = [];
    const harmonics = [1, 2, 3, 4, 5, 6, 7, 8];
    
    for (const h of harmonics) {
      const targetFreq = f0 * h;
      let best = null;
      let bestDiff = Infinity;
      
      for (let m = 1; m <= mMax; m++) {
        for (let n = 1; n <= mMax; n++) {
          const freq = modeFrequency(m, n, f0);
          const diff = Math.abs(freq - targetFreq);
          if (diff < bestDiff && diff < targetFreq * 0.1) {
            bestDiff = diff;
            best = [m, n];
          }
        }
      }
      
      if (best && !modes.some(([m, n]) => m === best[0] && n === best[1])) {
        modes.push(best);
      }
    }
    
    return modes;
  },
  
  // Inharmonic - modes that avoid simple frequency ratios
  inharmonic: (f0 = 200, mMax = 6) => {
    const harmonic = ScaleDefinitions.harmonic(f0, mMax);
    const harmonicSet = new Set(harmonic.map(([m, n]) => `${m},${n}`));
    
    const modes = [];
    for (let m = 1; m <= mMax; m++) {
      for (let n = 1; n <= mMax; n++) {
        if (!harmonicSet.has(`${m},${n}`)) {
          modes.push([m, n]);
        }
      }
    }
    return modes;
  },
};

/**
 * Create a Scale object with helper methods
 */
export function createScale(name, mMax = 6, f0 = 200) {
  const generator = ScaleDefinitions[name];
  if (!generator) return null;
  
  const modeIndices = generator(mMax, f0);
  const modeSet = new Set(modeIndices.map(([m, n]) => `${m},${n}`));
  
  return {
    name,
    modes: modeIndices.map(([m, n]) => createMode(m, n, f0)),
    modeIndices,
    
    // Check if a mode is in this scale
    contains(m, n) {
      return modeSet.has(`${m},${n}`);
    },
    
    // Get the nearest scale tone to an arbitrary mode
    nearest(m, n) {
      let best = modeIndices[0];
      let bestDist = Infinity;
      
      for (const [sm, sn] of modeIndices) {
        const dist = Math.abs(sm - m) + Math.abs(sn - n);
        if (dist < bestDist) {
          bestDist = dist;
          best = [sm, sn];
        }
      }
      
      return best;
    },
    
    // Filter a chord to only include scale tones
    filterChord(chord) {
      const filtered = chord.modes.filter(mode => this.contains(mode.m, mode.n));
      return createChord(filtered.map(m => [m.m, m.n, m.amplitude]), f0);
    },
    
    // Get random mode from scale
    random() {
      const idx = Math.floor(Math.random() * modeIndices.length);
      return modeIndices[idx];
    },
    
    // Get modes sorted by frequency
    byFrequency() {
      return [...this.modes].sort((a, b) => a.freq - b.freq);
    }
  };
}

/**
 * Get scale info for UI display
 */
export function getScaleInfo() {
  return [
    { name: 'chromatic', label: 'Chromatic (all)', description: 'All 36 modes' },
    { name: 'pentatonic', label: 'Pentatonic', description: '5 most consonant modes' },
    { name: 'diagonal', label: 'Diagonal', description: 'Modes where m=n' },
    { name: 'ell', label: 'L-Shape', description: 'First row and column' },
    { name: 'symmetric', label: 'Symmetric', description: 'Near-diagonal modes' },
    { name: 'oddOnly', label: 'Odd Only', description: 'Odd m and n values' },
    { name: 'evenOnly', label: 'Even Only', description: 'Even m and n values' },
    { name: 'simple', label: 'Simple', description: '≤3 nodal lines' },
    { name: 'complex', label: 'Complex', description: '≥4 nodal lines' },
    { name: 'harmonic', label: 'Harmonic', description: 'Near integer ratios' },
    { name: 'inharmonic', label: 'Inharmonic', description: 'Avoids simple ratios' },
  ];
}
