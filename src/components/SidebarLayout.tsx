import React, { useState } from 'react';
import {
  Activity,
  BarChart3,
  BrainCircuit,
  Database,
  History,
  Home,
  Layers,
  Menu,
  Radio,
  Settings,
  ShieldAlert,
  Wallet,
  X,
} from 'lucide-react';
import { MarketFeedMode, MarketOverviewResponse, PageId } from '../types/trading';

interface SidebarLayoutProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  overview: MarketOverviewResponse | null;
  feedMode: MarketFeedMode;
  switchingFeed: boolean;
  streamConnected: boolean;
  onChangeFeedMode: (mode: MarketFeedMode) => Promise<void>;
  children: React.ReactNode;
}

const FEED_MODES: Array<{ id: MarketFeedMode; shortLabel: string; fullLabel: string }> = [
  { id: 'historical_csv', shortLabel: 'Historical CSV', fullLabel: 'Historical CSV' },
  { id: 'simulated_replay', shortLabel: 'Simulated Live', fullLabel: 'Simulated Live Stream' },
  { id: 'free_live_nse', shortLabel: 'Free Live NSE', fullLabel: 'Free Live NSE Feed' },
];

interface NavItem {
  id: PageId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'Trading' | 'Quant & Data' | 'System';
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Trading Dashboard', icon: Activity, group: 'Trading' },
  { id: 'ml', label: 'AI / ML Prediction', icon: BrainCircuit, group: 'Trading' },
  { id: 'signals', label: 'Trading Signals', icon: Radio, group: 'Trading' },
  { id: 'paper', label: 'Paper Trading', icon: Wallet, group: 'Trading' },
  { id: 'backtest', label: 'Backtesting', icon: History, group: 'Quant & Data' },
  { id: 'data', label: 'Data Management', icon: Database, group: 'Quant & Data' },
  { id: 'risk', label: 'Risk Management', icon: ShieldAlert, group: 'Quant & Data' },
  { id: 'options', label: 'Options Module', icon: Layers, group: 'Quant & Data' },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'System' },
];

export const SidebarLayout: React.FC<SidebarLayoutProps> = ({
  activePage,
  onNavigate,
  overview,
  feedMode,
  switchingFeed,
  streamConnected,
  onChangeFeedMode,
  children,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeTitle = NAV_ITEMS.find((i) => i.id === activePage)?.label ?? 'Terminal';
  const groups: Array<'Trading' | 'Quant & Data' | 'System'> = ['Trading', 'Quant & Data', 'System'];

  const renderNav = () => (
    <div className="flex flex-col h-full justify-between py-5 px-3">
      <div className="space-y-6">
        <div className="px-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              onNavigate('home');
              setMobileOpen(false);
            }}
            className="text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
          >
            <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap block">
              ASTRAQUANT X-2026
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-md"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="space-y-5" aria-label="Workspace navigation">
          {groups.map((grp) => (
            <div key={grp} className="space-y-1">
              <div className="px-3 text-[11px] font-medium text-slate-500 dark:text-slate-500">
                {grp}
              </div>
              {NAV_ITEMS.filter((i) => i.group === grp).map((item) => {
                const Icon = item.icon;
                const isActive = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onNavigate(item.id);
                      setMobileOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-sky-500/12 text-sky-600 dark:text-sky-400'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>

      <div className="px-3 pt-4 border-t border-slate-200 dark:border-slate-800/80 space-y-2">
        <button
          type="button"
          onClick={() => {
            onNavigate('home');
            setMobileOpen(false);
          }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors whitespace-nowrap"
        >
          <Home className="w-4 h-4 shrink-0" />
          <span>Overview Page</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#070B12] text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar (240px) */}
      <aside className="hidden lg:block w-60 shrink-0 border-r border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0A0F19] sticky top-0 h-screen overflow-y-auto">
        {renderNav()}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-64 max-w-[80vw] bg-white dark:bg-[#0A0F19] border-r border-slate-200 dark:border-slate-800 h-full overflow-y-auto z-10">
            {renderNav()}
          </aside>
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract for SaaS Dashboard */}
        <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-[#070B12]/95 backdrop-blur-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 hidden sm:inline whitespace-nowrap">Terminal</span>
              <span className="text-slate-400 hidden sm:inline" aria-hidden="true">/</span>
              <h1 className="font-display font-semibold text-slate-900 dark:text-white truncate">
                {activeTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Desktop/Tablet 3-Mode Feed Switcher */}
            <div
              className="hidden md:flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/70 p-0.5"
              role="group"
              aria-label="Market Data Source Mode"
            >
              {FEED_MODES.map((m) => {
                const active = feedMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={switchingFeed}
                    onClick={() => onChangeFeedMode(m.id)}
                    title={m.fullLabel}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {m.shortLabel}
                  </button>
                );
              })}
            </div>

            {/* Mobile Feed Selector */}
            <select
              aria-label="Market Data Source Mode"
              value={feedMode}
              disabled={switchingFeed}
              onChange={(e) => onChangeFeedMode(e.target.value as MarketFeedMode)}
              className="md:hidden px-2 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
            >
              {FEED_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.shortLabel}
                </option>
              ))}
            </select>

            {overview?.hasData && (
              <div className="hidden xl:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                <span className={feedMode !== 'historical_csv' && streamConnected ? 'text-emerald-600 dark:text-emerald-400 font-medium' : ''}>
                  {switchingFeed
                    ? 'Syncing...'
                    : feedMode === 'historical_csv'
                    ? 'Static CSV'
                    : streamConnected
                    ? 'SSE Stream'
                    : 'Reconnecting'}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-slate-900 dark:text-slate-200 font-semibold">
                  {overview.currentPrice?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={() => onNavigate(activePage === 'paper' ? 'dashboard' : 'paper')}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>{activePage === 'paper' ? 'Live Chart' : 'Paper Trade'}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
};
