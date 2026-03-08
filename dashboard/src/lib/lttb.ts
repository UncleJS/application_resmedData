/**
 * Largest-Triangle-Three-Buckets (LTTB) downsampling algorithm.
 *
 * Reduces an array of {t, ...values} data points to at most `threshold`
 * points while preserving the visual shape of the series. This is far
 * better than uniform thinning — it picks the point in each bucket that
 * forms the largest triangle with its neighbours, guaranteeing the most
 * visually representative sample.
 *
 * Reference: Sveinn Steinarsson, "Downsampling Time Series for Visual
 * Representation" (2013).
 *
 * @param data       Array of objects that have a numeric `t` field.
 * @param threshold  Maximum number of output points. If data.length <=
 *                   threshold the original array is returned unchanged.
 */
export function lttb<T extends { t: number }>(data: T[], threshold: number): T[] {
  const len = data.length;
  if (threshold >= len || threshold <= 2) return data;

  const sampled: T[] = [];
  // Always keep the first point
  sampled.push(data[0]!);

  // Bucket size (float for even distribution)
  const bucketSize = (len - 2) / (threshold - 2);

  let prevSelectedIdx = 0;

  for (let i = 0; i < threshold - 2; i++) {
    // Calculate range of the current bucket
    const bucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const bucketEnd   = Math.min(Math.floor((i + 2) * bucketSize) + 1, len - 1);

    // Calculate the average point in the NEXT bucket (used as the third
    // vertex of the triangle)
    const nextBucketStart = bucketEnd;
    const nextBucketEnd   = Math.min(Math.floor((i + 3) * bucketSize) + 1, len - 1);

    let avgT = 0;
    let avgCount = 0;
    for (let j = nextBucketStart; j < nextBucketEnd; j++) {
      avgT += data[j]!.t;
      avgCount++;
    }
    if (avgCount > 0) avgT /= avgCount;

    // The previously selected point (first vertex)
    const prevT = data[prevSelectedIdx]!.t;

    // Find the point in the current bucket that forms the largest triangle
    let maxArea = -1;
    let maxIdx  = bucketStart;

    for (let j = bucketStart; j < bucketEnd; j++) {
      // Triangle area × 2 (no need to divide, we only compare)
      const area = Math.abs(
        (prevT - avgT) * (data[j]!.t - prevT) -
        (prevT - data[j]!.t) * (avgT - prevT)
      );
      if (area > maxArea) {
        maxArea = area;
        maxIdx  = j;
      }
    }

    sampled.push(data[maxIdx]!);
    prevSelectedIdx = maxIdx;
  }

  // Always keep the last point
  sampled.push(data[len - 1]!);

  return sampled;
}

/**
 * Filter data to the visible domain window, then downsample with LTTB.
 * Adds 1-bucket padding on each side so lines don't abruptly start/end
 * at the chart edge when zoomed.
 */
export function lttbWindow<T extends { t: number }>(
  data: T[],
  domainMin: number,
  domainMax: number,
  threshold: number,
): T[] {
  // Add padding: include one point before/after the window so the line
  // connects smoothly to the chart edges
  let start = 0;
  let end   = data.length;

  for (let i = 0; i < data.length; i++) {
    if (data[i]!.t >= domainMin) {
      start = Math.max(0, i - 1);
      break;
    }
  }
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i]!.t <= domainMax) {
      end = Math.min(data.length, i + 2);
      break;
    }
  }

  const windowed = data.slice(start, end);
  return lttb(windowed, threshold);
}
