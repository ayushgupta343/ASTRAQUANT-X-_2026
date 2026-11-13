import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';
import { SidebarLayout } from './components/SidebarLayout';
import { LandingPage } from './pages/LandingPage';
import { DashboardPage } from './pages/DashboardPage';
import { MLPredictionPage } from './pages/MLPredictionPage';
import { SignalsPage } from './pages/SignalsPage';
import { PaperTradingPage } from './pages/PaperTradingPage';
import { BacktestingPage } from './pages/BacktestingPage';
import { DataManagementPage } from './pages/DataManagementPage';
import { RiskManagementPage } from './pages/RiskManagementPage';
import { OptionsModulePage } from './pages/OptionsModulePage';
import { SettingsPage } from './pages/SettingsPage';
import {
  AppSettings,
  AutoExecutionLog,
  BacktestRunResult,
  DatasetMeta,
  EnrichedCandle,
  MarketFeedMode,
  MarketOverviewResponse,
  MarketStreamTickPayload,
  ModelStatusResponse,
  OptionsChainResponse,
  PageId,
  PaperOrderRecord,
  PaperPortfolioResponse,
  PaperTradePrefill,
  TradingSignalRecord,
} from './types/trading';

function normalizeClientFeedMode(raw?: string): MarketFeedMode {
  if (raw === 'simulated_replay') return 'simulated_replay';
  if (raw === 'free_live_nse') return 'free_live_nse';
  return 'historical_csv';
}

