import { CandleRow, EnrichedCandle, calculateIndicators } from './quant.ts';

export type SignalClass = 'BUY' | 'SELL' | 'HOLD';
export type TargetLabelMode = 'trend_regime' | 'raw_return';

export const CLASS_LABELS: SignalClass[] = ['BUY', 'HOLD', 'SELL'];

/**
 * Scale-invariant causal feature vector (raw Open/High/Low/Close & point-level ATR removed
 * to prevent non-stationary price-level overfitting).
 */
export const FEATURE_NAMES = [
  'rsi',
  'macd',
  'macdSignal',
  'macdHist',
  'return1',
  'return3',
  'ema9Ema21SpreadPct',
  'vwapDistance',
  'atrNormRange',
  'adx',
  'htfEma20Slope',
  'htfRsi14',
  'relVolume',
  'timeSin',
  'timeCos',
  'mtfConfluenceScore',
  'rsiMomentumSlope',
  'macdHistAccel',
] as const;

export type FeatureKey = (typeof FEATURE_NAMES)[number];

interface TreeNode {
  leaf: boolean;
  probs?: number[]; // 3-class [BUY, HOLD, SELL] for Stage 1, or 2-class [FAIL, PASS] for Stage 2
  featureIdx?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
}

export interface RandomForestArtifact {
  algorithm: string;
  targetMode: TargetLabelMode;
  labelingMode: string;
  minConfidenceThreshold: number;
  minAdxGate: number;
  featureNames: string[];
  nEstimators: number;
  maxDepth: number;
  minSamplesSplit: number;
  trees: TreeNode[];
  metaTrees?: TreeNode[];
  featureImportance: Array<{ feature: string; importance: number }>;
}

export interface HighConvictionMetrics {
  minConfidenceThreshold: number;
  minAdxGate: number;
  totalTestBars: number;
  directionalSignals: number;
  directionalHits: number;
  buySignals: number;
  buyHits: number;
  sellSignals: number;
  sellHits: number;
  precision: number;
  buyPrecision: number;
  sellPrecision: number;
  tradeCoveragePct: number;
  avgDirectionalConfidence: number;
  avgMetaProbability: number;
}

export interface WalkForwardFold {
  fold: number;
  trainRange: string;
  testRange: string;
  trainSize: number;
  testSize: number;
  overallAccuracy: number;
  balancedAccuracy: number;
  highConvictionPrecision: number;
  tradeCoveragePct: number;
  directionalSignals: number;
  directionalHits: number;
}

export interface WalkForwardEvaluation {
  enabled: boolean;
  foldCount: number;
  folds: WalkForwardFold[];
  meanOverallAccuracy: number;
  meanHighConvictionPrecision: number;
  meanTradeCoveragePct: number;
  totalDirectionalSignals: number;
  totalDirectionalHits: number;
}

export interface TrainingEvaluation {
  datasetSize: number;
  usableSamples: number;
  trainSize: number;
  valSize: number;
  testSize: number;
  dateRange: string;
  targetMode: TargetLabelMode;
  labelingMode: string;
  minConfidenceThreshold: number;
  minAdxGate: number;
  accuracy: number;
  balancedAccuracy: number;
  precisionMacro: number;
  recallMacro: number;
  f1Macro: number;
  highConviction: HighConvictionMetrics;
  walkForward: WalkForwardEvaluation | null;
  confusionMatrix: number[][]; // rows = actual [BUY, HOLD, SELL], cols = predicted [BUY, HOLD, SELL]
  classDistribution: { BUY: number; HOLD: number; SELL: number };
  featureImportance: Array<{ feature: string; importance: number }>;
  predictionHistory: Array<{
    timestamp: number;
    date_str: string;
    time_str: string;
    close: number;
    actual: SignalClass;
    predicted: SignalClass;
    rawPredicted: SignalClass;
    thresholdGated: boolean;
    confidence: number;
    metaProbability: number;
    adx: number | null;
    futureReturnPct: number;
  }>;
  artifact: RandomForestArtifact;
}

export function normalizeTargetMode(raw?: string | null): TargetLabelMode {
  return raw === 'raw_return' ? 'raw_return' : 'trend_regime';
}

export function getLabelingModeDescription(mode: TargetLabelMode): string {
  return mode === 'raw_return'
    ? 'Raw 3-Candle Return (±0.45×ATR(14) Forward Close)'
    : 'Trend-Continuation Regime (±0.35×ATR(14) 3-Bar EMA(5) & ADX(14)>20)';
}

export function clampConfidenceThreshold(val?: number): number {
  if (val === undefined || Number.isNaN(val)) return 0.72;
  const normalized = val > 1 ? val / 100 : val;
  return Number(Math.min(0.92, Math.max(0.5, normalized)).toFixed(2));
}

/**
 * Extracts scale-invariant causal feature vector from candle t.
 * Also safely maps legacy artifacts if an old model row has not yet been retrained.
 */
