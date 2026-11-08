# Builds every piece of lab equipment as a mesh in Blender and writes it out for the game.
#
#   "F:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/blender/labware.py
#   (add -- --preview to also render tools/blender/labware_preview.png)
#
# Outputs:
#   js/labware.data.js          the meshes the game draws, as compact base64 arrays (loaded with a <script> tag, so file:// works)
#   tools/blender/labware.glb   the same models with materials, to open in Blender or any glTF viewer
#
# Everything is modelled in game units, where one unit is one simulation cell, with Y up. Each model's origin and size match the cells
# the simulation gives that object, so a glass wall drawn here sits where the real WALL cells are. Blender is Z up; G() converts.
# Containers have their spout on +X (the pour direction) and their graduations on +Z, the side that faces the camera when one is set out.
import bpy, bmesh, math, os, sys, base64, struct, json
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
TAU = math.pi * 2

def G(p):  # game (x, y up, z) to Blender (x, y, z up)
    return (p[0], -p[2], p[1])

# ---------------------------------------------------------------- geometry in game coordinates
class Geo:
    def __init__(self):
        self.v = []; self.f = []
    def add(self, other):
        o = len(self.v); self.v += other.v; self.f += [[i + o for i in face] for face in other.f]; return self
    def xform(self, fn):
        self.v = [fn(p) for p in self.v]; return self
    def move(self, dx, dy, dz):
        return self.xform(lambda p: (p[0] + dx, p[1] + dy, p[2] + dz))
    def scale(self, sx, sy, sz):
        return self.xform(lambda p: (p[0] * sx, p[1] * sy, p[2] * sz))
    def rot_z(self, a):  # about the game Z axis, +X toward +Y
        c, s = math.cos(a), math.sin(a)
        return self.xform(lambda p: (p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]))
    def rot_x(self, a):  # +Y toward +Z
        c, s = math.cos(a), math.sin(a)
        return self.xform(lambda p: (p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c))
    def rot_y(self, a):  # +Z toward +X
        c, s = math.cos(a), math.sin(a)
        return self.xform(lambda p: (p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c))

def lathe(profile, seg=48, closed=False, deform=None):
    """Spin a profile of (r, y) points around the Y axis. Points with r = 0 become poles. With closed, the last point joins the first,
    for rings that never touch the axis. deform(x, y, z, theta) may move each vertex."""
    g = Geo(); rings = []
    for (r, y) in profile:
        if r <= 1e-6:
            rings.append([len(g.v)]); g.v.append((0.0, y, 0.0))
        else:
            ring = []
            for j in range(seg):
                t = TAU * j / seg; x, z = r * math.cos(t), r * math.sin(t)
                if deform: x, y2, z = deform(x, y, z, t)
                else: y2 = y
                ring.append(len(g.v)); g.v.append((x, y2, z))
            rings.append(ring)
    pairs = list(zip(rings, rings[1:]))
    if closed: pairs.append((rings[-1], rings[0]))
    for a, b in pairs:
        if len(a) == 1 and len(b) == 1: continue
        if len(a) == 1:
            for j in range(seg): g.f.append([a[0], b[(j + 1) % seg], b[j]])
        elif len(b) == 1:
            for j in range(seg): g.f.append([a[j], a[(j + 1) % seg], b[0]])
        else:
            for j in range(seg): g.f.append([a[j], a[(j + 1) % seg], b[(j + 1) % seg], b[j]])
    return g

def box(cx, cy, cz, sx, sy, sz):
    g = Geo(); hx, hy, hz = sx / 2, sy / 2, sz / 2
    for i in range(8):
        g.v.append((cx + (hx if i & 1 else -hx), cy + (hy if i & 2 else -hy), cz + (hz if i & 4 else -hz)))
    g.f = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
    return g

def arc_patch(r0, r1, y0, y1, t0, t1, n=6):
    """A thin curved tile on a cylinder, from radius r0 to r1, height y0 to y1 and angle t0 to t1: labels, prints and ticks."""
    g = Geo(); idx = {}
    for i in range(n + 1):
        t = t0 + (t1 - t0) * i / n
        for k, r in enumerate((r0, r1)):
            for m, y in enumerate((y0, y1)):
                idx[(i, k, m)] = len(g.v); g.v.append((r * math.cos(t), y, r * math.sin(t)))
    for i in range(n):
        q = lambda a, b, c, d: g.f.append([idx[a], idx[b], idx[c], idx[d]])
        q((i, 1, 0), (i + 1, 1, 0), (i + 1, 1, 1), (i, 1, 1))  # outside
        q((i, 0, 0), (i, 0, 1), (i + 1, 0, 1), (i + 1, 0, 0))  # inside
        q((i, 0, 1), (i, 1, 1), (i + 1, 1, 1), (i + 1, 0, 1))  # top
        q((i, 0, 0), (i + 1, 0, 0), (i + 1, 1, 0), (i, 1, 0))  # bottom
    q((0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1)); q((n, 0, 0), (n, 0, 1), (n, 1, 1), (n, 1, 0))
    return g

