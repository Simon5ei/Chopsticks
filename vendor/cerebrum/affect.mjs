// Vendored from dsh-cerebrum 0.1.7, b8fbe018f0d3d29ad92a97180c0f7387d8d524c6.
// Copyright (c) 2026 dsh-cerebrum contributors; MIT, see ../../notices/cerebrum-MIT-LICENSE.
/**
 * Affect: appraisal -> emotion -> mood -> neuromodulators.
 *
 * Three timescales, three mechanisms:
 *   1. appraisal (Scherer's Stimulus Evaluation Checks + OCC variables) is
 *      computed per event: relevance, congruence, novelty, certainty, agency,
 *      control/coping, norm compatibility, urgency, magnitude;
 *   2. emotion is the nearest prototype in that appraisal space (a constructed,
 *      categorical read-out), with intensity from relevance x congruence x urgency;
 *   3. core affect (Russell's valence/arousal) and mood integrate the episode,
 *      while four neuromodulators carry the modulatory signal forward:
 *        DA  - reward prediction error, drives effort and exploration,
 *        5-HT- aversive prediction, drives patience and impulse inhibition,
 *        NE  - unexpected uncertainty, drives arousal and vigilance,
 *        ACh - expected uncertainty, drives attention and learning rate.
 *      The mapping follows Doya (2002) and Boureau & Dayan (2011) rather than a
 *      single "happiness number".
 *
 * The amygdala analogue is the salience gain applied at encoding: high arousal
 * makes an episode harder to forget (affect-tagged memory).
 */

import { clamp, decay, sigmoid, softmax } from './math.mjs'

export const APPRAISAL_DIMS = [
  'relevance',
  'congruence',
  'novelty',
  'certainty',
  'agency',
  'control',
  'norm',
  'urgency',
  'magnitude',
]

/**
 * Emotion prototypes in appraisal space. `v`/`a` are the core-affect centroid,
 * `tendency` is the action tendency a decision layer may act on.
 */
