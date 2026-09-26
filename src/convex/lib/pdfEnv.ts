/**
 * pdf.js (bundled inside pdf-parse) expects browser globals that do not exist
 * in the Convex Node action runtime, and it has no canvas package to polyfill
 * them from. Text/table extraction never touches rendering, so tiny stand-ins
 * are enough to let the module load and parse.
 *
 * Must be called BEFORE pdf-parse is imported.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

class MiniDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  m11 = 1;
  m12 = 0;
  m13 = 0;
  m14 = 0;
  m21 = 0;
  m22 = 1;
  m23 = 0;
  m24 = 0;
  m31 = 0;
  m32 = 0;
  m33 = 1;
  m34 = 0;
  m41 = 0;
  m42 = 0;
  m43 = 0;
  m44 = 1;

  constructor(init?: any) {
    if (Array.isArray(init) && init.length >= 6) {
      this.a = Number(init[0]) || 1;
      this.b = Number(init[1]) || 0;
      this.c = Number(init[2]) || 0;
      this.d = Number(init[3]) || 1;
      this.e = Number(init[4]) || 0;
      this.f = Number(init[5]) || 0;
    } else if (init && typeof init === "object") {
      for (const key of [
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "m11",
        "m12",
        "m13",
        "m14",
        "m21",
        "m22",
        "m23",
        "m24",
        "m31",
        "m32",
        "m33",
        "m34",
        "m41",
        "m42",
        "m43",
        "m44",
      ]) {
        if (typeof init[key] === "number") (this as any)[key] = init[key];
      }
    }
  }

  static fromMatrix(init?: any) {
    return new MiniDOMMatrix(init);
  }
  static identity() {
    return new MiniDOMMatrix();
  }
  multiplySelf(m?: any) {
    return m ? this : this;
  }
  preMultiplySelf() {
    return this;
  }
  translateSelf() {
    return this;
  }
  scaleSelf() {
    return this;
  }
  rotateSelf() {
    return this;
  }
  rotateFromVectorSelf() {
    return this;
  }
  skewXSelf() {
    return this;
  }
  skewYSelf() {
    return this;
  }
  flipX() {
    return this;
  }
  flipY() {
    return this;
  }
  invert() {
    return new MiniDOMMatrix();
  }
  inverse() {
    return new MiniDOMMatrix();
  }
  transformPoint(point: any) {
    return point;
  }
  toFloat32Array() {
    return new Float32Array([
      this.a,
      this.b,
      this.c,
      this.d,
      this.e,
      this.f,
      0,
      0,
    ]);
  }
  toString() {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
  }
}

class MiniImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  colorSpace = "srgb";
  constructor(width: number, height: number, data?: Uint8ClampedArray) {
    this.width = width;
    this.height = height;
    this.data = data ?? new Uint8ClampedArray(width * height * 4);
  }
}

class MiniPath2D {
  moveTo() {}
  lineTo() {}
  closePath() {}
  rect() {}
  roundRect() {}
  arc() {}
  arcTo() {}
  ellipse() {}
  quadraticCurveTo() {}
  bezierCurveTo() {}
  addPath() {}
  set() {}
}

export function ensurePdfGlobals(): void {
  const g = globalThis as any;
  if (typeof g.DOMMatrix === "undefined") g.DOMMatrix = MiniDOMMatrix;
  if (typeof g.ImageData === "undefined") g.ImageData = MiniImageData;
  if (typeof g.Path2D === "undefined") g.Path2D = MiniPath2D;
  if (typeof g.DOMPoint === "undefined") {
    g.DOMPoint = class DOMPoint {
      x = 0;
      y = 0;
      z = 0;
      w = 1;
      constructor(x = 0, y = 0, z = 0, w = 1) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
      }
    };
  }
}
