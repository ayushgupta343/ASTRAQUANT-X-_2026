import React, { useState } from 'react';
import { AlertTriangle, BrainCircuit, Play, RefreshCw, RotateCcw, TrendingDown, TrendingUp } from 'lucide-react';
import { CandlestickChart } from '../components/CandlestickChart';
import { IndicatorCharts } from '../components/IndicatorCharts';
import {
  EnrichedCandle,
  MarketFeedMode,
  MarketOverviewResponse,
  PageId,
  PaperTradePrefill,
} from '../types/trading';

interface DashboardPageProps {
  overview: MarketOverviewResponse | null;
  candles: EnrichedCandle[];
  loading: boolean;
  isDark: boolean;
  feedMode: MarketFeedMode;
  streamConnected: boolean;
  onTrainModel: () => Promise<void>;
  onRefresh: (forceLive?: boolean) => Promise<void>;
  onReplayControl: (action: 'reset' | 'step') => Promise<void>;
  onNavigate: (page: PageId) => void;
  onQuickPaperTrade: (prefill: PaperTradePrefill) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  overview,
  candles,
  loading,
  isDark,
  feedMode,
  streamConnected,
  onTrainModel,
  onRefresh,
  onReplayControl,
  onNavigate,
  onQuickPaperTrade,
}) => {
  const [training, setTraining] = useState(false);

  const handleTrain = async () => {
    setTraining(true);
    try {
      await onTrainModel();
    } finally {
      setTraining(false);
    }
  };

  if (loading && !overview) {
    return (
      <div className="space-y-4">
        <div className="h-24 rounded-xl bg-slate-200 dark:bg-slate-800/50 animate-pulse" />
        <div className="h-[440px] rounded-xl bg-slate-200 dark:bg-slate-800/50 animate-pulse" />
      </div>
    );
  }

  if (!overview?.hasData) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] p-10 text-center space-y-4">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
        <h2 className="font-display text-xl font-semibold">No Bank NIFTY Dataset Active</h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          Upload a 5-minute Bank NIFTY OHLCV CSV dataset in Data Management to populate charts, technical indicators, and ML predictions.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('data')}
          className="px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-500"
        >
          Go to Data Management
        </button>
      </div>
    );
  }

  const isPositive = (overview.dailyChangePct ?? 0) >= 0;
  const pred = overview.prediction;
  const rec = pred?.recommendation;
  const optRec = pred?.optionRecommendation;

  const signalColorClass =
    pred?.signal === 'BUY'
      ? 'text-emerald-600 dark:text-emerald-400'
      : pred?.signal === 'SELL'
      ? 'text-red-600 dark:text-red-400'
      : 'text-amber-600 dark:text-amber-400';

  return (
    <div className="space-y-5">
      {/* Data Provenance & Streaming Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0D131F] px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-sky-600 dark:text-sky-400">{overview.dataLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{overview.marketStatus.status}</span>
          <span aria-hidden="true">·</span>
          <span className="text-slate-500">{overview.marketStatus.note}</span>
          {feedMode !== 'historical_csv' && (
            <>
              <span aria-hidden="true">·</span>
              <span className={streamConnected ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-amber-500 font-medium'}>
                {streamConnected ? 'SSE Stream Active' : 'SSE Reconnecting...'}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {feedMode === 'simulated_replay' && (
            <button
              type="button"
              onClick={() => onReplayControl('reset')}
              className="flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:text-sky-500 font-medium whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restart Replay</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onRefresh(feedMode === 'free_live_nse')}
            className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 hover:text-sky-500 font-medium whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{feedMode === 'free_live_nse' ? 'Sync ^NSEBANK' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {overview.feedMeta?.warning && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{overview.feedMeta.warning}</span>
        </div>
      )}

      {/* Top Market Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
          <div className="text-xs text-slate-500">Bank NIFTY Price</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
            {overview.currentPrice?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
          <div className="text-xs text-slate-500">Daily Change</div>
          <div
            className={`mt-1 font-mono text-xl font-semibold tabular-nums flex items-center gap-1.5 ${
              isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
            }`}
          >
            {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            <span>
              {isPositive ? '+' : ''}
              {overview.dailyChangePct?.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
          <div className="text-xs text-slate-500">Day High</div>
          <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {overview.dayHigh?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
          <div className="text-xs text-slate-500">Day Low</div>
          <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-red-600 dark:text-red-400">
            {overview.dayLow?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
          <div className="text-xs text-slate-500">Market Status</div>
          <div className="mt-1 text-xs font-medium text-slate-800 dark:text-slate-200 leading-snug">
            {overview.marketStatus.status}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
          <div className="text-xs text-slate-500">Last Candle Time</div>
          <div className="mt-1 font-mono text-xs font-medium tabular-nums text-slate-800 dark:text-slate-200">
            {overview.lastUpdateTime}
          </div>
        </div>
      </div>

      {/* Main Chart + AI Prediction & Recommendation Side Column */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Main Candlestick Chart (8 cols) */}
        <div className="xl:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
          <CandlestickChart
            candles={candles}
            hasVolume={Boolean(overview.hasVolume)}
            isDark={isDark}
          />
        </div>

        {/* AI Prediction + Trading Recommendation (4 cols) */}
        <div className="xl:col-span-4 space-y-4">
          {/* AI Prediction Panel */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BrainCircuit className="w-4 h-4 text-sky-500" />
                <h2 className="font-display text-base font-semibold">AI Prediction Panel</h2>
              </div>
              <span className="text-xs font-mono text-slate-500">
                Status: <strong className="text-slate-800 dark:text-slate-200">{pred?.modelStatus ?? 'Not trained'}</strong>
              </span>
            </div>

            {pred?.modelStatus !== 'Trained' ? (
              <div className="py-3 space-y-3 border-t border-slate-200 dark:border-slate-800/80">
                <p className="text-xs text-slate-500 leading-relaxed">
                  Random Forest model has not been trained on the active dataset yet. Train the model chronologically to generate verified 15-minute direction predictions and ATM Option mappings.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={training}
                    onClick={handleTrain}
                    className="flex-1 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>{training ? 'Training Random Forest...' : 'Train Random Forest Model'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('ml')}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    ML Details
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 border-t border-slate-200 dark:border-slate-800/80 pt-3">
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-xs text-slate-500">Predicted Signal (Next 15m)</div>
                    <div className={`font-display text-2xl font-bold ${signalColorClass}`}>
                      {pred.signal}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Confidence</div>
                    <div className="font-mono text-xl font-semibold tabular-nums">
                      {pred.confidence?.toFixed(1)}%
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800/60 text-xs">
                  <div>
                    <span className="text-slate-500 block">Expected 15m Move</span>
                    <span className="font-mono font-semibold tabular-nums">
                      {(pred.predictedMovePct ?? 0) >= 0 ? '+' : ''}
                      {pred.predictedMovePct?.toFixed(2)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Model</span>
                    <span className="font-medium truncate block">Random Forest</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Trading Recommendation + Mapped Option Contract */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold">Trading Recommendation</h2>
              {rec && (
                <span className="text-[11px] font-mono text-slate-500">{rec.generatedAt}</span>
              )}
            </div>

            {!rec ? (
              <div className="text-xs text-slate-500 border-t border-slate-200 dark:border-slate-800/80 pt-3">
                Underlying Spot levels and nearest ATM CE/PE Option Contract recommendation will populate once the Random Forest model is trained.
              </div>
            ) : (
              <div className="space-y-4 border-t border-slate-200 dark:border-slate-800/80 pt-3">
                {/* Underlying Spot Levels */}
                <div className="grid grid-cols-2 gap-3 text-xs font-mono tabular-nums">
                  <div>
                    <span className="text-slate-500 font-sans block">Index Entry</span>
                    <strong className="text-sm text-slate-900 dark:text-white">
                      {rec.entryPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block">Risk / Reward</span>
                    <strong className="text-sm text-sky-600 dark:text-sky-400">{rec.riskReward}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block">Index Stop-Loss</span>
                    <strong className="text-sm text-red-600 dark:text-red-400">
                      {rec.stopLoss.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block">Index Target</span>
                    <strong className="text-sm text-emerald-600 dark:text-emerald-400">
                      {rec.targetPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                </div>

                {/* Automated ATM Option Contract Mapping */}
                {optRec ? (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800/70 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-sky-600 dark:text-sky-400">
                        Recommended Option: {optRec.strike.toLocaleString('en-IN')} {optRec.optionType}
                      </span>
                      <span className="font-mono text-slate-500">Lot Size: {optRec.lotSize}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                      <div>
                        <span className="text-slate-500 font-sans block">Est. Premium</span>
                        <strong className="text-slate-900 dark:text-white">₹{optRec.entryPremium.toFixed(2)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 font-sans block">Option SL</span>
                        <strong className="text-red-600 dark:text-red-400">₹{optRec.stopLoss.toFixed(2)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 font-sans block">Option Target</span>
                        <strong className="text-emerald-600 dark:text-emerald-400">₹{optRec.targetPrice.toFixed(2)}</strong>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-500 flex items-center justify-between">
                      <span>{optRec.dataMode}</span>
                      <span className="font-mono">Δ {optRec.delta.toFixed(2)} · IV {optRec.ivPct.toFixed(1)}%</span>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        onQuickPaperTrade({
                          instrumentType: 'OPTION',
                          side: 'BUY',
                          entry: optRec.entryPremium,
                          sl: optRec.stopLoss,
                          target: optRec.targetPrice,
                          strike: optRec.strike,
                          optionType: optRec.optionType,
                          expiry: optRec.expiry,
                          lots: 1,
                          lotSize: optRec.lotSize,
                          notes: `Staged ${optRec.strike} ${optRec.optionType} from AI Dashboard`,
                          rationale: rec.reason,
                        })
                      }
                      className="w-full py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors"
                    >
                      Stage {optRec.strike.toLocaleString('en-IN')} {optRec.optionType} in Paper Trading
                    </button>
                  </div>
                ) : (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800/70 space-y-2 text-xs text-slate-500">
                    <div>HOLD signal: No directional ATM CE/PE option contract staged.</div>
                    <button
                      type="button"
                      onClick={() => onNavigate('options')}
                      className="w-full py-2 px-4 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors"
                    >
                      Inspect Options Chain
                    </button>
                  </div>
                )}

                <p className="text-xs text-slate-500 leading-relaxed pt-2 border-t border-slate-200 dark:border-slate-800/60">
                  {rec.reason}
                </p>
              </div>
            )}
          </div>

          {/* Technical Indicator Summary */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-3">
            <h2 className="font-display text-base font-semibold">Technical Indicators</h2>
            <div className="divide-y divide-slate-200 dark:divide-slate-800/80 text-xs">
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">RSI (14)</span>
                <span className="font-mono font-medium tabular-nums">{overview.indicators?.rsi ?? '—'}</span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">MACD / Signal</span>
                <span className="font-mono font-medium tabular-nums">
                  {overview.indicators?.macd ?? '—'} / {overview.indicators?.macdSignal ?? '—'}
                </span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">EMA (20) / SMA (50)</span>
                <span className="font-mono font-medium tabular-nums">
                  {overview.indicators?.ema20 ?? '—'} / {overview.indicators?.sma50 ?? '—'}
                </span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">Rolling Volatility (14)</span>
                <span className="font-mono font-medium tabular-nums">
                  {overview.indicators?.volatility !== null && overview.indicators?.volatility !== undefined
                    ? `${overview.indicators.volatility.toFixed(3)}%`
                    : '—'}
                </span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">Trend Structure</span>
                <span className="font-medium text-sky-600 dark:text-sky-400">
                  {overview.indicators?.trendDirection ?? '—'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Synchronized RSI & MACD Charts */}
      <IndicatorCharts candles={candles} isDark={isDark} />
    </div>
  );
};
