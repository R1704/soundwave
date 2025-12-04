# Modal Drum - Optimization & Extension Opportunities

## Current Architecture

```
index.html              - UI, controls, styling
src/
  modes.js              - Modal math, data structures
  audio-worklet.js      - Real-time audio processing (resonator bank)
  audio-engine.js       - AudioContext management, effects chain, worklet communication
  webgl-renderer.js     - 3D membrane visuali| 1 | Chord articulator | High | Medium | ✅ Done |
| 1 | Chladni visualization | High | Medium | ✅ Done |
| 1 | Phase visualization | Very High | Medium | ✅ Done |
| 1 | Energy visualization | High | Medium | ✅ Done |
| 1 | Spacetime sculpture | Very High | High | ✅ Done |
| 1 | Particle flow system | Very High | High | ✅ Done |
| 1 | Marching squares contours | High | Medium | ✅ Done |
| 1 | Ribbon renderer | High | High | ✅ Done |
| 1 | STL export | Medium | Medium | ✅ Done |
| 1 | Cymatics drive mode | Medium | Low | ✅ Done |
| 2 | Height default | Low | Trivial | 🔲 Next |
| 2 | Interactive ADSR | Medium | Medium | 🔲 Next |
| 2 | Particle trail ribbons | High | Medium | 🔲 Next |
| 2 | Better ribbon topology | Medium | High | 🔲 Planned |
| 3 | Delay effect | Medium | Medium | 🔲 Planned |
| 3 | Velocity sensitivity | Medium | Low | 🔲 Planned |
| 3 | Spectrogram | Medium | Medium | 🔲 Planned |
| 4 | Preset system | High | Medium | 🔲 Later |
| 4 | MIDI input | High | High | 🔲 Later |
| 4 | Ghost trails | High | Medium | 🔲 Later |
| 5 | SharedArrayBuffer | Medium | Medium | 🔲 Future |
| 5 | Circular membrane | High | High | 🔲 Future |
| 5 | Caustic patterns | Very High | High | 🔲 Future | GPU mode summation
  spacetime-sculpture.js - 3D Chladni sculpture with multiple render modes (NEW)
  main.js               - Application orchestration
  modal-harmony.js      - Chord voicings and harmonic presets
  sequencer.js          - Chord progression sequencer
  euclidean-sequencer.js - Euclidean rhythm patterns
  chord-articulator.js  - Strum, arpeggio, and chord articulation
```

---

## ✅ Implemented Features

### Performance
- [x] **GPU-based mode summation** - Height field computed in vertex shader
- [x] **6×6 modes (36 modes)** - Rich timbre with higher partials
- [x] **Smooth amplitude interpolation** - Visual smoothing with separate rise/fall rates

### Audio
- [x] **Reverb effect** - Convolver with synthetic impulse response
- [x] **Attack transients** - Noise burst generator for percussive attacks
- [x] **ADSR envelope** - Attack, decay, sustain, release controls
- [x] **Mic position** - Adjustable virtual microphone position
- [x] **Cymatics drive mode** - Continuous frequency excitation for resonance discovery

### Music/Composition
- [x] **Modal harmony system** - Chord presets based on membrane modes
- [x] **Chord progression sequencer** - Step-based progression playback
- [x] **Euclidean rhythm sequencer** - Polyrhythmic patterns
- [x] **Chord articulator** - Strum, arpeggio patterns with direction control
- [x] **Modal scales** - Filter modes by scale (Pentatonic, Diagonal, L-Shape, etc.)

### Visualization - Membrane
- [x] **Multi-stage color mapping** - Height-based gradient (cyan→white→orange for peaks)
- [x] **Hemisphere lighting** - Soft ambient lighting from above/below
- [x] **Fill/wrap lighting** - No dark areas on back faces
- [x] **Mode grid UI** - Interactive 6×6 grid showing all modes
- [x] **Mode cell highlighting** - Flash effect when modes are excited
- [x] **Chladni visualization mode** - Nodal lines where membrane doesn't move
- [x] **Phase visualization mode** - Rainbow coloring based on oscillation phase
- [x] **Energy visualization mode** - Heat map of kinetic + potential energy