export function extractFeatureVector(c: EnrichedCandle, artifactFeatureNames?: string[]): number[] | null {
  if (artifactFeatureNames && artifactFeatureNames.includes('open')) {
    // Legacy compatibility mapping for pre-upgrade models prior to user retrain
    if (
      c.rsi === null ||
      c.macd === null ||
      c.macdSignal === null ||
      c.macdHist === null ||
      c.return1 === null ||
      c.volatility === null ||
      c.vwapDistance === null ||
      c.atr === null ||
      c.atrNormRange === null ||
      c.adx === null ||
      c.htfEma20Slope === null ||
      c.htfRsi14 === null
    ) {
      return null;
    }
    return [
      c.open,
      c.high,
      c.low,
      c.close,
      c.rsi,
      c.macd,
      c.macdSignal,
      c.macdHist,
      c.return1,
      c.volatility,
      c.candleBody,
      c.candleRange,
      c.relVolume ?? 1.0,
      c.vwapDistance,
      c.atr,
      c.atrNormRange,
      c.adx,
      c.htfEma20Slope,
      c.htfRsi14,
      c.timeSin,
      c.timeCos,
    ];
  }

  if (
    c.rsi === null ||
    c.macd === null ||
    c.macdSignal === null ||
    c.macdHist === null ||
    c.return1 === null ||
    c.return3 === null ||
    c.ema9Ema21SpreadPct === null ||
    c.vwapDistance === null ||
    c.atrNormRange === null ||
    c.adx === null ||
    c.htfEma20Slope === null ||
    c.htfRsi14 === null ||
    c.mtfConfluenceScore === null ||
    c.rsiMomentumSlope === null ||
    c.macdHistAccel === null
  ) {
    return null;
  }

  return [
    c.rsi,
    c.macd,
    c.macdSignal,
    c.macdHist,
    c.return1,
    c.return3,
    c.ema9Ema21SpreadPct,
    c.vwapDistance,
    c.atrNormRange,
    c.adx,
    c.htfEma20Slope,
    c.htfRsi14,
    c.relVolume ?? 1.0,
    c.timeSin,
    c.timeCos,
    c.mtfConfluenceScore,
    c.rsiMomentumSlope,
    c.macdHistAccel,
  ];
}

function giniImpurityGeneric(counts: number[]): number {
  let total = 0;
  for (let i = 0; i < counts.length; i++) total += counts[i];
  if (total <= 0) return 0;
  let sumSq = 0;
  for (let c = 0; c < counts.length; c++) {
    const p = counts[c] / total;
    sumSq += p * p;
  }
  return 1 - sumSq;
}

function buildTreeGeneric(
  X: number[][],
  y: number[],
  weights: number[],
  indices: number[],
  numClasses: number,
  depth: number,
  maxDepth: number,
  minSamplesSplit: number,
  maxFeatures: number,
  importanceAccum: number[] | null,
  rng: () => number,
  useEmpiricalLeafProbs = false
): TreeNode {
  const counts = new Array(numClasses).fill(0);
  const empCounts = new Array(numClasses).fill(0);
  for (const idx of indices) {
    counts[y[idx]] += weights[idx];
    empCounts[y[idx]] += 1;
  }
  const totalW = counts.reduce((a, b) => a + b, 0);
  const empTotal = indices.length;

  let probs: number[];
  if (useEmpiricalLeafProbs) {
    // Laplace-smoothed empirical hit probability for calibrated Stage-2 meta scoring
    probs = empCounts.map((c) => (c + 0.5) / (empTotal + 0.5 * numClasses));
  } else {
    probs =
      totalW > 0
        ? counts.map((c) => c / totalW)
        : new Array(numClasses).fill(1 / numClasses);
  }

  const nonZeroClasses = counts.filter((c) => c > 0).length;
  if (depth >= maxDepth || indices.length < minSamplesSplit || nonZeroClasses <= 1) {
    return { leaf: true, probs };
  }

  const numFeatures = X[0].length;
  const candidateFeatures: number[] = [];
  const pool = Array.from({ length: numFeatures }, (_, i) => i);
  for (let k = 0; k < Math.min(maxFeatures, numFeatures); k++) {
    const pick = Math.floor(rng() * pool.length);
    candidateFeatures.push(pool[pick]);
    pool.splice(pick, 1);
  }

  const parentImpurity = giniImpurityGeneric(counts);
  let bestGain = 0;
  let bestFeature = -1;
  let bestThreshold = 0;
  let bestLeft: number[] = [];
  let bestRight: number[] = [];

  for (const fIdx of candidateFeatures) {
    const vals = indices.map((idx) => X[idx][fIdx]).sort((a, b) => a - b);
    const minV = vals[0];
    const maxV = vals[vals.length - 1];
    if (maxV - minV < 1e-9) continue;

    const numBins = Math.min(14, vals.length - 1);
    const seenThresh = new Set<number>();

    for (let b = 1; b <= numBins; b++) {
      const qIdx = Math.floor((b * vals.length) / (numBins + 1));
      const thresh = vals[qIdx];
      if (seenThresh.has(thresh)) continue;
      seenThresh.add(thresh);

      const leftCounts = new Array(numClasses).fill(0);
      const rightCounts = new Array(numClasses).fill(0);
      const leftIdx: number[] = [];
      const rightIdx: number[] = [];

      for (const idx of indices) {
        if (X[idx][fIdx] <= thresh) {
          leftCounts[y[idx]] += weights[idx];
          leftIdx.push(idx);
        } else {
          rightCounts[y[idx]] += weights[idx];
          rightIdx.push(idx);
        }
      }

      if (leftIdx.length < 2 || rightIdx.length < 2) continue;

      const leftW = leftCounts.reduce((a, b) => a + b, 0);
      const rightW = rightCounts.reduce((a, b) => a + b, 0);
      const weightedImpurity =
        (leftW / totalW) * giniImpurityGeneric(leftCounts) +
        (rightW / totalW) * giniImpurityGeneric(rightCounts);

      const gain = parentImpurity - weightedImpurity;
      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = fIdx;
        bestThreshold = thresh;
        bestLeft = leftIdx;
        bestRight = rightIdx;
      }
    }
  }

  if (bestFeature === -1 || bestGain <= 1e-7) {
    return { leaf: true, probs };
  }

  if (importanceAccum) {
    importanceAccum[bestFeature] += bestGain * totalW;
  }

  return {
    leaf: false,
    featureIdx: bestFeature,
    threshold: bestThreshold,
    left: buildTreeGeneric(
      X,
      y,
      weights,
      bestLeft,
      numClasses,
      depth + 1,
      maxDepth,
      minSamplesSplit,
      maxFeatures,
      importanceAccum,
      rng,
      useEmpiricalLeafProbs
    ),
    right: buildTreeGeneric(
      X,
      y,
      weights,
      bestRight,
      numClasses,
      depth + 1,
      maxDepth,
      minSamplesSplit,
      maxFeatures,
      importanceAccum,
      rng,
      useEmpiricalLeafProbs
    ),
  };
}

