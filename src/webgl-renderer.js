/**
 * WebGL renderer with GPU-based mode summation
 * 
 * All height field computation happens in vertex shader:
 * - Upload mode amplitudes as uniform array (up to 64 modes)
 * - Compute φ_{m,n}(x,y) = sin(mπx)·sin(nπy) in shader
 * - Sum contributions: z = Σ A_{m,n} · φ_{m,n}
 * - Compute normals analytically from partial derivatives
 */

export class WebGLRenderer {
  constructor(canvas, gridSize = 64, mMax = 4, nMax = 4) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2');
    
    if (!this.gl) {
      // Fallback to WebGL1
      this.gl = canvas.getContext('webgl');
      this.isWebGL2 = false;
    } else {
      this.isWebGL2 = true;
    }
    
    if (!this.gl) {
      throw new Error('WebGL not supported');
    }
    
    this.gridX = gridSize;
    this.gridY = gridSize;
    this.mMax = mMax;
    this.nMax = nMax;
    this.numModes = mMax * nMax;
    
    // Mode amplitudes - sent to GPU each frame
    this.amplitudes = new Float32Array(64); // Max 8x8 modes
    
    this.positionBuffer = null;
    this.uvBuffer = null;
    this.indexBuffer = null;
    this.program = null;
    this.uniforms = {};
    this.attributes = {};
    
    this.viewMatrix = new Float32Array(16);
    this.projMatrix = new Float32Array(16);
    this.modelMatrix = new Float32Array(16);
    
    // Camera
    this.cameraDistance = 3.5;
    this.cameraMinDist = 1.5;
    this.cameraMaxDist = 10.0;
    this.cameraTheta = 0.5;
    this.cameraPhi = 0.6;
    this.cameraTarget = [0, 0, 0];
    
    // Visual scaling
    this.heightScale = 8.0;      // Match slider default
    this.smoothingFactor = 0.85; // Higher = smoother/slower, Lower = more responsive
    
    // Smoothed amplitudes (for visual smoothing)
    this.smoothedAmplitudes = new Float32Array(64);
    
    // Peak tracking for auto-normalization
    this.visualPeak = 0.1;       // Higher initial value to prevent over-amplification
    this.visualPeakDecay = 0.995; // Decay rate for peak tracking
    
    // Amplitude decay tracking - separate rise and fall rates
    this.riseRate = 0.4;         // How fast visualization rises (higher = faster)
    this.fallRate = 0.92;        // How fast visualization falls (higher = slower decay)
    
    // Visualization mode: 'normal', 'chladni', 'phase', 'energy'
    this.vizMode = 'normal';
    
    // History for ghost trails
    this.historyLength = 8;      // Number of history frames
    this.amplitudeHistory = [];
    for (let i = 0; i < this.historyLength; i++) {
      this.amplitudeHistory.push(new Float32Array(64));
    }
    this.historyIndex = 0;
    
    // Previous amplitudes for phase/velocity calculation
    this.prevAmplitudes = new Float32Array(64);
    
    // Animation
    this.autoRotate = true;
    this.autoRotateSpeed = 0.15;
    
    // Interaction state
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.dragThreshold = 5;
    this.wasDragged = false;
    
    // Callbacks
    this.onStrike = null;
    
