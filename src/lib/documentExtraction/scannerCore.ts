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

function quadArea(quad: ScanQuad): number {
  return Math.abs(quad.reduce((sum, point, index) => {
    const next = quad[(index + 1) % 4];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

export function isValidScanQuad(quad: ScanQuad): boolean {
  if (quad.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
    point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) || quadArea(quad) < 0.01) return false;
  const turns = quad.map((point, index) => {
    const next = quad[(index + 1) % 4], after = quad[(index + 2) % 4];
    return (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
  });
  return turns.every((turn) => turn > 0.002);
}

interface EdgeSample { position: number; boundary: number }

function fitEdge(samples: EdgeSample[]): { slope: number; offset: number; error: number } | null {
  if (samples.length < 12) return null;
  // Near each corner a horizontal/vertical scan meets the adjacent edge first.
  // Fit only the middle of a side, then extend that line to its intersections.
  const inner = samples.slice(Math.floor(samples.length * .18), Math.ceil(samples.length * .82));
  const solve = (points: EdgeSample[]) => {
    const meanPosition = points.reduce((sum, sample) => sum + sample.position, 0) / points.length;
    const meanBoundary = points.reduce((sum, sample) => sum + sample.boundary, 0) / points.length;
    let numerator = 0, denominator = 0;
    for (const sample of points) {
      numerator += (sample.position - meanPosition) * (sample.boundary - meanBoundary);
      denominator += (sample.position - meanPosition) ** 2;
    }
    if (denominator < 0.001) return null;
    const slope = numerator / denominator, offset = meanBoundary - slope * meanPosition;
    const error = points.reduce((sum, sample) => sum + Math.abs(sample.boundary - slope * sample.position - offset), 0) / points.length;
    return { slope, offset, error };
  };
  const initial = solve(inner);
  if (!initial) return null;
  const residuals = inner.map((sample) => Math.abs(sample.boundary - initial.slope * sample.position - initial.offset));
  const median = [...residuals].sort((a, b) => a - b)[Math.floor(residuals.length / 2)];
  const inliers = inner.filter((_, index) => residuals[index] <= Math.max(.015, median * 3));
  return inliers.length >= 12 ? solve(inliers) : initial;
}

/** Find the longest contrasting run, bridging small printed-text gaps inside paper. */
function longestRun(length: number, at: (index: number) => boolean, maxGap: number): [number, number] | null {
  let start = -1, end = -1, gap = 0, bestStart = -1, bestEnd = -1;
  for (let index = 0; index <= length; index++) {
    if (index < length && at(index)) {
      if (start < 0) start = index;
      end = index; gap = 0;
    } else if (start >= 0 && index < length && gap < maxGap) gap++;
    else if (start >= 0) {
      if (end - start > bestEnd - bestStart) { bestStart = start; bestEnd = end; }
      start = -1; end = -1; gap = 0;
    }
  }
  return bestStart >= 0 ? [bestStart, bestEnd] : null;
}

/** Conservative paper segmentation; uncertain scenes retain the entire photo for manual corners. */
export function detectDocumentQuad(image: ImageData): { quad: ScanQuad; confidence: number; quality: ScanQuality } {
  const quality = assessScanQuality(image);
  const step = Math.max(1, Math.ceil(Math.max(image.width, image.height) / 550));
  const width = Math.ceil(image.width / step), height = Math.ceil(image.height / step);
  const fallback = () => ({ quad: FULL_SCAN_QUAD, confidence: 0, quality });
  if (width < 40 || height < 40) return fallback();

  // Sample patches at all four corners, not single noisy pixels. A sheet touching
  // the image border is rejected below rather than cropped on a guessed edge.
  const borderColors: number[][] = [[], [], []];
  for (const xSide of [0, 1]) for (const ySide of [0, 1]) {
    for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) {
      const x = Math.min(image.width - 1, Math.round((xSide ? .96 : .04) * image.width) + dx * step);
      const y = Math.min(image.height - 1, Math.round((ySide ? .96 : .04) * image.height) + dy * step);
      const offset = (y * image.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) borderColors[channel].push(image.data[offset + channel]);
    }
  }
  const background = borderColors.map((channel) => channel.sort((a, b) => a - b)[Math.floor(channel.length / 2)]);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (Math.min(image.height - 1, y * step) * image.width + Math.min(image.width - 1, x * step)) * 4;
    const difference = (Math.abs(image.data[source] - background[0]) +
      Math.abs(image.data[source + 1] - background[1]) + Math.abs(image.data[source + 2] - background[2])) / 3;
    mask[y * width + x] = difference >= 38 ? 1 : 0;
  }

  const left: EdgeSample[] = [], right: EdgeSample[] = [], top: EdgeSample[] = [], bottom: EdgeSample[] = [];
  const rowGap = Math.max(2, Math.round(width * .05));
  const columnGap = Math.max(2, Math.round(height * .05));
  for (let y = 0; y < height; y++) {
    const run = longestRun(width, (x) => mask[y * width + x] === 1, rowGap);
    if (!run || run[1] - run[0] < width * .15 || run[0] <= 1 || run[1] >= width - 2) continue;
    left.push({ position: y / (height - 1), boundary: run[0] / (width - 1) });
    right.push({ position: y / (height - 1), boundary: run[1] / (width - 1) });
  }
  for (let x = 0; x < width; x++) {
    const run = longestRun(height, (y) => mask[y * width + x] === 1, columnGap);
    if (!run || run[1] - run[0] < height * .15 || run[0] <= 1 || run[1] >= height - 2) continue;
    top.push({ position: x / (width - 1), boundary: run[0] / (height - 1) });
    bottom.push({ position: x / (width - 1), boundary: run[1] / (height - 1) });
  }
  const leftLine = fitEdge(left), rightLine = fitEdge(right), topLine = fitEdge(top), bottomLine = fitEdge(bottom);
  if (!leftLine || !rightLine || !topLine || !bottomLine) return fallback();
  const intersect = (vertical: typeof leftLine, horizontal: typeof topLine): ScanPoint => {
    const divisor = 1 - vertical.slope * horizontal.slope;
    if (Math.abs(divisor) < .01) return { x: NaN, y: NaN };
    const x = (vertical.slope * horizontal.offset + vertical.offset) / divisor;
    return { x, y: horizontal.slope * x + horizontal.offset };
  };
  const quad: ScanQuad = [intersect(leftLine, topLine), intersect(rightLine, topLine),
    intersect(rightLine, bottomLine), intersect(leftLine, bottomLine)];
  const area = quadArea(quad);
  const meanError = (leftLine.error + rightLine.error + topLine.error + bottomLine.error) / 4;
  // Text on a similarly coloured desk can form four apparent boundaries; a
  // real contrasting page also fills most of the proposed quadrilateral.
  let inside = 0, filled = 0;
  for (let row = 1; row <= 9; row++) for (let column = 1; column <= 9; column++) {
    const u = column / 10, v = row / 10;
    const x = Math.round(((1 - u) * (1 - v) * quad[0].x + u * (1 - v) * quad[1].x +
      u * v * quad[2].x + (1 - u) * v * quad[3].x) * (width - 1));
    const y = Math.round(((1 - u) * (1 - v) * quad[0].y + u * (1 - v) * quad[1].y +
      u * v * quad[2].y + (1 - u) * v * quad[3].y) * (height - 1));
    if (x >= 0 && x < width && y >= 0 && y < height) { inside++; filled += mask[y * width + x]; }
  }
  if (!isValidScanQuad(quad) || area < .12 || area > .94 || meanError > .045 ||
    inside < 60 || filled / inside < .65 ||
    quad.some((point) => point.x < .015 || point.x > .985 || point.y < .015 || point.y > .985)) {
    quality.warnings.push(area < .12 ? "too_far" : "cropped_edge");
    return fallback();
  }
  return { quad, confidence: Math.max(.36, Math.min(.95, .92 - meanError * 9)), quality };
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
  if (!isValidScanQuad(quad)) throw new Error("SCAN_CORNERS_INVALID");
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