function predictTreeProbsGeneric(node: TreeNode, x: number[], numClasses: number): number[] {
  if (node.leaf || node.featureIdx === undefined || node.threshold === undefined) {
    return node.probs ?? new Array(numClasses).fill(1 / numClasses);
  }
  if (x[node.featureIdx] <= node.threshold) {
    return node.left ? predictTreeProbsGeneric(node.left, x, numClasses) : new Array(numClasses).fill(1 / numClasses);
  }
  return node.right ? predictTreeProbsGeneric(node.right, x, numClasses) : new Array(numClasses).fill(1 / numClasses);
}

function scoreStage1Raw(trees: TreeNode[], x: number[]): [number, number, number] {
  const avg: [number, number, number] = [0, 0, 0];
  const nTrees = trees.length || 1;
  for (const tree of trees) {
    const p = predictTreeProbsGeneric(tree, x, 3);
    avg[0] += p[0] / nTrees;
    avg[1] += p[1] / nTrees;
    avg[2] += p[2] / nTrees;
  }
  return avg;
}

function scoreStage2Meta(metaTrees: TreeNode[], metaX: number[]): number {
  let passProbSum = 0;
  const nTrees = metaTrees.length || 1;
  for (const tree of metaTrees) {
    const p = predictTreeProbsGeneric(tree, metaX, 2);
    passProbSum += (p[1] ?? 0.5) / nTrees;
  }
  return passProbSum;
}

export function predictWithForest(
  artifact: RandomForestArtifact,
  x: number[],
  minConfidenceOrOpts?: number | { minConfidenceOverride?: number; adx?: number | null }
): {
  signal: SignalClass;
  rawSignal: SignalClass;
  thresholdGated: boolean;
  adxGated: boolean;
  minConfidenceThreshold: number;
  probabilities: Record<SignalClass, number>;
  confidence: number;
  stage1Confidence: number;
  metaProbability: number;
} {
  const minConfOverride =
    typeof minConfidenceOrOpts === 'number'
      ? minConfidenceOrOpts
      : minConfidenceOrOpts?.minConfidenceOverride;
  const adxIdx = artifact.featureNames.indexOf('adx');
  const adxValue =
    typeof minConfidenceOrOpts === 'object' && minConfidenceOrOpts?.adx !== undefined
      ? minConfidenceOrOpts.adx
      : adxIdx >= 0 && x[adxIdx] !== undefined
      ? x[adxIdx]
      : null;

  const avg = scoreStage1Raw(artifact.trees, x);
  let bestClassIdx = 1; // HOLD default on tie
  let maxStage1Prob = -1;
  for (let c = 0; c < 3; c++) {
    if (avg[c] > maxStage1Prob) {
      maxStage1Prob = avg[c];
      bestClassIdx = c;
    }
  }

  const threshold = clampConfidenceThreshold(minConfOverride ?? artifact.minConfidenceThreshold);
  const minAdxGate = artifact.minAdxGate ?? 20;
  const rawSignal = CLASS_LABELS[bestClassIdx];
  const isDirectional = bestClassIdx === 0 || bestClassIdx === 2;

  let metaProb = maxStage1Prob;
  if (isDirectional && artifact.metaTrees && artifact.metaTrees.length > 0) {
    const dirSign = bestClassIdx === 0 ? 1 : -1;
    const dirGap = Math.abs(avg[0] - avg[2]);
    const metaX = [...x, avg[0], avg[1], avg[2], dirSign, dirGap];
    metaProb = scoreStage2Meta(artifact.metaTrees, metaX);
  }

  const effectiveProb = isDirectional ? metaProb : avg[1];
  const adxPassed = adxValue === null ? true : adxValue >= minAdxGate;
  const passesConfidence = isDirectional && effectiveProb >= threshold;
  const signal: SignalClass = passesConfidence && adxPassed ? rawSignal : 'HOLD';
  const thresholdGated = isDirectional && !(passesConfidence && adxPassed);
  const adxGated = isDirectional && passesConfidence && !adxPassed;

  return {
    signal,
    rawSignal,
    thresholdGated,
    adxGated,
    minConfidenceThreshold: threshold,
    probabilities: {
      BUY: Number((avg[0] * 100).toFixed(2)),
      HOLD: Number((avg[1] * 100).toFixed(2)),
      SELL: Number((avg[2] * 100).toFixed(2)),
    },
    confidence: Number((effectiveProb * 100).toFixed(2)),
    stage1Confidence: Number((maxStage1Prob * 100).toFixed(2)),
    metaProbability: Number((metaProb * 100).toFixed(2)),
  };
}

