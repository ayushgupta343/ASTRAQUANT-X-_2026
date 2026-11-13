import { CandleRow, EnrichedCandle, calculateIndicators } from './quant.ts';

export type SignalClass = 'BUY' | 'SELL' | 'HOLD';

export const CLASS_LABELS: SignalClass[] = ['BUY', 'HOLD', 'SELL'];

export const FEATURE_NAMES = [
  'open',
  'high',
  'low',
  'close',
  'rsi',
  'macd',
  'macdSignal',
  'macdHist',
  'return1',
  'volatility',
  'candleBody',
  'candleRange',
  'volume',
  'vwapDistance',
  'atr',
  'atrNormRange',
  'adx',
  'htfEma20Slope',
  'htfRsi14',
  'timeSin',
  'timeCos',
] as const;

export type FeatureKey = (typeof FEATURE_NAMES)[number];

interface TreeNode {
  leaf: boolean;
  probs?: [number, number, number]; // [BUY, HOLD, SELL]
  featureIdx?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
}

export interface RandomForestArtifact {
  algorithm: string;
  labelingMode: string;
  minConfidenceThreshold: number;
  featureNames: string[];
  nEstimators: number;
  maxDepth: number;
  minSamplesSplit: number;
  trees: TreeNode[];
  featureImportance: Array<{ feature: string; importance: number }>;
}

export interface HighConvictionMetrics {
  minConfidenceThreshold: number;
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
  minConfidenceThreshold: number;
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
    futureReturnPct: number;
  }>;
  artifact: RandomForestArtifact;
}

export function clampConfidenceThreshold(val?: number): number {
  if (val === undefined || Number.isNaN(val)) return 0.65;
  const normalized = val > 1 ? val / 100 : val;
  return Number(Math.min(0.9, Math.max(0.5, normalized)).toFixed(2));
}

/**
 * Extracts normalized/scaled feature vector strictly from causal information available at candle t.
 */
