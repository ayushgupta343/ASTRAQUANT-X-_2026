import React, { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BrainCircuit, Play, SlidersHorizontal } from 'lucide-react';
import { ModelStatusResponse } from '../types/trading';

interface MLPredictionPageProps {
  modelStatus: ModelStatusResponse | null;
  onTrain: (params: { nEstimators: number; maxDepth: number; minSamplesSplit: number }) => Promise<void>;
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
  const [training, setTraining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTrain = async () => {
    setTraining(true);
    setError(null);
    try {
      await onTrain({ nEstimators, maxDepth, minSamplesSplit });
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

  return (
    <div className="space-y-6">
      {/* Model Configuration & Training Header */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-sky-500" />
              <h2 className="font-display text-lg font-semibold">
                Random Forest Classifier (Baseline Direction Engine)
              </h2>
            </div>
            <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
              Predicts 3-candle (15-minute) market direction using 13 causal inputs (Open, High, Low, Close, RSI 14,
              MACD, MACD Signal, MACD Histogram, Returns, Rolling Volatility, Candle Body, Candle Range, Relative Volume).
              Uses strict chronological 70% Train / 15% Validation / 15% Test splitting — never randomly shuffled.
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

        {/* Hyperparameters & Train Trigger */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800/80 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Trees (n_estimators): <span className="font-mono text-slate-800 dark:text-slate-200">{nEstimators}</span>
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
              Max Depth: <span className="font-mono text-slate-800 dark:text-slate-200">{maxDepth}</span>
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
              Min Samples Split: <span className="font-mono text-slate-800 dark:text-slate-200">{minSamplesSplit}</span>
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
            <button
              type="button"
              disabled={training}
              onClick={handleTrain}
              className="w-full py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{training ? 'Training Chronological Forest...' : 'Train Random Forest Model'}</span>
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
            No fabricated accuracy or test metrics are displayed prior to training. Click{' '}
            <strong>Train Random Forest Model</strong> above to fit the ensemble on the active dataset (
            {modelStatus?.datasetSize ?? 0} candles, {modelStatus?.dateRange ?? '—'}) and evaluate on the chronological 15% test split.
          </p>
        </div>
      ) : (
        <>
          {/* Evaluation Metrics Strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
              <div className="text-xs text-slate-500">Test Accuracy</div>
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
              <div className="text-xs text-slate-500">Split (Tr / Val / Te)</div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums">
                {modelStatus.trainSize} / {modelStatus.valSize} / {modelStatus.testSize}
              </div>
            </div>
          </div>

          {/* Dataset Metadata + Modular Extensibility Note */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] px-5 py-3 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
            <div>
              <span>Algorithm: <strong className="text-slate-800 dark:text-slate-200">{modelStatus.algorithm}</strong></span>
              <span className="mx-2">·</span>
              <span>Dataset: <strong className="text-slate-800 dark:text-slate-200">{modelStatus.datasetName}</strong></span>
              <span className="mx-2">·</span>
              <span>Range: <strong className="font-mono text-slate-800 dark:text-slate-200">{modelStatus.dateRange}</strong></span>
            </div>
            <div>
              Future modular adapters: XGBoost · LightGBM · LSTM (Pending)
            </div>
          </div>

          {/* Confusion Matrix & Feature Importance */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* 3x3 Confusion Matrix */}
            <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
              <div>
                <h3 className="font-display text-base font-semibold">Test Set Confusion Matrix</h3>
                <p className="text-xs text-slate-500">Rows: Actual Label · Columns: Predicted Label (Chronological 15% Holdout)</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono tabular-nums border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2 px-3 text-left font-sans">Actual \ Pred</th>
                      {labels.map((l) => (
                        <th key={l} className="py-2 px-3 text-right">{l}</th>
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
                  <span>Full Dataset Labels:</span>
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
                <p className="text-xs text-slate-500">Relative contribution of each causal feature across forest splits</p>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={modelStatus.featureImportance ?? []}
                    layout="vertical"
                    margin={{ top: 4, right: 20, left: 28, bottom: 4 }}
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
                      tick={{ fontSize: 11, fill: isDark ? '#CBD5E1' : '#334155', fontFamily: 'JetBrains Mono' }}
                      width={92}
                      axisLine={false}
                      tickLine={false}
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
                    <Bar dataKey="importance" name="Importance %" fill="#0EA5E9" radius={[0, 4, 4, 0]} isAnimationActive={false} />
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
                <p className="text-xs text-slate-500">Direction predictions compared against realized 3-candle (15m) returns</p>
              </div>
              <span className="text-xs text-slate-500">Last {modelStatus.predictionHistory?.length ?? 0} test bars</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-left">
                    <th className="py-2.5 px-4 font-sans">Timestamp</th>
                    <th className="py-2.5 px-4 text-right font-sans">Close</th>
                    <th className="py-2.5 px-4 font-sans">Predicted</th>
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
                      <td
                        className={`py-2.5 px-4 font-semibold ${
                          row.predicted === 'BUY'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : row.predicted === 'SELL'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {row.predicted}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">{row.actual}</td>
                      <td className="py-2.5 px-4 text-right">{row.confidence.toFixed(1)}%</td>
                      <td
                        className={`py-2.5 px-4 text-right ${
                          row.futureReturnPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
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