function mulberry32(seed: number) {
  let t = seed;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

interface SampleRow {
  x: number[];
  y: number; // 0=BUY, 1=HOLD, 2=SELL
  candle: EnrichedCandle;
  futureReturnPct: number;
}

function fitStage1Ensemble(
  trainSamples: SampleRow[],
  params: {
    nEstimators: number;
    maxDepth: number;
    minSamplesSplit: number;
    seed: number;
  }
): { trees: TreeNode[]; featureImportance: Array<{ feature: string; importance: number }> } {
  const XTrain = trainSamples.map((s) => s.x);
  const yTrain = trainSamples.map((s) => s.y);
  const nTrain = yTrain.length;
  const numFeatures = FEATURE_NAMES.length;
  const maxFeatures = Math.max(2, Math.floor(Math.sqrt(numFeatures)));
  const importanceAccum = new Array(numFeatures).fill(0);
  const rng = mulberry32(params.seed);

  const trees: TreeNode[] = [];
  for (let t = 0; t < params.nEstimators; t++) {
    const bootIndices: number[] = [];
    const bootCounts: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < nTrain; i++) {
      const idx = Math.floor(rng() * nTrain);
      bootIndices.push(idx);
      bootCounts[yTrain[idx]]++;
    }

    const activeClassCount = bootCounts.filter((cnt) => cnt > 0).length || 1;
    const bootClassWeights: [number, number, number] = [
      bootCounts[0] > 0 ? nTrain / (activeClassCount * bootCounts[0]) : 1,
      bootCounts[1] > 0 ? nTrain / (activeClassCount * bootCounts[1]) : 1,
      bootCounts[2] > 0 ? nTrain / (activeClassCount * bootCounts[2]) : 1,
    ];
    const sampleWeights = yTrain.map((label) => bootClassWeights[label]);

    trees.push(
      buildTreeGeneric(
        XTrain,
        yTrain,
        sampleWeights,
        bootIndices,
        3,
        0,
        params.maxDepth,
        params.minSamplesSplit,
        maxFeatures,
        importanceAccum,
        rng,
        false
      )
    );
  }

  const totalImp = importanceAccum.reduce((a, b) => a + b, 0) || 1;
  const featureImportance = FEATURE_NAMES.map((name, idx) => ({
    feature: name,
    importance: Number(((importanceAccum[idx] / totalImp) * 100).toFixed(2)),
  })).sort((a, b) => b.importance - a.importance);

  return { trees, featureImportance };
}

