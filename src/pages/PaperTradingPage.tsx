import React, { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, RotateCcw, ShieldCheck, Wallet, Zap } from 'lucide-react';
import {
  AppSettings,
  AutoExecutionLog,
  OptionsChainResponse,
  PaperOrderRecord,
  PaperPortfolioResponse,
  PaperTradePrefill,
  RiskGuardrailStatusLevel,
  RiskTelemetry,
} from '../types/trading';

interface PaperTradingPageProps {
  portfolio: PaperPortfolioResponse | null;
  history: PaperOrderRecord[];
  optionsChain: OptionsChainResponse | null;
  settings: AppSettings | null;
  riskTelemetry: RiskTelemetry | null;
  prefillOrder: PaperTradePrefill | null;
  autoExecuteEnabled: boolean;
  autoLogs: AutoExecutionLog[];
  onToggleAutoExecute: (enabled: boolean, triggerNow?: boolean) => Promise<void>;
  onPlaceOrder: (order: {
    instrumentType: 'OPTION' | 'INDEX';
    side: 'BUY' | 'SELL';
    quantity?: number;
    lots?: number;
    lotSize?: number;
    optionStrike?: number;
    optionType?: 'CE' | 'PE';
    optionExpiry?: string;
    entryPrice: number;
    stopLoss: number;
    targetPrice: number;
    notes?: string;
    rationale?: string;
  }) => Promise<void>;
  onCloseOrder: (orderId: number, exitPrice?: number) => Promise<void>;
  onResetPortfolio: () => Promise<void>;
  onResetCooldown: () => Promise<void>;
}

function statusBadgeStyle(status: RiskGuardrailStatusLevel): string {
  if (status === 'TRIGGERED') {
    return 'border-red-500/40 bg-red-500/15 text-red-600 dark:text-red-400';
  }
  if (status === 'WARNING') {
    return 'border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-400';
  }
  return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
}