export function extractFeatureVector(c: EnrichedCandle): number[] | null {
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

function giniImpurity(counts: [number, number, number]): number {
  const total = counts[0] + counts[1] + counts[2];
  if (total <= 0) return 0;
  let sumSq = 0;
  for (let c = 0; c < 3; c++) {
    const p = counts[c] / total;
    sumSq += p * p;
  }
  return 1 - sumSq;
}

function buildTree(
  X: number[][],
  y: number[],
  weights: number[],
  indices: number[],
  depth: number,
  maxDepth: number,
  minSamplesSplit: number,
  maxFeatures: number,
  importanceAccum: number[],
  rng: () => number
): TreeNode {
  const counts: [number, number, number] = [0, 0, 0];
  for (const idx of indices) {
    counts[y[idx]] += weights[idx];
  }
  const totalW = counts[0] + counts[1] + counts[2];
  const probs: [number, number, number] =
    totalW > 0
      ? [counts[0] / totalW, counts[1] / totalW, counts[2] / totalW]
      : [0.333, 0.334, 0.333];

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

  const parentImpurity = giniImpurity(counts);
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

    // Sample up to 14 quantile candidate thresholds for speed & accuracy
    const numBins = Math.min(14, vals.length - 1);
    const seenThresh = new Set<number>();

    for (let b = 1; b <= numBins; b++) {
      const qIdx = Math.floor((b * vals.length) / (numBins + 1));
      const thresh = vals[qIdx];
      if (seenThresh.has(thresh)) continue;
      seenThresh.add(thresh);

      const leftCounts: [number, number, number] = [0, 0, 0];
      const rightCounts: [number, number, number] = [0, 0, 0];
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

      const leftW = leftCounts[0] + leftCounts[1] + leftCounts[2];
      const rightW = rightCounts[0] + rightCounts[1] + rightCounts[2];
      const weightedImpurity =
        (leftW / totalW) * giniImpurity(leftCounts) +
        (rightW / totalW) * giniImpurity(rightCounts);

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

  importanceAccum[bestFeature] += bestGain * totalW;

  return {
    leaf: false,
    featureIdx: bestFeature,
    threshold: bestThreshold,
    left: buildTree(X, y, weights, bestLeft, depth + 1, maxDepth, minSamplesSplit, maxFeatures, importanceAccum, rng),
    right: buildTree(X, y, weights, bestRight, depth + 1, maxDepth, minSamplesSplit, maxFeatures, importanceAccum, rng),
  };
}

function predictTreeProbs(node: TreeNode, x: number[]): [number, number, number] {
  if (node.leaf || node.featureIdx === undefined || node.threshold === undefined) {
    return node.probs ?? [0.333, 0.334, 0.333];
  }
  if (x[node.featureIdx] <= node.threshold) {
    return node.left ? predictTreeProbs(node.left, x) : [0.333, 0.334, 0.333];
  }
  return node.right ? predictTreeProbs(node.right, x) : [0.333, 0.334, 0.333];
}

export function predictWithForest(
  artifact: RandomForestArtifact,
  x: number[],
  minConfidenceOverride?: number
): {
  signal: SignalClass;
  rawSignal: SignalClass;
  thresholdGated: boolean;
  minConfidenceThreshold: number;
  probabilities: Record<SignalClass, number>;
  confidence: number;
} {
  const avg: [number, number, number] = [0, 0, 0];
  const nTrees = artifact.trees.length || 1;
  for (const tree of artifact.trees) {
    const p = predictTreeProbs(tree, x);
    avg[0] += p[0] / nTrees;
    avg[1] += p[1] / nTrees;
    avg[2] += p[2] / nTrees;
  }

  let bestClassIdx = 1; // HOLD default on tie
  let maxProb = -1;
  for (let c = 0; c < 3; c++) {
    if (avg[c] > maxProb) {
      maxProb = avg[c];
      bestClassIdx = c;
    }
  }

  const threshold = clampConfidenceThreshold(minConfidenceOverride ?? artifact.minConfidenceThreshold);
  const rawSignal = CLASS_LABELS[bestClassIdx];
  const isDirectional = bestClassIdx === 0 || bestClassIdx === 2;
  const passesThreshold = isDirectional && maxProb >= threshold;
  const signal: SignalClass = passesThreshold ? rawSignal : 'HOLD';
  const thresholdGated = isDirectional && !passesThreshold;

  return {
    signal,
    rawSignal,
    thresholdGated,
    minConfidenceThreshold: threshold,
    probabilities: {
      BUY: Number((avg[0] * 100).toFixed(2)),
      HOLD: Number((avg[1] * 100).toFixed(2)),
      SELL: Number((avg[2] * 100).toFixed(2)),
    },
    confidence: Number((maxProb * 100).toFixed(2)),
  };
}

/**
 * Deterministic seeded PRNG for reproducible Random Forest training.
 */
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

function fitForestOnSamples(
  trainSamples: SampleRow[],
  params: {
    nEstimators: number;
    maxDepth: number;
    minSamplesSplit: number;
    minConfidenceThreshold: number;
    seed: number;
  }
): RandomForestArtifact {
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

    // class_weight="balanced_subsample": inverse class-frequency weighting computed per bootstrap subsample
    const activeClassCount = bootCounts.filter((cnt) => cnt > 0).length || 1;
    const bootClassWeights: [number, number, number] = [
      bootCounts[0] > 0 ? nTrain / (activeClassCount * bootCounts[0]) : 1,
      bootCounts[1] > 0 ? nTrain / (activeClassCount * bootCounts[1]) : 1,
      bootCounts[2] > 0 ? nTrain / (activeClassCount * bootCounts[2]) : 1,
    ];
    const sampleWeights = yTrain.map((label) => bootClassWeights[label]);

    const tree = buildTree(
      XTrain,
      yTrain,
      sampleWeights,
      bootIndices,
      0,
      params.maxDepth,
      params.minSamplesSplit,
      maxFeatures,
      importanceAccum,
      rng
    );
    trees.push(tree);
  }

  const totalImp = importanceAccum.reduce((a, b) => a + b, 0) || 1;
  const featureImportance = FEATURE_NAMES.map((name, idx) => ({
    feature: name,
    importance: Number(((importanceAccum[idx] / totalImp) * 100).toFixed(2)),
  })).sort((a, b) => b.importance - a.importance);

  return {
    algorithm: 'Random Forest Classifier (Causal + High-Conviction CART Ensemble)',
    labelingMode: 'Volatility-Adaptive ±0.75×ATR(14)/Close (3-Bar Horizon)',
    minConfidenceThreshold: params.minConfidenceThreshold,
    featureNames: [...FEATURE_NAMES],
    nEstimators: params.nEstimators,
    maxDepth: params.maxDepth,
    minSamplesSplit: params.minSamplesSplit,
    trees,
    featureImportance,
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

  for (const sample of testSamples) {
    const pred = predictWithForest(artifact, sample.x, minConfidenceThreshold);
    const predIdx = CLASS_LABELS.indexOf(pred.signal);
    const actualLabel = CLASS_LABELS[sample.y];
    confusionMatrix[sample.y][predIdx]++;
    if (predIdx === sample.y) correct++;

    if (pred.signal === 'BUY' || pred.signal === 'SELL') {
      directionalSignals++;
      dirConfidenceSum += pred.confidence;
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
 * Full Chronological Random Forest Pipeline:
 * - Calculates 21 causal features (VWAP distance, ATR, ATR-norm range, ADX, 15m HTF EMA20 slope & RSI14, NSE session sin/cos)
 * - Volatility-adaptive 3-candle target threshold (±0.75 × ATR(14) / Close)
 * - Chronologically splits 70% Train / 15% Validation / 15% Test (never shuffled)
 * - Optional rolling walk-forward validation across chronological folds
 */
export function trainRandomForestPipeline(
  rawCandles: CandleRow[],
  options?: {
    nEstimators?: number;
    maxDepth?: number;
    minSamplesSplit?: number;
    horizonCandles?: number;
    minConfidenceThreshold?: number;
    walkForward?: boolean;
  }
): TrainingEvaluation {
  const nEstimators = options?.nEstimators ?? 30;
  const maxDepth = options?.maxDepth ?? 6;
  const minSamplesSplit = options?.minSamplesSplit ?? 8;
  const horizon = options?.horizonCandles ?? 3;
  const minConfidenceThreshold = clampConfidenceThreshold(options?.minConfidenceThreshold);
  const enableWalkForward = Boolean(options?.walkForward);

  const enriched = calculateIndicators(rawCandles);

  const samples: SampleRow[] = [];
  const classDist = { BUY: 0, HOLD: 0, SELL: 0 };

  // Exclude last `horizon` candles because future close at t+3 does not exist
  for (let i = 0; i < enriched.length - horizon; i++) {
    const cur = enriched[i];
    const vec = extractFeatureVector(cur);
    if (!vec || cur.atr === null || cur.close <= 0) continue;

    const futureRet = (enriched[i + horizon].close - cur.close) / cur.close;
    // Volatility-adaptive threshold scaled by ATR(14)/Close
    const adaptiveThresh = (0.75 * cur.atr) / cur.close;

    let labelIdx = 1; // HOLD
    if (futureRet > adaptiveThresh) {
      labelIdx = 0; // BUY
      classDist.BUY++;
    } else if (futureRet < -adaptiveThresh) {
      labelIdx = 2; // SELL
      classDist.SELL++;
    } else {
      classDist.HOLD++;
    }

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

  // Chronological 70% / 15% / 15% split — NEVER shuffled
  const trainEnd = Math.floor(samples.length * 0.7);
  const valEnd = Math.floor(samples.length * 0.85);

  const trainSamples = samples.slice(0, trainEnd);
  const valSamples = samples.slice(trainEnd, valEnd);
  const testSamples = samples.slice(valEnd);

  const artifact = fitForestOnSamples(trainSamples, {
    nEstimators,
    maxDepth,
    minSamplesSplit,
    minConfidenceThreshold,
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

      const wfArtifact = fitForestOnSamples(wfTrain, {
        nEstimators,
        maxDepth,
        minSamplesSplit,
        minConfidenceThreshold,
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
    minConfidenceThreshold,
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
  predicted_move_pct: number;
  rsi: number;
  macd: number;
  macd_signal: number;
  macd_hist: number;
  reason: string;
}

/**
 * Generates actionable signal + Entry/SL/Target + Technical explanation from a trained RF model.
 */
export function generateSignalForCandle(
  artifact: RandomForestArtifact,
  candle: EnrichedCandle,
  minConfidenceOverride?: number
): GeneratedSignal | null {
  const vec = extractFeatureVector(candle);
  if (!vec || candle.rsi === null || candle.macd === null || candle.macdSignal === null || candle.macdHist === null) {
    return null;
  }

  const pred = predictWithForest(artifact, vec, minConfidenceOverride);
  const price = candle.close;
  // Adaptive risk buffer anchored to ATR(14) when available, bounded within 0.18%..0.75%
  const atrPct = candle.atr && price > 0 ? (candle.atr * 1.2) / price : ((candle.volatility ?? 0.15) * 1.8) / 100;
  const volPct = Math.min(0.0075, Math.max(0.0018, atrPct));
  const slDist = price * volPct;
  const targetDist = slDist * 2.0; // 1:2 Risk-Reward baseline

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
      ? `ADX(14) ${candle.adx} (${candle.adx >= 22 ? 'trending' : 'range-bound'})`
      : 'Trend forming';

  const vwapText =
    candle.vwapDistance !== null
      ? `VWAP dist ${candle.vwapDistance >= 0 ? '+' : ''}${candle.vwapDistance}%`
      : '';

  const htfText =
    candle.htfRsi14 !== null
      ? `15m HTF RSI ${candle.htfRsi14}`
      : '';

  const threshPct = Math.round(pred.minConfidenceThreshold * 100);
  const gateText = pred.thresholdGated
    ? `Raw ${pred.rawSignal} (${pred.confidence}%) gated to HOLD (<${threshPct}% conviction threshold)`
    : `${pred.signal} (${pred.confidence}% confidence >= ${threshPct}% gate)`;

  const reason = `Random Forest: ${gateText}; P(BUY)=${pred.probabilities.BUY}%, P(SELL)=${pred.probabilities.SELL}%. RSI(14) ${candle.rsi}, ${trendText}, ${vwapText}, ${htfText}.`;

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
    predicted_move_pct: expectedMove,
    rsi: candle.rsi,
    macd: candle.macd,
    macd_signal: candle.macdSignal,
    macd_hist: candle.macdHist,
    reason,
  };
}