function fitTwoStageMetaForest(
  trainSamples: SampleRow[],
  params: {
    nEstimators: number;
    maxDepth: number;
    minSamplesSplit: number;
    minConfidenceThreshold: number;
    targetMode: TargetLabelMode;
    seed: number;
  }
): RandomForestArtifact {
  // Stage 1: Full Primary 3-Class Random Forest on trainSamples
  const stage1 = fitStage1Ensemble(trainSamples, {
    nEstimators: params.nEstimators,
    maxDepth: params.maxDepth,
    minSamplesSplit: params.minSamplesSplit,
    seed: params.seed,
  });

  // Stage 2 Meta-Labeling: Generate 3-fold chronological out-of-fold Stage 1 predictions
  // strictly inside trainSamples to avoid in-sample overfitting or future leakage into val/test.
  const nTrain = trainSamples.length;
  const metaXRows: number[][] = [];
  const metaYRows: number[] = [];

  if (nTrain >= 90) {
    const oofSplits = 3;
    const chunk = Math.floor(nTrain / oofSplits);
    for (let fold = 0; fold < oofSplits; fold++) {
      const valStart = fold * chunk;
      const valEnd = fold === oofSplits - 1 ? nTrain : (fold + 1) * chunk;
      const foldTrain = [...trainSamples.slice(0, valStart), ...trainSamples.slice(valEnd)];
      const foldVal = trainSamples.slice(valStart, valEnd);
      if (foldTrain.length < 40 || foldVal.length === 0) continue;

      const foldStage1 = fitStage1Ensemble(foldTrain, {
        nEstimators: Math.max(12, Math.floor(params.nEstimators * 0.6)),
        maxDepth: params.maxDepth,
        minSamplesSplit: params.minSamplesSplit,
        seed: params.seed + (fold + 1) * 31,
      });

      for (const sample of foldVal) {
        const avg = scoreStage1Raw(foldStage1.trees, sample.x);
        const bestIdx = avg[0] >= avg[1] && avg[0] >= avg[2] ? 0 : avg[2] >= avg[1] ? 2 : 1;
        // Include directional predictions (or dominant directional candidates) for Stage 2 binary meta-labeling
        if (bestIdx === 0 || bestIdx === 2) {
          const dirSign = bestIdx === 0 ? 1 : -1;
          const dirGap = Math.abs(avg[0] - avg[2]);
          metaXRows.push([...sample.x, avg[0], avg[1], avg[2], dirSign, dirGap]);
          metaYRows.push(bestIdx === sample.y ? 1 : 0);
        }
      }
    }
  }

  const metaTrees: TreeNode[] = [];
  const hasPos = metaYRows.some((v) => v === 1);
  const hasNeg = metaYRows.some((v) => v === 0);

  if (metaXRows.length >= 20 && hasPos && hasNeg) {
    const nMeta = metaXRows.length;
    const metaFeatures = metaXRows[0].length;
    const metaMaxFeatures = Math.max(2, Math.floor(Math.sqrt(metaFeatures)));
    const metaEstimators = Math.max(15, Math.round(params.nEstimators * 0.65));
    const metaDepth = Math.min(5, Math.max(3, params.maxDepth - 1));
    const metaRng = mulberry32(params.seed + 997);

    for (let t = 0; t < metaEstimators; t++) {
      const bootIdx: number[] = [];
      const bootCounts = [0, 0];
      for (let i = 0; i < nMeta; i++) {
        const idx = Math.floor(metaRng() * nMeta);
        bootIdx.push(idx);
        bootCounts[metaYRows[idx]]++;
      }
      const activeCnt = bootCounts.filter((c) => c > 0).length || 1;
      const w0 = bootCounts[0] > 0 ? nMeta / (activeCnt * bootCounts[0]) : 1;
      const w1 = bootCounts[1] > 0 ? nMeta / (activeCnt * bootCounts[1]) : 1;
      const metaWeights = metaYRows.map((lbl) => (lbl === 1 ? w1 : w0));

      metaTrees.push(
        buildTreeGeneric(
          metaXRows,
          metaYRows,
          metaWeights,
          bootIdx,
          2,
          0,
          metaDepth,
          Math.max(4, Math.floor(params.minSamplesSplit * 0.75)),
          metaMaxFeatures,
          null,
          metaRng,
          true
        )
      );
    }
  }

  return {
    algorithm: 'Two-Stage Meta-Labeled Random Forest (Scale-Invariant Trend-State Ensemble)',
    targetMode: params.targetMode,
    labelingMode: getLabelingModeDescription(params.targetMode),
    minConfidenceThreshold: params.minConfidenceThreshold,
    minAdxGate: 20,
    featureNames: [...FEATURE_NAMES],
    nEstimators: params.nEstimators,
    maxDepth: params.maxDepth,
    minSamplesSplit: params.minSamplesSplit,
    trees: stage1.trees,
    metaTrees,
    featureImportance: stage1.featureImportance,
  };
}

