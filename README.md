# Modal Drum Synthesizer

A WebGL-powered modal synthesizer that simulates the physics of a vibrating square membrane. Create unique percussion sounds by exciting different vibrational modes and visualize the resulting wave patterns in real-time 3D. Features advanced cymatics-inspired visualizations including Chladni patterns, spacetime sculptures, and particle simulations.

![Modal Drum](https://img.shields.io/badge/WebGL-3D%20Visualization-blue)
![Audio](https://img.shields.io/badge/WebAudio-Modal%20Synthesis-green)
![Status](https://img.shields.io/badge/Status-Experimental-orange)

## Features

### 🎵 Audio Synthesis
- **36 Vibrational Modes** - 6×6 grid of modal resonators based on square membrane physics
- **Real-time IIR Resonators** - Each mode is a 2nd-order resonator running in an AudioWorklet
- **Chord Presets** - Pre-configured mode combinations (Fundamental, Diagonal, Cross, Star, etc.)
- **Reverb Effect** - Synthetic convolution reverb with adjustable wet/dry mix
- **Attack Transients** - Percussive noise bursts for realistic drum attacks
- **ADSR Envelope** - Full attack, decay, sustain, release controls with visual display

### 🎹 Chord Articulation
- **Instant Mode** - All modes triggered simultaneously
- **Strum Mode** - Modes triggered sequentially with adjustable timing and direction
- **Arpeggio Mode** - Cycling through modes at adjustable BPM with multiple patterns (Up, Down, Up-Down, Random)
- **Brightness Control** - Frequency-dependent gain for tonal shaping

### 🥁 Euclidean Sequencer
- **Bjorklund Algorithm** - Generates evenly-distributed rhythmic patterns
- **1-32 Steps** - Adjustable sequence length
- **Rotation Control** - Shift pattern start point
- **Chord Queue** - Sequence through multiple chords automatically
- **Tempo Control** - 40-200 BPM

### 🎨 3D Visualization

#### Membrane View
- **GPU-Accelerated** - All mode summation computed in vertex shader
- **Real-time Wave Display** - See the membrane vibrate in response to audio
- **Multiple Visualization Modes:**
  - **Normal (Height)** - Classic height-based coloring with peaks glowing warm
  - **Chladni (Nodal Lines)** - Shows stationary nodal patterns like sand on a vibrating plate
  - **Phase (Rainbow)** - Stunning color cycling based on oscillation phase
  - **Energy (Heat Map)** - Visualizes kinetic + potential energy distribution
- **Interactive Camera** - Drag to orbit, scroll to zoom, auto-rotation option

#### Spacetime Sculpture 🆕
Extrude Chladni patterns through time to create 3D sculptures - like freezing sound in amber!

- **Multiple Render Modes:**
  - **Contour Lines** - Precise nodal lines extracted using marching squares algorithm
  - **Point Cloud** - Scattered points along nodal regions
  - **Particle Flow** - Simulates sand/particles flowing toward nodal lines (cymatics!)
  - **Ribbons** - Solid surfaces connecting contour lines through time
- **Real-time Recording** - Captures patterns as you play
- **STL Export** - Export sculptures for 3D printing!
- **Adjustable Parameters** - Threshold, opacity, point size

#### Particle Physics System 🆕
Full particle simulation with tunable parameters:
- **Count** - 500 to 5000 particles
- **Force Strength** - How strongly particles are attracted to nodal lines
- **Damping** - Velocity friction for smooth or energetic motion
- **Noise** - Random motion for organic feel
- **Edge/Corner Repulsion** - Keeps particles away from boundaries
- **Shake** - Velocity burst on new sounds to redistribute particles
- **Reset Button** - Scatter particles back to random positions

### 🔊 Cymatics Mode
- **Continuous Drive** - Excite the membrane at a specific frequency
- **Frequency Sweep** - Find resonances by sweeping 50-1200 Hz
- **Amplitude Control** - Adjust drive strength
- **Resonance Discovery** - Watch Chladni patterns form at resonant frequencies

### 🎛️ Controls
- **Virtual Microphone** - Position affects which modes are audible
- **Decay Control** - Adjust resonator ring time
- **Grid Resolution** - 32×32 to 128×128 visualization detail
- **Visual Height Scale** - Adjust wave amplitude display
- **Modal Scales** - Filter available modes (Chromatic, Pentatonic, Diagonal, etc.)

## Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/soundwave.git
   cd soundwave
   ```

2. **Serve locally** (requires a local server due to AudioWorklet)
   ```bash
   # Using Python
   python -m http.server 8000
   
   # Or using Node.js
   npx serve .
   ```

3. **Open in browser**
   ```
   http://localhost:8000
   ```

4. **Click "▶ Start Audio"** to initialize the audio system

5. **Click the membrane** or use keyboard shortcuts to play

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1-9` | Play chord presets |
| `Space` | Random strike |
| `R` | Reset/stop all sound |
| `Arrow Keys` | Voice leading (shift chord) |
| `S` | Toggle chord sustain |

## Technical Requirements

- Modern browser with WebGL 2.0 support
- AudioWorklet support (Chrome 66+, Firefox 76+, Safari 14.1+)
- Recommended: Chrome or Firefox for best performance

## Architecture

```
soundwave/
├── index.html                  # UI and styling
├── src/
│   ├── main.js                 # Application orchestration
│   ├── audio-engine.js         # WebAudio management, effects chain
│   ├── audio-worklet.js        # Real-time resonator synthesis
│   ├── modes.js                # Modal physics calculations
│   ├── modal-harmony.js        # Chord theory, presets, voice leading
│   ├── chord-articulator.js    # Strum/arpeggio articulation
│   ├── euclidean-sequencer.js  # Bjorklund rhythm generator
│   ├── sequencer.js            # Step sequencer (legacy)
│   ├── webgl-renderer.js       # GPU-based 3D membrane visualization
│   └── spacetime-sculpture.js  # 3D Chladni sculpture renderer
```

## The Physics

A square membrane's vibrational modes follow:

$$f_{m,n} = \frac{f_0}{\sqrt{2}} \sqrt{m^2 + n^2}$$

Where:
- $f_0$ is the fundamental frequency
- $m, n$ are mode indices (1, 2, 3, ...)
- Mode $(1,1)$ is the fundamental
- Mode $(m,n)$ has $(m-1)$ vertical and $(n-1)$ horizontal nodal lines

Each mode shape is:
$$\phi_{m,n}(x,y) = \sin(m\pi x) \sin(n\pi y)$$

## Browser Compatibility

| Browser | Status |
|---------|--------|
| Chrome 66+ | ✅ Full support |
| Firefox 76+ | ✅ Full support |
| Safari 14.1+ | ✅ Full support |
| Edge 79+ | ✅ Full support |

## License

MIT License - See [LICENSE](LICENSE) for details.

## Acknowledgments

- Modal synthesis theory from physical modeling literature
- Euclidean rhythm algorithm by E. Bjorklund
- WebGL techniques from various open-source projects
