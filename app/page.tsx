'use client';

import { useState, useRef, useCallback } from 'react';
import Papa from 'papaparse';
import {
  Upload,
  Play,
  Square,
  Download,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Clipboard,
  Eye,
  Lock,
} from 'lucide-react';

// ============================================================
// 型定義
// ============================================================
type Result = {
  name: string;
  pref: string;
  url: string;
  phone: string;
  status: 'hit' | 'miss' | 'error';
  error?: string;
};

// ============================================================
// API 呼び出し (Vercel API Route 経由)
// ============================================================
async function lookupCompany(
  name: string,
  pref: string,
  password: string
): Promise<{ url: string; phone: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (password) headers['x-app-password'] = password;

  const response = await fetch('/api/lookup', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, pref }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return { url: data.url || '', phone: data.phone || '' };
}

// ============================================================
// メイン
// ============================================================
export default function Page() {
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, name: '' });
  const [logs, setLogs] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState(5);
  const [elapsed, setElapsed] = useState(0);
  const [showCsvText, setShowCsvText] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [password, setPassword] = useState('');
  const stopRef = useRef(false);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const log = useCallback((msg: string) => {
    setLogs((prev) => [...prev.slice(-30), `${new Date().toLocaleTimeString('ja-JP')} ${msg}`]);
  }, []);

  // ファイル読み込み
  const handleFile = (file: File | null | undefined) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      let text: string;
      try {
        text = new TextDecoder('shift-jis', { fatal: true }).decode(buffer);
      } catch {
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch {
          text = new TextDecoder('utf-8').decode(buffer);
        }
      }
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
      const cleanRows = (parsed.data as string[][]).filter(
        (r) => Array.isArray(r) && r.length >= 2 && r[0]?.trim()
      );
      setRows(cleanRows);
      setResults([]);
      log(`CSV読み込み完了: ${cleanRows.length} 件`);
    };
    reader.onerror = () => log('ファイル読み込み失敗');
    reader.readAsArrayBuffer(file);
  };

  // 実行
  const run = async () => {
    if (rows.length === 0 || running) return;
    setRunning(true);
    stopRef.current = false;
    const target = rows.slice(0, Math.min(batchSize, rows.length));
    setProgress({ current: 0, total: target.length, name: '' });
    setResults([]);
    log(`実行開始: ${target.length} 件`);

    const t0 = Date.now();
    setElapsed(0);
    elapsedTimerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - t0) / 1000));
    }, 500);

    const acc: Result[] = [];
    for (let i = 0; i < target.length; i++) {
      if (stopRef.current) {
        log(`中断 (${i}/${target.length} 完了)`);
        break;
      }
      const [name, pref] = target[i].map((s) => (s || '').trim());
      setProgress({ current: i + 1, total: target.length, name });
      try {
        const { url, phone } = await lookupCompany(name, pref, password);
        acc.push({ name, pref, url, phone, status: url ? 'hit' : 'miss' });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '不明なエラー';
        acc.push({ name, pref, url: '', phone: '', status: 'error', error: msg });
        log(`エラー: ${name} - ${msg}`);
      }
      setResults([...acc]);
    }

    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    setRunning(false);
    const hits = acc.filter((r) => r.url).length;
    log(`完了: ${acc.length} 件処理、URL取得 ${hits} 件 (${(hits / Math.max(acc.length, 1) * 100).toFixed(0)}%)`);
  };

  const stop = () => {
    stopRef.current = true;
  };

  // CSV テキスト生成 (BOM + CRLF)
  const buildCsvText = () => {
    const escape = (c: string) => `"${String(c || '').replace(/"/g, '""')}"`;
    const lines = [
      ['法人名', '都道府県', 'URL', '電話番号'].map(escape).join(','),
      ...results.map((r) => [r.name, r.pref, r.url, r.phone].map(escape).join(',')),
    ].join('\r\n');
    return '\uFEFF' + lines;
  };

  const downloadCSV = () => {
    if (results.length === 0) return;
    const csvContent = buildCsvText();
    try {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `法人リスト_収集結果_${new Date().toISOString().slice(0, 10)}.csv`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      log(`CSV ダウンロード: ${results.length} 件`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '不明';
      log(`ダウンロード失敗: ${msg}`);
      setShowCsvText(true);
    }
  };

  const copyCSV = async () => {
    if (results.length === 0) return;
    try {
      await navigator.clipboard.writeText(buildCsvText());
      setCopyMessage('コピーしました');
      setTimeout(() => setCopyMessage(''), 2000);
      log(`クリップボードへコピー: ${results.length} 件`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '不明';
      log(`コピー失敗: ${msg}`);
      setShowCsvText(true);
    }
  };

  const hits = results.filter((r) => r.url).length;
  const errors = results.filter((r) => r.status === 'error').length;
  const hitRate = results.length > 0 ? ((hits / results.length) * 100).toFixed(0) : '0';

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <div className="grid-bg min-h-screen">
        <div className="max-w-6xl mx-auto px-6 py-10">
          {/* ヘッダー */}
          <header className="mb-10 pb-6 border-b-2 border-stone-900">
            <div className="flex items-baseline gap-4 mb-2">
              <span className="mono-font text-xs accent tracking-widest">SALES LIST BUILDER</span>
              <span className="mono-font text-xs text-stone-400">v0.2 / vercel</span>
            </div>
            <h1 className="display-font text-4xl font-extrabold tracking-tight mb-2">
              法人リスト <span className="accent">URL + 電話番号</span> 収集ツール
            </h1>
            <p className="text-sm text-stone-600 leading-relaxed">
              CSV を読み込んで Claude + Web 検索で各社の公式サイト URL と代表電話番号を自動収集します。
            </p>
          </header>

          {/* パスワード (APP_PASSWORD 設定時のみ入力) */}
          <section className="mb-8">
            <details className="bg-white border border-stone-200 rounded-sm">
              <summary className="cursor-pointer px-4 py-2 mono-font text-xs text-stone-500 hover:bg-stone-50 flex items-center gap-2">
                <Lock className="w-3 h-3" /> パスワード (設定されている場合)
              </summary>
              <div className="px-4 py-3 border-t border-stone-100">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="APP_PASSWORD"
                  className="w-full mono-font text-sm border border-stone-300 px-3 py-2 rounded-sm bg-white"
                />
              </div>
            </details>
          </section>

          {/* 01: ファイル選択 */}
          <section className="mb-8">
            <div className="mb-3 flex items-baseline gap-3">
              <span className="mono-font text-xs accent">01</span>
              <h2 className="display-font font-bold text-lg">CSV を読み込む</h2>
              <span className="text-xs text-stone-500">(Shift-JIS / UTF-8 対応 · 2列: 法人名, 都道府県)</span>
            </div>

            <label className="block cursor-pointer">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => handleFile(e.target.files?.[0])}
                disabled={running}
                className="hidden"
              />
              <div
                className={`border-2 border-dashed ${
                  rows.length > 0 ? 'border-stone-300 bg-white' : 'accent-border bg-white hover:bg-stone-50'
                } rounded-sm p-8 transition-colors`}
              >
                {rows.length > 0 ? (
                  <div className="flex items-center gap-4">
                    <FileText className="w-8 h-8 text-stone-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{fileName}</div>
                      <div className="mono-font text-sm text-stone-500">{rows.length.toLocaleString()} 件</div>
                    </div>
                    <span className="mono-font text-xs accent">CHANGE →</span>
                  </div>
                ) : (
                  <div className="text-center">
                    <Upload className="w-8 h-8 mx-auto mb-2 accent" />
                    <div className="font-medium mb-1">クリックして CSV を選択</div>
                    <div className="mono-font text-xs text-stone-500">.csv (Shift-JIS / UTF-8)</div>
                  </div>
                )}
              </div>
            </label>
          </section>

          {/* 02: 実行 */}
          {rows.length > 0 && (
            <section className="mb-8">
              <div className="mb-3 flex items-baseline gap-3">
                <span className="mono-font text-xs accent">02</span>
                <h2 className="display-font font-bold text-lg">実行する</h2>
              </div>

              <div className="bg-white border border-stone-200 rounded-sm p-5">
                <div className="flex flex-wrap gap-4 items-end mb-4">
                  <div>
                    <label className="block mono-font text-xs text-stone-500 mb-1">処理件数 (先頭から)</label>
                    <select
                      value={batchSize}
                      onChange={(e) => setBatchSize(Number(e.target.value))}
                      disabled={running}
                      className="mono-font border border-stone-300 px-3 py-2 rounded-sm bg-white"
                    >
                      <option value={3}>3 件</option>
                      <option value={5}>5 件</option>
                      <option value={10}>10 件</option>
                      <option value={20}>20 件</option>
                      <option value={50}>50 件</option>
                      <option value={100}>100 件</option>
                    </select>
                    <div className="mono-font text-xs text-stone-400 mt-1">
                      {Math.min(batchSize, rows.length)} / {rows.length.toLocaleString()} 件
                    </div>
                  </div>
                  <div className="flex gap-2 ml-auto">
                    {!running ? (
                      <button
                        onClick={run}
                        disabled={rows.length === 0}
                        className="accent-bg text-white px-6 py-2.5 rounded-sm font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-30 transition-opacity"
                      >
                        <Play className="w-4 h-4" /> 実行
                      </button>
                    ) : (
                      <button
                        onClick={stop}
                        className="bg-stone-900 text-white px-6 py-2.5 rounded-sm font-medium flex items-center gap-2 hover:opacity-80"
                      >
                        <Square className="w-4 h-4" /> 中断
                      </button>
                    )}
                  </div>
                </div>

                {(running || results.length > 0) && (
                  <div className="border-t border-stone-100 pt-4">
                    <div className="flex justify-between items-center mb-2">
                      <div className="mono-font text-sm">
                        {running ? (
                          <span className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin accent" />
                            <span className="accent font-medium">{progress.current}</span>
                            <span className="text-stone-400">/</span>
                            <span>{progress.total}</span>
                            <span className="text-stone-400 ml-2 truncate max-w-xs">{progress.name}</span>
                          </span>
                        ) : (
                          <span className="text-stone-600">処理完了</span>
                        )}
                      </div>
                      <div className="mono-font text-xs text-stone-500">
                        {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
                      </div>
                    </div>
                    <div className="h-1 bg-stone-100 rounded overflow-hidden">
                      <div
                        className="h-full accent-bg transition-all duration-300"
                        style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 03: 結果 */}
          {results.length > 0 && (
            <section className="mb-8">
              <div className="mb-3 flex items-baseline gap-3 justify-between flex-wrap">
                <div className="flex items-baseline gap-3">
                  <span className="mono-font text-xs accent">03</span>
                  <h2 className="display-font font-bold text-lg">結果</h2>
                </div>
                <div className="flex gap-2 items-center">
                  {copyMessage && <span className="mono-font text-xs accent">{copyMessage}</span>}
                  <button
                    onClick={downloadCSV}
                    className="text-sm border border-stone-900 px-3 py-1.5 rounded-sm hover:bg-stone-900 hover:text-white transition-colors flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" /> ダウンロード
                  </button>
                  <button
                    onClick={copyCSV}
                    className="text-sm border border-stone-900 px-3 py-1.5 rounded-sm hover:bg-stone-900 hover:text-white transition-colors flex items-center gap-1.5"
                  >
                    <Clipboard className="w-3.5 h-3.5" /> コピー
                  </button>
                  <button
                    onClick={() => setShowCsvText((s) => !s)}
                    className="text-sm border border-stone-300 px-3 py-1.5 rounded-sm hover:bg-stone-100 transition-colors flex items-center gap-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" /> テキスト
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 mb-4">
                <Stat label="処理" value={results.length} unit="件" />
                <Stat label="URL取得" value={hits} unit="件" highlight />
                <Stat label="ヒット率" value={Number(hitRate)} unit="%" highlight />
                <Stat label="エラー" value={errors} unit="件" warning={errors > 0} />
              </div>

              <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-stone-50 border-b border-stone-200">
                        <th className="text-left px-3 py-2 mono-font text-xs font-medium text-stone-500 uppercase tracking-wider w-8">#</th>
                        <th className="text-left px-3 py-2 mono-font text-xs font-medium text-stone-500 uppercase tracking-wider">法人名</th>
                        <th className="text-left px-3 py-2 mono-font text-xs font-medium text-stone-500 uppercase tracking-wider w-24">都道府県</th>
                        <th className="text-left px-3 py-2 mono-font text-xs font-medium text-stone-500 uppercase tracking-wider">URL</th>
                        <th className="text-left px-3 py-2 mono-font text-xs font-medium text-stone-500 uppercase tracking-wider w-36">電話番号</th>
                        <th className="text-left px-3 py-2 mono-font text-xs font-medium text-stone-500 uppercase tracking-wider w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r, i) => (
                        <tr key={i} className="border-b border-stone-100 hover:bg-stone-50">
                          <td className="px-3 py-2 mono-font text-xs text-stone-400">{i + 1}</td>
                          <td className="px-3 py-2 font-medium">{r.name}</td>
                          <td className="px-3 py-2 text-stone-600">{r.pref}</td>
                          <td className="px-3 py-2 mono-font text-xs">
                            {r.url ? (
                              <a href={r.url} target="_blank" rel="noopener noreferrer" className="accent hover:underline break-all">
                                {r.url}
                              </a>
                            ) : (
                              <span className="text-stone-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 mono-font text-xs">
                            {r.phone || <span className="text-stone-300">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            {r.status === 'hit' && <CheckCircle2 className="w-4 h-4 text-green-700" />}
                            {r.status === 'miss' && <span className="text-stone-300 text-xs">—</span>}
                            {r.status === 'error' && <XCircle className="w-4 h-4 text-red-600" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {showCsvText && (
                <div className="mt-3 bg-white border border-stone-200 rounded-sm p-3">
                  <div className="mb-2 flex justify-between items-center">
                    <span className="mono-font text-xs text-stone-500">
                      CSV テキスト (クリックで全選択 → Ctrl+C / ⌘+C でコピー)
                    </span>
                    <button onClick={() => setShowCsvText(false)} className="text-xs text-stone-400 hover:text-stone-700">
                      閉じる
                    </button>
                  </div>
                  <textarea
                    readOnly
                    value={buildCsvText()}
                    className="w-full h-48 mono-font text-xs border border-stone-200 p-2 bg-stone-50 rounded-sm"
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                  />
                </div>
              )}
            </section>
          )}

          {logs.length > 0 && (
            <section className="mb-8">
              <details className="bg-white border border-stone-200 rounded-sm">
                <summary className="cursor-pointer px-4 py-2 mono-font text-xs text-stone-500 hover:bg-stone-50">
                  LOG ({logs.length})
                </summary>
                <div className="px-4 py-3 border-t border-stone-100 max-h-48 overflow-y-auto">
                  {logs.map((l, i) => (
                    <div key={i} className="mono-font text-xs text-stone-600 py-0.5">
                      {l}
                    </div>
                  ))}
                </div>
              </details>
            </section>
          )}

          <footer className="mt-12 pt-6 border-t border-stone-200">
            <div className="flex items-start gap-3 text-xs text-stone-500">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong className="text-stone-700">運用メモ:</strong> 件数が増えると Anthropic API 課金が発生します
                (1件あたり目安 $0.05〜$0.15)。3万件規模の本番処理は別途 Python 版 (DuckDuckGo 利用 / 無料) を推奨。
              </p>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 小コンポーネント
// ============================================================
function Stat({
  label,
  value,
  unit,
  highlight,
  warning,
}: {
  label: string;
  value: number;
  unit: string;
  highlight?: boolean;
  warning?: boolean;
}) {
  return (
    <div
      className={`bg-white border ${
        warning ? 'border-red-200' : highlight ? 'accent-border' : 'border-stone-200'
      } rounded-sm p-3`}
    >
      <div className="mono-font text-xs text-stone-500 uppercase tracking-wider">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={`display-font text-2xl font-extrabold ${
            warning ? 'text-red-700' : highlight ? 'accent' : 'text-stone-900'
          }`}
        >
          {value.toLocaleString()}
        </span>
        <span className="mono-font text-xs text-stone-400">{unit}</span>
      </div>
    </div>
  );
}