function evaluateOnSamples(
  artifact: RandomForestArtifact,
  testSamples: SampleRow[],
  minConfidenceThreshold: number
) {
  const confusionMatrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const predictionHistory: TrainingEvaluation['predictionHistory'] = [];
  let correct = 0;

  let directionalSignals = 0;
  let directionalHits = 0;
  let buySignals = 0;
  let buyHits = 0;
  let sellSignals = 0;
  let sellHits = 0;
  let dirConfidenceSum = 0;
  let metaProbSum = 0;

  for (const sample of testSamples) {
    const pred = predictWithForest(artifact, sample.x, {
      minConfidenceOverride: minConfidenceThreshold,
      adx: sample.candle.adx,
    });
    const predIdx = CLASS_LABELS.indexOf(pred.signal);
    const actualLabel = CLASS_LABELS[sample.y];
    confusionMatrix[sample.y][predIdx]++;
    if (predIdx === sample.y) correct++;

    if (pred.signal === 'BUY' || pred.signal === 'SELL') {
      directionalSignals++;
      dirConfidenceSum += pred.confidence;
      metaProbSum += pred.metaProbability;
      if (pred.signal === actualLabel) directionalHits++;

      if (pred.signal === 'BUY') {
        buySignals++;
        if (actualLabel === 'BUY') buyHits++;
      } else {
        sellSignals++;
        if (actualLabel === 'SELL') sellHits++;
      }
    }

    predictionHistory.push({
      timestamp: sample.candle.timestamp,
      date_str: sample.candle.date_str,
      time_str: sample.candle.time_str,
      close: sample.candle.close,
      actual: actualLabel,
      predicted: pred.signal,
      rawPredicted: pred.rawSignal,
      thresholdGated: pred.thresholdGated,
      confidence: pred.confidence,
      metaProbability: pred.metaProbability,
      adx: sample.candle.adx,
      futureReturnPct: sample.futureReturnPct,
    });
  }

  const nTest = testSamples.length || 1;
  const accuracy = (correct / nTest) * 100;

  let precisionSum = 0;
  let recallSum = 0;
  let f1Sum = 0;
  let activeClasses = 0;

  for (let c = 0; c < 3; c++) {
    const tp = confusionMatrix[c][c];
    const actualTotal = confusionMatrix[c][0] + confusionMatrix[c][1] + confusionMatrix[c][2];
    const predTotal = confusionMatrix[0][c] + confusionMatrix[1][c] + confusionMatrix[2][c];
    if (actualTotal > 0 || predTotal > 0) {
      activeClasses++;
      const prec = predTotal > 0 ? tp / predTotal : 0;
      const rec = actualTotal > 0 ? tp / actualTotal : 0;
      const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;
      precisionSum += prec;
      recallSum += rec;
      f1Sum += f1;
    }
  }

  const denom = activeClasses || 1;
  const precisionMacro = (precisionSum / denom) * 100;
  const recallMacro = (recallSum / denom) * 100;
  const f1Macro = (f1Sum / denom) * 100;
  const balancedAccuracy = recallMacro;

  const highConviction: HighConvictionMetrics = {
    minConfidenceThreshold,
    minAdxGate: artifact.minAdxGate ?? 20,
    totalTestBars: testSamples.length,
    directionalSignals,
    directionalHits,
    buySignals,
    buyHits,
    sellSignals,
    sellHits,
    precision: directionalSignals > 0 ? Number(((directionalHits / directionalSignals) * 100).toFixed(2)) : 0,
    buyPrecision: buySignals > 0 ? Number(((buyHits / buySignals) * 100).toFixed(2)) : 0,
    sellPrecision: sellSignals > 0 ? Number(((sellHits / sellSignals) * 100).toFixed(2)) : 0,
    tradeCoveragePct: Number(((directionalSignals / nTest) * 100).toFixed(2)),
    avgDirectionalConfidence:
      directionalSignals > 0 ? Number((dirConfidenceSum / directionalSignals).toFixed(2)) : 0,
    avgMetaProbability:
      directionalSignals > 0 ? Number((metaProbSum / directionalSignals).toFixed(2)) : 0,
  };

  return {
    accuracy: Number(accuracy.toFixed(2)),
    balancedAccuracy: Number(balancedAccuracy.toFixed(2)),
    precisionMacro: Number(precisionMacro.toFixed(2)),
    recallMacro: Number(recallMacro.toFixed(2)),
    f1Macro: Number(f1Macro.toFixed(2)),
    confusionMatrix,
    highConviction,
    predictionHistory,
  };
}

/**
 * Full Chronological Two-Stage Meta-Labeled Random Forest Pipeline:
 * - 18 scale-invariant causal features (zero raw OHLC prices)
 * - Selectable Target Mode: "trend_regime" (3-bar forward EMA(5) vs ±0.35×ATR & ADX>20) or "raw_return" (±0.45×ATR)
 * - Two-Stage Meta-Labeling + ADX(14) >= 20 confidence gate (default 0.72)
 * - Strictly chronological 70% Train / 15% Validation / 15% Test split + optional Walk-Forward CV
 */
