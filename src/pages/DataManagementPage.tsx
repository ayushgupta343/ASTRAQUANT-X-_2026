import React, { useState } from 'react';
import { CheckCircle2, Database, Download, Sparkles, Upload } from 'lucide-react';
import { DatasetMeta } from '../types/trading';

interface DataManagementPageProps {
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
  onUploadCSV: (file: File) => Promise<void>;
  onUploadCSVText: (filename: string, csvText: string) => Promise<void>;
  onCleanDataset: (datasetId: number) => Promise<void>;
  onActivateDataset: (datasetId: number) => Promise<void>;
}

export const DataManagementPage: React.FC<DataManagementPageProps> = ({
  datasets,
  activeDataset,
  preview,
  onUploadCSV,
  onUploadCSVText,
  onCleanDataset,
  onActivateDataset,
}) => {
  const [uploading, setUploading] = useState(false);
  const [cleaningId, setCleaningId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      await onUploadCSV(file);
      setMessage(`Uploaded and activated "${file.name}".`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleClean = async (id: number) => {
    setCleaningId(id);
    setError(null);
    setMessage(null);
    try {
      await onCleanDataset(id);
      setMessage('Dataset cleaned: duplicate timestamps and invalid OHLC rows removed.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCleaningId(null);
    }
  };

  const handleLoadTestCsvWithIssues = async () => {
    // Provides a quick test CSV (no-volume optional check + 1 duplicate row) so user can test validation & cleaning immediately
    const rows = ['Date,Time,Open,High,Low,Close'];
    let p = 52100;
    for (let i = 0; i < 240; i++) {
      const dayOffset = Math.floor(i / 75);
      const bar = i % 75;
      const dateStr = `2026-11-${String(12 + dayOffset).padStart(2, '0')}`;
      const mins = 9 * 60 + 15 + bar * 5;
      const hh = String(Math.floor(mins / 60)).padStart(2, '0');
      const mm = String(mins % 60).padStart(2, '0');
      const open = Number(p.toFixed(2));
      const delta = Math.sin(i / 7) * 42 + ((i % 5) - 2) * 14;
      const close = Number((open + delta).toFixed(2));
      const high = Number((Math.max(open, close) + 22).toFixed(2));
      const low = Number((Math.min(open, close) - 18).toFixed(2));
      rows.push(`${dateStr},${hh}:${mm},${open},${high},${low},${close}`);
      if (i === 10) {
        // Inject 1 duplicate row so user can verify validator detection
        rows.push(`${dateStr},${hh}:${mm},${open},${high},${low},${close}`);
      }
      p = close;
    }
    setUploading(true);
    setError(null);
    try {
      await onUploadCSVText('banknifty_5m_no_volume_test.csv', rows.join('\n'));
      setMessage('Loaded sample test CSV (Volume omitted, 1 duplicate injected for validation test).');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Card */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-sky-500" />
              <h2 className="font-display text-base font-semibold">Upload Historical 5-Minute Bank NIFTY CSV</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Expected columns: <code className="font-mono text-slate-700 dark:text-slate-300">Date, Time, Open, High, Low, Close, Volume</code>{' '}
              (Volume is optional). Validates missing cells, duplicate timestamps, and OHLC integrity.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold inline-flex items-center gap-2">
              <Upload className="w-3.5 h-3.5" />
              <span>{uploading ? 'Parsing CSV...' : 'Upload CSV File'}</span>
              <input type="file" accept=".csv" className="hidden" onChange={handleFile} disabled={uploading} />
            </label>
            <button
              type="button"
              onClick={handleLoadTestCsvWithIssues}
              disabled={uploading}
              className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
            >
              Load Test CSV (No Volume)
            </button>
            {activeDataset && (
              <a
                href={`/api/data/export?datasetId=${activeDataset.id}`}
                className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Active CSV</span>
              </a>
            )}
          </div>
        </div>

        {message && (
          <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-600 dark:text-emerald-400">
            {message}
          </div>
        )}
        {error && (
          <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-500">
            {error}
          </div>
        )}
      </div>

      {/* Dataset Registry & Quality Audit */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800/80">
          <h3 className="font-display text-base font-semibold">Stored Market Datasets ({datasets.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-left">
                <th className="py-2.5 px-4 font-medium">Dataset</th>
                <th className="py-2.5 px-4 font-medium">Source Type</th>
                <th className="py-2.5 px-4 font-medium text-right">Records</th>
                <th className="py-2.5 px-4 font-medium">Date Range</th>
                <th className="py-2.5 px-4 font-medium text-right">Missing</th>
                <th className="py-2.5 px-4 font-medium text-right">Duplicates</th>
                <th className="py-2.5 px-4 font-medium text-right">Invalid OHLC</th>
                <th className="py-2.5 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {datasets.map((ds) => {
                const needsClean = ds.duplicate_count > 0 || ds.invalid_ohlc_count > 0 || ds.missing_count > 0;
                return (
                  <tr key={ds.id} className={ds.is_active ? 'bg-sky-500/6' : ''}>
                    <td className="py-3 px-4 font-medium">
                      <div className="flex items-center gap-2">
                        {ds.is_active ? <CheckCircle2 className="w-3.5 h-3.5 text-sky-500 shrink-0" /> : null}
                        <span>{ds.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {ds.source_type === 'sample_historical' ? 'Sample Historical' : 'Uploaded CSV'}
                      {ds.has_volume ? ' · Vol' : ' · No Vol'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {ds.record_count.toLocaleString('en-IN')}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                      {ds.start_date} → {ds.end_date}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{ds.missing_count}</td>
                    <td
                      className={`py-3 px-4 text-right font-mono tabular-nums ${
                        ds.duplicate_count > 0 ? 'text-amber-500 font-semibold' : ''
                      }`}
                    >
                      {ds.duplicate_count}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono tabular-nums ${
                        ds.invalid_ohlc_count > 0 ? 'text-red-500 font-semibold' : ''
                      }`}
                    >
                      {ds.invalid_ohlc_count}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                      {needsClean && (
                        <button
                          type="button"
                          disabled={cleaningId === ds.id}
                          onClick={() => handleClean(ds.id)}
                          className="px-2.5 py-1 rounded border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 text-xs font-medium inline-flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>{cleaningId === ds.id ? 'Cleaning...' : 'Clean'}</span>
                        </button>
                      )}
                      {!ds.is_active && (
                        <button
                          type="button"
                          onClick={() => onActivateDataset(ds.id)}
                          className="px-2.5 py-1 rounded border border-sky-500/40 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 text-xs font-medium"
                        >
                          Activate
                        </button>
                      )}
                      {ds.is_active && (
                        <span className="text-sky-600 dark:text-sky-400 font-medium">Active</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Preview Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D131F] overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">Active Dataset Preview (Latest 25 Candles)</h3>
          <span className="text-xs text-slate-500">{activeDataset?.name ?? '—'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-left">
                <th className="py-2.5 px-4 font-sans">Date</th>
                <th className="py-2.5 px-4 font-sans">Time</th>
                <th className="py-2.5 px-4 text-right font-sans">Open</th>
                <th className="py-2.5 px-4 text-right font-sans">High</th>
                <th className="py-2.5 px-4 text-right font-sans">Low</th>
                <th className="py-2.5 px-4 text-right font-sans">Close</th>
                <th className="py-2.5 px-4 text-right font-sans">Volume</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {preview.map((row, idx) => (
                <tr key={idx}>
                  <td className="py-2 px-4">{row.date_str}</td>
                  <td className="py-2 px-4">{row.time_str}</td>
                  <td className="py-2 px-4 text-right">{row.open.toFixed(2)}</td>
                  <td className="py-2 px-4 text-right text-emerald-500">{row.high.toFixed(2)}</td>
                  <td className="py-2 px-4 text-right text-red-500">{row.low.toFixed(2)}</td>
                  <td className="py-2 px-4 text-right font-semibold">{row.close.toFixed(2)}</td>
                  <td className="py-2 px-4 text-right text-slate-500">
                    {row.volume !== null ? row.volume.toLocaleString('en-IN') : 'N/A'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
