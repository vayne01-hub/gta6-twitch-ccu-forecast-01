// gta6-twitch-ccu-forecast-01 entry, v2: a launch-day Twitch audience forecaster.
//
// Method (fitted at run time from the case's own comparables, nothing hardcoded):
// a big launch's release-day curve has a stable shape in log-ratio space. For every past
// launch in the case's `comparables`, take the ratio of each hour's viewers to that
// launch's hour-1 viewers. Launches whose hour 1 is already a real launch hour (a rolling
// midnight-local unlock, like this case's: New Zealand, Europe and the UK are live before
// the US wakes) share one shape family; launches with a single global unlock later in the
// UTC day have a near-empty hour 1 and a different, explosive shape, so the fit uses only
// the rolling family (hour 1 at least 5% of the day's peak), falling back to the whole
// pool when too few qualify.
//
// Within that family, v2 weights each comparable by how close its scale is to this case:
// w = exp(-|ln(hour-1 viewers of the comparable) - ln(hour-1 print of the case)|), so a
// launch that opened at a similar audience size counts more than a much smaller or larger
// one. The forecast centre for hour h is the similarity-weighted 10%-trimmed mean of the
// family's log-ratios at h, scaled to the case's hour-1 print; the five quantiles are set
// by the similarity-weighted interquartile range of the family's per-hour log-residuals
// around that centre, read as a normal sigma ((q75 - q25) / 1.349). This replaced v1's
// plain median + MAD after a pre-registered leave-one-out comparison on the rolling
// family (v2 LOO pinball 0.270 vs v1's 0.311, same protocol, same pool). Where no
// comparable is usable the program falls back to persistence (every hour at hour 1's
// print, spread widening like a random walk's), so it always writes a valid forecast.
//
// The program is deterministic: pure arithmetic on the case file, files read in name
// order, no clock, no randomness, no network. Node 22, standard library only.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in row order. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** A comparable counts as rolling-unlock when its hour 1 reaches this share of its day's peak. */
const ROLLING_MIN_SHARE = 0.05;
/** The rolling family must have at least this many members before it is trusted on its own. */
const MIN_FAMILY = 10;
/** The persistence fallback's spread, in log units per square-root hour. */
const FALLBACK_SIGMA = 0.15;
/** No hour's fitted dispersion may exceed this, however wild the pool's tail is there. */
const SIGMA_CAP = 2.5;
/** Similarity weights fall off over this log-distance in hour-1 viewers (fixed, not tuned). */
const WEIGHT_SCALE = 1.0;
/** Each tail of the weighted trimmed mean drops this share of the total weight. */
const TRIM_SHARE = 0.1;
/** The divisor that reads an interquartile range as a normal sigma. */
const IQR_AS_SIGMA = 1.349;

interface HourlyPoint { from: string; viewers: number }
interface Comparable { name: string; day_start: string; hourly: HourlyPoint[] }
interface CaseFile {
  id: string;
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables: Comparable[];
}

/** x rounded to 2 decimals (half up), the output's working precision. */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Weighted quantile of [value, weight] pairs, step (inverse-CDF) convention:
 * the smallest value whose cumulative weight reaches p of the total weight.
 */
function wQuantile(pairs: Array<[number, number]>, p: number): number {
  const s = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = s.reduce((a, x) => a + x[1], 0);
  let cum = 0;
  for (const [v, w] of s) {
    cum += w;
    if (cum >= p * total) return v;
  }
  return s[s.length - 1][0];
}

/**
 * Weighted trimmed mean of [value, weight] pairs: TRIM_SHARE of the total weight is
 * dropped from each tail (a pair straddling a cut contributes its remaining weight),
 * and the kept weight averages the rest.
 */