export default function App() {
  const [activePage, setActivePage] = useState<PageId>('home');
  const [loading, setLoading] = useState(true);
  const [isDark, setIsDark] = useState(true);

  const [overview, setOverview] = useState<MarketOverviewResponse | null>(null);
  const [candles, setCandles] = useState<EnrichedCandle[]>([]);
  const [modelStatus, setModelStatus] = useState<ModelStatusResponse | null>(null);
  const [signals, setSignals] = useState<TradingSignalRecord[]>([]);
  const [optionsChain, setOptionsChain] = useState<OptionsChainResponse | null>(null);
  const [portfolio, setPortfolio] = useState<PaperPortfolioResponse | null>(null);
  const [paperHistory, setPaperHistory] = useState<PaperOrderRecord[]>([]);
  const [autoLogs, setAutoLogs] = useState<AutoExecutionLog[]>([]);
  const [backtestResults, setBacktestResults] = useState<BacktestRunResult[]>([]);
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [activeDataset, setActiveDataset] = useState<DatasetMeta | null>(null);
  const [preview, setPreview] = useState<
    Array<{
      date_str: string;
      time_str: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number | null;
      is_valid: number;
    }>
  >([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [prefillOrder, setPrefillOrder] = useState<PaperTradePrefill | null>(null);
  const [feedMode, setFeedMode] = useState<MarketFeedMode>('historical_csv');
  const [switchingFeed, setSwitchingFeed] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);

  const applyTheme = useCallback((theme: 'dark' | 'light') => {
    const dark = theme === 'dark';
    setIsDark(dark);
    if (dark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, cd, ms, sg, oc, pf, ph, al, bt, ds, st] = await Promise.all([
        api.getMarketOverview(),
        api.getCandles(),
        api.getModelStatus(),
        api.getSignals(),
        api.getOptionsChain(),
        api.getPortfolio(),
        api.getPaperHistory(),
        api.getAutoExecuteLogs(),
        api.getBacktestResults(),
        api.getDatasets(),
        api.getSettings(),
      ]);
      setOverview(ov);
      setCandles(cd.candles);
      setModelStatus(ms);
      setSignals(sg.signals);
      setOptionsChain(oc);
      setPortfolio(pf);
      setPaperHistory(ph.orders);
      setAutoLogs(al.logs);
      setBacktestResults(bt.results);
      setDatasets(ds.datasets);
      setActiveDataset(ds.activeDataset);
      setPreview(ds.preview);
      setSettings(st.settings);
      setFeedMode(normalizeClientFeedMode(ov.feedMode ?? st.settings.dataSource.mode));
      applyTheme(st.settings.theme);
    } finally {
      setLoading(false);
    }
  }, [applyTheme]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Real-time Server-Sent Events subscription (GET /api/market/stream)
  useEffect(() => {
    const es = new EventSource('/api/market/stream');

    es.onopen = () => {
      setStreamConnected(true);
    };

    es.addEventListener('market_tick', (event) => {
      setStreamConnected(true);
      try {
        const payload = JSON.parse((event as MessageEvent).data) as MarketStreamTickPayload;
        if (payload.overview) setOverview(payload.overview);
        if (payload.optionsChain) setOptionsChain(payload.optionsChain);
        if (payload.portfolio) setPortfolio(payload.portfolio);
        if (payload.feedMode) setFeedMode(payload.feedMode);

        if (payload.candles && payload.candles.length > 0) {
          setCandles(payload.candles);
        } else if (payload.latestCandle) {
          const tickBar = payload.latestCandle;
          setCandles((prev) => {
            if (prev.length === 0) return [tickBar];
            const last = prev[prev.length - 1];
            if (last.timestamp === tickBar.timestamp) {
              const next = [...prev];
              next[next.length - 1] = tickBar;
              return next;
            }
            if (tickBar.timestamp > last.timestamp) {
              return [...prev, tickBar];
            }
            return prev;
          });
        }

        if (payload.streamAutoEvent?.executed) {
          Promise.all([api.getPaperHistory(), api.getAutoExecuteLogs()]).then(([ph, al]) => {
            setPaperHistory(ph.orders);
            setAutoLogs(al.logs);
          });
        }
      } catch {
        // Ignore malformed SSE payload
      }
    });

    es.onerror = () => {
      setStreamConnected(false);
    };

    return () => {
      es.close();
      setStreamConnected(false);
    };
  }, []);

  const handleChangeFeedMode = async (mode: MarketFeedMode) => {
    setSwitchingFeed(true);
    try {
      const res = await api.setMarketFeedMode(mode, mode === 'simulated_replay');
      setFeedMode(res.feedMode);
      setSettings(res.settings);
      setOverview(res.overview);
      setOptionsChain(res.optionsChain);
      setPortfolio(res.portfolio);
      if (res.candles && res.candles.length > 0) {
        setCandles(res.candles);
      }
    } finally {
      setSwitchingFeed(false);
    }
  };

  const handleReplayControl = async (action: 'reset' | 'step') => {
    const res = await api.controlReplay(action);
    setOverview(res.overview);
    setOptionsChain(res.optionsChain);
    setPortfolio(res.portfolio);
    if (res.candles && res.candles.length > 0) {
      setCandles(res.candles);
    }
  };

  const handleForceRefresh = async (forceLive = false) => {
    if (forceLive) {
      const [ov, cd, oc, pf] = await Promise.all([
        api.getMarketOverview(true),
        api.getCandles(),
        api.getOptionsChain(),
        api.getPortfolio(),
      ]);
      setOverview(ov);
      setCandles(cd.candles);
      setOptionsChain(oc);
      setPortfolio(pf);
      return;
    }
    await refreshAll();
  };

  const handleTrainModel = async (params?: {
    nEstimators: number;
    maxDepth: number;
    minSamplesSplit: number;
  }) => {
    const trained = await api.trainModel(
      params ?? {
        nEstimators: settings?.ml.nEstimators ?? 30,
        maxDepth: settings?.ml.maxDepth ?? 6,
        minSamplesSplit: settings?.ml.minSamplesSplit ?? 8,
      }
    );
    setModelStatus(trained);
    const [ov, sg, pf, ph, al] = await Promise.all([
      api.getMarketOverview(),
      api.getSignals(),
      api.getPortfolio(),
      api.getPaperHistory(),
      api.getAutoExecuteLogs(),
    ]);
    setOverview(ov);
    setSignals(sg.signals);
    setPortfolio(pf);
    setPaperHistory(ph.orders);
    setAutoLogs(al.logs);
  };

  const handleStagePaperTrade = (prefill: PaperTradePrefill) => {
    setPrefillOrder(prefill);
    setActivePage('paper');
  };

  const handlePlacePaperOrder = async (order: {
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
  }) => {
    await api.placePaperOrder(order);
    setPrefillOrder(null);
    const [pf, ph] = await Promise.all([api.getPortfolio(), api.getPaperHistory()]);
    setPortfolio(pf);
    setPaperHistory(ph.orders);
  };

  const handleToggleAutoExecute = async (enabled: boolean, triggerNow = true) => {
    const res = await api.toggleAutoExecute(enabled, triggerNow);
    setAutoLogs(res.logs);
    const [pf, ph, st] = await Promise.all([
      api.getPortfolio(),
      api.getPaperHistory(),
      api.getSettings(),
    ]);
    setPortfolio(pf);
    setPaperHistory(ph.orders);
    setSettings(st.settings);
  };

  const handleClosePaperOrder = async (orderId: number, exitPrice?: number) => {
    await api.closePaperOrder(orderId, exitPrice);
    const [pf, ph] = await Promise.all([api.getPortfolio(), api.getPaperHistory()]);
    setPortfolio(pf);
    setPaperHistory(ph.orders);
  };

  const handleResetPaper = async () => {
    await api.resetPaperTrading();
    const [pf, ph, al] = await Promise.all([
      api.getPortfolio(),
      api.getPaperHistory(),
      api.getAutoExecuteLogs(),
    ]);
    setPortfolio(pf);
    setPaperHistory(ph.orders);
    setAutoLogs(al.logs);
  };

  const handleRefreshOptionsChain = async (mode?: 'simulated' | 'csv') => {
    const oc = await api.getOptionsChain(mode);
    setOptionsChain(oc);
  };

  const handleSwitchOptionsMode = async (mode: 'simulated' | 'csv') => {
    await api.setOptionsMode(mode);
    const [oc, ov, sg, st] = await Promise.all([
      api.getOptionsChain(mode),
      api.getMarketOverview(),
      api.getSignals(),
      api.getSettings(),
    ]);
    setOptionsChain(oc);
    setOverview(ov);
    setSignals(sg.signals);
    setSettings(st.settings);
  };

  const handleUploadOptionsCSV = async (file: File) => {
    await api.uploadOptionsCSVFile(file);
    await handleSwitchOptionsMode('csv');
  };

  const handleUploadOptionsCSVText = async (filename: string, csvText: string) => {
    await api.uploadOptionsCSVText(filename, csvText);
    await handleSwitchOptionsMode('csv');
  };

  const handleUploadCSV = async (file: File) => {
    await api.uploadCSVFile(file, true);
    await refreshAll();
  };

  const handleUploadCSVText = async (filename: string, csvText: string) => {
    await api.uploadCSVText(filename, csvText, true);
    await refreshAll();
  };

  const handleCleanDataset = async (datasetId: number) => {
    await api.cleanDataset(datasetId);
    await refreshAll();
  };

  const handleActivateDataset = async (datasetId: number) => {
    await api.activateDataset(datasetId);
    await refreshAll();
  };

  const handleRunBacktest = async (config: {
    strategy: string;
    startDate?: string;
    endDate?: string;
    initialCapital: number;
    positionSize: number;
    stopLossPct: number;
    targetPct: number;
    chargeBps: number;
    slippageBps: number;
  }) => {
    const res = await api.runBacktest(config);
    const bt = await api.getBacktestResults();
    setBacktestResults(bt.results);
    return res;
  };

  const handleSaveSettings = async (updated: AppSettings) => {
    const res = await api.saveSettings(updated);
    setSettings(res.settings);
    applyTheme(res.settings.theme);
  };

  if (activePage === 'home') {
    return <LandingPage overview={overview} onNavigate={setActivePage} />;
  }

  return (
    <SidebarLayout
      activePage={activePage}
      onNavigate={setActivePage}
      overview={overview}
      feedMode={feedMode}
      switchingFeed={switchingFeed}
      streamConnected={streamConnected}
      onChangeFeedMode={handleChangeFeedMode}
    >
      {activePage === 'dashboard' && (
        <DashboardPage
          overview={overview}
          candles={candles}
          loading={loading}
          isDark={isDark}
          feedMode={feedMode}
          streamConnected={streamConnected}
          onTrainModel={() => handleTrainModel()}
          onRefresh={handleForceRefresh}
          onReplayControl={handleReplayControl}
          onNavigate={setActivePage}
          onQuickPaperTrade={handleStagePaperTrade}
        />
      )}

      {activePage === 'ml' && (
        <MLPredictionPage
          modelStatus={modelStatus}
          onTrain={(params) => handleTrainModel(params)}
          isDark={isDark}
        />
      )}

      {activePage === 'signals' && (
        <SignalsPage
          modelStatus={modelStatus?.status ?? 'Not trained'}
          signals={signals}
          autoExecuteEnabled={Boolean(settings?.trading.autoExecuteSignals)}
          autoLogs={autoLogs}
          onToggleAutoExecute={(en) => handleToggleAutoExecute(en, true)}
          onNavigate={setActivePage}
          onStagePaperTrade={handleStagePaperTrade}
        />
      )}

      {activePage === 'paper' && (
        <PaperTradingPage
          portfolio={portfolio}
          history={paperHistory}
          optionsChain={optionsChain}
          settings={settings}
          prefillOrder={prefillOrder}
          autoExecuteEnabled={Boolean(settings?.trading.autoExecuteSignals)}
          autoLogs={autoLogs}
          onToggleAutoExecute={handleToggleAutoExecute}
          onPlaceOrder={handlePlacePaperOrder}
          onCloseOrder={handleClosePaperOrder}
          onResetPortfolio={handleResetPaper}
        />
      )}

      {activePage === 'backtest' && (
        <BacktestingPage
          activeDataset={activeDataset}
          results={backtestResults}
          modelTrained={modelStatus?.status === 'Trained'}
          isDark={isDark}
          onRunBacktest={handleRunBacktest}
          onUploadCSV={handleUploadCSV}
        />
      )}

      {activePage === 'data' && (
        <DataManagementPage
          datasets={datasets}
          activeDataset={activeDataset}
          preview={preview}
          onUploadCSV={handleUploadCSV}
          onUploadCSVText={handleUploadCSVText}
          onCleanDataset={handleCleanDataset}
          onActivateDataset={handleActivateDataset}
        />
      )}

      {activePage === 'risk' && (
        <RiskManagementPage
          currentPrice={overview?.currentPrice ?? 53760}
          settings={settings}
          onSaveRiskLimits={handleSaveSettings}
        />
      )}

      {activePage === 'options' && (
        <OptionsModulePage
          chainData={optionsChain}
          loading={loading}
          onRefreshChain={handleRefreshOptionsChain}
          onSwitchMode={handleSwitchOptionsMode}
          onUploadOptionsCSV={handleUploadOptionsCSV}
          onUploadOptionsCSVText={handleUploadOptionsCSVText}
          onStageOptionTrade={handleStagePaperTrade}
        />
      )}

      {activePage === 'settings' && (
        <SettingsPage
          settings={settings}
          feedMode={feedMode}
          onChangeFeedMode={handleChangeFeedMode}
          onSave={handleSaveSettings}
          onResetPaper={handleResetPaper}
        />
      )}
    </SidebarLayout>
  );
}
