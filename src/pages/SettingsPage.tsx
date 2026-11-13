import React, { useEffect, useState } from 'react';
import { Lock, Save, Settings as SettingsIcon } from 'lucide-react';
import { AppSettings, MarketFeedMode } from '../types/trading';

interface SettingsPageProps {
  settings: AppSettings | null;
  feedMode: MarketFeedMode;
  onChangeFeedMode: (mode: MarketFeedMode) => Promise<void>;
  onSave: (updated: AppSettings) => Promise<void>;
  onResetPaper: () => Promise<void>;
}

const FEED_OPTIONS: Array<{
  id: MarketFeedMode;
  title: string;
  desc: string;
}> = [
  {
    id: 'historical_csv',
    title: 'Historical CSV',
    desc: 'Static 5-minute historical Bank NIFTY dataset (Sample or Uploaded CSV).',
  },
  {
    id: 'simulated_replay',
    title: 'Simulated Live Stream',
    desc: '24/7 tick-by-tick replay from the active CSV every 1.5s via SSE for live testing.',
  },
  {
    id: 'free_live_nse',
    title: 'Free Live NSE Feed',
    desc: 'Zero-API-key Yahoo Finance (^NSEBANK) 5m intraday chart feed polled live.',
  },
];

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  feedMode,
  onChangeFeedMode,
  onSave,
  onResetPaper,
}) => {
  const [form, setForm] = useState<AppSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [switchingFeed, setSwitchingFeed] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  if (!form) {
    return <div className="text-sm text-slate-500">Loading settings...</div>;
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    try {
      await onSave(form);
      setStatusMsg('Settings saved and applied.');
    } finally {
      setSaving(false);
    }
  };

  const handleFeedSelect = async (mode: MarketFeedMode) => {
    setSwitchingFeed(true);
    setStatusMsg(null);
    try {
      await onChangeFeedMode(mode);
      setForm((prev) => (prev ? { ...prev, dataSource: { ...prev.dataSource, mode } } : prev));
      setStatusMsg(`Market feed switched to "${FEED_OPTIONS.find((f) => f.id === mode)?.title}".`);
    } finally {
      setSwitchingFeed(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-4xl">
      {/* Market Feed & Streaming Mode Selector */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold">Market Data Feed &amp; Streaming Mode</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Choose between static Historical CSV, 24/7 Simulated Live Tick Replay, or the zero-API-key Free Live NSE Feed.
            </p>
          </div>
          {switchingFeed && <span className="text-xs text-sky-500 font-medium">Switching feed...</span>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {FEED_OPTIONS.map((opt) => {
            const active = feedMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={switchingFeed}
                onClick={() => handleFeedSelect(opt.id)}
                className={`text-left p-4 rounded-xl border transition-colors ${
                  active
                    ? 'border-sky-500 bg-sky-500/8'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                    {opt.title}
                  </span>
                  {active && (
                    <span className="text-[11px] font-mono font-semibold text-sky-600 dark:text-sky-400">
                      ACTIVE
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">{opt.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Theme & Interface */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <SettingsIcon className="w-4 h-4 text-sky-500" />
          <h2 className="font-display text-base font-semibold">Terminal Theme &amp; Data Source</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block text-slate-500 mb-1">Interface Theme</label>
            <select
              value={form.theme}
              onChange={(e) => setForm({ ...form, theme: e.target.value as 'dark' | 'light' })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="dark">Institutional Dark Navy (Default)</option>
              <option value="light">Clean Daylight Terminal</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Active Market &amp; Timeframe</label>
            <input
              type="text"
              readOnly
              value={`${form.dataSource.symbol} · ${form.dataSource.timeframe} (${feedMode})`}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-slate-500 font-mono"
            />
          </div>
        </div>
      </div>

      {/* Machine Learning Defaults */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
        <h2 className="font-display text-base font-semibold">Random Forest Model Defaults</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-slate-500 mb-1">Default Trees (n_estimators)</label>
            <input
              type="number"
              min={10}
              max={100}
              value={form.ml.nEstimators}
              onChange={(e) =>
                setForm({ ...form, ml: { ...form.ml, nEstimators: Number(e.target.value) } })
              }
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Max Tree Depth</label>
            <input
              type="number"
              min={3}
              max={10}
              value={form.ml.maxDepth}
              onChange={(e) =>
                setForm({ ...form, ml: { ...form.ml, maxDepth: Number(e.target.value) } })
              }
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Prediction Horizon (Candles)</label>
            <input
              type="number"
              readOnly
              value={form.ml.horizonCandles}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-slate-500 font-mono tabular-nums"
            />
          </div>
        </div>
      </div>

      {/* Trading & Paper Trading Preferences */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold">Paper Trading &amp; Risk Preferences</h2>
          <button
            type="button"
            onClick={onResetPaper}
            className="text-xs text-red-500 hover:underline font-medium"
          >
            Reset Virtual Portfolio to ₹1,00,000
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-slate-500 mb-1">Default Quantity</label>
            <input
              type="number"
              min={1}
              value={form.trading.defaultQuantity}
              onChange={(e) =>
                setForm({ ...form, trading: { ...form.trading, defaultQuantity: Number(e.target.value) } })
              }
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Default Stop-Loss (%)</label>
            <input
              type="number"
              step="0.05"
              value={form.trading.defaultStopLossPct}
              onChange={(e) =>
                setForm({ ...form, trading: { ...form.trading, defaultStopLossPct: Number(e.target.value) } })
              }
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Default Target (%)</label>
            <input
              type="number"
              step="0.05"
              value={form.trading.defaultTargetPct}
              onChange={(e) =>
                setForm({ ...form, trading: { ...form.trading, defaultTargetPct: Number(e.target.value) } })
              }
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
            />
          </div>
        </div>
      </div>

      {/* Future Live Broker Integration Placeholders (No secrets in frontend) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-500" />
            <h2 className="font-display text-base font-semibold">Broker API Integration (Future Module)</h2>
          </div>
          <span className="text-xs font-medium text-amber-500">Paper Mode Enforced</span>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Live broker trading is disabled in v1. API keys, OAuth tokens, and broker secrets are strictly managed via
          server-side environment variables and are never exposed or stored in frontend state.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block text-slate-500 mb-1">Broker Adapter Target</label>
            <input
              type="text"
              readOnly
              value={form.broker.provider}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-slate-500"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">Credentials Policy</label>
            <input
              type="text"
              readOnly
              value={form.broker.clientIdPlaceholder}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-slate-500"
            />
          </div>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-500">
          {statusMsg}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-2"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{saving ? 'Saving...' : 'Save Settings'}</span>
        </button>
      </div>
    </form>
  );
};
