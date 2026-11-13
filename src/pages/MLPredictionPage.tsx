import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BrainCircuit, Layers, Play, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { ModelStatusResponse } from '../types/trading';

interface MLPredictionPageProps {
  modelStatus: ModelStatusResponse | null;
  onTrain: (params: {
    nEstimators: number;
    maxDepth: number;
    minSamplesSplit: number;
    minConfidenceThreshold: number;
    walkForward: boolean;
  }) => Promise<void>;
  isDark: boolean;
}

export const MLPredictionPage: React.FC<MLPredictionPageProps> = ({
  modelStatus,
  onTrain,
  isDark,
}) => {
  const [nEstimators, setNEstimators] = useState(30);
  const [maxDepth, setMaxDepth] = useState(6);
  const [minSamplesSplit, setMinSamplesSplit] = useState(8);
  const [minConfidenceThreshold, setMinConfidenceThreshold] = useState<number>(
    modelStatus?.minConfidenceThreshold ?? 0.65
  );
  const [walkForward, setWalkForward] = useState<boolean>(
    Boolean(modelStatus?.walkForwardEnabled ?? false)
  );
  const [training, setTraining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof modelStatus?.minConfidenceThreshold === 'number') {
      setMinConfidenceThreshold(modelStatus.minConfidenceThreshold);
    }
    if (typeof modelStatus?.walkForwardEnabled === 'boolean') {
      setWalkForward(modelStatus.walkForwardEnabled);
    }
  }, [modelStatus?.minConfidenceThreshold, modelStatus?.walkForwardEnabled]);

  const handleTrain = async () => {
    setTraining(true);
    setError(null);
    try {
      await onTrain({
        nEstimators,
        maxDepth,
        minSamplesSplit,
        minConfidenceThreshold,
        walkForward,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTraining(false);
    }
  };

  const isTrained = modelStatus?.status === 'Trained';
  const cm = modelStatus?.confusionMatrix ?? [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const labels = ['BUY', 'HOLD', 'SELL'];
  const hc = modelStatus?.highConviction;
  const wf = modelStatus?.walkForward;
  const activeThresholdPct = Math.round(
    (hc?.minConfidenceThreshold ?? modelStatus?.minConfidenceThreshold ?? minConfidenceThreshold) * 100
  );

  return (
    <div className="space-y-6">
      {/* Model Configuration & Training Header */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-sky-500" />
              <h2 className="font-display text-lg font-semibold">
                Random Forest Classifier (Causal + High-Conviction Direction Engine)
              </h2>
            </div>
            <p className="text-xs text-slate-500 max-w-3xl leading-relaxed">
              Predicts 3-candle (15-minute) Bank NIFTY direction using 21 strictly causal features: OHLC, RSI(14),
              MACD(12,26,9), Returns, Rolling Volatility, Candle Body/Range, Relative Volume, daily-reset Intraday VWAP
              Distance, ATR(14) &amp; ATR-Normalized Range, ADX(14), completed 15m HTF EMA(20) slope &amp; RSI(14), and
              NSE session time sin/cos (09:15 IST). Uses volatility-adaptive ±0.75×ATR(14)/Close labeling,
              balanced-subsample tree weighting, and chronological 70% Train / 15% Val / 15% Test splits.
            </p>
          </div>

          <div className="text-right">
            <div className="text-xs text-slate-500">Model Status</div>
            <div
              className={`font-display text-base font-semibold ${
                isTrained ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {modelStatus?.status ?? 'Not trained'}
            </div>
          </div>
        </div>

        {/* Hyperparameters, Conviction Threshold & Walk-Forward Controls */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Trees (n_estimators):{' '}
              <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">{nEstimators}</span>
            </label>
            <input
              type="range"
              min={15}
              max={60}
              step={5}
              value={nEstimators}
              onChange={(e) => setNEstimators(Number(e.target.value))}
              className="w-full accent-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Max Depth:{' '}
              <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">{maxDepth}</span>
            </label>
            <input
              type="range"
              min={3}
              max={9}
              step={1}
              value={maxDepth}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
              className="w-full accent-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Min Samples Split:{' '}
              <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">{minSamplesSplit}</span>
            </label>
            <input
              type="range"
              min={4}
              max={20}
              step={2}
              value={minSamplesSplit}
              onChange={(e) => setMinSamplesSplit(Number(e.target.value))}
              className="w-full accent-sky-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-500">Min Conviction</label>
              <span className="font-mono text-xs font-semibold tabular-nums text-sky-600 dark:text-sky-400">
                {(minConfidenceThreshold * 100).toFixed(0)}% ({minConfidenceThreshold.toFixed(2)})
              </span>
            </div>
            <input
              type="range"
              min={0.5}
              max={0.9}
              step={0.01}
              value={minConfidenceThreshold}
              onChange={(e) => setMinConfidenceThreshold(Number(e.target.value))}
              className="w-full accent-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Rolling Validation</label>
            <button
              type="button"
              onClick={() => setWalkForward((v) => !v)}
              className={`w-full py-2 px-3 rounded-lg border text-xs font-medium transition-colors flex items-center justify-between ${
                walkForward
                  ? 'border-sky-500/50 bg-sky-500/10 text-sky-600 dark:text-sky-300'
                  : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50'
              }`}
            >
              <span>Walk-Forward</span>
              <span className="font-mono font-semibold">{walkForward ? 'ON' : 'OFF'}</span>
            </button>
          </div>

          <div>
            <button
              type="button"
              disabled={training}
              onClick={handleTrain}
              className="w-full py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{training ? 'Training Ensemble...' : 'Train & Evaluate'}</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-500">
            {error}
          </div>
        )}
      </div>

      {/* Empty / Not Trained State */}
      {!isTrained ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-10 text-center space-y-3">
          <SlidersHorizontal className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="font-display text-lg font-semibold">Model Status: Not trained</h3>
          <p className="text-sm text-slate-500 max-w-lg mx-auto">
            No fabricated accuracy or test metrics are displayed prior to training. Configure the conviction threshold
            and click <strong>Train &amp; Evaluate</strong> above to fit the 21-feature causal ensemble on the active
            dataset ({modelStatus?.datasetSize ?? 0} candles, {modelStatus?.dateRange ?? '—'}).
          </p>
        </div>
      ) : (
        <>
          {/* Section A: Overall Chronological Test Set Metrics */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                (A) Overall Chronological Test Set Evaluation (All Holdout Bars)
              </h3>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                Split Tr {modelStatus.trainSize} / Val {modelStatus.valSize} / Te {modelStatus.testSize}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
                <div className="text-xs text-slate-500">Overall Test Accuracy</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-sky-600 dark:text-sky-400">
                  {modelStatus.metrics?.accuracy.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
                <div className="text-xs text-slate-500">Balanced Accuracy</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
                  {modelStatus.metrics?.balancedAccuracy.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
                <div className="text-xs text-slate-500">Macro Precision</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
                  {modelStatus.metrics?.precision.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
                <div className="text-xs text-slate-500">Macro Recall</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
                  {modelStatus.metrics?.recall.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
                <div className="text-xs text-slate-500">Macro F1-Score</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
                  {modelStatus.metrics?.f1Score.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
                <div className="text-xs text-slate-500">Usable Causal Bars</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
                  {modelStatus.usableSamples ?? modelStatus.datasetSize}
                </div>
              </div>
            </div>
          </div>

          {/* Section B: High-Conviction Signal Precision & Trade Coverage % */}
          <div className="rounded-xl border border-sky-500/30 bg-white dark:bg-[#0D131F] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <h3 className="font-display text-sm font-semibold">
                  (B) High-Conviction Directional Metrics (Probability ≥ {activeThresholdPct}%)
                </h3>
              </div>
              <span className="text-xs text-slate-500">
                Accuracy evaluated strictly on BUY &amp; SELL signals passing confidence gating (below threshold → HOLD)
              </span>
            </div>

            {hc ? (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3.5">
                  <div className="text-xs text-slate-500">High-Conviction Precision</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {hc.directionalSignals > 0 ? `${hc.precision.toFixed(2)}%` : '—'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3.5">
                  <div className="text-xs text-slate-500">Trade Coverage %</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-sky-600 dark:text-sky-400">
                    {hc.tradeCoveragePct.toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3.5">
                  <div className="text-xs text-slate-500">Directional Hits / Emitted</div>
                  <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
                    {hc.directionalHits} / {hc.directionalSignals}
                    <span className="text-xs font-normal text-slate-500"> ({hc.totalTestBars} bars)</span>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3.5">
                  <div className="text-xs text-slate-500">BUY Precision</div>
                  <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {hc.buySignals > 0 ? `${hc.buyPrecision.toFixed(1)}%` : '—'}
                    <span className="text-xs font-normal text-slate-500">
                      {' '}({hc.buyHits}/{hc.buySignals})
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3.5">
                  <div className="text-xs text-slate-500">SELL Precision</div>
                  <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-red-600 dark:text-red-400">
                    {hc.sellSignals > 0 ? `${hc.sellPrecision.toFixed(1)}%` : '—'}
                    <span className="text-xs font-normal text-slate-500">
                      {' '}({hc.sellHits}/{hc.sellSignals})
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3.5">
                  <div className="text-xs text-slate-500">Avg Signal Confidence</div>
                  <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
                    {hc.directionalSignals > 0 ? `${hc.avgDirectionalConfidence.toFixed(1)}%` : '—'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500">
                Retrain model to compute high-conviction gated metrics on the 21-feature pipeline.
              </div>
            )}
          </div>

          {/* Optional Rolling Walk-Forward Validation Table */}
          {wf?.enabled && wf.folds.length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] overflow-hidden">
              <div className="p-4 border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-sky-500" />
                  <div>
                    <h3 className="font-display text-base font-semibold">
                      Rolling Walk-Forward Out-of-Sample Validation ({wf.foldCount} Folds)
                    </h3>
                    <p className="text-xs text-slate-500">
                      Expanding chronological train windows evaluated strictly on unseen forward test segments
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-5 text-xs font-mono tabular-nums">
                  <span>
                    Mean Acc: <strong className="text-sky-500">{wf.meanOverallAccuracy.toFixed(2)}%</strong>
                  </span>
                  <span>
                    Pooled High-Conv Precision:{' '}
                    <strong className="text-emerald-500">{wf.meanHighConvictionPrecision.toFixed(2)}%</strong>
                  </span>
                  <span>
                    Mean Coverage: <strong>{wf.meanTradeCoveragePct.toFixed(2)}%</strong> ({wf.totalDirectionalHits}/
                    {wf.totalDirectionalSignals})
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-left">
                      <th className="py-2.5 px-4 font-sans">Fold</th>
                      <th className="py-2.5 px-4 font-sans">Train Window</th>
                      <th className="py-2.5 px-4 font-sans">OOS Test Window</th>
                      <th className="py-2.5 px-4 text-right font-sans">Train / Test Bars</th>
                      <th className="py-2.5 px-4 text-right font-sans">Overall Acc</th>
                      <th className="py-2.5 px-4 text-right font-sans">High-Conv Precision</th>
                      <th className="py-2.5 px-4 text-right font-sans">Coverage %</th>
                      <th className="py-2.5 px-4 text-right font-sans">Hits / Signals</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                    {wf.folds.map((f) => (
                      <tr key={f.fold} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="py-2.5 px-4 font-semibold">Fold {f.fold}</td>
                        <td className="py-2.5 px-4 text-slate-500">{f.trainRange}</td>
                        <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">{f.testRange}</td>
                        <td className="py-2.5 px-4 text-right">
                          {f.trainSize} / {f.testSize}
                        </td>
                        <td className="py-2.5 px-4 text-right text-sky-600 dark:text-sky-400">
                          {f.overallAccuracy.toFixed(2)}%
                        </td>
                        <td className="py-2.5 px-4 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                          {f.directionalSignals > 0 ? `${f.highConvictionPrecision.toFixed(2)}%` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right">{f.tradeCoveragePct.toFixed(2)}%</td>
                        <td className="py-2.5 px-4 text-right">
                          {f.directionalHits} / {f.directionalSignals}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Dataset Metadata + Modular Extensibility Note */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] px-5 py-3 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
            <div>
              <span>
                Algorithm: <strong className="text-slate-800 dark:text-slate-200">{modelStatus.algorithm}</strong>
              </span>
              <span className="mx-2">·</span>
              <span>
                Dataset: <strong className="text-slate-800 dark:text-slate-200">{modelStatus.datasetName}</strong>
              </span>
              <span className="mx-2">·</span>
              <span>
                Range: <strong className="font-mono text-slate-800 dark:text-slate-200">{modelStatus.dateRange}</strong>
              </span>
            </div>
            <div>Labeling: Volatility-Adaptive ±0.75×ATR(14)/Close · class_weight=balanced_subsample</div>
          </div>

          {/* Confusion Matrix & Feature Importance */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* 3x3 Confusion Matrix */}
            <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
              <div>
                <h3 className="font-display text-base font-semibold">Test Set Confusion Matrix (Thresholded)</h3>
                <p className="text-xs text-slate-500">
                  Rows: Actual Label · Columns: Emitted Signal (≥ {activeThresholdPct}% conviction)
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono tabular-nums border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2 px-3 text-left font-sans">Actual \ Pred</th>
                      {labels.map((l) => (
                        <th key={l} className="py-2 px-3 text-right">
                          {l}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
                    {labels.map((rowLabel, rIdx) => (
                      <tr key={rowLabel}>
                        <td className="py-3 px-3 font-semibold text-slate-700 dark:text-slate-300">{rowLabel}</td>
                        {cm[rIdx].map((val, cIdx) => {
                          const isDiag = rIdx === cIdx;
                          return (
                            <td
                              key={cIdx}
                              className={`py-3 px-3 text-right font-semibold ${
                                isDiag
                                  ? 'text-sky-600 dark:text-sky-400 bg-sky-500/8'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {val}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {modelStatus.classDistribution && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
                  <span>Volatility-Adaptive Labels:</span>
                  <span className="font-mono tabular-nums">
                    BUY {modelStatus.classDistribution.BUY} · HOLD {modelStatus.classDistribution.HOLD} · SELL{' '}
                    {modelStatus.classDistribution.SELL}
                  </span>
                </div>
              )}
            </div>

            {/* Feature Importance Chart */}
            <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-3">
              <div>
                <h3 className="font-display text-base font-semibold">Feature Importance (Gini Gain %)</h3>
                <p className="text-xs text-slate-500">
                  Relative contribution across all {modelStatus.featureImportance?.length ?? 21} causal features
                </p>
              </div>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={modelStatus.featureImportance ?? []}
                    layout="vertical"
                    margin={{ top: 4, right: 20, left: 32, bottom: 4 }}
                  >
                    <CartesianGrid
                      stroke={isDark ? 'rgba(148,163,184,0.08)' : 'rgba(15,23,42,0.06)'}
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      unit="%"
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="feature"
                      tick={{ fontSize: 10, fill: isDark ? '#CBD5E1' : '#334155', fontFamily: 'JetBrains Mono' }}
                      width={106}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: isDark ? '#0D131F' : '#FFFFFF',
                        borderColor: isDark ? 'rgba(148,163,184,0.2)' : '#CBD5E1',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    />
                    <Bar
                      dataKey="importance"
                      name="Importance %"
                      fill="#0EA5E9"
                      radius={[0, 4, 4, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Prediction History Table */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-semibold">Out-of-Sample Prediction History (Test Split)</h3>
                <p className="text-xs text-slate-500">
                  Threshold-gated signals (≥ {activeThresholdPct}%) compared against realized 3-candle (15m) returns
                </p>
              </div>
              <span className="text-xs text-slate-500">
                Last {modelStatus.predictionHistory?.length ?? 0} test bars
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-left">
                    <th className="py-2.5 px-4 font-sans">Timestamp</th>
                    <th className="py-2.5 px-4 text-right font-sans">Close</th>
                    <th className="py-2.5 px-4 font-sans">Emitted Signal</th>
                    <th className="py-2.5 px-4 font-sans">Actual (15m)</th>
                    <th className="py-2.5 px-4 text-right font-sans">Confidence</th>
                    <th className="py-2.5 px-4 text-right font-sans">Realized 15m Return</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                  {(modelStatus.predictionHistory ?? []).map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">
                        {row.date_str} {row.time_str}
                      </td>
                      <td className="py-2.5 px-4 text-right">{row.close.toFixed(2)}</td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`font-semibold ${
                            row.predicted === 'BUY'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : row.predicted === 'SELL'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {row.predicted}
                        </span>
                        {row.thresholdGated && row.rawPredicted && (
                          <span className="ml-1.5 text-[10px] font-sans text-slate-500">
                            (raw {row.rawPredicted} gated)
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">{row.actual}</td>
                      <td className="py-2.5 px-4 text-right">{row.confidence.toFixed(1)}%</td>
                      <td
                        className={`py-2.5 px-4 text-right ${
                          row.futureReturnPct >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {row.futureReturnPct >= 0 ? '+' : ''}
                        {row.futureReturnPct.toFixed(3)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
