import React, { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { AppSettings } from '../types/trading';

interface RiskManagementPageProps {
  currentPrice: number;
  settings: AppSettings | null;
  onSaveRiskLimits: (updated: AppSettings) => Promise<void>;
}

export const RiskManagementPage: React.FC<RiskManagementPageProps> = ({
  currentPrice,
  settings,
  onSaveRiskLimits,
}) => {
  const [capital, setCapital] = useState(100000);
  const [riskPct, setRiskPct] = useState(1.5);
  const [entryPrice, setEntryPrice] = useState(currentPrice || 51500);
  const [stopLossPct, setStopLossPct] = useState(settings?.trading.defaultStopLossPct ?? 0.35);
  const [targetPct, setTargetPct] = useState(settings?.trading.defaultTargetPct ?? 0.7);
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY');

  const [dailyMaxLoss, setDailyMaxLoss] = useState(settings?.trading.dailyMaxLoss ?? 5000);
  const [maxOpenPositions, setMaxOpenPositions] = useState(settings?.trading.maxOpenPositions ?? 3);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Derived Risk Calculations
  const maxRiskRupees = (capital * riskPct) / 100;
  const slPoints = (entryPrice * stopLossPct) / 100;
  const targetPoints = (entryPrice * targetPct) / 100;
  const stopLossPrice = direction === 'BUY' ? entryPrice - slPoints : entryPrice + slPoints;
  const targetPrice = direction === 'BUY' ? entryPrice + targetPoints : entryPrice - targetPoints;

  const rawUnits = slPoints > 0 ? Math.floor(maxRiskRupees / slPoints) : 0;
  const lotSize = 15; // Bank NIFTY reference lot multiplier
  const recommendedLots = Math.max(1, Math.floor(rawUnits / lotSize));
  const recommendedQty = Math.max(1, rawUnits);
  const riskReward = slPoints > 0 ? targetPoints / slPoints : 0;
  const notionalExposure = recommendedQty * entryPrice;
  const estMargin15 = notionalExposure * 0.15;
  const capitalUtilPct = capital > 0 ? (estMargin15 / capital) * 100 : 0;

  const handleSaveLimits = async () => {
    if (!settings) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      await onSaveRiskLimits({
        ...settings,
        trading: {
          ...settings.trading,
          defaultStopLossPct: stopLossPct,
          defaultTargetPct: targetPct,
          dailyMaxLoss,
          maxOpenPositions,
        },
      });
      setSavedMsg('Risk limits saved to platform configuration.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Position Sizing & SL/Target Calculator */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-sky-500" />
              <h2 className="font-display text-base font-semibold">Position Sizing &amp; Level Calculator</h2>
            </div>
            <div className="flex items-center gap-1 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800">
              {(['BUY', 'SELL'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={`px-3 py-1 text-xs font-semibold rounded ${
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
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
                step={0.25}
                value={riskPct}
                onChange={(e) => setRiskPct(Math.max(0.1, Number(e.target.value)))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">Planned Entry Price</label>
              <input
                type="number"
                step="0.5"
                value={entryPrice}
                onChange={(e) => setEntryPrice(Math.max(1, Number(e.target.value)))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
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
          </div>

          {/* Computed Outputs */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800/80 grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-slate-500">Max Risk / Trade</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-red-500">
                ₹{maxRiskRupees.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Recommended Qty</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-sky-500">
                {recommendedQty} units ({recommendedLots} lots)
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Risk / Reward Ratio</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
                1 : {riskReward.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Stop-Loss Level</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums text-red-500">
                {stopLossPrice.toFixed(2)} (−{slPoints.toFixed(1)} pts)
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Target Level</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums text-emerald-500">
                {targetPrice.toFixed(2)} (+{targetPoints.toFixed(1)} pts)
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Est. Margin Utilization</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums">
                {capitalUtilPct.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>

        {/* Configurable Risk Limits */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-5">
          <div>
            <h2 className="font-display text-base font-semibold">Portfolio Guardrails &amp; Allocation</h2>
            <p className="text-xs text-slate-500 mt-1">
              Enforced across simulated paper trading and future live broker pre-trade checks.
            </p>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-500 mb-1">Daily Maximum Loss Limit (₹)</label>
              <input
                type="number"
                min={500}
                step={500}
                value={dailyMaxLoss}
                onChange={(e) => setDailyMaxLoss(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="block text-slate-500 mb-1">Maximum Open Positions</label>
              <input
                type="number"
                min={1}
                max={15}
                value={maxOpenPositions}
                onChange={(e) => setMaxOpenPositions(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent font-mono tabular-nums"
              />
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80 space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Trades to Daily Max Loss</span>
                <span className="font-mono font-semibold tabular-nums">
                  {maxRiskRupees > 0 ? Math.floor(dailyMaxLoss / maxRiskRupees) : '—'} consecutive losses
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Daily Loss Cap (% of Capital)</span>
                <span className="font-mono font-semibold tabular-nums">
                  {capital > 0 ? ((dailyMaxLoss / capital) * 100).toFixed(2) : 0}%
                </span>
              </div>
            </div>
          </div>

          {savedMsg && (
            <div className="p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-500">
              {savedMsg}
            </div>
          )}

          <button
            type="button"
            disabled={saving || !settings}
            onClick={handleSaveLimits}
            className="w-full py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors"
          >
            {saving ? 'Saving Risk Limits...' : 'Save Risk Guardrails'}
          </button>
        </div>
      </div>
    </div>
  );
};
