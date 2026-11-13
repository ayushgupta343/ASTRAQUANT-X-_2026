import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  AppSettings,
  MarketOverviewResponse,
  RiskGuardrailStatusLevel,
  RiskTelemetry,
} from '../types/trading';

interface RiskManagementPageProps {
  currentPrice: number;
  overview: MarketOverviewResponse | null;
  settings: AppSettings | null;
  riskTelemetry: RiskTelemetry | null;
  onSaveRiskLimits: (updated: AppSettings) => Promise<void>;
  onResetCooldown: () => Promise<void>;
}

function badgeClasses(status: RiskGuardrailStatusLevel): string {
  if (status === 'TRIGGERED') {
    return 'border-red-500/40 bg-red-500/15 text-red-600 dark:text-red-400';
  }
  if (status === 'WARNING') {
    return 'border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-400';
  }
  return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
}

export const RiskManagementPage: React.FC<RiskManagementPageProps> = ({
  currentPrice,
  overview,
  settings,
  riskTelemetry,
  onSaveRiskLimits,
  onResetCooldown,
}) => {
  const liveAtr = overview?.indicators?.atr ?? riskTelemetry?.latestAtr ?? 110;
  const lotSize = 15;

  // Calculator state
  const [calcMode, setCalcMode] = useState<'atr_dynamic' | 'fixed_pct'>(
    settings?.trading.stopLossMode ?? 'atr_dynamic'
  );
  const [instrumentMode, setInstrumentMode] = useState<'INDEX' | 'OPTION'>('OPTION');
  const [capital, setCapital] = useState(100000);
  const [riskPct, setRiskPct] = useState(settings?.trading.riskPerTradePct ?? 1.0);
  const [entryPrice, setEntryPrice] = useState(
    overview?.prediction?.optionRecommendation?.entryPremium ?? 265
  );
  const [atrInput, setAtrInput] = useState<number>(Number(liveAtr.toFixed(2)));
  const [optionDelta, setOptionDelta] = useState<number>(
    Math.abs(overview?.prediction?.optionRecommendation?.delta ?? 0.5)
  );
  const [atrStopMult, setAtrStopMult] = useState<number>(settings?.trading.atrStopMult ?? 1.2);
  const [atrTargetMult, setAtrTargetMult] = useState<number>(settings?.trading.atrTargetMult ?? 2.4);
  const [stopLossPct, setStopLossPct] = useState(settings?.trading.defaultStopLossPct ?? 0.35);
  const [targetPct, setTargetPct] = useState(settings?.trading.defaultTargetPct ?? 0.7);
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY');

  // Guardrails state
  const [dailyMaxLoss, setDailyMaxLoss] = useState(settings?.trading.dailyMaxLoss ?? 3000);
  const [maxOpenPositions, setMaxOpenPositions] = useState(settings?.trading.maxOpenPositions ?? 3);
  const [adxChopFilterEnabled, setAdxChopFilterEnabled] = useState(
    settings?.trading.adxChopFilterEnabled ?? true
  );
  const [adxMinThreshold, setAdxMinThreshold] = useState(settings?.trading.adxMinThreshold ?? 18);
  const [consecutiveLossCooldownEnabled, setConsecutiveLossCooldownEnabled] = useState(
    settings?.trading.consecutiveLossCooldownEnabled ?? true
  );
  const [consecutiveLossLimit, setConsecutiveLossLimit] = useState(
    settings?.trading.consecutiveLossLimit ?? 2
  );
  const [cooldownCandles, setCooldownCandles] = useState(settings?.trading.cooldownCandles ?? 6);
  const [timeBasedOptionExitEnabled, setTimeBasedOptionExitEnabled] = useState(
    settings?.trading.timeBasedOptionExitEnabled ?? true
  );
  const [optionMaxHoldCandles, setOptionMaxHoldCandles] = useState(
    settings?.trading.optionMaxHoldCandles ?? 6
  );

  const [saving, setSaving] = useState(false);
  const [resettingCooldown, setResettingCooldown] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setCalcMode(settings.trading.stopLossMode ?? 'atr_dynamic');
    setRiskPct(settings.trading.riskPerTradePct ?? 1.0);
    setAtrStopMult(settings.trading.atrStopMult ?? 1.2);
    setAtrTargetMult(Math.max((settings.trading.atrStopMult ?? 1.2) * 2, settings.trading.atrTargetMult ?? 2.4));
    setStopLossPct(settings.trading.defaultStopLossPct ?? 0.35);
    setTargetPct(settings.trading.defaultTargetPct ?? 0.7);
    setDailyMaxLoss(settings.trading.dailyMaxLoss ?? 3000);
    setMaxOpenPositions(settings.trading.maxOpenPositions ?? 3);
    setAdxChopFilterEnabled(settings.trading.adxChopFilterEnabled ?? true);
    setAdxMinThreshold(settings.trading.adxMinThreshold ?? 18);
    setConsecutiveLossCooldownEnabled(settings.trading.consecutiveLossCooldownEnabled ?? true);
    setConsecutiveLossLimit(settings.trading.consecutiveLossLimit ?? 2);
    setCooldownCandles(settings.trading.cooldownCandles ?? 6);
    setTimeBasedOptionExitEnabled(settings.trading.timeBasedOptionExitEnabled ?? true);
    setOptionMaxHoldCandles(settings.trading.optionMaxHoldCandles ?? 6);
  }, [settings]);

  useEffect(() => {
    if (liveAtr > 0) {
      setAtrInput(Number(liveAtr.toFixed(2)));
    }
  }, [liveAtr]);

  const handleInstrumentToggle = (nextInst: 'INDEX' | 'OPTION') => {
    setInstrumentMode(nextInst);
    if (nextInst === 'INDEX') {
      setEntryPrice(Number((currentPrice || 53760).toFixed(2)));
      setDirection('BUY');
    } else {
      setEntryPrice(overview?.prediction?.optionRecommendation?.entryPremium ?? 265);
      setOptionDelta(Math.abs(overview?.prediction?.optionRecommendation?.delta ?? 0.5));
      setDirection('BUY');
    }
  };

  // Enforce >= 1:2 R:R in ATR-Dynamic mode
  const effectiveTargetMult = Math.max(atrStopMult * 2, atrTargetMult);

  let slPoints = 0;
  let targetPoints = 0;
  if (calcMode === 'atr_dynamic') {
    if (instrumentMode === 'OPTION') {
      const rawPremSl = Math.abs(optionDelta) * atrInput * atrStopMult;
      slPoints = Math.min(entryPrice * 0.45, Math.max(entryPrice * 0.08, rawPremSl));
      targetPoints = slPoints * (effectiveTargetMult / Math.max(0.1, atrStopMult));
    } else {
      slPoints = atrInput * atrStopMult;
      targetPoints = atrInput * effectiveTargetMult;
    }
  } else {
    slPoints = (entryPrice * stopLossPct) / 100;
    targetPoints = (entryPrice * targetPct) / 100;
  }

  const stopLossPrice = Math.max(
    instrumentMode === 'OPTION' ? 1 : 0,
    direction === 'BUY' ? entryPrice - slPoints : entryPrice + slPoints
  );
  const targetPrice = Math.max(
    instrumentMode === 'OPTION' ? 1 : 0,
    direction === 'BUY' ? entryPrice + targetPoints : entryPrice - targetPoints
  );

  // Volatility-Adjusted Bank NIFTY Position Sizing (Lot Size = 15)
  const maxRiskRupees = (capital * riskPct) / 100;
  const riskPerLot = Math.max(1, slPoints * lotSize);
  const exactLots = slPoints > 0 ? maxRiskRupees / riskPerLot : 0;
  const recommendedLots = Math.max(1, Math.floor(exactLots));
  const recommendedQty = recommendedLots * lotSize;
  const stopOutLossAtLots = recommendedLots * riskPerLot;
  const riskReward = slPoints > 0 ? targetPoints / slPoints : 0;
  const capitalUtilPct =
    capital > 0
      ? instrumentMode === 'OPTION'
        ? ((recommendedQty * entryPrice) / capital) * 100
        : ((recommendedQty * entryPrice * 0.1) / capital) * 100
      : 0;

  const handleSaveLimits = async () => {
    if (!settings) return;
    setSaving(true);
    setSavedMsg(null);
    const enforcedTargetMult = Math.max(atrStopMult * 2, atrTargetMult);
    try {
      await onSaveRiskLimits({
        ...settings,
        trading: {
          ...settings.trading,
          defaultStopLossPct: stopLossPct,
          defaultTargetPct: targetPct,
          riskPerTradePct: riskPct,
          stopLossMode: calcMode,
          atrStopMult,
          atrTargetMult: enforcedTargetMult,
          dailyMaxLoss,
          maxOpenPositions,
          adxChopFilterEnabled,
          adxMinThreshold,
          consecutiveLossCooldownEnabled,
          consecutiveLossLimit,
          cooldownCandles,
          timeBasedOptionExitEnabled,
          optionMaxHoldCandles,
        },
      });
      setSavedMsg('ATR risk limits, regime filters, and circuit breakers saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleManualCooldownReset = async () => {
    setResettingCooldown(true);
    try {
      await onResetCooldown();
    } finally {
      setResettingCooldown(false);
    }
  };

  const g = riskTelemetry?.guardrails;

  return (
    <div className="space-y-6">
      {/* Live Risk Guardrail Telemetry */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {riskTelemetry?.overallStatus === 'TRIGGERED' ? (
              <AlertTriangle className="w-4 h-4 text-red-500" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
            )}
            <div>
              <h2 className="font-display text-base font-semibold">Live Risk Guardrail Telemetry</h2>
              <p className="text-xs text-slate-500">
                Real-time regime filters, consecutive-loss cooldown, theta time-exit, and daily loss kill-switch
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-mono tabular-nums text-slate-500">
              ATR(14):{' '}
              <strong className="text-slate-800 dark:text-slate-200">
                {riskTelemetry?.latestAtr?.toFixed(2) ?? liveAtr.toFixed(2)} pts
              </strong>
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              ADX(14):{' '}
              <strong className="text-slate-800 dark:text-slate-200">
                {riskTelemetry?.latestAdx?.toFixed(1) ?? '—'}
              </strong>
            </span>
            <button
              type="button"
              disabled={resettingCooldown}
              onClick={handleManualCooldownReset}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:border-sky-500 text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-sky-500" />
              <span>{resettingCooldown ? 'Resetting...' : 'Reset Cooldown'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Daily Loss Cap */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">Daily Loss Cap</span>
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${badgeClasses(
                  g?.dailyLossCap.status ?? 'ACTIVE'
                )}`}
              >
                {g?.dailyLossCap.status ?? 'ACTIVE'}
              </span>
            </div>
            <div className="font-mono text-xs tabular-nums text-slate-700 dark:text-slate-200">
              {g?.dailyLossCap.detail ?? `Daily Net P&L ₹0 / -₹${dailyMaxLoss} cap`}
            </div>
          </div>

          {/* Max Open Positions */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">Max Open Positions</span>
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${badgeClasses(
                  g?.maxOpenPositions.status ?? 'ACTIVE'
                )}`}
              >
                {g?.maxOpenPositions.status ?? 'ACTIVE'}
              </span>
            </div>
            <div className="font-mono text-xs tabular-nums text-slate-700 dark:text-slate-200">
              {g?.maxOpenPositions.detail ?? `0/${maxOpenPositions} active positions`}
            </div>
          </div>

          {/* ADX Regime Filter */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">ADX Regime Filter</span>
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${badgeClasses(
                  g?.adxRegimeFilter.status ?? 'ACTIVE'
                )}`}
              >
                {g?.adxRegimeFilter.status ?? 'ACTIVE'}
              </span>
            </div>
            <div className="font-mono text-xs tabular-nums text-slate-700 dark:text-slate-200">
              {g?.adxRegimeFilter.detail ?? `Min ADX(14) ≥ ${adxMinThreshold}`}
            </div>
          </div>

          {/* Consecutive-Loss Cooldown */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">Loss Cooldown</span>
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${badgeClasses(
                  g?.consecutiveLossCooldown.status ?? 'ACTIVE'
                )}`}
              >
                {g?.consecutiveLossCooldown.status ?? 'ACTIVE'}
              </span>
            </div>
            <div className="font-mono text-xs tabular-nums text-slate-700 dark:text-slate-200">
              {g?.consecutiveLossCooldown.detail ?? `Streak 0/${consecutiveLossLimit} · Clear`}
            </div>
          </div>

          {/* Time-Based Option Exit */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">Option Time Exit</span>
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${
                  (g?.timeBasedOptionExit.enabled ?? timeBasedOptionExitEnabled)
                    ? 'border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-400'
                    : 'border-slate-400/40 bg-slate-500/10 text-slate-500'
                }`}
              >
                {(g?.timeBasedOptionExit.enabled ?? timeBasedOptionExitEnabled) ? 'ARMED' : 'OFF'}
              </span>
            </div>
            <div className="font-mono text-xs tabular-nums text-slate-700 dark:text-slate-200">
              Exit CE/PE at {g?.timeBasedOptionExit.maxHoldCandles ?? optionMaxHoldCandles} candles (
              {(g?.timeBasedOptionExit.maxHoldCandles ?? optionMaxHoldCandles) * 5}m) · Max held:{' '}
              {g?.timeBasedOptionExit.maxCandlesHeld ?? 0}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ATR-Dynamic Position Sizing & SL/Target Calculator */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-sky-500" />
              <h2 className="font-display text-base font-semibold">
                Volatility-Adjusted Position Sizing &amp; ATR Levels
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* ATR-Dynamic vs Fixed % Mode */}
              <div className="flex items-center gap-1 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setCalcMode('atr_dynamic')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded ${
                    calcMode === 'atr_dynamic'
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  ATR-Dynamic (1:2)
                </button>
                <button
                  type="button"
                  onClick={() => setCalcMode('fixed_pct')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded ${
                    calcMode === 'fixed_pct'
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Fixed %
                </button>
              </div>

              {/* Instrument Toggle */}
              <div className="flex items-center gap-1 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => handleInstrumentToggle('OPTION')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded ${
                    instrumentMode === 'OPTION'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  ATM Option
                </button>
                <button
                  type="button"
                  onClick={() => handleInstrumentToggle('INDEX')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded ${
                    instrumentMode === 'INDEX'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Index Spot
                </button>
              </div>

              {/* Direction */}
              <div className="flex items-center gap-1 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800">
                {(['BUY', 'SELL'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirection(d)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded ${
                      direction === d
                        ? d === 'BUY'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-red-600 text-white'
                        : 'text-slate-500'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block text-slate-500 mb-1">Trading Capital (₹)</label>
              <input
                type="number"
                min={10000}
                step={5000}
                value={capital}
                onChange={(e) => setCapital(Math.max(1000, Number(e.target.value)))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">Risk Per Trade (% of Capital)</label>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={riskPct}
                onChange={(e) => setRiskPct(Math.max(0.1, Number(e.target.value)))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">
                {instrumentMode === 'OPTION' ? 'Option Entry Premium (₹)' : 'Index Entry Price'}
              </label>
              <input
                type="number"
                step="0.5"
                value={entryPrice}
                onChange={(e) => setEntryPrice(Math.max(1, Number(e.target.value)))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
              />
            </div>

            {calcMode === 'atr_dynamic' ? (
              <>
                <div>
                  <label className="block text-slate-500 mb-1">Spot ATR(14) Points</label>
                  <input
                    type="number"
                    min={10}
                    step={5}
                    value={atrInput}
                    onChange={(e) => setAtrInput(Math.max(5, Number(e.target.value)))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">SL / Target ATR Mult (Min 1:2)</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min={0.5}
                      step={0.1}
                      value={atrStopMult}
                      onChange={(e) => {
                        const s = Math.max(0.5, Number(e.target.value));
                        setAtrStopMult(s);
                        if (atrTargetMult < s * 2) setAtrTargetMult(Number((s * 2).toFixed(2)));
                      }}
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
                    />
                    <input
                      type="number"
                      min={atrStopMult * 2}
                      step={0.2}
                      value={effectiveTargetMult}
                      onChange={(e) => setAtrTargetMult(Math.max(atrStopMult * 2, Number(e.target.value)))}
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
                    />
                  </div>
                </div>
                {instrumentMode === 'OPTION' && (
                  <div>
                    <label className="block text-slate-500 mb-1">Option |Delta| (BS)</label>
                    <input
                      type="number"
                      min={0.1}
                      max={1.0}
                      step={0.05}
                      value={optionDelta}
                      onChange={(e) => setOptionDelta(Math.min(1, Math.max(0.1, Number(e.target.value))))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="sm:col-span-2 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1">Stop-Loss (%)</label>
                  <input
                    type="number"
                    min={0.05}
                    step={0.05}
                    value={stopLossPct}
                    onChange={(e) => setStopLossPct(Math.max(0.05, Number(e.target.value)))}
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
                    onChange={(e) => setTargetPct(Math.max(0.05, Number(e.target.value)))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Computed Outputs */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800/80 grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-slate-500">Max Risk Budget ({riskPct.toFixed(1)}%)</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-red-500">
                ₹{maxRiskRupees.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Volatility Position Size</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-sky-500">
                {recommendedLots} {recommendedLots === 1 ? 'lot' : 'lots'} ({recommendedQty} units)
              </div>
              <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                Exact: {exactLots.toFixed(2)} lots · SL Loss: ₹{stopOutLossAtLots.toFixed(0)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Enforced Risk / Reward</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-500">
                1 : {riskReward.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Stop-Loss Level</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums text-red-500">
                {stopLossPrice.toFixed(2)} (Δ {slPoints.toFixed(1)} pts)
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Take-Profit Target</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums text-emerald-500">
                {targetPrice.toFixed(2)} (Δ {targetPoints.toFixed(1)} pts)
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Capital / Margin Util</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums">
                {capitalUtilPct.toFixed(1)}% (1 lot = ₹{riskPerLot.toFixed(0)} risk)
              </div>
            </div>
          </div>
        </div>

        {/* Configurable Circuit-Breaker & Regime Guardrails */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-sky-500" />
            <div>
              <h2 className="font-display text-base font-semibold">Circuit-Breaker &amp; Regime Guardrails</h2>
              <p className="text-xs text-slate-500">
                Persisted in backend state &amp; enforced across paper trading and automated execution.
              </p>
            </div>
          </div>

          <div className="space-y-3.5 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-500 mb-1">Daily Max Loss Kill-Switch (₹)</label>
                <input
                  type="number"
                  min={500}
                  step={500}
                  value={dailyMaxLoss}
                  onChange={(e) => setDailyMaxLoss(Math.max(100, Number(e.target.value)))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Max Open Positions</label>
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={maxOpenPositions}
                  onChange={(e) => setMaxOpenPositions(Math.max(1, Number(e.target.value)))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
                />
              </div>
            </div>

            {/* ADX Chop Filter */}
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  ADX(14) Chop Regime Filter
                </span>
                <input
                  type="checkbox"
                  checked={adxChopFilterEnabled}
                  onChange={(e) => setAdxChopFilterEnabled(e.target.checked)}
                  className="rounded border-slate-400 text-sky-600 focus:ring-sky-500"
                />
              </label>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Block entries when ADX(14) &lt;</span>
                <input
                  type="number"
                  min={10}
                  max={40}
                  value={adxMinThreshold}
                  onChange={(e) => setAdxMinThreshold(Math.max(5, Number(e.target.value)))}
                  className="w-20 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums text-right"
                />
              </div>
            </div>

            {/* Consecutive-Loss Cooldown */}
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  Consecutive-Loss Cooldown
                </span>
                <input
                  type="checkbox"
                  checked={consecutiveLossCooldownEnabled}
                  onChange={(e) => setConsecutiveLossCooldownEnabled(e.target.checked)}
                  className="rounded border-slate-400 text-sky-600 focus:ring-sky-500"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="block text-[11px] text-slate-500 mb-0.5">After Losses</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={consecutiveLossLimit}
                    onChange={(e) => setConsecutiveLossLimit(Math.max(1, Number(e.target.value)))}
                    className="w-full px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
                  />
                </div>
                <div>
                  <span className="block text-[11px] text-slate-500 mb-0.5">
                    Pause Candles ({cooldownCandles * 5}m)
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={cooldownCandles}
                    onChange={(e) => setCooldownCandles(Math.max(1, Number(e.target.value)))}
                    className="w-full px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
                  />
                </div>
              </div>
            </div>

            {/* Time-Based Option Exit */}
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  Time-Based Option Exit (Theta Guard)
                </span>
                <input
                  type="checkbox"
                  checked={timeBasedOptionExitEnabled}
                  onChange={(e) => setTimeBasedOptionExitEnabled(e.target.checked)}
                  className="rounded border-slate-400 text-sky-600 focus:ring-sky-500"
                />
              </label>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">
                  Auto-exit CE/PE after candles ({optionMaxHoldCandles * 5}m)
                </span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={optionMaxHoldCandles}
                  onChange={(e) => setOptionMaxHoldCandles(Math.max(1, Number(e.target.value)))}
                  className="w-20 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums text-right"
                />
              </div>
            </div>
          </div>

          {savedMsg && (
            <div className="p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-500 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{savedMsg}</span>
            </div>
          )}

          <button
            type="button"
            disabled={saving || !settings}
            onClick={handleSaveLimits}
            className="w-full py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors"
          >
            {saving ? 'Saving Risk Guardrails...' : 'Save Risk Guardrails'}
          </button>
        </div>
      </div>
    </div>
  );
};