export function trainRandomForestPipeline(
  rawCandles: CandleRow[],
  options?: {
    nEstimators?: number;
    maxDepth?: number;
    minSamplesSplit?: number;
    horizonCandles?: number;
    minConfidenceThreshold?: number;
    targetMode?: TargetLabelMode;
    walkForward?: boolean;
  }
): TrainingEvaluation {
  const nEstimators = options?.nEstimators ?? 30;
  const maxDepth = options?.maxDepth ?? 6;
  const minSamplesSplit = options?.minSamplesSplit ?? 8;
  const horizon = options?.horizonCandles ?? 3;
  const minConfidenceThreshold = clampConfidenceThreshold(options?.minConfidenceThreshold);
  const targetMode = normalizeTargetMode(options?.targetMode);
  const enableWalkForward = Boolean(options?.walkForward);

  const enriched = calculateIndicators(rawCandles);

  const samples: SampleRow[] = [];
  const classDist = { BUY: 0, HOLD: 0, SELL: 0 };

  for (let i = 0; i < enriched.length - horizon; i++) {
    const cur = enriched[i];
    const fut = enriched[i + horizon];
    const vec = extractFeatureVector(cur);
    if (!vec || cur.atr === null || cur.atr <= 0 || cur.adx === null || cur.close <= 0) continue;

    const futureRet = (fut.close - cur.close) / cur.close;
    let labelIdx = 1; // HOLD

    if (targetMode === 'trend_regime') {
      if (cur.ema5 === null || fut.ema5 === null) continue;
      const forwardEma5Move = fut.ema5 - cur.ema5;
      const atrThresh = 0.35 * cur.atr;
      if (cur.adx > 20 && forwardEma5Move > atrThresh) {
        labelIdx = 0; // BUY
      } else if (cur.adx > 20 && forwardEma5Move < -atrThresh) {
        labelIdx = 2; // SELL
      }
    } else {
      const forwardCloseMove = fut.close - cur.close;
      const atrThresh = 0.45 * cur.atr;
      if (forwardCloseMove > atrThresh) {
        labelIdx = 0; // BUY
      } else if (forwardCloseMove < -atrThresh) {
        labelIdx = 2; // SELL
      }
    }

    if (labelIdx === 0) classDist.BUY++;
    else if (labelIdx === 2) classDist.SELL++;
    else classDist.HOLD++;

    samples.push({
      x: vec,
      y: labelIdx,
      candle: cur,
      futureReturnPct: Number((futureRet * 100).toFixed(4)),
    });
  }

  if (samples.length < 120) {
    throw new Error(
      `Insufficient usable samples after causal indicator & 15m HTF warm-up (${samples.length} found, minimum 120 required). Upload at least 200 5-minute candles.`
    );
  }

  const trainEnd = Math.floor(samples.length * 0.7);
  const valEnd = Math.floor(samples.length * 0.85);

  const trainSamples = samples.slice(0, trainEnd);
  const valSamples = samples.slice(trainEnd, valEnd);
  const testSamples = samples.slice(valEnd);

  const artifact = fitTwoStageMetaForest(trainSamples, {
    nEstimators,
    maxDepth,
    minSamplesSplit,
    minConfidenceThreshold,
    targetMode,
    seed: 20260413,
  });

  const testEval = evaluateOnSamples(artifact, testSamples, minConfidenceThreshold);

  let walkForward: WalkForwardEvaluation | null = null;
  if (enableWalkForward) {
    const foldCount = samples.length >= 400 ? 4 : 3;
    const initialTrainSize = Math.floor(samples.length * 0.5);
    const foldSize = Math.floor((samples.length - initialTrainSize) / foldCount);
    const folds: WalkForwardFold[] = [];

    for (let f = 0; f < foldCount; f++) {
      const testStart = initialTrainSize + f * foldSize;
      const testEnd = f === foldCount - 1 ? samples.length : testStart + foldSize;
      const wfTrain = samples.slice(0, testStart);
      const wfTest = samples.slice(testStart, testEnd);
      if (wfTrain.length < 60 || wfTest.length < 15) continue;

      const wfArtifact = fitTwoStageMetaForest(wfTrain, {
        nEstimators,
        maxDepth,
        minSamplesSplit,
        minConfidenceThreshold,
        targetMode,
        seed: 20260413 + (f + 1) * 97,
      });
      const wfEval = evaluateOnSamples(wfArtifact, wfTest, minConfidenceThreshold);
      folds.push({
        fold: f + 1,
        trainRange: `${wfTrain[0].candle.date_str} → ${wfTrain[wfTrain.length - 1].candle.date_str}`,
        testRange: `${wfTest[0].candle.date_str} → ${wfTest[wfTest.length - 1].candle.date_str}`,
        trainSize: wfTrain.length,
        testSize: wfTest.length,
        overallAccuracy: wfEval.accuracy,
        balancedAccuracy: wfEval.balancedAccuracy,
        highConvictionPrecision: wfEval.highConviction.precision,
        tradeCoveragePct: wfEval.highConviction.tradeCoveragePct,
        directionalSignals: wfEval.highConviction.directionalSignals,
        directionalHits: wfEval.highConviction.directionalHits,
      });
    }

    const totalDirectionalSignals = folds.reduce((a, b) => a + b.directionalSignals, 0);
    const totalDirectionalHits = folds.reduce((a, b) => a + b.directionalHits, 0);
    const meanOverallAccuracy =
      folds.length > 0 ? Number((folds.reduce((a, b) => a + b.overallAccuracy, 0) / folds.length).toFixed(2)) : 0;
    const meanTradeCoveragePct =
      folds.length > 0 ? Number((folds.reduce((a, b) => a + b.tradeCoveragePct, 0) / folds.length).toFixed(2)) : 0;
    const meanHighConvictionPrecision =
      totalDirectionalSignals > 0
        ? Number(((totalDirectionalHits / totalDirectionalSignals) * 100).toFixed(2))
        : 0;

    walkForward = {
      enabled: true,
      foldCount: folds.length,
      folds,
      meanOverallAccuracy,
      meanHighConvictionPrecision,
      meanTradeCoveragePct,
      totalDirectionalSignals,
      totalDirectionalHits,
    };
  }

  return {
    datasetSize: rawCandles.length,
    usableSamples: samples.length,
    trainSize: trainSamples.length,
    valSize: valSamples.length,
    testSize: testSamples.length,
    dateRange: `${samples[0].candle.date_str} to ${samples[samples.length - 1].candle.date_str}`,
    targetMode,
    labelingMode: artifact.labelingMode,
    minConfidenceThreshold,
    minAdxGate: artifact.minAdxGate,
    accuracy: testEval.accuracy,
    balancedAccuracy: testEval.balancedAccuracy,
    precisionMacro: testEval.precisionMacro,
    recallMacro: testEval.recallMacro,
    f1Macro: testEval.f1Macro,
    highConviction: testEval.highConviction,
    walkForward,
    confusionMatrix: testEval.confusionMatrix,
    classDistribution: classDist,
    featureImportance: artifact.featureImportance,
    predictionHistory: testEval.predictionHistory.slice(-40).reverse(),
    artifact,
  };
}

