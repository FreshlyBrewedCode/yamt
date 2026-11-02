/** Geometry for the small weight trend chart; each direction draws its own SVG. */
export type Point = { x: number; y: number };

export function movingAverage(values: number[], window = 7): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

export function trend(points: { day: number; kg: number }[], width: number, height: number, pad = 6) {
  const kgs = points.map((p) => p.kg);
  const min = Math.floor(Math.min(...kgs)) - 0.5;
  const max = Math.ceil(Math.max(...kgs)) + 0.5;
  const sx = (day: number) => pad + (day / (points.length - 1)) * (width - pad * 2);
  const sy = (kg: number) => pad + (1 - (kg - min) / (max - min)) * (height - pad * 2);
  const raw: Point[] = points.map((p) => ({ x: sx(p.day), y: sy(p.kg) }));
  const avg = movingAverage(kgs);
  const avgPath = avg
    .map((v, i) => (v === null ? null : `${i === 6 ? "M" : "L"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  const ticks = [min + 0.5, (min + max) / 2, max - 0.5].map((kg) => ({ kg, y: sy(kg) }));
  const last = avg[avg.length - 1] ?? kgs[kgs.length - 1] ?? 0;
  const first = avg[6] ?? kgs[0] ?? 0;
  return { raw, avgPath, ticks, min, max, delta: last - first, lastAvg: last };
}
