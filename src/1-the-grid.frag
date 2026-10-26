// Light Grid: The Grid. The camera glides over a glossy grid floor behind two
// light-cycles weaving between lanes, each laying a wall of light that glows on
// and reflects in the floor. Storm clouds with the odd flash, glowing ridges,
// a far-off beam of light.
// still: 26
// detail: -1.2 -.5 .75 .16     both cycles and their whole walls, and the floor between (one
//                              patch, so the packets' glow on the floor never meets a patch edge)
// detail: .57 .32 .66 .5       the far beam

const vec3 CYAN = vec3(.02, .78, 1.);
const vec3 ORANGE = vec3(1., .32, .03);
const vec3 GRID = vec3(.16, .42, .62);     // floor lines: cooler and dimmer than the cycles
const float SPEED = 5.;        // camera and cycles, grid units per second along z
const float LOOP_Z = 36.;      // z each cycle's lane pattern advances per loop
const float WALL_H = .8;
const float TRAIL = 75.;

// Each cycle follows a six-leg pattern of runs (along z) and jogs (along x);
// every loop picks a random side for its jogs so the weave never repeats.
// Every leg is a whole number of grid squares (4 units), so the cycles ride
// on the grid lines and turn at their crossings.
const vec2 LEG[12] = vec2[12](
  vec2(0, 12), vec2(4, 0), vec2(0, 8), vec2(-8, 0), vec2(0, 16), vec2(4, 0),
  vec2(0, 8), vec2(-4, 0), vec2(0, 16), vec2(8, 0), vec2(0, 12), vec2(-4, 0));
const float LOOP_LEN[2] = float[2](52., 52.);
// Each cycle's jogs keep it within 4 of its lane, so these lanes (x 0..8 and
// -12..-4) never meet: neither rides into the other's wall.
const float LANE[2] = float[2](4., -8.);
const float AHEAD[2] = float[2](17., 25.);

vec2 legVec(int c, float loopN, int j) {
  vec2 v = LEG[c * 6 + j];
  float flip = hash11(loopN * 7.13 + float(c) * 3.1) < .5 ? -1. : 1.;
  return vec2(v.x * flip, v.y);
}

// Where cycle c is after travelling s along its path; also the leg it's on.
void pathAt(int c, float s, out vec2 pos, out vec2 dir, out float loopN, out int leg, out float into) {
  loopN = floor(s / LOOP_LEN[c]);
  float r = s - loopN * LOOP_LEN[c];
  pos = vec2(LANE[c], loopN * LOOP_Z);
  for (int j = 0; j < 6; j++) {
    vec2 v = legVec(c, loopN, j);
    float l = abs(v.x) + abs(v.y);
    if (r < l || j == 5) { leg = j; into = r; dir = v / l; pos += dir * r; return; }
    pos += v; r -= l;
  }
}

float camZ() { return SPEED * ST; }
float cycleS(int c) { return (camZ() + AHEAD[c]) * LOOP_LEN[c] / LOOP_Z; }

// ---- light walls ----
// The trail behind cycle c as up to 8 straight pieces, newest first.
// box = the pieces' bounds on the floor (x0, z0, x1, z1), so rays and floor
// points far from the whole trail can skip it.
struct Trail { vec2 a[8]; vec2 b[8]; float age[8]; int n; vec4 box; };

Trail trailOf(int c) {
  Trail t; t.n = 0;
  vec2 pos, dir; float loopN, into; int leg;
  pathAt(c, cycleS(c) - .95, pos, dir, loopN, leg, into);  // walls start at the back wheel
  float left = TRAIL, age = 0.;
  vec2 end = pos;
  t.box = pos.xyxy;
  for (int k = 0; k < 8; k++) {
    float take = min(into, left);
    vec2 start = end - dir * take;
    t.a[k] = start; t.b[k] = end; t.age[k] = age; t.n = k + 1;
    t.box = vec4(min(t.box.xy, start), max(t.box.zw, start));
    left -= take; age += take;
    if (left <= 0.) break;
    // step back to the end of the previous leg
    leg -= 1;
    if (leg < 0) { leg = 5; loopN -= 1.; }
    vec2 v = legVec(c, loopN, leg);
    float l = abs(v.x) + abs(v.y);
    dir = v / l; into = l; end = start;
  }
  return t;
}

// Packets of light running back along a wall from its bike (age is the
// distance back from the bike); stronger in Details (Lite), where the bikes
// hold still.
float packet(float age) {
  float spacing = mix(22., 13., detail);
  // they leave the bike and run back along its wall (age grows with time);
  // slower in Lite
  float x = fract((age - time * mix(16., 4.5, detail)) / spacing) - .5;
  return exp(-x * x * mix(160., 70., detail));
}

