// WebGL2 raymarcher with two looks. The realistic look marches a smoothed density field built on the GPU; the original voxel look, described next, is kept as a toggle.
// Colours live in 3D textures that are re-uploaded per dirty chunk. Rays walk the grid with a DDA,
// skip empty blocks using a coarse occupancy and light volume, blend through liquids and gases, and stop at the first opaque voxel.
var Render = (function () {
  var R = { camera: { yaw: 0.72, pitch: 0.46, dist: 1.0, tx: 0, ty: 0, tz: 0 }, scale: 1, showGrid: true, viewMode: "normal", fps: 0, brush: null };
  var gl, canvas, prog, pointProg, vao, texColor, texEmit, texCoarse, W, H, D, BLOCK = 8, cW, cH, cD;
  var colorBuf, emitBuf, coarseBuf, pointBuf, pointVbo, pointVao, U = {}, PU = {}, ok = false;
  var view = { invVP: null, VP: null, eye: [0, 0, 0] };

  var VS = "#version 300 es\nout vec2 vUv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}";
  var FS = [
    "#version 300 es",
    "precision highp float;precision highp int;precision highp sampler3D;",
    "in vec2 vUv;out vec4 frag;",
    "uniform sampler3D uColor,uEmit,uCoarse;uniform mat4 uInvVP,uVP;uniform vec3 uEye,uDim,uBrush;uniform float uBrushR,uTime,uBlock;uniform int uDirect;",
    "const vec3 SUN=normalize(vec3(.45,.82,.34));",
    // Texture layout is (x,z,y), so a grid position p maps to texel p.xzy.
    "vec4 col(ivec3 p){return texelFetch(uColor,p.xzy,0);}",
    "vec4 emi(ivec3 p){return texelFetch(uEmit,p.xzy,0);}",
    "vec4 coarse(vec3 p){return texture(uCoarse,(p/uDim).xzy);}",
    "bool inGrid(ivec3 p){return all(greaterThanEqual(p,ivec3(1)))&&all(lessThan(p,ivec3(uDim)-1));}",
    "bool solid(ivec3 p){return inGrid(p)&&col(p).a>.98;}",
    "vec2 box(vec3 ro,vec3 rd,vec3 lo,vec3 hi){vec3 a=(lo-ro)/rd,b=(hi-ro)/rd;vec3 mn=min(a,b),mx=max(a,b);return vec2(max(max(mn.x,mn.y),mn.z),min(min(mx.x,mx.y),mx.z));}",
    "vec3 safe(vec3 d){return d+vec3(1e-5)*step(abs(d),vec3(1e-5));}",
    "float shadow(vec3 ro){vec3 rd=SUN;ivec3 p=ivec3(floor(ro));vec3 st=sign(rd),dl=abs(1./rd);vec3 tm=(vec3(p)+max(st,vec3(0.))-ro)/rd;float lit=1.;",
    " for(int i=0;i<140;i++){if(tm.x<tm.y){if(tm.x<tm.z){p.x+=int(st.x);tm.x+=dl.x;}else{p.z+=int(st.z);tm.z+=dl.z;}}else{if(tm.y<tm.z){p.y+=int(st.y);tm.y+=dl.y;}else{p.z+=int(st.z);tm.z+=dl.z;}}",
    "  if(!inGrid(p))break;float a=col(p).a;if(a>.98)return 0.;lit*=1.-a*.5;if(lit<.05)return 0.;}return lit;}",
    "float ao(ivec3 p,ivec3 n){ivec3 u=n.yzx,v=n.zxy;ivec3 q=p+n;float o=0.;o+=float(solid(q+u))+float(solid(q-u))+float(solid(q+v))+float(solid(q-v));o+=.6*(float(solid(q+u+v))+float(solid(q-u+v))+float(solid(q+u-v))+float(solid(q-u-v)));return 1.-o*.085;}",
    "vec3 sky(vec3 rd){float t=clamp(rd.y*.5+.5,0.,1.);return mix(vec3(.052,.056,.068),vec3(.105,.122,.155),t);}",
    "vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}",
    // A short second ray for reflections off metal. It sees solid voxels and their glow, and the sky beyond.
    "vec3 reflTrace(vec3 ro,vec3 rd){rd=safe(rd);ivec3 p=ivec3(floor(ro));vec3 st=sign(rd),dl=abs(1./rd);vec3 tm=(vec3(p)+max(st,vec3(0.))-ro)/rd;vec3 N=vec3(0.,1.,0.);",
    " for(int i=0;i<48;i++){if(tm.x<tm.y){if(tm.x<tm.z){p.x+=int(st.x);tm.x+=dl.x;N=vec3(-st.x,0.,0.);}else{p.z+=int(st.z);tm.z+=dl.z;N=vec3(0.,0.,-st.z);}}else{if(tm.y<tm.z){p.y+=int(st.y);tm.y+=dl.y;N=vec3(0.,-st.y,0.);}else{p.z+=int(st.z);tm.z+=dl.z;N=vec3(0.,0.,-st.z);}}",
    "  if(!inGrid(p))break;vec4 c=col(p);if(c.a>.98){vec4 e=emi(p);return c.rgb*c.rgb*(.3+.75*max(dot(N,SUN),0.))+e.rgb*e.rgb*1.5;}}",
    " return sky(rd)+coarse(ro+rd*6.).rgb*.5;}",
    "void main(){",
    " vec4 nf=uInvVP*vec4(vUv*2.-1.,-1.,1.);vec4 ff=uInvVP*vec4(vUv*2.-1.,1.,1.);vec3 ro=uEye;vec3 rd=safe(normalize(ff.xyz/ff.w-nf.xyz/nf.w));",
    " vec3 lo=vec3(1.),hi=uDim-1.;vec2 tb=box(ro,rd,lo,hi);vec3 acc=vec3(0.);vec3 tr=vec3(1.);vec3 hitPos=vec3(0.);bool hit=false;vec3 o=ro,d=rd;",
    " if(tb.x<tb.y&&tb.y>0.){",
    "  float t=max(tb.x,0.)+1e-4;vec3 pos=o+d*t;ivec3 p=ivec3(floor(pos));vec3 st=sign(d),dl=abs(1./d);ivec3 ist=ivec3(st);vec3 tm=(vec3(p)+max(st,vec3(0.))-o)/d;",
    "  vec3 nrm=vec3(0.,1.,0.);{vec3 q=(pos-lo)/(hi-lo);vec3 e=min(q,1.-q);if(e.x<e.y&&e.x<e.z)nrm=vec3(-st.x,0.,0.);else if(e.z<e.y)nrm=vec3(0.,0.,-st.z);else nrm=vec3(0.,-st.y,0.);}",
    "  ivec3 lastB=ivec3(-1);vec4 cs=vec4(0.);bool inLiq=false;",
    "  for(int i=0;i<1400;i++){",
    "   if(!inGrid(p))break;",
    "   ivec3 bi=p/int(uBlock);if(bi!=lastB){lastB=bi;cs=texelFetch(uCoarse,bi.xzy,0);}",
    // Empty block: jump straight to its far side and add the glow it scatters.
    "   if(cs.a<.002&&!inLiq){vec3 bl=vec3(bi)*uBlock,bh=bl+uBlock;vec2 tt=box(o,d,bl,bh);float tn=tt.y+1e-3;float seg=max(tn-t,0.);acc+=tr*cs.rgb*seg*.018;t=tn;pos=o+d*t;ivec3 np=ivec3(floor(pos));if(np==p){np+=ist;}p=np;tm=(vec3(p)+max(st,vec3(0.))-o)/d;continue;}",
    "   vec4 c=col(p);",
    "   if(c.a>.004){",
    "    if(c.a>.98){",
    "     vec4 e=emi(p);ivec3 n=ivec3(nrm);vec3 N=nrm;float dif=max(dot(N,SUN),0.);vec3 hp=o+d*t;float s=dif>0.?shadow(hp+N*.02):0.;float a=ao(p,n);",
    "     vec3 amb=mix(vec3(.2,.21,.24),vec3(.42,.46,.55),N.y*.5+.5);vec3 gl2=coarse(vec3(p)+.5+N*1.5).rgb;",
    "     vec3 alb=c.rgb*c.rgb;vec3 lit=alb*(amb*a*.72+vec3(.92,.87,.78)*dif*s+gl2*1.6);",
    "     vec3 H2=normalize(SUN-d);lit+=vec3(pow(max(dot(N,H2),0.),48.)*e.a*s*1.3);",
    "     if(e.a>.7){float F=.45+.55*pow(1.-max(dot(N,-d),0.),5.);lit=mix(lit,alb*reflTrace(hp+N*.02,reflect(d,N))*2.2,F*.6);}",
    "     acc+=tr*(lit+e.rgb*e.rgb*1.5);tr=vec3(0.);if(!hit){hit=true;hitPos=hp;}break;",
    "    }",
    // Translucent voxels absorb each colour at its own rate, which is why deep water turns blue and shallow water stays clear.
    "    int ai=int(c.a*255.+.5);bool liq=(ai&1)==1;float a=c.a;",
    "    if(liq&&!inLiq){inLiq=true;vec3 N=nrm;float F=.02+.98*pow(1.-max(dot(N,-d),0.),5.);vec3 H2=normalize(SUN-d);acc+=tr*(F*sky(reflect(d,N))*1.3+vec3(pow(max(dot(N,H2),0.),220.)*2.5));tr*=1.-F;if(!hit){hit=true;hitPos=o+d*t;}",
    "     vec3 nd=refract(d,N,.75);if(dot(nd,nd)>.1){vec3 hp=o+d*t;o=hp;d=safe(nd);t=1e-4;st=sign(d);dl=abs(1./d);ist=ivec3(st);tm=(vec3(p)+max(st,vec3(0.))-o)/d;}}",
    "    vec3 trans=exp(-((1.03-c.rgb)*a*2.6+a*.12));vec4 e=(cs.r+cs.g+cs.b>0.)?emi(p):vec4(0.);",
    "    acc+=tr*(vec3(1.)-trans)*c.rgb*(vec3(.55,.6,.68)+cs.rgb*1.4)*.5;tr*=trans;acc+=tr*e.rgb*e.rgb*1.1;",
    "    if(!hit&&a>.15){hit=true;hitPos=o+d*t;}",
    "    if(max(tr.r,max(tr.g,tr.b))<.015)break;",
    "   } else if(inLiq){",
    // Leaving the liquid bends the ray back, or reflects it at a shallow angle, as the underside of a water surface does.
    "    inLiq=false;vec3 hp=o+d*t;vec3 nd=refract(d,nrm,1.333);if(dot(nd,nd)<.1)nd=reflect(d,nrm);o=hp;d=safe(nd);t=1e-4;st=sign(d);dl=abs(1./d);ist=ivec3(st);tm=(vec3(p)+max(st,vec3(0.))-o)/d;",
    "   }",
    "   if(tm.x<tm.y){if(tm.x<tm.z){t=tm.x;tm.x+=dl.x;p.x+=ist.x;nrm=vec3(-st.x,0.,0.);}else{t=tm.z;tm.z+=dl.z;p.z+=ist.z;nrm=vec3(0.,0.,-st.z);}}else{if(tm.y<tm.z){t=tm.y;tm.y+=dl.y;p.y+=ist.y;nrm=vec3(0.,-st.y,0.);}else{t=tm.z;tm.z+=dl.z;p.z+=ist.z;nrm=vec3(0.,0.,-st.z);}}",
    "  }",
    " }",
    // Floor and chamber outline, using the ray as bent by any water it passed through.
    " vec3 back=sky(d);float tFloor=(1.-o.y)/d.y;",
    " if(tFloor>0.){vec3 h=o+d*tFloor;if(h.x>=1.&&h.z>=1.&&h.x<=hi.x&&h.z<=hi.z){vec2 g=abs(fract(h.xz/8.)-.5);float dd=min(g.x,g.y)*8.;float w=fwidth(dd)*1.2;float line=1.-smoothstep(0.,w+.02,dd);vec3 fc=mix(vec3(.078,.086,.104),vec3(.17,.19,.225),line*.8);vec3 glow=coarse(h+vec3(0.,1.5,0.)).rgb;back=fc*(.6+.5*shadow(h+vec3(0.,.01,0.)))+glow*.9;}}",
    " vec3 outline=vec3(0.);{vec2 tt=box(ro,rd,lo,hi);if(tt.x<tt.y&&tt.y>0.){for(int k=0;k<2;k++){float tk=k==0?tt.x:tt.y;if(tk<0.)continue;vec3 q=ro+rd*tk;vec3 dd=min(abs(q-lo),abs(q-hi));float m=dd.x+dd.y+dd.z-max(max(dd.x,dd.y),dd.z);float w=tk*.0016;outline+=vec3(.24,.28,.36)*(1.-smoothstep(0.,w+.05,m))*(k==0?1.:.55);}}}",
    " vec3 c3=acc+tr*back+outline*(k1(tr));",
    " if(uBrushR>0.){vec3 oc=ro-uBrush;float b=dot(oc,rd),cc=dot(oc,oc)-uBrushR*uBrushR,h=b*b-cc;if(h>0.){float q=sqrt(h);float s=-b-q;if(s>0.){float rim=pow(1.-clamp(q/uBrushR,0.,1.),2.);c3+=vec3(.34,.42,.55)*(.03+rim*.32);}}}",
    " if(uDirect==1){c3=aces(c3*.8);frag=vec4(pow(c3,vec3(1./2.2)),1.);}else frag=vec4(c3,1.);",
    " if(hit){vec4 cp=uVP*vec4(hitPos,1.);gl_FragDepth=clamp(cp.z/cp.w*.5+.5,0.,1.);}else gl_FragDepth=1.;",
    "}"
  ].join("\n");
  FS = FS.replace("void main(){", "float k1(vec3 t){return max(t.r,max(t.g,t.b));}\nvoid main(){");

  // Post-processing: bloom built from a chain of half-size blurs, then tone mapping.
  var POST_FS = {
    bright: "#version 300 es\nprecision highp float;in vec2 vUv;out vec4 f;uniform sampler2D t;void main(){vec3 c=texture(t,vUv).rgb;float l=max(c.r,max(c.g,c.b));f=vec4(min(c,vec3(30.))*smoothstep(1.3,3.2,l),1.);}",
    blur: "#version 300 es\nprecision highp float;in vec2 vUv;out vec4 f;uniform sampler2D t;uniform vec2 px;void main(){vec3 c=texture(t,vUv+px*vec2(-1.,-1.)).rgb+texture(t,vUv+px*vec2(1.,-1.)).rgb+texture(t,vUv+px*vec2(-1.,1.)).rgb+texture(t,vUv+px*vec2(1.,1.)).rgb;f=vec4(c*.25,1.);}",
    final: "#version 300 es\nprecision highp float;in vec2 vUv;out vec4 f;uniform sampler2D t,b;vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}void main(){vec3 c=texture(t,vUv).rgb+texture(b,vUv).rgb*.4;vec2 v=vUv-.5;c*=1.-dot(v,v)*.35;f=vec4(pow(aces(c*.8),vec3(1./2.2)),1.);}"
  };

  var PVS = "#version 300 es\nprecision highp float;in vec4 aP;in vec4 aC;uniform mat4 uVP;uniform float uPx;out vec4 vC;void main(){gl_Position=uVP*vec4(aP.xyz,1.);gl_PointSize=clamp(aP.w*uPx/gl_Position.w,1.,48.);vC=aC;}";
  var PFS = "#version 300 es\nprecision highp float;in vec4 vC;out vec4 f;void main(){vec2 d=gl_PointCoord-.5;float r=dot(d,d);if(r>.25)discard;float a=vC.a<.5?1.:1.-r*4.;f=vec4(vC.rgb*a,a);}";

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function link(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  R.init = function (cv) {
    canvas = cv;
    gl = cv.getContext("webgl2", { antialias: false, alpha: false, depth: true, powerPreference: "high-performance" });
    if (!gl) return false;
    prog = link(VS, FS); pointProg = link(PVS, PFS);
    ["uColor", "uEmit", "uCoarse", "uInvVP", "uVP", "uEye", "uDim", "uBrush", "uBrushR", "uTime", "uBlock", "uDirect"].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    ["uVP", "uPx"].forEach(function (n) { PU[n] = gl.getUniformLocation(pointProg, n); });
    vao = gl.createVertexArray();
    pointVao = gl.createVertexArray(); pointVbo = gl.createBuffer();
    gl.bindVertexArray(pointVao); gl.bindBuffer(gl.ARRAY_BUFFER, pointVbo);
    var aP = gl.getAttribLocation(pointProg, "aP"), aC = gl.getAttribLocation(pointProg, "aC");
    gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(aC); gl.vertexAttribPointer(aC, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
    pointBuf = new Float32Array(8 * Sim.MAX_PARTICLES);
    ok = true;
    hdr = !!gl.getExtension("EXT_color_buffer_float");
    if (hdr) { postBright = link(VS, POST_FS.bright); postBlur = link(VS, POST_FS.blur); postFinal = link(VS, POST_FS.final); try { initRealistic(); } catch (e) { console.error("Realistic renderer unavailable:", e); realFailed = true; realProg = null; R.look = "classic"; } }
    return true;
  };

  // HDR scene target and the bloom chain, rebuilt whenever the canvas changes size.
  var hdr = false, postBright, postBlur, postFinal, sceneFBO = null, sceneTex, sceneDepth, bloom = [], targetW = 0, targetH = 0;
  function colorTarget(w, h) {
    var tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex: tex, fbo: fbo, w: w, h: h };
  }
  function ensureTargets(w, h) {
    if (w === targetW && h === targetH && sceneFBO) return;
    targetW = w; targetH = h;
    if (sceneFBO) { gl.deleteFramebuffer(sceneFBO); gl.deleteTexture(sceneTex); gl.deleteRenderbuffer(sceneDepth); bloom.forEach(function (b) { gl.deleteFramebuffer(b.fbo); gl.deleteTexture(b.tex); }); }
    var s = colorTarget(w, h);
    sceneFBO = s.fbo; sceneTex = s.tex;
    sceneDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, sceneDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, sceneDepth);
    bloom = [];
    for (var k = 1; k <= 5; k++) bloom.push(colorTarget(Math.max(2, w >> k), Math.max(2, h >> k)));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function pass(prog2, target, tex, setup) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : targetW, target ? target.h : targetH);
    gl.useProgram(prog2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog2, "t"), 3);
    if (setup) setup();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function postProcess() {
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(vao);
    pass(postBright, bloom[0], sceneTex);
    var loc = gl.getUniformLocation(postBlur, "px");
    for (var k = 1; k < bloom.length; k++) {
      pass(postBlur, bloom[k], bloom[k - 1].tex, function () { gl.uniform2f(loc, 0.5 / bloom[k - 1].w, 0.5 / bloom[k - 1].h); });
    }
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (var j = bloom.length - 1; j > 0; j--) {
      pass(postBlur, bloom[j - 1], bloom[j].tex, function () { gl.uniform2f(loc, 0.5 / bloom[j].w, 0.5 / bloom[j].h); });
    }
    gl.disable(gl.BLEND);
    pass(postFinal, null, sceneTex, function () {
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, bloom[0].tex);
      gl.uniform1i(gl.getUniformLocation(postFinal, "b"), 4);
    });
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(null);
  }

  function tex3D(unit, w, h, d, internal, filter) {
    var t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texStorage3D(gl.TEXTURE_3D, 1, internal, w, h, d);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filter);
    ["TEXTURE_WRAP_S", "TEXTURE_WRAP_T", "TEXTURE_WRAP_R"].forEach(function (w2) { gl.texParameteri(gl.TEXTURE_3D, gl[w2], gl.CLAMP_TO_EDGE); });
    return t;
  }

  R.resizeGrid = function () {
    W = Sim.W; H = Sim.H; D = Sim.D;
    Shade.init();
    cW = Shade.cW; cH = Shade.cH; cD = Shade.cD; colorBuf = Shade.colorBuf; emitBuf = Shade.emitBuf; coarseBuf = Shade.coarseBuf;
    [texColor, texEmit, texCoarse].forEach(function (t) { if (t) gl.deleteTexture(t); });
    freeVolumes();
    simBuf = null;
    texColor = tex3D(0, W, D, H, gl.RGBA8, gl.NEAREST);
    texEmit = tex3D(1, W, D, H, gl.RGBA8, gl.NEAREST);
    texCoarse = tex3D(2, cW, cD, cH, gl.RGBA8, gl.LINEAR);
    R.camera.dist = Math.max(W, D) * 1.6;
    R.camera.tx = W / 2; R.camera.ty = H * 0.34; R.camera.tz = D / 2;
    Sim.DIRTY.fill(1);
  };


  var dirtyList = null;
  function uploadDirty(time) {
    if (Sim.busy) return false;   // cells are being written. The frame after the tick finishes picks this up.
    var CS = Sim.CHUNK, cw = Sim.cw, ch = Sim.ch, cd = Sim.cd, DIRTY = Sim.DIRTY, total = DIRTY.length, n = 0;
    if (!dirtyList || dirtyList.length !== total) dirtyList = new Int32Array(total);
    for (var q = 0; q < total; q++) if (DIRTY[q]) { dirtyList[n++] = q; DIRTY[q] = 0; }
    if (!n) return false;
    var real = realActive();
    if (real) for (var q2 = 0; q2 < n; q2++) settle[dirtyList[q2]] = time + SETTLE_SECONDS;
    if (n === total) snapField = true;
    Shade.time = time; Shade.heat = R.viewMode === "heat"; Shade.phView = R.viewMode === "ph";
    if (Pool.PARAMS) { Sim.writeParams(Pool.PARAMS); Shade.writeParams(Pool.PARAMS); }
    Pool.run(JOB_SHADE, dirtyList, n, Shade.chunkByIndex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (n > total * 0.35) {   // most of the volume changed: one big upload beats hundreds of small ones
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, texColor);
      gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, W, D, H, gl.RGBA, gl.UNSIGNED_BYTE, colorBuf);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, texEmit);
      gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, W, D, H, gl.RGBA, gl.UNSIGNED_BYTE, emitBuf);
      if (real) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_3D, texMat); gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, W, D, H, gl.RGBA, gl.UNSIGNED_BYTE, Shade.matBuf); }
    } else {
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, W); gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, D);
      for (var j = 0; j < n; j++) {
        var k = dirtyList[j], cy = (k / (cw * cd)) | 0, r0 = k - cy * cw * cd, cz = (r0 / cw) | 0, cx = r0 - cz * cw;
        // Neighbouring chunks along a row go up as one, which keeps the number of GL calls down.
        var run = 1; while (j + 1 < n && dirtyList[j + 1] === k + run && cx + run < cw) { run++; j++; }
        var x0 = cx * CS, y0 = cy * CS, z0 = cz * CS, w = Math.min(CS * run, W - x0), h = Math.min(CS, H - y0), d = Math.min(CS, D - z0);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, z0); gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, y0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, texColor);
        gl.texSubImage3D(gl.TEXTURE_3D, 0, x0, z0, y0, w, d, h, gl.RGBA, gl.UNSIGNED_BYTE, colorBuf);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, texEmit);
        gl.texSubImage3D(gl.TEXTURE_3D, 0, x0, z0, y0, w, d, h, gl.RGBA, gl.UNSIGNED_BYTE, emitBuf);
        if (real) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_3D, texMat); gl.texSubImage3D(gl.TEXTURE_3D, 0, x0, z0, y0, w, d, h, gl.RGBA, gl.UNSIGNED_BYTE, Shade.matBuf); }
      }
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0); gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
    }
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, texCoarse);
    gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, cW, cD, cH, gl.RGBA, gl.UNSIGNED_BYTE, coarseBuf);
    return true;
  }

  // ---- Matrices ----
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function lookAt(e, c) {
    var z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function mul(a, b) { var o = new Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
  function invert(m) {
    var a = m, o = new Array(16),
      b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6],
      b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14],
      det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
    o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det; o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
    o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det; o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
    o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det; o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
    o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det; o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
    return o;
  }

  function updateCamera(w, h) {
    var c = R.camera, cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    var eye = [c.tx + Math.sin(c.yaw) * cp * c.dist, c.ty + sp * c.dist, c.tz + Math.cos(c.yaw) * cp * c.dist];
    var P = perspective(0.72, w / h, 0.5, 4000), V = lookAt(eye, [c.tx, c.ty, c.tz]);
    view.VP = mul(P, V); view.invVP = invert(view.VP); view.eye = eye;
  }

  // Screen point to world ray, for picking.
  R.ray = function (nx, ny) {
    function un(z) {
      var m = view.invVP, x = nx * 2 - 1, y = 1 - ny * 2;
      var w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    }
    var a = un(-1), b = un(1);
    return { o: view.eye.slice(), d: norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]) };
  };

  var PART_COL = [[0.45, 0.95, 1], [1, 0.75, 0.3], [0.4, 0.75, 1], [0.85, 1, 0.65], [1, 1, 1], [1, 0.72, 0.3]];
  var PART_SIZE = [1.2, 1.6, 0.9, 2.4, 1.3, 0.9];

  function drawParticles(w, h, real) {
    var n = Sim.pCount;
    if (!n) return;
    var px = Sim.px, py = Sim.py, pz = Sim.pz, ty = Sim.ptype, pm = Sim.pmat, b = pointBuf, o = 0, so = 0, count = 0;
    if (real && !simBuf) simBuf = Sim.sharedBuffers();
    for (var p = 0; p < n; p++) {
      var t = ty[p], c = PART_COL[t];
      if (real && t === PT_SPARK) {
        streakBuf[so++] = px[p]; streakBuf[so++] = py[p]; streakBuf[so++] = pz[p]; streakBuf[so++] = 0.2;
        streakBuf[so++] = simBuf.pvx[p]; streakBuf[so++] = simBuf.pvy[p]; streakBuf[so++] = simBuf.pvz[p]; streakBuf[so++] = Math.min(1, simBuf.plife[p] / 22);
        continue;
      }
      count++;
      if (real && t === PT_DEBRIS) {
        var m3 = pm[p] * 3, cs = Mat.colS, cr = cs[m3] / 255, cg = cs[m3 + 1] / 255, cb = cs[m3 + 2] / 255;
        b[o++] = px[p]; b[o++] = py[p]; b[o++] = pz[p]; b[o++] = 0.9;
        b[o++] = cr * cr; b[o++] = cg * cg; b[o++] = cb * cb; b[o++] = 0;
        continue;
      }
      // Above 1 in the HDR buffer, so particles feed the bloom and glow.
      b[o++] = px[p]; b[o++] = py[p]; b[o++] = pz[p]; b[o++] = PART_SIZE[t];
      b[o++] = c[0] * 2.5; b[o++] = c[1] * 2.5; b[o++] = c[2] * 2.5; b[o++] = 1;
    }
    gl.useProgram(real ? realPointProg : pointProg);
    gl.uniformMatrix4fv(real ? RPU.uVP : PU.uVP, false, view.VP);
    gl.uniform1f(real ? RPU.uPx : PU.uPx, h * 1.35);
    gl.bindVertexArray(pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, pointVbo);
    gl.bufferData(gl.ARRAY_BUFFER, b.subarray(0, o), gl.STREAM_DRAW);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, count);
    if (so) {
      gl.useProgram(streakProg);
      gl.uniformMatrix4fv(SKU.uVP, false, view.VP); gl.uniform2f(SKU.uRes, w, h);
      gl.bindVertexArray(streakVao); gl.bindBuffer(gl.ARRAY_BUFFER, streakVbo);
      gl.bufferData(gl.ARRAY_BUFFER, streakBuf.subarray(0, so), gl.STREAM_DRAW);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, so / 8);
    }
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.bindVertexArray(null);
  }

  // ---- Realistic look ----
  // Cells become a smooth surface on the GPU. A filter pass turns per-cell classes into a density field, rays march that field and stop at its
  // iso level, and normals come from its gradient. Colour and material still come from the nearest cell, so nothing bleeds between materials.

  // The field filter. Filled cells stay above the iso level and empty cells below it, whatever the blur says. The surface therefore always passes
  // between a filled and an empty cell: a wire one cell wide cannot vanish and a one-cell gap cannot close. Cells only one thick along an axis are
  // lifted further so they keep their width. Outside the chamber the grid repeats, so material touching a wall is cut flat by that wall.
  var FIELD_FS = [
    "#version 300 es",
    "precision highp float;precision highp int;precision highp sampler3D;",
    "layout(location=0) out vec4 oF;layout(location=1) out vec4 oT;",
    "uniform sampler3D uMat,uColor,uLum;uniform int uLayer;uniform ivec3 uDim;",
    "const float WT[7]=float[7](1.,.6,.37,.22,.135,.082,.05);",
    // The lift needs thin neighbours and little material nearby, or the rim of each stair on a curved surface would stand up as a bump.
    "float keep(bool inside,float b,int mask){if(!inside)return min(b,.44);int thin=b>.4?0:int((mask&3)==0)+int((mask&12)==0)+int((mask&48)==0);",
    " return max(b,thin==0?.56:thin==1?.7:thin==2?.8:.9);}",
    "void main(){",
    " ivec3 lo=ivec3(1),hi=uDim-2,q=clamp(ivec3(ivec2(gl_FragCoord.xy),uLayer),lo,hi);",
    // Most of the chamber is air. A block with nothing near it needs no filtering.
    " if(texelFetch(uLum,q/8,0).a<.5){oF=vec4(0.);oT=vec4(0.);return;}",
    // A wide kernel estimates where the true surface lies along a long stair tread, not just at the step. The clamp below still ties it to the cells.
    " float s=0.,sn=0.,l=0.,lw=0.,g=0.,fi=0.,soft=0.,churn=0.,sum=0.,nsum=0.;vec3 tint=vec3(0.);int cc=0,sm=0,lm=0,wm=0;bool deep=false;",
    " for(int dz=-2;dz<=2;dz++)for(int dy=-2;dy<=2;dy++)for(int dx=-2;dx<=2;dx++){",
    "  int r2=dx*dx+dy*dy+dz*dz;if(r2>6)continue;float w=WT[r2];sum+=w;if(r2<=1)nsum+=w;",
    "  ivec3 k=clamp(q+ivec3(dx,dy,dz),lo,hi);ivec4 m=ivec4(texelFetch(uMat,k,0)*255.+.5);int cl=m.g>>4;",
    "  if(r2==0)cc=cl;if(cl==4&&r2==4&&dz==-2&&q.z>=3)deep=true;if(cl==0)continue;",
    "  int face=r2==1?(1<<(dx!=0?(dx<0?0:1):dy!=0?(dy<0?2:3):(dz<0?4:5))):0;",
    "  if(cl<=3){s+=w;sm|=face;if(r2<=1)sn+=w;if(cl!=1)soft+=w;}",
    "  else if(cl<=5){l+=w;lm|=face;if(cl==4){lw+=w;wm|=face;churn+=w*float(m.b)/255.;}}",
    "  else{float a=float(m.a)/255.;g+=w*a;tint+=w*a*texelFetch(uColor,k,0).rgb;if(cl>=7)fi+=w;}",
    " }",
    " bool cs=cc>=1&&cc<=3,cl2=cc==4||cc==5||(cs&&l>0.);",
    // Static solids lean on the narrow kernel so machined edges stay crisp. Powders and opaque liquids use the wide one and round off.
    " float softF=soft/max(s,.001),sb=mix(s/sum,sn/nsum,.5*(1.-softF));",
    // Solids count as liquid where they touch it, or a thin line of air would open between water and whatever it wets.
    // Surface tension: an open pit in a liquid fills in and a lone cell sitting on the surface sinks into it, since one cell in the top layer is grid noise, not a feature.
    // Enclosed bubbles have liquid above them, droplets have none below them, and both stay. Glass and solids are never affected.
    " float lv=(l+s)/sum;int la=lm|sm;bool pit=!cl2&&(wm&16)!=0&&(la&32)==0&&lv>.48;",
    " bool bump=cc==4&&(la&16)!=0&&(la&32)==0&&int((la&1)!=0)+int((la&2)!=0)+int((la&4)!=0)+int((la&8)!=0)<=2;",
    // A pocket closed in by liquid opens out to nearly a full cell, or a one-cell bubble would be too small to see.
    " int faces=int((la&1)!=0)+int((la&2)!=0)+int((la&4)!=0)+int((la&8)!=0)+int((la&16)!=0)+int((la&32)!=0);bool pocket=!cl2&&!cs&&(lm&32)!=0&&faces>=5;",
    " oF=vec4(keep(cs,sb,sm),l>0.?(pocket?min(lv,.12):(pit||bump?lv:keep(cl2,lv,la))):0.,g/sum,fi/sum);",
    // Alpha holds foam where liquid dominates and softness where solid does. Foam comes from real agitation: moving or boiling cells, gas in the liquid, and a ragged surface.
    // It needs depth to form, so a thin film of spilt water stays clear.
    " float foam=lw>0.&&deep?clamp(churn/lw*.8+g/sum*3.+(pit||bump?.14:0.),0.,1.):0.;",
    " oT=vec4(tint/sum,l>s?foam:softF);",
    "}"
  ].join("\n");

  // Sun and sky visibility, swept down through the volume one slice at a time. Liquids and gases tint the light as they absorb it.
  var LIGHT_FS = [
    "#version 300 es",
    "precision highp float;precision highp int;precision highp sampler3D;",
    "in vec2 vUv;out vec4 f;uniform sampler3D uField,uColor;uniform sampler2D uPrev;uniform vec2 uOff,uPx;uniform float uY;uniform vec3 uDim;",
    "void main(){",
    " vec3 p=vec3(vUv.x*uDim.x,uY,vUv.y*uDim.z);vec4 v=textureLod(uField,(p/uDim).xzy,0.);",
    " float op=smoothstep(.3,.62,v.r);vec3 T=vec3(1.);",
    " if(v.g>.5&&op<1.){vec4 c=texelFetch(uColor,ivec3(p).xzy,0);if(c.a<.98&&c.a>.004)T*=exp(-((1.03-c.rgb)*c.a*2.6+c.a*.12)*2.);}",
    " if(v.b>.002)T*=exp(-v.b*4.5);",
    " vec4 a=textureLod(uPrev,vUv+uOff,0.);",
    " float sky=(textureLod(uPrev,vUv,0.).a*2.+textureLod(uPrev,vUv+uPx*vec2(2.,0.),0.).a+textureLod(uPrev,vUv-uPx*vec2(2.,0.),0.).a+textureLod(uPrev,vUv+uPx*vec2(0.,2.),0.).a+textureLod(uPrev,vUv-uPx*vec2(0.,2.),0.).a)/6.;",
    " f=vec4(a.rgb*T*(1.-op),sky*(1.-op)*dot(T,vec3(.3333)));",
    "}"
  ].join("\n");

  var SLICE_FS = "#version 300 es\nprecision highp float;out vec4 f;uniform sampler2D t;void main(){f=texelFetch(t,ivec2(gl_FragCoord.xy),0);}";

  // Widens the coarse light volume so a glow reaches further, and grows occupancy by one block, because the smooth surface can stand just outside its cells.
  var LUM_FS = [
    "#version 300 es",
    "precision highp float;precision highp int;precision highp sampler3D;",
    "out vec4 f;uniform sampler3D uCoarse;uniform int uLayer;uniform ivec3 uDim;",
    "void main(){ivec3 c=ivec3(ivec2(gl_FragCoord.xy),uLayer);vec3 sum=vec3(0.);float occ=0.;",
    " for(int z=-2;z<=2;z++)for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){ivec3 d=ivec3(x,y,z);vec4 v=texelFetch(uCoarse,clamp(c+d,ivec3(0),uDim-1),0);float r=float(x*x+y*y+z*z);",
    "  if(r<=3.)occ=max(occ,v.a);sum+=v.rgb*exp(-r*.45);}",
    " f=vec4(sum*.3,occ);}"
  ].join("\n");

  // Temporal resolve. History is reprojected through the camera move and clamped to the current neighbourhood, so moving material does not ghost.
  var TAA_FS = [
    "#version 300 es",
    "precision highp float;precision highp int;",
    "in vec2 vUv;out vec4 f;uniform sampler2D t,h;uniform mat4 uPrevVP,uInvVP;uniform vec3 uEye;uniform float uBlend;",
    "vec3 enc(vec3 c){c=c/(1.+max(c.r,max(c.g,c.b)));return vec3(c.r*.25+c.g*.5+c.b*.25,c.r*.5-c.b*.5,-c.r*.25+c.g*.5-c.b*.25);}",
    "vec3 dec(vec3 y){vec3 c=vec3(y.x+y.y-y.z,y.x+y.z,y.x-y.y-y.z);return c/max(1.-max(c.r,max(c.g,c.b)),.001);}",
    "void main(){ivec2 px=ivec2(gl_FragCoord.xy),sz=textureSize(t,0)-1;vec4 c=texelFetch(t,px,0);vec3 cur=enc(min(c.rgb,vec3(60.)));vec3 mn=cur,mx=cur;",
    " for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec3 s=enc(min(texelFetch(t,clamp(px+ivec2(x,y),ivec2(0),sz),0).rgb,vec3(60.)));mn=min(mn,s);mx=max(mx,s);}",
    " vec4 ff=uInvVP*vec4(vUv*2.-1.,1.,1.);vec3 w=uEye+normalize(ff.xyz/ff.w-uEye)*c.a;vec4 pc=uPrevVP*vec4(w,1.);vec2 uv=pc.xy/pc.w*.5+.5;",
    " if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)))){f=vec4(dec(cur),c.a);return;}",
    " vec3 hi=clamp(enc(min(textureLod(h,uv,0.).rgb,vec3(60.))),mn,mx);f=vec4(dec(mix(hi,cur,uBlend)),c.a);",
    "}"
  ].join("\n");

  // Sparks are drawn as short streaks along their real velocity: what a camera shutter sees of a hot speck. They cool from white through orange to red as their life runs out.
  var STREAK_VS = [
    "#version 300 es",
    "precision highp float;in vec4 aA;in vec4 aB;uniform mat4 uVP;uniform vec2 uRes;out vec2 vP;out float vHeat;",
    "void main(){int id=gl_VertexID;vec2 c=vec2(float(id==1||id==2||id==4),float(id==2||id==4||id==5));vP=c;vHeat=aB.w;",
    " vec4 a=uVP*vec4(aA.xyz-aB.xyz*1.4,1.),b=uVP*vec4(aA.xyz,1.);if(a.w<=.1||b.w<=.1){gl_Position=vec4(2.,2.,2.,1.);return;}",
    " vec2 sa=a.xy/a.w,sb=b.xy/b.w,dp=(sb-sa)*uRes;float len=length(dp);vec2 dir=len>.01?dp/len:vec2(1.,0.),perp=vec2(-dir.y,dir.x);float wid=clamp(aA.w*uRes.y*1.35/b.w,1.3,7.);",
    " vec4 p=mix(a,b,c.x);p.xy+=((perp*(c.y*2.-1.)+dir*(c.x*2.-1.))*wid/uRes)*p.w;gl_Position=p;}"
  ].join("\n");
  var STREAK_FS = [
    "#version 300 es",
    "precision highp float;in vec2 vP;in float vHeat;out vec4 f;",
    "void main(){float y=vP.y*2.-1.,a=(1.-y*y)*smoothstep(0.,.25,vP.x)*(1.-smoothstep(.9,1.,vP.x))*(.25+.75*vP.x);",
    " vec3 c=mix(vec3(1.6,.16,.03),vec3(3.2,1.25,.26),smoothstep(0.,.45,vHeat));c=mix(c,vec3(5.,3.9,2.3),smoothstep(.45,1.,vHeat));f=vec4(c*a*a,0.);}"
  ].join("\n");

  // Debris particles are small lit spheres of their material here. Radiation keeps its glow.
  var REAL_PFS = "#version 300 es\nprecision highp float;in vec4 vC;out vec4 f;void main(){vec2 d=gl_PointCoord-.5;float r=dot(d,d);if(r>.25)discard;if(vC.a<.5){vec3 n=vec3(d.x*2.,-d.y*2.,sqrt(max(1.-r*4.,0.)));f=vec4(vC.rgb*(.3+.8*max(dot(n,vec3(-.5,.8,.34)),0.)),1.);}else{float a=1.-r*4.;f=vec4(vC.rgb*a,a);}}";

  var MARCH_FS = [
    "#version 300 es",
    "precision highp float;precision highp int;precision highp sampler3D;precision highp sampler2D;",
    "in vec2 vUv;out vec4 frag;",
    "uniform sampler3D uColor,uMat,uField,uTint,uLight,uLum,uNoise,uEmitL;uniform sampler2D uLUT;",
    "uniform mat4 uInvVP,uVP;uniform vec3 uEye,uDim,uBrush;uniform float uBrushR,uTime,uBlock;uniform int uFrame,uFlat;uniform ivec3 uCDim;",
    // The sun comes from the side of the default view, so forms are modelled by light and shadows fall where they can be seen.
    "const vec3 SUN=normalize(vec3(-.62,.7,.34));const vec3 SUNC=vec3(3.5,3.2,2.8);const float ISO=.5;const float PI=3.14159265;",
    "vec3 tc(vec3 p){return (p/uDim).xzy;}",
    "vec4 fld(vec3 p){return textureLod(uField,tc(p),0.);}",
    "vec4 lit(vec3 p){return textureLod(uLight,tc(p),0.);}",
    "vec3 lum(vec3 p){return textureLod(uLum,tc(p),0.).rgb;}",
    "vec3 nz(vec3 p){return textureLod(uNoise,p,0.).rgb-.5;}",
    "ivec4 matAt(ivec3 c){return ivec4(texelFetch(uMat,clamp(c,ivec3(1),ivec3(uDim)-2).xzy,0)*255.+.5);}",
    "vec2 box(vec3 ro,vec3 rd,vec3 lo,vec3 hi){vec3 a=(lo-ro)/rd,b=(hi-ro)/rd;vec3 mn=min(a,b),mx=max(a,b);return vec2(max(max(mn.x,mn.y),mn.z),min(min(mx.x,mx.y),mx.z));}",
    "vec3 safe(vec3 d){return d+vec3(1e-5)*step(abs(d),vec3(1e-5));}",
    "vec3 bg(vec3 rd){float t=clamp(rd.y*.5+.5,0.,1.);return mix(vec3(.052,.056,.068),vec3(.105,.122,.155),t);}",
    // A dim studio: overhead softbox and a side strip give metal and water something to reflect. Roughness widens and dims them.
    "vec3 env(vec3 r,float rough){vec3 c=mix(vec3(.05,.046,.042),vec3(.17,.2,.26),smoothstep(-.2,.75,r.y));c+=vec3(.07,.065,.06)*exp(-abs(r.y)*8.);float s=mix(.03,.7,rough),k=1.-rough*.72;",
    " if(r.y>.02){vec2 q=r.xz/r.y;vec2 e=abs(q-vec2(.25,-.1))-vec2(.75,.5);c+=vec3(2.5,2.4,2.2)*k*(.6+.4*smoothstep(-.8,.8,q.y))*(1.-smoothstep(-s,s,max(e.x,e.y)));}",
    // A broad window on the far side, which is what a level surface mirrors from the usual viewing angle.
    " if(r.y>.02){vec2 q=r.xz/r.y;vec2 e=abs(q-vec2(-1.05,-1.2))-vec2(.85,.5);c+=vec3(.75,.84,1.)*k*(.45+.55*smoothstep(-1.7,-.7,q.y))*(1.-smoothstep(-s*1.5,s*1.5,max(e.x,e.y)));}",
    " float b=dot(r,normalize(vec3(-.82,.24,.52)));c+=vec3(1.5,1.65,1.9)*k*smoothstep(.93-s*.3,.96+s*.05,b);return c;}",
    "vec3 envBRDF(vec3 F0,float r,float nv){vec4 q=r*vec4(-1.,-.0275,-.572,.022)+vec4(1.,.0425,1.04,-.04);float a=min(q.x*q.x,exp(-9.28*nv))*q.x+q.y;vec2 ab=vec2(-1.04,1.04)*a+q.zw;return F0*ab.x+ab.y;}",
    "float ggx(vec3 N,vec3 V,vec3 L,float r,inout vec3 F0){vec3 H=normalize(V+L);float nh=max(dot(N,H),0.),nv=max(dot(N,V),.02),nl=max(dot(N,L),.0),vh=max(dot(V,H),0.);float a=r*r,a2=a*a,dn=nh*nh*(a2-1.)+1.,D=a2/(PI*dn*dn),k=(r+1.)*(r+1.)/8.,G=(nl/(nl*(1.-k)+k))*(nv/(nv*(1.-k)+k));F0=F0+(1.-F0)*pow(1.-vh,5.);return D*G/max(4.*nl*nv,.002);}",
    // A short sun ray over the fine field for contact shadows. The swept volume handles everything further away.
    "float contact(vec3 p,vec3 N){float t=.45,s=1.;p+=N*.5;for(int i=0;i<12;i++){vec3 q=p+SUN*t;float v=fld(q).r;s=min(s,1.-smoothstep(ISO-.1,ISO+.06,v));if(s<.01)break;t+=.4+t*.22;}return s;}",
    // One glossy bounce per pixel. It sees surfaces, their glow, and the studio beyond.
    "vec3 reflTrace(vec3 ro,vec3 rd,float rough,float ign){rd=safe(rd);float tm=box(ro,rd,vec3(1.),uDim-1.).y,t=.45+ign*.6;",
    " for(int i=0;i<38;i++){if(t>tm)break;vec3 p=ro+rd*t;vec4 f=fld(p);if(f.r>ISO||f.g>ISO){vec4 m=f.r>ISO?vec4(1.,0.,0.,0.):vec4(0.,1.,0.,0.);vec3 e=vec3(1.2,0.,0.);vec3 g=vec3(dot(fld(p+e.xyy)-f,m),dot(fld(p+e.yxy)-f,m),dot(fld(p+e.yyx)-f,m));vec3 N=-normalize(g+vec3(1e-5));",
    "   ivec3 c=ivec3(floor(p-N*.3));vec4 a=texelFetch(uColor,clamp(c,ivec3(1),ivec3(uDim)-2).xzy,0);vec4 l=lit(p+N*1.5);vec3 e2=textureLod(uEmitL,tc(p-N*.4),0.).rgb;",
    "   vec3 col=a.rgb*a.rgb*(vec3(.3,.33,.4)*(.2+.8*l.a)+SUNC/PI*max(dot(N,SUN),0.)*l.rgb+lum(p+N*2.))+e2*e2*1.5;if(a.a<.98)col=mix(env(rd,rough),col,.35);return col;}",
    "  t+=max(.7,t*.07);}",
    " if(rd.y<0.){float tf=(1.-ro.y)/rd.y;vec3 h=ro+rd*tf;if(h.x>=1.&&h.z>=1.&&h.x<=uDim.x-1.&&h.z<=uDim.z-1.){vec4 l=lit(h+vec3(0.,1.5,0.));return vec3(.05,.055,.065)*(vec3(.3,.33,.4)*(.2+.8*l.a)+SUNC/PI*SUN.y*l.rgb)+lum(h+vec3(0.,1.5,0.))*.05;}}",
    " return env(rd,rough);}",
    "void main(){",
    " vec2 ndc=vUv*2.-1.;vec4 nf=uInvVP*vec4(ndc,-1.,1.),ff=uInvVP*vec4(ndc,1.,1.);vec3 ro=uEye,rd=safe(normalize(ff.xyz/ff.w-nf.xyz/nf.w));",
    " vec3 lo=vec3(1.),hi=uDim-1.;float ign=fract(52.9829189*fract(dot(gl_FragCoord.xy+float(uFrame%64)*5.588238,vec2(.06711056,.00583715))));",
    " vec2 tb=box(ro,rd,lo,hi);vec3 acc=vec3(0.),tr=vec3(1.),o=ro,d=rd,P=vec3(0.),N=vec3(0.,1.,0.);float firstT=-1.;bool hit=false,isFloor=false;",
    " bool rUsed=false;vec3 rO=vec3(0.),rD=vec3(0.,1.,0.),rW=vec3(0.);float rRough=0.;",
    " if(tb.x<tb.y&&tb.y>0.){",
    "  float t=max(tb.x,0.)+1e-3,tEnd=tb.y,prevT=t;bool inL=false,first=true;int bounces=0;",
    "  vec3 boxN;{vec3 q=(o+d*t-lo)/(hi-lo);vec3 e=min(q,1.-q);vec3 st=sign(d);if(e.x<e.y&&e.x<e.z)boxN=vec3(-st.x,0.,0.);else if(e.z<e.y)boxN=vec3(0.,0.,-st.z);else boxN=vec3(0.,-st.y,0.);}",
    "  for(int i=0;i<640;i++){",
    "   if(t>=tEnd)break;",
    "   vec3 p=o+d*t;vec4 cs=vec4(0.);",
    // Empty block: jump to its far side and add the glow it scatters.
    "   if(!inL){ivec3 bi=clamp(ivec3(floor(p/uBlock)),ivec3(0),uCDim-1);cs=texelFetch(uLum,bi.xzy,0);if(cs.a<.5){vec3 bl=vec3(bi)*uBlock;float tn=max(box(o,d,bl,bl+uBlock).y,t)+.01;if(cs.r+cs.g+cs.b>.002)acc+=tr*lum(o+d*.5*(t+tn))*(tn-t)*.005;t=tn+ign*.5;prevT=t;first=false;continue;}}",
    "   vec4 f=fld(p);",
    "   int ev=f.r>ISO?1:(!inL&&f.g>ISO?2:(inL&&f.g<ISO?3:0));",
    "   if(ev>0){",
    "    vec4 m=ev==1?vec4(1.,0.,0.,0.):vec4(0.,1.,0.,0.);float th=t;",
    "    if(t>prevT){float a=prevT,b=t;bool rise=ev!=3;for(int k=0;k<5;k++){float c=.5*(a+b);if((dot(fld(o+d*c),m)>ISO)==rise)b=c;else a=c;}th=b;}",
    // The normal blends two scales of the gradient: the fine one keeps edges, the broad one rides over what is left of the cell steps.
    "    vec3 ph=o+d*th;vec3 e=vec3(1.05,0.,0.),e2=vec3(2.3,0.,0.);vec3 g=vec3(dot(fld(ph+e.xyy)-fld(ph-e.xyy),m),dot(fld(ph+e.yxy)-fld(ph-e.yxy),m),dot(fld(ph+e.yyx)-fld(ph-e.yyx),m));",
    // Glass keeps only the fine scale, so a flat pane stays flat where water meets it.
    "    bool pane=ev!=1&&(matAt(ivec3(floor(ph+(ev==2?d:-d)*.7))).g>>4)==5;",
    "    float wB=ev==1?mix(.25,.9,textureLod(uTint,tc(ph),0.).a):1.1;if(!pane)g+=wB*vec3(dot(fld(ph+e2.xyy)-fld(ph-e2.xyy),m),dot(fld(ph+e2.yxy)-fld(ph-e2.yxy),m),dot(fld(ph+e2.yyx)-fld(ph-e2.yyx),m));",
    // Liquids get a third, broader scale: they should be the smoothest surfaces in the scene.
    "    if(ev!=1&&!pane){vec3 e3=vec3(3.9,0.,0.);g+=.8*vec3(dot(fld(ph+e3.xyy)-fld(ph-e3.xyy),m),dot(fld(ph+e3.yxy)-fld(ph-e3.yxy),m),dot(fld(ph+e3.yyx)-fld(ph-e3.yyx),m));}",
    "    vec3 gn=dot(g,g)>1e-8?normalize(g):-d;if(first&&ev!=3)gn=-boxN;",
    "    if(firstT<0.&&ev!=3)firstT=th;",
    "    if(ev==1){hit=true;P=ph;N=-gn;if(dot(N,d)>0.)N=normalize(N-d*dot(N,d)*1.05);break;}",
    "    if(++bounces>16)break;",
    "    if(ev==2){",
    // Into a liquid: Fresnel reflection, a sharp sun glint, then the ray bends and carries on underneath. Glass walls are thin, so they reflect but do not bend.
    "     ivec4 mm=matAt(ivec3(floor(ph+d*.7)));int cl=mm.g>>4;int id=mm.r|((mm.g&15)<<8);float n=(cl==4||cl==5)?1.+texelFetch(uLUT,ivec2(id&63,id>>6),0).b*1.5:1.333;",
    "     vec3 Nf=-gn;if(cl==4&&!first){Nf=normalize(Nf+(nz(ph*.018+vec3(uTime*.012,0.,uTime*.009))+nz(ph*.045-vec3(uTime*.02,0.,uTime*.016))*.5)*.09);}if(dot(Nf,d)>0.)Nf=-gn;",
    "     float nv=max(dot(Nf,-d),0.);float F0=(n-1.)/(n+1.);F0*=F0;float F=F0+(1.-F0)*pow(1.-nv,5.);if(cl==5)F=min(F,.45);",
    "     vec3 F3=vec3(F0);float D=ggx(Nf,-d,SUN,.09,F3);vec4 l=lit(ph+Nf*1.5);acc+=tr*F3*D*SUNC*max(dot(Nf,SUN),0.)*l.rgb;",
    // Foam: a lacy web of bubbles drifting on the water, thin where agitation is slight. It is lit as a rough diffuse film, not painted on opaque.
    "     if(cl==4){float fa=textureLod(uTint,tc(ph),0.).a;if(fa>.03){float n3=textureLod(uNoise,ph*.022+vec3(uTime*.006,0.,uTime*.004),0.).r,n4=textureLod(uNoise,ph*.075-vec3(uTime*.01,0.,uTime*.006),0.).g;float lace=1.-abs(n3*2.-1.);float c=smoothstep(.95-fa*.75,1.4-fa*.75,lace*.8+n4*.6)*min(fa*2.2,.78);acc+=tr*c*(SUNC*max(Nf.y*.7+.3,0.)*l.rgb/PI*.8+l.a*vec3(.36,.4,.46)+.05);tr*=1.-c;}}",
    "     if(!rUsed){rUsed=true;rO=ph+Nf*.25;rD=reflect(d,Nf);rW=tr*F;rRough=.1;}else acc+=tr*F*env(reflect(d,Nf),.05);",
    "     tr*=1.-F;",
    "     vec3 nd=cl==5?d:refract(d,Nf,1./n);if(dot(nd,nd)>.1)d=safe(nd);o=ph;t=.02;prevT=t;tEnd=box(o,d,lo,hi).y;inL=true;first=false;continue;",
    "    }",
    // Out of a liquid: bend back, or reflect internally at a shallow angle, as the underside of a water surface does.
    "    ivec4 mm=matAt(ivec3(floor(ph-d*.7)));int cl=mm.g>>4;int id=mm.r|((mm.g&15)<<8);float n=cl==5?1.:((cl==4)?1.+texelFetch(uLUT,ivec2(id&63,id>>6),0).b*1.5:1.333);",
    // The inside of a bubble wall mirrors the surroundings, brightest at its rim. That rim is what makes a bubble readable.
    "    vec3 nd=refract(d,gn,n);if(dot(nd,nd)<.1){acc+=tr*.5*env(reflect(d,gn),.08);tr*=.5;d=safe(reflect(d,gn));}else{float F0x=(n-1.)/(n+1.);F0x*=F0x;float Fx=F0x+(1.-F0x)*pow(1.-max(dot(gn,-d),0.),5.);acc+=tr*(Fx*env(reflect(d,gn),.08)+pow(max(dot(reflect(d,gn),SUN),0.),48.)*SUNC*lit(ph+vec3(0.,1.5,0.)).rgb*.35);tr*=1.-Fx;d=safe(nd);inL=false;}o=ph;t=.02;prevT=t;tEnd=box(o,d,lo,hi).y;continue;",
    "   }",
    "   float ds=t-prevT,fA=f.a,lift=0.;",
    "   if(inL){",
    // Inside a liquid each colour is absorbed at its own rate, cell by cell. Deep water turns blue and shallow water stays clear.
    // The lowest alpha bit marks a true liquid. Glass only tints what passes through it.
    "    vec4 c=texelFetch(uColor,ivec3(floor(p)).xzy,0);if(c.a>.004&&c.a<.98){bool wet=(int(c.a*255.+.5)&1)==1;vec3 tn=exp(-((1.03-c.rgb)*c.a*(wet?2.6:.8)+c.a*(wet?.12:.03))*ds);if(wet){vec4 l=lit(p);acc+=tr*(1.-tn)*c.rgb*(l.rgb*SUNC*.09+l.a*vec3(.2,.24,.3)+.03+lum(p)*.8)*.5;}tr*=tn;vec3 e2=textureLod(uEmitL,tc(p),0.).rgb;acc+=tr*e2*e2*1.1*ds;}",
    "   }else{",
    "    if(cs.r+cs.g+cs.b>.002){acc+=tr*lum(p)*ds*.005;",
    // Sim flames die within a few cells. Reading the flame field lower down carries each tongue a little higher as it thins, inside the block that glows anyway.
    "     float u1=fld(p-vec3(0.,3.5,0.)).a*.8,u2=fld(p-vec3(0.,7.5,0.)).a*.5;if(u1>fA||u2>fA){if(u1>=u2){fA=u1;lift=3.5;}else{fA=u2;lift=7.5;}}}",
    // Gas and fire are volumes. Noise carried upward breaks the cells into wisps and tongues, and gas is lit by the swept sun.
    "    if(f.b>.002||fA>.002){",
    // Everything is sampled through a slowly rolling warp, so detail curls instead of sliding past on straight lines.
    "     vec3 w1=textureLod(uNoise,(p-vec3(0.,uTime*4.,0.))*.0105,0.).rgb-.5;vec3 q=p+w1*7.;",
    "     float n1=textureLod(uNoise,(q-vec3(0.,uTime*8.,0.))*.024,0.).r,n2=textureLod(uNoise,(q-vec3(0.,uTime*13.,0.))*.071,0.).g;",
    "     vec3 tcol=f.b>.002?textureLod(uTint,tc(p),0.).rgb/max(f.b,.002):vec3(0.);",
    "     if(fA>.002){",
    // Fire: tongues stretched upward and racing up. Hue comes from the sim, so flame-test colours stay true. The core runs hotter and whiter, and the tips darken.
    "      float nf=textureLod(uNoise,(q*vec3(1.,.3,1.)-vec3(0.,uTime*22.,0.))*.026,0.).r,nf2=textureLod(uNoise,(q*vec3(1.,.42,1.)-vec3(0.,uTime*34.,0.))*.06,0.).g;",
    "      float tongue=nf*.95+nf2*.3;float shape=smoothstep(.16,.5,fA*(.15+tongue*1.75));float core=smoothstep(.34,.8,fA*(.3+tongue*1.1));",
    "      vec3 eP=p-vec3(0.,lift,0.)+w1*1.5;vec3 e2=textureLod(uEmitL,tc(eP),0.).rgb;vec3 em=e2*e2;vec3 tq=lift>0.?textureLod(uTint,tc(p-vec3(0.,lift,0.)),0.).rgb:tcol*max(f.b,.002);float mh=max(tq.r,max(tq.g,tq.b));if(mh>.0005)em=max(em,(tq/mh)*(tq/mh)*.32*fA);",
    "      float warm=clamp((em.r-em.b)/max(em.r,.001),0.,1.);vec3 ramp=mix(mix(vec3(.55),vec3(1.,.4,.12),warm),mix(vec3(1.5),vec3(1.7,1.42,1.),warm),core);",
    // A flame is optically thick, so looking through more of it approaches its surface brightness and stops there.
    "      acc+=tr*em*ramp*shape*1.9*ds;tr*=exp(-shape*ds*.62);",
    "     }else if(f.b>.002){vec3 e2=textureLod(uEmitL,tc(p),0.).rgb;acc+=tr*e2*e2*.7*ds;}",
    "     if(f.b>.002){",
    // Steam and smoke: edges eaten into billows while the dense body holds. Lit by the swept sun, a short self-shadow toward it, forward scattering and any nearby glow.
    "      float rel=f.b/(f.b+.035),puff=n1*.8+n2*.42;float k=smoothstep(.66-rel*.8,.98-rel*.62,puff);float a=f.b*k*1.7;",
    "      float selfS=exp(-(fld(p+SUN*1.3).b+fld(p+SUN*3.2).b)*5.);float cosA=dot(d,SUN),hg=.82/pow(1.1225-.7*cosA,1.5)*.42;",
    "      vec4 l=lit(p);vec3 tn=exp(-((1.03-tcol)*a*.7+a*1.5)*ds);",
    "      acc+=tr*(1.-tn)*tcol*(l.rgb*SUNC*selfS*hg*.42+l.a*vec3(.3,.33,.4)*(.75+.25*selfS)+.05+lum(p)*1.5);tr*=tn;",
    "     }",
    "    }",
    "   }",
    "   if(max(tr.r,max(tr.g,tr.b))<.01)break;",
    "   float near=inL?f.r:f.r+f.g;float stp=inL?((f.r>.01||f.g<.97)?.5:1.5):(near>.003?.3:1.);if(!inL&&(f.b>.002||fA>.002))stp=min(stp,.7);",
    "   prevT=t;t+=first?stp*(.4+ign):stp;first=false;",
    "  }",
    " }",
    // Floor: a dark satin plate, shaded through the same path as every other surface. Its grid is faint but still gives a sense of scale.
    " if(!hit&&d.y<0.&&max(tr.r,max(tr.g,tr.b))>.01){float tf=(1.-o.y)/d.y;if(tf>0.){vec3 h=o+d*tf;if(h.x>=1.&&h.z>=1.&&h.x<=hi.x&&h.z<=hi.z){hit=true;isFloor=true;P=h;N=vec3(0.,1.,0.);if(firstT<0.)firstT=tf;}}}",
    " if(hit){",
    "  vec3 alb=vec3(.3),V=-d;float metal=0.,rough=.6,n=1.5,det=0.;int cl=1;",
    "  if(isFloor){vec2 g=abs(fract(P.xz/16.)-.5);float dd=min(g.x,g.y)*16.;float w=.03+length(P-ro)*.0014;alb=mix(vec3(.05,.053,.06),vec3(.1,.105,.118),(1.-smoothstep(0.,w+.03,dd))*.5);rough=.5;n=1.4;}",
    "  else{",
    // Nearest filled cell, so material edges stay exact. Noise shifts the lookup slightly so a boundary does not trace the grid.
    "   vec3 w=(nz(P*.036)+nz(P*.1)*.45)*1.5;ivec4 mm=ivec4(0);ivec3 cell=ivec3(0);bool found=false;",
    "   for(int k=0;k<20&&!found;k++){vec3 q;if(k==0)q=P-N*.3+w;else if(k==1)q=P-N*.3;else if(k==2)q=P-N*.85;else{int b=k-3;float rad=b<8?.5:1.3;q=P+rad*(vec3(float(b&1),float((b>>1)&1),float((b>>2)&1))*2.-1.);}",
    "    cell=clamp(ivec3(floor(q)),ivec3(1),ivec3(uDim)-2);mm=matAt(cell);int c2=mm.g>>4;found=c2>=1&&c2<=3;}",
    "   if(found){cl=mm.g>>4;int id=mm.r|((mm.g&15)<<8);vec4 cc=texelFetch(uColor,cell.xzy,0);float v=.75+float(mm.b)/255.*.5;alb=cc.rgb/v;alb*=alb;vec4 L=texelFetch(uLUT,ivec2(id&63,id>>6),0);metal=L.r;rough=max(L.g,.04);n=1.+L.b*1.5;det=L.a;}",
    "   if(uFlat==1){metal=0.;rough=.65;det=0.;}",
    "   else if(cl==2){",
    // Powder: heaps of grains. Fine noise roughens the normal and varies brightness grain to grain, with dark gaps between them.
    "    vec4 g1=textureLod(uNoise,P*.11,0.),g2=textureLod(uNoise,P*.27,0.);N=normalize(N+(g1.xyz-.5)*.8+(g2.xyz-.5)*.55);alb*=.62+g1.a*.5+g2.a*.34;rough=max(rough,.82);",
    "   }else if(cl==3){",
    // Molten metal and other opaque liquids: mirror-smooth, with a slow surface swell.
    "    N=normalize(N+nz(P*.02+vec3(uTime*.01,0.,uTime*.008))*.05);rough=min(rough,.14);",
    "   }else{",
    // Solids: broad variation across the surface plus fine tooling marks, scaled by the material's detail.
    "    vec4 g1=textureLod(uNoise,P*.021,0.),g2=textureLod(uNoise,P*.083,0.);N=normalize(N+((g1.xyz-.5)*.1+(g2.xyz-.5)*.08)*det*(1.-metal*.6));alb*=mix(1.,.8+g1.a*.42,det);rough=clamp(rough*(.78+g2.a*.46),.04,1.);",
    "   }",
    "  }",
    "  if(dot(N,V)<.02)N=normalize(N+V*(.02-dot(N,V)));",
    "  float nv=max(dot(N,V),.02),nl=max(dot(N,SUN),0.);vec4 l=lit(P+N*1.5);vec3 sunV=l.rgb;if(nl>0.&&dot(sunV,sunV)>.0001)sunV*=contact(P,N);else if(nl<=0.)sunV=vec3(0.);",
    // Ambient occlusion from the field itself, tapped along the normal.
    "  float ao=1.;{vec4 a1=fld(P+N*1.),a2=fld(P+N*2.4),a3=fld(P+N*5.);ao=clamp(1.-a1.r*.32-a2.r*.46-a3.r*.34,.12,1.);}",
    // Light caught under a liquid surface forms a moving net of caustics.
    "  vec3 sunL=sunV;{float u=fld(P+N*.8).g;if(u>ISO&&!isFloor||(isFloor&&u>ISO)){vec3 c1=P*.012+vec3(uTime*.012,0.,uTime*.009),c2=P*.017-vec3(uTime*.01,0.,uTime*.014);float q=1.-abs(textureLod(uNoise,c1,0.).r+textureLod(uNoise,c2,0.).g-1.);sunL*=.8+.9*pow(clamp(q,0.,1.),6.);}}",
    "  float F0d=(n-1.)/(n+1.);F0d*=F0d;vec3 F0=mix(vec3(F0d),alb,metal);vec3 Fg=F0;float D=ggx(N,V,SUN,max(rough,.05),Fg);",
    "  vec3 irr=mix(vec3(.08,.075,.07),vec3(.34,.38,.46),N.y*.5+.5)*(.14+.86*l.a)*ao;vec3 glow=lum(P+N*2.)*1.6;glow/=1.+max(glow.r,max(glow.g,glow.b))*.85;",
    "  vec3 surf=alb*(1.-metal)*(irr+glow+SUNC*nl*sunL/PI)+Fg*D*SUNC*nl*sunL;",
    "  vec3 B=envBRDF(F0,rough,nv);vec3 R=reflect(d,N);if(!rUsed&&rough<.56&&(metal>.3||isFloor||rough<.3)){vec3 j=nz((vec3(floor(gl_FragCoord.xy),float(uFrame%32))+.5)/32.)*rough*rough*1.1;rUsed=true;rO=P+N*.25;rD=normalize(R+j);rW=tr*B*(.15+.85*ao);rRough=rough;}else surf+=B*env(R,rough)*(.2+.8*l.a)*ao;",
    "  surf+=B*glow*.6*step(.3,metal);",
    // Incandescent surfaces saturate as they heat, so a white-hot lump still shows its form.
    "  if(!isFloor){vec3 e2=textureLod(uEmitL,tc(P-N*.4),0.).rgb;surf+=e2*e2*1.15;}",
    "  acc+=tr*surf;tr=vec3(0.);",
    " }",
    " if(rUsed)acc+=rW*reflTrace(rO,rD,rRough,ign);",
    " vec3 outline=vec3(0.);{vec2 tt=box(ro,rd,lo,hi);if(tt.x<tt.y&&tt.y>0.){for(int k=0;k<2;k++){float tk=k==0?tt.x:tt.y;if(tk<0.)continue;vec3 q=ro+rd*tk;vec3 dd=min(abs(q-lo),abs(q-hi));float m=dd.x+dd.y+dd.z-max(max(dd.x,dd.y),dd.z);float w=tk*.0016;outline+=vec3(.24,.28,.36)*(1.-smoothstep(0.,w+.05,m))*(k==0?1.:.55);}}}",
    " vec3 c3=acc+tr*bg(d)+outline*max(tr.r,max(tr.g,tr.b));",
    " if(uBrushR>0.){vec3 oc=ro-uBrush;float b=dot(oc,rd),cc=dot(oc,oc)-uBrushR*uBrushR,h=b*b-cc;if(h>0.){float q=sqrt(h);float s=-b-q;if(s>0.){float rim=pow(1.-clamp(q/uBrushR,0.,1.),2.);c3+=vec3(.34,.42,.55)*(.03+rim*.32);}}}",
    " if(any(isnan(c3))||any(isinf(c3)))c3=vec3(0.);",
    " frag=vec4(c3,firstT<0.?3000.:firstT);",
    " if(firstT>=0.){vec4 cp=uVP*vec4(ro+rd*firstT,1.);gl_FragDepth=clamp(cp.z/cp.w*.5+.5,0.,1.);}else gl_FragDepth=1.;",
    "}"
  ].join("\n");

  var realProg = null, realReady = false, realFailed = false, realCompileExt = null, realShaders = null, RU = {}, fieldProg, lightProg, sliceProg, sliceT, lumProg, taaProg, realPointProg, streakProg, streakVao, streakVbo, streakBuf, simBuf, SKU = {}, FU = {}, LU = {}, MU = {}, TU = {}, RPU = {};
  var texMat = null, texField, texTint, texLight, texLum, texLUT, texNoise, lightScratch = [], lightFBO = [], lightWait = 0, fieldFBO = [], lumFBO = null, settle = null, rowRect = null, emitSampler, lumDirty = true, snapField = true, lastFrameTime = 0, simClock = 0, lastTick = -1;
  var hist = [], histW = 0, histH = 0, histValid = false, histI = 0, frameN = 0, prevVP = null;
  var LIGHT_SCALE = 2, SETTLE_SECONDS = 0.9, FIELD_TAU = 0.045, FLAME_TAU = 0.11, TAA_BLEND = 0.12;
  R.look = "classic";

  function uniforms(p, map, names) { names.forEach(function (n) { map[n] = gl.getUniformLocation(p, n); }); }

  function initRealistic() {
    realCompileExt = gl.getExtension("KHR_parallel_shader_compile");
    fieldProg = link(VS, FIELD_FS); lightProg = link(VS, LIGHT_FS); sliceProg = link(VS, SLICE_FS); sliceT = gl.getUniformLocation(sliceProg, "t"); lumProg = link(VS, LUM_FS); taaProg = link(VS, TAA_FS); realPointProg = link(PVS, REAL_PFS);
    uniforms(fieldProg, FU, ["uMat", "uColor", "uLum", "uLayer", "uDim"]);
    uniforms(lightProg, LU, ["uField", "uColor", "uPrev", "uOff", "uPx", "uY", "uDim"]);
    uniforms(lumProg, RU, ["uCoarse", "uLayer", "uDim"]);
    uniforms(taaProg, TU, ["t", "h", "uPrevVP", "uInvVP", "uEye", "uBlend"]);
    uniforms(realPointProg, RPU, ["uVP", "uPx"]);
    streakProg = link(STREAK_VS, STREAK_FS);
    uniforms(streakProg, SKU, ["uVP", "uRes"]);
    streakVao = gl.createVertexArray(); streakVbo = gl.createBuffer();
    streakBuf = new Float32Array(8 * Sim.MAX_PARTICLES);
    gl.bindVertexArray(streakVao); gl.bindBuffer(gl.ARRAY_BUFFER, streakVbo);
    var sA = gl.getAttribLocation(streakProg, "aA"), sB = gl.getAttribLocation(streakProg, "aB");
    gl.enableVertexAttribArray(sA); gl.vertexAttribPointer(sA, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(sA, 1);
    gl.enableVertexAttribArray(sB); gl.vertexAttribPointer(sB, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(sB, 1);
    gl.bindVertexArray(null);
    var vs = gl.createShader(gl.VERTEX_SHADER), fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(vs, VS); gl.compileShader(vs);
    gl.shaderSource(fs, MARCH_FS); gl.compileShader(fs);
    realProg = gl.createProgram();
    gl.attachShader(realProg, vs); gl.attachShader(realProg, fs); gl.linkProgram(realProg);
    realShaders = [vs, fs];
    emitSampler = gl.createSampler();
    gl.samplerParameteri(emitSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.samplerParameteri(emitSampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    ["TEXTURE_WRAP_S", "TEXTURE_WRAP_T", "TEXTURE_WRAP_R"].forEach(function (w2) { gl.samplerParameteri(emitSampler, gl[w2], gl.CLAMP_TO_EDGE); });
    var saved = null;
    try { saved = localStorage.getItem("elemental.look"); } catch (e) { saved = null; }
    R.look = saved === "classic" ? "classic" : "realistic";
    addLookToggle();
  }

  // The big raymarch shader compiles in the background, since it can take several seconds the first time. The original look shows until it is ready.
  function pollRealistic() {
    if (realReady || realFailed || !realProg) return;
    if (realCompileExt && !gl.getProgramParameter(realProg, realCompileExt.COMPLETION_STATUS_KHR)) return;
    if (!gl.getProgramParameter(realProg, gl.LINK_STATUS)) {
      console.error("Realistic renderer unavailable: " + gl.getProgramInfoLog(realProg) + "\n" + gl.getShaderInfoLog(realShaders[1]));
      realFailed = true; R.look = "classic";
      var b = document.getElementById("lookBtn"); if (b) { b.disabled = true; b.setAttribute("aria-pressed", "false"); b.title = "The realistic look could not start on this graphics driver."; }
      return;
    }
    uniforms(realProg, MU, ["uColor", "uMat", "uField", "uTint", "uLight", "uLum", "uNoise", "uEmitL", "uLUT", "uInvVP", "uVP", "uEye", "uDim", "uBrush", "uBrushR", "uTime", "uBlock", "uFrame", "uFlat", "uCDim"]);
    realReady = true;
    if (R.look === "realistic") R.markAllDirty();
  }
  function realActive() { return realReady && R.look === "realistic"; }

  function addLookToggle() {
    var anchor = document.getElementById("phView");
    if (anchor && anchor.parentNode) {
      var b = document.createElement("button");
      b.id = "lookBtn"; b.textContent = "Realistic"; b.title = "L: switch between the realistic renderer and the original voxel look";
      b.setAttribute("aria-pressed", R.look === "realistic" ? "true" : "false");
      b.onclick = function () { R.setLook(R.look === "realistic" ? "classic" : "realistic"); };
      anchor.parentNode.insertBefore(b, anchor.nextSibling);
    }
    window.addEventListener("keydown", function (e) {
      if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "l" || e.key === "L") R.setLook(R.look === "realistic" ? "classic" : "realistic");
    });
  }
  R.setLook = function (v) {
    if (realFailed || !realProg) return;
    R.look = v;
    try { localStorage.setItem("elemental.look", v); } catch (e) { /* the choice just will not persist */ }
    var b = document.getElementById("lookBtn"); if (b) b.setAttribute("aria-pressed", v === "realistic" ? "true" : "false");
    histValid = false; snapField = true;
    R.markAllDirty();
  };

  function freeVolumes() {
    if (!texMat) return;
    [texMat, texField, texTint, texLight, texLum].forEach(function (t) { gl.deleteTexture(t); });
    lightScratch.forEach(function (s) { gl.deleteFramebuffer(s.fbo); gl.deleteTexture(s.tex); });
    fieldFBO.concat(lightFBO).forEach(function (f) { gl.deleteFramebuffer(f); });
    if (lumFBO) gl.deleteFramebuffer(lumFBO);
    texMat = null; lightScratch = []; lightFBO = []; fieldFBO = []; lumFBO = null;
  }

  function ensureVolumes() {
    if (texMat) return;
    texMat = tex3D(5, W, D, H, gl.RGBA8, gl.NEAREST);
    texField = tex3D(6, W, D, H, gl.RGBA16F, gl.LINEAR);
    texTint = tex3D(7, W, D, H, gl.RGBA16F, gl.LINEAR);
    var lw = Math.ceil(W / LIGHT_SCALE), ld = Math.ceil(D / LIGHT_SCALE), lh = Math.ceil(H / LIGHT_SCALE);
    texLight = tex3D(8, lw, ld, lh, gl.RGBA8, gl.LINEAR);
    texLum = tex3D(9, cW, cD, cH, gl.RGBA16F, gl.LINEAR);
    if (!texLUT) {
      texLUT = gl.createTexture();
      gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, texLUT);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, Shade.materialLUT());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    if (!texNoise) {
      var N = 32, buf = new Uint8Array(N * N * N * 4), seed = 12345;
      for (var i = 0; i < buf.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; buf[i] = seed >>> 24; }
      texNoise = gl.createTexture();
      gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_3D, texNoise);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, N, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      ["TEXTURE_WRAP_S", "TEXTURE_WRAP_T", "TEXTURE_WRAP_R"].forEach(function (w2) { gl.texParameteri(gl.TEXTURE_3D, gl[w2], gl.REPEAT); });
    }
    for (var y = 0; y < H; y++) {
      var f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texField, 0, y);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, texTint, 0, y);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      fieldFBO.push(f);
    }
    lumFBO = gl.createFramebuffer();
    for (var s = 0; s < 2; s++) {
      var t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, lw, ld);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      lightScratch.push({ tex: t, fbo: fb, w: lw, h: ld, layers: lh });
    }
    for (var ll = 0; ll < lh; ll++) {
      var lf = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, lf);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texLight, 0, ll);
      lightFBO.push(lf);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    settle = new Float64Array(Sim.DIRTY.length);
    rowRect = new Int32Array(Sim.ch * 4);
    snapField = true; lumDirty = true; histValid = false;
    Sim.DIRTY.fill(1);
  }

  // Refilter only the layers and rectangles near recent changes. A chunk stays active a little after its last change while the field eases to its target.
  // Hardware blending does the temporal smoothing, so the volume needs no second copy to read the previous frame from.
  function updateField(time, dt) {
    var CS = Sim.CHUNK, cw = Sim.cw, cd = Sim.cd, ch = Sim.ch, any = false;
    rowRect.fill(-1);
    for (var cy = 0; cy < ch; cy++) for (var cz = 0; cz < cd; cz++) for (var cx = 0; cx < cw; cx++) {
      if (settle[cx + cz * cw + cy * cw * cd] <= time) continue;
      var r = cy * 4, x0 = cx * CS, z0 = cz * CS, x1 = x0 + CS, z1 = z0 + CS;
      if (rowRect[r] < 0) { rowRect[r] = x0; rowRect[r + 1] = z0; rowRect[r + 2] = x1; rowRect[r + 3] = z1; }
      else { rowRect[r] = Math.min(rowRect[r], x0); rowRect[r + 1] = Math.min(rowRect[r + 1], z0); rowRect[r + 2] = Math.max(rowRect[r + 2], x1); rowRect[r + 3] = Math.max(rowRect[r + 3], z1); }
      any = true;
    }
    if (!any) return false;
    var alpha = snapField ? 1 : 1 - Math.exp(-dt / FIELD_TAU), slow = snapField ? 1 : 1 - Math.exp(-dt / FLAME_TAU);
    snapField = false;
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(fieldProg);
    gl.uniform1i(FU.uMat, 5); gl.uniform1i(FU.uColor, 0); gl.uniform1i(FU.uLum, 9); gl.uniform3i(FU.uDim, W, D, H);
    gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_3D, texLum);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_3D, texMat);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, texColor);
    gl.viewport(0, 0, W, D);
    gl.enable(gl.SCISSOR_TEST);
    // Alpha, which holds flame and foam, eases more slowly than the surfaces, so they swell and die away instead of flickering with each tick.
    if (alpha < 0.999) { gl.enable(gl.BLEND); gl.blendColor(alpha, alpha, alpha, slow); gl.blendFuncSeparate(gl.CONSTANT_COLOR, gl.ONE_MINUS_CONSTANT_COLOR, gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA); } else gl.disable(gl.BLEND);
    for (var y = 0; y < H; y++) {
      // A change reaches two cells into the layers either side of its chunk, the reach of the filter.
      var c0 = (Math.max(0, y - 2) / CS) | 0, c1 = (Math.min(H - 1, y + 2) / CS) | 0, rx0 = 1e9, rz0 = 1e9, rx1 = -1, rz1 = -1;
      for (var cr = c0; cr <= c1; cr++) {
        if (rowRect[cr * 4] < 0) continue;
        rx0 = Math.min(rx0, rowRect[cr * 4]); rz0 = Math.min(rz0, rowRect[cr * 4 + 1]); rx1 = Math.max(rx1, rowRect[cr * 4 + 2]); rz1 = Math.max(rz1, rowRect[cr * 4 + 3]);
      }
      if (rx1 < 0) continue;
      rx0 = Math.max(0, rx0 - 2); rz0 = Math.max(0, rz0 - 2); rx1 = Math.min(W, rx1 + 2); rz1 = Math.min(D, rz1 + 2);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fieldFBO[y]);
      gl.scissor(rx0, rz0, rx1 - rx0, rz1 - rz0);
      gl.uniform1i(FU.uLayer, y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ZERO);
    return true;
  }

  // Sweep sunlight down from the top slice, each slice reading the one above. A slice is drawn to a 2D target the next slice can read, then drawn into
  // the volume. copyTexSubImage3D would be simpler but costs 15 ms here, and D3D cannot bind a 3D slice and a 2D texture as targets together.
  function updateLight() {
    var a = lightScratch[0], layers = a.layers;
    gl.disable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, lightScratch[(layers & 1) ^ 0].fbo); gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.clearColor(0, 0, 0, 1);
    gl.viewport(0, 0, a.w, a.h);
    gl.useProgram(lightProg);
    gl.uniform1i(LU.uField, 6); gl.uniform1i(LU.uColor, 0); gl.uniform1i(LU.uPrev, 12);
    gl.uniform3f(LU.uDim, W, H, D);
    var rise = LIGHT_SCALE / 0.7;
    gl.uniform2f(LU.uOff, -0.62 * rise / W, 0.34 * rise / D);
    gl.uniform2f(LU.uPx, 1 / a.w, 1 / a.h);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_3D, texField);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, texColor);
    gl.activeTexture(gl.TEXTURE12);
    for (var l = layers - 1; l >= 0; l--) {
      var out = lightScratch[l & 1];
      gl.useProgram(lightProg);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
      gl.bindTexture(gl.TEXTURE_2D, lightScratch[(l & 1) ^ 1].tex);
      gl.uniform1f(LU.uY, (l + 0.5) * LIGHT_SCALE);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(sliceProg);
      gl.uniform1i(sliceT, 12);
      gl.bindFramebuffer(gl.FRAMEBUFFER, lightFBO[l]);
      gl.bindTexture(gl.TEXTURE_2D, out.tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function updateLum() {
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(lumProg);
    gl.uniform1i(RU.uCoarse, 2); gl.uniform3i(RU.uDim, cW, cD, cH);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, texCoarse);
    gl.bindFramebuffer(gl.FRAMEBUFFER, lumFBO);
    gl.viewport(0, 0, cW, cD);
    for (var y = 0; y < cH; y++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texLum, 0, y);
      gl.uniform1i(RU.uLayer, y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  function ensureHistory(w, h) {
    if (histW === w && histH === h && hist.length) return;
    hist.forEach(function (b) { gl.deleteFramebuffer(b.fbo); gl.deleteTexture(b.tex); });
    hist = [colorTarget(w, h), colorTarget(w, h)];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    histW = w; histH = h; histValid = false;
  }
  function halton(i, b) { var f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = (i / b) | 0; } return r; }

  function frameRealistic(time, w, h, uploaded) {
    var dt = Math.max(0.001, Math.min(0.1, time - lastFrameTime)); lastFrameTime = time;
    // Ripples and flames follow simulated time, so Pause holds them still.
    if (Sim.tickN !== lastTick) { simClock += dt; lastTick = Sim.tickN; }
    if (uploaded || lumDirty) { updateLum(); lumDirty = false; }
    // Shadows move slowly next to the surfaces, so the sweep can run on alternate frames.
    if (updateField(time, dt) && ++lightWait >= 2) { lightWait = 0; updateLight(); }
    ensureTargets(w, h); ensureHistory(w, h);

    // Each frame shifts the rays by under a pixel. The resolve turns those samples into anti-aliased edges and cleans up the volume noise.
    frameN++;
    var jx = (halton((frameN % 8) + 1, 2) - 0.5) * 2 / w, jy = (halton((frameN % 8) + 1, 3) - 0.5) * 2 / h;
    var jVP = mul([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, jx, jy, 0, 1], view.VP), jInv = invert(jVP);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
    gl.useProgram(realProg);
    gl.bindVertexArray(vao);
    [[0, texColor, MU.uColor], [5, texMat, MU.uMat], [6, texField, MU.uField], [7, texTint, MU.uTint], [8, texLight, MU.uLight], [9, texLum, MU.uLum], [11, texNoise, MU.uNoise], [13, texEmit, MU.uEmitL]].forEach(function (b) {
      gl.activeTexture(gl.TEXTURE0 + b[0]); gl.bindTexture(gl.TEXTURE_3D, b[1]); gl.uniform1i(b[2], b[0]);
    });
    gl.bindSampler(13, emitSampler);
    gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, texLUT); gl.uniform1i(MU.uLUT, 10);
    gl.uniformMatrix4fv(MU.uInvVP, false, jInv); gl.uniformMatrix4fv(MU.uVP, false, view.VP);
    gl.uniform3f(MU.uEye, view.eye[0], view.eye[1], view.eye[2]);
    gl.uniform3f(MU.uDim, W, H, D); gl.uniform3i(MU.uCDim, cW, cH, cD);
    gl.uniform1f(MU.uTime, simClock); gl.uniform1f(MU.uBlock, BLOCK); gl.uniform1i(MU.uFrame, frameN); gl.uniform1i(MU.uFlat, R.viewMode === "normal" ? 0 : 1);
    if (R.brush) { gl.uniform3f(MU.uBrush, R.brush.x, R.brush.y, R.brush.z); gl.uniform1f(MU.uBrushR, R.brush.r); } else gl.uniform1f(MU.uBrushR, 0);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.ALWAYS);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.DEPTH_TEST);

    var cur = hist[histI], next = hist[1 - histI];
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.useProgram(taaProg);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, sceneTex); gl.uniform1i(TU.t, 3);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, cur.tex); gl.uniform1i(TU.h, 4);
    gl.uniformMatrix4fv(TU.uPrevVP, false, prevVP || view.VP); gl.uniformMatrix4fv(TU.uInvVP, false, view.invVP);
    gl.uniform3f(TU.uEye, view.eye[0], view.eye[1], view.eye[2]);
    gl.uniform1f(TU.uBlend, histValid ? TAA_BLEND : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, null);
    histI = 1 - histI; histValid = true; prevVP = view.VP;

    // Particles go on top of the resolved image, so they never smear into the history.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, next.fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sceneFBO);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
    drawParticles(w, h, true);
    gl.bindVertexArray(null);
    postProcess();
  }

  R.markAllDirty = function () { Sim.DIRTY.fill(1); };

  R.frame = function (time) {
    if (!ok) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2) * R.scale;
    var cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    var w = Math.max(2, (cssW * dpr) | 0), h = Math.max(2, (cssH * dpr) | 0);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    updateCamera(w, h);
    pollRealistic();
    if (realActive()) {
      ensureVolumes();
      var uploaded = uploadDirty(time);
      frameRealistic(time, w, h, uploaded);
      return;
    }
    uploadDirty(time);
    if (hdr) { ensureTargets(w, h); gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO); }
    gl.viewport(0, 0, w, h);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, texColor);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, texEmit);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, texCoarse);
    gl.uniform1i(U.uColor, 0); gl.uniform1i(U.uEmit, 1); gl.uniform1i(U.uCoarse, 2);
    gl.uniformMatrix4fv(U.uInvVP, false, view.invVP); gl.uniformMatrix4fv(U.uVP, false, view.VP);
    gl.uniform3f(U.uEye, view.eye[0], view.eye[1], view.eye[2]);
    gl.uniform3f(U.uDim, W, H, D);
    gl.uniform1f(U.uTime, time); gl.uniform1f(U.uBlock, BLOCK); gl.uniform1i(U.uDirect, hdr ? 0 : 1);
    if (R.brush) { gl.uniform3f(U.uBrush, R.brush.x, R.brush.y, R.brush.z); gl.uniform1f(U.uBrushR, R.brush.r); } else gl.uniform1f(U.uBrushR, 0);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.ALWAYS);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthFunc(gl.LESS);
    drawParticles(w, h);
    gl.bindVertexArray(null);
    if (hdr) postProcess();
  };

  return R;
})();
