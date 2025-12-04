/**
 * Spacetime Sculpture - Chladni patterns through time
 * 
 * Takes 2D Chladni nodal patterns and extrudes them through time to create
 * a 3D sculptural form. Nodal regions (where amplitude stays near zero)
 * become the "solid" parts of the sculpture.
 * 
 * Can export as STL for 3D printing!
 */

export class SpacetimeSculpture {
  constructor(canvas, gridSize = 64, maxSlices = 128) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    
    if (!this.gl) {
      throw new Error('WebGL not supported');
    }
    
    this.isWebGL2 = !!canvas.getContext('webgl2');
    this.gridSize = gridSize;
    this.maxSlices = maxSlices;
    
    // History buffer: circular buffer of amplitude snapshots
    this.amplitudeHistory = new Float32Array(gridSize * gridSize * maxSlices);
    this.currentSlice = 0;
    this.totalSlices = 0;
    this.isRecording = true;
    
    // How often to capture a slice (in frames)
    this.captureInterval = 3; // Every 3 frames - slower buildup
    this.frameCount = 0;
    
    // Visualization parameters
    this.nodalThreshold = 0.12;  // Below this = nodal region (lower = thinner lines)
    this.timeScale = 0.02;       // Vertical spacing of slices (smaller = denser)
    this.sculptureOpacity = 0.95;
    this.pointSize = 2.5;        // Base point size
    this.lineWidth = 2.0;        // Line width for contour mode
    this.showWireframe = false;
    
    // Render mode: 'points', 'contours', 'ribbons', 'particles'
    this.renderMode = 'contours';
    
    // Camera for sculpture view
    this.cameraDistance = 3.0;
    this.cameraTheta = 0.3;
    this.cameraPhi = 0.4;
    this.autoRotate = true;
    this.autoRotateSpeed = 0.2;
    
    // Matrices
    this.viewMatrix = new Float32Array(16);
    this.projMatrix = new Float32Array(16);
    this.modelMatrix = new Float32Array(16);
    
    // WebGL resources
    this.program = null;
    this.lineProgram = null;
    this.vertexBuffer = null;
    this.lineBuffer = null;
    this.indexBuffer = null;
    this.uniforms = {};
    this.lineUniforms = {};
    this.attributes = {};
    this.lineAttributes = {};
    
    // Geometry cache - points
    this.geometryDirty = true;
    this.vertices = null;
    this.indices = null;
    this.vertexCount = 0;
    this.indexCount = 0;
    
    // Geometry cache - lines (contours)
    this.lineVertices = null;
    this.lineVertexCount = 0;
    
    // Geometry cache - ribbons (triangle strips connecting contours)
    this.ribbonBuffer = null;
    this.ribbonProgram = null;
    this.ribbonUniforms = {};
    this.ribbonAttributes = {};
    this.ribbonVertices = null;
    this.ribbonVertexCount = 0;
    
    // Particle system
    this.particleCount = 2000;
    this.particles = null;          // Float32Array: x, y, vx, vy per particle
    this.particleTrails = [];       // Array of trail snapshots for 3D sculpture
    this.maxTrailSlices = 200;
    this.particleTrailInterval = 3; // Capture every N frames
    this.particleFrameCount = 0;
    this.particleBuffer = null;
    this.particleProgram = null;
    this.particleUniforms = {};
    this.particleAttributes = {};
    this.particleTrailVertexCount = 0;
    
    // Particle physics parameters
    this.particleForceStrength = 0.15;  // How strongly particles move toward nodes
    this.particleDamping = 0.92;        // Velocity damping (0-1)
    this.particleNoise = 0.002;         // Random motion
    this.particleSize = 3.0;
    this.particleEdgeRepel = 0.015;     // Force pushing away from edges
    this.particleCornerRepel = 0.01;    // Extra force pushing away from corners
    this.particleShakeStrength = 0.04;  // Velocity burst on energy spike
    this.particleInnerBound = 0.75;     // Distance from center where edge repulsion starts
    
    // Current amplitude grid for particle physics (updated each frame)
    this.currentAmplitudeGrid = null;
    