    this.init();
    this.setupControls();
  }
  
  init() {
    const gl = this.gl;
    this.createShaders();
    this.createPlaneGeometry();
    gl.enable(gl.DEPTH_TEST);
    // Disable back-face culling so we can see the underside too
    gl.disable(gl.CULL_FACE);
    // Darker blue-gray background
    gl.clearColor(0.08, 0.1, 0.15, 1.0);
    this.resize();
  }
  
  createShaders() {
    const gl = this.gl;
    
    // Build version prefix - must be first line with no leading whitespace/newlines
    const versionPrefix = this.isWebGL2 ? '#version 300 es\n' : '';
    const inAttr = this.isWebGL2 ? 'in' : 'attribute';
    const outVar = this.isWebGL2 ? 'out' : 'varying';
    const inVar = this.isWebGL2 ? 'in' : 'varying';
    const fragOut = this.isWebGL2 ? 'fragColor' : 'gl_FragColor';
    const fragOutDecl = this.isWebGL2 ? 'out vec4 fragColor;' : '';
    
    // Simple vertex shader that computes height from mode amplitudes
    const vertexSource = versionPrefix + `precision highp float;

${inAttr} vec2 aPosition;
${inAttr} vec2 aUV;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform float uHeightScale;
uniform float uNormFactor;
uniform float uAmp[36];

${outVar} vec3 vNormal;
${outVar} vec3 vPosition;
${outVar} float vHeight;
${outVar} vec2 vUV;

const float PI = 3.14159265359;

void main() {
  vec2 uv = aUV;
  vec2 pos = aPosition;
  
  float height = 0.0;
  
  float sx1 = sin(PI * uv.x);
  float sx2 = sin(2.0 * PI * uv.x);
  float sx3 = sin(3.0 * PI * uv.x);
  float sx4 = sin(4.0 * PI * uv.x);
  float sx5 = sin(5.0 * PI * uv.x);
  float sx6 = sin(6.0 * PI * uv.x);
  
  float sy1 = sin(PI * uv.y);
  float sy2 = sin(2.0 * PI * uv.y);
  float sy3 = sin(3.0 * PI * uv.y);
  float sy4 = sin(4.0 * PI * uv.y);
  float sy5 = sin(5.0 * PI * uv.y);
  float sy6 = sin(6.0 * PI * uv.y);
  
  // Mode (1,1) to (1,6)
  height += uAmp[0] * sx1 * sy1;
  height += uAmp[1] * sx1 * sy2;
  height += uAmp[2] * sx1 * sy3;
  height += uAmp[3] * sx1 * sy4;
  height += uAmp[4] * sx1 * sy5;
  height += uAmp[5] * sx1 * sy6;
  
  // Mode (2,1) to (2,6)
  height += uAmp[6] * sx2 * sy1;
  height += uAmp[7] * sx2 * sy2;
  height += uAmp[8] * sx2 * sy3;
  height += uAmp[9] * sx2 * sy4;
  height += uAmp[10] * sx2 * sy5;
  height += uAmp[11] * sx2 * sy6;
  
  // Mode (3,1) to (3,6)
  height += uAmp[12] * sx3 * sy1;
  height += uAmp[13] * sx3 * sy2;
  height += uAmp[14] * sx3 * sy3;
  height += uAmp[15] * sx3 * sy4;
  height += uAmp[16] * sx3 * sy5;
  height += uAmp[17] * sx3 * sy6;
  
  // Mode (4,1) to (4,6)
  height += uAmp[18] * sx4 * sy1;
  height += uAmp[19] * sx4 * sy2;
  height += uAmp[20] * sx4 * sy3;
  height += uAmp[21] * sx4 * sy4;
  height += uAmp[22] * sx4 * sy5;
  height += uAmp[23] * sx4 * sy6;
  
  // Mode (5,1) to (5,6)
  height += uAmp[24] * sx5 * sy1;
  height += uAmp[25] * sx5 * sy2;
  height += uAmp[26] * sx5 * sy3;
  height += uAmp[27] * sx5 * sy4;
  height += uAmp[28] * sx5 * sy5;
  height += uAmp[29] * sx5 * sy6;
  
  // Mode (6,1) to (6,6)
  height += uAmp[30] * sx6 * sy1;
  height += uAmp[31] * sx6 * sy2;
  height += uAmp[32] * sx6 * sy3;
  height += uAmp[33] * sx6 * sy4;
  height += uAmp[34] * sx6 * sy5;
  height += uAmp[35] * sx6 * sy6;
  
  height *= uNormFactor * uHeightScale;
  
  vec3 normal = normalize(vec3(0.0, 0.0, 1.0));
  vec3 vertexPos = vec3(pos, height);
  
  vec4 worldPos = uModel * vec4(vertexPos, 1.0);
  vPosition = worldPos.xyz;
  vNormal = mat3(uModel) * normal;
  vHeight = height;
  vUV = uv;
  
  gl_Position = uProjection * uView * worldPos;
}
`;
    
    const fragmentSource = versionPrefix + `precision highp float;

${inVar} vec3 vNormal;
${inVar} vec3 vPosition;
${inVar} float vHeight;
${inVar} vec2 vUV;

uniform vec3 uLightDir;
uniform vec3 uCameraPos;
uniform int uVizMode;        // 0=normal, 1=chladni, 2=phase, 3=energy
uniform float uVelocity;     // Height velocity for phase/energy modes
uniform float uTime;

${fragOutDecl}

// HSV to RGB conversion for phase visualization
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(uCameraPos - vPosition);
  
  // Height-based values
  float h = clamp(vHeight / 1.0, -1.0, 1.0);
  float absH = abs(h);
  
  vec3 color;
  
  // ===== CHLADNI MODE: Highlight nodal lines =====
  if (uVizMode == 1) {
    // Nodal regions are where height stays near zero
    float nodeIntensity = 1.0 - smoothstep(0.0, 0.15, absH);
    
    // Bright lines at nodes, dark elsewhere
    vec3 nodeColor = vec3(1.0, 0.95, 0.7);  // Warm white/gold for nodes
    vec3 antiNodeColor = vec3(0.1, 0.12, 0.2); // Dark blue for antinodes
    
    // Add subtle height coloring to antinodes
    if (h > 0.0) {
      antiNodeColor = mix(antiNodeColor, vec3(0.2, 0.1, 0.15), absH);
    } else {
      antiNodeColor = mix(antiNodeColor, vec3(0.1, 0.1, 0.25), absH);
    }
    
    color = mix(antiNodeColor, nodeColor, nodeIntensity * nodeIntensity);
    
    // Add glow effect around nodal lines
    float glow = exp(-absH * 8.0) * 0.5;
    color += vec3(0.8, 0.7, 0.4) * glow;
  }
  
  // ===== PHASE MODE: Rainbow based on oscillation phase =====
  else if (uVizMode == 2) {
    // Compute phase from height and velocity (atan2 gives -π to π)
    float phase = atan(uVelocity * 5.0, h) / 3.14159 * 0.5 + 0.5; // 0 to 1
    
    // Add time-based rotation for animation effect
    phase = fract(phase + uTime * 0.1);
    
    // Rainbow color from phase
    float saturation = 0.7 + absH * 0.3; // More saturated at extremes
    float value = 0.5 + absH * 0.5;      // Brighter at extremes
    color = hsv2rgb(vec3(phase, saturation, value));
    
    // Nodal regions are white
    float nodeBlend = exp(-absH * 10.0);
    color = mix(color, vec3(0.9), nodeBlend * 0.5);
  }
  
  // ===== ENERGY MODE: Kinetic + potential energy heat map =====
  else if (uVizMode == 3) {
    // Simplified energy: E ∝ h² + v²
    float energy = h * h + uVelocity * uVelocity * 25.0;
    energy = clamp(energy, 0.0, 1.0);
    
    // Heat map: black -> purple -> red -> orange -> yellow -> white
    vec3 c0 = vec3(0.0, 0.0, 0.0);      // 0.0
    vec3 c1 = vec3(0.3, 0.0, 0.5);      // 0.2
    vec3 c2 = vec3(0.8, 0.1, 0.1);      // 0.4
    vec3 c3 = vec3(1.0, 0.5, 0.0);      // 0.6
    vec3 c4 = vec3(1.0, 0.9, 0.2);      // 0.8
    vec3 c5 = vec3(1.0, 1.0, 1.0);      // 1.0
    
    if (energy < 0.2) {
      color = mix(c0, c1, energy / 0.2);
    } else if (energy < 0.4) {
      color = mix(c1, c2, (energy - 0.2) / 0.2);
    } else if (energy < 0.6) {
      color = mix(c2, c3, (energy - 0.4) / 0.2);
    } else if (energy < 0.8) {
      color = mix(c3, c4, (energy - 0.6) / 0.2);
    } else {
      color = mix(c4, c5, (energy - 0.8) / 0.2);
    }
  }
  
  // ===== NORMAL MODE: Original height-based coloring =====
  else {
    if (h > 0.0) {
      // Peaks: aqua -> cyan -> white -> gold -> coral
      if (h < 0.25) {
        color = mix(vec3(0.3, 0.55, 0.7), vec3(0.4, 0.9, 1.0), h / 0.25);
      } else if (h < 0.5) {
        color = mix(vec3(0.4, 0.9, 1.0), vec3(0.95, 1.0, 1.0), (h - 0.25) / 0.25);
      } else if (h < 0.75) {
        color = mix(vec3(1.0, 0.95, 0.8), vec3(1.0, 0.7, 0.3), (h - 0.5) / 0.25);
      } else {
        color = mix(vec3(1.0, 0.7, 0.3), vec3(1.0, 0.4, 0.3), (h - 0.75) / 0.25);
      }
    } else {
      // Troughs: slate -> indigo -> purple -> magenta
      float nh = -h;
      if (nh < 0.3) {
        color = mix(vec3(0.35, 0.45, 0.6), vec3(0.4, 0.35, 0.7), nh / 0.3);
      } else if (nh < 0.6) {
        color = mix(vec3(0.4, 0.35, 0.7), vec3(0.55, 0.3, 0.65), (nh - 0.3) / 0.3);
      } else {
        color = mix(vec3(0.55, 0.3, 0.65), vec3(0.7, 0.3, 0.55), (nh - 0.6) / 0.4);
      }
    }
    
    // Intensity boost at peaks/troughs
    float intensity = 1.0 + absH * 0.3;
    color *= intensity;
  }
  
  // ===== COMMON LIGHTING (applied to all modes) =====
  
  // Hemisphere lighting
  float hemisphereBlend = normal.z * 0.5 + 0.5;
  vec3 skyColor = vec3(0.9, 0.95, 1.0);
  vec3 groundColor = vec3(0.4, 0.45, 0.6);
  vec3 hemisphereLight = mix(groundColor, skyColor, hemisphereBlend);
  
  // Key light
  vec3 lightDir = normalize(uLightDir);
  float keyLight = max(dot(normal, lightDir), 0.0);
  
  // Fill light
  float fillLight = max(dot(normal, viewDir), 0.0) * 0.3;
  
  // Wrap lighting
  float wrapLight = (dot(normal, lightDir) + 0.5) / 1.5;
  wrapLight = max(wrapLight, 0.0) * 0.4;
  
  // Specular (reduced for Chladni mode)
  vec3 halfDir = normalize(lightDir + viewDir);
  float specPower = (uVizMode == 1) ? 64.0 : 32.0;
  float spec = pow(max(dot(normal, halfDir), 0.0), specPower);
  
  // Edge fade
  float edge = smoothstep(0.0, 0.06, vUV.x) * smoothstep(0.0, 0.06, 1.0 - vUV.x) *
               smoothstep(0.0, 0.06, vUV.y) * smoothstep(0.0, 0.06, 1.0 - vUV.y);
  float edgeFactor = 0.7 + 0.3 * edge;
  
  // Lighting intensity (less for Chladni to preserve contrast)
  float lightMult = (uVizMode == 1) ? 0.6 : 1.0;
  float totalLight = 0.5 + (keyLight * 0.35 + fillLight + wrapLight) * lightMult;
  
  vec3 litColor = color * hemisphereLight * totalLight * edgeFactor;
  
  // Specular (reduced for special modes)
  float specMult = (uVizMode == 1 || uVizMode == 3) ? 0.2 : 0.5;
  vec3 specular = vec3(1.0, 0.98, 0.95) * spec * specMult;
  
  // Rim/Fresnel - bright edge highlighting
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
  vec3 rim = vec3(0.5, 0.7, 1.0) * fresnel * 0.4;
  
  // Final color - clamp to prevent over-saturation
  vec3 finalColor = litColor + specular + rim;
  finalColor = min(finalColor, vec3(1.2)); // Allow slight HDR bloom
  
  ${fragOut} = vec4(finalColor, 1.0);
}
`;

    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    
    if (!vertexShader || !fragmentShader) {
      console.error('Shader compilation failed, using fallback');
      this.createFallbackShaders();
      return;
    }
    
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);
    
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error('Shader link error:', gl.getProgramInfoLog(this.program));
      this.createFallbackShaders();
      return;
    }
    
    // Get attribute locations
    this.attributes.position = gl.getAttribLocation(this.program, 'aPosition');
    this.attributes.uv = gl.getAttribLocation(this.program, 'aUV');
    
    console.log('Shader attributes - position:', this.attributes.position, 'uv:', this.attributes.uv);
    
    if (this.attributes.position === -1 || this.attributes.uv === -1) {
      console.error('Failed to get attribute locations');
      this.createFallbackShaders();
      return;
    }
    
    // Get uniform locations
    this.uniforms.model = gl.getUniformLocation(this.program, 'uModel');
    this.uniforms.view = gl.getUniformLocation(this.program, 'uView');
    this.uniforms.projection = gl.getUniformLocation(this.program, 'uProjection');
    this.uniforms.lightDir = gl.getUniformLocation(this.program, 'uLightDir');
    this.uniforms.cameraPos = gl.getUniformLocation(this.program, 'uCameraPos');
    this.uniforms.amplitudes = gl.getUniformLocation(this.program, 'uAmp');
    this.uniforms.heightScale = gl.getUniformLocation(this.program, 'uHeightScale');
    this.uniforms.normFactor = gl.getUniformLocation(this.program, 'uNormFactor');
    this.uniforms.vizMode = gl.getUniformLocation(this.program, 'uVizMode');
    this.uniforms.velocity = gl.getUniformLocation(this.program, 'uVelocity');
    this.uniforms.time = gl.getUniformLocation(this.program, 'uTime');
    
    console.log('Shader initialized successfully, WebGL2:', this.isWebGL2);
  }
  
  createFallbackShaders() {
    const gl = this.gl;
    
    // Build version prefix - must be first line with no leading whitespace/newlines
    const versionPrefix = this.isWebGL2 ? '#version 300 es\n' : '';
    const inAttr = this.isWebGL2 ? 'in' : 'attribute';
    const outVar = this.isWebGL2 ? 'out' : 'varying';
    const inVar = this.isWebGL2 ? 'in' : 'varying';
    const fragOut = this.isWebGL2 ? 'fragColor' : 'gl_FragColor';
    const fragOutDecl = this.isWebGL2 ? 'out vec4 fragColor;' : '';
    
    // Simple fallback vertex shader - just positions without mode summation
    const vertexSource = versionPrefix + `precision highp float;

${inAttr} vec2 aPosition;
${inAttr} vec2 aUV;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;

${outVar} vec3 vPosition;
${outVar} float vHeight;
${outVar} vec2 vUV;

void main() {
  vec2 pos = aPosition;
  float height = 0.0;
  
  vec3 vertexPos = vec3(pos, height);
  vec4 worldPos = uModel * vec4(vertexPos, 1.0);
  vPosition = worldPos.xyz;
  vHeight = height;
  vUV = aUV;
  
  gl_Position = uProjection * uView * worldPos;
}
`;
    
    const fragmentSource = versionPrefix + `precision highp float;

${inVar} vec3 vPosition;
${inVar} float vHeight;
${inVar} vec2 vUV;

${fragOutDecl}

void main() {
  vec3 color = vec3(0.2, 0.4, 0.6);
  float edge = smoothstep(0.0, 0.1, vUV.x) * smoothstep(0.0, 0.1, 1.0 - vUV.x) *
               smoothstep(0.0, 0.1, vUV.y) * smoothstep(0.0, 0.1, 1.0 - vUV.y);
  color *= 0.5 + 0.5 * edge;
  ${fragOut} = vec4(color, 1.0);
}
`;
    
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);
    
    this.attributes.position = gl.getAttribLocation(this.program, 'aPosition');
    this.attributes.uv = gl.getAttribLocation(this.program, 'aUV');
    
    this.uniforms.model = gl.getUniformLocation(this.program, 'uModel');
    this.uniforms.view = gl.getUniformLocation(this.program, 'uView');
    this.uniforms.projection = gl.getUniformLocation(this.program, 'uProjection');
    this.uniforms.heightScale = gl.getUniformLocation(this.program, 'uHeightScale');
    this.uniforms.amplitudes = null;
    this.uniforms.normFactor = null;
    this.uniforms.lightDir = null;
    this.uniforms.cameraPos = null;
    
    console.log('Fallback shader initialized');
  }
  
  compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      console.error('Shader compile error:', error);
      // Print line numbers for debugging
      const lines = source.split('\n');
      lines.forEach((line, i) => console.log(`${i + 1}: ${line}`));
      gl.deleteShader(shader);
      return null;
    }
    
    return shader;
  }
  
  createPlaneGeometry() {
    const gl = this.gl;
    const nx = this.gridX;
    const ny = this.gridY;
    
    // Position buffer (xy only, z computed in shader)
    const positions = new Float32Array(nx * ny * 2);
    const uvs = new Float32Array(nx * ny * 2);
    
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const idx = (iy * nx + ix) * 2;
        // Position in [-1, 1]
        positions[idx] = (ix / (nx - 1)) * 2 - 1;
        positions[idx + 1] = (iy / (ny - 1)) * 2 - 1;
        // UV in [0, 1]
        uvs[idx] = ix / (nx - 1);
        uvs[idx + 1] = iy / (ny - 1);
      }
    }
    
    // Index buffer
    const indices = [];
    for (let iy = 0; iy < ny - 1; iy++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const i = iy * nx + ix;
        indices.push(i, i + nx, i + 1);
        indices.push(i + 1, i + nx, i + nx + 1);
      }
    }
    this.indexCount = indices.length;
    
    // Create buffers
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    
    this.uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    
    // Use Uint32 for large grids
    const indexArray = this.indexCount > 65535 
      ? new Uint32Array(indices) 
      : new Uint16Array(indices);
    this.indexType = this.indexCount > 65535 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    
    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexArray, gl.STATIC_DRAW);
  }
  
  setGridSize(size) {
    if (size === this.gridX) return;
    this.gridX = size;
    this.gridY = size;
    this.createPlaneGeometry();
  }
  
  setModeCount(mMax, nMax) {
    this.mMax = mMax;
    this.nMax = nMax;
    this.numModes = mMax * nMax;
  }
  
  /**
   * Update mode amplitudes (called from main loop)
   * @param {Float32Array} amplitudes - Raw amplitudes from audio worklet
   */
  updateAmplitudes(amplitudes) {
    // Find peak for normalization
    let peak = 0;
    for (let i = 0; i < amplitudes.length; i++) {
      peak = Math.max(peak, Math.abs(amplitudes[i]));
    }
    this.visualPeak = Math.max(this.visualPeak * this.visualPeakDecay, peak, 0.001);
    
    // Apply asymmetric smoothing - fast attack, slow release
    // This makes patterns more visible while reducing jitter
    for (let i = 0; i < amplitudes.length && i < 64; i++) {
      const current = this.smoothedAmplitudes[i];
      const target = amplitudes[i];
      
      if (Math.abs(target) > Math.abs(current)) {
        // Rising - use faster rate for snappy response
        this.smoothedAmplitudes[i] = current + (target - current) * this.riseRate;
      } else {
        // Falling - use slower rate for smooth decay
        this.smoothedAmplitudes[i] = current * this.fallRate + target * (1 - this.fallRate);
      }
    }
  }
  
  // Legacy compatibility - if called with height field, extract modes
  updateHeights(heights) {
    // This is for backward compatibility
    // New code should call updateAmplitudes directly
  }
  
  setupControls() {
    const canvas = this.canvas;
    
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    
    // Mouse wheel zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY * 0.005;
      this.cameraDistance = Math.max(
        this.cameraMinDist,
        Math.min(this.cameraMaxDist, this.cameraDistance * (1 + delta))
      );
    }, { passive: false });
    
    // Mouse down
    canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.wasDragged = false;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });
    
    // Mouse move - orbit
    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      
      const totalDx = e.clientX - this.dragStartX;
      const totalDy = e.clientY - this.dragStartY;
      if (Math.abs(totalDx) > this.dragThreshold || Math.abs(totalDy) > this.dragThreshold) {
        this.wasDragged = true;
        this.autoRotate = false;
      }
      
      if (this.wasDragged) {
        this.cameraTheta -= dx * 0.01;
        this.cameraPhi = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, this.cameraPhi + dy * 0.01));
      }
      
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });
    
    // Mouse up - strike if not dragged
    window.addEventListener('mouseup', (e) => {
      if (this.isDragging && !this.wasDragged) {
        const coords = this.canvasToMembrane(this.dragStartX, this.dragStartY);
        if (coords && this.onStrike) {
          this.onStrike(coords.x, coords.y);
        }
      }
      this.isDragging = false;
    });
    
    // Touch support
    let touchStartTime = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let lastTouchDist = 0;
    
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartTime = Date.now();
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        this.lastMouseX = touchStartX;
        this.lastMouseY = touchStartY;
        this.wasDragged = false;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.sqrt(dx * dx + dy * dy);
      }
      e.preventDefault();
    }, { passive: false });
    
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - this.lastMouseX;
        const dy = e.touches[0].clientY - this.lastMouseY;
        
        const totalDx = e.touches[0].clientX - touchStartX;
        const totalDy = e.touches[0].clientY - touchStartY;
        if (Math.abs(totalDx) > 10 || Math.abs(totalDy) > 10) {
          this.wasDragged = true;
          this.autoRotate = false;
        }
        
        if (this.wasDragged) {
          this.cameraTheta -= dx * 0.01;
          this.cameraPhi = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, this.cameraPhi + dy * 0.01));
        }
        
        this.lastMouseX = e.touches[0].clientX;
        this.lastMouseY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const delta = (lastTouchDist - dist) * 0.01;
        this.cameraDistance = Math.max(
          this.cameraMinDist,
          Math.min(this.cameraMaxDist, this.cameraDistance * (1 + delta))
        );
        lastTouchDist = dist;
        this.wasDragged = true;
      }
      e.preventDefault();
    }, { passive: false });
    
    canvas.addEventListener('touchend', (e) => {
      if (!this.wasDragged && Date.now() - touchStartTime < 300) {
        const coords = this.canvasToMembrane(touchStartX, touchStartY);
        if (coords && this.onStrike) {
          this.onStrike(coords.x, coords.y);
        }
      }
    });
  }
  
  canvasToMembrane(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = 1 - (clientY - rect.top) / rect.height;
    
    // Simple approximation - ray from camera through click point
    // intersect with z=0 plane
    const cx = Math.sin(this.cameraTheta) * Math.cos(this.cameraPhi) * this.cameraDistance;
    const cy = Math.cos(this.cameraTheta) * Math.cos(this.cameraPhi) * this.cameraDistance;
    const cz = Math.sin(this.cameraPhi) * this.cameraDistance;
    
    // Approximate: map screen x,y to membrane assuming roughly overhead view
    const aspect = this.canvas.width / this.canvas.height;
    const fovScale = Math.tan(Math.PI / 8) * this.cameraDistance;
    
    const viewX = (x * 2 - 1) * fovScale * aspect;
    const viewY = (y * 2 - 1) * fovScale;
    
    // Rotate into world space (simplified)
    const cosT = Math.cos(this.cameraTheta);
    const sinT = Math.sin(this.cameraTheta);
    
    const memX = cosT * viewX - sinT * viewY;
    const memY = sinT * viewX + cosT * viewY;
    
    // Map from [-1,1] to [0,1]
    const u = (memX + 1) * 0.5;
    const v = (memY + 1) * 0.5;
    
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      return { x: u, y: v };
    }
    return null;
  }
  
  /**
   * Set visualization mode
   * @param {string} mode - 'normal', 'chladni', 'phase', or 'energy'
   */
  setVizMode(mode) {
    const validModes = ['normal', 'chladni', 'phase', 'energy'];
    if (validModes.includes(mode)) {
      this.vizMode = mode;
    }
  }
  
  resetCamera() {
    this.cameraDistance = 3.5;
    this.cameraTheta = 0.5;
    this.cameraPhi = 0.6;
    this.autoRotate = true;
  }
  
  resize() {
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    this.gl.viewport(0, 0, canvas.width, canvas.height);
  }
  
  render(time) {
    const gl = this.gl;
    
    if (!this.program || this.attributes.position === -1) {
      return; // Shader not ready
    }
    
    // Auto-rotate
    if (this.autoRotate) {
      this.cameraTheta += this.autoRotateSpeed * 0.016;
    }
    
    // Compute camera position
    const cosP = Math.cos(this.cameraPhi);
    const sinP = Math.sin(this.cameraPhi);
    const cosT = Math.cos(this.cameraTheta);
    const sinT = Math.sin(this.cameraTheta);
    
    const camX = sinT * cosP * this.cameraDistance;
    const camY = cosT * cosP * this.cameraDistance;
    const camZ = sinP * this.cameraDistance;
    
    // Build matrices
    this.lookAt(this.viewMatrix, [camX, camY, camZ], this.cameraTarget, [0, 0, 1]);
    const aspect = this.canvas.width / this.canvas.height;
    this.perspective(this.projMatrix, Math.PI / 4, aspect, 0.1, 100);
    this.identity(this.modelMatrix);
    
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    
    // Set uniforms (check for null in case of fallback shader)
    if (this.uniforms.model) gl.uniformMatrix4fv(this.uniforms.model, false, this.modelMatrix);
    if (this.uniforms.view) gl.uniformMatrix4fv(this.uniforms.view, false, this.viewMatrix);
    if (this.uniforms.projection) gl.uniformMatrix4fv(this.uniforms.projection, false, this.projMatrix);
    if (this.uniforms.lightDir) gl.uniform3f(this.uniforms.lightDir, 0.5, 0.3, 1.0);
    if (this.uniforms.cameraPos) gl.uniform3f(this.uniforms.cameraPos, camX, camY, camZ);
    
    // Mode parameters - amplitudes array limited to 36 for 6x6 modes
    if (this.uniforms.heightScale) gl.uniform1f(this.uniforms.heightScale, this.heightScale);
    if (this.uniforms.normFactor) gl.uniform1f(this.uniforms.normFactor, 1.0 / Math.max(this.visualPeak, 0.001));
    if (this.uniforms.amplitudes) gl.uniform1fv(this.uniforms.amplitudes, this.smoothedAmplitudes.subarray(0, 36));
    
    // Visualization mode uniforms
    const vizModeIndex = { 'normal': 0, 'chladni': 1, 'phase': 2, 'energy': 3 }[this.vizMode] || 0;
    if (this.uniforms.vizMode) gl.uniform1i(this.uniforms.vizMode, vizModeIndex);
    if (this.uniforms.time) gl.uniform1f(this.uniforms.time, time);
    
    // Compute average velocity (difference from previous frame) for phase/energy modes
    let avgVelocity = 0;
    for (let i = 0; i < 36; i++) {
      avgVelocity += Math.abs(this.smoothedAmplitudes[i] - this.prevAmplitudes[i]);
      this.prevAmplitudes[i] = this.smoothedAmplitudes[i];
    }
    avgVelocity /= 36;
    if (this.uniforms.velocity) gl.uniform1f(this.uniforms.velocity, avgVelocity * 10);
    
    // Bind position buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    if (this.attributes.position >= 0) {
      gl.enableVertexAttribArray(this.attributes.position);
      gl.vertexAttribPointer(this.attributes.position, 2, gl.FLOAT, false, 0, 0);
    }
    
    // Bind UV buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    if (this.attributes.uv >= 0) {
      gl.enableVertexAttribArray(this.attributes.uv);
      gl.vertexAttribPointer(this.attributes.uv, 2, gl.FLOAT, false, 0, 0);
    }
    
    // Draw
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0);
  }
  
  // Matrix utilities
  identity(out) {
    out.fill(0);
    out[0] = out[5] = out[10] = out[15] = 1;
    return out;
  }
  
  perspective(out, fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy / 2);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  }
  
  lookAt(out, eye, target, up) {
    const zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let len = Math.sqrt(zx * zx + zy * zy + zz * zz);
    const z = [zx / len, zy / len, zz / len];
    
    const xx = up[1] * z[2] - up[2] * z[1];
    const xy = up[2] * z[0] - up[0] * z[2];
    const xz = up[0] * z[1] - up[1] * z[0];
    len = Math.sqrt(xx * xx + xy * xy + xz * xz);
    const x = [xx / len, xy / len, xz / len];
    
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    
    out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
    out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
    out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
    out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
    out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
    out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
    out[15] = 1;
    return out;
  }
}
