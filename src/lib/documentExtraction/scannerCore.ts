/** Camera scans remain local until the operator chooses to upload a finished document. */
export interface ScanPoint { x: number; y: number }
export type ScanQuad = [ScanPoint, ScanPoint, ScanPoint, ScanPoint]; // TL, TR, BR, BL; normalized
export type ScanFilter = "original" | "auto" | "document" | "color" | "gray" | "bw";

export interface ScanQuality {
  brightness: number;
  blur: number;
  glare: number;
  warnings: Array<"low_light" | "blur" | "glare" | "too_far" | "cropped_edge">;
}

export const FULL_SCAN_QUAD: ScanQuad = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
];

function pixel(data: ImageData, x: number, y: number): number {
  const offset = (y * data.width + x) * 4;
  return (data.data[offset] * 0.299 + data.data[offset + 1] * 0.587 + data.data[offset + 2] * 0.114);
}

export function assessScanQuality(image: ImageData): ScanQuality {
  const step = Math.max(1, Math.floor(Math.min(image.width, image.height) / 180));
  let total = 0, samples = 0, glare = 0, edge = 0;
  for (let y = step; y < image.height - step; y += step) {
    for (let x = step; x < image.width - step; x += step) {
      const value = pixel(image, x, y);
      total += value; samples++;
      if (value > 250) glare++;
      edge += Math.abs(value - pixel(image, x + step, y)) + Math.abs(value - pixel(image, x, y + step));
    }
  }
  const brightness = samples ? total / samples : 0;
  const blur = samples ? edge / (2 * samples) : 0;
  const glareRatio = samples ? glare / samples : 0;
  const warnings: ScanQuality["warnings"] = [];
  if (brightness < 65) warnings.push("low_light");
  if (blur < 5) warnings.push("blur");
  if (glareRatio > 0.16) warnings.push("glare");
  return { brightness, blur, glare: glareRatio, warnings };
}

/** Conservative paper detector: refuses low-contrast scenes instead of silently cropping text. */
export function detectDocumentQuad(image: ImageData): { quad: ScanQuad; confidence: number; quality: ScanQuality } {
  const quality = assessScanQuality(image);
  const { width, height } = image;
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 550));
  const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
  const background = corners.map(([x, y]) => pixel(image, x, y)).sort((a, b) => a - b)[2];
  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = step * 2; y < height - step * 2; y += step) {
    for (let x = step * 2; x < width - step * 2; x += step) {
      const value = pixel(image, x, y);
      if (Math.abs(value - background) < 48) continue;
      // A local edge plus a contrast from the corner background avoids most printed text.
      if (Math.abs(value - pixel(image, Math.min(width - 1, x + step * 2), y)) < 10 &&
          Math.abs(value - pixel(image, x, Math.min(height - 1, y + step * 2))) < 10) continue;
      candidates.push({ x: x / width, y: y / height });
    }
  }
  if (candidates.length < 80) return { quad: FULL_SCAN_QUAD, confidence: 0, quality };
  const pick = (score: (point: ScanPoint) => number, low: boolean) =>
    candidates.reduce((best, point) => (low ? score(point) < score(best) : score(point) > score(best)) ? point : best);
  const quad: ScanQuad = [
    pick((p) => p.x + p.y, true), pick((p) => p.x - p.y, false),
    pick((p) => p.x + p.y, false), pick((p) => p.x - p.y, true),
  ];
  const area = Math.abs(quad.reduce((sum, p, index) => {
    const next = quad[(index + 1) % 4];
    return sum + p.x * next.y - next.x * p.y;
  }, 0)) / 2;
  const minX = Math.min(...quad.map((p) => p.x)), maxX = Math.max(...quad.map((p) => p.x));
  const minY = Math.min(...quad.map((p) => p.y)), maxY = Math.max(...quad.map((p) => p.y));
  if (area < 0.20 || area > 0.96 || minX < 0.008 || minY < 0.008 || maxX > 0.992 || maxY > 0.992) {
    quality.warnings.push(area < 0.20 ? "too_far" : "cropped_edge");
    return { quad: FULL_SCAN_QUAD, confidence: 0, quality };
  }
  return { quad, confidence: Math.min(0.8, area), quality };
}