    // Interaction
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    
    this.init();
  }
  
  init() {
    const gl = this.gl;
    
    this.createShaders();
    this.createBuffers();
    this.initParticles();
    
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.02, 0.02, 0.05, 1.0);
    
    this.setupControls();
    this.resize();
  }
  
  createShaders() {
    const gl = this.gl;
    
    const versionPrefix = this.isWebGL2 ? '#version 300 es\n' : '';
    const inAttr = this.isWebGL2 ? 'in' : 'attribute';
    const outVar = this.isWebGL2 ? 'out' : 'varying';
    const inVar = this.isWebGL2 ? 'in' : 'varying';
    const fragOut = this.isWebGL2 ? 'fragColor' : 'gl_FragColor';
    const fragOutDecl = this.isWebGL2 ? 'out vec4 fragColor;' : '';
    
    // Vertex shader for solid/wireframe rendering
    const vertexSource = versionPrefix + `precision highp float;

${inAttr} vec3 aPosition;
${inAttr} vec3 aNormal;
${inAttr} float aIntensity;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform float uPointSize;

${outVar} vec3 vNormal;
${outVar} vec3 vPosition;
${outVar} float vIntensity;
${outVar} float vDepth;

void main() {
  vec4 worldPos = uModel * vec4(aPosition, 1.0);
  vPosition = worldPos.xyz;
  vNormal = mat3(uModel) * aNormal;
  vIntensity = aIntensity;
  vDepth = aPosition.z; // Time depth
  
  gl_Position = uProjection * uView * worldPos;
  // Point size - use uniform for control, slightly larger for high intensity points
  gl_PointSize = uPointSize * (0.7 + aIntensity * 0.6);
}
`;

    // Fragment shader - clean visualization for nodal lines building through time
    const fragmentSource = versionPrefix + `precision highp float;

${inVar} vec3 vNormal;
${inVar} vec3 vPosition;
${inVar} float vIntensity;
${inVar} float vDepth;

uniform vec3 uCameraPos;
uniform float uOpacity;
uniform float uMaxDepth;
uniform int uStyle; // 0=solid, 1=wireframe, 2=points, 3=slices

${fragOutDecl}

// HSV to RGB for smooth color transitions
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(uCameraPos - vPosition);
  
  // Normalized depth (0 = oldest, 1 = newest)
  float normalizedDepth = vDepth / max(uMaxDepth, 0.1);
  
  // Color: older slices are cooler (blue/purple), newer are warmer (orange/yellow)
  float hue = 0.7 - normalizedDepth * 0.5; // Blue (0.7) to orange (0.2)
  float sat = 0.6 + vIntensity * 0.3;
  float val = 0.7 + vIntensity * 0.3 + normalizedDepth * 0.2; // Newer = brighter
  vec3 color = hsv2rgb(vec3(hue, sat, val));
  
  // Fade older slices slightly  
  float ageFade = 0.4 + normalizedDepth * 0.6;
  color *= ageFade;
  
  // Simple lighting
  float light = 0.6 + 0.4 * max(dot(normal, normalize(vec3(0.3, 0.5, 1.0))), 0.0);
  
  // Glow on newest points
  if (normalizedDepth > 0.95) {
    color += vec3(0.3, 0.2, 0.1) * vIntensity;
  }
  
  // Full opacity for strong nodal points
  float alpha = uOpacity * (0.5 + vIntensity * 0.5) * ageFade;
  
  // Round points for cleaner look
  if (uStyle == 2) {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    // Soft edge
    alpha *= smoothstep(0.5, 0.3, dist);
  }
  
  ${fragOut} = vec4(color * light, alpha);
}
`;

    // Compile shaders
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    
    if (!vertexShader || !fragmentShader) {
      console.error('Spacetime sculpture shader compilation failed');
      return;
    }
    
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);
    
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error('Shader link error:', gl.getProgramInfoLog(this.program));
      return;
    }
    
    // Get locations
    this.attributes.position = gl.getAttribLocation(this.program, 'aPosition');
    this.attributes.normal = gl.getAttribLocation(this.program, 'aNormal');
    this.attributes.intensity = gl.getAttribLocation(this.program, 'aIntensity');
    
    this.uniforms.model = gl.getUniformLocation(this.program, 'uModel');
    this.uniforms.view = gl.getUniformLocation(this.program, 'uView');
    this.uniforms.projection = gl.getUniformLocation(this.program, 'uProjection');
    this.uniforms.cameraPos = gl.getUniformLocation(this.program, 'uCameraPos');
    this.uniforms.opacity = gl.getUniformLocation(this.program, 'uOpacity');
    this.uniforms.style = gl.getUniformLocation(this.program, 'uStyle');
    this.uniforms.pointSize = gl.getUniformLocation(this.program, 'uPointSize');
    this.uniforms.maxDepth = gl.getUniformLocation(this.program, 'uMaxDepth');
    
    // Create line shader for contour rendering
    this.createLineShader();
    
    console.log('Spacetime sculpture shaders initialized');
  }
  
  createLineShader() {
    const gl = this.gl;
    
    const versionPrefix = this.isWebGL2 ? '#version 300 es\n' : '';
    const inAttr = this.isWebGL2 ? 'in' : 'attribute';
    const outVar = this.isWebGL2 ? 'out' : 'varying';
    const inVar = this.isWebGL2 ? 'in' : 'varying';
    const fragOut = this.isWebGL2 ? 'fragColor' : 'gl_FragColor';
    const fragOutDecl = this.isWebGL2 ? 'out vec4 fragColor;' : '';
    
    // Line vertex shader - simpler, just position and depth
    const lineVertexSource = versionPrefix + `precision highp float;

${inAttr} vec3 aPosition;
${inAttr} float aIntensity;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;

${outVar} float vDepth;
${outVar} float vIntensity;

void main() {
  vec4 worldPos = uModel * vec4(aPosition, 1.0);
  vDepth = aPosition.z;
  vIntensity = aIntensity;
  gl_Position = uProjection * uView * worldPos;
}
`;

    // Line fragment shader - glowing lines
    const lineFragmentSource = versionPrefix + `precision highp float;

${inVar} float vDepth;
${inVar} float vIntensity;

uniform float uOpacity;
uniform float uMaxDepth;
uniform float uGlowIntensity;

${fragOutDecl}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  float normalizedDepth = vDepth / max(uMaxDepth, 0.1);
  
  // Color gradient through time
  float hue = 0.65 - normalizedDepth * 0.45; // Blue-purple to orange
  float sat = 0.7;
  float val = 0.8 + normalizedDepth * 0.2;
  vec3 color = hsv2rgb(vec3(hue, sat, val));
  
  // Glow effect - brighter core
  color *= (1.0 + uGlowIntensity * vIntensity);
  
  // Fade older slices
  float ageFade = 0.5 + normalizedDepth * 0.5;
  
  float alpha = uOpacity * ageFade;
  
  ${fragOut} = vec4(color, alpha);
}
`;

    const lineVS = this.compileShader(gl.VERTEX_SHADER, lineVertexSource);
    const lineFS = this.compileShader(gl.FRAGMENT_SHADER, lineFragmentSource);
    
    if (!lineVS || !lineFS) {
      console.error('Line shader compilation failed');
      return;
    }
    
    this.lineProgram = gl.createProgram();
    gl.attachShader(this.lineProgram, lineVS);
    gl.attachShader(this.lineProgram, lineFS);
    gl.linkProgram(this.lineProgram);
    
    if (!gl.getProgramParameter(this.lineProgram, gl.LINK_STATUS)) {
      console.error('Line shader link error:', gl.getProgramInfoLog(this.lineProgram));
      return;
    }
    
    // Get line shader locations
    this.lineAttributes.position = gl.getAttribLocation(this.lineProgram, 'aPosition');
    this.lineAttributes.intensity = gl.getAttribLocation(this.lineProgram, 'aIntensity');
    
    this.lineUniforms.model = gl.getUniformLocation(this.lineProgram, 'uModel');
    this.lineUniforms.view = gl.getUniformLocation(this.lineProgram, 'uView');
    this.lineUniforms.projection = gl.getUniformLocation(this.lineProgram, 'uProjection');
    this.lineUniforms.opacity = gl.getUniformLocation(this.lineProgram, 'uOpacity');
    this.lineUniforms.maxDepth = gl.getUniformLocation(this.lineProgram, 'uMaxDepth');
    this.lineUniforms.glowIntensity = gl.getUniformLocation(this.lineProgram, 'uGlowIntensity');
    
    // Create particle shader
    this.createParticleShader();
    
    // Create ribbon shader
    this.createRibbonShader();
  }
  
  createParticleShader() {
    const gl = this.gl;
    
    const versionPrefix = this.isWebGL2 ? '#version 300 es\n' : '';
    const inAttr = this.isWebGL2 ? 'in' : 'attribute';
    const outVar = this.isWebGL2 ? 'out' : 'varying';
    const inVar = this.isWebGL2 ? 'in' : 'varying';
    const fragOut = this.isWebGL2 ? 'fragColor' : 'gl_FragColor';
    const fragOutDecl = this.isWebGL2 ? 'out vec4 fragColor;' : '';
    
    // Particle vertex shader
    const particleVertexSource = versionPrefix + `precision highp float;

${inAttr} vec3 aPosition;
${inAttr} float aAge;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform float uPointSize;
uniform float uMaxDepth;

${outVar} float vDepth;
${outVar} float vAge;

void main() {
  vec4 worldPos = uModel * vec4(aPosition, 1.0);
  vDepth = aPosition.z;
  vAge = aAge;
  gl_Position = uProjection * uView * worldPos;
  
  // Size based on depth - newer particles larger
  float depthFactor = vDepth / max(uMaxDepth, 0.1);
  gl_PointSize = uPointSize * (0.5 + depthFactor * 1.0);
}
`;

    // Particle fragment shader - glowing particles
    const particleFragmentSource = versionPrefix + `precision highp float;

${inVar} float vDepth;
${inVar} float vAge;

uniform float uOpacity;
uniform float uMaxDepth;

${fragOutDecl}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  // Round particles
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;
  
  float normalizedDepth = vDepth / max(uMaxDepth, 0.1);
  
  // Color: older = blue/purple, newer = orange/yellow/white
  float hue = 0.15 - normalizedDepth * 0.1; // Orange to yellow
  float sat = 0.8 - normalizedDepth * 0.3;  // Less saturated when new
  float val = 0.7 + normalizedDepth * 0.3;  // Brighter when new
  vec3 color = hsv2rgb(vec3(hue, sat, val));
  
  // Glow - bright center
  float glow = 1.0 - smoothstep(0.0, 0.5, dist);
  color *= (0.8 + glow * 0.5);
  
  // Fade based on age and depth
  float ageFade = 0.3 + normalizedDepth * 0.7;
  float alpha = uOpacity * ageFade * smoothstep(0.5, 0.3, dist);
  
  ${fragOut} = vec4(color, alpha);
}
`;

    const particleVS = this.compileShader(gl.VERTEX_SHADER, particleVertexSource);
    const particleFS = this.compileShader(gl.FRAGMENT_SHADER, particleFragmentSource);
    
    if (!particleVS || !particleFS) {
      console.error('Particle shader compilation failed');
      return;
    }
    
    this.particleProgram = gl.createProgram();
    gl.attachShader(this.particleProgram, particleVS);
    gl.attachShader(this.particleProgram, particleFS);
    gl.linkProgram(this.particleProgram);
    
    if (!gl.getProgramParameter(this.particleProgram, gl.LINK_STATUS)) {
      console.error('Particle shader link error:', gl.getProgramInfoLog(this.particleProgram));
      return;
    }
    
    // Get particle shader locations
    this.particleAttributes.position = gl.getAttribLocation(this.particleProgram, 'aPosition');
    this.particleAttributes.age = gl.getAttribLocation(this.particleProgram, 'aAge');
    
    this.particleUniforms.model = gl.getUniformLocation(this.particleProgram, 'uModel');
    this.particleUniforms.view = gl.getUniformLocation(this.particleProgram, 'uView');
    this.particleUniforms.projection = gl.getUniformLocation(this.particleProgram, 'uProjection');
    this.particleUniforms.pointSize = gl.getUniformLocation(this.particleProgram, 'uPointSize');
    this.particleUniforms.opacity = gl.getUniformLocation(this.particleProgram, 'uOpacity');
    this.particleUniforms.maxDepth = gl.getUniformLocation(this.particleProgram, 'uMaxDepth');
    
    console.log('Particle shader initialized');
  }
  
  createRibbonShader() {
    const gl = this.gl;
    
    const versionPrefix = this.isWebGL2 ? '#version 300 es\n' : '';
    const inAttr = this.isWebGL2 ? 'in' : 'attribute';
    const outVar = this.isWebGL2 ? 'out' : 'varying';
    const inVar = this.isWebGL2 ? 'in' : 'varying';
    const fragOut = this.isWebGL2 ? 'fragColor' : 'gl_FragColor';
    const fragOutDecl = this.isWebGL2 ? 'out vec4 fragColor;' : '';

    // Ribbon vertex shader - triangles with normals for lighting
    const ribbonVertexSource = versionPrefix + `precision highp float;

${inAttr} vec3 aPosition;
${inAttr} vec3 aNormal;
${inAttr} float aIntensity;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform float uMaxDepth;

${outVar} vec3 vNormal;
${outVar} vec3 vWorldPos;
${outVar} float vDepth;
${outVar} float vIntensity;

void main() {
  vec4 worldPos = uModel * vec4(aPosition, 1.0);
  vWorldPos = worldPos.xyz;
  vNormal = mat3(uModel) * aNormal;
  vDepth = aPosition.z;
  vIntensity = aIntensity;
  gl_Position = uProjection * uView * worldPos;
}
`;

    // Ribbon fragment shader - lit surface with depth coloring
    const ribbonFragmentSource = versionPrefix + `precision highp float;

${inVar} vec3 vNormal;
${inVar} vec3 vWorldPos;
${inVar} float vDepth;
${inVar} float vIntensity;

uniform float uOpacity;
uniform float uMaxDepth;
uniform vec3 uLightDir;

${fragOutDecl}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  float normalizedDepth = vDepth / max(uMaxDepth, 0.1);
  
  // Color based on depth through time - cyan to magenta gradient
  float hue = 0.5 + normalizedDepth * 0.35; // Cyan to magenta
  float sat = 0.7;
  float val = 0.8 + vIntensity * 0.2;
  vec3 baseColor = hsv2rgb(vec3(hue, sat, val));
  
  // Simple diffuse lighting
  vec3 normal = normalize(vNormal);
  float diffuse = max(dot(normal, normalize(uLightDir)), 0.0);
  float ambient = 0.3;
  float lighting = ambient + diffuse * 0.7;
  
  vec3 color = baseColor * lighting;
  
  // Fade older ribbons slightly
  float depthFade = 0.5 + normalizedDepth * 0.5;
  
  ${fragOut} = vec4(color, uOpacity * depthFade);
}
`;

    const ribbonVS = this.compileShader(gl.VERTEX_SHADER, ribbonVertexSource);
    const ribbonFS = this.compileShader(gl.FRAGMENT_SHADER, ribbonFragmentSource);
    
    if (!ribbonVS || !ribbonFS) {
      console.error('Ribbon shader compilation failed');
      return;
    }
    
    this.ribbonProgram = gl.createProgram();
    gl.attachShader(this.ribbonProgram, ribbonVS);
    gl.attachShader(this.ribbonProgram, ribbonFS);
    gl.linkProgram(this.ribbonProgram);
    
    if (!gl.getProgramParameter(this.ribbonProgram, gl.LINK_STATUS)) {
      console.error('Ribbon shader link error:', gl.getProgramInfoLog(this.ribbonProgram));
      return;
    }
    
    // Get ribbon shader locations
    this.ribbonAttributes.position = gl.getAttribLocation(this.ribbonProgram, 'aPosition');
    this.ribbonAttributes.normal = gl.getAttribLocation(this.ribbonProgram, 'aNormal');
    this.ribbonAttributes.intensity = gl.getAttribLocation(this.ribbonProgram, 'aIntensity');
    
    this.ribbonUniforms.model = gl.getUniformLocation(this.ribbonProgram, 'uModel');
    this.ribbonUniforms.view = gl.getUniformLocation(this.ribbonProgram, 'uView');
    this.ribbonUniforms.projection = gl.getUniformLocation(this.ribbonProgram, 'uProjection');
    this.ribbonUniforms.opacity = gl.getUniformLocation(this.ribbonProgram, 'uOpacity');
    this.ribbonUniforms.maxDepth = gl.getUniformLocation(this.ribbonProgram, 'uMaxDepth');
    this.ribbonUniforms.lightDir = gl.getUniformLocation(this.ribbonProgram, 'uLightDir');
    
    // Create ribbon buffer
    this.ribbonBuffer = gl.createBuffer();
    
    console.log('Ribbon shader initialized');
  }
  
  compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
  
  createBuffers() {
    const gl = this.gl;
    this.vertexBuffer = gl.createBuffer();
    this.lineBuffer = gl.createBuffer();
    this.particleBuffer = gl.createBuffer();
    this.indexBuffer = gl.createBuffer();
  }
  
  /**
   * Initialize particle system
   */
  initParticles() {
    // Each particle: x, y, vx, vy (4 floats)
    this.particles = new Float32Array(this.particleCount * 4);
    
    // Initialize particles randomly across the membrane surface
    for (let i = 0; i < this.particleCount; i++) {
      const idx = i * 4;
      // Random position in [-0.8, 0.8] (avoid edges)
      this.particles[idx + 0] = (Math.random() - 0.5) * 1.6; // x
      this.particles[idx + 1] = (Math.random() - 0.5) * 1.6; // y
      this.particles[idx + 2] = 0; // vx
      this.particles[idx + 3] = 0; // vy
    }
    
    // Initialize trail history
    this.particleTrails = [];
    
    // Energy tracking for shake detection
    this.lastEnergy = 0;
    this.energySmoothed = 0;
    
    console.log(`Initialized ${this.particleCount} particles`);
  }
  
  /**
   * Update particle physics - particles flow toward nodal lines
   * @param {Float32Array} amplitudeGrid - Current membrane amplitude grid
   */
  updateParticles(amplitudeGrid) {
    if (!this.particles || !amplitudeGrid) return;
    
    this.currentAmplitudeGrid = amplitudeGrid;
    const gridSize = this.gridSize;
    
    // Find max amplitude for normalization (excluding boundary region)
    // The boundary is ALWAYS zero due to fixed boundary conditions (sin(0)=0, sin(n*pi)=0)
    // So we need a larger margin to exclude this "fake" nodal region
    const margin = Math.floor(gridSize * 0.15); // 15% margin to exclude boundary zeros
    let maxAmp = 0;
    let totalEnergy = 0;
    for (let iy = margin; iy < gridSize - margin; iy++) {
      for (let ix = margin; ix < gridSize - margin; ix++) {
        const amp = Math.abs(amplitudeGrid[iy * gridSize + ix]);
        maxAmp = Math.max(maxAmp, amp);
        totalEnergy += amp * amp;
      }
    }
    if (maxAmp < 0.0001) maxAmp = 0.0001;
    
    // Detect sudden energy increase (new strike/chord)
    this.energySmoothed = this.energySmoothed * 0.95 + totalEnergy * 0.05;
    const energySpike = totalEnergy > this.energySmoothed * 2.5 && totalEnergy > this.lastEnergy * 1.5;
    this.lastEnergy = totalEnergy;
    
    // If energy spike detected, shake particles
    const shakeStrength = energySpike ? this.particleShakeStrength : 0;
    
    // Update each particle
    for (let i = 0; i < this.particleCount; i++) {
      const idx = i * 4;
      let x = this.particles[idx + 0];
      let y = this.particles[idx + 1];
      let vx = this.particles[idx + 2];
      let vy = this.particles[idx + 3];
      
      // Apply shake on energy spike - random velocity burst
      if (shakeStrength > 0) {
        vx += (Math.random() - 0.5) * shakeStrength;
        vy += (Math.random() - 0.5) * shakeStrength;
      }
      
      // Convert world coords to grid coords
      const gx = (x / 2 + 0.5) * (gridSize - 1);
      const gy = (y / 2 + 0.5) * (gridSize - 1);
      
      // Calculate distance from boundary (in grid units)
      const edgeDist = Math.min(
        gx - margin, gridSize - margin - gx,
        gy - margin, gridSize - margin - gy
      );
      
      // In the boundary region (edgeDist < 0), push particles TOWARD center
      // This counteracts the false attraction to the zero-amplitude boundary
      if (edgeDist < 0) {
        // We're in the boundary zone - push toward center
        const pushStrength = 0.02 * Math.abs(edgeDist) / margin;
        vx -= x * pushStrength; // Push toward x=0 (center)
        vy -= y * pushStrength; // Push toward y=0 (center)
      } else {
        // Safe interior zone - apply nodal line attraction
        const force = this.sampleAmplitudeGradient(amplitudeGrid, gx, gy, gridSize, maxAmp);
        
        // Apply force - move toward lower amplitude (nodal lines)
        vx += force.fx * this.particleForceStrength;
        vy += force.fy * this.particleForceStrength;
      }
      
      // Repel from edges - stronger force pushing particles away from boundary
      const innerBound = this.particleInnerBound;
      if (x < -innerBound) vx += this.particleEdgeRepel * Math.pow(innerBound + x + 1, 2);
      if (x > innerBound) vx -= this.particleEdgeRepel * Math.pow(x - innerBound + 1, 2);
      if (y < -innerBound) vy += this.particleEdgeRepel * Math.pow(innerBound + y + 1, 2);
      if (y > innerBound) vy -= this.particleEdgeRepel * Math.pow(y - innerBound + 1, 2);
      
      // Extra corner repulsion - corners are especially sticky
      const cornerDist = Math.sqrt(x*x + y*y);
      if (cornerDist > 0.9) {
        const cornerRepel = this.particleCornerRepel * (cornerDist - 0.9);
        vx -= cornerRepel * x / cornerDist;
        vy -= cornerRepel * y / cornerDist;
      }
      
      // Add small random motion for natural look
      vx += (Math.random() - 0.5) * this.particleNoise;
      vy += (Math.random() - 0.5) * this.particleNoise;
      
      // Apply damping
      vx *= this.particleDamping;
      vy *= this.particleDamping;
      
      // Update position
      x += vx;
      y += vy;
      
      // Hard boundary clamp (but particles shouldn't reach here due to repulsion)
      const bound = 0.92;
      if (x < -bound) { x = -bound + 0.05; vx = Math.abs(vx) * 0.2 + 0.01; }
      if (x > bound) { x = bound - 0.05; vx = -Math.abs(vx) * 0.2 - 0.01; }
      if (y < -bound) { y = -bound + 0.05; vy = Math.abs(vy) * 0.2 + 0.01; }
      if (y > bound) { y = bound - 0.05; vy = -Math.abs(vy) * 0.2 - 0.01; }
      
      // Store updated values
      this.particles[idx + 0] = x;
      this.particles[idx + 1] = y;
      this.particles[idx + 2] = vx;
      this.particles[idx + 3] = vy;
    }
    
    // Capture particle positions for 3D trail sculpture
    this.particleFrameCount++;
    if (this.isRecording && this.particleFrameCount % this.particleTrailInterval === 0) {
      this.captureParticleTrail();
    }
  }
  
  /**
   * Sample amplitude gradient at a position
   * Returns force vector pointing toward lower amplitude
   */
  sampleAmplitudeGradient(grid, gx, gy, size, maxAmp) {
    // Clamp to grid bounds
    const ix = Math.max(1, Math.min(size - 2, Math.floor(gx)));
    const iy = Math.max(1, Math.min(size - 2, Math.floor(gy)));
    
    // Sample neighbors
    const idx = iy * size + ix;
    const center = Math.abs(grid[idx]) / maxAmp;
    const left = Math.abs(grid[idx - 1]) / maxAmp;
    const right = Math.abs(grid[idx + 1]) / maxAmp;
    const up = Math.abs(grid[idx - size]) / maxAmp;
    const down = Math.abs(grid[idx + size]) / maxAmp;
    
    // Gradient of absolute amplitude (positive = increasing amplitude)
    const gradX = (right - left) * 0.5;
    const gradY = (down - up) * 0.5;
    
    // Force points DOWN the gradient (toward lower amplitude = nodal lines)
    // Scale force by how far from a node we are (stronger force when amplitude is high)
    const ampScale = center * 2;
    
    return {
      fx: -gradX * ampScale,
      fy: -gradY * ampScale
    };
  }
  
  /**
   * Capture current particle positions as a trail slice
   */
  captureParticleTrail() {
    // Store positions as a new slice
    const slice = new Float32Array(this.particleCount * 2);
    for (let i = 0; i < this.particleCount; i++) {
      slice[i * 2 + 0] = this.particles[i * 4 + 0]; // x
      slice[i * 2 + 1] = this.particles[i * 4 + 1]; // y
    }
    
    this.particleTrails.push(slice);
    
    // Limit trail length
    if (this.particleTrails.length > this.maxTrailSlices) {
      this.particleTrails.shift();
    }
    
    this.geometryDirty = true;
  }
  
  /**
   * Generate particle trail geometry for 3D sculpture
   */
  generateParticleGeometry() {
    if (this.particleTrails.length < 2) return;
    
    const trailCount = this.particleTrails.length;
    // Each particle in each slice: position (3) + age (1) = 4 floats
    const vertexData = [];
    
    for (let s = 0; s < trailCount; s++) {
      const slice = this.particleTrails[s];
      const z = s * this.timeScale;
      const age = s / trailCount; // 0 = oldest, 1 = newest
      
      for (let i = 0; i < this.particleCount; i++) {
        const x = slice[i * 2 + 0];
        const y = slice[i * 2 + 1];
        vertexData.push(x, y, z, age);
      }
    }
    
    // Upload to GPU
    const gl = this.gl;
    const data = new Float32Array(vertexData);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    
    this.particleTrailVertexCount = vertexData.length / 4;
    
    if (trailCount % 20 === 0) {
      console.log(`Particle trails: ${trailCount} slices, ${this.particleTrailVertexCount} vertices`);
    }
  }
  
  /**
   * Marching Squares lookup table
   * Each case maps to line segment endpoints (0-3 = edge midpoints)
   * Edge 0: top, Edge 1: right, Edge 2: bottom, Edge 3: left
   */
  getMarchingSquaresEdges(caseIndex) {
    // Returns pairs of edge indices to connect
    const table = [
      [],           // 0: no lines
      [[3, 2]],     // 1: bottom-left corner
      [[2, 1]],     // 2: bottom-right corner
      [[3, 1]],     // 3: bottom edge
      [[0, 1]],     // 4: top-right corner
      [[0, 1], [2, 3]], // 5: saddle - diagonal (ambiguous)
      [[0, 2]],     // 6: right edge
      [[0, 3]],     // 7: all but top-left
      [[0, 3]],     // 8: top-left corner
      [[0, 2]],     // 9: left edge
      [[0, 3], [1, 2]], // 10: saddle - diagonal (ambiguous)
      [[0, 1]],     // 11: all but top-right
      [[3, 1]],     // 12: top edge
      [[2, 1]],     // 13: all but bottom-right
      [[3, 2]],     // 14: all but bottom-left
      []            // 15: all inside, no lines
    ];
    return table[caseIndex] || [];
  }
  
  /**
   * Get edge midpoint position with linear interpolation
   */
  getEdgePoint(edge, x, y, cellSize, v0, v1, v2, v3, threshold) {
    // Edge midpoints: 0=top, 1=right, 2=bottom, 3=left
    // Interpolate along edge to find exact zero crossing
    const lerp = (a, b, va, vb) => {
      const t = (threshold - va) / (vb - va + 0.0001);
      return a + Math.max(0, Math.min(1, t)) * (b - a);
    };
    
    switch (edge) {
      case 0: // Top edge (v0 to v1)
        return [lerp(x, x + cellSize, v0, v1), y];
      case 1: // Right edge (v1 to v2)
        return [x + cellSize, lerp(y, y + cellSize, v1, v2)];
      case 2: // Bottom edge (v3 to v2)
        return [lerp(x, x + cellSize, v3, v2), y + cellSize];
      case 3: // Left edge (v0 to v3)
        return [x, lerp(y, y + cellSize, v0, v3)];
    }
    return [x, y];
  }
  
  /**
   * Add a new amplitude slice to the history
   * @param {Float32Array} amplitudes - 36-element mode amplitude array
   */
  addAmplitudeSlice(amplitudes) {
    // Reconstruct height field from mode amplitudes (always needed for particles)
    const grid = this.reconstructHeightField(amplitudes);
    
    // Update particle physics with current amplitude field
    if (this.renderMode === 'particles') {
      this.updateParticles(grid);
    }
    
    if (!this.isRecording) return;
    
    this.frameCount++;
    if (this.frameCount % this.captureInterval !== 0) return;
    
    // Check if we have any amplitude data
    let maxAmp = 0;
    for (let i = 0; i < amplitudes.length; i++) {
      maxAmp = Math.max(maxAmp, Math.abs(amplitudes[i]));
    }
    
    // Skip if no significant amplitude (but particles still update above)
    if (maxAmp < 0.0001) return;
    
    // Store in circular buffer for other render modes
    const offset = this.currentSlice * this.gridSize * this.gridSize;
    this.amplitudeHistory.set(grid, offset);
    
    this.currentSlice = (this.currentSlice + 1) % this.maxSlices;
    this.totalSlices = Math.min(this.totalSlices + 1, this.maxSlices);
    this.geometryDirty = true;
    
    // Log occasionally
    if (this.totalSlices % 20 === 0) {
      console.log(`Sculpture: ${this.totalSlices} slices captured, max amp: ${maxAmp.toFixed(4)}`);
    }
  }
  
  /**
   * Reconstruct height field from mode amplitudes (CPU version)
   */
  reconstructHeightField(amplitudes) {
    const size = this.gridSize;
    const grid = new Float32Array(size * size);
    const PI = Math.PI;
    
    for (let iy = 0; iy < size; iy++) {
      const y = iy / (size - 1);
      for (let ix = 0; ix < size; ix++) {
        const x = ix / (size - 1);
        let h = 0;
        
        // Sum contributions from all 6x6 modes
        for (let m = 1; m <= 6; m++) {
          const sx = Math.sin(m * PI * x);
          for (let n = 1; n <= 6; n++) {
            const sy = Math.sin(n * PI * y);
            const ampIndex = (m - 1) * 6 + (n - 1);
            if (ampIndex < amplitudes.length) {
              h += amplitudes[ampIndex] * sx * sy;
            }
          }
        }
        
        grid[iy * size + ix] = h;
      }
    }
    
    return grid;
  }
  
  /**
   * Generate 3D geometry from amplitude history
   * Creates nodal lines - detecting edges where amplitude changes sign (zero crossings)
   */
  generateGeometry() {
    if (!this.geometryDirty || this.totalSlices < 2) return;
    
    const sliceCount = this.totalSlices;
    const gridSize = this.gridSize;
    const threshold = this.nodalThreshold;
    
    // Generate point cloud - find NODAL LINES (zero crossings)
    const points = [];
    const normals = [];
    const intensities = [];
    
    // Margin to exclude boundary edges (membrane is fixed at edges, always zero)
    // This is NOT a real nodal line - it's the fixed boundary condition (sin(0)=0)
    const margin = Math.max(4, Math.floor(gridSize * 0.15)); // 15% margin to skip boundary zeros
    
    // Process each slice - find zero-crossing edges (nodal lines)
    for (let s = 0; s < sliceCount; s++) {
      // Calculate actual slice index in circular buffer
      const sliceIndex = (this.currentSlice - sliceCount + s + this.maxSlices) % this.maxSlices;
      const sliceOffset = sliceIndex * gridSize * gridSize;
      const z = s * this.timeScale;
      
      // Find maximum amplitude in this slice for normalization (excluding boundary)
      let sliceMaxAmp = 0;
      for (let iy = margin; iy < gridSize - margin; iy++) {
        for (let ix = margin; ix < gridSize - margin; ix++) {
          sliceMaxAmp = Math.max(sliceMaxAmp, Math.abs(this.amplitudeHistory[sliceOffset + iy * gridSize + ix]));
        }
      }
      
      if (sliceMaxAmp < 0.0001) continue; // Skip silent slices
      
      // Scan for zero-crossings (nodal lines) - excluding boundary
      for (let iy = margin; iy < gridSize - margin; iy++) {
        for (let ix = margin; ix < gridSize - margin; ix++) {
          const idx = iy * gridSize + ix;
          const amp = this.amplitudeHistory[sliceOffset + idx];
          const normalizedAmp = amp / sliceMaxAmp;
          
          // Check neighbors for sign changes (zero crossing = nodal line)
          const left = this.amplitudeHistory[sliceOffset + idx - 1] / sliceMaxAmp;
          const right = this.amplitudeHistory[sliceOffset + idx + 1] / sliceMaxAmp;
          const up = this.amplitudeHistory[sliceOffset + idx - gridSize] / sliceMaxAmp;
          const down = this.amplitudeHistory[sliceOffset + idx + gridSize] / sliceMaxAmp;
          
          // Is this point on a nodal line? (sign change with neighbor OR very low amplitude)
          const isZeroCrossingH = (normalizedAmp * left < 0) || (normalizedAmp * right < 0);
          const isZeroCrossingV = (normalizedAmp * up < 0) || (normalizedAmp * down < 0);
          const isLowAmp = Math.abs(normalizedAmp) < threshold;
          
          // Include point if it's a zero crossing or very close to zero
          if ((isZeroCrossingH || isZeroCrossingV) || isLowAmp) {
            const x = (ix / gridSize - 0.5) * 2;
            const y = (iy / gridSize - 0.5) * 2;
            
            // Calculate gradient for normal
            const gradX = right - left;
            const gradY = down - up;
            const gradLen = Math.sqrt(gradX*gradX + gradY*gradY + 1) || 1;
            
            points.push(x, y, z);
            normals.push(gradX/gradLen, gradY/gradLen, 1/gradLen);
            
            // Intensity based on how close to zero
            const nodalIntensity = 1.0 - Math.min(Math.abs(normalizedAmp) / threshold, 1.0);
            intensities.push(nodalIntensity);
          }
        }
      }
    }
    
    // Create interleaved buffer: position (3) + normal (3) + intensity (1) = 7 floats per vertex
    this.vertexCount = points.length / 3;
    
    if (this.vertexCount === 0) {
      console.log('No points generated');
      this.geometryDirty = false;
      return;
    }
    
    const vertexData = new Float32Array(this.vertexCount * 7);
    
    for (let i = 0; i < this.vertexCount; i++) {
      vertexData[i * 7 + 0] = points[i * 3 + 0];
      vertexData[i * 7 + 1] = points[i * 3 + 1];
      vertexData[i * 7 + 2] = points[i * 3 + 2];
      vertexData[i * 7 + 3] = normals[i * 3 + 0];
      vertexData[i * 7 + 4] = normals[i * 3 + 1];
      vertexData[i * 7 + 5] = normals[i * 3 + 2];
      vertexData[i * 7 + 6] = intensities[i];
    }
    
    // Upload to GPU
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);
    
    this.geometryDirty = false;
    
    console.log(`Spacetime sculpture: ${this.vertexCount} points from ${sliceCount} slices`);
  }
  
  /**
   * Generate contour line geometry using Marching Squares
   * Creates precise nodal lines at zero crossings
   */
  generateContourGeometry() {
    if (!this.geometryDirty || this.totalSlices < 2) return;
    
    const sliceCount = this.totalSlices;
    const gridSize = this.gridSize;
    
    // Line vertices: position (3) + intensity (1) = 4 floats per vertex
    const lineVerts = [];
    
    // Margin to exclude boundary - fixed boundary is always zero, not a real nodal line
    const margin = Math.max(4, Math.floor(gridSize * 0.15));
    const cellSize = 1.0 / gridSize;
    
    // Process each time slice
    for (let s = 0; s < sliceCount; s++) {
      const sliceIndex = (this.currentSlice - sliceCount + s + this.maxSlices) % this.maxSlices;
      const sliceOffset = sliceIndex * gridSize * gridSize;
      const z = s * this.timeScale;
      
      // Find max amplitude in slice for normalization
      let sliceMaxAmp = 0;
      for (let iy = margin; iy < gridSize - margin; iy++) {
        for (let ix = margin; ix < gridSize - margin; ix++) {
          sliceMaxAmp = Math.max(sliceMaxAmp, Math.abs(this.amplitudeHistory[sliceOffset + iy * gridSize + ix]));
        }
      }
      
      if (sliceMaxAmp < 0.0001) continue;
      
      // Marching squares on each cell
      for (let iy = margin; iy < gridSize - margin - 1; iy++) {
        for (let ix = margin; ix < gridSize - margin - 1; ix++) {
          // Get corner values (normalized)
          const idx = iy * gridSize + ix;
          const v0 = this.amplitudeHistory[sliceOffset + idx] / sliceMaxAmp;                    // top-left
          const v1 = this.amplitudeHistory[sliceOffset + idx + 1] / sliceMaxAmp;                // top-right
          const v2 = this.amplitudeHistory[sliceOffset + idx + 1 + gridSize] / sliceMaxAmp;    // bottom-right
          const v3 = this.amplitudeHistory[sliceOffset + idx + gridSize] / sliceMaxAmp;        // bottom-left
          
          // Determine case (0-15) based on which corners are above/below zero
          const threshold = 0; // We're looking for zero crossings
          let caseIndex = 0;
          if (v0 > threshold) caseIndex |= 1;
          if (v1 > threshold) caseIndex |= 2;
          if (v2 > threshold) caseIndex |= 4;
          if (v3 > threshold) caseIndex |= 8;
          
          // Get line segments for this case
          const edges = this.getMarchingSquaresEdges(caseIndex);
          
          // Cell position in world coords
          const cellX = (ix / gridSize - 0.5) * 2;
          const cellY = (iy / gridSize - 0.5) * 2;
          const worldCellSize = 2.0 / gridSize;
          
          // Generate line segment vertices
          for (const [e1, e2] of edges) {
            const p1 = this.getEdgePoint(e1, cellX, cellY, worldCellSize, v0, v1, v2, v3, threshold);
            const p2 = this.getEdgePoint(e2, cellX, cellY, worldCellSize, v0, v1, v2, v3, threshold);
            
            // Calculate intensity based on gradient strength at this location
            const avgAmp = (Math.abs(v0) + Math.abs(v1) + Math.abs(v2) + Math.abs(v3)) / 4;
            const intensity = Math.min(1.0, avgAmp * 2); // Stronger gradient = brighter line
            
            // Add line segment (2 vertices)
            lineVerts.push(p1[0], p1[1], z, intensity);
            lineVerts.push(p2[0], p2[1], z, intensity);
          }
        }
      }
    }
    
    // Upload line geometry
    this.lineVertexCount = lineVerts.length / 4;
    
    if (this.lineVertexCount > 0) {
      const gl = this.gl;
      const lineData = new Float32Array(lineVerts);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, lineData, gl.DYNAMIC_DRAW);
      console.log(`Contours: ${this.lineVertexCount / 2} line segments from ${sliceCount} slices`);
    }
    
    // Generate ribbons if in ribbon mode
    if (this.renderMode === 'ribbons') {
      this.generateRibbonGeometry();
    }
  }
  
  /**
   * Generate ribbon geometry by connecting contour lines between adjacent slices
   * Creates triangle strips for a solid surface effect
   */
  generateRibbonGeometry() {
    if (this.totalSlices < 3) return;
    
    const sliceCount = this.totalSlices;
    const gridSize = this.gridSize;
    
    // Ribbon vertices: position (3) + normal (3) + intensity (1) = 7 floats per vertex
    const ribbonVerts = [];
    
    const margin = Math.max(4, Math.floor(gridSize * 0.15));
    
    // We'll create ribbons by extruding contour line segments through time
    // For each slice pair (s, s+1), connect the contour segments with quads
    
    for (let s = 0; s < sliceCount - 1; s++) {
      const sliceIndex0 = (this.currentSlice - sliceCount + s + this.maxSlices) % this.maxSlices;
      const sliceIndex1 = (this.currentSlice - sliceCount + s + 1 + this.maxSlices) % this.maxSlices;
      const sliceOffset0 = sliceIndex0 * gridSize * gridSize;
      const sliceOffset1 = sliceIndex1 * gridSize * gridSize;
      const z0 = s * this.timeScale;
      const z1 = (s + 1) * this.timeScale;
      
      // Find max amplitude for normalization
      let sliceMaxAmp0 = 0, sliceMaxAmp1 = 0;
      for (let iy = margin; iy < gridSize - margin; iy++) {
        for (let ix = margin; ix < gridSize - margin; ix++) {
          sliceMaxAmp0 = Math.max(sliceMaxAmp0, Math.abs(this.amplitudeHistory[sliceOffset0 + iy * gridSize + ix]));
          sliceMaxAmp1 = Math.max(sliceMaxAmp1, Math.abs(this.amplitudeHistory[sliceOffset1 + iy * gridSize + ix]));
        }
      }
      
      if (sliceMaxAmp0 < 0.0001 || sliceMaxAmp1 < 0.0001) continue;
      
      // For each cell, find contour segments and create ribbon quads
      for (let iy = margin; iy < gridSize - margin - 1; iy++) {
        for (let ix = margin; ix < gridSize - margin - 1; ix++) {
          // Get contour segments from both slices at this cell
          const segments0 = this.getContourSegments(sliceOffset0, ix, iy, gridSize, sliceMaxAmp0);
          const segments1 = this.getContourSegments(sliceOffset1, ix, iy, gridSize, sliceMaxAmp1);
          
          // Cell position
          const cellX = (ix / gridSize - 0.5) * 2;
          const cellY = (iy / gridSize - 0.5) * 2;
          const worldCellSize = 2.0 / gridSize;
          
          // Match segments between slices and create ribbons
          // Simple approach: create a quad for each segment pair
          const numSegs = Math.min(segments0.length, segments1.length);
          for (let si = 0; si < numSegs; si++) {
            const seg0 = segments0[si];
            const seg1 = segments1[si];
            
            // Two triangles forming a quad between the two line segments
            // seg0 is at z0, seg1 is at z1
            const p0 = [seg0.x1, seg0.y1, z0];
            const p1 = [seg0.x2, seg0.y2, z0];
            const p2 = [seg1.x1, seg1.y1, z1];
            const p3 = [seg1.x2, seg1.y2, z1];
            
            // Calculate normal (cross product of edges)
            const edge1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
            const edge2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
            const normal = [
              edge1[1] * edge2[2] - edge1[2] * edge2[1],
              edge1[2] * edge2[0] - edge1[0] * edge2[2],
              edge1[0] * edge2[1] - edge1[1] * edge2[0]
            ];
            const len = Math.sqrt(normal[0]*normal[0] + normal[1]*normal[1] + normal[2]*normal[2]) || 1;
            normal[0] /= len;
            normal[1] /= len;
            normal[2] /= len;
            
            const intensity = (seg0.intensity + seg1.intensity) * 0.5;
            
            // Triangle 1: p0, p1, p2
            ribbonVerts.push(p0[0], p0[1], p0[2], normal[0], normal[1], normal[2], intensity);
            ribbonVerts.push(p1[0], p1[1], p1[2], normal[0], normal[1], normal[2], intensity);
            ribbonVerts.push(p2[0], p2[1], p2[2], normal[0], normal[1], normal[2], intensity);
            
            // Triangle 2: p1, p3, p2
            ribbonVerts.push(p1[0], p1[1], p1[2], normal[0], normal[1], normal[2], intensity);
            ribbonVerts.push(p3[0], p3[1], p3[2], normal[0], normal[1], normal[2], intensity);
            ribbonVerts.push(p2[0], p2[1], p2[2], normal[0], normal[1], normal[2], intensity);
          }
        }
      }
    }
    
    // Upload ribbon geometry
    this.ribbonVertexCount = ribbonVerts.length / 7;
    
    if (this.ribbonVertexCount > 0) {
      const gl = this.gl;
      const ribbonData = new Float32Array(ribbonVerts);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, ribbonData, gl.DYNAMIC_DRAW);
      console.log(`Ribbons: ${this.ribbonVertexCount / 3} triangles from ${sliceCount} slices`);
    }
  }
  
  /**
   * Get contour line segments for a cell using marching squares
   */
  getContourSegments(sliceOffset, ix, iy, gridSize, maxAmp) {
    const segments = [];
    const idx = iy * gridSize + ix;
    
    // Get corner values
    const v0 = this.amplitudeHistory[sliceOffset + idx] / maxAmp;
    const v1 = this.amplitudeHistory[sliceOffset + idx + 1] / maxAmp;
    const v2 = this.amplitudeHistory[sliceOffset + idx + 1 + gridSize] / maxAmp;
    const v3 = this.amplitudeHistory[sliceOffset + idx + gridSize] / maxAmp;
    
    // Marching squares case
    const threshold = 0;
    let caseIndex = 0;
    if (v0 > threshold) caseIndex |= 1;
    if (v1 > threshold) caseIndex |= 2;
    if (v2 > threshold) caseIndex |= 4;
    if (v3 > threshold) caseIndex |= 8;
    
    const edges = this.getMarchingSquaresEdges(caseIndex);
    
    // Cell position in world coords
    const cellX = (ix / gridSize - 0.5) * 2;
    const cellY = (iy / gridSize - 0.5) * 2;
    const worldCellSize = 2.0 / gridSize;
    
    for (const [e1, e2] of edges) {
      const p1 = this.getEdgePoint(e1, cellX, cellY, worldCellSize, v0, v1, v2, v3, threshold);
      const p2 = this.getEdgePoint(e2, cellX, cellY, worldCellSize, v0, v1, v2, v3, threshold);
      
      const avgAmp = (Math.abs(v0) + Math.abs(v1) + Math.abs(v2) + Math.abs(v3)) / 4;
      const intensity = Math.min(1.0, avgAmp * 2);
      
      segments.push({
        x1: p1[0], y1: p1[1],
        x2: p2[0], y2: p2[1],
        intensity: intensity
      });
    }
    
    return segments;
  }
  
  sampleGradientX(offset, ix, iy, size) {
    const left = ix > 0 ? this.amplitudeHistory[offset + iy * size + ix - 1] : 0;
    const right = ix < size - 1 ? this.amplitudeHistory[offset + iy * size + ix + 1] : 0;
    return right - left;
  }
  
  sampleGradientY(offset, ix, iy, size) {
    const up = iy > 0 ? this.amplitudeHistory[offset + (iy - 1) * size + ix] : 0;
    const down = iy < size - 1 ? this.amplitudeHistory[offset + (iy + 1) * size + ix] : 0;
    return down - up;
  }
  
  /**
   * Render the spacetime sculpture
   */
  render(time) {
    const gl = this.gl;
    
    // Ensure canvas is sized properly
    if (this.canvas.width === 0 || this.canvas.height === 0) {
      this.resize();
    }
    
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    // Regenerate geometry if needed based on render mode
    if (this.totalSlices >= 2 && this.geometryDirty) {
      if (this.renderMode === 'contours' || this.renderMode === 'ribbons') {
        this.generateContourGeometry();
      }
      if (this.renderMode === 'particles') {
        this.generateParticleGeometry();
      }
      this.generateGeometry(); // Always generate points as fallback
      this.geometryDirty = false;
    }
    
    // Check if we have data to render
    const hasPointData = this.vertexCount > 0;
    const hasLineData = this.lineVertexCount > 0;
    const hasParticleData = this.particleTrailVertexCount > 0;
    const hasRibbonData = this.ribbonVertexCount > 0;
    
    if (!hasPointData && !hasLineData && !hasParticleData && !hasRibbonData) {
      return;
    }
    
    // Auto-rotate
    if (this.autoRotate) {
      this.cameraTheta += this.autoRotateSpeed * 0.016;
    }
    
    // Camera position
    const cosP = Math.cos(this.cameraPhi);
    const sinP = Math.sin(this.cameraPhi);
    const cosT = Math.cos(this.cameraTheta);
    const sinT = Math.sin(this.cameraTheta);
    
    const camX = sinT * cosP * this.cameraDistance;
    const camY = cosT * cosP * this.cameraDistance;
    const camZ = sinP * this.cameraDistance + this.totalSlices * this.timeScale * 0.5;
    
    // Build matrices
    const targetZ = this.totalSlices * this.timeScale * 0.5;
    this.lookAt(this.viewMatrix, [camX, camY, camZ], [0, 0, targetZ], [0, 0, 1]);
    
    const aspect = this.canvas.width / this.canvas.height;
    this.perspective(this.projMatrix, Math.PI / 4, aspect, 0.1, 100);
    this.identity(this.modelMatrix);
    
    // Render based on mode
    if (this.renderMode === 'particles' && hasParticleData) {
      this.renderParticles(camX, camY, camZ);
    } else if (this.renderMode === 'ribbons' && hasRibbonData) {
      this.renderRibbons(camX, camY, camZ);
    } else if (this.renderMode === 'contours' && hasLineData) {
      this.renderContours(camX, camY, camZ);
    } else if (this.renderMode === 'points' && hasPointData) {
      this.renderPoints(camX, camY, camZ);
    } else if (hasParticleData && this.renderMode === 'particles') {
      this.renderParticles(camX, camY, camZ);
    } else if (hasRibbonData && this.renderMode === 'ribbons') {
      this.renderRibbons(camX, camY, camZ);
    } else if (hasLineData) {
      // Fallback to contours if available
      this.renderContours(camX, camY, camZ);
    } else if (hasPointData) {
      // Fallback to points
      this.renderPoints(camX, camY, camZ);
    }
  }
  
  /**
   * Render as point cloud
   */
  renderPoints(camX, camY, camZ) {
    const gl = this.gl;
    
    gl.useProgram(this.program);
    
    // Set uniforms
    gl.uniformMatrix4fv(this.uniforms.model, false, this.modelMatrix);
    gl.uniformMatrix4fv(this.uniforms.view, false, this.viewMatrix);
    gl.uniformMatrix4fv(this.uniforms.projection, false, this.projMatrix);
    gl.uniform3f(this.uniforms.cameraPos, camX, camY, camZ);
    gl.uniform1f(this.uniforms.opacity, this.sculptureOpacity);
    gl.uniform1f(this.uniforms.pointSize, this.pointSize);
    gl.uniform1f(this.uniforms.maxDepth, this.totalSlices * this.timeScale);
    gl.uniform1i(this.uniforms.style, 2); // Points style
    
    // Bind vertex buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    
    const stride = 7 * 4; // 7 floats * 4 bytes
    
    if (this.attributes.position >= 0) {
      gl.enableVertexAttribArray(this.attributes.position);
      gl.vertexAttribPointer(this.attributes.position, 3, gl.FLOAT, false, stride, 0);
    }
    if (this.attributes.normal >= 0) {
      gl.enableVertexAttribArray(this.attributes.normal);
      gl.vertexAttribPointer(this.attributes.normal, 3, gl.FLOAT, false, stride, 12);
    }
    if (this.attributes.intensity >= 0) {
      gl.enableVertexAttribArray(this.attributes.intensity);
      gl.vertexAttribPointer(this.attributes.intensity, 1, gl.FLOAT, false, stride, 24);
    }
    
    gl.drawArrays(gl.POINTS, 0, this.vertexCount);
  }
  
  /**
   * Render as contour lines
   */
  renderContours(camX, camY, camZ) {
    const gl = this.gl;
    
    if (!this.lineProgram) return;
    
    gl.useProgram(this.lineProgram);
    
    // Set uniforms
    gl.uniformMatrix4fv(this.lineUniforms.model, false, this.modelMatrix);
    gl.uniformMatrix4fv(this.lineUniforms.view, false, this.viewMatrix);
    gl.uniformMatrix4fv(this.lineUniforms.projection, false, this.projMatrix);
    gl.uniform1f(this.lineUniforms.opacity, this.sculptureOpacity);
    gl.uniform1f(this.lineUniforms.maxDepth, this.totalSlices * this.timeScale);
    gl.uniform1f(this.lineUniforms.glowIntensity, 0.5);
    
    // Bind line buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    
    const stride = 4 * 4; // 4 floats * 4 bytes (position + intensity)
    
    if (this.lineAttributes.position >= 0) {
      gl.enableVertexAttribArray(this.lineAttributes.position);
      gl.vertexAttribPointer(this.lineAttributes.position, 3, gl.FLOAT, false, stride, 0);
    }
    if (this.lineAttributes.intensity >= 0) {
      gl.enableVertexAttribArray(this.lineAttributes.intensity);
      gl.vertexAttribPointer(this.lineAttributes.intensity, 1, gl.FLOAT, false, stride, 12);
    }
    
    // Set line width (note: may be limited to 1.0 on some platforms)
    gl.lineWidth(this.lineWidth);
    
    // Draw lines
    gl.drawArrays(gl.LINES, 0, this.lineVertexCount);
  }
  
  /**
   * Render ribbons as solid triangles connecting contour slices
   */
  renderRibbons(camX, camY, camZ) {
    const gl = this.gl;
    
    if (!this.ribbonProgram || !this.ribbonVertexCount) return;
    
    gl.useProgram(this.ribbonProgram);
    
    // Set uniforms
    gl.uniformMatrix4fv(this.ribbonUniforms.model, false, this.modelMatrix);
    gl.uniformMatrix4fv(this.ribbonUniforms.view, false, this.viewMatrix);
    gl.uniformMatrix4fv(this.ribbonUniforms.projection, false, this.projMatrix);
    gl.uniform1f(this.ribbonUniforms.opacity, this.sculptureOpacity * 0.8);
    gl.uniform1f(this.ribbonUniforms.maxDepth, this.totalSlices * this.timeScale);
    gl.uniform3f(this.ribbonUniforms.lightDir, 0.5, 0.5, 1.0); // Light from upper right
    
    // Bind ribbon buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuffer);
    
    const stride = 7 * 4; // 7 floats * 4 bytes (position + normal + intensity)
    
    if (this.ribbonAttributes.position >= 0) {
      gl.enableVertexAttribArray(this.ribbonAttributes.position);
      gl.vertexAttribPointer(this.ribbonAttributes.position, 3, gl.FLOAT, false, stride, 0);
    }
    if (this.ribbonAttributes.normal >= 0) {
      gl.enableVertexAttribArray(this.ribbonAttributes.normal);
      gl.vertexAttribPointer(this.ribbonAttributes.normal, 3, gl.FLOAT, false, stride, 12);
    }
    if (this.ribbonAttributes.intensity >= 0) {
      gl.enableVertexAttribArray(this.ribbonAttributes.intensity);
      gl.vertexAttribPointer(this.ribbonAttributes.intensity, 1, gl.FLOAT, false, stride, 24);
    }
    
    // Enable backface culling for cleaner look, but render both sides
    gl.disable(gl.CULL_FACE);
    
    // Draw triangles
    gl.drawArrays(gl.TRIANGLES, 0, this.ribbonVertexCount);
  }
  
  /**
   * Render particle trails as 3D sculpture
   */
  renderParticles(camX, camY, camZ) {
    const gl = this.gl;
    
    if (!this.particleProgram || !this.particleTrailVertexCount) return;
    
    gl.useProgram(this.particleProgram);
    
    // Set uniforms
    gl.uniformMatrix4fv(this.particleUniforms.model, false, this.modelMatrix);
    gl.uniformMatrix4fv(this.particleUniforms.view, false, this.viewMatrix);
    gl.uniformMatrix4fv(this.particleUniforms.projection, false, this.projMatrix);
    gl.uniform1f(this.particleUniforms.pointSize, this.particleSize);
    gl.uniform1f(this.particleUniforms.opacity, this.sculptureOpacity);
    gl.uniform1f(this.particleUniforms.maxDepth, this.particleTrails.length * this.timeScale);
    
    // Bind particle buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
    
    const stride = 4 * 4; // 4 floats * 4 bytes (position xyz + age)
    
    if (this.particleAttributes.position >= 0) {
      gl.enableVertexAttribArray(this.particleAttributes.position);
      gl.vertexAttribPointer(this.particleAttributes.position, 3, gl.FLOAT, false, stride, 0);
    }
    if (this.particleAttributes.age >= 0) {
      gl.enableVertexAttribArray(this.particleAttributes.age);
      gl.vertexAttribPointer(this.particleAttributes.age, 1, gl.FLOAT, false, stride, 12);
    }
    
    // Draw particles
    gl.drawArrays(gl.POINTS, 0, this.particleTrailVertexCount);
  }
  
  /**
   * Export sculpture as STL file
   */
  exportSTL() {
    // For STL export, we need to generate a proper triangle mesh
    // This is a simplified version - a full implementation would use marching cubes
    
    const sliceCount = this.totalSlices;
    const gridSize = this.gridSize;
    const threshold = this.nodalThreshold;
    
    // Collect nodal points
    const points = [];
    
    for (let s = 0; s < sliceCount; s++) {
      const sliceIndex = (this.currentSlice - sliceCount + s + this.maxSlices) % this.maxSlices;
      const sliceOffset = sliceIndex * gridSize * gridSize;
      const z = s * this.timeScale * 50; // Scale up for printing
      
      for (let iy = 1; iy < gridSize - 1; iy++) {
        for (let ix = 1; ix < gridSize - 1; ix++) {
          const amp = Math.abs(this.amplitudeHistory[sliceOffset + iy * gridSize + ix]);
          
          if (amp < threshold) {
            const x = (ix / gridSize - 0.5) * 100; // 100mm scale
            const y = (iy / gridSize - 0.5) * 100;
            points.push({ x, y, z });
          }
        }
      }
    }
    
    // Generate simple triangles (connect nearby points)
    // This is a placeholder - real implementation would use Delaunay or marching cubes
    let stl = 'solid spacetime_sculpture\n';
    
    // For now, just create a simple point cloud indicator
    // A proper implementation would generate a watertight mesh
    for (let i = 0; i < points.length - 2; i += 3) {
      if (i + 2 < points.length) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2];
        
        stl += `  facet normal 0 0 1\n`;
        stl += `    outer loop\n`;
        stl += `      vertex ${p1.x} ${p1.y} ${p1.z}\n`;
        stl += `      vertex ${p2.x} ${p2.y} ${p2.z}\n`;
        stl += `      vertex ${p3.x} ${p3.y} ${p3.z}\n`;
        stl += `    endloop\n`;
        stl += `  endfacet\n`;
      }
    }
    
    stl += 'endsolid spacetime_sculpture\n';
    
    // Download
    const blob = new Blob([stl], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spacetime_sculpture.stl';
    a.click();
    URL.revokeObjectURL(url);
    
    console.log(`Exported STL with ${points.length} points`);
  }
  
  /**
   * Clear the history and start fresh
   */
  clear() {
    this.amplitudeHistory.fill(0);
    this.currentSlice = 0;
    this.totalSlices = 0;
    this.geometryDirty = true;
    this.vertexCount = 0;
    this.lineVertexCount = 0;
    
    // Reset particles
    this.particleTrails = [];
    this.particleTrailVertexCount = 0;
    this.initParticles(); // Re-scatter particles
  }
  
  // ===== Particle Parameter Setters =====
  
  setParticleCount(count) {
    const newCount = Math.max(100, Math.min(10000, count));
    if (newCount !== this.particleCount) {
      this.particleCount = newCount;
      this.initParticles(); // Reinitialize with new count
    }
  }
  
  setParticleForceStrength(strength) {
    this.particleForceStrength = Math.max(0, Math.min(1, strength));
  }
  
  setParticleDamping(damping) {
    this.particleDamping = Math.max(0.5, Math.min(0.99, damping));
  }
  
  setParticleNoise(noise) {
    this.particleNoise = Math.max(0, Math.min(0.1, noise));
  }
  
  setParticleEdgeRepel(strength) {
    this.particleEdgeRepel = Math.max(0, Math.min(0.1, strength));
  }
  
  setParticleCornerRepel(strength) {
    this.particleCornerRepel = Math.max(0, Math.min(0.1, strength));
  }
  
  setParticleShakeStrength(strength) {
    this.particleShakeStrength = Math.max(0, Math.min(0.2, strength));
  }
  
  setParticleSize(size) {
    this.particleSize = Math.max(1, Math.min(10, size));
  }
  
  /**
   * Reset particles to random positions (useful when stuck)
   */
  resetParticles() {
    this.initParticles();
    this.particleTrails = [];
    this.particleTrailVertexCount = 0;
  }
  
  // ===== Controls =====
  
  setupControls() {
    const canvas = this.canvas;
    
    canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.autoRotate = false;
    });
    
    canvas.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      
      this.cameraTheta += dx * 0.01;
      this.cameraPhi = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, this.cameraPhi + dy * 0.01));
      
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });
    
    canvas.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
    
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cameraDistance = Math.max(1, Math.min(10, this.cameraDistance + e.deltaY * 0.01));
    });
  }
  
  resize() {
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    this.gl.viewport(0, 0, canvas.width, canvas.height);
  }
  
  // ===== Matrix utilities =====
  
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