### Visualization - Spacetime Sculpture (NEW) ⭐
- [x] **Amplitude history buffer** - Circular buffer storing time slices of patterns
- [x] **Point cloud rendering** - Scattered points at nodal regions through time
- [x] **Marching squares contours** - Precise zero-crossing line extraction
- [x] **Contour line renderer** - GL_LINES with time-based coloring and glow
- [x] **Ribbon renderer** - Triangle strips connecting contours between slices
- [x] **Particle flow system** - 2000+ particles attracted to nodal lines
- [x] **Particle physics** - Force field, damping, noise, edge/corner repulsion
- [x] **Energy spike detection** - Shake particles on new sounds
- [x] **Boundary exclusion** - Ignores fixed boundary zeros (not real nodal lines)
- [x] **Adjustable parameters** - Full UI for particle count, force, damping, etc.
- [x] **STL export** - Export sculptures for 3D printing

---

## 🎯 Next Implementation Priorities

### Priority 1: UX Polish (Low Effort, High Impact)

#### 1.1 Stop Button ✅
Add a button to immediately stop all sound and reset state.
- Status: Implemented (Clear button)

#### 1.2 Height Scale Default
Change visualization height scale default from 2.0 to ~1.0 (user preference).
- Effort: 5 min
- Impact: Better out-of-box experience

#### 1.3 Interactive ADSR Canvas
Replace 4 vertical sliders with a single interactive envelope visualization.
- Drag points directly on the envelope curve
- More intuitive and space-efficient
- Effort: 1-2 hours
- Impact: Significantly improved UX

### Priority 2: Sculpture Enhancements (Medium Effort)

#### 2.1 Particle Trail Persistence
Make particle trails persist longer and render as 3D tubes/ribbons.
- Currently: Points scattered in time
- Goal: Connected trails showing particle paths
- Effort: 2-3 hours
- Impact: More beautiful sculptures

#### 2.2 Improved Ribbon Topology
Better matching of contour segments between slices.
- Handle topology changes (contours splitting/merging)
- Smoother interpolation
- Effort: 3-4 hours
- Impact: Cleaner ribbon surfaces

#### 2.3 Mesh Export Improvements
Better STL export with proper mesh generation.
- Use marching cubes for volumetric export
- Support OBJ format with vertex colors
- Effort: 3-4 hours
- Impact: Higher quality 3D prints

### Priority 3: Audio Improvements (Medium Effort)

#### 3.1 Delay Effect
Add stereo delay/echo effect (currently not implemented despite UI presence).
- Ping-pong delay with feedback control
- Sync to tempo option
- Effort: 1-2 hours
- Impact: Richer sound design options

#### 3.2 Velocity Sensitivity
Map click/touch pressure or velocity to impulse characteristics.
- Harder hits = more high-frequency modes
- Effort: 1 hour
- Impact: More expressive playing

#### 3.3 Filter Effect
Add resonant lowpass/highpass filter with cutoff and resonance.
- Effort: 1 hour
- Impact: Sound shaping capability

### Priority 4: Advanced Features (High Effort)

#### 4.1 Preset System
Save/load parameter presets including:
- Tuning, mic position, decay settings
- Reverb/effects settings
- Active chord/sequence
- Sculpture settings
- Effort: 2-3 hours
- Impact: Enables sharing and recall

#### 4.2 MIDI Input
Map MIDI notes to membrane positions or specific modes.
- Note velocity → excitation strength
- CC messages → parameter control
- Effort: 3-4 hours
- Impact: Professional integration

#### 4.3 Audio Recording/Export
Record output to WAV/WebM for export.
- MediaRecorder API integration
- Effort: 2 hours
- Impact: Content creation capability

---

## 🚀 Future Performance Optimizations

### SharedArrayBuffer for Audio↔Visual Sync
Current: `postMessage` every 128 samples (~344 messages/sec)