export interface GeneratedSignal {
  timestamp: number;
  date_str: string;
  time_str: string;
  signal_type: SignalClass;
  raw_signal_type: SignalClass;
  threshold_gated: boolean;
  market_price: number;
  entry_price: number;
  stop_loss: number;
  target_price: number;
  risk_reward: string;
  confidence: number;
  meta_probability: number;
  predicted_move_pct: number;
  rsi: number;
  macd: number;
  macd_signal: number;
  macd_hist: number;
  reason: string;
}

/**
 * Generates actionable signal + Entry/SL/Target + Technical explanation from a trained Meta-Labeled RF model.
 */
export function generateSignalForCandle(
  artifact: RandomForestArtifact,
  candle: EnrichedCandle,
  minConfidenceOverride?: number
): GeneratedSignal | null {
  const vec = extractFeatureVector(candle, artifact.featureNames);
  if (!vec || candle.rsi === null || candle.macd === null || candle.macdSignal === null || candle.macdHist === null) {
    return null;
  }

  const pred = predictWithForest(artifact, vec, {
    minConfidenceOverride,
    adx: candle.adx,
  });
  const price = candle.close;
  const atrPct = candle.atr && price > 0 ? (candle.atr * 1.2) / price : ((candle.volatility ?? 0.15) * 1.8) / 100;
  const volPct = Math.min(0.0075, Math.max(0.0018, atrPct));
  const slDist = price * volPct;
  const targetDist = slDist * 2.0;

  let stopLoss = price;
  let targetPrice = price;
  let expectedMove = 0;

  if (pred.signal === 'BUY') {
    stopLoss = Number((price - slDist).toFixed(2));
    targetPrice = Number((price + targetDist).toFixed(2));
    expectedMove = Number(((targetDist / price) * 100 * (pred.confidence / 100)).toFixed(2));
  } else if (pred.signal === 'SELL') {
    stopLoss = Number((price + slDist).toFixed(2));
    targetPrice = Number((price - targetDist).toFixed(2));
    expectedMove = Number((-(targetDist / price) * 100 * (pred.confidence / 100)).toFixed(2));
  } else {
    stopLoss = Number((price - slDist * 0.8).toFixed(2));
    targetPrice = Number((price + slDist * 0.8).toFixed(2));
    expectedMove = Number((((pred.probabilities.BUY - pred.probabilities.SELL) / 100) * 0.12).toFixed(2));
  }

  const trendText =
    candle.adx !== null
      ? `ADX(14) ${candle.adx} (${candle.adx >= 20 ? 'trending' : 'chop < 20'})`
      : 'Trend forming';
  const confluenceText =
    candle.mtfConfluenceScore !== null ? `MTF Score ${candle.mtfConfluenceScore >= 0 ? '+' : ''}${candle.mtfConfluenceScore}/3` : '';
  const vwapText =
    candle.vwapDistance !== null
      ? `VWAP dist ${candle.vwapDistance >= 0 ? '+' : ''}${candle.vwapDistance}%`
      : '';

  const threshPct = Math.round(pred.minConfidenceThreshold * 100);
  const gateText = pred.adxGated
    ? `Raw ${pred.rawSignal} (Meta ${pred.metaProbability}%) gated to HOLD (ADX ${candle.adx ?? '—'} < 20)`
    : pred.thresholdGated
    ? `Raw ${pred.rawSignal} (Meta ${pred.metaProbability}%) gated to HOLD (<${threshPct}% gate)`
    : `${pred.signal} (Meta ${pred.metaProbability}% ≥ ${threshPct}% & ADX ≥ 20)`;

  const reason = `Meta-Label RF: ${gateText}; Stage1 P(BUY)=${pred.probabilities.BUY}%, P(SELL)=${pred.probabilities.SELL}%. ${confluenceText}, RSI(14) ${candle.rsi}, ${trendText}, ${vwapText}.`;

  return {
    timestamp: candle.timestamp,
    date_str: candle.date_str,
    time_str: candle.time_str,
    signal_type: pred.signal,
    raw_signal_type: pred.rawSignal,
    threshold_gated: pred.thresholdGated,
    market_price: price,
    entry_price: price,
    stop_loss: stopLoss,
    target_price: targetPrice,
    risk_reward: pred.signal === 'HOLD' ? 'Wait (1:1 Range)' : '1:2.0',
    confidence: pred.confidence,
    meta_probability: pred.metaProbability,
    predicted_move_pct: expectedMove,
    rsi: candle.rsi,
    macd: candle.macd,
    macd_signal: candle.macdSignal,
    macd_hist: candle.macdHist,
    reason,
  };
}
