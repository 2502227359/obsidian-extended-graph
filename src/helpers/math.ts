
export function polar2Cartesian(x: number, y: number, r: number, theta: number) {
    return {
        x: x + (r * Math.cos(theta)),
        y: y + (r * Math.sin(theta))
    };
}

interface Point {
    x: number;
    y: number;
}
export function bezier(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
    const cX = 3 * (p1.x - p0.x),
        bX = 3 * (p2.x - p1.x) - cX,
        aX = p3.x - p0.x - cX - bX;

    const cY = 3 * (p1.y - p0.y),
        bY = 3 * (p2.y - p1.y) - cY,
        aY = p3.y - p0.y - cY - bY;

    const x = (aX * Math.pow(t, 3)) + (bX * Math.pow(t, 2)) + (cX * t) + p0.x;
    const y = (aY * Math.pow(t, 3)) + (bY * Math.pow(t, 2)) + (cY * t) + p0.y;

    return { x: x, y: y };
}

export function quadratic(t: number, p0: Point, p1: Point, p2: Point): Point {
    const c1x = (1 - t) * ((1 - t) * p0.x + t * p1.x);
    const c1y = (1 - t) * ((1 - t) * p0.y + t * p1.y);
    const c2x = t * ((1 - t) * p1.x + t * p2.x);
    const c2y = t * ((1 - t) * p1.y + t * p2.y);
    const x = c1x + c2x;
    const y = c1y + c2y;
    return { x: x, y: y };
}

/** Same as quadratic() but writes the result into `out` — for per-frame hot paths. */
export function quadraticInto(t: number, p0: Point, p1: Point, p2: Point, out: Point): Point {
    const c1x = (1 - t) * ((1 - t) * p0.x + t * p1.x);
    const c1y = (1 - t) * ((1 - t) * p0.y + t * p1.y);
    const c2x = t * ((1 - t) * p1.x + t * p2.x);
    const c2y = t * ((1 - t) * p1.y + t * p2.y);
    out.x = c1x + c2x;
    out.y = c1y + c2y;
    return out;
}

// https://math.stackexchange.com/questions/2149009/find-a-tangent-to-two-quadratic-bezier-curves
export function tangentQuadratic(t: number, p0: Point, p1: Point, p2: Point): { m: number, c: number } {
    // The tangent line at point x=t passes through the points A = [(1 - t) * p0 + t * p1] and B = [(1 - t) * p1 + t * p2]
    const A: Point = {
        x: (1 - t) * p0.x + t * p1.x,
        y: (1 - t) * p0.y + t * p1.y,
    };
    const B: Point = {
        x: (1 - t) * p1.x + t * p2.x,
        y: (1 - t) * p1.y + t * p2.y,
    };
    const m = (B.y - A.y) / (B.x - A.x);
    return {
        m: m,
        c: A.y - m * A.x
    };
}

// https://stackoverflow.com/questions/11854907/calculate-the-length-of-a-segment-of-a-quadratic-bezier
export function lengthQuadratic(t: number, p0: Point, p1: Point, p2: Point): number {
    const ax = p0.x - p1.x - p1.x + p2.x;
    const ay = p0.y - p1.y - p1.y + p2.y;
    const bx = p1.x + p1.x - p0.x - p0.x;
    const by = p1.y + p1.y - p0.y - p0.y;
    const A = 4.0 * ((ax * ax) + (ay * ay));
    const B = 4.0 * ((ax * bx) + (ay * by));
    const C = (bx * bx) + (by * by);
    const b = B / (2.0 * A);
    const c = C / A;
    const u = t + b;
    const k = c - b * b;
    const b2k = Math.sqrt(b * b + k);
    const u2k = Math.sqrt(u * u + k);
    const L = 0.5 * Math.sqrt(A) * (
        (u * u2k)
        - (b * b2k)
        + (k * Math.log(Math.abs((u + u2k) / (b + b2k))))
    );
    return L;
}

export function lengthSegment(t: number, p0: Point, p1: Point): number {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    return Math.sqrt(dx * dx + dy * dy) * t;
}