function solve8(matrix: number[][], vector: number[]): number[] {
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    if (Math.abs(matrix[pivot][col]) < 1e-10) throw new Error("SCAN_CORNERS_INVALID");
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    [vector[col], vector[pivot]] = [vector[pivot], vector[col]];
    const divisor = matrix[col][col];
    for (let j = col; j < 8; j++) matrix[col][j] /= divisor;
    vector[col] /= divisor;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = matrix[row][col];
      for (let j = col; j < 8; j++) matrix[row][j] -= factor * matrix[col][j];
      vector[row] -= factor * vector[col];
    }
  }
  return vector;
}

/** Inverse homography maps the output rectangle back to the original image. */
function homography(quad: ScanQuad, width: number, height: number): number[] {
  const source = quad.map((p) => ({ x: p.x * (width - 1), y: p.y * (height - 1) }));
  const target: ScanPoint[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const matrix: number[][] = [], values: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = target[i], { x: u, y: v } = source[i];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); values.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]); values.push(v);
  }
  return solve8(matrix, values);
}

export function perspectiveCorrect(image: ImageData, quad: ScanQuad, filter: ScanFilter, maxSide = 2400): ImageData {
  const distance = (a: ScanPoint, b: ScanPoint) => Math.hypot((a.x - b.x) * image.width, (a.y - b.y) * image.height);
  const rawWidth = Math.max(distance(quad[0], quad[1]), distance(quad[3], quad[2]));
  const rawHeight = Math.max(distance(quad[0], quad[3]), distance(quad[1], quad[2]));
  if (rawWidth < 100 || rawHeight < 100) throw new Error("SCAN_CORNERS_INVALID");
  const scale = Math.min(1, maxSide / Math.max(rawWidth, rawHeight)); // never invent pixels
  const outWidth = Math.max(1, Math.round(rawWidth * scale)), outHeight = Math.max(1, Math.round(rawHeight * scale));
  const output = new ImageData(outWidth, outHeight);
  const h = homography(quad, image.width, image.height);
  const source = image.data, result = output.data;
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    const nx = outWidth === 1 ? 0 : x / (outWidth - 1), ny = outHeight === 1 ? 0 : y / (outHeight - 1);
    const divisor = h[6] * nx + h[7] * ny + 1;
    const sx = (h[0] * nx + h[1] * ny + h[2]) / divisor;
    const sy = (h[3] * nx + h[4] * ny + h[5]) / divisor;
    const dest = (y * outWidth + x) * 4;
    if (sx < 0 || sy < 0 || sx >= image.width - 1 || sy >= image.height - 1) {
      result[dest] = result[dest + 1] = result[dest + 2] = result[dest + 3] = 255;
      continue;
    }
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
    const a = (iy * image.width + ix) * 4, b = a + 4, c = a + image.width * 4, d = c + 4;
    for (let channel = 0; channel < 3; channel++) {
      let value = source[a + channel] * (1 - fx) * (1 - fy) + source[b + channel] * fx * (1 - fy) +
        source[c + channel] * (1 - fx) * fy + source[d + channel] * fx * fy;
      if (filter === "gray" || filter === "bw") {
        const luminance = source[a] * 0.299 + source[a + 1] * 0.587 + source[a + 2] * 0.114;
        value = filter === "bw" ? (luminance >= 150 ? 255 : 0) : luminance;
      } else if (filter === "auto" || filter === "document") value = Math.min(255, Math.max(0, (value - 128) * (filter === "document" ? 1.16 : 1.06) + 132));
      else if (filter === "color") value = Math.min(255, Math.max(0, (value - 128) * 1.12 + 128));
      result[dest + channel] = value;
    }
    result[dest + 3] = 255;
  }
  return output;
}
