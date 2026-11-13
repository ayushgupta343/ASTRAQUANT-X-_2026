import React, { useState } from 'react';
import { Layers, RefreshCw, Upload } from 'lucide-react';
import { OptionsChainResponse, PaperTradePrefill } from '../types/trading';

interface OptionsModulePageProps {
  chainData: OptionsChainResponse | null;
  loading: boolean;
  onRefreshChain: (mode?: 'simulated' | 'csv') => Promise<void>;
  onSwitchMode: (mode: 'simulated' | 'csv') => Promise<void>;
  onUploadOptionsCSV: (file: File) => Promise<void>;
  onUploadOptionsCSVText: (filename: string, csvText: string) => Promise<void>;
  onStageOptionTrade: (prefill: PaperTradePrefill) => void;
}

export const OptionsModulePage: React.FC<OptionsModulePageProps> = ({
  chainData,
  loading,
  onRefreshChain,
  onSwitchMode,
  onUploadOptionsCSV,
  onUploadOptionsCSVText,
  onStageOptionTrade,
}) => {
  const [uploading, setUploading] = useState(false);
  const [showGreeks, setShowGreeks] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      await onUploadOptionsCSV(file);
      setMessage(`Loaded Historical Options CSV "${file.name}" and activated CSV mode.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleLoadSampleOptionsCSV = async () => {
    const spot = chainData?.spotPrice ?? 53760;
    const atm = Math.round(spot / 100) * 100;
    const expiry = chainData?.expiry ?? '2026-11-18';
    const lines = ['Strike,Type,Expiry,Premium,IV,OI,Volume'];
    for (let offset = -500; offset <= 500; offset += 100) {
      const strike = atm + offset;
      const intrinsicCe = Math.max(0, spot - strike);
      const intrinsicPe = Math.max(0, strike - spot);
      const timeVal = Math.max(35, 310 - Math.abs(offset) * 0.42);
      const cePrem = (intrinsicCe + timeVal).toFixed(2);
      const pePrem = (intrinsicPe + timeVal * 0.96).toFixed(2);
      const iv = (15.2 + Math.abs(offset) * 0.004).toFixed(2);
      const ceOi = Math.round(1850000 * Math.exp(-Math.abs(offset) / 420));
      const peOi = Math.round(1790000 * Math.exp(-Math.abs(offset) / 420));
      lines.push(`${strike},CE,${expiry},${cePrem},${iv},${ceOi},${ceOi * 2}`);
      lines.push(`${strike},PE,${expiry},${pePrem},${iv},${peOi},${peOi * 2}`);
    }
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      await onUploadOptionsCSVText(`banknifty_options_${expiry}.csv`, lines.join('\n'));
      setMessage(`Loaded sample historical options chain CSV for expiry ${expiry}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleModeSwitch = async (mode: 'simulated' | 'csv') => {
    setError(null);
    setMessage(null);
    try {
      await onSwitchMode(mode);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const stageLeg = (strike: number, optionType: 'CE' | 'PE', premium: number, expiry: string) => {
    onStageOptionTrade({
      instrumentType: 'OPTION',
      side: 'BUY',
      entry: premium,
      sl: Number(Math.max(1, premium * 0.8).toFixed(2)),
      target: Number((premium * 1.4).toFixed(2)),
      strike,
      optionType,
      expiry,
      lots: 1,
      lotSize: chainData?.lotSize ?? 15,
      notes: `Staged from Options Chain (${chainData?.dataMode ?? 'Options'})`,
    });
  };

  return (
    <div className="space-y-5">
      {/* Data Mode & Transparency Header */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-500" />
              <h2 className="font-display text-lg font-semibold">
                Bank NIFTY Interactive Options Chain (±500 Points · 100-pt Step)
              </h2>
            </div>
            <p className="text-xs text-slate-500 max-w-3xl leading-relaxed">
              Active Mode:{' '}
              <strong className="text-sky-600 dark:text-sky-400">
                {chainData?.dataMode ?? 'Simulated Black-Scholes (Derived from Spot)'}
              </strong>
              {' · '}Spot:{' '}
              <strong className="font-mono text-slate-800 dark:text-slate-200">
                {chainData?.spotPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 }) ?? '—'}
              </strong>
              {' · '}ATM Strike:{' '}
              <strong className="font-mono text-slate-800 dark:text-slate-200">
                {chainData?.atmStrike.toLocaleString('en-IN') ?? '—'}
              </strong>
              {' · '}Lot Size: <strong className="font-mono">15</strong>
              {' · '}Ref Expiry: <strong className="font-mono">{chainData?.expiry ?? '—'}</strong>
            </p>
          </div>

          {/* Mode Toggle */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center p-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => handleModeSwitch('simulated')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  chainData?.modeKey !== 'csv'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Simulated Black-Scholes
              </button>
              <button
                type="button"
                onClick={() => handleModeSwitch('csv')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  chainData?.modeKey === 'csv'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Uploaded Options CSV
              </button>
            </div>
          </div>
        </div>

        {/* Upload CSV & Chain Controls */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="text-slate-500">
            CSV Columns: <code className="font-mono text-slate-700 dark:text-slate-300">Strike, Type (CE/PE), Expiry, Premium/LTP, IV, OI, Volume</code>
            {chainData?.hasUploadedCsv && (
              <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                · Uploaded: {chainData.uploadedCsvName} ({chainData.uploadedCsvCount} rows)
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowGreeks((v) => !v)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
            >
              {showGreeks ? 'Hide Greeks' : 'Show Greeks (Δ Γ Θ ν)'}
            </button>
            <label className="cursor-pointer px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold inline-flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" />
              <span>{uploading ? 'Uploading...' : 'Upload Options CSV'}</span>
              <input type="file" accept=".csv" className="hidden" onChange={handleFile} disabled={uploading} />
            </label>
            <button
              type="button"
              onClick={handleLoadSampleOptionsCSV}
              disabled={uploading}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
            >
              Load Sample Options CSV
            </button>
            <button
              type="button"
              onClick={() => onRefreshChain(chainData?.modeKey)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Refresh options chain"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {message && (
          <div className="p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-600 dark:text-emerald-400">
            {message}
          </div>
        )}
        {error && (
          <div className="p-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-500">
            {error}
          </div>
        )}
      </div>

      {/* Interactive Options Chain Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="font-semibold text-slate-700 dark:text-slate-200">
            CALLS (CE) ← Strike → PUTS (PE)
          </div>
          <div className="text-slate-500">
            Click <strong>Trade CE</strong> or <strong>Trade PE</strong> on any strike to stage an order in Paper Trading (1 Lot = 15 Units).
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2.5 px-3 text-right font-sans">CE OI</th>
                <th className="py-2.5 px-3 text-right font-sans">CE Vol</th>
                <th className="py-2.5 px-3 text-right font-sans">CE IV%</th>
                {showGreeks && <th className="py-2.5 px-3 text-right font-sans">CE Greeks (Δ / Θ)</th>}
                <th className="py-2.5 px-3 text-right font-sans text-emerald-600 dark:text-emerald-400">CE LTP</th>
                <th className="py-2.5 px-2 text-center font-sans">Trade</th>
                <th className="py-2.5 px-3 text-center font-sans bg-slate-100 dark:bg-slate-900/80 text-slate-900 dark:text-white">
                  Strike
                </th>
                <th className="py-2.5 px-2 text-center font-sans">Trade</th>
                <th className="py-2.5 px-3 text-left font-sans text-red-600 dark:text-red-400">PE LTP</th>
                {showGreeks && <th className="py-2.5 px-3 text-left font-sans">PE Greeks (Δ / Θ)</th>}
                <th className="py-2.5 px-3 text-left font-sans">PE IV%</th>
                <th className="py-2.5 px-3 text-left font-sans">PE Vol</th>
                <th className="py-2.5 px-3 text-left font-sans">PE OI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {(chainData?.chain ?? []).map((row) => {
                const ceItm = row.strike < (chainData?.spotPrice ?? 0);
                const peItm = row.strike > (chainData?.spotPrice ?? 0);
                return (
                  <tr
                    key={row.strike}
                    className={
                      row.isAtm
                        ? 'bg-sky-500/12'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
                    }
                  >
                    {/* CALLS */}
                    <td className={`py-2.5 px-3 text-right ${ceItm ? 'bg-emerald-500/4' : ''}`}>
                      {row.ce.oi > 0 ? row.ce.oi.toLocaleString('en-IN') : '—'}
                    </td>
                    <td className={`py-2.5 px-3 text-right text-slate-500 ${ceItm ? 'bg-emerald-500/4' : ''}`}>
                      {row.ce.volume > 0 ? row.ce.volume.toLocaleString('en-IN') : '—'}
                    </td>
                    <td className={`py-2.5 px-3 text-right ${ceItm ? 'bg-emerald-500/4' : ''}`}>
                      {row.ce.ivPct.toFixed(1)}%
                    </td>
                    {showGreeks && (
                      <td className={`py-2.5 px-3 text-right text-[11px] text-slate-500 whitespace-nowrap ${ceItm ? 'bg-emerald-500/4' : ''}`}>
                        <div>Δ {row.ce.delta.toFixed(2)} · Θ {row.ce.theta.toFixed(1)}</div>
                        <div className="text-[10px]">Γ {row.ce.gamma.toFixed(4)} · ν {row.ce.vega.toFixed(1)}</div>
                      </td>
                    )}
                    <td className={`py-2.5 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400 ${ceItm ? 'bg-emerald-500/4' : ''}`}>
                      ₹{row.ce.ltp.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <button
                        type="button"
                        onClick={() => stageLeg(row.strike, 'CE', row.ce.ltp, row.expiry)}
                        className="px-2 py-1 rounded border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 text-[11px] font-sans font-semibold whitespace-nowrap"
                      >
                        Buy CE
                      </button>
                    </td>

                    {/* STRIKE */}
                    <td className="py-2.5 px-3 text-center font-bold bg-slate-100 dark:bg-slate-900/80 text-slate-900 dark:text-white whitespace-nowrap">
                      {row.strike.toLocaleString('en-IN')}
                      {row.isAtm && <span className="ml-1 text-[10px] font-sans text-sky-500">ATM</span>}
                    </td>

                    {/* PUTS */}
                    <td className="py-2.5 px-2 text-center">
                      <button
                        type="button"
                        onClick={() => stageLeg(row.strike, 'PE', row.pe.ltp, row.expiry)}
                        className="px-2 py-1 rounded border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 text-[11px] font-sans font-semibold whitespace-nowrap"
                      >
                        Buy PE
                      </button>
                    </td>
                    <td className={`py-2.5 px-3 text-left font-semibold text-red-600 dark:text-red-400 ${peItm ? 'bg-red-500/4' : ''}`}>
                      ₹{row.pe.ltp.toFixed(2)}
                    </td>
                    {showGreeks && (
                      <td className={`py-2.5 px-3 text-left text-[11px] text-slate-500 whitespace-nowrap ${peItm ? 'bg-red-500/4' : ''}`}>
                        <div>Δ {row.pe.delta.toFixed(2)} · Θ {row.pe.theta.toFixed(1)}</div>
                        <div className="text-[10px]">Γ {row.pe.gamma.toFixed(4)} · ν {row.pe.vega.toFixed(1)}</div>
                      </td>
                    )}
                    <td className={`py-2.5 px-3 text-left ${peItm ? 'bg-red-500/4' : ''}`}>
                      {row.pe.ivPct.toFixed(1)}%
                    </td>
                    <td className={`py-2.5 px-3 text-left text-slate-500 ${peItm ? 'bg-red-500/4' : ''}`}>
                      {row.pe.volume > 0 ? row.pe.volume.toLocaleString('en-IN') : '—'}
                    </td>
                    <td className={`py-2.5 px-3 text-left ${peItm ? 'bg-red-500/4' : ''}`}>
                      {row.pe.oi > 0 ? row.pe.oi.toLocaleString('en-IN') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