export const EMOTION_PROTOTYPES = [
  { key: 'relief', label: '如释重负', p: { relevance: 0.55, congruence: 0.55, novelty: 0.25, certainty: 0.7, agency: 0.5, control: 0.65, norm: 0.2, urgency: 0.15, magnitude: 0.45 }, v: 0.45, a: 0.22, tendency: '收尾、恢复常态' },
  { key: 'joy', label: '喜悦', p: { relevance: 0.7, congruence: 0.8, novelty: 0.35, certainty: 0.7, agency: 0.7, control: 0.7, norm: 0.5, urgency: 0.2, magnitude: 0.6 }, v: 0.8, a: 0.55, tendency: '分享并推进' },
  { key: 'contentment', label: '满足', p: { relevance: 0.4, congruence: 0.7, novelty: 0.1, certainty: 0.85, agency: 0.6, control: 0.8, norm: 0.5, urgency: 0.1, magnitude: 0.35 }, v: 0.6, a: 0.15, tendency: '维持现状' },
  { key: 'curiosity', label: '好奇', p: { relevance: 0.7, congruence: 0.15, novelty: 0.9, certainty: 0.25, agency: 0.5, control: 0.55, norm: 0.1, urgency: 0.4, magnitude: 0.4 }, v: 0.3, a: 0.6, tendency: '探索并收集信息' },
  { key: 'hope', label: '期待', p: { relevance: 0.7, congruence: 0.6, novelty: 0.45, certainty: 0.35, agency: 0.45, control: 0.4, norm: 0.4, urgency: 0.5, magnitude: 0.55 }, v: 0.5, a: 0.55, tendency: '投入并等待结果' },
  { key: 'pride', label: '自豪', p: { relevance: 0.6, congruence: 0.8, novelty: 0.3, certainty: 0.8, agency: 0.9, control: 0.8, norm: 0.6, urgency: 0.2, magnitude: 0.6 }, v: 0.72, a: 0.55, tendency: '保持标准' },
  { key: 'gratitude', label: '感激', p: { relevance: 0.6, congruence: 0.8, novelty: 0.4, certainty: 0.7, agency: 0.1, control: 0.3, norm: 0.7, urgency: 0.3, magnitude: 0.5 }, v: 0.75, a: 0.4, tendency: '回报与维系关系' },
  { key: 'fear', label: '恐惧', p: { relevance: 0.9, congruence: -0.8, novelty: 0.6, certainty: 0.6, agency: 0.1, control: 0.1, norm: 0, urgency: 0.9, magnitude: 0.85 }, v: -0.8, a: 0.85, tendency: '回避或求助' },
  { key: 'anxiety', label: '焦虑', p: { relevance: 0.8, congruence: -0.5, novelty: 0.5, certainty: 0.2, agency: 0.2, control: 0.2, norm: -0.1, urgency: 0.7, magnitude: 0.6 }, v: -0.55, a: 0.72, tendency: '反复检查、寻求确定' },
  { key: 'anger', label: '愤怒', p: { relevance: 0.8, congruence: -0.7, novelty: 0.3, certainty: 0.7, agency: 0.5, control: 0.6, norm: -0.2, urgency: 0.8, magnitude: 0.7 }, v: -0.6, a: 0.8, tendency: '对抗、设边界' },
  { key: 'guilt', label: '内疚', p: { relevance: 0.6, congruence: -0.6, novelty: 0.2, certainty: 0.6, agency: 0.9, control: 0.7, norm: -0.8, urgency: 0.5, magnitude: 0.55 }, v: -0.6, a: 0.5, tendency: '修复与补偿' },
  { key: 'shame', label: '羞愧', p: { relevance: 0.6, congruence: -0.6, novelty: 0.2, certainty: 0.5, agency: 0.8, control: 0.3, norm: -0.8, urgency: 0.5, magnitude: 0.55 }, v: -0.65, a: 0.45, tendency: '退缩、隐藏' },
  { key: 'sadness', label: '失落', p: { relevance: 0.6, congruence: -0.7, novelty: 0.2, certainty: 0.7, agency: 0.2, control: 0.1, norm: 0, urgency: 0.3, magnitude: 0.55 }, v: -0.7, a: 0.25, tendency: '放慢、求助' },
  { key: 'frustration', label: '挫败', p: { relevance: 0.7, congruence: -0.5, novelty: 0.4, certainty: 0.5, agency: 0.5, control: 0.3, norm: 0, urgency: 0.6, magnitude: 0.5 }, v: -0.5, a: 0.65, tendency: '换路径或放弃' },
  { key: 'calm', label: '平静', p: { relevance: 0.3, congruence: 0.1, novelty: 0.1, certainty: 0.7, agency: 0.5, control: 0.7, norm: 0.3, urgency: 0.1, magnitude: 0.2 }, v: 0.2, a: 0.12, tendency: '按计划行事' },
]

/** Appraisal dimension weights: relevance and congruence dominate, by design. */
const DIM_WEIGHTS = {
  relevance: 1.0,
  congruence: 1.1,
  novelty: 0.5,
  certainty: 0.3,
  agency: 0.3,
  control: 0.6,
  norm: 0.55,
  urgency: 0.6,
  magnitude: 0.45,
}

const signed = (x) => (clamp(x, -1, 1) + 1) / 2

const distance = (a, b) => {
  let sum = 0
  let weights = 0
  for (const dim of APPRAISAL_DIMS) {
    const diff = (dim === 'congruence' || dim === 'norm' ? signed(a[dim] ?? 0) : clamp(a[dim] ?? 0)) -
      (dim === 'congruence' || dim === 'norm' ? signed(b[dim] ?? 0) : clamp(b[dim] ?? 0))
    sum += DIM_WEIGHTS[dim] * diff * diff
    weights += DIM_WEIGHTS[dim]
  }
  return Math.sqrt(sum / weights)
}

const NEUROMOD_BASELINE = { da: 0.5, ser: 0.55, ne: 0.35, ach: 0.4 }
const NEUROMOD_HALFLIFE = { da: 8 * 60e3, ser: 45 * 60e3, ne: 12 * 60e3, ach: 20 * 60e3 }

