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
  featureNames: string[];
  nEstimators: number;
  maxDepth: number;
  minSamplesSplit: number;
  trees: TreeNode[];
  featureImportance: Array<{ feature: string; importance: number }>;
}

export interface TrainingEvaluation {
  datasetSize: number;
  usableSamples: number;
  trainSize: number;
  valSize: number;
  testSize: number;
  dateRange: string;
  accuracy: number;
  balancedAccuracy: number;
  precisionMacro: number;
  recallMacro: number;
  f1Macro: number;
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
    confidence: number;
    futureReturnPct: number;
  }>;
  artifact: RandomForestArtifact;
}

/**
 * Extracts normalized/scaled feature vector strictly from information available at candle t.
 * Prices are kept as structural inputs alongside stationary oscillators and volatility.
 */
export function extractFeatureVector(c: EnrichedCandle): number[] | null {
  if (
    c.rsi === null ||
    c.macd === null ||
    c.macdSignal === null ||
    c.macdHist === null ||
    c.return1 === null ||
    c.volatility === null
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
  x: number[]
): { signal: SignalClass; probabilities: Record<SignalClass, number>; confidence: number } {
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

  return {
    signal: CLASS_LABELS[bestClassIdx],
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

/**
 * Full Chronological Random Forest Pipeline:
 * - Calculates indicators causally
 * - Creates 3-candle (15m) forward return labels (+0.10% BUY, -0.10% SELL, else HOLD)
 * - Chronologically splits 70% Train / 15% Validation / 15% Test (never shuffled)
 * - Evaluates strictly on held-out Test set
 */
export function trainRandomForestPipeline(
  rawCandles: CandleRow[],
  options?: { nEstimators?: number; maxDepth?: number; minSamplesSplit?: number; horizonCandles?: number; thresholdPct?: number }
): TrainingEvaluation {
  const nEstimators = options?.nEstimators ?? 30;
  const maxDepth = options?.maxDepth ?? 6;
  const minSamplesSplit = options?.minSamplesSplit ?? 8;
  const horizon = options?.horizonCandles ?? 3;
  const thresh = options?.thresholdPct ?? 0.001; // 0.10%

  const enriched = calculateIndicators(rawCandles);

  interface SampleRow {
    x: number[];
    y: number; // 0=BUY, 1=HOLD, 2=SELL
    candle: EnrichedCandle;
    futureReturnPct: number;
  }

  const samples: SampleRow[] = [];
  const classDist = { BUY: 0, HOLD: 0, SELL: 0 };

  // Exclude last `horizon` candles because future close at t+3 does not exist
  for (let i = 0; i < enriched.length - horizon; i++) {
    const vec = extractFeatureVector(enriched[i]);
    if (!vec) continue;

    const futureRet = (enriched[i + horizon].close - enriched[i].close) / enriched[i].close;
    let labelIdx = 1; // HOLD
    if (futureRet > thresh) {
      labelIdx = 0; // BUY
      classDist.BUY++;
    } else if (futureRet < -thresh) {
      labelIdx = 2; // SELL
      classDist.SELL++;
    } else {
      classDist.HOLD++;
    }

    samples.push({
      x: vec,
      y: labelIdx,
      candle: enriched[i],
      futureReturnPct: Number((futureRet * 100).toFixed(4)),
    });
  }

  if (samples.length < 120) {
    throw new Error(
      `Insufficient usable samples after indicator warm-up (${samples.length} found, minimum 120 required). Upload at least 200 5-minute candles.`
    );
  }

  // Chronological 70% / 15% / 15% split — NEVER shuffled
  const trainEnd = Math.floor(samples.length * 0.7);
  const valEnd = Math.floor(samples.length * 0.85);

  const trainSamples = samples.slice(0, trainEnd);
  const valSamples = samples.slice(trainEnd, valEnd);
  const testSamples = samples.slice(valEnd);

  const XTrain = trainSamples.map((s) => s.x);
  const yTrain = trainSamples.map((s) => s.y);

  // Balanced class weights so minority BUY/SELL signals aren't ignored
  const trainCounts: [number, number, number] = [0, 0, 0];
  for (const label of yTrain) trainCounts[label]++;
  const nTrain = yTrain.length;
  const classWeights: [number, number, number] = [
    trainCounts[0] > 0 ? nTrain / (3 * trainCounts[0]) : 1,
    trainCounts[1] > 0 ? nTrain / (3 * trainCounts[1]) : 1,
    trainCounts[2] > 0 ? nTrain / (3 * trainCounts[2]) : 1,
  ];
  const sampleWeights = yTrain.map((label) => classWeights[label]);

  const numFeatures = FEATURE_NAMES.length;
  const maxFeatures = Math.max(2, Math.floor(Math.sqrt(numFeatures)));
  const importanceAccum = new Array(numFeatures).fill(0);
  const rng = mulberry32(20260413);

  const trees: TreeNode[] = [];
  for (let t = 0; t < nEstimators; t++) {
    const bootIndices: number[] = [];
    for (let i = 0; i < nTrain; i++) {
      bootIndices.push(Math.floor(rng() * nTrain));
    }
    const tree = buildTree(
      XTrain,
      yTrain,
      sampleWeights,
      bootIndices,
      0,
      maxDepth,
      minSamplesSplit,
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

  const artifact: RandomForestArtifact = {
    algorithm: 'Random Forest Classifier (CART Ensemble)',
    featureNames: [...FEATURE_NAMES],
    nEstimators,
    maxDepth,
    minSamplesSplit,
    trees,
    featureImportance,
  };

  // Evaluate strictly on chronological held-out Test set
  const confusionMatrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const predictionHistory: TrainingEvaluation['predictionHistory'] = [];
  let correct = 0;

  for (const sample of testSamples) {
    const pred = predictWithForest(artifact, sample.x);
    const predIdx = CLASS_LABELS.indexOf(pred.signal);
    confusionMatrix[sample.y][predIdx]++;
    if (predIdx === sample.y) correct++;

    predictionHistory.push({
      timestamp: sample.candle.timestamp,
      date_str: sample.candle.date_str,
      time_str: sample.candle.time_str,
      close: sample.candle.close,
      actual: CLASS_LABELS[sample.y],
      predicted: pred.signal,
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

  return {
    datasetSize: rawCandles.length,
    usableSamples: samples.length,
    trainSize: trainSamples.length,
    valSize: valSamples.length,
    testSize: testSamples.length,
    dateRange: `${samples[0].candle.date_str} to ${samples[samples.length - 1].candle.date_str}`,
    accuracy: Number(accuracy.toFixed(2)),
    balancedAccuracy: Number(balancedAccuracy.toFixed(2)),
    precisionMacro: Number(precisionMacro.toFixed(2)),
    recallMacro: Number(recallMacro.toFixed(2)),
    f1Macro: Number(f1Macro.toFixed(2)),
    confusionMatrix,
    classDistribution: classDist,
    featureImportance,
    predictionHistory: predictionHistory.slice(-40).reverse(),
    artifact,
  };
}

export interface GeneratedSignal {
  timestamp: number;
  date_str: string;
  time_str: string;
  signal_type: SignalClass;
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
  candle: EnrichedCandle
): GeneratedSignal | null {
  const vec = extractFeatureVector(candle);
  if (!vec || candle.rsi === null || candle.macd === null || candle.macdSignal === null || candle.macdHist === null) {
    return null;
  }

  const pred = predictWithForest(artifact, vec);
  const price = candle.close;
  // Adaptive risk buffer based on 5-minute rolling volatility or candle range (floor 0.18%, cap 0.75%)
  const volPct = Math.min(0.0075, Math.max(0.0018, ((candle.volatility ?? 0.15) * 1.8) / 100));
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
    candle.ema20 !== null && candle.sma50 !== null
      ? candle.ema20 > candle.sma50
        ? 'EMA(20) above SMA(50) bullish structure'
        : 'EMA(20) below SMA(50) bearish structure'
      : 'Moving average trend forming';

  const rsiText =
    candle.rsi >= 65
      ? `RSI(14) elevated at ${candle.rsi}`
      : candle.rsi <= 35
      ? `RSI(14) oversold at ${candle.rsi}`
      : `RSI(14) neutral at ${candle.rsi}`;

  const macdText =
    candle.macdHist > 0
      ? `MACD histogram positive (+${candle.macdHist})`
      : `MACD histogram negative (${candle.macdHist})`;

  const reason = `Random Forest outputs ${pred.signal} (${pred.confidence}% confidence; P(BUY)=${pred.probabilities.BUY}%, P(SELL)=${pred.probabilities.SELL}%). ${rsiText}; ${macdText}; ${trendText}.`;

  return {
    timestamp: candle.timestamp,
    date_str: candle.date_str,
    time_str: candle.time_str,
    signal_type: pred.signal,
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
