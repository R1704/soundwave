/**
 * WebGL renderer for modal membrane visualization
 * 
 * Fixed interaction: left-drag orbits, left-click + shift strikes
 * Proper amplitude normalization for visuals
 */

export class WebGLRenderer {
  constructor(canvas, gridSize = 64) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    
    if (!this.gl) {
      throw new Error('WebGL not supported');
    }
    
    this.gridX = gridSize;
    this.gridY = gridSize;
    
    this.positionBuffer = null;
    this.indexBuffer = null;
    this.normalBuffer = null;
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
    
    // Height data
    this.heights = new Float32Array(this.gridX * this.gridY);
    this.smoothedHeights = new Float32Array(this.gridX * this.gridY);
    this.positions = null;
    this.normals = null;
    
    // Visual scaling - now auto-normalized
    this.heightScale = 1.5;
    this.smoothingFactor = 0.8;
    
    // Peak tracking for auto-normalization
    this.visualPeak = 0.01;
    this.visualPeakDecay = 0.995;
    
    // Animation
    this.autoRotate = true;
    this.autoRotateSpeed = 0.15;
    
    // Interaction state
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.dragThreshold = 5; // pixels before it counts as drag
    this.wasDragged = false;
    
    // Callbacks
    this.onStrike = null; // Called when user clicks to strike
    