export const NEUROMOD_LABELS = { da: '多巴胺', ser: '血清素', ne: '去甲肾上腺素', ach: '乙酰胆碱' }

export class AffectSystem {
  constructor({ personality, state } = {}) {
    this.personality = personality
    const now = Date.now()
    this.valence = 0.05
    this.arousal = 0.3
    this.dominance = 0.2
    this.moodValence = 0.05
    this.moodArousal = 0.3
    this.neuromods = { ...NEUROMOD_BASELINE }
    this.emotion = { key: 'calm', label: '平静', intensity: 0.2, cause: '初始状态', at: now }
    this.history = []
    this.updatedAt = now
    if (state) this.restore(state)
  }

  /** Setpoints: the PAD personality center (Mehrabian), not a flat neutral. */
  get baseline() {
    const pad = this.personality?.pad?.() ?? { pleasure: 0.05, arousal: 0.3, dominance: 0.2 }
    return { valence: clamp(pad.pleasure ?? 0.05, -1, 1), arousal: clamp(pad.arousal ?? 0.3, 0, 1), dominance: clamp(pad.dominance ?? 0.2, -1, 1) }
  }

  /** Exponential relaxation of mood and neuromodulators toward baseline. */
  decay(now = Date.now()) {
    const dt = Math.max(0, now - this.updatedAt)
    if (dt < 1000) return
    const base = this.baseline
    // Mood relaxes slowly (tau ~ 40 min); neuromodulators have transmitter-specific half-lives.
    const moodAlpha = 1 - Math.exp(-dt / (40 * 60e3))
    this.moodValence += (base.valence - this.moodValence) * moodAlpha
    this.moodArousal += (base.arousal - this.moodArousal) * moodAlpha
    for (const key of Object.keys(this.neuromods)) {
      this.neuromods[key] = decay(this.neuromods[key], dt, NEUROMOD_HALFLIFE[key], NEUROMOD_BASELINE[key])
    }
    // Core affect also returns to the mood level when nothing happens.
    const affectAlpha = 1 - Math.exp(-dt / (6 * 60e3))
    this.valence += (this.moodValence - this.valence) * affectAlpha
    this.arousal += (this.moodArousal - this.arousal) * affectAlpha
    this.dominance += (base.dominance - this.dominance) * affectAlpha
    this.updatedAt = now
  }

