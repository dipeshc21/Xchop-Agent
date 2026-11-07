'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ProspectingSetupActions({ migration = '009_restore_hunter_discovery.sql' }: { migration?: '006_project_requests.sql' | '007_project_contacts.sql' | '008_discovery_reliability.sql' | '009_restore_hunter_discovery.sql' | '010_free_alert_sources.sql' }) {
  const migrationUrl = `/migrations/${migration}`;
  const contactUpdate = migration === '007_project_contacts.sql';
  const discoveryRepair = migration === '008_discovery_reliability.sql';
  const hunterRestoration = migration === '009_restore_hunter_discovery.sql';
  const freeAlertSetup = migration === '010_free_alert_sources.sql';
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  const [manualSql, setManualSql] = useState('');

  async function copySql() {
    setBusy(true);
    setCopied(false);
    setMessage('');
    try {
      const response = await fetch(migrationUrl, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('The migration file could not be opened. Use the SQL file link below.');
      const sql = await response.text();
      if (!sql.trim()) throw new Error('The migration file was empty. Use the SQL file in your project folder.');
      if (!navigator.clipboard?.writeText) {
        setManualSql(sql);
        setMessage('Select and copy the SQL below, then paste it into a new Supabase SQL query.');
        return;
      }
      try {
        await navigator.clipboard.writeText(sql);
        setManualSql('');
        setCopied(true);
        setMessage('SQL copied. Open Supabase → SQL Editor → New query, paste, then click Run.');
      } catch {
        setManualSql(sql);
        setMessage('Clipboard access is unavailable. Select and copy the SQL below instead.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The migration could not be copied. Open the SQL file below.');
    } finally {
      setBusy(false);
    }
  }

  return <div style={{ marginTop: 16 }}>
    <div className="setup-actions">
      <Button type="button" disabled={busy} onClick={copySql}>
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {busy ? 'Opening SQL…' : copied ? 'SQL copied' : freeAlertSetup ? 'Copy free-alert setup SQL' : hunterRestoration ? 'Copy Hunter restoration SQL' : discoveryRepair ? 'Copy discovery-repair SQL' : contactUpdate ? 'Copy contact-update SQL' : 'Copy project-request SQL'}
      </Button>
      <a className="button outline" href={migrationUrl} target="_blank" rel="noreferrer">
        Open SQL file <ExternalLink size={15} />
      </a>
    </div>
    {message && <p role="status" style={{ fontSize: 12, marginTop: 12 }}>{message}</p>}
    {manualSql && <label style={{ marginTop: 16 }}>
      Migration SQL — click inside, select all, and copy
      <textarea aria-label="Migration SQL" readOnly rows={12} value={manualSql} onFocus={event => event.currentTarget.select()} />
    </label>}
  </div>;
}