def sweep(points, radius, seg=12, caps=True, smooth=0):
    """A round tube along a polyline. smooth rounds each corner by subdividing it (Chaikin), for bent rods and hoses."""
    pts = [Vector(p) for p in points]
    for _ in range(smooth):
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]): out += [a.lerp(b, 0.25), a.lerp(b, 0.75)]
        out.append(pts[-1]); pts = out
    g = Geo(); rings = []
    t_prev = (pts[1] - pts[0]).normalized()
    ref = Vector((0, 1, 0)) if abs(t_prev.y) < 0.9 else Vector((1, 0, 0))
    nrm = t_prev.cross(ref).normalized()
    for i, p in enumerate(pts):
        if i == 0: t = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1: t = (pts[-1] - pts[-2]).normalized()
        else: t = ((pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()).normalized()
        # parallel transport keeps the ring from twisting
        nrm = (nrm - t * nrm.dot(t)).normalized(); bin_ = t.cross(nrm)
        ring = []
        for j in range(seg):
            a = TAU * j / seg; q = p + (nrm * math.cos(a) + bin_ * math.sin(a)) * radius
            ring.append(len(g.v)); g.v.append(tuple(q))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for j in range(seg): g.f.append([a[j], b[j], b[(j + 1) % seg], a[(j + 1) % seg]])
    if caps:
        g.f.append(list(reversed(rings[0]))); g.f.append(list(rings[-1]))
    return g

def sphere(r, seg=16, rings=10):
    prof = [(r * math.sin(math.pi * k / rings), -r * math.cos(math.pi * k / rings)) for k in range(rings + 1)]
    prof[0] = (0, -r); prof[-1] = (0, r)
    return lathe(prof, seg)

def cyl(r, y0, y1, seg=24, bev=0.0):
    if bev <= 0: return lathe([(0, y0), (r, y0), (r, y1), (0, y1)], seg)
    b = bev
    return lathe([(0, y0), (r - b, y0), (r - b * 0.3, y0 + b * 0.3), (r, y0 + b), (r, y1 - b), (r - b * 0.3, y1 - b * 0.3), (r - b, y1), (0, y1)], seg)

def ellipse_pts(cx, cy, ax, ay, a0, a1, n):
    return [(cx + ax * math.cos(a0 + (a1 - a0) * k / n), cy + ay * math.sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)]

# ---------------------------------------------------------------- Blender objects
MATS = {  # name: (base colour, metallic, roughness, transmission, alpha, emission)
    "glass": ((0.92, 0.96, 1.0), 0, 0.03, 1.0, 1.0, None),
    "enamel": ((0.93, 0.93, 0.9), 0, 0.5, 0, 1, None),
    "ink": ((0.06, 0.06, 0.07), 0, 0.6, 0, 1, None),
    "porcelain": ((0.93, 0.92, 0.88), 0, 0.22, 0, 1, None),
    "steel": ((0.74, 0.75, 0.77), 1, 0.3, 0, 1, None),
    "chrome": ((0.86, 0.87, 0.89), 1, 0.1, 0, 1, None),
    "alu": ((0.80, 0.81, 0.83), 1, 0.42, 0, 1, None),
    "brass": ((0.86, 0.66, 0.36), 1, 0.3, 0, 1, None),
    "cast": ((0.13, 0.19, 0.29), 0, 0.55, 0, 1, None),
    "body_white": ((0.86, 0.87, 0.88), 0, 0.45, 0, 1, None),
    "body_grey": ((0.55, 0.58, 0.62), 0, 0.45, 0, 1, None),
    "body_blue": ((0.30, 0.42, 0.58), 0, 0.45, 0, 1, None),
    "case": ((0.17, 0.19, 0.23), 0, 0.5, 0, 1, None),
    "panel": ((0.08, 0.09, 0.1), 0, 0.35, 0, 1, None),
    "knob": ((0.04, 0.04, 0.05), 0, 0.35, 0, 1, None),
    "ceramic": ((0.03, 0.03, 0.035), 0, 0.07, 0, 1, None),
    "ceramic_white": ((0.92, 0.92, 0.9), 0, 0.18, 0, 1, None),
    "zone": ((0.55, 0.55, 0.56), 0, 0.3, 0, 1, None),
    "rubber": ((0.55, 0.24, 0.15), 0, 0.7, 0, 1, None),
    "rubber_red": ((0.62, 0.1, 0.08), 0, 0.55, 0, 1, None),
    "rubber_black": ((0.05, 0.05, 0.05), 0, 0.7, 0, 1, None),
    "latex": ((0.74, 0.46, 0.2), 0, 0.45, 0, 1, None),
    "paper": ((0.95, 0.94, 0.9), 0, 0.9, 0, 1, None),
    "label": ((0.96, 0.95, 0.92), 0, 0.8, 0, 1, None),
    "band": ((0.75, 0.1, 0.08), 0, 0.6, 0, 1, None),
    "lcd": ((0.06, 0.12, 0.08), 0, 0.2, 0, 1, (0.1, 0.5, 0.25)),
    "lamp": ((0.3, 0.05, 0.05), 0, 0.2, 0, 1, (1.0, 0.1, 0.05)),
    "alcohol": ((0.85, 0.06, 0.05), 0, 0.2, 0, 1, None),
    "liquid": ((0.4, 0.6, 0.9), 0, 0.05, 0.8, 1, None),
    "coolant": ((0.55, 0.78, 0.98), 0, 0.05, 0.9, 1, None),
    "gauze": ((0.25, 0.25, 0.27), 1, 0.6, 0, 1, None),
    "fiber": ((0.82, 0.80, 0.76), 0, 0.95, 0, 1, None),
    "graphite": ((0.11, 0.11, 0.12), 0.3, 0.5, 0, 1, None),
    "ptfe": ((0.95, 0.95, 0.94), 0, 0.4, 0, 1, None),
    "geiger": ((0.95, 0.66, 0.06), 0, 0.4, 0, 1, None),
    "red_plastic": ((0.75, 0.07, 0.05), 0, 0.35, 0, 1, None),
    "mica": ((0.22, 0.16, 0.1), 0, 0.15, 0, 1, None),
    "motor": ((0.12, 0.3, 0.55), 0, 0.4, 0, 1, None),
    "oil": ((0.85, 0.6, 0.15), 0, 0.05, 0.5, 1, None),
    "cork": ((0.62, 0.45, 0.28), 0, 0.9, 0, 1, None),
}
_mat_cache = {}
def material(name):
    if name in _mat_cache: return _mat_cache[name]
    col, metal, rough, trans, alpha, emit = MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Metallic"].default_value = metal; b.inputs["Roughness"].default_value = rough
    if "Transmission Weight" in b.inputs: b.inputs["Transmission Weight"].default_value = trans
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = 3.0
    _mat_cache[name] = m; return m

PARTS = []  # (model, part, material, object)
def part(model, name, mat, geo, bevel=0.0, bevel_seg=3, sharp=32):
    me = bpy.data.meshes.new(model + "." + name)
    bm = bmesh.new()
    vs = [bm.verts.new(G(p)) for p in geo.v]
    for face in geo.f:
        try: bm.faces.new([vs[i] for i in face])
        except ValueError: pass  # a degenerate or repeated face
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(model + "." + name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(material(mat))
    if bevel > 0:
        mod = ob.modifiers.new("bevel", "BEVEL"); mod.width = bevel; mod.segments = bevel_seg; mod.limit_method = "ANGLE"; mod.angle_limit = math.radians(40)
        dg = bpy.context.evaluated_depsgraph_get(); new = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        ob.modifiers.remove(mod); ob.data = new; new.materials.clear(); new.materials.append(material(mat)); me = new
    me.shade_smooth(); me.set_sharp_from_angle(angle=math.radians(sharp))
    ob["model"] = model; ob["part"] = name; ob["mat"] = mat
    PARTS.append((model, name, mat, ob))
    return ob

# ---------------------------------------------------------------- containers
# Container sizes from js/lab.js CONTAINERS. A set-down container's inside cells reach r + 0.5 from its axis and its floor is the cell layer
# from 0 to 1, so the inner glass sits just outside them, at r + 0.55, and the inner floor at 1. The rim is at h + 1.
def spout(top, amount=0.75):
    def d(x, y, z, t):
        s = max(0.0, math.cos(t)) ** 10; k = max(0.0, min(1.0, (y - (top - 1.6)) / 1.6)) ** 2
        r = math.hypot(x, z); f = (r + amount * s * k) / r if r > 0 else 1
        return x * f, y - 0.12 * s * k, z * f
    return d

def graduations(model, r, h, ro):
    g = Geo(); front = math.pi / 2
    for k, y in enumerate(range(2, h + 1)):
        major = (y % 2 == 0); w = (0.9 if major else 0.45) / ro
        g.add(arc_patch(ro + 0.004, ro + 0.03, y + 0.5, y + 0.58, front - 0.45 / ro, front - 0.45 / ro + w, 3))
    # the white marking patch on the far side
    g.add(arc_patch(ro + 0.004, ro + 0.03, h * 0.45, h * 0.45 + 1.4, -math.pi / 2 - 0.5, -math.pi / 2 + 0.5, 8))
    part(model, "print", "enamel", g)

def beaker(model, r, h, seg=48, grads=True):
    ri, ro, top = r + 0.55, r + 0.95, h + 1
    prof = [(0, 0), (ro - 0.3, 0), (ro - 0.09, 0.04), (ro - 0.02, 0.15), (ro, 0.32), (ro, top - 0.35), (ro + 0.06, top - 0.2), (ro + 0.13, top - 0.06),
            (ro + 0.1, top + 0.03), (ri + 0.12, top + 0.04), (ri, top - 0.06), (ri, 1.3), (ri - 0.06, 1.12), (ri - 0.22, 1.03), (ri - 0.45, 1.0), (0, 1.0)]
    part(model, "body", "glass", lathe(prof, seg, deform=spout(top)))
    if grads: graduations(model, r, h, ro)

def test_tube(model, r, h):
    ri, ro, top = r + 0.55, r + 0.85, h + 1
    prof = [(0, 0), (1.2, 0.04), (1.95, 0.2), (2.45, 0.45), (2.72, 0.8), (ro, 1.15), (ro, top - 0.3), (ro + 0.1, top - 0.12), (ro + 0.12, top),
            (ri + 0.08, top + 0.03), (ri, top - 0.08), (ri, 1.55), (ri - 0.2, 1.18), (ri - 0.75, 1.03), (0, 1.0)]
    part(model, "body", "glass", lathe(prof, 40))

def crucible(model, r, h):
    top = h + 1
    prof = [(0, 0), (r - 0.1, 0), (r + 0.6, 0.12), (r + 0.9, 0.45), (r + 1.0, 1.0), (r + 1.45, top - 0.15), (r + 1.42, top), (r + 0.98, top), (r + 0.95, top - 0.1),
            (r + 0.55, 1.4), (r + 0.35, 1.08), (r - 0.2, 1.0), (0, 1.0)]
    part(model, "body", "porcelain", lathe(prof, 48))

def dish(model, r, h):
    ri, top = r + 0.55, h + 1
    prof = [(0, 0), (r - 1.4, 0), (r - 1.3, 0.05), (r - 1.25, 0.35), (r - 0.4, 0.5), (r + 0.5, 0.85), (r + 0.95, 1.4), (r + 1.1, 2.4), (r + 1.2, top - 0.1),
            (r + 1.15, top + 0.02), (ri + 0.15, top + 0.04), (ri, top - 0.08), (ri, 1.7), (ri - 0.2, 1.2), (ri - 0.75, 1.02), (0, 1.0)]
    part(model, "body", "porcelain", lathe(prof, 56, deform=spout(top, 0.9)))

def bottle(model, r, h):
    ri, top = r + 0.55, h + 1
    rb, rn = r + 1.3, r + 1.0  # body and neck
    prof = [(0, 0), (rb - 0.35, 0), (rb - 0.08, 0.06), (rb, 0.4), (rb, top - 2.0), (rb - 0.08, top - 1.55), (rn + 0.05, top - 1.15), (rn, top - 0.95),
            (rn, top - 0.55), (rn + 0.2, top - 0.5), (rn + 0.22, top - 0.08), (rn + 0.15, top + 0.02), (ri + 0.1, top + 0.03), (ri, top - 0.1),
            (ri, 1.3), (ri - 0.08, 1.1), (ri - 0.3, 1.0), (0, 1.0)]
    part(model, "body", "glass", lathe(prof, 48))
    f = math.pi / 2
    part(model, "label", "label", arc_patch(rb + 0.005, rb + 0.03, 2.4, 7.6, f - 1.05, f + 1.05, 16))
    part(model, "band", "band", arc_patch(rb + 0.031, rb + 0.045, 6.4, 7.1, f - 1.05, f + 1.05, 16))
    ink = Geo()
    for k, (y, w) in enumerate(((5.4, 0.8), (4.7, 0.65), (4.1, 0.5), (3.3, 0.35))):
        ink.add(arc_patch(rb + 0.031, rb + 0.04, y, y + 0.22, f - w, f + w * (0.6 if k else 1), 8))
    part(model, "ink", "ink", ink)

beaker("beaker", 4, 12)
test_tube("tube", 2, 14)
beaker("flask", 7, 14, seg=64)
crucible("crucible", 4, 5)
dish("dish", 6, 3)
bottle("bottle", 3, 10)

# A rubber stopper, for a mouth of inner radius 1; the game scales it across to the container. y is from the rim, unscaled.
part("stopper", "plug", "rubber", lathe([(0, -0.9), (0.8, -0.9), (0.84, -0.84), (1.0, 0.72), (1.03, 0.78), (1.02, 0.86), (0.96, 0.9), (0, 0.9)], 40))

# ---------------------------------------------------------------- bench stations
# Plates are square slabs, footprint +-(half + 0.5) and h cells tall, origin at the middle of the base. The hot plate is modelled for half 6, h 2.
def feet(model, s):
    g = Geo()
    for sx in (-1, 1):
        for sz in (-1, 1): g.add(cyl(0.45, 0, 0.16, 16).move(sx * (s - 0.9), 0, sz * (s - 0.9)))
    part(model, "feet", "rubber_black", g)

def knob(r=0.42, depth=0.7):
    g = lathe([(0, 0), (r, 0), (r, depth * 0.7), (r * 0.9, depth), (0, depth)], 24, deform=lambda x, y, z, t: (x * (1 + 0.05 * math.cos(18 * t) * (y < depth * 0.75)), y, z * (1 + 0.05 * math.cos(18 * t) * (y < depth * 0.75))))
    return g.rot_x(math.pi / 2)  # point along +Z

def station(model, s, body_mat, top_mat, knobs, led=True, h=2.0):
    feet(model, s)
    part(model, "body", body_mat, box(0, 0.16 + (h - 0.71) / 2, 0, 2 * s, h - 0.71, 2 * s), bevel=0.32)
    part(model, "top", top_mat, box(0, h - 0.275, 0, 2 * s - 0.4, 0.55, 2 * s - 0.4), bevel=0.1)
    part(model, "panel", "panel", box(0, 0.82, s + 0.01, 2 * s - 3.0, 0.82, 0.06), bevel=0.02)
    kg = Geo()
    for kx in knobs: kg.add(knob().move(kx, 0.82, s + 0.03))
    part(model, "knobs", "knob", kg)
    if led: part(model, "led", "lamp", sphere(0.13, 12, 8).scale(1, 1, 0.6).move(0, 0.82, s + 0.06))

station("hotplate", 6.5, "body_grey", "ceramic", (-3.0, 3.0))
part("hotplate", "zone", "ceramic", lathe([(0, 2.0), (4.6, 2.0), (4.6, 2.006), (0, 2.006)], 64))   # the heating zone, which glows
part("hotplate", "ring", "enamel", lathe([(4.6, 2.0), (4.78, 2.0), (4.78, 2.012), (4.6, 2.012)], 64, closed=True))
station("stirrer", 6.5, "body_white", "ceramic_white", (-3.0, 3.0))
part("stirrer", "zone", "zone", lathe([(1.5, 2.0), (1.62, 2.0), (1.62, 2.012), (1.5, 2.012)], 48, closed=True))
station("chiller", 6.5, "body_blue", "alu", (2.8,))
vents = Geo()
for k in range(6):
    for sx in (-1, 1): vents.add(box(sx * 6.51, 0.75, -3.5 + k * 1.4, 0.04, 0.7, 0.35))
part("chiller", "vents", "panel", vents)
grooves = Geo()
for k in range(-5, 6): grooves.add(box(k * 1.05, 2.003, 0, 0.12, 0.012, 11.8))
part("chiller", "grooves", "alu", grooves)

# Balance, half 5: a body a little lower than its 2 cells, a round steel pan on a short post whose top is the surface things stand on.
feet("balance", 5.5)
part("balance", "body", "body_white", box(0, 0.16 + 0.7, 0, 11, 1.4, 11), bevel=0.35)
part("balance", "bezel", "panel", box(0, 0.85, 5.51, 7.2, 0.82, 0.06), bevel=0.02)
part("balance", "lcd", "lcd", box(-1.1, 0.85, 5.55, 3.6, 0.5, 0.04))
part("balance", "buttons", "knob", box(1.7, 0.85, 5.56, 0.6, 0.36, 0.08).add(box(2.6, 0.85, 5.56, 0.6, 0.36, 0.08)), bevel=0.05)
part("balance", "pan", "steel", lathe([(0, 1.56), (0.9, 1.56), (0.9, 1.74), (4.2, 1.74), (4.36, 1.82), (4.42, 1.94), (4.3, 2.0), (0, 2.0)], 64))

# Gas burner, half 2 and h 4: a Bunsen burner under a tripod and wire gauze. The gauze is the flat top that a sample stands on.
part("burner", "base", "cast", lathe([(0, 0), (2.15, 0), (2.28, 0.07), (2.3, 0.28), (2.1, 0.45), (1.0, 0.58), (0.72, 0.72), (0, 0.72)], 48))
part("burner", "barrel", "chrome", lathe([(0, 0.7), (0.55, 0.7), (0.55, 3.7), (0.5, 3.78), (0.38, 3.78), (0.38, 3.0), (0, 3.0)], 32))
part("burner", "collar", "brass", lathe([(0.57, 1.0), (0.7, 1.0), (0.73, 1.05), (0.73, 1.65), (0.7, 1.7), (0.57, 1.7)], 32, closed=True))
holes = box(0.735, 1.35, 0, 0.04, 0.32, 0.3).add(box(-0.735, 1.35, 0, 0.04, 0.32, 0.3))
part("burner", "holes", "panel", holes)
inlet = lathe([(0, 0), (0.24, 0), (0.24, 1.3), (0.3, 1.4), (0.22, 1.55), (0.3, 1.7), (0.22, 1.85), (0.28, 2.0), (0.2, 2.1), (0, 2.1)], 16)
part("burner", "inlet", "brass", inlet.rot_z(math.pi / 2).move(-0.5, 0.95, 0))
part("burner", "valve", "knob", knob(0.28, 0.4).move(0, 0.95, 0.5))
legs = lathe([(2.21, 3.74), (2.39, 3.74), (2.39, 3.88), (2.21, 3.88)], 48, closed=True)
for a in (math.pi / 2, math.pi / 2 + TAU / 3, math.pi / 2 + 2 * TAU / 3):
    legs.add(sweep([(2.3 * math.cos(a), 3.8, 2.3 * math.sin(a)), (2.45 * math.cos(a), 0.02, 2.45 * math.sin(a))], 0.085, 10))
part("burner", "tripod", "steel", legs)
def square_plate(s, hole, y0, y1, n=48):
    g = Geo(); idx = []
    for j in range(n):
        t = TAU * j / n; c, sn = math.cos(t), math.sin(t); k = s / max(abs(c), abs(sn))
        quad = []
        for (r, y) in ((hole, y0), (k, y0), (k, y1), (hole, y1)):
            quad.append(len(g.v)); g.v.append((r * c, y, r * sn))
        idx.append(quad)
    for j in range(n):
        a, b = idx[j], idx[(j + 1) % n]
        for q in range(4): g.f.append([a[q], b[q], b[(q + 1) % 4], a[(q + 1) % 4]])
    return g
part("burner", "gauze", "gauze", square_plate(2.48, 0.62, 3.88, 3.97))
part("burner", "fiber", "fiber", lathe([(0.62, 3.97), (1.45, 3.97), (1.45, 4.0), (0.62, 4.0)], 40, closed=True))

cap_lo = [(0.3 * math.sin(a), -0.9 - 0.3 * math.cos(a)) for a in (0, 0.5, 1.0, 1.57)]
cap_hi = [(0.3 * math.sin(a), 0.9 + 0.3 * math.cos(a)) for a in (1.57, 1.0, 0.5, 0)]
part("stirbar", "bar", "ptfe", lathe(cap_lo + cap_hi, 16).rot_z(math.pi / 2).move(0, 0.3, 0))

# ---------------------------------------------------------------- hand tools
# Thermometer, len 12, tip at its origin. The column is clipped by the game to the temperature it reads.
part("thermometer", "glass", "glass", lathe([(0, 0.02), (0.22, 0.06), (0.38, 0.25), (0.43, 0.55), (0.38, 0.9), (0.3, 1.15), (0.3, 11.4), (0.27, 11.75), (0.15, 11.95), (0, 12.0)], 24))
part("thermometer", "bulb", "alcohol", lathe([(0, 0.13), (0.26, 0.3), (0.32, 0.55), (0.27, 0.85), (0.1, 1.08), (0, 1.1)], 16))
part("thermometer", "column", "alcohol", cyl(0.085, 1.0, 11.2, 10))
back = box(0, 6.2, -0.13, 0.36, 10.2, 0.04)
part("thermometer", "backing", "enamel", back)
ticks = Geo()
for k in range(0, 41):
    y = 1.4 + k * 0.24; w = 0.3 if k % 5 == 0 else 0.16
    ticks.add(box(-0.18 + w / 2, y, -0.105, w, 0.04, 0.012))
part("thermometer", "ticks", "ink", ticks)
part("thermometer", "cap", "steel", lathe([(0, 11.35), (0.33, 11.35), (0.33, 12.05), (0.25, 12.15), (0, 12.15)], 20).add(
    lathe([(0.16, -0.05), (0.27, -0.05), (0.27, 0.05), (0.16, 0.05)], 16, closed=True).rot_x(math.pi / 2).move(0, 12.4, 0)))

# Dropper, len 9: a glass tube with a red bulb. The liquid inside is clipped to how much it holds.
part("dropper", "glass", "glass", lathe([(0, 0), (0.1, 0), (0.13, 0.1), (0.2, 0.8), (0.34, 2.0), (0.42, 2.6), (0.42, 6.1), (0.5, 6.15), (0.52, 6.3), (0.42, 6.36), (0, 6.36)], 24))
part("dropper", "liquid", "liquid", lathe([(0, 0.05), (0.06, 0.1), (0.13, 0.8), (0.27, 2.0), (0.33, 2.6), (0.33, 6.0), (0, 6.0)], 20))
part("dropper", "bulb", "rubber_red", lathe([(0, 5.9), (0.5, 5.9), (0.56, 6.1), (0.52, 6.6), (0.7, 7.2), (0.8, 7.9), (0.75, 8.5), (0.55, 8.85), (0.3, 9.0), (0, 9.02)], 28))

# Power supply: a graphite rod modelled 14 long, and the case, origin at its base, for rods 2 either side of the middle.
part("rod", "rod", "graphite", lathe([(0, 0), (0.3, 0.03), (0.38, 0.15), (0.38, 14.0), (0, 14.0)], 16))
part("supply", "shell", "case", box(0, 1.5, 0, 6.8, 3.0, 3.2), bevel=0.25)
part("supply", "panel", "panel", box(0, 1.5, 1.61, 6.2, 2.5, 0.05), bevel=0.02)
part("supply", "lcd", "lcd", box(-1.4, 1.85, 1.65, 2.8, 1.0, 0.04))
part("supply", "knobs", "knob", knob(0.38, 0.5).move(0.9, 1.6, 1.62).add(knob(0.38, 0.5).move(2.2, 1.6, 1.62)))
part("supply", "led", "lamp", sphere(0.13, 12, 8).scale(1, 1, 0.6).move(-1.4, 0.75, 1.66))
part("supply", "handle", "knob", sweep([(-2.6, 2.9, 0), (-2.6, 3.7, 0), (-2.1, 4.15, 0), (2.1, 4.15, 0), (2.6, 3.7, 0), (2.6, 2.9, 0)], 0.15, 12, smooth=2))
part("supply", "red", "red_plastic", lathe([(0, -0.7), (0.5, -0.7), (0.58, -0.55), (0.58, 0.02), (0, 0.02)], 20).move(-2, 0, 0))
part("supply", "black", "knob", lathe([(0, -0.7), (0.5, -0.7), (0.58, -0.55), (0.58, 0.02), (0, 0.02)], 20).move(2, 0, 0))

# Funnel, len 8 with a stem of 3 and a mouth of 4: the inner glass follows Lab.funnelRadius, just outside the cells it holds.
def funnel_rin(y):
    u = y - 0.5
    return (max(0.7, (u - 3) / 5 * 4) if u >= 3 else 0.7) + 0.55
outer, inner = [], []
for k in range(0, 23):
    y = 3.5 + k * 0.25
    outer.append((funnel_rin(y) + 0.3, y)); inner.append((funnel_rin(y), y))
prof = [(0.2, 0.0), (0.42, 0.0), (0.42, 2.7), (0.55, 3.0), (0.95, 3.25)] + outer + [(funnel_rin(9.0) + 0.45, 9.05), (funnel_rin(9.0) + 0.4, 9.15), (funnel_rin(9.0), 9.12)]
prof += list(reversed(inner)) + [(0.9, 3.25), (0.4, 3.05), (0.2, 2.8)]
part("funnel", "glass", "glass", lathe(prof, 40, closed=True))
pp = [(0.02, 3.65)] + [(funnel_rin(y) - 0.05, y) for y in [3.9 + k * 0.25 for k in range(23)]] + [(funnel_rin(9.4) - 0.05 - 0.04, 9.4)]
pin = [(r - 0.04, y) for (r, y) in reversed(pp[1:])]
part("funnel", "paper", "paper", lathe(pp + pin, 64, closed=True, deform=lambda x, y, z, t: (x * (1 - 0.035 * (0.5 + 0.5 * math.cos(16 * t))), y, z * (1 - 0.035 * (0.5 + 0.5 * math.cos(16 * t))))))

# Gas syringe, lying along +X. Origin on the barrel's axis at the middle cell. Head, rod and thumb rest move with what it holds.
def along_x(g): return g.rot_z(-math.pi / 2)  # vertical (+Y) to +X
part("syringe", "barrel", "glass", along_x(lathe([(0, -6.6), (0.2, -6.6), (0.26, -5.9), (0.5, -5.72), (1.2, -5.58), (1.3, -5.45), (1.3, 5.3), (1.95, 5.33), (1.98, 5.42),
                                                    (1.95, 5.55), (1.3, 5.58), (1.06, 5.58), (1.06, -5.2), (0.4, -5.32), (0, -5.32)], 32)))
gr = Geo()
for k in range(0, 21):
    x = -4.5 + k * 0.5; w = 0.42 if k % 2 == 0 else 0.22
    gr.add(arc_patch(1.302, 1.33, x - 0.02, x + 0.02, math.pi / 2 - w / 1.3, math.pi / 2, 2))
part("syringe", "print", "enamel", along_x(gr))
part("syringe", "head", "rubber_black", along_x(lathe([(0, -0.3), (0.98, -0.3), (1.04, -0.22), (0.98, -0.12), (1.04, 0.0), (0.98, 0.12), (1.04, 0.22), (0.98, 0.3), (0, 0.3)], 28)))
part("syringe", "rod", "ptfe", along_x(lathe([(0, 0), (0.3, 0), (0.3, 1), (0, 1)], 12)))
part("syringe", "thumb", "ptfe", along_x(cyl(1.1, -0.15, 0.15, 28, 0.06)))
cr = Geo()
for x in (-3.5, 3.5):
    cr.add(box(x, -1.3, 0, 0.8, 0.4, 2.6)).add(box(x, -0.9, 1.45, 0.8, 1.2, 0.3)).add(box(x, -0.9, -1.45, 0.8, 1.2, 0.3))
part("syringe", "cradle", "panel", cr, bevel=0.06)

# Shared pieces: a unit tube along +Y of radius 1 (rods, hoses, condenser glass) and a unit ball for hose bends.
part("seg", "seg", "steel", cyl(1, 0, 1, 20))
part("ball", "ball", "steel", sphere(1, 16, 10))

# Clamp stand: a cast base and the boss head. The rod and arm are unit tubes; the jaws close round a tool, the arm coming from +X.
part("stand", "base", "cast", box(0, 0.22, 0, 3.0, 0.44, 3.0), bevel=0.14)
part("stand", "socket", "steel", cyl(0.36, 0.4, 0.75, 20, 0.05))
part("boss", "block", "alu", box(0, 0, 0, 0.8, 0.8, 0.8), bevel=0.1)
part("boss", "screw", "knob", knob(0.22, 0.5).move(0, 0, 0.38))
jaws = Geo()
jaws.add(box(1.0, 0, 0, 0.9, 0.42, 0.42))
for sz in (-1, 1): jaws.add(sweep([(0.6, 0, sz * 0.12), (0.2, 0, sz * 0.55), (-0.3, 0, sz * 0.55), (-0.55, 0, sz * 0.3)], 0.12, 10, smooth=2))
part("jaws", "metal", "alu", jaws)
part("jaws", "pads", "cork", box(-0.05, 0, 0.42, 0.55, 0.32, 0.08).add(box(-0.05, 0, -0.42, 0.55, 0.32, 0.08)))

# Crucible tongs, len 10, tip at the origin, pivot at y 6. Each arm opens by turning about the pivot.
def tong_arm(side):
    pts = [(side * 0.1, 0.25, 0), (side * 0.32, 1.2, 0), (side * 0.28, 3.5, 0), (0, 6.0, 0), (-side * 0.55, 8.0, 0), (-side * 1.0, 9.6, 0)]
    g = sweep(pts, 0.11, 10, smooth=2).scale(1, 1, 1).move(0, 0, side * 0.1)
    g.add(lathe([(0, -0.12), (0.34, -0.12), (0.36, 0.0), (0.34, 0.12), (0, 0.12)], 16).rot_z(math.pi / 2).scale(1, 1.6, 1).move(side * 0.18, 0.35, side * 0.1))
    g.add(lathe([(0.16, -0.06), (0.32, -0.06), (0.32, 0.06), (0.16, 0.06)], 16, closed=True).rot_x(math.pi / 2).move(-side * 1.05, 9.85, side * 0.1))
    return g
part("tongs", "arm_l", "steel", tong_arm(1))
part("tongs", "arm_r", "steel", tong_arm(-1))
part("tongs", "pivot", "steel", cyl(0.16, -0.25, 0.25, 12).rot_x(math.pi / 2).move(0, 6.0, 0))

# Spark igniter, len 9: a piezo wand with its electrodes at the tip.
part("igniter", "handle", "red_plastic", lathe([(0, 4.2), (0.3, 4.2), (0.42, 4.6), (0.46, 5.2), (0.46, 8.3), (0.4, 8.65), (0.2, 8.8), (0, 8.8)], 24))
part("igniter", "grip", "rubber_black", lathe([(0.47, 6.0), (0.5, 6.1), (0.5, 7.7), (0.47, 7.8), (0.44, 7.8), (0.44, 6.0)], 24, closed=True))
part("igniter", "trigger", "knob", box(0, 7.2, 0.5, 0.3, 1.0, 0.25), bevel=0.06)
part("igniter", "rod", "steel", cyl(0.14, 0.75, 4.3, 14))
part("igniter", "insulator", "fiber", cyl(0.17, 0.3, 0.8, 14, 0.04))
part("igniter", "tip", "steel", box(-0.07, 0.15, 0, 0.05, 0.3, 0.05).add(box(0.07, 0.15, 0, 0.05, 0.3, 0.05)))

# Geiger counter, len 10: a probe tube with a mica window at the bottom, under the counter.
part("geiger", "probe", "alu", lathe([(0, 0.02), (0.5, 0.02), (0.58, 0.1), (0.58, 6.0), (0.45, 6.1), (0, 6.1)], 24))
part("geiger", "window", "mica", cyl(0.47, 0.0, 0.04, 20))
part("geiger", "ring", "knob", lathe([(0.585, 0.5), (0.62, 0.5), (0.62, 0.75), (0.585, 0.75)], 24, closed=True))
part("geiger", "box", "geiger", box(0, 7.9, 0, 2.8, 3.6, 2.0), bevel=0.3)
part("geiger", "panel", "panel", box(0, 8.3, 1.01, 2.3, 2.5, 0.04), bevel=0.02)
part("geiger", "lcd", "lcd", box(0, 8.9, 1.04, 1.7, 0.7, 0.03))
part("geiger", "led", "lamp", sphere(0.13, 12, 8).scale(1, 1, 0.6).move(-0.7, 7.6, 1.05))
grill = Geo()
for k in range(3): grill.add(box(0.45, 7.35 + k * 0.25, 1.04, 0.8, 0.08, 0.03))
part("geiger", "grill", "knob", grill)
part("geiger", "handle", "knob", sweep([(-1.0, 9.6, 0), (-1.0, 10.3, 0), (-0.6, 10.6, 0), (0.6, 10.6, 0), (1.0, 10.3, 0), (1.0, 9.6, 0)], 0.16, 12, smooth=2))

# Bell jar, radius 8 and len 16, origin at the middle of its rim on the bench, with a side port for the pump hose.
JR, JL = 8, 16
ri, ro = JR + 0.55, JR + 1.2
prof = [(0, JL + 1.0)] + ellipse_pts(0, JL - 1.6, ro, 2.6, math.pi / 2, 0, 12)[1:] + [(ro, 0.6), (ro + 0.55, 0.42), (ro + 0.6, 0.12), (ro + 0.5, 0.0), (ri, 0.0)]
prof += ellipse_pts(0, JL - 1.6, ri, 2.0, 0, math.pi / 2, 12)
part("jar", "glass", "glass", lathe(prof, 72))
part("jar", "knob", "glass", lathe([(0, JL + 0.95), (0.6, JL + 0.95), (0.45, JL + 1.4), (0.9, JL + 2.0), (0.85, JL + 2.4), (0.4, JL + 2.62), (0, JL + 2.62)], 32))
part("jar", "port", "glass", lathe([(0, 0), (0.4, 0), (0.4, 1.0), (0.32, 1.1), (0.36, 1.25), (0.3, 1.5), (0, 1.5)], 20).rot_z(-math.pi / 2).move(ro - 0.3, 2.5, 0))
# The vacuum pump beside it, for a jar of radius 8: the game slides it out for a bigger jar.
P = JR + 2.5
part("pump", "feet", "knob", box(P + 2.5, 0.15, 0, 4.8, 0.3, 4.4), bevel=0.08)
part("pump", "body", "case", box(P + 1.4, 1.55, 0, 2.6, 2.5, 3.8), bevel=0.25)
part("pump", "motor", "motor", lathe([(0, 0), (1.2, 0), (1.25, 0.1), (1.25, 2.0), (1.1, 2.2), (0, 2.2)], 32).rot_z(-math.pi / 2).move(P + 2.7, 1.55, 0))
fins = Geo()
for k in range(5): fins.add(lathe([(1.25, 0.2 + k * 0.38), (1.36, 0.2 + k * 0.38), (1.36, 0.32 + k * 0.38), (1.25, 0.32 + k * 0.38)], 32, closed=True).rot_z(-math.pi / 2).move(P + 2.7, 1.55, 0))
part("pump", "fins", "motor", fins)
part("pump", "sight", "oil", cyl(0.42, 0, 0.08, 20).rot_x(math.pi / 2).move(P + 1.4, 1.2, 1.9))
part("pump", "handle", "knob", sweep([(P + 0.6, 2.8, 0), (P + 0.6, 3.5, 0), (P + 1.0, 3.85, 0), (P + 1.9, 3.85, 0), (P + 2.3, 3.5, 0), (P + 2.3, 2.8, 0)], 0.15, 12, smooth=2))
part("pump", "led", "lamp", sphere(0.14, 12, 8).scale(1, 0.6, 1).move(P + 0.6, 2.82, 1.3))
part("pump", "hose", "rubber_black", lathe([(0, 0), (0.45, 0), (0.45, 1.0), (0, 1.0)], 20).rot_z(-math.pi / 2).move(ro + 0.75, 2.5, 0))

# Liebig condenser pieces. The game lays the inner tube and the jacket between their ends; these are the parts that do not stretch.
part("cond_end", "glass", "glass", lathe([(0, 0.02), (1.38, 0.02), (1.38, 0), (1.2, -0.35), (0.7, -0.62), (0.5, -0.7), (0, -0.7)], 32))
part("cond_nipple", "glass", "glass", lathe([(0, 0), (0.24, 0), (0.24, 0.8), (0.3, 0.9), (0.22, 1.05), (0.28, 1.15), (0.2, 1.3), (0, 1.3)], 14).rot_z(-math.pi / 2))
part("cond_tip", "glass", "glass", lathe([(0, 0), (0.48, 0), (0.48, -0.5), (0.3, -1.0), (0.16, -1.4), (0, -1.4)], 20))

# ---------------------------------------------------------------- export
def export_js(path):
    dg = bpy.context.evaluated_depsgraph_get()
    models = {}; stats = [0, 0]
    for model, name, mat, ob in PARTS:
        me = ob.evaluated_get(dg).to_mesh(); me.calc_loop_triangles()
        cn = me.corner_normals; verts = {}; P, N, I = [], [], []
        for tri in me.loop_triangles:
            for li in tri.loops:
                co = me.vertices[me.loops[li].vertex_index].co; n = cn[li].vector
                p = (co.x, co.z, -co.y); q = (n.x, n.z, -n.y)  # Blender back to game
                key = (round(p[0], 4), round(p[1], 4), round(p[2], 4), round(q[0], 2), round(q[1], 2), round(q[2], 2))
                k = verts.get(key)
                if k is None:
                    k = verts[key] = len(P); P.append(p); N.append(q)
                I.append(k)
        ob.evaluated_get(dg).to_mesh_clear()
        lo = [min(p[a] for p in P) for a in range(3)]; hi = [max(p[a] for p in P) for a in range(3)]
        sc = [max(hi[a] - lo[a], 1e-6) for a in range(3)]
        pos = b"".join(struct.pack("<3H", *[int(round((p[a] - lo[a]) / sc[a] * 65535)) for a in range(3)]) for p in P)
        nrm = b"".join(struct.pack("<3b", *[max(-127, min(127, int(round(q[a] * 127)))) for a in range(3)]) for q in N)
        if len(P) > 65535: raise RuntimeError(model + "." + name + " has too many vertices")
        idx = struct.pack("<%dH" % len(I), *I)
        # Winding: Blender's faces point outward, and the triangles keep that order.
        models.setdefault(model, []).append({"part": name, "mat": mat, "lo": [round(v, 5) for v in lo], "sc": [round(v, 5) for v in sc],
            "p": base64.b64encode(pos).decode(), "n": base64.b64encode(nrm).decode(), "i": base64.b64encode(idx).decode()})
        stats[0] += len(P); stats[1] += len(I) // 3
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("// Generated by tools/blender/labware.py in Blender " + bpy.app.version_string + ". Do not edit: change the script and run it again.\n")
        f.write("// Lab equipment meshes in cell units, Y up. Each part: positions as uint16 within lo + sc, normals as int8, triangles as uint16 indices.\n")
        f.write("var LABWARE = " + json.dumps({"version": 1, "models": models}, separators=(",", ":")) + ";\n")
    print("labware: %d models, %d parts, %d vertices, %d triangles -> %s" % (len(models), len(PARTS), stats[0], stats[1], path))

export_js(os.path.join(ROOT, "js", "labware.data.js"))
bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, "labware.glb"), export_format="GLB", use_selection=False, export_apply=True, export_yup=True)

