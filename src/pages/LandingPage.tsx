import React, { useState } from 'react';
import { ArrowRight, BarChart2, BrainCircuit, Database, History, ShieldCheck, Wallet } from 'lucide-react';
import { MarketOverviewResponse, PageId } from '../types/trading';

interface LandingPageProps {
  overview: MarketOverviewResponse | null;
  onNavigate: (page: PageId) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ overview, onNavigate }) => {
  const [imgError, setImgError] = useState(false);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#070B12] text-slate-100">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#070B12]/90 backdrop-blur-md">
        <div className="max-w-[1360px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element brand wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            ASTRAQUANT X-2026
          </a>

          {/* Zone 2: 4 concise single-line nav links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
            <button
              type="button"
              onClick={() => scrollTo('features')}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Capabilities
            </button>
            <button
              type="button"
              onClick={() => scrollTo('workflow')}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              How It Works
            </button>
            <button
              type="button"
              onClick={() => scrollTo('stack')}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Architecture
            </button>
            <button
              type="button"
              onClick={() => scrollTo('objectives')}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Objectives
            </button>
          </nav>

          {/* Zone 3: 1 primary CTA */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Open Terminal
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section id="top" className="max-w-[1360px] mx-auto px-6 pt-14 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-between py-2 space-y-8">
            <div className="space-y-5">
              <div className="text-xs font-medium text-sky-400 tracking-wide">
                Bank NIFTY · 5-Minute Quantitative Analysis &amp; Applied AI
              </div>
              <h1
                className="font-display font-bold tracking-tight text-white leading-[1.08]"
                style={{ fontSize: 'clamp(2.25rem, 3.8vw, 3.5rem)', textWrap: 'balance' }}
              >
                Where Artificial Intelligence Meets Intelligent Trading.
              </h1>
              <p className="text-base text-slate-300 leading-relaxed max-w-xl">
                ASTRAQUANT X-2026 combines 5-minute Bank NIFTY OHLCV candlestick analytics,
                causal RSI and MACD indicator engineering, a chronological Random Forest classifier,
                historical strategy backtesting, and simulated paper trading in one institutional terminal.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => onNavigate('dashboard')}
                className="px-6 py-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                <span>Get Started</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('ml')}
                className="px-5 py-3 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-200 text-sm font-medium transition-colors whitespace-nowrap"
              >
                Explore ML Pipeline
              </button>
            </div>
          </div>

          {/* Right Hero Visual */}
          <div className="lg:col-span-6">
            <div className="h-full min-h-[300px] lg:min-h-[380px] rounded-xl overflow-hidden border border-slate-800 bg-[#0D131F] relative">
              {!imgError ? (
                <img
                  src="/src/assets/images/hero_quant_terminal_1794572019703.jpg"
                  alt="ASTRAQUANT X-2026 institutional quantitative trading desk displaying Bank NIFTY candlestick charts and equity analytics"
                  referrerPolicy="no-referrer"
                  onError={() => setImgError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-gradient-to-br from-[#0D131F] via-[#0B1526] to-[#070B12] text-center">
                  <BarChart2 className="w-10 h-10 text-sky-400 mb-3" />
                  <p className="font-display text-lg font-semibold text-white">ASTRAQUANT X-2026 Terminal</p>
                  <p className="text-xs text-slate-400 mt-1">Bank NIFTY 5m Candlestick &amp; Random Forest Analytics</p>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#070B12]/70 via-transparent to-transparent pointer-events-none" />
              <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-200">
                <span>Bank NIFTY 5m Quantitative Workstation</span>
                <span className="font-mono text-slate-300">Paper Mode · ₹1,00,000 Virtual Capital</span>
              </div>
            </div>
          </div>
        </div>

        {/* Full-Width 4-Column Market Overview Strip */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-800/90 rounded-xl bg-[#0D131F] divide-y sm:divide-y-0 sm:divide-x divide-slate-800/80">
          <div className="p-5">
            <div className="text-xs text-slate-400">Bank NIFTY Index (Loaded Data)</div>
            <div className="mt-1.5 flex items-baseline gap-3">
              <span className="font-mono text-2xl font-semibold tabular-nums text-white">
                {overview?.hasData && overview.currentPrice
                  ? overview.currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })
                  : '—'}
              </span>
              {overview?.hasData && overview.dailyChangePct !== undefined && (
                <span
                  className={`font-mono text-xs font-medium tabular-nums ${
                    overview.dailyChangePct >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {overview.dailyChangePct >= 0 ? '+' : ''}
                  {overview.dailyChangePct.toFixed(2)}%
                </span>
              )}
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs text-slate-400">Session Range (High / Low)</div>
            <div className="mt-1.5 font-mono text-base font-medium tabular-nums text-slate-100">
              {overview?.hasData && overview.dayHigh && overview.dayLow
                ? `${overview.dayHigh.toLocaleString('en-IN')} / ${overview.dayLow.toLocaleString('en-IN')}`
                : '—'}
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs text-slate-400">Technical State (RSI 14 · Trend)</div>
            <div className="mt-1.5 font-mono text-base font-medium tabular-nums text-slate-100">
              {overview?.indicators?.rsi !== null && overview?.indicators?.rsi !== undefined
                ? `RSI ${overview.indicators.rsi} · ${overview.indicators.trendDirection.split(' ')[0]}`
                : 'Awaiting Data'}
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs text-slate-400">Dataset Provenance</div>
            <div className="mt-1.5 text-sm font-medium text-sky-400 truncate">
              {overview?.dataLabel ?? 'Loading...'}
            </div>
          </div>
        </div>
      </section>

      {/* Core Features Bento Grid */}
      <section id="features" className="max-w-[1360px] mx-auto px-6 py-16 border-t border-slate-800/70">
        <div className="max-w-2xl mb-10">
          <h2 className="font-display text-2xl sm:text-3xl font-semibold text-white">
            Core Platform Modules
          </h2>
          <p className="mt-2 text-sm sm:text-base text-slate-400">
            Every view operates on verified historical OHLCV records and real server-side quantitative computations.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Featured wide card */}
          <div className="md:col-span-2 rounded-xl border border-slate-800 bg-[#0D131F] p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-medium text-sky-400">01. Interactive Market Terminal</span>
                <BarChart2 className="w-4 h-4 text-slate-500" />
              </div>
              <h3 className="font-display text-xl font-semibold text-white">
                5-Minute Bank NIFTY Candlestick &amp; Indicator Engine
              </h3>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed max-w-2xl">
                Zoomable TradingView Lightweight Charts canvas paired with synchronized RSI (14), MACD (12, 26, 9),
                EMA (20), SMA (50), rolling volatility, and crosshair OHLCV inspection. Supports custom CSV ingestion
                and clearly distinguishes historical sample data from uploaded market datasets.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
              <span>5m Candlestick · Volume · EMA/SMA Overlays</span>
              <button
                type="button"
                onClick={() => onNavigate('dashboard')}
                className="text-sky-400 hover:text-sky-300 font-medium whitespace-nowrap"
              >
                Open Dashboard →
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0D131F] p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-medium text-sky-400">02. Applied Machine Learning</span>
                <BrainCircuit className="w-4 h-4 text-slate-500" />
              </div>
              <h3 className="font-display text-lg font-semibold text-white">
                Chronological Random Forest
              </h3>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                70% Train / 15% Validation / 15% Test time-ordered splitting without shuffling. Predicts 15-minute
                (3-candle) BUY, SELL, and HOLD classes with confusion matrix and feature importance metrics.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-800/80 flex justify-end">
              <button
                type="button"
                onClick={() => onNavigate('ml')}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium"
              >
                Train &amp; Evaluate →
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0D131F] p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-medium text-emerald-400">03. Simulated Execution</span>
                <Wallet className="w-4 h-4 text-slate-500" />
              </div>
              <h3 className="font-display text-lg font-semibold text-white">
                ₹1,00,000 Paper Trading Desk
              </h3>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                Execute simulated BUY and SELL orders with configurable stop-loss and target levels, live unrealized
                mark-to-market P&amp;L, realized ledger, and risk-limit checks.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-800/80 flex justify-end">
              <button
                type="button"
                onClick={() => onNavigate('paper')}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium"
              >
                Launch Paper Desk →
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0D131F] p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-medium text-amber-400">04. Strategy Validation</span>
                <History className="w-4 h-4 text-slate-500" />
              </div>
              <h3 className="font-display text-lg font-semibold text-white">
                Causal Historical Backtester
              </h3>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                Test ML, RSI+MACD, or EMA strategies across historical windows with brokerage charges, slippage,
                equity curves, Sharpe ratio, profit factor, and maximum drawdown.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-800/80 flex justify-end">
              <button
                type="button"
                onClick={() => onNavigate('backtest')}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium"
              >
                Run Backtest →
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0D131F] p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-medium text-slate-300">05. Data &amp; Risk Controls</span>
                <Database className="w-4 h-4 text-slate-500" />
              </div>
              <h3 className="font-display text-lg font-semibold text-white">
                CSV Validation &amp; Position Sizing
              </h3>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                Upload 5-minute OHLCV CSVs, inspect missing or duplicate bars, clean invalid OHLC relationships,
                and compute disciplined capital-at-risk position sizes.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-800/80 flex justify-end gap-4">
              <button
                type="button"
                onClick={() => onNavigate('data')}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium"
              >
                Manage Data →
              </button>
              <button
                type="button"
                onClick={() => onNavigate('risk')}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium"
              >
                Risk Calculators →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="workflow" className="max-w-[1360px] mx-auto px-6 py-16 border-t border-slate-800/70">
        <div className="max-w-2xl mb-10">
          <h2 className="font-display text-2xl sm:text-3xl font-semibold text-white">
            How the Quantitative Pipeline Works
          </h2>
          <p className="mt-2 text-sm sm:text-base text-slate-400">
            Designed to eliminate look-ahead bias while linking technical analysis, machine learning, and execution.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[
            {
              step: '01. Ingest & Validate',
              desc: 'Load 5-minute Bank NIFTY OHLCV data, verify High/Low integrity, and remove duplicate timestamps.',
            },
            {
              step: '02. Feature Engineering',
              desc: 'Compute causal RSI(14), MACD(12,26,9), 1-bar returns, 14-bar rolling volatility, and candle geometry.',
            },
            {
              step: '03. Chronological Split',
              desc: 'Partition strictly in time order (70% train, 15% validation, 15% test) with 3-candle forward labels.',
            },
            {
              step: '04. Signal & Levels',
              desc: 'Derive BUY, SELL, or HOLD predictions with confidence, volatility-scaled Stop-Loss, and Target.',
            },
            {
              step: '05. Backtest & Paper Trade',
              desc: 'Simulate historical equity with slippage and costs, or execute paper trades against virtual ₹1,00,000.',
            },
          ].map((item) => (
            <div
              key={item.step}
              className="rounded-xl border border-slate-800 bg-[#0D131F] p-5 space-y-2"
            >
              <div className="text-xs font-semibold text-sky-400">{item.step}</div>
              <p className="text-sm text-slate-300 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tech Stack & Project Objectives */}
      <section id="stack" className="max-w-[1360px] mx-auto px-6 py-16 border-t border-slate-800/70">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="rounded-xl border border-slate-800 bg-[#0D131F] p-6 space-y-5">
            <h2 className="font-display text-xl font-semibold text-white">Technology Stack</h2>
            <div className="divide-y divide-slate-800/80 text-sm">
              <div className="py-3 flex justify-between gap-4">
                <span className="text-slate-400">Frontend Terminal</span>
                <span className="text-slate-100 font-medium text-right">React 19 · TypeScript · Tailwind CSS</span>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <span className="text-slate-400">Financial Charting</span>
                <span className="text-slate-100 font-medium text-right">TradingView Lightweight Charts · Recharts</span>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <span className="text-slate-400">Backend &amp; REST APIs</span>
                <span className="text-slate-100 font-medium text-right">Node.js · Express · TypeScript</span>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <span className="text-slate-400">Machine Learning</span>
                <span className="text-slate-100 font-medium text-right">Random Forest Classifier · Python Reference Pipeline</span>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <span className="text-slate-400">Persistence Layer</span>
                <span className="text-slate-100 font-medium text-right">SQLite (Embedded) · PostgreSQL Schema Ready</span>
              </div>
            </div>
          </div>

          <div id="objectives" className="rounded-xl border border-slate-800 bg-[#0D131F] p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-white">Project Objectives</h2>
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <ul className="space-y-3 text-sm text-slate-300">
              <li className="flex items-start gap-2.5">
                <span className="text-sky-400 font-mono text-xs mt-0.5">01</span>
                <span>Analyze Bank NIFTY 5-minute movements using real calculated technical indicators.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="text-sky-400 font-mono text-xs mt-0.5">02</span>
                <span>Generate transparent BUY, SELL, and HOLD signals with Entry, Stop-Loss, and Target levels.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="text-sky-400 font-mono text-xs mt-0.5">03</span>
                <span>Validate trading rules causally through historical backtesting before committing virtual capital.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="text-sky-400 font-mono text-xs mt-0.5">04</span>
                <span>Maintain strict paper-trading isolation first, with modular architecture prepared for future broker APIs and options contracts.</span>
              </li>
            </ul>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => onNavigate('dashboard')}
                className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition-colors"
              >
                Launch Trading Dashboard
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-800/80 py-8 px-6">
        <div className="max-w-[1360px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            <span className="font-display font-semibold text-slate-300">ASTRAQUANT X-2026</span>
            <span className="mx-2">·</span>
            <span>Intelligent Trading &amp; Applied AI Platform for Bank NIFTY</span>
          </div>
          <div>
            Analytical &amp; Paper Trading Environment · Historical predictions do not guarantee future market performance.
          </div>
        </div>
      </footer>
    </div>
  );
};