export const PaperTradingPage: React.FC<PaperTradingPageProps> = ({
  portfolio,
  history,
  optionsChain,
  settings,
  riskTelemetry,
  prefillOrder,
  autoExecuteEnabled,
  autoLogs,
  onToggleAutoExecute,
  onPlaceOrder,
  onCloseOrder,
  onResetPortfolio,
  onResetCooldown,
}) => {
  const defaultAtm = optionsChain?.atmStrike ?? Math.round((portfolio?.markPrice ?? 53760) / 100) * 100;
  const lotSize = optionsChain?.lotSize ?? 15;

  const [instrumentType, setInstrumentType] = useState<'OPTION' | 'INDEX'>(
    prefillOrder?.instrumentType ?? 'OPTION'
  );
  const [side, setSide] = useState<'BUY' | 'SELL'>(prefillOrder?.side ?? 'BUY');
  const [optionType, setOptionType] = useState<'CE' | 'PE'>(prefillOrder?.optionType ?? 'CE');
  const [strike, setStrike] = useState<number>(prefillOrder?.strike ?? defaultAtm);
  const [expiry, setExpiry] = useState<string>(
    prefillOrder?.expiry ?? optionsChain?.expiry ?? '2026-11-18'
  );
  const [lots, setLots] = useState<number>(prefillOrder?.lots ?? 1);
  const [indexQty, setIndexQty] = useState<number>(15);

  const findChainOption = (targetStrike: number, optType: 'CE' | 'PE') => {
    const row = optionsChain?.chain.find((r) => r.strike === targetStrike);
    if (!row) return { ltp: 260, delta: optType === 'CE' ? 0.5 : -0.5 };
    return optType === 'CE' ? row.ce : row.pe;
  };

  const initialPrem = prefillOrder ? prefillOrder.entry : findChainOption(defaultAtm, 'CE').ltp;

  const [entryPrice, setEntryPrice] = useState<number>(initialPrem);
  const [stopLoss, setStopLoss] = useState<number>(
    prefillOrder?.sl ?? Number(Math.max(1, initialPrem * 0.8).toFixed(2))
  );
  const [targetPrice, setTargetPrice] = useState<number>(
    prefillOrder?.target ?? Number((initialPrem * 1.4).toFixed(2))
  );
  const [notes, setNotes] = useState<string>(prefillOrder?.notes ?? '');
  const [rationale, setRationale] = useState<string | undefined>(prefillOrder?.rationale);

  const [submitting, setSubmitting] = useState(false);
  const [togglingAuto, setTogglingAuto] = useState(false);
  const [resettingCooldown, setResettingCooldown] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (prefillOrder) {
      setInstrumentType(prefillOrder.instrumentType);
      setSide(prefillOrder.side);
      if (prefillOrder.instrumentType === 'OPTION') {
        setStrike(prefillOrder.strike ?? defaultAtm);
        setOptionType(prefillOrder.optionType ?? 'CE');
        setExpiry(prefillOrder.expiry ?? optionsChain?.expiry ?? '2026-11-18');
        setLots(prefillOrder.lots ?? 1);
      }
      setEntryPrice(prefillOrder.entry);
      setStopLoss(prefillOrder.sl);
      setTargetPrice(prefillOrder.target);
      setNotes(prefillOrder.notes ?? 'Staged from Signal');
      setRationale(prefillOrder.rationale);
    }
  }, [prefillOrder, defaultAtm, optionsChain?.expiry]);

  const syncOptionLevels = (nextStrike: number, nextOptType: 'CE' | 'PE', nextSide: 'BUY' | 'SELL') => {
    const leg = findChainOption(nextStrike, nextOptType);
    const prem = leg.ltp;
    setEntryPrice(prem);

    const useAtr = settings?.trading.stopLossMode === 'atr_dynamic' && (riskTelemetry?.latestAtr ?? 0) > 0;
    if (useAtr) {
      const stopMult = settings?.trading.atrStopMult ?? 1.2;
      const targetMult = Math.max(stopMult * 2, settings?.trading.atrTargetMult ?? 2.4);
      const rawSlDist = Math.abs(leg.delta || 0.5) * (riskTelemetry?.latestAtr ?? 100) * stopMult;
      const slDist = Math.min(prem * 0.45, Math.max(prem * 0.08, rawSlDist));
      const tpDist = slDist * (targetMult / Math.max(0.1, stopMult));
      if (nextSide === 'BUY') {
        setStopLoss(Number(Math.max(1, prem - slDist).toFixed(2)));
        setTargetPrice(Number((prem + tpDist).toFixed(2)));
      } else {
        setStopLoss(Number((prem + slDist).toFixed(2)));
        setTargetPrice(Number(Math.max(1, prem - tpDist).toFixed(2)));
      }
      return;
    }

    if (nextSide === 'BUY') {
      setStopLoss(Number(Math.max(1, prem * 0.8).toFixed(2)));
      setTargetPrice(Number((prem * 1.4).toFixed(2)));
    } else {
      setStopLoss(Number((prem * 1.2).toFixed(2)));
      setTargetPrice(Number(Math.max(1, prem * 0.6).toFixed(2)));
    }
  };

  const handleInstrumentChange = (nextInst: 'OPTION' | 'INDEX') => {
    setInstrumentType(nextInst);
    if (nextInst === 'OPTION') {
      syncOptionLevels(strike, optionType, side);
    } else {
      const spot = portfolio?.markPrice ?? 53760;
      setEntryPrice(spot);
      const atr = riskTelemetry?.latestAtr;
      if (settings?.trading.stopLossMode === 'atr_dynamic' && atr && atr > 0) {
        const stopMult = settings?.trading.atrStopMult ?? 1.2;
        const targetMult = Math.max(stopMult * 2, settings?.trading.atrTargetMult ?? 2.4);
        setStopLoss(
          side === 'BUY'
            ? Number((spot - atr * stopMult).toFixed(2))
            : Number((spot + atr * stopMult).toFixed(2))
        );
        setTargetPrice(
          side === 'BUY'
            ? Number((spot + atr * targetMult).toFixed(2))
            : Number((spot - atr * targetMult).toFixed(2))
        );
      } else {
        setStopLoss(
          side === 'BUY'
            ? Number((spot * 0.9965).toFixed(2))
            : Number((spot * 1.0035).toFixed(2))
        );
        setTargetPrice(
          side === 'BUY'
            ? Number((spot * 1.007).toFixed(2))
            : Number((spot * 0.993).toFixed(2))
        );
      }
    }
  };

  const handleSideChange = (nextSide: 'BUY' | 'SELL') => {
    setSide(nextSide);
    if (instrumentType === 'OPTION') {
      syncOptionLevels(strike, optionType, nextSide);
    } else {
      const base = entryPrice || portfolio?.markPrice || 53760;
      const atr = riskTelemetry?.latestAtr;
      if (settings?.trading.stopLossMode === 'atr_dynamic' && atr && atr > 0) {
        const stopMult = settings?.trading.atrStopMult ?? 1.2;
        const targetMult = Math.max(stopMult * 2, settings?.trading.atrTargetMult ?? 2.4);
        setStopLoss(
          nextSide === 'BUY'
            ? Number((base - atr * stopMult).toFixed(2))
            : Number((base + atr * stopMult).toFixed(2))
        );
        setTargetPrice(
          nextSide === 'BUY'
            ? Number((base + atr * targetMult).toFixed(2))
            : Number((base - atr * targetMult).toFixed(2))
        );
      } else {
        setStopLoss(
          nextSide === 'BUY'
            ? Number((base * 0.9965).toFixed(2))
            : Number((base * 1.0035).toFixed(2))
        );
        setTargetPrice(
          nextSide === 'BUY'
            ? Number((base * 1.007).toFixed(2))
            : Number((base * 0.993).toFixed(2))
        );
      }
    }
  };

  // Volatility-Adjusted Lot Sizing calculation
  const riskPerTradePct = settings?.trading.riskPerTradePct ?? 1.0;
  const maxRiskBudget = ((portfolio?.totalEquity ?? 100000) * riskPerTradePct) / 100;
  const slDistance = Math.max(1, Math.abs(entryPrice - stopLoss));
  const riskPerSingleLot = slDistance * lotSize;
  const volatilitySizedLots = Math.max(1, Math.floor(maxRiskBudget / riskPerSingleLot));

  const applyVolatilitySizing = () => {
    if (instrumentType === 'OPTION') {
      setLots(volatilitySizedLots);
    } else {
      setIndexQty(volatilitySizedLots * lotSize);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onPlaceOrder({
        instrumentType,
        side,
        quantity: instrumentType === 'OPTION' ? lots * lotSize : indexQty,
        lots: instrumentType === 'OPTION' ? lots : 1,
        lotSize: instrumentType === 'OPTION' ? lotSize : 1,
        optionStrike: instrumentType === 'OPTION' ? strike : undefined,
        optionType: instrumentType === 'OPTION' ? optionType : undefined,
        optionExpiry: instrumentType === 'OPTION' ? expiry : undefined,
        entryPrice,
        stopLoss,
        targetPrice,
        notes,
        rationale,
      });
      setNotes('');
      setRationale(undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAutoToggle = async (nextState: boolean) => {
    setTogglingAuto(true);
    setError(null);
    try {
      await onToggleAutoExecute(nextState, true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTogglingAuto(false);
    }
  };

  const handleResetCooldownClick = async () => {
    setResettingCooldown(true);
    try {
      await onResetCooldown();
    } finally {
      setResettingCooldown(false);
    }
  };

  const optionTotalQty = lots * lotSize;
  const capitalRequired =
    instrumentType === 'OPTION'
      ? side === 'BUY'
        ? entryPrice * lotSize * lots
        : Math.max(entryPrice * lotSize * lots * 2.5, (portfolio?.markPrice ?? 53760) * lotSize * lots * 0.1)
      : entryPrice * indexQty * 0.1;

  const maxOpenPos = settings?.trading.maxOpenPositions ?? 3;
  const dailyMaxLoss = settings?.trading.dailyMaxLoss ?? 3000;
  const closedOrders = history.filter((o) => o.status === 'CLOSED');
  const g = riskTelemetry?.guardrails;
  const isKillSwitchActive = g?.dailyLossCap.status === 'TRIGGERED';

  return (
    <div className="space-y-6">
      {/* Paper Trading Simulation Disclaimer + Auto-Execute Controls */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            <strong>Simulated Paper Trading Only:</strong> Virtual ₹1,00,000 capital ({portfolio?.markTimestamp ?? '—'}). No real broker orders are placed.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={togglingAuto}
            onClick={() => handleAutoToggle(!autoExecuteEnabled)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              autoExecuteEnabled
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Auto-Execute Signals (Simulated): {autoExecuteEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <button
            type="button"
            onClick={onResetPortfolio}
            className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 hover:text-red-500 font-medium whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset (₹1,00,000)</span>
          </button>
        </div>
      </div>

      {/* Live Risk Guardrail Status Strip */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold">
            {riskTelemetry?.overallStatus === 'TRIGGERED' ? (
              <AlertTriangle className="w-4 h-4 text-red-500" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
            )}
            <span>Pre-Trade Risk &amp; Circuit-Breaker Status</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {g?.timeBasedOptionExit && (
              <span className="text-[11px] font-mono text-slate-500">
                Option Time Exit: {g.timeBasedOptionExit.enabled ? `${g.timeBasedOptionExit.maxHoldCandles} candles (${g.timeBasedOptionExit.maxHoldCandles * 5}m)` : 'OFF'}
              </span>
            )}
            <button
              type="button"
              disabled={resettingCooldown}
              onClick={handleResetCooldownClick}
              className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:border-sky-500 text-[11px] font-medium flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3 text-sky-500" />
              <span>{resettingCooldown ? 'Resetting...' : 'Reset Cooldown'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] text-slate-500">Daily Loss Cap</div>
              <div className="font-mono text-[11px] truncate tabular-nums">
                {g?.dailyLossCap.detail ?? `Max -₹${dailyMaxLoss}`}
              </div>
            </div>
            <span
              className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${statusBadgeStyle(
                g?.dailyLossCap.status ?? 'ACTIVE'
              )}`}
            >
              {g?.dailyLossCap.status ?? 'ACTIVE'}
            </span>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] text-slate-500">Max Open Positions</div>
              <div className="font-mono text-[11px] truncate tabular-nums">
                {g?.maxOpenPositions.detail ?? `${portfolio?.openPositions.length ?? 0}/${maxOpenPos}`}
              </div>
            </div>
            <span
              className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${statusBadgeStyle(
                g?.maxOpenPositions.status ?? 'ACTIVE'
              )}`}
            >
              {g?.maxOpenPositions.status ?? 'ACTIVE'}
            </span>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] text-slate-500">ADX Regime Filter</div>
              <div className="font-mono text-[11px] truncate tabular-nums">
                {g?.adxRegimeFilter.detail ?? 'ADX(14) ≥ 18'}
              </div>
            </div>
            <span
              className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${statusBadgeStyle(
                g?.adxRegimeFilter.status ?? 'ACTIVE'
              )}`}
            >
              {g?.adxRegimeFilter.status ?? 'ACTIVE'}
            </span>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] text-slate-500">Loss Cooldown</div>
              <div className="font-mono text-[11px] truncate tabular-nums">
                {g?.consecutiveLossCooldown.detail ?? 'Clear'}
              </div>
            </div>
            <span
              className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${statusBadgeStyle(
                g?.consecutiveLossCooldown.status ?? 'ACTIVE'
              )}`}
            >
              {g?.consecutiveLossCooldown.status ?? 'ACTIVE'}
            </span>
          </div>
        </div>
      </div>

      {/* Portfolio Balance & Guardrail Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
          <div className="text-xs text-slate-500">Virtual Capital</div>
          <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
            ₹{(portfolio?.initialCapital ?? 100000).toLocaleString('en-IN')}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
          <div className="text-xs text-slate-500">Total Equity</div>
          <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-sky-600 dark:text-sky-400">
            ₹{(portfolio?.totalEquity ?? 100000).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
          <div className="text-xs text-slate-500">Available Capital</div>
          <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
            ₹{(portfolio?.availableCapital ?? 100000).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
          <div className="text-xs text-slate-500">Realized P&amp;L</div>
          <div
            className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
              (portfolio?.realizedPnl ?? 0) >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {(portfolio?.realizedPnl ?? 0) >= 0 ? '+' : ''}₹
            {(portfolio?.realizedPnl ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
          <div className="text-xs text-slate-500">Unrealized P&amp;L</div>
          <div
            className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
              (portfolio?.unrealizedPnl ?? 0) >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {(portfolio?.unrealizedPnl ?? 0) >= 0 ? '+' : ''}₹
            {(portfolio?.unrealizedPnl ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-4">
          <div className="text-xs text-slate-500">Risk Budget ({riskPerTradePct.toFixed(1)}%)</div>
          <div className="mt-1 font-mono text-xs font-medium tabular-nums text-slate-700 dark:text-slate-300">
            <div>Max Loss/Trade: ₹{maxRiskBudget.toFixed(0)}</div>
            <div>Kill-Switch: -₹{dailyMaxLoss.toLocaleString('en-IN')}</div>
          </div>
        </div>
      </div>

      {/* Order Ticket + Open Positions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Order Ticket */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-sky-500" />
              <h2 className="font-display text-base font-semibold">Simulated Order Ticket</h2>
            </div>
            <span className="text-xs font-mono text-slate-500">
              Spot {portfolio?.markPrice.toFixed(2) ?? '—'}
            </span>
          </div>

          {isKillSwitchActive && (
            <div className="p-2.5 rounded-lg border border-red-500/40 bg-red-500/10 text-xs text-red-500">
              {g?.dailyLossCap.detail}
            </div>
          )}

          {/* Instrument Mode Toggle: Options (CE/PE) vs Spot Index */}
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => handleInstrumentChange('OPTION')}
              className={`py-1.5 text-xs font-semibold rounded-md transition-colors ${
                instrumentType === 'OPTION'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Options (CE / PE)
            </button>
            <button
              type="button"
              onClick={() => handleInstrumentChange('INDEX')}
              className={`py-1.5 text-xs font-semibold rounded-md transition-colors ${
                instrumentType === 'INDEX'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Spot Index
            </button>
          </div>

          {/* BUY / SELL Toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => handleSideChange('BUY')}
              className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                side === 'BUY' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              BUY {instrumentType === 'OPTION' ? optionType : '(Long)'}
            </button>
            <button
              type="button"
              onClick={() => handleSideChange('SELL')}
              className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                side === 'SELL' ? 'bg-red-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              SELL {instrumentType === 'OPTION' ? optionType : '(Short)'}
            </button>
          </div>

          {/* Option Contract Fields */}
          {instrumentType === 'OPTION' && (
            <div className="grid grid-cols-3 gap-2.5 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">Strike</label>
                <select
                  value={strike}
                  onChange={(e) => {
                    const nextS = Number(e.target.value);
                    setStrike(nextS);
                    syncOptionLevels(nextS, optionType, side);
                  }}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                >
                  {(optionsChain?.chain ?? []).map((r) => (
                    <option key={r.strike} value={r.strike}>
                      {r.strike} {r.isAtm ? '(ATM)' : ''}
                    </option>
                  ))}
                  {!optionsChain?.chain.some((r) => r.strike === strike) && (
                    <option value={strike}>{strike}</option>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Type</label>
                <div className="grid grid-cols-2 gap-1">
                  {(['CE', 'PE'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setOptionType(t);
                        syncOptionLevels(strike, t, side);
                      }}
                      className={`py-2 rounded-lg border font-mono font-semibold text-xs ${
                        optionType === t
                          ? t === 'CE'
                            ? 'border-emerald-500 bg-emerald-500/15 text-emerald-500'
                            : 'border-red-500 bg-red-500/15 text-red-500'
                          : 'border-slate-300 dark:border-slate-700 text-slate-500'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Lots (×{lotSize})</label>
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={lots}
                  onChange={(e) => setLots(Math.max(1, Number(e.target.value)))}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-500 mb-1">
                {instrumentType === 'OPTION' ? `Total Units (${lots}×${lotSize})` : 'Quantity (Units)'}
              </label>
              <input
                type="number"
                min={1}
                readOnly={instrumentType === 'OPTION'}
                value={instrumentType === 'OPTION' ? optionTotalQty : indexQty}
                onChange={(e) => setIndexQty(Math.max(1, Number(e.target.value)))}
                className={`w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 font-mono tabular-nums ${
                  instrumentType === 'OPTION' ? 'bg-slate-50 dark:bg-slate-900/50 text-slate-500' : 'bg-transparent'
                }`}
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">
                {instrumentType === 'OPTION' ? 'Option Premium (₹)' : 'Entry Price'}
              </label>
              <input
                type="number"
                step="0.05"
                value={entryPrice}
                onChange={(e) => setEntryPrice(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">Stop-Loss</label>
              <input
                type="number"
                step="0.05"
                value={stopLoss}
                onChange={(e) => setStopLoss(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums text-red-500"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">Target Price</label>
              <input
                type="number"
                step="0.05"
                value={targetPrice}
                onChange={(e) => setTargetPrice(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums text-emerald-500"
              />
            </div>
          </div>

          {/* Volatility Position Sizing Quick Helper */}
          <div className="p-2.5 rounded-lg border border-sky-500/25 bg-sky-500/5 flex items-center justify-between gap-2 text-[11px]">
            <div className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
              Vol Sizing ({riskPerTradePct.toFixed(1)}% = ₹{maxRiskBudget.toFixed(0)}):{' '}
              <strong className="text-sky-500">
                {volatilitySizedLots} {volatilitySizedLots === 1 ? 'lot' : 'lots'}
              </strong>{' '}
              (₹{(volatilitySizedLots * riskPerSingleLot).toFixed(0)} SL risk)
            </div>
            <button
              type="button"
              onClick={applyVolatilitySizing}
              className="shrink-0 px-2 py-1 rounded border border-sky-500/40 text-sky-500 hover:bg-sky-500/10 font-sans font-semibold"
            >
              Apply
            </button>
          </div>

          <div className="text-xs">
            <label className="block text-slate-500 mb-1">Trade Notes (Optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                instrumentType === 'OPTION'
                  ? `e.g. ${strike} ${optionType} momentum trade`
                  : 'e.g. Index breakout'
              }
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent"
            />
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">
                {instrumentType === 'OPTION' && side === 'BUY'
                  ? `Capital Required (₹${entryPrice.toFixed(1)} × ${lotSize} × ${lots})`
                  : 'Est. Margin Required'}
              </span>
              <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                ₹{capitalRequired.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>
            {instrumentType === 'OPTION' && (
              <div className="text-[11px] text-slate-500 font-mono">
                Contract: BANKNIFTY {expiry} {strike} {optionType}
              </div>
            )}
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-500">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || isKillSwitchActive}
            className={`w-full py-2.5 px-4 rounded-lg text-white text-xs font-semibold transition-colors disabled:opacity-50 ${
              side === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
            }`}
          >
            {isKillSwitchActive
              ? 'Orders Halted (Daily Max Loss Kill-Switch)'
              : submitting
              ? 'Placing Simulated Order...'
              : instrumentType === 'OPTION'
              ? `Place Simulated ${side} ${strike} ${optionType}`
              : `Place Simulated ${side} Index Order`}
          </button>
        </form>

        {/* Open Positions & Trade History */}
        <div className="lg:col-span-8 space-y-5">
          {/* Open Positions */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <h3 className="font-display text-base font-semibold">
                Open Positions ({portfolio?.openPositions.length ?? 0})
              </h3>
              <span className="text-xs font-mono text-slate-500">
                Spot Ref: {portfolio?.markPrice.toFixed(2) ?? '—'}
              </span>
            </div>

            {!portfolio?.openPositions.length ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No open simulated positions. Stage an ATM CE/PE option contract from Trading Signals, the Options Chain, or the order ticket.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-left">
                      <th className="py-2.5 px-4 font-sans">Contract / Instrument</th>
                      <th className="py-2.5 px-4 font-sans">Side</th>
                      <th className="py-2.5 px-4 text-right font-sans">Qty</th>
                      <th className="py-2.5 px-4 text-right font-sans">Entry</th>
                      <th className="py-2.5 px-4 text-right font-sans">Mark</th>
                      <th className="py-2.5 px-4 text-right font-sans">Unrealized P&amp;L</th>
                      <th className="py-2.5 px-4 text-right font-sans">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                    {portfolio.openPositions.map((pos) => (
                      <tr key={pos.id}>
                        <td className="py-3 px-4 font-sans">
                          <div className="font-mono font-semibold text-slate-900 dark:text-white">
                            {pos.symbol}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {pos.is_auto_executed ? 'Auto-Executed · ' : ''}
                            Capital: ₹{pos.capital_used.toLocaleString('en-IN')}
                          </div>
                        </td>
                        <td
                          className={`py-3 px-4 font-semibold ${
                            pos.side === 'BUY' ? 'text-emerald-500' : 'text-red-500'
                          }`}
                        >
                          {pos.side}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {pos.quantity}
                          {pos.instrument_type === 'OPTION' && (
                            <span className="text-slate-500 text-[11px] block">
                              {pos.lots ?? 1} lot
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">₹{pos.entry_price.toFixed(2)}</td>
                        <td className="py-3 px-4 text-right">₹{pos.mark_price.toFixed(2)}</td>
                        <td
                          className={`py-3 px-4 text-right font-semibold ${
                            pos.unrealized_pnl >= 0 ? 'text-emerald-500' : 'text-red-500'
                          }`}
                        >
                          {pos.unrealized_pnl >= 0 ? '+' : ''}₹{pos.unrealized_pnl.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => onCloseOrder(pos.id)}
                            className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-sans font-medium"
                          >
                            Close @ Mark
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Automated Execution Audit Log */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-semibold">
                  Automated Signal Execution Log ({autoLogs.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Every auto-triggered BUY/SELL option execution with risk check status &amp; indicator rationale
                </p>
              </div>
              {autoExecuteEnabled && (
                <button
                  type="button"
                  disabled={togglingAuto}
                  onClick={() => handleAutoToggle(true)}
                  className="px-3 py-1.5 rounded-lg border border-sky-500/40 text-sky-500 hover:bg-sky-500/10 text-xs font-medium"
                >
                  Check Latest Signal
                </button>
              )}
            </div>
            {autoLogs.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Enable <strong>Auto-Execute Signals (Simulated)</strong> to automatically execute recommended ATM CE/PE option trades when BUY/SELL signals trigger.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-left">
                      <th className="py-2.5 px-4 font-medium">Contract</th>
                      <th className="py-2.5 px-4 font-medium text-right">Capital Req</th>
                      <th className="py-2.5 px-4 font-medium">Risk Check</th>
                      <th className="py-2.5 px-4 font-medium">Indicator Rationale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                    {autoLogs.map((log) => (
                      <tr key={log.id} className="align-top">
                        <td className="py-2.5 px-4 font-mono whitespace-nowrap">
                          <div className="font-semibold">{log.contract_name}</div>
                          <div className="text-[11px] text-slate-500">
                            {log.signal_type} · {log.lots} lot @ ₹{log.entry_premium?.toFixed(2) ?? '—'}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          ₹{(log.capital_required ?? 0).toLocaleString('en-IN')}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`font-semibold ${
                              log.risk_check_status === 'PASSED' ? 'text-emerald-500' : 'text-red-500'
                            }`}
                          >
                            {log.risk_check_status}
                          </span>
                          <div className="text-[11px] text-slate-500">{log.risk_check_detail}</div>
                        </td>
                        <td className="py-2.5 px-4 text-slate-500 max-w-md">{log.rationale}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Closed Trade History */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800/80">
              <h3 className="font-display text-base font-semibold">
                Closed Trade History ({closedOrders.length})
              </h3>
            </div>
            {closedOrders.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Closed paper trades and realized P&amp;L will appear here once positions are exited.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-left">
                      <th className="py-2.5 px-4 font-sans">Contract</th>
                      <th className="py-2.5 px-4 font-sans">Side</th>
                      <th className="py-2.5 px-4 text-right font-sans">Qty</th>
                      <th className="py-2.5 px-4 text-right font-sans">Entry</th>
                      <th className="py-2.5 px-4 text-right font-sans">Exit</th>
                      <th className="py-2.5 px-4 text-right font-sans">Realized P&amp;L</th>
                      <th className="py-2.5 px-4 font-sans">Exit Reason</th>
                      <th className="py-2.5 px-4 font-sans">Closed At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                    {closedOrders.map((ord) => (
                      <tr key={ord.id}>
                        <td className="py-2.5 px-4 font-sans font-medium">{ord.symbol}</td>
                        <td
                          className={`py-2.5 px-4 font-semibold ${
                            ord.side === 'BUY' ? 'text-emerald-500' : 'text-red-500'
                          }`}
                        >
                          {ord.side}
                        </td>
                        <td className="py-2.5 px-4 text-right">{ord.quantity}</td>
                        <td className="py-2.5 px-4 text-right">₹{ord.entry_price.toFixed(2)}</td>
                        <td className="py-2.5 px-4 text-right">
                          {ord.exit_price !== null ? `₹${ord.exit_price.toFixed(2)}` : '—'}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right font-semibold ${
                            ord.realized_pnl >= 0 ? 'text-emerald-500' : 'text-red-500'
                          }`}
                        >
                          {ord.realized_pnl >= 0 ? '+' : ''}₹{ord.realized_pnl.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-4 font-sans text-slate-500">
                          {ord.exit_reason ?? 'Manual Close'}
                        </td>
                        <td className="py-2.5 px-4 text-slate-500">
                          {ord.closed_at ? new Date(ord.closed_at).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
