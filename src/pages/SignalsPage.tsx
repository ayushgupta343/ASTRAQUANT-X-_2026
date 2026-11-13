import React, { useState } from 'react';
import { Radio, Zap } from 'lucide-react';
import {
  AutoExecutionLog,
  PageId,
  PaperTradePrefill,
  SignalClass,
  TradingSignalRecord,
} from '../types/trading';

interface SignalsPageProps {
  modelStatus: 'Not trained' | 'Trained';
  signals: TradingSignalRecord[];
  autoExecuteEnabled: boolean;
  autoLogs: AutoExecutionLog[];
  onToggleAutoExecute: (enabled: boolean) => Promise<void>;
  onNavigate: (page: PageId) => void;
  onStagePaperTrade: (prefill: PaperTradePrefill) => void;
}

export const SignalsPage: React.FC<SignalsPageProps> = ({
  modelStatus,
  signals,
  autoExecuteEnabled,
  autoLogs,
  onToggleAutoExecute,
  onNavigate,
  onStagePaperTrade,
}) => {
  const [filter, setFilter] = useState<'ALL' | SignalClass>('ALL');
  const [toggling, setToggling] = useState(false);

  const filtered = signals.filter((s) => (filter === 'ALL' ? true : s.signal_type === filter));
  const counts = {
    ALL: signals.length,
    BUY: signals.filter((s) => s.signal_type === 'BUY').length,
    SELL: signals.filter((s) => s.signal_type === 'SELL').length,
    HOLD: signals.filter((s) => s.signal_type === 'HOLD').length,
  };

  const handleToggle = async () => {
    setToggling(true);
    try {
      await onToggleAutoExecute(!autoExecuteEnabled);
    } finally {
      setToggling(false);
    }
  };

  if (modelStatus !== 'Trained' || signals.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-10 text-center space-y-4">
        <Radio className="w-8 h-8 text-slate-400 mx-auto" />
        <h2 className="font-display text-lg font-semibold">No Trading Signals Generated Yet</h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          Signals and automated ATM CE/PE option contract mappings are produced by the trained Random Forest classifier combined with RSI(14) and MACD(12,26,9) context.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('ml')}
          className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
        >
          Go to AI / ML Prediction to Train Model
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header, Auto-Execute Toggle & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold">Signal Monitoring &amp; Option Mapping Log</h2>
          <p className="text-xs text-slate-500">
            BUY maps to nearest ATM Call (CE) · SELL maps to nearest ATM Put (PE) · Lot Size = 15
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Auto-Execute Signals (Simulated) Toggle */}
          <button
            type="button"
            disabled={toggling}
            onClick={handleToggle}
            className={`px-3.5 py-2 rounded-lg border text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap ${
              autoExecuteEnabled
                ? 'border-emerald-500/50 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D131F] text-slate-600 dark:text-slate-300 hover:border-sky-500'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>
              Auto-Execute Signals (Simulated): {autoExecuteEnabled ? 'ON' : 'OFF'}
            </span>
          </button>

          <div className="flex items-center gap-1 p-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F]">
            {(['ALL', 'BUY', 'SELL', 'HOLD'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filter === tab
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab} ({counts[tab]})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Signals Table with Mapped Option Contracts */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-left">
                <th className="py-3 px-4 font-medium">Timestamp</th>
                <th className="py-3 px-4 font-medium">Signal &amp; Confidence</th>
                <th className="py-3 px-4 font-medium">Recommended Option (Lot 15)</th>
                <th className="py-3 px-4 font-medium text-right">Opt Entry / SL / Target</th>
                <th className="py-3 px-4 font-medium text-right">Index Price &amp; RSI</th>
                <th className="py-3 px-4 font-medium">Rationale</th>
                <th className="py-3 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
              {filtered.map((sig) => (
                <tr key={sig.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 align-top">
                  <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                    {sig.date_str} {sig.time_str}
                    <div className="text-[11px] text-slate-500 font-sans">{sig.data_label}</div>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span
                      className={`font-display font-bold ${
                        sig.signal_type === 'BUY'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : sig.signal_type === 'SELL'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {sig.signal_type}
                    </span>
                    <div className="text-[11px] font-mono text-slate-500">
                      {sig.confidence.toFixed(1)}% conf
                    </div>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {sig.option_strike && sig.option_type ? (
                      <div>
                        <span
                          className={`font-mono font-semibold ${
                            sig.option_type === 'CE'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {sig.option_strike.toLocaleString('en-IN')} {sig.option_type}
                        </span>
                        <div className="text-[11px] text-slate-500 font-mono">
                          Exp {sig.option_expiry} · Lot {sig.option_lot_size ?? 15}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400">No Option Entry</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                    {sig.option_entry_premium !== null ? (
                      <div>
                        <div className="font-semibold">₹{sig.option_entry_premium.toFixed(2)}</div>
                        <div className="text-[11px]">
                          <span className="text-red-500">₹{sig.option_stop_loss?.toFixed(1)}</span>
                          {' / '}
                          <span className="text-emerald-500">₹{sig.option_target?.toFixed(1)}</span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                    <div>{sig.entry_price.toFixed(2)}</div>
                    <div className="text-[11px] text-slate-500">
                      RSI {sig.rsi.toFixed(1)} · H {sig.macd_hist.toFixed(1)}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-300 max-w-sm leading-relaxed">
                    {sig.reason}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    {sig.signal_type !== 'HOLD' && sig.option_strike && sig.option_type ? (
                      <button
                        type="button"
                        onClick={() =>
                          onStagePaperTrade({
                            instrumentType: 'OPTION',
                            side: 'BUY',
                            entry: sig.option_entry_premium ?? 250,
                            sl: sig.option_stop_loss ?? 200,
                            target: sig.option_target ?? 350,
                            strike: sig.option_strike!,
                            optionType: sig.option_type!,
                            expiry: sig.option_expiry ?? undefined,
                            lots: 1,
                            lotSize: sig.option_lot_size ?? 15,
                            notes: `Staged ${sig.option_strike} ${sig.option_type} from ${sig.signal_type} Signal`,
                            rationale: sig.reason,
                          })
                        }
                        className="px-2.5 py-1 rounded border border-sky-500/40 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 text-xs font-medium"
                      >
                        Stage Option
                      </button>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Auto-Execution Audit Log */}
      {autoLogs.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">Automated Execution Audit Log</h3>
            <span className="text-xs text-slate-500">{autoLogs.length} logged attempts</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-left">
                  <th className="py-2.5 px-4 font-medium">Logged At</th>
                  <th className="py-2.5 px-4 font-medium">Contract</th>
                  <th className="py-2.5 px-4 font-medium text-right">Capital</th>
                  <th className="py-2.5 px-4 font-medium">Risk Check</th>
                  <th className="py-2.5 px-4 font-medium">Indicator Rationale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                {autoLogs.slice(0, 10).map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold whitespace-nowrap">
                      {log.contract_name} ({log.lots} lot @ ₹{log.entry_premium?.toFixed(2) ?? '—'})
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      ₹{(log.capital_required ?? 0).toLocaleString('en-IN')}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`font-semibold ${
                          log.risk_check_status === 'PASSED'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-500'
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
        </div>
      )}
    </div>
  );
};