// Does the ray, between 0 and maxT, pass through the trail's box grown by m
// (and spanning heights y0..y1)?
bool nearTrail(vec3 ro, vec3 rd, float maxT, Trail tr, float m, float y0, float y1) {
  vec3 lo = vec3(tr.box.x - m, y0, tr.box.y - m), hi = vec3(tr.box.z + m, y1, tr.box.w + m);
  vec3 inv = 1. / mix(rd, vec3(1e-6), lessThan(abs(rd), vec3(1e-6)));
  vec3 t0 = (lo - ro) * inv, t1 = (hi - ro) * inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  float a = max(max(tn.x, tn.y), max(tn.z, 0.)), b = min(min(tf.x, tf.y), min(tf.z, maxT));
  return a <= b;
}

// Walls hit by a ray (nearer than maxT): emission added, transmittance kept.
void walls(vec3 ro, vec3 rd, float maxT, Trail tr, vec3 color, inout vec3 emit, inout float trans, inout float nearest) {
  if (!nearTrail(ro, rd, maxT, tr, .05, -.05, WALL_H + .05)) return;   // misses every piece
  for (int k = 0; k < 8; k++) {
    if (k >= tr.n) break;
    vec2 a = tr.a[k], b = tr.b[k], e = b - a;
    float len = length(e);
    if (len < 1e-3) continue;
    vec2 n = vec2(-e.y, e.x) / len;
    float dn = dot(rd.xz, n);
    if (abs(dn) < 1e-4) continue;
    float t = dot(a - ro.xz, n) / dn;
    if (t <= 0. || t > maxT) continue;
    vec3 p = ro + rd * t;
    float u = dot(p.xz - a, e) / (len * len);
    if (u < 0. || u > 1. || p.y < 0. || p.y > WALL_H) continue;
    float age = tr.age[k] + (1. - u) * len;
    float fade = exp(-age / 38.) * smoothstep(TRAIL, TRAIL - 12., age);
    float h = p.y / WALL_H;
    float glow = .1 + .14 * h * h + 3.2 * smoothstep(.93, 1., h) + .35 * smoothstep(.05, 0., h);
    // energy running along the wall; in Details (Lite) a slow, calm glow
    glow *= .85 + .15 * sin(age * mix(2.2, .35, detail) - time * mix(9., 1.6, detail));
    float pk = packet(age);
    glow += pk * (.6 + 3.4 * detail) * (.5 + h * h * 2.);
    float pk2 = packet(age);
    vec3 c = mix(color, vec3(1), .45 * smoothstep(.95, 1., h) + .35 * pk2 * detail);  // white-hot top edge, and packet cores in Lite
    emit += trans * c * glow * fade * 1.3;
    trans *= 1. - .2 * fade;
    nearest = min(nearest, t);
  }
}

// Soft halo around the walls' top edges (cheap stand-in for bloom).
float edgeHalo(vec3 ro, vec3 rd, float maxT, Trail tr) {
  float g = 0.;
  // the halo is below 1e-10 more than 2.5 from the edges
  if (!nearTrail(ro, rd, maxT, tr, 2.5, WALL_H - 2.5, WALL_H + 2.5)) return g;
  for (int k = 0; k < 8; k++) {
    if (k >= tr.n) break;
    vec3 a = vec3(tr.a[k].x, WALL_H, tr.a[k].y), b = vec3(tr.b[k].x, WALL_H, tr.b[k].y);
    // closest approach between the ray and the edge segment
    vec3 e = b - a, w = ro - a;
    float ee = dot(e, e), ed = dot(e, rd), ew = dot(e, w), dw = dot(rd, w);
    float den = ee - ed * ed;
    float u = den > 1e-5 ? clamp((ew - ed * dw) / den, 0., 1.) : 0.;
    float t = max(dot(a + e * u - ro, rd), 0.);
    if (t > maxT) continue;
    float d = length(ro + rd * t - (a + e * u));
    float age = tr.age[k] + (1. - u) * sqrt(ee);
    g += exp(-d * 9.) * .5 * exp(-age / 30.) / (1. + t * .05);
  }
  return g;
}

// ---- light-cycles (signed distance field, marched only near each cycle) ----
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)) - r;
}
float sdWheel(vec3 p, float r, float w) {   // disc around the z axis
  vec2 d = vec2(length(p.xy) - r, abs(p.z) - w);
  return min(max(d.x, d.y), 0.) + length(max(d, 0.)) - .04;
}
float smin(float a, float b, float k) { float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }

// Local frame: x forward, y up, z to the side. Returns distance; id 1 = wheel.
float cycleSDF(vec3 p, out float id) {
  float wf = sdWheel(p - vec3(.78, .4, 0), .4, .11);
  float wb = sdWheel(p - vec3(-.78, .4, 0), .4, .11);
  float body = sdCapsule(p, vec3(-.72, .5, 0), vec3(.62, .58, 0), .2);
  body = smin(body, sdCapsule(p, vec3(-.55, .62, 0), vec3(.2, .78, 0), .16), .18);       // rider's back
  body = smin(body, length(p - vec3(.36, .86, 0)) - .13, .08);                         // helmet
  body = smin(body, sdCapsule(p, vec3(.1, .62, 0), vec3(.75, .5, 0), .14), .12);       // cowl
  // carve the wheel wells so the wheels read as separate
  body = max(body, -(length(p.xy - vec2(.78, .4)) - .44));
  body = max(body, -(length(p.xy - vec2(-.78, .4)) - .44));
  float w = min(wf, wb);
  id = w < body ? 1. : 0.;
  return min(w, body);
}

// Returns colour of the cycle where the ray hits it (alpha = hit).
vec4 drawCycle(vec3 ro, vec3 rd, vec2 pos, vec2 dir, vec3 color, out float hitT) {
  hitT = 1e9;
  vec3 c = vec3(pos.x, .6, pos.y);
  vec3 oc = ro - c;
  float b = dot(oc, rd), cc = dot(oc, oc) - 1.6 * 1.6, h = b * b - cc;
  if (h < 0.) return vec4(0);
  float t = max(-b - sqrt(h), 0.), tEnd = -b + sqrt(h);
  // into the cycle's frame
  vec3 fw = vec3(dir.x, 0, dir.y), side = vec3(-dir.y, 0, dir.x);
  vec3 lo = vec3(dot(ro - vec3(pos.x, 0, pos.y), fw), ro.y, dot(ro - vec3(pos.x, 0, pos.y), side));
  vec3 ld = vec3(dot(rd, fw), rd.y, dot(rd, side));
  float id;
  for (int i = 0; i < 64; i++) {
    vec3 p = lo + ld * t;
    float d = cycleSDF(p, id);
    if (d < .002 * t) {
      hitT = t;
      vec2 e = vec2(.002, 0);
      float tmp;
      vec3 n = normalize(vec3(cycleSDF(p + e.xyy, tmp) - cycleSDF(p - e.xyy, tmp),
                              cycleSDF(p + e.yxy, tmp) - cycleSDF(p - e.yxy, tmp),
                              cycleSDF(p + e.yyx, tmp) - cycleSDF(p - e.yyx, tmp)));
      float fres = pow(1. - max(dot(n, -ld), 0.), 3.);
      vec3 col = vec3(.012, .016, .022) + vec3(.05, .08, .1) * max(n.y, 0.);   // dark gloss, sky above
      col += color * fres * .9;
      if (id > .5) {
        // glowing tyre rim and hub
        vec2 wc = p.xy - vec2(p.x > 0. ? .78 : -.78, .4);
        float r = length(wc);
        float spin = .85 + .15 * sin(atan(wc.y, wc.x) * 3. - time * 14.);   // rims shimmer as they turn
        col += color * (smoothstep(.06, .0, abs(r - .37)) * 4. * spin + smoothstep(.05, .0, abs(r - .2)) * 1.5);
      } else {
        // light strip along the body, and the visor
        col += color * smoothstep(.035, .0, abs(p.y - (.47 + .06 * p.x))) * 3.5 * step(abs(p.x), .7);
        col += color * smoothstep(.05, .0, abs(length(p - vec3(.36, .86, 0)) - .13)) * step(.38, p.x) * 2.;
      }
      return vec4(col, 1);
    }
    t += d;
    if (t > tEnd) break;
  }
  return vec4(0);
}