# ---------------------------------------------------------------- preview render
if "--preview" in sys.argv:
    scene = bpy.context.scene
    layout = {  # model: (x, z) on the preview bench, in cells
        "hotplate": (0, 0), "stirrer": (16, 0), "chiller": (32, 0), "balance": (47, 0), "burner": (58, 0),
        "beaker": (0, 0), "flask": (16, 0), "crucible": (32, 0), "dish": (47, -18), "bottle": (58, -18), "tube": (66, -18),
        "thermometer": (68, 0), "dropper": (71, 0), "funnel": (78, 0), "syringe": (88, -18), "tongs": (76, -18), "igniter": (100, 0), "geiger": (104, 0),
        "supply": (88, 0), "rod": (86, 0), "jar": (122, -4), "pump": (122, -4), "stirbar": (16, 0), "stopper": (58, -18),
    }
    lift = {"beaker": 2, "flask": 2, "crucible": 2, "stirbar": 3.3, "stopper": 12.0, "funnel": 0, "supply": 14, "dish": 0}
    for model, name, mat, ob in PARTS:
        if model not in layout: ob.hide_render = True; continue
        x, z = layout[model]; y = lift.get(model, 0)
        if model == "rod": ob.scale = (1, 1, 1)
        if model == "stopper": ob.scale = (3.6, 3.6, 1)
        if model == "syringe": y = 1.5
        ob.location = G((x, y, z))
    for model, name, mat, ob in PARTS:
        if model == "rod":
            ob2 = ob.copy(); scene.collection.objects.link(ob2); ob.location = G((88 - 2, 0, 0)); ob2.location = G((88 + 2, 0, 0))
    bpy.ops.mesh.primitive_plane_add(size=400, location=(60, 0, 0)); bench = bpy.context.object
    bm = bpy.data.materials.new("bench"); bm.use_nodes = True; bm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.32, 0.33, 0.35, 1)
    bm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.6; bench.data.materials.append(bm)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam); scene.camera = cam
    cam.location = (62, -95, 58); cam.rotation_euler = (math.radians(58), 0, 0); cam.data.lens = 38
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(40), math.radians(-25), math.radians(30)); sun.data.energy = 3.5
    area = bpy.data.objects.new("area", bpy.data.lights.new("area", "AREA")); scene.collection.objects.link(area)
    area.location = (40, -40, 80); area.data.energy = 60000; area.data.size = 60
    world = bpy.data.worlds.new("w"); world.use_nodes = True; world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.25, 0.27, 0.3, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8; scene.world = world
    scene.render.engine = "BLENDER_EEVEE"; scene.render.resolution_x = 1800; scene.render.resolution_y = 900
    try: scene.eevee.use_raytracing = True
    except Exception: pass
    scene.render.filepath = os.path.join(HERE, "labware_preview.png")
    bpy.ops.render.render(write_still=True)
    print("preview -> " + scene.render.filepath)