  /**
   * Appraise one event and update the whole affective state.
   * @param {object} dims partial appraisal vector; missing dimensions default to neutral
   * @param {{cause?: string, now?: number}} options
   */
  appraise(dims = {}, { cause = '', now = Date.now() } = {}) {
    this.decay(now)
    const a = {}
    for (const dim of APPRAISAL_DIMS) {
      const raw = Number(dims[dim])
      const value = Number.isFinite(raw) ? raw : 0
      if (dim === 'congruence' || dim === 'norm') a[dim] = clamp(value, -1, 1)
      else a[dim] = clamp(value)
    }
    // Trait gain: neuroticism amplifies threat appraisal, extraversion amplifies relevance of social events.
    const P = this.personality?.params() ?? {}
    a.relevance = clamp(a.relevance * (1 + 0.25 * (P.threatSensitivity ?? 0.5) * (a.congruence < 0 ? 1 : 0)))
    a.magnitude = clamp(a.magnitude * (1 + 0.2 * (P.rewardSensitivity ?? 0.5) * (a.congruence > 0 ? 1 : 0)))

    const distances = EMOTION_PROTOTYPES.map((proto) => distance(a, proto.p))
    const weights = softmax(distances.map((d) => -d / 0.13))
    let bestIndex = 0
    for (let i = 1; i < weights.length; i++) if (weights[i] > weights[bestIndex]) bestIndex = i

    const activation = clamp(0.3 * a.relevance + 0.35 * Math.abs(a.congruence) + 0.15 * a.novelty + 0.2 * a.urgency + 0.15 * a.magnitude)
    const protoFit = weights[bestIndex]
    const intensity = clamp(activation * (0.45 + 0.55 * protoFit))

    let emotion
    if (protoFit < 0.09 || distances[bestIndex] > 0.42 || intensity < 0.09) {
      emotion = { key: 'calm', label: '平静', intensity: clamp(0.15 + 0.3 * event_tension(a), 0.05, 0.5), cause, at: now }
    } else {
      const proto = EMOTION_PROTOTYPES[bestIndex]
      emotion = { key: proto.key, label: proto.label, intensity, cause, at: now }
    }

    // Core affect: prototype-weighted centroid, pulled toward the current emotion.
    let vTarget = 0
    let aTarget = 0
    for (let i = 0; i < weights.length; i++) {
      vTarget += weights[i] * EMOTION_PROTOTYPES[i].v
      aTarget += weights[i] * EMOTION_PROTOTYPES[i].a
    }
    const gain = 0.25 + 0.55 * intensity
    this.valence = clamp(this.valence + (vTarget - this.valence) * gain, -1, 1)
    this.arousal = clamp(this.arousal + (aTarget - this.arousal) * gain, 0, 1)
    // Dominance follows coping potential: controllable situations feel dominant.
    const dTarget = 2 * a.control - 1
    this.dominance = clamp(this.dominance + (dTarget - this.dominance) * gain, -1, 1)

    // Mood integrates slowly; positive and negative events both raise arousal.
    const moodGain = 0.06 + 0.18 * intensity
    this.moodValence = clamp(this.moodValence + (this.valence - this.moodValence) * moodGain, -1, 1)
    this.moodArousal = clamp(this.moodArousal + (this.arousal - this.moodArousal) * (moodGain * 0.7), 0, 1)

    // Neuromodulator responses. Each update scales by the remaining headroom so a
    // burst of events cannot pin a transmitter at 1.0 forever.
    const rpe = a.congruence * a.relevance * (0.4 + 0.6 * a.magnitude)
    if (rpe > 0) this.neuromods.da = clamp(this.neuromods.da + 0.45 * (1 - this.neuromods.da) * rpe)
    if (rpe < 0) {
      this.neuromods.ser = clamp(this.neuromods.ser + 0.3 * (1 - this.neuromods.ser) * Math.abs(rpe))
      this.neuromods.da = clamp(this.neuromods.da + 0.3 * this.neuromods.da * rpe)
    }
    if (a.novelty > 0.4 || a.urgency > 0.6) {
      this.neuromods.ne = clamp(this.neuromods.ne + 0.35 * (1 - this.neuromods.ne) * Math.max(a.novelty, a.urgency * 0.8))
    }
    if (a.certainty < 0.45) this.neuromods.ach = clamp(this.neuromods.ach + 0.35 * (1 - this.neuromods.ach) * (0.45 - a.certainty) * 2)

    this.emotion = emotion
    this.updatedAt = now
    this.history.push({ at: now, key: emotion.key, label: emotion.label, intensity, valence: round2(this.valence), arousal: round2(this.arousal), cause })
    if (this.history.length > 200) this.history.splice(0, this.history.length - 200)
    return emotion
  }

  /** Track a tool/step outcome as reward or punishment (RPE-like). */
  outcome({ success = true, magnitude = 0.5, now = Date.now(), cause = '' } = {}) {
    this.decay(now)
    if (success) {
      this.neuromods.da = clamp(this.neuromods.da + 0.3 * (1 - this.neuromods.da) * magnitude)
      this.valence = clamp(this.valence + 0.12 * magnitude, -1, 1)
    } else {
      this.neuromods.ser = clamp(this.neuromods.ser + 0.25 * (1 - this.neuromods.ser) * magnitude)
      this.neuromods.ne = clamp(this.neuromods.ne + 0.25 * (1 - this.neuromods.ne) * magnitude)
      this.neuromods.da = clamp(this.neuromods.da - 0.25 * this.neuromods.da * magnitude)
      this.valence = clamp(this.valence - 0.18 * magnitude, -1, 1)
      this.arousal = clamp(this.arousal + 0.12 * magnitude, 0, 1)
    }
    this.updatedAt = now
    if (cause) this.emotion = { ...this.emotion, cause }
    return this.snapshot(now)
  }

