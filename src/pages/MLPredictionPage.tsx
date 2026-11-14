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
import { BrainCircuit, Layers, Play, ShieldCheck, SlidersHorizontal, Target } from 'lucide-react';
import { ModelStatusResponse, TargetLabelMode } from '../types/trading';

interface MLPredictionPageProps {
  modelStatus: ModelStatusResponse | null;
  onTrain: (params: {
    nEstimators: number;
    maxDepth: number;
    minSamplesSplit: number;
    minConfidenceThreshold: number;
    targetMode: TargetLabelMode;
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
    modelStatus?.minConfidenceThreshold ?? 0.72
  );
  const [targetMode, setTargetMode] = useState<TargetLabelMode>(
    modelStatus?.targetMode ?? 'trend_regime'
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
    if (modelStatus?.targetMode === 'trend_regime' || modelStatus?.targetMode === 'raw_return') {
      setTargetMode(modelStatus.targetMode);
    }
    if (typeof modelStatus?.walkForwardEnabled === 'boolean') {
      setWalkForward(modelStatus.walkForwardEnabled);
    }
  }, [modelStatus?.minConfidenceThreshold, modelStatus?.targetMode, modelStatus?.walkForwardEnabled]);

  const handleTrain = async () => {
    setTraining(true);
    setError(null);
    try {
      await onTrain({
        nEstimators,
        maxDepth,
        minSamplesSplit,
        minConfidenceThreshold,
        targetMode,
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
  const activeAdxGate = hc?.minAdxGate ?? modelStatus?.minAdxGate ?? 20;
  const activeTargetMode: TargetLabelMode = modelStatus?.targetMode ?? targetMode;
  const activeTargetLabel =
    activeTargetMode === 'raw_return'
      ? 'Raw 3-Candle Return'
      : 'Trend-Continuation Regime (High Accuracy)';

  return (
    <div className="space-y-6">
      {/* Model Configuration & Training Header */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-sky-500" />
              <h2 className="font-display text-lg font-semibold">
                Two-Stage Meta-Labeling Random Forest (Scale-Invariant Trend-State Engine)
              </h2>
            </div>
            <p className="text-xs text-slate-500 max-w-4xl leading-relaxed">
              Raw Open/High/Low/Close prices &amp; point ATR are removed to eliminate non-stationary price overfitting.
              Decision trees split strictly on <strong>18 scale-invariant causal features</strong>: RSI(14),
              MACD(12,26,9) &amp; Signal/Histogram, 1-bar &amp; 3-bar Returns %, EMA(9)-EMA(21) Spread %, daily-reset
              Intraday VWAP Distance %, ATR-Normalized Range, ADX(14), causal 15m HTF EMA(20) Slope &amp; RSI(14),
              Relative Volume, NSE Session Time Sin/Cos (09:15 IST), MTF Confluence Score (-3..+3), RSI Momentum Slope,
              and MACD Histogram Acceleration. Stage 2 Meta-Labeling scores 3-fold OOF directional confidence and emits
              BUY/SELL only when Probability ≥ {(minConfidenceThreshold * 100).toFixed(0)}% and ADX(14) ≥ 20.
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

        {/* Target Mode, Hyperparameters, Meta-Label Gate & Walk-Forward Controls */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4 items-end">
          <div className="sm:col-span-2 lg:col-span-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <Target className="w-3.5 h-3.5 text-sky-500" />
              <span>Target Labeling Mode</span>
            </label>
            <select
              value={targetMode}
              onChange={(e) => setTargetMode(e.target.value as TargetLabelMode)}
              className="w-full py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#070B12] text-xs font-medium text-slate-800 dark:text-slate-100"
            >
              <option value="trend_regime">Trend-Continuation Regime (High Accuracy)</option>
              <option value="raw_return">Raw 3-Candle Return</option>
            </select>
          </div>

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
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-500">Meta-Label Gate</label>
              <span className="font-mono text-xs font-semibold tabular-nums text-sky-600 dark:text-sky-400">
                {(minConfidenceThreshold * 100).toFixed(0)}% ({minConfidenceThreshold.toFixed(2)})
              </span>
            </div>
            <input
              type="range"
              min={0.5}
              max={0.92}
              step={0.01}
              value={minConfidenceThreshold}
              onChange={(e) => setMinConfidenceThreshold(Number(e.target.value))}
              className="w-full accent-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Min Split: <span className="font-mono tabular-nums">{minSamplesSplit}</span> · Rolling
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={4}
                max={20}
                step={2}
                value={minSamplesSplit}
                onChange={(e) => setMinSamplesSplit(Number(e.target.value))}
                className="w-16 py-1.5 px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-xs font-mono tabular-nums"
              />
              <button
                type="button"
                onClick={() => setWalkForward((v) => !v)}
                className={`flex-1 py-2 px-2.5 rounded-lg border text-xs font-medium transition-colors flex items-center justify-between ${
                  walkForward
                    ? 'border-sky-500/50 bg-sky-500/10 text-sky-600 dark:text-sky-300'
                    : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                }`}
              >
                <span>WF</span>
                <span className="font-mono font-semibold">{walkForward ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>

          <div>
            <button
              type="button"
              disabled={training}
              onClick={handleTrain}
              className="w-full py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{training ? 'Training Two-Stage RF...' : 'Train & Evaluate'}</span>
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
            No fabricated accuracy or test metrics are displayed prior to training. Select the target mode, configure
            the Meta-Label threshold (default 0.72), and click <strong>Train &amp; Evaluate</strong> above to fit the
            18-feature scale-invariant Two-Stage Random Forest on the active dataset ({modelStatus?.datasetSize ?? 0}{' '}
            candles, {modelStatus?.dateRange ?? '—'}).
          </p>
        </div>
      ) : (
        <>
          {/* Headline Accuracy Card: Executed Signal Accuracy + Overall & Macro Test Metrics */}
          <div className="rounded-xl border border-emerald-500/30 bg-white dark:bg-[#0D131F] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-500" />
                <div>
                  <h3 className="font-display text-base font-semibold">
                    Executed Signal Accuracy (High-Conviction BUY/SELL)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Two-Stage Meta-Label Gate (Prob ≥ {activeThresholdPct}% &amp; ADX(14) ≥ {activeAdxGate}) · Target:{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-300">{activeTargetLabel}</span>
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                Chronological Split · Tr {modelStatus.trainSize} / Val {modelStatus.valSize} / Te {modelStatus.testSize}
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
              {/* Primary Headline KPI */}
              <div className="lg:col-span-4 rounded-xl border border-emerald-500/40 bg-emerald-500/5 dark:bg-emerald-500/10 p-5 flex flex-col justify-between">
                <div className="text-xs font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                  Executed Signal Accuracy (High-Conviction BUY/SELL)
                </div>
                <div className="mt-2 font-mono text-4xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {hc && hc.directionalSignals > 0 ? `${hc.precision.toFixed(2)}%` : '—'}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  <span>
                    Hits / Emitted: <strong>{hc ? `${hc.directionalHits}/${hc.directionalSignals}` : '—'}</strong>
                  </span>
                  <span>
                    Coverage: <strong>{hc ? `${hc.tradeCoveragePct.toFixed(2)}%` : '—'}</strong>
                  </span>
                </div>
              </div>

              {/* Supporting Overall 3-Class & Macro Evaluation Cards */}
              <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3.5">
                  <div className="text-xs text-slate-500">Overall 3-Class Test Accuracy</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-sky-600 dark:text-sky-400">
                    {modelStatus.metrics?.accuracy.toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3.5">
                  <div className="text-xs text-slate-500">Balanced Accuracy</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
                    {modelStatus.metrics?.balancedAccuracy.toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3.5">
                  <div className="text-xs text-slate-500">Trade Coverage %</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-sky-600 dark:text-sky-400">
                    {hc ? `${hc.tradeCoveragePct.toFixed(2)}%` : '—'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3.5">
                  <div className="text-xs text-slate-500">Macro Precision</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
                    {modelStatus.metrics?.precision.toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3.5">
                  <div className="text-xs text-slate-500">Macro Recall</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
                    {modelStatus.metrics?.recall.toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3.5">
                  <div className="text-xs text-slate-500">Macro F1-Score</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
                    {modelStatus.metrics?.f1Score.toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>

            {/* Secondary High-Conviction Breakdown */}
            {hc ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800/80">
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3">
                  <div className="text-xs text-slate-500">BUY Precision</div>
                  <div className="mt-1 font-mono text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {hc.buySignals > 0 ? `${hc.buyPrecision.toFixed(1)}%` : '—'}
                    <span className="text-xs font-normal text-slate-500">
                      {' '}({hc.buyHits}/{hc.buySignals})
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3">
                  <div className="text-xs text-slate-500">SELL Precision</div>
                  <div className="mt-1 font-mono text-base font-semibold tabular-nums text-red-600 dark:text-red-400">
                    {hc.sellSignals > 0 ? `${hc.sellPrecision.toFixed(1)}%` : '—'}
                    <span className="text-xs font-normal text-slate-500">
                      {' '}({hc.sellHits}/{hc.sellSignals})
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3">
                  <div className="text-xs text-slate-500">Avg Meta-Label Prob</div>
                  <div className="mt-1 font-mono text-base font-semibold tabular-nums text-sky-600 dark:text-sky-400">
                    {hc.directionalSignals > 0
                      ? `${(hc.avgMetaProbability ?? hc.avgDirectionalConfidence).toFixed(1)}%`
                      : '—'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070B12] p-3">
                  <div className="text-xs text-slate-500">Usable Causal Bars</div>
                  <div className="mt-1 font-mono text-base font-semibold tabular-nums">
                    {modelStatus.usableSamples ?? modelStatus.datasetSize}
                    <span className="text-xs font-normal text-slate-500"> ({hc.totalTestBars} test)</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500">
                Retrain model to compute Two-Stage Meta-Labeling high-conviction metrics on the 18 scale-invariant
                features.
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
                    Pooled Executed Signal Acc:{' '}
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
                      <th className="py-2.5 px-4 text-right font-sans">Executed Signal Acc</th>
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

          {/* Dataset Metadata + Labeling Summary */}
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
            <div>
              Labeling: {modelStatus.labelingMode ?? activeTargetLabel} · class_weight=balanced_subsample
            </div>
          </div>

          {/* Confusion Matrix & Feature Importance */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* 3x3 Confusion Matrix */}
            <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
              <div>
                <h3 className="font-display text-base font-semibold">Test Set Confusion Matrix (Meta-Gated)</h3>
                <p className="text-xs text-slate-500">
                  Rows: Actual Label · Columns: Emitted Signal (Meta Prob ≥ {activeThresholdPct}% &amp; ADX ≥{' '}
                  {activeAdxGate})
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
                  <span>Target Labels ({activeTargetMode === 'raw_return' ? 'Raw 3-Bar' : 'Trend Regime'}):</span>
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
                  Relative contribution across all {modelStatus.featureImportance?.length ?? 18} scale-invariant causal
                  features (zero raw price levels)
                </p>
              </div>
              <div className="h-96 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={modelStatus.featureImportance ?? []}
                    layout="vertical"
                    margin={{ top: 4, right: 20, left: 48, bottom: 4 }}
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
                      width={132}
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
                  Meta-Label gated signals (Prob ≥ {activeThresholdPct}% &amp; ADX ≥ {activeAdxGate}) compared against
                  realized 3-candle (15m) returns
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
                    <th className="py-2.5 px-4 text-right font-sans">ADX(14)</th>
                    <th className="py-2.5 px-4 font-sans">Emitted Signal</th>
                    <th className="py-2.5 px-4 font-sans">Actual (15m)</th>
                    <th className="py-2.5 px-4 text-right font-sans">Meta Prob</th>
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
                      <td className="py-2.5 px-4 text-right text-slate-500">
                        {row.adx !== null && row.adx !== undefined ? row.adx.toFixed(1) : '—'}
                      </td>
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
                      <td className="py-2.5 px-4 text-right">
                        {(row.metaProbability ?? row.confidence).toFixed(1)}%
                      </td>
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