**Optimization**: Use `SharedArrayBuffer` + `Atomics` for zero-copy amplitude transfer.
- Requires cross-origin isolation headers
- Effort: Medium
- Impact: Reduced latency, smoother visuals

### Web Workers for CPU Tasks
Offload any remaining CPU work to dedicated workers.

### Instanced Rendering
For very high grid resolutions (256×256+), use instanced rendering.

---

## 🎵 Future Audio Extensions

### Different Membrane Shapes
- Circular membrane: φ_{m,n} = J_m(k_{mn}r) · cos(mθ) (Bessel functions)
- Rectangular (non-square): different aspect ratios
- Effort: High (new physics)

### Physical Damping Models
- Frequency-dependent damping beyond simple 1/f
- Air damping vs internal damping
- Edge damping variations

### Continuous Excitation
- Friction/bow mode for sustained tones
- Implement with continuous input instead of impulses

### Multiple Membranes
- Second membrane with sympathetic resonance
- Tunable coupling between membranes

---

## 🎨 Advanced Visualization Ideas

### Cymatics-Inspired

#### Chladni Patterns ✅ DONE
Show nodal lines where the membrane doesn't move - like sand collecting on a vibrating plate.
- Render lines/regions where amplitude stays near zero
- Could use edge detection on the height field
- Historical/accumulated mode: show where nodes have been over time
- **Status: Implemented** as visualization mode + spacetime sculpture

#### Particle/Sand Simulation ✅ DONE
Simulate particles that behave like sand on a Chladni plate:
- Particles migrate toward nodal lines (low amplitude regions)
- Scatter/jump when struck
- Accumulate to reveal standing wave patterns
- GPU compute shader for thousands of particles
- **Status: Implemented** in spacetime sculpture particle mode

#### Standing Wave Highlighting ✅ DONE
Color the surface based on node/antinode status:
- Nodes (stationary): one color (e.g., dark blue)
- Antinodes (max motion): another color (e.g., bright orange)
- Creates beautiful symmetric patterns for pure modes
- **Status: Implemented** as Chladni visualization mode

#### Resonance Ripples
Concentric rings that pulse outward from strike points:
- Fade as they expand
- Interfere with reflections from edges
- Like dropping a stone in water
- Effort: Low | Impact: Medium

---

### Temporal Visualizations (Through Time)

#### Ghost Trails / Motion Blur
Show membrane history as fading afterimages:
- Store last N frames of height data
- Blend with decreasing opacity
- Creates "long exposure" effect showing wave motion paths
- Could use ping-pong framebuffers
- Effort: Medium | Impact: High

#### 3D Spacetime View ✅ DONE
Extrude the membrane through time as a 3D volume:
- X, Y = membrane position
- Z = time (scrolling)
- See wave propagation as diagonal lines in spacetime
- Like a seismograph but 2D
- **Status: Implemented** as spacetime sculpture with multiple render modes

#### Spectrogram Waterfall
2D frequency×time display:
- Vertical axis: frequency (mode frequencies)
- Horizontal axis: time (scrolling)
- Color: amplitude
- Classic audio visualization, complements 3D view
- Effort: Medium | Impact: Medium

#### Mode Activity Timeline
Horizontal bars showing mode amplitude over time:
- One row per mode (m,n)
- Color intensity = amplitude
- See which modes sustain longest
- Effort: Low | Impact: Medium

#### Oscilloscope Modes
- **Ring scope**: Circular waveform around membrane edge
- **Lissajous**: X vs Y mic position output
- **Phase scope**: Left vs right channel
- Effort: Low-Medium | Impact: Medium

---

### Physics-Based Visualizations

#### Velocity Field (Arrows)
Show instantaneous velocity at each point:
- Arrows pointing up/down based on ∂z/∂t
- Length proportional to speed
- Reveals wave motion direction
- Effort: Medium | Impact: Medium

#### Energy Density Heat Map ✅ DONE
Color by local energy (kinetic + potential):
- E = ½ρ(∂z/∂t)² + ½T|∇z|²
- Hot spots at antinodes during motion
- Cool spots at nodes
- **Status: Implemented** as Energy visualization mode