// ---- sky ----
float beamAmt = 1.;   // the far beam: full in the sky, faint in reflections
vec3 sky(vec3 rd) {
  float e = rd.y, az = atan(rd.x, rd.z);
  vec3 col = mix(srgb(vec3(.03, .09, .13)), srgb(vec3(.004, .01, .02)), smoothstep(-.02, .45, e));
  // stars, twinkling
  vec2 sp = vec2(az * 160., e * 160.);
  vec2 cell = floor(sp);
  float star = hash21(cell);
  if (star > .985 && e > .05) {
    float tw = .6 + .4 * sin(ST * (1. + star * 4.) + star * 50.);
    col += vec3(.6, .85, 1.) * smoothstep(.25, 0., length(fract(sp) - .5)) * tw * (star - .985) * 40. * smoothstep(.05, .2, e);
  }
  // storm clouds drifting, lit from inside now and then (only in their band)
  if (e > .04 && e < .6) {
    vec2 cp = vec2(az * 3. + ST * .01, e * 9.);
    float cl = fbm(cp + vec2(fbm(cp * 1.3 + ST * .02), 0.)) ;
    float clouds = smoothstep(.38, .75, cl) * smoothstep(.04, .14, e) * smoothstep(.6, .2, e);
    float flashT = floor(ST / 7.);
    float flash = step(.55, hash11(flashT)) * exp(-fract(ST / 7.) * 7. * 3.) * (1. + sin(ST * 60.) * .3);
    vec2 fc = vec2(hash11(flashT + .3) * 1.6 - .8, .2);
    float near = exp(-length(vec2(az, e) - fc) * 7.);
    col = mix(col, srgb(vec3(.05, .11, .15)), clouds * .8);
    col += CYAN * clouds * (.015 + flash * near * .7) * cl;
  }
  // horizon glow
  col += CYAN * .12 * exp(-abs(e) * 30.) + srgb(vec3(.05, .25, .35)) * .3 * exp(-abs(e) * 8.);
  // far beam of light
  float beamAz = .38;
  float bw = abs(az - beamAz);
  float rise = smoothstep(-.01, .02, e) * exp(-max(e, 0.) * 2.5);
  col += beamAmt * vec3(.75, .95, 1.) * (exp(-bw * 1400.) * .9 + exp(-bw * 120.) * .1 + exp(-bw * 20.) * .03) * rise * (.9 + .1 * sin(time * 1.3));
  col += CYAN * .25 * exp(-length(vec2(bw * 6., e * 30.)));  // where it meets the ground
  // mountains: far range in haze, near range dark with glowing ridge lines
  // (fbm1 stays below 1, so neither range rises above .075)
  if (e < .075) {
    float m1 = .025 + .05 * fbm1(az * 5. + 11.) * smoothstep(.0, .5, abs(az - .05));
    float m2 = .012 + .055 * pow(fbm1(az * 3.2 + 2.), 1.6) * smoothstep(.1, .7, abs(az + .1));
    if (e < m1) {
      col = mix(col, srgb(vec3(.02, .07, .09)), .75);
      col += CYAN * .25 * exp(-(m1 - e) * 600.);
    }
    if (e < m2) {
      col = srgb(vec3(.006, .014, .02)) + CYAN * .03 * exp(-abs(e) * 60.);
      col += CYAN * .9 * exp(-(m2 - e) * 900.);
    }
  }
  return col;
}

// ---- floor ----
vec3 floorAt(vec3 p, float t, Trail tr0, Trail tr1, vec2 cyc0, vec2 cyc1) {
  // tiles, faintly varied, with glowing seams
  vec2 g = p.xz / 4.;
  vec2 fw = fwidth(g);
  vec2 d = abs(fract(g - .5) - .5);
  vec2 core = 1. - smoothstep(vec2(.0035), .0035 + fw * 1.2, d);
  vec2 halo = exp(-d / (.018 + fw));
  float lines = max(core.x, core.y) * (1. - smoothstep(.1, .6, max(fw.x, fw.y)));
  float glow = max(halo.x, halo.y) * .12;
  float tile = hash21(floor(g));
  vec3 col = srgb(vec3(.008, .016, .022)) * (.8 + .4 * tile);
  float far = exp(-t * .022);
  col += GRID * (lines * .8 + glow) * mix(.12, 1., far);
  // pulses running down the grid lines
  float pulse = smoothstep(.97, 1., sin(p.z * .2 - ST * 2. + floor(g.x) * 2.3)) * core.x;
  col += mix(GRID, CYAN, .6) * pulse * 1.5 * far;
  // light thrown on the floor by the walls and cycles
  for (int c = 0; c < 2; c++) {
    Trail tr = c == 0 ? tr0 : tr1;
    vec3 colr = c == 0 ? CYAN : ORANGE;
    float l = 0.;
    // (the light is below 1e-9 more than 10 from the trail)
    vec4 bx = tr.box + vec4(-10, -10, 10, 10);
    if (all(greaterThan(p.xz, bx.xy)) && all(lessThan(p.xz, bx.zw)))
    for (int k = 0; k < 8; k++) {
      if (k >= tr.n) break;
      vec2 a = tr.a[k], e = tr.b[k] - a;
      float u = clamp(dot(p.xz - a, e) / max(dot(e, e), 1e-4), 0., 1.);
      float dist = length(p.xz - a - e * u);
      float age = tr.age[k] + (1. - u) * length(e);
      l += exp(-dist * 2.2) * exp(-age / 38.) + exp(-dist * 5.) * exp(-age / 38.) * (1.4 + 2.6 * detail) * packet(age);
    }
    vec2 cp = c == 0 ? cyc0 : cyc1;
    l += exp(-length(p.xz - cp) * 1.1) * 1.5;
    col += colr * l * .55;
  }
  return col;
}

