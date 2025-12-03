# Modal Drum Synthesizer - Technical Documentation

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Audio System](#audio-system)
4. [Modal Physics](#modal-physics)
5. [Chord System](#chord-system)
6. [Articulation System](#articulation-system)
7. [Euclidean Sequencer](#euclidean-sequencer)
8. [WebGL Visualization](#webgl-visualization)
9. [User Interface](#user-interface)
10. [API Reference](#api-reference)

---

## Overview

The Modal Drum Synthesizer is a browser-based instrument that models the physics of a vibrating square membrane. Unlike sample-based drums, it synthesizes sound in real-time by simulating 36 individual vibrational modes, each with its own frequency and decay characteristics.

### Key Concepts

- **Modal Synthesis**: Sound is created by summing contributions from multiple resonant modes
- **Square Membrane Physics**: Mode frequencies follow the 2D wave equation for a fixed boundary
- **Real-time Processing**: Audio runs in an AudioWorklet at native sample rate
- **GPU Visualization**: Height field computed entirely in vertex shader

---

## Architecture

### File Structure

```
src/
├── main.js              # Application entry point, event handling
├── audio-engine.js      # AudioContext, effects chain, worklet communication
├── audio-worklet.js     # Real-time DSP (runs in audio thread)
├── modes.js             # Mode calculations, physics formulas
├── modal-harmony.js     # Chord theory, presets, classifications
├── chord-articulator.js # Strum and arpeggio articulation
├── euclidean-sequencer.js # Bjorklund rhythm algorithm
├── sequencer.js         # Legacy step sequencer
└── webgl-renderer.js    # GPU-based 3D rendering
```

### Data Flow

```
User Input → main.js → audio-engine.js → AudioWorklet → Speakers
                ↓
         modal-harmony.js (chord selection)
                ↓
         chord-articulator.js (timing/articulation)
                ↓
         audio-worklet.js (synthesis)
                ↓
         webgl-renderer.js (visualization)
```

---

## Audio System

### AudioEngine (`audio-engine.js`)

The audio engine manages the WebAudio graph and effects processing.

#### Effects Chain

```
AudioWorklet → Dry Gain ────────────────────┬→ Master Gain → Destination
            → Wet Gain → Convolver (Reverb) ┘
```

#### Key Methods

```javascript
// Initialize audio system
async init()

// Strike membrane at position
excite(x, y, gain)

// Excite specific mode
exciteMode(m, n, gain)

// Set chord (array of mode amplitudes)
setChord(amplitudes, sustain)

// Add impulses to modes (for strum/arpeggio)
exciteModes(amplitudes)

// Reverb wet/dry mix (0-1)
setReverbMix(mix)

// Transient click amount (0-1)
setTransientAmount(amount)
```

#### Reverb Implementation

Synthetic impulse response generated procedurally:

```javascript
createReverbImpulse(decay = 2.0, duration = 3.0) {
  // Exponential decay envelope
  // Early reflections in first 100ms
  // Diffuse noise tail
}
```

#### Attack Transients

Short noise bursts for percussive attack:
- Duration: 15ms
- Bandpass filtered (2-3kHz)
- Fast attack, exponential decay envelope

### AudioWorklet (`audio-worklet.js`)

Real-time DSP running in dedicated audio thread.

#### Resonator Bank

Each of 36 modes is a 2nd-order IIR filter (biquad):

```javascript
// For each mode:
y[n] = b0*x[n] + a1*y[n-1] + a2*y[n-2]

// Coefficients from frequency and decay:
a1 = 2 * r * cos(2π * freq / sampleRate)
a2 = -r²
b0 = sin(2π * freq / sampleRate)

// Where r = exp(-π * freq / (Q * sampleRate))
```

#### Excitation Types

1. **Impulse** - Single-sample spike
2. **Sustained** - Continuous sinusoidal drive
3. **Position-based** - Amplitude weighted by mode shape at strike position

#### Message Types

| Type | Data | Description |
|------|------|-------------|
| `init` | Modal state | Initialize resonator bank |
| `excite` | x, y, gain | Strike at position |
| `exciteMode` | m, n, gain | Strike specific mode |
| `setChord` | amplitudes, sustain | Set all mode amplitudes |
| `exciteModes` | amplitudes | Add impulses to modes |
| `clearChord` | - | Fade out all modes |
| `setMic` | x, y | Update microphone position |
| `setGain` | gain | Master output gain |

---

## Modal Physics

### Frequency Formula

Square membrane modes follow:

```
f(m,n) = f₀/√2 × √(m² + n²)
```

| Mode | Ratio to (1,1) | Frequency (f₀=200Hz) |
|------|----------------|---------------------|
| (1,1) | 1.000 | 200 Hz |
| (1,2)/(2,1) | 1.581 | 316 Hz |
| (2,2) | 2.000 | 400 Hz |
| (1,3)/(3,1) | 2.236 | 447 Hz |
| (2,3)/(3,2) | 2.550 | 510 Hz |
| (3,3) | 3.000 | 600 Hz |

### Mode Shapes

Each mode has a characteristic vibration pattern:

```
φ(m,n)(x,y) = sin(mπx) × sin(nπy)
```

Where x,y ∈ [0,1] represent position on membrane.

### Nodal Lines

Mode (m,n) has:
- (m-1) vertical nodal lines at x = k/m
- (n-1) horizontal nodal lines at y = k/n

Nodal lines are positions of zero displacement - striking here won't excite that mode.

### Decay Model

Higher modes decay faster (frequency-dependent damping):

```
decay(m,n) = baseDecay / √(m² + n²)
```

---

## Chord System

### ChordPresets (`modal-harmony.js`)

Predefined mode combinations:

| Name | Modes | Character |
|------|-------|-----------|
| `fundamental` | (1,1) | Pure, simple |
| `diagonal` | (1,1), (2,2), (3,3), (4,4), (5,5) | Harmonic series |
| `horizontal` | (1,1), (2,1), (3,1), (4,1) | Bright, metallic |
| `vertical` | (1,1), (1,2), (1,3), (1,4) | Similar to horizontal |
| `cross` | (3,2), (2,3), (3,4), (4,3), (3,3) | Centered cluster |
| `square` | (2,2), (2,3), (3,2), (3,3) | Compact cluster |
| `diamond` | (3,1), (1,3), (5,3), (3,5), (3,3) | Symmetric, spread |
| `star` | (1,1), (1,5), (5,1), (5,5), (3,3) | Wide, complex |
| `spiral` | (1,1)→(3,3) spiral path | Sequential movement |
| `all_even` | All even-indexed modes | Octave relationships |
| `all_odd` | All odd-indexed modes | Dense partials |

### Chord Classification

Chords are analyzed for:

- **Type**: dyad (2 modes), triad (3 modes), cluster (4+ modes)
- **Geometry**: horizontal, vertical, diagonal, symmetric
- **Complexity**: based on average nodal lines
- **Symmetry class**: whether modes mirror across diagonal

### Voice Leading

Smooth transitions between chords by interpolating amplitudes:

```javascript
generateVoiceLeading(chord1, chord2, steps) {
  // Uses smoothstep easing
  // Interpolates mode amplitudes
  // Returns array of intermediate chords
}
```

---

## Articulation System

### ChordArticulator (`chord-articulator.js`)

Transforms instant chord triggers into time-spread note sequences.

#### Modes

1. **Instant** - All notes simultaneously
2. **Strum** - Notes spread over time (like guitar strum)
3. **Arpeggio** - Repeating cycle through notes

#### Strum Parameters

| Parameter | Range | Description |
|-----------|-------|-------------|
| `strumTime` | 10-500ms | Total spread duration |
| `direction` | LOW_TO_HIGH, HIGH_TO_LOW, etc. | Mode order |
| `curve` | LINEAR, EXPONENTIAL, LOG | Timing curve |
| `brightness` | 0-1 | Frequency-dependent gain |

#### Strum Timing Curves

```javascript
// Linear: even spacing
delay = i * strumTime / (numModes - 1)

// Exponential: accelerating
delay = strumTime * (exp(t * 2) - 1) / (exp(2) - 1)

// Logarithmic: decelerating  
delay = strumTime * log(1 + t * 9) / log(10)
```

#### Arpeggio Patterns

- **UP**: 0, 1, 2, 3, 0, 1, 2, 3...
- **DOWN**: 3, 2, 1, 0, 3, 2, 1, 0...
- **UP_DOWN**: 0, 1, 2, 3, 2, 1, 0, 1...
- **DOWN_UP**: 3, 2, 1, 0, 1, 2, 3, 2...
- **RANDOM**: Random index each step

---

## Euclidean Sequencer

### Algorithm (`euclidean-sequencer.js`)

Bjorklund's algorithm distributes K pulses across N steps as evenly as possible.

```javascript
bjorklund(steps, pulses) {
  // Bresenham-style distribution
  // Returns array of booleans
}
```

#### Examples

| Steps | Pulses | Pattern | Name |
|-------|--------|---------|------|
| 8 | 3 | X..X..X. | Tresillo |
| 8 | 5 | X.XX.XX. | Cinquillo |
| 16 | 5 | X..X..X..X..X... | Bossa nova |

### Chord Queue

The sequencer maintains a queue of chords:

```javascript
chordQueue = [
  { chord: {...}, name: "diagonal" },
  { chord: {...}, name: "cross" },
  ...
]
```

Each pulse advances to the next chord in queue (cycling).

### Transport

```javascript
start()      // Begin playback
stop()       // Stop playback
setTempo(bpm) // 40-200 BPM
setSteps(n)  // 1-32 steps
setPulses(k) // 1-steps pulses
setRotation(r) // Shift pattern start
```

---

## WebGL Visualization

### WebGLRenderer (`webgl-renderer.js`)

GPU-accelerated 3D membrane visualization.

#### Vertex Shader

All mode summation happens on GPU:

```glsl
// Precompute sin values for efficiency
float sx1 = sin(PI * uv.x);
float sx2 = sin(2.0 * PI * uv.x);
// ... for all 6 x values

float sy1 = sin(PI * uv.y);
// ... for all 6 y values

// Sum all 36 modes
height += uAmp[0] * sx1 * sy1;  // Mode (1,1)
height += uAmp[1] * sx1 * sy2;  // Mode (1,2)
// ... etc
```

#### Fragment Shader Lighting

Multi-source lighting for visibility:

1. **Hemisphere light** - Sky above, ground reflection below
2. **Key light** - Main directional light
3. **Fill light** - From camera direction
4. **Wrap lighting** - Extended diffuse for soft shadows
5. **Fresnel rim** - Edge highlighting

#### Color Mapping

Height-based color gradient:

| Height | Color |
|--------|-------|
| High positive | Coral/Orange |
| Medium positive | White |
| Low positive | Cyan |
| Zero | Slate blue |
| Low negative | Indigo |
| High negative | Purple/Magenta |

#### Amplitude Smoothing

Asymmetric rise/fall for natural motion:

```javascript
if (newAmp > smoothed) {
  smoothed += (newAmp - smoothed) * riseRate;  // Fast attack
} else {
  smoothed *= fallRate;  // Slow decay
}
```

---

## User Interface

### Control Sections

1. **Audio**
   - Gain (0-0.2)
   - Decay (0.5-5s)
   - Reverb (0-100%)
   - Transient (0-100%)

2. **Microphone Position**
   - X position (0.05-0.95)
   - Y position (0.05-0.95)

3. **Visualization**
   - Height scale (0.5-15)
   - Decay/smoothing (0.5-0.98)
   - Grid resolution (32-128)
   - Auto-rotate toggle

4. **Mode Grid**
   - 6×6 clickable grid
   - Shows frequency ratios
   - Highlights selected modes
   - Flashes on trigger

5. **Chord Palette**
   - 9 preset buttons
   - Keyboard shortcuts 1-9

6. **Articulation**
   - Mode selector (Instant/Strum/Arpeggio)
   - Strum time slider
   - Brightness control
   - Arpeggio rate
   - Direction selector

7. **Euclidean Sequencer**
   - Steps/Pulses/Rotation sliders
   - Tempo control
   - Visual step display
   - Chord queue management
   - Preset rhythms

---

## API Reference

### Main Application (`main.js`)

```javascript
class ModalDrumApp {
  // Lifecycle
  constructor()
  async start()
  
  // Audio control
  playChord(chord)
  playChordPreset(name)
  shiftChord(dm, dn)
  replayCurrentChord()
  
  // Mode selection
  toggleMode(m, n)
  clearModes()
  playSelectedModes()
  
  // Sequencer
  startEuclidean()
  stopEuclidean()
  addChordToQueue()
  clearChordQueue()
  
  // UI
  flashModeCell(index)
  updateModeGridHighlight()
  setStatus(message)
}
```

### AudioEngine

```javascript
class AudioEngine {
  async init()
  excite(x, y, gain)
  exciteMode(m, n, gain)
  exciteModes(amplitudes)
  setChord(amplitudes, sustain)
  clearChord()
  setMicPosition(x, y)
  setGain(gain)
  setReverbMix(mix)
  setTransientAmount(amount)
  playTransient(intensity)
}
```

### ChordArticulator

```javascript
class ChordArticulator {
  constructor(audioEngine, mMax)
  
  setMode(mode)           // 'instant' | 'strum' | 'arpeggio'
  setStrumTime(ms)        // 10-500
  setDirection(dir)       // Direction enum
  setBrightness(val)      // 0-1
  setArpeggioRate(bpm)    // 60-480
  setArpeggioPattern(pat) // ArpeggioPattern enum
  
  playChord(chord, velocity)
  stop()
}
```

### EuclideanSequencer

```javascript
class EuclideanSequencer {
  constructor()
  
  setSteps(n)
  setPulses(k)
  setRotation(r)
  setTempo(bpm)
  
  start(callback)
  stop()
  
  getPattern()
  loadPreset(name)
}
```

### WebGLRenderer

```javascript
class WebGLRenderer {
  constructor(canvas, gridSize, mMax, nMax)
  
  setAmplitudes(ampArray)
  setGridSize(size)
  resize()
  render(time)
  
  // Properties
  heightScale     // Wave height multiplier
  riseRate        // Amplitude attack speed
  fallRate        // Amplitude decay speed
  autoRotate      // Enable/disable rotation
  autoRotateSpeed // Rotation speed
}
```

---

## Performance Considerations

### Audio Thread

- AudioWorklet runs at audio sample rate (44.1/48kHz)
- 36 IIR filters = ~200 multiplies per sample
- Total: ~9M operations/second at 48kHz
- Well within single-core budget

### GPU

- Vertex shader: 36 mode evaluations per vertex
- At 128×128 grid: ~590K mode evaluations per frame
- All parallel on GPU - typically <1ms

### Main Thread

- Amplitude messages: ~344/second (every 128 samples)
- Smooth animations via requestAnimationFrame
- Event handling only

### Memory

- Float32Array for amplitudes: 36 × 4 = 144 bytes
- WebGL buffers: ~500KB at 128×128 grid
- Convolver impulse: ~1MB (stereo, 3 seconds)

---

## Future Enhancements

See [OPTIMIZATIONS.md](OPTIMIZATIONS.md) for planned improvements:

- SharedArrayBuffer for zero-copy audio↔visual sync
- Circular membrane support (Bessel functions)
- MIDI input
- Recording/export
- More effect types
- VR/AR support
