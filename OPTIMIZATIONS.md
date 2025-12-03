# Modal Drum - Optimization & Extension Opportunities

## Current Architecture

```
index.html          - UI, controls, styling
src/
  modes.js          - Modal math, data structures, height field reconstruction
  audio-worklet.js  - Real-time audio processing (resonator bank)
  audio-engine.js   - AudioContext management, worklet communication
  webgl-renderer.js - 3D membrane visualization with camera controls
  main.js           - Application orchestration
```

---

## 🚀 Performance Optimizations

### 1. GPU-Based Mode Summation (High Impact)
Currently, height field reconstruction happens on CPU in `modes.js`:
```js
// Current: O(modes × gridSize²) per frame on CPU
for (const mode of modes) {
  for (let i = 0; i < height.length; i++) {
    height[i] += amp * phi[i];
  }
}
```

**Optimization**: Move to vertex shader or compute shader:
- Upload mode amplitudes as uniforms (16 floats)
- Precompute φ_{m,n} as textures or compute in shader
- Sum in vertex shader: `z = Σ u_amp[k] * sin(m*π*x) * sin(n*π*y)`
- Eliminates CPU→GPU height buffer upload every frame

### 2. SharedArrayBuffer for Audio↔Visual Sync
Current: `postMessage` every 128 samples (~344 messages/sec at 44.1kHz)

**Optimization**: Use `SharedArrayBuffer` + `Atomics`:
```js
// Shared amplitude buffer between worklet and main thread
const sharedAmps = new SharedArrayBuffer(modes.length * 4);
const ampView = new Float32Array(sharedAmps);
// Worklet writes, main thread reads - no message overhead
```

### 3. Web Workers for Height Field
If keeping CPU reconstruction, offload to a dedicated worker to avoid blocking the render loop.

### 4. Instanced Rendering
For very high grid resolutions (256×256+), use instanced rendering with a single quad instance per cell.

### 5. Level of Detail (LOD)
Reduce grid resolution when zoomed out, increase when zoomed in.

---

## 🎵 Audio Enhancements

### 1. More Modes
- Current: 4×4 = 16 modes
- Extend to 6×6 (36) or 8×8 (64) for richer timbre
- Higher modes add "shimmer" and attack transient detail

### 2. Velocity Sensitivity
Map click/touch pressure or velocity to:
- Impulse gain (louder hits)
- Mode balance (harder hits excite more high modes)

### 3. Continuous Excitation
- Add friction/bow excitation mode (sustained tones)
- Implement with continuous input signal instead of impulse

### 4. Multiple Membranes
- Add a second membrane tuned differently
- Sympathetic resonance between them

### 5. Effects Chain
- Add reverb (convolution or algorithmic)
- Delay/echo
- Filter (lowpass sweep controlled by UI)

### 6. Different Membrane Shapes
- Circular membrane: φ_{m,n} = J_m(k_{mn}r) · cos(mθ) (Bessel functions)
- Rectangular (non-square): different aspect ratios

### 7. Physical Damping Models
- Frequency-dependent damping (current: simple 1/f)
- Air damping vs internal damping
- Edge damping (softer near boundaries)

---

## 🎨 Visual Enhancements

### 1. Normal Mapping / Displacement Mapping
Instead of per-vertex displacement, use a height texture and displacement in fragment shader for finer detail without geometry cost.

### 2. Environment Mapping
Add reflections for a more realistic metallic membrane look.

### 3. Particle Effects
Spawn particles at strike location that follow the surface motion.

### 4. Mode Shape Visualization
Option to show individual mode shapes (toggle modes on/off visually).

### 5. Waveform Overlay
Show 2D waveform or spectrogram alongside 3D view.

### 6. VR/AR Support
WebXR integration for immersive drumming experience.

---

## 🎛️ UI/UX Improvements

### 1. Presets
Save/load parameter presets (tuning, mic position, decay).

### 2. MIDI Input
Map MIDI notes to membrane positions or specific modes.

### 3. Touch Multi-Point
Allow multiple simultaneous touch points for polyphonic excitation.

### 4. Recording/Export
Record audio output to WAV/MP3.

### 5. Keyboard Shortcuts
- Space: random strike
- R: reset
- 1-9: preset positions

### 6. Tuning Controls
- Fundamental frequency slider (f₀)
- Tension/size ratio adjustment

---

## 🔧 Code Quality

### 1. TypeScript Migration
Add type safety, especially for mode data structures.

### 2. Unit Tests
Test modal math (frequency ratios, mode shapes).

### 3. Build System
Add bundler (Vite/esbuild) for:
- Tree shaking
- Minification
- Hot reload

### 4. Error Handling
Graceful degradation if WebGL2/AudioWorklet unavailable.

---

## 📊 Profiling Checklist

1. **CPU**: `performance.mark()` around height field reconstruction
2. **GPU**: Browser DevTools → Performance → GPU
3. **Audio**: Check for glitches with `AudioContext.baseLatency`
4. **Memory**: Watch for Float32Array allocations in render loop

---

## Priority Recommendations

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| 1 | GPU mode summation | High | Medium |
| 2 | More modes (6×6) | Medium | Low |
| 3 | Velocity sensitivity | Medium | Low |
| 4 | SharedArrayBuffer sync | Medium | Medium |
| 5 | Reverb effect | Medium | Medium |
| 6 | Circular membrane | High | High |
