import React, { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  LineSeries,
  Time,
  createChart,
} from 'lightweight-charts';
import { EnrichedCandle } from '../types/trading';

interface CandlestickChartProps {
  candles: EnrichedCandle[];
  hasVolume: boolean;
  isDark?: boolean;
}

type RangeKey = '1D' | '3D' | '5D' | 'ALL';

const IST_OFFSET = 19800;

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  candles,
  hasVolume,
  isDark = true,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const candleMapRef = useRef<Map<number, EnrichedCandle>>(new Map());
  const prevMetaRef = useRef<{ firstTs: number; count: number; range: RangeKey }>({
    firstTs: 0,
    count: 0,
    range: '3D',
  });

  const [range, setRange] = useState<RangeKey>('3D');
  const [showEma20, setShowEma20] = useState(true);
  const [showSma50, setShowSma50] = useState(true);
  const [hovered, setHovered] = useState<EnrichedCandle | null>(null);

  const visibleCandles = React.useMemo(() => {
    if (candles.length === 0) return [];
    if (range === '1D') return candles.slice(-75);
    if (range === '3D') return candles.slice(-225);
    if (range === '5D') return candles.slice(-375);
    return candles;
  }, [candles, range]);

  const latestCandle = visibleCandles[visibleCandles.length - 1] ?? null;
  const activeBar = hovered ?? latestCandle;

  // Initialize chart & series once per visual configuration
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 410,
      layout: {
        background: { type: ColorType.Solid, color: isDark ? '#0B111C' : '#FFFFFF' },
        textColor: isDark ? '#94A3B8' : '#475569',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(148, 163, 184, 0.07)' : 'rgba(15, 23, 42, 0.06)' },
        horzLines: { color: isDark ? 'rgba(148, 163, 184, 0.07)' : 'rgba(15, 23, 42, 0.06)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(56, 189, 248, 0.4)', labelBackgroundColor: '#0284C7' },
        horzLine: { color: 'rgba(56, 189, 248, 0.4)', labelBackgroundColor: '#0284C7' },
      },
      rightPriceScale: {
        borderColor: isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.12)',
      },
      timeScale: {
        borderColor: isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.12)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    emaSeriesRef.current = showEma20
      ? chart.addSeries(LineSeries, {
          color: '#38BDF8',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        })
      : null;

    smaSeriesRef.current = showSma50
      ? chart.addSeries(LineSeries, {
          color: '#F59E0B',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        })
      : null;

    if (hasVolume) {
      const vol = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });
      vol.priceScale().applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });
      volSeriesRef.current = vol;
    } else {
      volSeriesRef.current = null;
    }

    // Force fresh setData on newly initialized series
    prevMetaRef.current = { firstTs: 0, count: 0, range };

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHovered(null);
        return;
      }
      const match = candleMapRef.current.get(Number(param.time));
      setHovered(match ?? null);
    });

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      emaSeriesRef.current = null;
      smaSeriesRef.current = null;
      volSeriesRef.current = null;
    };
  }, [hasVolume, showEma20, showSma50, isDark]);

  // Incrementally update live ticks in-place without flickering or resetting user zoom
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const chart = chartRef.current;
    if (!candleSeries || !chart || visibleCandles.length === 0) return;

    const firstTs = visibleCandles[0].timestamp;
    const prev = prevMetaRef.current;
    const isIncrementalTick =
      prev.count > 0 &&
      prev.range === range &&
      (visibleCandles.length === prev.count || visibleCandles.length === prev.count + 1) &&
      Math.abs(firstTs - prev.firstTs) <= 600;

    if (isIncrementalTick) {
      const last = visibleCandles[visibleCandles.length - 1];
      const displayTime = (last.timestamp + IST_OFFSET) as Time;
      candleMapRef.current.set(Number(displayTime), last);
      candleSeries.update({
        time: displayTime,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
      });
      if (emaSeriesRef.current && last.ema20 !== null) {
        emaSeriesRef.current.update({ time: displayTime, value: last.ema20 });
      }
      if (smaSeriesRef.current && last.sma50 !== null) {
        smaSeriesRef.current.update({ time: displayTime, value: last.sma50 });
      }
      if (volSeriesRef.current) {
        volSeriesRef.current.update({
          time: displayTime,
          value: last.volume ?? 0,
          color: last.close >= last.open ? 'rgba(16, 185, 129, 0.28)' : 'rgba(239, 68, 68, 0.28)',
        });
      }
    } else {
      const map = new Map<number, EnrichedCandle>();
      const candleData = visibleCandles.map((c) => {
        const displayTime = c.timestamp + IST_OFFSET;
        map.set(displayTime, c);
        return {
          time: displayTime as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        };
      });
      candleMapRef.current = map;
      candleSeries.setData(candleData);

      if (emaSeriesRef.current) {
        emaSeriesRef.current.setData(
          visibleCandles
            .filter((c) => c.ema20 !== null)
            .map((c) => ({ time: (c.timestamp + IST_OFFSET) as Time, value: c.ema20! }))
        );
      }
      if (smaSeriesRef.current) {
        smaSeriesRef.current.setData(
          visibleCandles
            .filter((c) => c.sma50 !== null)
            .map((c) => ({ time: (c.timestamp + IST_OFFSET) as Time, value: c.sma50! }))
        );
      }
      if (volSeriesRef.current) {
        volSeriesRef.current.setData(
          visibleCandles.map((c) => ({
            time: (c.timestamp + IST_OFFSET) as Time,
            value: c.volume ?? 0,
            color: c.close >= c.open ? 'rgba(16, 185, 129, 0.28)' : 'rgba(239, 68, 68, 0.28)',
          }))
        );
      }
      chart.timeScale().fitContent();
    }

    prevMetaRef.current = { firstTs, count: visibleCandles.length, range };
  }, [visibleCandles, range, hasVolume, showEma20, showSma50, isDark]);

  const handleZoom = (factor: number) => {
    const chart = chartRef.current;
    if (!chart) return;
    const lr = chart.timeScale().getVisibleLogicalRange();
    if (!lr) return;
    const span = lr.to - lr.from;
    const center = (lr.from + lr.to) / 2;
    const newSpan = Math.max(15, span * factor);
    chart.timeScale().setVisibleLogicalRange({
      from: center - newSpan / 2,
      to: center + newSpan / 2,
    });
  };

  return (
    <div className="space-y-3">
      {/* Toolbar + OHLC Crosshair Readout */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800/80 pb-3">
        <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            BANK NIFTY · 5m
          </span>
          {activeBar && (
            <div className="flex flex-wrap items-center gap-3 text-slate-600 dark:text-slate-400">
              <span>
                {activeBar.date_str} {activeBar.time_str}
              </span>
              <span>
                O <strong className="text-slate-900 dark:text-slate-100">{activeBar.open.toFixed(2)}</strong>
              </span>
              <span>
                H <strong className="text-emerald-600 dark:text-emerald-400">{activeBar.high.toFixed(2)}</strong>
              </span>
              <span>
                L <strong className="text-red-600 dark:text-red-400">{activeBar.low.toFixed(2)}</strong>
              </span>
              <span>
                C <strong className="text-slate-900 dark:text-slate-100">{activeBar.close.toFixed(2)}</strong>
              </span>
              {hasVolume && activeBar.volume !== null && (
                <span>
                  Vol <strong className="text-slate-900 dark:text-slate-100">{activeBar.volume.toLocaleString('en-IN')}</strong>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Overlay toggles */}
          <button
            type="button"
            onClick={() => setShowEma20((v) => !v)}
            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
              showEma20
                ? 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                : 'border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            EMA 20
          </button>
          <button
            type="button"
            onClick={() => setShowSma50((v) => !v)}
            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
              showSma50
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            SMA 50
          </button>

          {/* Range selector */}
          <div className="flex items-center rounded border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/70 p-0.5">
            {(['1D', '3D', '5D', 'ALL'] as RangeKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setRange(key)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  range === key
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {key}
              </button>
            ))}
          </div>

          {/* Zoom controls */}
          <div className="flex items-center rounded border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => handleZoom(0.7)}
              aria-label="Zoom in"
              className="px-2.5 py-1 text-xs font-mono text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border-r border-slate-200 dark:border-slate-800"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => handleZoom(1.35)}
              aria-label="Zoom out"
              className="px-2.5 py-1 text-xs font-mono text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border-r border-slate-200 dark:border-slate-800"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => chartRef.current?.timeScale().fitContent()}
              className="px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              Fit
            </button>
          </div>
        </div>
      </div>

      {/* Chart Canvas */}
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800/80"
        style={{ height: 410 }}
      />
    </div>
  );
};
