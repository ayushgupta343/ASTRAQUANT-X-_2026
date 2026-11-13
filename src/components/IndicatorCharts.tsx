import React from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EnrichedCandle } from '../types/trading';

interface IndicatorChartsProps {
  candles: EnrichedCandle[];
  isDark?: boolean;
}

export const IndicatorCharts: React.FC<IndicatorChartsProps> = ({ candles, isDark = true }) => {
  const recent = React.useMemo(() => {
    return candles.slice(-100).map((c) => ({
      label: `${c.date_str.slice(5)} ${c.time_str}`,
      rsi: c.rsi,
      macd: c.macd,
      macdSignal: c.macdSignal,
      macdHist: c.macdHist,
    }));
  }, [candles]);

  const gridStroke = isDark ? 'rgba(148,163,184,0.08)' : 'rgba(15,23,42,0.07)';
  const tickColor = isDark ? '#64748B' : '#64748B';
  const tooltipStyle = {
    backgroundColor: isDark ? '#0D131F' : '#FFFFFF',
    borderColor: isDark ? 'rgba(148,163,184,0.2)' : '#CBD5E1',
    borderRadius: '8px',
    fontSize: '12px',
    fontFamily: 'JetBrains Mono, monospace',
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* RSI (14) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              RSI (14) Momentum Oscillator
            </h3>
            <p className="text-xs text-slate-500">Overbought 70 · Oversold 30 · Last 100 candles</p>
          </div>
          <span className="text-xs font-mono tabular-nums text-sky-600 dark:text-sky-400">
            {recent[recent.length - 1]?.rsi?.toFixed(2) ?? '—'}
          </span>
        </div>
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={recent} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: tickColor }}
                minTickGap={28}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[30, 50, 70]}
                tick={{ fontSize: 10, fill: tickColor }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <ReferenceLine y={70} stroke="#EF4444" strokeDasharray="3 3" strokeOpacity={0.6} />
              <ReferenceLine y={30} stroke="#10B981" strokeDasharray="3 3" strokeOpacity={0.6} />
              <Line
                type="monotone"
                dataKey="rsi"
                name="RSI (14)"
                stroke="#38BDF8"
                strokeWidth={1.75}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* MACD (12, 26, 9) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              MACD (12, 26, 9) Trend Divergence
            </h3>
            <p className="text-xs text-slate-500">MACD Line · Signal Line · Histogram</p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
            Hist {recent[recent.length - 1]?.macdHist?.toFixed(2) ?? '—'}
          </span>
        </div>
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={recent} margin={{ top: 6, right: 10, left: -16, bottom: 0 }}>
              <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: tickColor }}
                minTickGap={28}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: tickColor }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <ReferenceLine y={0} stroke="rgba(148,163,184,0.35)" />
              <Bar dataKey="macdHist" name="Histogram" isAnimationActive={false}>
                {recent.map((entry, idx) => (
                  <Cell
                    key={`hist-${idx}`}
                    fill={(entry.macdHist ?? 0) >= 0 ? 'rgba(16, 185, 129, 0.55)' : 'rgba(239, 68, 68, 0.55)'}
                  />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="macd"
                name="MACD"
                stroke="#38BDF8"
                strokeWidth={1.6}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="macdSignal"
                name="Signal"
                stroke="#F59E0B"
                strokeWidth={1.4}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