    this.init();
    this.setupControls();
  }
  
  init() {
    const gl = this.gl;
    this.createShaders();
    this.createPlaneGeometry();
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.05, 0.05, 0.1, 1.0);
    this.resize();
  }
  
  setupControls() {
    const canvas = this.canvas;
    
    // Prevent context menu
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
    
    // Mouse down - start potential drag or strike
    canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.wasDragged = false;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });
    
    // Mouse move - orbit if dragging
    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      
      // Check if we've moved enough to count as drag
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
    
    // Mouse up - if not dragged, it's a strike
    window.addEventListener('mouseup', (e) => {
      if (this.isDragging && !this.wasDragged) {
        // It was a click, not a drag - try to strike
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
        // Pinch zoom
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
        // Quick tap - strike
        const coords = this.canvasToMembrane(touchStartX, touchStartY);
        if (coords && this.onStrike) {
          this.onStrike(coords.x, coords.y);
        }
      }
    });
  }
  
  createShaders() {
    const gl = this.gl;
    
    const vertexSource = `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      
      uniform mat4 uModel;
      uniform mat4 uView;
      uniform mat4 uProjection;
      
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying float vHeight;
      varying vec2 vUV;
      
      void main() {
        vec4 worldPos = uModel * vec4(aPosition, 1.0);
        vPosition = worldPos.xyz;
        vNormal = mat3(uModel) * aNormal;
        vHeight = aPosition.z;
        vUV = aPosition.xy * 0.5 + 0.5;
        gl_Position = uProjection * uView * worldPos;
      }
    `;
    
    const fragmentSource = `
      precision mediump float;
      
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying float vHeight;
      varying vec2 vUV;
      
      uniform vec3 uLightDir;
      uniform vec3 uCameraPos;
      
      void main() {
        vec3 normal = normalize(vNormal);
        vec3 lightDir = normalize(uLightDir);
        vec3 viewDir = normalize(uCameraPos - vPosition);
        
        float diff = max(dot(normal, lightDir), 0.0);
        vec3 halfDir = normalize(lightDir + viewDir);
        float spec = pow(max(dot(normal, halfDir), 0.0), 32.0);
        
        // Height color - normalized to [-1, 1] range
        float h = clamp(vHeight, -1.0, 1.0);
        vec3 baseColor = vec3(0.15, 0.4, 0.7);
        vec3 peakColor = vec3(1.0, 0.5, 0.2);
        vec3 troughColor = vec3(0.05, 0.15, 0.4);
        
        vec3 color;
        if (h > 0.0) {
          color = mix(baseColor, peakColor, h);
        } else {
          color = mix(baseColor, troughColor, -h);
        }
        
        // Edge darkening
        float edge = smoothstep(0.0, 0.1, vUV.x) * smoothstep(0.0, 0.1, 1.0 - vUV.x) *
                     smoothstep(0.0, 0.1, vUV.y) * smoothstep(0.0, 0.1, 1.0 - vUV.y);
        color *= 0.4 + 0.6 * edge;
        
        vec3 ambient = color * 0.35;
        vec3 diffuse = color * diff * 0.55;
        vec3 specular = vec3(1.0) * spec * 0.25;
        
        gl_FragColor = vec4(ambient + diffuse + specular, 1.0);
      }
    `;
    
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexSource);
    gl.compileShader(vertexShader);
    
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentSource);
    gl.compileShader(fragmentShader);
    
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);
    
    this.attributes.position = gl.getAttribLocation(this.program, 'aPosition');
    this.attributes.normal = gl.getAttribLocation(this.program, 'aNormal');
    this.uniforms.model = gl.getUniformLocation(this.program, 'uModel');
    this.uniforms.view = gl.getUniformLocation(this.program, 'uView');
    this.uniforms.projection = gl.getUniformLocation(this.program, 'uProjection');
    this.uniforms.lightDir = gl.getUniformLocation(this.program, 'uLightDir');
    this.uniforms.cameraPos = gl.getUniformLocation(this.program, 'uCameraPos');
  }
  
  createPlaneGeometry() {
    const gl = this.gl;
    const nx = this.gridX;
    const ny = this.gridY;
    
    this.positions = new Float32Array(nx * ny * 3);
    this.normals = new Float32Array(nx * ny * 3);
    
    for (let iy = 0; iy < ny; iy++) {
      const y = (iy / (ny - 1)) * 2 - 1;
      for (let ix = 0; ix < nx; ix++) {
        const x = (ix / (nx - 1)) * 2 - 1;
        const idx = (iy * nx + ix) * 3;
        this.positions[idx] = x;
        this.positions[idx + 1] = y;
        this.positions[idx + 2] = 0;
        this.normals[idx] = 0;
        this.normals[idx + 1] = 0;
        this.normals[idx + 2] = 1;
      }
    }
    
    const indices = [];
    for (let iy = 0; iy < ny - 1; iy++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const i = iy * nx + ix;
        indices.push(i, i + nx, i + 1);
        indices.push(i + 1, i + nx, i + nx + 1);
      }
    }
    this.indexCount = indices.length;
    
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.positions, gl.DYNAMIC_DRAW);
    
    this.normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.normals, gl.DYNAMIC_DRAW);
    
    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  }
  
  setGridSize(size) {
    if (size === this.gridX) return;
    this.gridX = size;
    this.gridY = size;
    this.heights = new Float32Array(size * size);
    this.smoothedHeights = new Float32Array(size * size);
    this.createPlaneGeometry();
  }
  
  updateHeights(heights) {
    if (heights.length !== this.heights.length) {
      const srcSize = Math.sqrt(heights.length);
      const dstSize = this.gridX;
      for (let dy = 0; dy < dstSize; dy++) {
        for (let dx = 0; dx < dstSize; dx++) {
          const sx = Math.floor(dx * srcSize / dstSize);
          const sy = Math.floor(dy * srcSize / dstSize);
          this.heights[dy * dstSize + dx] = heights[sy * srcSize + sx];
        }
      }
    } else {
      this.heights.set(heights);
    }
  }
  
  updateGeometry() {
    const gl = this.gl;
    const nx = this.gridX;
    const ny = this.gridY;
    
    // Find current peak for auto-normalization
    let currentPeak = 0;
    for (let i = 0; i < this.heights.length; i++) {
      currentPeak = Math.max(currentPeak, Math.abs(this.heights[i]));
    }
    
    // Smooth peak tracking
    this.visualPeak = Math.max(this.visualPeak * this.visualPeakDecay, currentPeak, 0.001);
    
    // Normalization factor
    const normFactor = 1.0 / this.visualPeak;
    
    // Apply smoothing and normalization
    const alpha = 1.0 - this.smoothingFactor;
    for (let i = 0; i < this.heights.length; i++) {
      const normalizedHeight = this.heights[i] * normFactor * this.heightScale;
      this.smoothedHeights[i] = this.smoothedHeights[i] * this.smoothingFactor + normalizedHeight * alpha;
    }
    
    // Update positions
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const hi = iy * nx + ix;
        const pi = hi * 3;
        this.positions[pi + 2] = this.smoothedHeights[hi];
      }
    }
    
    this.computeNormals();
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.positions);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.normals);
  }
  
  computeNormals() {
    const nx = this.gridX;
    const ny = this.gridY;
    const pos = this.positions;
    const norm = this.normals;
    
    norm.fill(0);
    
    for (let iy = 0; iy < ny - 1; iy++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const i0 = iy * nx + ix;
        const i1 = i0 + 1;
        const i2 = i0 + nx;
        const i3 = i2 + 1;
        
        const p0 = [pos[i0*3], pos[i0*3+1], pos[i0*3+2]];
        const p1 = [pos[i1*3], pos[i1*3+1], pos[i1*3+2]];
        const p2 = [pos[i2*3], pos[i2*3+1], pos[i2*3+2]];
        const p3 = [pos[i3*3], pos[i3*3+1], pos[i3*3+2]];
        
        const e1 = [p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]];
        const e2 = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]];
        const n1 = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
        
        const e3 = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]];
        const e4 = [p3[0]-p1[0], p3[1]-p1[1], p3[2]-p1[2]];
        const n2 = [e3[1]*e4[2]-e3[2]*e4[1], e3[2]*e4[0]-e3[0]*e4[2], e3[0]*e4[1]-e3[1]*e4[0]];
        
        for (let v of [i0, i1, i2]) {
          norm[v*3] += n1[0]; norm[v*3+1] += n1[1]; norm[v*3+2] += n1[2];
        }
        for (let v of [i1, i2, i3]) {
          norm[v*3] += n2[0]; norm[v*3+1] += n2[1]; norm[v*3+2] += n2[2];
        }
      }
    }
    
    for (let i = 0; i < nx * ny; i++) {
      const ni = i * 3;
      const len = Math.sqrt(norm[ni]**2 + norm[ni+1]**2 + norm[ni+2]**2);
      if (len > 0) {
        norm[ni] /= len; norm[ni+1] /= len; norm[ni+2] /= len;
      }
    }
  }
  
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.clientWidth * dpr;
    const height = this.canvas.clientHeight * dpr;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
  }
  
  render(time) {
    const gl = this.gl;
    this.resize();
    this.updateGeometry();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    if (this.autoRotate && !this.isDragging) {
      this.cameraTheta = time * this.autoRotateSpeed;
    }
    
    const camX = Math.sin(this.cameraTheta) * Math.cos(this.cameraPhi) * this.cameraDistance;
    const camY = Math.cos(this.cameraTheta) * Math.cos(this.cameraPhi) * this.cameraDistance;
    const camZ = Math.sin(this.cameraPhi) * this.cameraDistance;
    const camPos = [camX, camY, camZ];
    
    this.lookAt(this.viewMatrix, camPos, this.cameraTarget, [0, 0, 1]);
    
    const aspect = this.canvas.width / this.canvas.height;
    this.perspective(this.projMatrix, Math.PI / 4, aspect, 0.1, 100);
    this.identity(this.modelMatrix);
    
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.model, false, this.modelMatrix);
    gl.uniformMatrix4fv(this.uniforms.view, false, this.viewMatrix);
    gl.uniformMatrix4fv(this.uniforms.projection, false, this.projMatrix);
    gl.uniform3fv(this.uniforms.lightDir, [0.5, 0.3, 1.0]);
    gl.uniform3fv(this.uniforms.cameraPos, camPos);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.attributes.position);
    gl.vertexAttribPointer(this.attributes.position, 3, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
    gl.enableVertexAttribArray(this.attributes.normal);
    gl.vertexAttribPointer(this.attributes.normal, 3, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }
  
  identity(out) {
    out.fill(0);
    out[0] = out[5] = out[10] = out[15] = 1;
  }
  
  perspective(out, fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
  }
  
  lookAt(out, eye, center, up) {
    const zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let len = Math.sqrt(zx*zx + zy*zy + zz*zz);
    const z = [zx/len, zy/len, zz/len];
    const xx = up[1]*z[2] - up[2]*z[1], xy = up[2]*z[0] - up[0]*z[2], xz = up[0]*z[1] - up[1]*z[0];
    len = Math.sqrt(xx*xx + xy*xy + xz*xz);
    const x = [xx/len, xy/len, xz/len];
    const y = [z[1]*x[2] - z[2]*x[1], z[2]*x[0] - z[0]*x[2], z[0]*x[1] - z[1]*x[0]];
    out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
    out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
    out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
    out[12] = -(x[0]*eye[0] + x[1]*eye[1] + x[2]*eye[2]);
    out[13] = -(y[0]*eye[0] + y[1]*eye[1] + y[2]*eye[2]);
    out[14] = -(z[0]*eye[0] + z[1]*eye[1] + z[2]*eye[2]);
    out[15] = 1;
  }
  
  canvasToMembrane(canvasX, canvasY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((canvasX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((canvasY - rect.top) / rect.height) * 2;
    
    const camX = Math.sin(this.cameraTheta) * Math.cos(this.cameraPhi) * this.cameraDistance;
    const camY = Math.cos(this.cameraTheta) * Math.cos(this.cameraPhi) * this.cameraDistance;
    const camZ = Math.sin(this.cameraPhi) * this.cameraDistance;
    
    const fov = Math.PI / 4;
    const aspect = this.canvas.width / this.canvas.height;
    const tanHalfFov = Math.tan(fov / 2);
    
    const rayViewX = ndcX * tanHalfFov * aspect;
    const rayViewY = ndcY * tanHalfFov;
    
    const fwdLen = Math.sqrt(camX*camX + camY*camY + camZ*camZ);
    const fwd = [-camX/fwdLen, -camY/fwdLen, -camZ/fwdLen];
    
    const up = [0, 0, 1];
    let rx = fwd[1]*up[2] - fwd[2]*up[1];
    let ry = fwd[2]*up[0] - fwd[0]*up[2];
    let rz = fwd[0]*up[1] - fwd[1]*up[0];
    const rLen = Math.sqrt(rx*rx + ry*ry + rz*rz);
    const right = [rx/rLen, ry/rLen, rz/rLen];
    
    const actualUp = [
      right[1]*fwd[2] - right[2]*fwd[1],
      right[2]*fwd[0] - right[0]*fwd[2],
      right[0]*fwd[1] - right[1]*fwd[0]
    ];
    
    const rayDir = [
      right[0]*rayViewX + actualUp[0]*rayViewY + fwd[0]*(-1),
      right[1]*rayViewX + actualUp[1]*rayViewY + fwd[1]*(-1),
      right[2]*rayViewX + actualUp[2]*rayViewY + fwd[2]*(-1)
    ];
    
    if (Math.abs(rayDir[2]) < 0.001) return null;
    
    const t = -camZ / rayDir[2];
    if (t < 0) return null;
    
    const hitX = camX + t * rayDir[0];
    const hitY = camY + t * rayDir[1];
    
    const memX = (hitX + 1) / 2;
    const memY = (hitY + 1) / 2;
    
    if (memX < 0 || memX > 1 || memY < 0 || memY > 1) return null;
    
    return { x: memX, y: memY };
  }
  
  resetCamera() {
    this.cameraDistance = 3.5;
    this.cameraTheta = 0.5;
    this.cameraPhi = 0.6;
    this.autoRotate = true;
  }
}
