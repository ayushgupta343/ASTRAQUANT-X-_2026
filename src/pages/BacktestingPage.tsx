import React, { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { History, Play, Upload } from 'lucide-react';
import { BacktestRunResult, DatasetMeta } from '../types/trading';

interface BacktestingPageProps {
  activeDataset: DatasetMeta | null;
  results: BacktestRunResult[];
  modelTrained: boolean;
  isDark: boolean;
  onRunBacktest: (config: {
    strategy: string;
    startDate?: string;
    endDate?: string;
    initialCapital: number;
    positionSize: number;
    stopLossPct: number;
    targetPct: number;
    chargeBps: number;
    slippageBps: number;
  }) => Promise<BacktestRunResult>;
  onUploadCSV: (file: File) => Promise<void>;
}

export const BacktestingPage: React.FC<BacktestingPageProps> = ({
  activeDataset,
  results,
  modelTrained,
  isDark,
  onRunBacktest,
  onUploadCSV,
}) => {
  const [strategy, setStrategy] = useState(
    modelTrained ? 'ml_random_forest' : 'rsi_macd_confluence'
  );
  const [startDate, setStartDate] = useState(activeDataset?.start_date ?? '');
  const [endDate, setEndDate] = useState(activeDataset?.end_date ?? '');
  const [initialCapital, setInitialCapital] = useState(100000);
  const [positionSize, setPositionSize] = useState(15);
  const [stopLossPct, setStopLossPct] = useState(0.35);
  const [targetPct, setTargetPct] = useState(0.7);
  const [chargeBps, setChargeBps] = useState(3);
  const [slippageBps, setSlippageBps] = useState(2);

  const [activeResult, setActiveResult] = useState<BacktestRunResult | null>(results[0] ?? null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayResult = activeResult ?? results[0] ?? null;

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setError(null);
    try {
      const res = await onRunBacktest({
        strategy,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        initialCapital,
        positionSize,
        stopLossPct,
        targetPct,
        chargeBps,
        slippageBps,
      });
      setActiveResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      await onUploadCSV(file);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {/* Scope Notice */}
      <div className="rounded-lg border border-sky-500/30 bg-sky-500/8 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="text-slate-700 dark:text-slate-200">
          <strong>Index-Direction Spot Simulation:</strong> Tests Bank NIFTY 5-minute index entries causally with
          brokerage and slippage. Actual Options Contract (CE/PE) backtesting requires historical option premium data.
        </div>
        <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium hover:border-sky-500">
          <Upload className="w-3.5 h-3.5 text-sky-500" />
          <span>Upload Backtest CSV</span>
          <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
        </label>
      </div>

      {/* Configuration Form */}
      <form
        onSubmit={handleRun}
        className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-sky-500" />
            <h2 className="font-display text-base font-semibold">Strategy &amp; Execution Parameters</h2>
          </div>
          <span className="text-xs text-slate-500">
            Dataset: <strong className="text-slate-800 dark:text-slate-200">{activeDataset?.name ?? 'None'}</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block text-slate-500 mb-1">Trading Strategy</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="ml_random_forest">ML Random Forest Classifier</option>
              <option value="rsi_macd_confluence">RSI(14) + MACD(12,26,9) Confluence</option>
              <option value="ema_sma_crossover">EMA(20) / SMA(50) Momentum</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Position Size (Units)</label>
            <input
              type="number"
              min={1}
              value={positionSize}
              onChange={(e) => setPositionSize(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Initial Capital (₹)</label>
            <input
              type="number"
              min={10000}
              step={5000}
              value={initialCapital}
              onChange={(e) => setInitialCapital(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Stop-Loss (%)</label>
            <input
              type="number"
              min={0.05}
              step={0.05}
              value={stopLossPct}
              onChange={(e) => setStopLossPct(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Target (%)</label>
            <input
              type="number"
              min={0.05}
              step={0.05}
              value={targetPct}
              onChange={(e) => setTargetPct(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Charges / Slippage (bps)</label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min={0}
                value={chargeBps}
                onChange={(e) => setChargeBps(Number(e.target.value))}
                title="Charges bps"
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
              />
              <input
                type="number"
                min={0}
                value={slippageBps}
                onChange={(e) => setSlippageBps(Number(e.target.value))}
                title="Slippage bps"
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-500">
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={running}
            className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-2"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{running ? 'Running Causal Backtest...' : 'Run Historical Backtest'}</span>
          </button>
        </div>
      </form>

      {/* Results View */}
      {displayResult ? (
        <div className="space-y-5">
          {/* Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
              <div className="text-xs text-slate-500">Total Return</div>
              <div
                className={`mt-1 font-mono text-xl font-semibold tabular-nums ${
                  displayResult.metrics.totalReturnPct >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {displayResult.metrics.totalReturnPct >= 0 ? '+' : ''}
                {displayResult.metrics.totalReturnPct.toFixed(2)}%
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
              <div className="text-xs text-slate-500">Net Profit</div>
              <div
                className={`mt-1 font-mono text-xl font-semibold tabular-nums ${
                  displayResult.metrics.netProfit >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {displayResult.metrics.netProfit >= 0 ? '+' : ''}₹
                {displayResult.metrics.netProfit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
              <div className="text-xs text-slate-500">Win Rate ({displayResult.metrics.totalTrades} trades)</div>
              <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
                {displayResult.metrics.winRatePct.toFixed(1)}%
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
              <div className="text-xs text-slate-500">Profit Factor · Sharpe</div>
              <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
                {displayResult.metrics.profitFactor.toFixed(2)} · {displayResult.metrics.sharpeRatio.toFixed(2)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
              <div className="text-xs text-slate-500">Max Drawdown</div>
              <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-red-600 dark:text-red-400">
                -{displayResult.metrics.maxDrawdownPct.toFixed(2)}%
              </div>
            </div>
          </div>

          {/* Secondary Metric Row */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] px-5 py-3 flex flex-wrap items-center justify-between gap-4 text-xs font-mono tabular-nums">
            <span>
              Avg Win: <strong className="text-emerald-500">₹{displayResult.metrics.avgProfitPerTrade.toFixed(2)}</strong>
            </span>
            <span>
              Avg Loss: <strong className="text-red-500">₹{displayResult.metrics.avgLossPerTrade.toFixed(2)}</strong>
            </span>
            <span>
              Total Costs (Slippage + Charges): <strong>₹{displayResult.metrics.totalCosts.toFixed(2)}</strong>
            </span>
            <span className="text-slate-500 font-sans">Window: {displayResult.dateRange}</span>
          </div>

          {/* Equity Curve */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5">
            <h3 className="font-display text-base font-semibold mb-3">Simulated Portfolio Equity Curve</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={displayResult.equityCurve} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={isDark ? 'rgba(148,163,184,0.08)' : 'rgba(15,23,42,0.06)'} strokeDasharray="3 3" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={35} axisLine={false} tickLine={false} />
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={{ fontSize: 10, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `₹${Math.round(v / 1000)}k`}
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
                  <Area
                    type="monotone"
                    dataKey="equity"
                    name="Equity (₹)"
                    stroke="#38BDF8"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#eqFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Trade History Table */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <h3 className="font-display text-base font-semibold">Backtest Trade Log</h3>
              <span className="text-xs text-slate-500">Showing up to 150 most recent trades</span>
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-xs font-mono tabular-nums">
                <thead className="sticky top-0 bg-white dark:bg-[#0D131F]">
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-left">
                    <th className="py-2.5 px-4 font-sans">#</th>
                    <th className="py-2.5 px-4 font-sans">Side</th>
                    <th className="py-2.5 px-4 font-sans">Entry Time</th>
                    <th className="py-2.5 px-4 font-sans">Exit Time</th>
                    <th className="py-2.5 px-4 text-right font-sans">Entry</th>
                    <th className="py-2.5 px-4 text-right font-sans">Exit</th>
                    <th className="py-2.5 px-4 text-right font-sans">Costs</th>
                    <th className="py-2.5 px-4 text-right font-sans">Net P&amp;L</th>
                    <th className="py-2.5 px-4 font-sans">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                  {displayResult.trades.map((tr) => (
                    <tr key={tr.id}>
                      <td className="py-2 px-4 text-slate-500">{tr.id}</td>
                      <td className={`py-2 px-4 font-semibold ${tr.side === 'BUY' ? 'text-emerald-500' : 'text-red-500'}`}>
                        {tr.side}
                      </td>
                      <td className="py-2 px-4">{tr.entryTime}</td>
                      <td className="py-2 px-4">{tr.exitTime}</td>
                      <td className="py-2 px-4 text-right">{tr.entryPrice.toFixed(2)}</td>
                      <td className="py-2 px-4 text-right">{tr.exitPrice.toFixed(2)}</td>
                      <td className="py-2 px-4 text-right text-slate-500">₹{tr.costs.toFixed(2)}</td>
                      <td className={`py-2 px-4 text-right font-semibold ${tr.netPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {tr.netPnl >= 0 ? '+' : ''}₹{tr.netPnl.toFixed(2)}
                      </td>
                      <td className="py-2 px-4 font-sans text-slate-500">{tr.exitReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Past Backtest Runs Comparison */}
          {results.length > 1 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-3">
              <h3 className="font-display text-base font-semibold">Saved Strategy Comparison</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-left">
                      <th className="py-2 px-3 font-sans">Strategy</th>
                      <th className="py-2 px-3 font-sans">Window</th>
                      <th className="py-2 px-3 text-right font-sans">Return %</th>
                      <th className="py-2 px-3 text-right font-sans">Win Rate</th>
                      <th className="py-2 px-3 text-right font-sans">Sharpe</th>
                      <th className="py-2 px-3 text-right font-sans">Max DD</th>
                      <th className="py-2 px-3 text-right font-sans">Inspect</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                    {results.map((r, i) => (
                      <tr key={r.id ?? i}>
                        <td className="py-2 px-3 font-sans font-medium">{r.strategy}</td>
                        <td className="py-2 px-3 text-slate-500">{r.dateRange}</td>
                        <td className={`py-2 px-3 text-right ${r.metrics.totalReturnPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          {r.metrics.totalReturnPct.toFixed(2)}%
                        </td>
                        <td className="py-2 px-3 text-right">{r.metrics.winRatePct.toFixed(1)}%</td>
                        <td className="py-2 px-3 text-right">{r.metrics.sharpeRatio.toFixed(2)}</td>
                        <td className="py-2 px-3 text-right text-red-500">-{r.metrics.maxDrawdownPct.toFixed(2)}%</td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => setActiveResult(r)}
                            className="text-sky-500 hover:underline font-sans"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-10 text-center text-sm text-slate-500">
          Configure parameters above and click <strong>Run Historical Backtest</strong> to compute equity curve, Sharpe ratio, and trade history.
        </div>
      )}
    </div>
  );
};
