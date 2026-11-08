// Vendored from dsh-cerebrum 0.1.7, b8fbe018f0d3d29ad92a97180c0f7387d8d524c6.
// Copyright (c) 2026 dsh-cerebrum contributors; MIT, see ../../notices/cerebrum-MIT-LICENSE.
/**
 * Small numeric toolkit. Everything here is deterministic so that memory
 * retrieval, appraisal and judgment can be replayed and unit-tested.
 */

export const clamp = (x, lo = 0, hi = 1) => {
  const n = Number(x)
  if (Number.isNaN(n)) return lo
  return n < lo ? lo : n > hi ? hi : n
}

export const lerp = (a, b, t) => a + (b - a) * t

export const sigmoid = (x) => 1 / (1 + Math.exp(-x))

export const softmax = (values, temperature = 1) => {
  if (values.length === 0) return []
  const max = Math.max(...values)
  const exps = values.map((v) => Math.exp((v - max) / Math.max(temperature, 1e-6)))
  const sum = exps.reduce((a, b) => a + b, 0) || 1
  return exps.map((v) => v / sum)
}

export const entropy = (probabilities) => {
  let h = 0
  for (const p of probabilities) if (p > 0) h -= p * Math.log(p)
  return h
}

/** Exponential moving average toward `target`, `alpha` in (0, 1]. */
export const ema = (current, target, alpha) => current + (target - current) * clamp(alpha, 0, 1)

/** Exponential decay of a quantity with a half-life in milliseconds. */
export const decay = (value, elapsedMs, halfLifeMs, floor = 0) =>
  floor + (value - floor) * Math.pow(0.5, Math.max(elapsedMs, 0) / Math.max(halfLifeMs, 1))

/** Huber-style compression: keeps a rare huge signal from saturating the state. */
export const compress = (x, knee = 1) => (Math.abs(x) <= knee ? x : Math.sign(x) * (knee + Math.log1p(Math.abs(x) - knee)))

/** Mulberry32: tiny seeded PRNG, used for reproducible exploration noise. */
export const makeRng = (seed = 0x9e3779b9) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const gaussian = (rng) => {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * Kahneman–Tversky value function used by the judgment module.
 * @param {number} x outcome in [-1, 1] (fraction of the stake)
 * @param {{alpha?: number, beta?: number, lossAversion?: number}} options
 */
export const prospectValue = (x, { alpha = 0.88, beta = 0.88, lossAversion = 2.25 } = {}) => {
  if (x >= 0) return Math.pow(Math.abs(x), alpha)
  return -lossAversion * Math.pow(Math.abs(x), beta)
}

/** Normalize a map of numeric weights into a probability vector. */
export const normalizeMap = (map) => {
  const entries = [...map.entries()]
  const total = entries.reduce((sum, [, v]) => sum + Math.max(v, 0), 0)
  if (total <= 0) return new Map()
  return new Map(entries.map(([k, v]) => [k, Math.max(v, 0) / total]))
}

/** Pearson correlation for equally sized arrays; returns 0 for degenerate input. */
export const correlation = (a, b) => {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  const den = Math.sqrt(da * db)
  return den === 0 ? 0 : num / den
}
