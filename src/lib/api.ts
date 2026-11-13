import {
  AppSettings,
  AutoExecutionLog,
  BacktestRunResult,
  DatasetMeta,
  EnrichedCandle,
  MarketFeedMode,
  MarketOverviewResponse,
  ModelStatusResponse,
  OptionsChainResponse,
  PaperOrderRecord,
  PaperPortfolioResponse,
  TradingSignalRecord,
} from '../types/trading';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options?.headers ?? {}),
    },
  });

  const rawText = await res.text();
  let data: Record<string, unknown> | null = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      const trimmed = rawText.trim().toLowerCase();
      if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
        throw new Error(
          `Server returned an HTML error response (HTTP ${res.status}). If uploading a large CSV, ensure it is within the upload size limit (10MB JSON / 15MB file).`
        );
      }
      throw new Error(`Unexpected non-JSON response from server (HTTP ${res.status}).`);
    }
  }

  if (!res.ok) {
    const errMsg = typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`;
    throw new Error(errMsg);
  }

  return (data ?? {}) as T;
}

export const api = {
  getMarketOverview: (force = false) =>
    request<MarketOverviewResponse>(`/api/market/overview${force ? '?force=1' : ''}`),
  setMarketFeedMode: (mode: MarketFeedMode, resetReplay = false) =>
    request<{
      feedMode: MarketFeedMode;
      settings: AppSettings;
      overview: MarketOverviewResponse;
      candles: EnrichedCandle[];
      optionsChain: OptionsChainResponse;
      portfolio: PaperPortfolioResponse;
    }>('/api/market/feed-mode', {
      method: 'POST',
      body: JSON.stringify({ mode, resetReplay }),
    }),
  controlReplay: (action: 'reset' | 'step') =>
    request<{
      overview: MarketOverviewResponse;
      candles: EnrichedCandle[];
      optionsChain: OptionsChainResponse;
      portfolio: PaperPortfolioResponse;
    }>('/api/market/replay/control', {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  getCandles: (limit = 0) =>
    request<{
      dataset: {
        id: number;
        name: string;
        sourceType: string;
        hasVolume: boolean;
        recordCount: number;
        startDate: string;
        endDate: string;
      } | null;
      candles: EnrichedCandle[];
    }>(`/api/market/candles${limit > 0 ? `?limit=${limit}` : ''}`),

  getDatasets: () =>
    request<{
      datasets: DatasetMeta[];
      activeDataset: DatasetMeta | null;
      preview: Array<{
        date_str: string;
        time_str: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number | null;
        is_valid: number;
      }>;
    }>('/api/data/datasets'),

  uploadCSVFile: (file: File, activate = true) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('activate', String(activate));
    return request<{ datasetId: number; name: string; report: Record<string, unknown> }>(
      '/api/data/upload',
      { method: 'POST', body: fd }
    );
  },

  uploadCSVText: (filename: string, csvText: string, activate = true) =>
    request<{ datasetId: number; name: string; report: Record<string, unknown> }>(
      '/api/data/upload',
      { method: 'POST', body: JSON.stringify({ filename, csvText, activate }) }
    ),

  cleanDataset: (datasetId?: number) =>
    request<{ datasetId: number; removedCount: number; cleanedCount: number; message: string }>(
      '/api/data/clean',
      { method: 'POST', body: JSON.stringify({ datasetId }) }
    ),

  activateDataset: (datasetId: number) =>
    request<{ success: boolean; activeDatasetId: number }>('/api/data/activate', {
      method: 'POST',
      body: JSON.stringify({ datasetId }),
    }),

  getModelStatus: () => request<ModelStatusResponse>('/api/model/status'),

  trainModel: (params?: { nEstimators?: number; maxDepth?: number; minSamplesSplit?: number }) =>
    request<ModelStatusResponse>('/api/model/train', {
      method: 'POST',
      body: JSON.stringify(params ?? {}),
    }),

  getSignals: () =>
    request<{ modelStatus: 'Not trained' | 'Trained'; modelId?: number; signals: TradingSignalRecord[] }>(
      '/api/signals'
    ),

  getOptionsChain: (mode?: 'simulated' | 'csv') =>
    request<OptionsChainResponse>(`/api/options/chain${mode ? `?mode=${mode}` : ''}`),

  uploadOptionsCSVFile: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ uploadId: number; name: string; expiry: string; recordCount: number; mode: 'csv' }>(
      '/api/options/upload',
      { method: 'POST', body: fd }
    );
  },

  uploadOptionsCSVText: (filename: string, csvText: string) =>
    request<{ uploadId: number; name: string; expiry: string; recordCount: number; mode: 'csv' }>(
      '/api/options/upload',
      { method: 'POST', body: JSON.stringify({ filename, csvText }) }
    ),

  setOptionsMode: (mode: 'simulated' | 'csv') =>
    request<{ optionsMode: 'simulated' | 'csv' }>('/api/options/mode', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),

  runBacktest: (config: {
    strategy: string;
    startDate?: string;
    endDate?: string;
    initialCapital: number;
    positionSize: number;
    stopLossPct: number;
    targetPct: number;
    chargeBps: number;
    slippageBps: number;
  }) =>
    request<BacktestRunResult>('/api/backtest/run', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  getBacktestResults: () => request<{ results: BacktestRunResult[] }>('/api/backtest/results'),

  getPortfolio: () => request<PaperPortfolioResponse>('/api/portfolio'),

  placePaperOrder: (order: {
    instrumentType?: 'OPTION' | 'INDEX';
    side: 'BUY' | 'SELL';
    quantity?: number;
    lots?: number;
    lotSize?: number;
    optionStrike?: number;
    optionType?: 'CE' | 'PE';
    optionExpiry?: string;
    entryPrice?: number;
    stopLoss?: number;
    targetPrice?: number;
    notes?: string;
    rationale?: string;
  }) =>
    request<{ orderId: number; symbol: string; capitalRequired: number }>('/api/paper-trading/order', {
      method: 'POST',
      body: JSON.stringify(order),
    }),

  toggleAutoExecute: (enabled?: boolean, triggerNow = true) =>
    request<{
      autoExecuteSignals: boolean;
      execution: { executed: boolean; status?: string; reason?: string } | null;
      logs: AutoExecutionLog[];
    }>('/api/paper-trading/auto-execute', {
      method: 'POST',
      body: JSON.stringify({ enabled, triggerNow }),
    }),

  getAutoExecuteLogs: () => request<{ logs: AutoExecutionLog[] }>('/api/paper-trading/auto-logs'),

  closePaperOrder: (orderId: number, exitPrice?: number) =>
    request<{ orderId: number; exitPrice: number; realizedPnl: number }>('/api/paper-trading/close', {
      method: 'POST',
      body: JSON.stringify({ orderId, exitPrice }),
    }),

  resetPaperTrading: () =>
    request<{ success: boolean }>('/api/paper-trading/reset', { method: 'POST' }),

  getPaperHistory: () => request<{ orders: PaperOrderRecord[] }>('/api/paper-trading/history'),

  getSettings: () => request<{ settings: AppSettings; updatedAt: string }>('/api/settings'),

  saveSettings: (settings: AppSettings) =>
    request<{ settings: AppSettings; updatedAt: string }>('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ settings }),
    }),
};