#### Phase Visualization ✅ DONE
Color based on oscillation phase (0° to 360°):
- Compute phase from amplitude history or analytic signal
- Creates stunning moving interference patterns
- Rainbow colors cycling around the surface
- **Status: Implemented** as Phase visualization mode

#### Wavefront Propagation
Highlight the leading edge of waves:
- Show where waves are "arriving" vs "leaving"
- Uses gradient direction of height field
- Effort: Medium | Impact: Medium

---

### Artistic/Abstract

#### Fluid Coupling
Simulate a thin fluid layer on top of the membrane:
- Membrane motion disturbs the fluid
- Fluid has its own dynamics (ripples, surface tension)
- Two-layer visual effect
- Effort: Very High | Impact: Very High

#### Caustic Patterns
Treat the surface as a refractive lens:
- Cast light rays through the curved surface
- Render caustic patterns on a plane below
- Like sunlight through water
- Effort: High | Impact: Very High

#### Reaction-Diffusion Coupling
Blend membrane motion with chemical patterns:
- Gray-Scott or Belousov-Zhabotinsky simulation
- Membrane displacement affects diffusion rates
- Creates organic, living patterns
- Effort: High | Impact: High

#### Aurora/Plasma Effect
Abstract visual based on amplitude:
- Flowing color gradients
- Particle systems with audio-reactive parameters
- More artistic than physically accurate
- Effort: Medium | Impact: Medium

---

### Practical Enhancements

#### Split View Modes
Multiple visualization modes side-by-side:
- 3D membrane + 2D spectrogram
- Top view (Chladni) + side view (cross-section)
- Effort: Low | Impact: Medium

#### Cross-Section View
Slice through the membrane:
- Show 1D wave profile along a line
- Animate as waves pass through
- Good for understanding wave shape
- Effort: Low | Impact: Medium

#### Mode Isolation View
Toggle to show only selected modes:
- Visualize individual mode shapes
- Understand how modes combine
- Educational tool
- Effort: Low | Impact: Medium

---

## 🎯 Visualization Priority Recommendations

| Idea | Impact | Effort | Status |
|------|--------|--------|--------|
| Chladni patterns | High | Medium | ✅ Done |
| Ghost trails | High | Medium | 🔲 Next |
| Phase visualization | Very High | Medium | ✅ Done |
| Particle/sand sim | Very High | High | ✅ Done |
| Energy heat map | High | Medium | ✅ Done |
| Spacetime sculpture | High | High | ✅ Done |
| Ribbons | High | High | ✅ Done |
| Spectrogram | Medium | Medium | 🔲 Planned |
| Caustic patterns | Very High | High | 🔲 Future |
| Fluid coupling | Very High | Very High | 🔲 Future |

---

## 🎨 Legacy Visual Ideas

### Environment Mapping
Add reflections for metallic membrane appearance.

### VR/AR Support
WebXR integration for immersive experience.

---

## 📊 Priority Matrix

| Priority | Item | Impact | Effort | Status |
|----------|------|--------|--------|--------|
| 1 | GPU mode summation | High | Medium | ✅ Done |
| 1 | More modes (6×6) | Medium | Low | ✅ Done |
| 1 | Reverb effect | Medium | Medium | ✅ Done |
| 1 | Euclidean sequencer | High | Medium | ✅ Done |
| 1 | Chord articulator | High | Medium | ✅ Done |
| 2 | Stop button | Medium | Low | 🔲 Next |
| 2 | Height default | Low | Trivial | � Next |
| 2 | Interactive ADSR | Medium | Medium | 🔲 Next |
| 2 | Mic position marker | Medium | Medium | 🔲 Next |
| 3 | Delay effect | Medium | Medium | 🔲 Planned |
| 3 | Velocity sensitivity | Medium | Low | 🔲 Planned |
| 4 | Preset system | High | Medium | 🔲 Later |
| 4 | MIDI input | High | High | 🔲 Later |
| 5 | SharedArrayBuffer | Medium | Medium | 🔲 Future |
| 5 | Circular membrane | High | High | 🔲 Future |