void main() {
  vec2 sp = sceneP();
  float cz = camZ();
  vec3 ro = vec3(-1.2 + .5 * sin(ST * .11), 4.6 + .12 * sin(ST * .17), cz);
  vec3 fwd = normalize(vec3(.02 * sin(ST * .07), -.2, 1.));
  vec3 rt = normalize(cross(vec3(0, 1, 0), fwd)), up = cross(fwd, rt);
  vec3 rd = normalize(fwd * 1.55 + rt * sp.x + up * sp.y);

  Trail tr0 = trailOf(0), tr1 = trailOf(1);
  vec2 p0, d0, p1, d1; float ln, into; int leg;
  pathAt(0, cycleS(0), p0, d0, ln, leg, into);
  pathAt(1, cycleS(1), p1, d1, ln, leg, into);

  float tFloor = rd.y < 0. ? -ro.y / rd.y : 1e9;
  float tc0, tc1;
  vec4 c0 = drawCycle(ro, rd, p0, d0, CYAN, tc0);
  vec4 c1 = drawCycle(ro, rd, p1, d1, ORANGE, tc1);

  vec3 col;
  float tHit = min(tFloor, min(tc0, tc1));
  if (tc0 < tFloor && tc0 <= tc1) col = c0.rgb;
  else if (tc1 < tFloor) col = c1.rgb;
  else if (tFloor < 1e8) {
    vec3 p = ro + rd * tFloor;
    col = floorAt(p, tFloor, tr0, tr1, p0, p1);
    // glossy reflection of sky, walls and cycles
    vec3 rr = reflect(rd, vec3(0, 1, 0));
    float fres = .08 + .6 * pow(1. - abs(rd.y), 5.);
    float rt0, rt1;
    vec4 r0 = drawCycle(p, rr, p0, d0, CYAN, rt0);
    vec4 r1 = drawCycle(p, rr, p1, d1, ORANGE, rt1);
    vec3 rcol;
    if (r0.a > 0.) rcol = r0.rgb; else if (r1.a > 0.) rcol = r1.rgb;
    else {   // sky and walls only where no cycle covers them
      beamAmt = .25;
      rcol = sky(rr) * .6;
      beamAmt = 1.;
      vec3 emit = vec3(0); float trans = 1., nr = 1e9;
      walls(p + rr * .001, rr, 200., tr0, CYAN, emit, trans, nr);
      walls(p + rr * .001, rr, 200., tr1, ORANGE, emit, trans, nr);
      rcol = rcol * trans + emit;
    }
    // blur the reflection a little with distance by fading it
    col += rcol * fres * 1.4;
    // fog towards the horizon
    float fog = 1. - exp(-tFloor * .018);
    vec3 haze = srgb(vec3(.03, .09, .13)) + CYAN * .1 + srgb(vec3(.05, .25, .35)) * .3;
    col = mix(col, haze * .9, fog);
  } else col = sky(rd);

  // walls in front of whatever was hit
  vec3 emit = vec3(0); float trans = 1., nr = 1e9;
  walls(ro, rd, tHit, tr0, CYAN, emit, trans, nr);
  walls(ro, rd, tHit, tr1, ORANGE, emit, trans, nr);
  float fogW = exp(-min(nr, 400.) * .012);
  col = col * mix(1., trans, fogW) + emit * fogW;
  col += CYAN * edgeHalo(ro, rd, tHit, tr0) + ORANGE * edgeHalo(ro, rd, tHit, tr1);
  // halos round the cycles
  for (int c = 0; c < 2; c++) {
    vec2 cp = c == 0 ? p0 : p1;
    vec3 q = vec3(cp.x, .5, cp.y) - ro;
    float along = dot(q, rd);
    if (along > 0.) col += (c == 0 ? CYAN : ORANGE) * exp(-length(q - rd * along) * 2.2) * .35;
  }
  fragColor = finish(col * 1.1);
}