  // ---- Derived behavioural gains -------------------------------------------

  /** Amygdala gain at encoding: arousal x threat sensitivity. */
  get salienceGain() {
    const P = this.personality?.params() ?? {}
    return clamp(0.5 + 0.9 * this.arousal * (P.threatSensitivity ?? 0.5) + 0.4 * Math.abs(this.valence), 0.2, 1.8)
  }

  /** Mood-congruent retrieval bias in [0, 1]; happy mood favours positive memories. */
  get moodCongruence() {
    return clamp(0.18 + 0.35 * Math.abs(this.moodValence))
  }

  /** Effective loss aversion includes serotonin (patience) and NE (vigilance). */
  lossAversion(base) {
    return clamp(base * (1 + 0.45 * (1 - this.neuromods.ser)) * (1 + 0.25 * this.neuromods.ne), 1, 4.5)
  }

  exploration(base) {
    return clamp(base * (0.55 + 0.9 * this.neuromods.da) * (0.7 + 0.6 * this.neuromods.ne), 0.02, 1)
  }

  /** Impulse inhibition: serotonin and low arousal both help. */
  inhibition(base) {
    return clamp(base * (0.6 + 0.7 * this.neuromods.ser) * (1 - 0.25 * this.arousal), 0.05, 1)
  }

  get learningRate() {
    return clamp(0.15 + 0.55 * this.neuromods.ach + 0.2 * this.neuromods.ne, 0.05, 0.95)
  }

  /** Compact Chinese description for the prompt and the state card. */
  describe() {
    const v = this.valence
    const tone = v > 0.35 ? '偏积极' : v > 0.1 ? '略积极' : v < -0.35 ? '明显消极' : v < -0.1 ? '略消极' : '中性'
    const arousal = this.arousal > 0.65 ? '高唤醒' : this.arousal > 0.4 ? '中等唤醒' : '低唤醒'
    return `${this.emotion.label}（强度 ${this.emotion.intensity.toFixed(2)}）· 心境${tone}·${arousal}`
  }

  snapshot(now = Date.now()) {
    return {
      valence: round2(this.valence),
      arousal: round2(this.arousal),
      dominance: round2(this.dominance),
      mood: { valence: round2(this.moodValence), arousal: round2(this.moodArousal) },
      emotion: { ...this.emotion },
      neuromods: Object.fromEntries(Object.entries(this.neuromods).map(([k, v]) => [k, round2(v)])),
      updatedAt: this.updatedAt,
      at: now,
    }
  }

  restore(state) {
    if (!state || typeof state !== 'object') return
    const num = (x, fallback) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback)
    this.valence = clamp(num(state.valence, this.valence), -1, 1)
    this.arousal = clamp(num(state.arousal, this.arousal), 0, 1)
    this.dominance = clamp(num(state.dominance, this.dominance), -1, 1)
    this.moodValence = clamp(num(state.mood?.valence, this.moodValence), -1, 1)
    this.moodArousal = clamp(num(state.mood?.arousal, this.moodArousal), 0, 1)
    for (const key of Object.keys(this.neuromods)) this.neuromods[key] = clamp(num(state.neuromods?.[key], this.neuromods[key]))
    if (state.emotion?.key) this.emotion = { ...this.emotion, ...state.emotion }
    this.updatedAt = num(state.updatedAt, Date.now())
    if (Array.isArray(state.history)) this.history = state.history.slice(-200)
  }

  toJSON() {
    return { ...this.snapshot(), history: this.history }
  }
}

function event_tension(a) {
  return clamp(0.5 * a.novelty + 0.5 * a.urgency + 0.3 * Math.abs(a.congruence))
}

const round2 = (x) => Math.round(x * 100) / 100

export { sigmoid }
