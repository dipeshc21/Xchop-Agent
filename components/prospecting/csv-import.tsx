'use client';

import { useState, type FormEvent } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { csvImportLimits, type CsvImportResult, type CsvIssue } from '@/lib/csv';

export function CsvImport({ onImported }: { onImported?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [lawfulBasis, setLawfulBasis] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<CsvIssue[]>([]);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true); setError(''); setIssues([]); setResult(null);
    try {
      if (file.size > csvImportLimits.characters * 4) throw new Error('Choose a smaller CSV file with at most 200,000 characters.');
      const csv = await file.text();
      if (csv.length > csvImportLimits.characters) throw new Error('Import at most 200,000 characters at a time.');
      const response = await fetch('/api/leads/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv, lawfulBasis }) });
      const data = await response.json();
      if (!response.ok) { setIssues(data.issues || []); throw new Error(data.error || 'The file could not be imported.'); }
      setResult(data);
      if (data.imported > 0) onImported?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The file could not be imported.'); }
    finally { setBusy(false); }
  }
  return <details className="panel csv-import">
    <summary><Upload size={16} /> Import an existing contact list</summary>
    <form onSubmit={submit}>
      <p>Automatic discovery runs from <a href="/prospecting">Lead discovery</a>. Use CSV import for contacts you already have permission to collect. Import up to 25 rows at a time.</p>
      <p>Required headers: <code>company,email,country</code>. Optional: <code>website,contact_name,role,source,lawful_basis</code>. Do not include other columns.</p>
      <label>CSV file<input type="file" accept=".csv,text/csv" required disabled={busy} onChange={event => { setFile(event.target.files?.[0] || null); setError(''); setIssues([]); setResult(null); }} /></label>
      <label>Contact permission note<textarea rows={2} maxLength={2000} value={lawfulBasis} disabled={busy} onChange={event => setLawfulBasis(event.target.value)} placeholder="Explain why your business may collect and contact these prospects." /><small>At least 10 characters; used for rows without their own lawful_basis note. Importing does not verify an email address or send a message.</small></label>
      <Button disabled={!file || busy} type="submit"><Upload size={15} />{busy ? 'Importing…' : 'Import CSV'}</Button>
      {error && <div className="form-error" role="alert">{error}{issues.length > 0 && <ul>{issues.map(issue => <li key={issue.row}>Row {issue.row}: {issue.message}</li>)}</ul>}</div>}
      {result && <div className="csv-import-results" role="status"><p>{result.imported} imported · {result.skipped} skipped or not processed. Existing duplicate emails are skipped when you retry.</p><ul>{result.results.map(row => <li key={row.row}>Row {row.row}: {row.message}</li>)}</ul></div>}
    </form>
  </details>;
}

export default CsvImport;