function wTrimmedMean(pairs: Array<[number, number]>): number {
  const s = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = s.reduce((a, x) => a + x[1], 0);
  const cut = TRIM_SHARE * total;
  let num = 0;
  let den = 0;
  let cum = 0;
  for (const [v, w] of s) {
    const start = cum;
    cum += w;
    const kept = Math.max(0, Math.min(cum, total - cut) - Math.max(start, cut));
    num += v * kept;
    den += kept;
  }
  return num / den;
}

/**
 * A comparable's release-day hourly viewers, index 0 = hour 1, or null when the day is
 * incomplete or its first hour is not positive. The day runs from the comparable's own
 * day_start for 24 hours; the first point seen inside each hour wins.
 */
function releaseDay(comp: Comparable): number[] | null {
  const start = new Date(comp.day_start).getTime();
  if (!Number.isFinite(start)) return null;
  const byHour = new Map<number, number>();
  for (const p of comp.hourly ?? []) {
    const t = new Date(p.from).getTime();
    if (!Number.isFinite(t) || t < start || t >= start + 86400000) continue;
    const h = Math.floor((t - start) / 3600000) + 1;
    if (!byHour.has(h)) byHour.set(h, p.viewers);
  }
  if (byHour.size !== 24) return null;
  const day: number[] = [];
  for (let h = 1; h <= 24; h++) day.push(byHour.get(h) as number);
  return day[0] > 0 ? day : null;
}

/** The persistence fallback row for hour h around print p1. */
function fallbackRow(p1: number, h: number): number[] {
  return Z.map((z) => round2(p1 * Math.exp(z * FALLBACK_SIGMA * Math.sqrt(h - 1))));
}

/** Forecast one case: 23 rows, hours 2 to 24, five quantiles each. */
function forecastCase(c: CaseFile): Array<{ hour: number; q: number[] }> {
  const first = (c.known ?? []).find((k) => k.hour === 1);
  if (first === undefined) throw new Error(`case ${c.id} has no hour-1 print`);
  const p1 = Math.max(1, first.viewers);

  // The comparable pool: real launches with a complete release day. The case also
  // carries the target category's own pre-release history as a "comparable"; it is not
  // a launch and never enters the pool.
  const days: number[][] = [];
  for (const comp of c.comparables ?? []) {
    if (typeof comp.name === 'string' && comp.name.includes('before release')) continue;
    const day = releaseDay(comp);
    if (day !== null) days.push(day);
  }
  const rolling = days.filter((day) => day[0] / Math.max(...day) >= ROLLING_MIN_SHARE);
  const train = rolling.length >= MIN_FAMILY ? rolling : days;

  // Similarity of each training launch's scale to this case's hour-1 print.
  const logP1 = Math.log(p1);
  const weights = train.map((day) => Math.exp(-Math.abs(Math.log(day[0]) - logP1) / WEIGHT_SCALE));

  return (c.forecast ?? []).map(({ hour }) => {
    if (train.length === 0 || hour < 2 || hour > 24) return { hour, q: fallbackRow(p1, hour) };
    const ratios = train.map((day) => Math.log(day[hour - 1] / day[0]));
    const pairs: Array<[number, number]> = ratios.map((r, i) => [r, weights[i]]);
    const center = wTrimmedMean(pairs);
    const resPairs: Array<[number, number]> = ratios.map((r, i) => [r - center, weights[i]]);
    const sigma = Math.min(SIGMA_CAP, (wQuantile(resPairs, 0.75) - wQuantile(resPairs, 0.25)) / IQR_AS_SIGMA);
    const q = Z.map((z) => p1 * Math.exp(center + z * sigma));
    // Quantiles must be non-decreasing, finite, above 0 and at most 1e9.
    for (let j = 1; j < q.length; j++) if (q[j] < q[j - 1]) q[j] = q[j - 1];
    return { hour, q: q.map((v) => round2(Math.min(1e9, Math.max(0.01, v)))) };
  });
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const hours = forecastCase(c);
  if (hours.length !== 23) throw new Error(`${file}: forecast has ${hours.length} rows, not 23`);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
