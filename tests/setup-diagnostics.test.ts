import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCESS_REPAIR_MIGRATION, classifySetupFailure, classifySetupResult,
  isReadableDashboardSummary, safeSetupErrorCode, setupReasonMessage,
} from '../lib/setup-diagnostics';

const summary = {
  leadCount: 0, sentCount: 0, replyRate: 0, wonCount: 0, pipelineValue: 0,
  quoteCount: 0, revenue: [], funnel: [], markets: [], attention: [],
};

test('missing dashboard RPC points to migration 003 without exposing provider details', () => {
  const check = classifySetupFailure('dashboard', {
    code: 'PGRST202', message: 'RAW_PROVIDER_SECRET', details: 'user-id=private', hint: 'private-key',
  });
  assert.equal(check.id, 'dashboard');
  assert.equal(check.status, 'blocked');
  assert.equal(check.code, 'PGRST202');
  assert.equal(check.migration, '003_dashboard_summary.sql');
  assert.ok(!JSON.stringify(check).includes('RAW_PROVIDER_SECRET'));
  assert.ok(!JSON.stringify(check).includes('private-key'));
  assert.ok(!JSON.stringify(check).includes('user-id'));
});

test('missing table codes identify the foundation with an existing-project rerun warning', () => {
  for (const code of ['42P01', 'PGRST205']) {
    const check = classifySetupFailure('settings', { code });
    assert.equal(check.label, 'Business settings');
    assert.equal(check.code, code);
    assert.equal(check.migration, '001_foundation.sql');
    assert.match(check.message, /new empty project/);
    assert.match(check.message, /existing project, do not rerun 001/);
  }
});

test('permission errors name only the additive access repair after prerequisites', () => {
  const check = classifySetupFailure('dashboard', { code: '42501', message: 'private row details' });
  assert.equal(check.migration, ACCESS_REPAIR_MIGRATION);
  assert.match(check.message, /After migrations 001–003 are installed/);
  assert.ok(!JSON.stringify(check).includes('private row details'));
});

test('expired database JWT and missing auth sessions ask for sign-in instead of SQL reinstall', () => {
  for (const error of [{ code: 'PGRST301' }, { name: 'AuthSessionMissingError' }, { code: 'refresh_token_not_found' }, { status: 401 }]) {
    const check = classifySetupFailure('authentication', error);
    assert.equal(check.status, 'blocked');
    assert.equal(check.migration, undefined);
    assert.match(check.message, /Sign in again/);
    assert.match(check.message, /Database installation is not the fix/);
  }
});

test('network and unknown errors recommend retry and never blindly run migration 001', () => {
  for (const error of [new TypeError('fetch failed TOKEN'), { code: 'ENOTFOUND', message: 'private host' }, { code: 'secret-token-that-is-not-a-code', message: 'secret' }]) {
    const check = classifySetupFailure('leads', error);
    assert.equal(check.migration, undefined);
    assert.equal(check.code, undefined);
    assert.match(check.message, /Refresh/);
    assert.match(check.message, /Do not rerun the foundation/);
    assert.ok(!JSON.stringify(check).includes('private host'));
    assert.ok(!JSON.stringify(check).includes('TOKEN'));
  }
  assert.equal(safeSetupErrorCode({ code: 'PGRST202' }), 'PGRST202');
  assert.equal(safeSetupErrorCode({ code: '42501' }), '42501');
  assert.equal(safeSetupErrorCode({ code: 'PGRST202 secret' }), undefined);
});

test('null or incomplete dashboard output cannot be marked ready', () => {
  for (const data of [null, undefined, {}, [], { ...summary, revenue: null }, { ...summary, leadCount: NaN }, { ...summary, attention: [{ id: 'not-a-complete-item' }] }]) {
    assert.equal(isReadableDashboardSummary(data), false);
    assert.equal(classifySetupResult('dashboard', { data, error: null }).status, 'blocked');
  }
  assert.equal(classifySetupResult('dashboard', { data: summary }).status, 'ready');
});

test('empty table results are ready and independent of a failed dashboard check', () => {
  const settings = classifySetupResult('settings', { data: [] });
  const dashboard = classifySetupResult('dashboard', { data: null, error: { code: 'PGRST202' } });
  assert.equal(settings.id, 'settings');
  assert.equal(settings.status, 'ready');
  assert.equal(dashboard.status, 'blocked');
  assert.equal(classifySetupResult('leads', { data: null }).status, 'blocked');
});

test('setup URL reason can only show fixed allowlisted explanations', () => {
  assert.match(setupReasonMessage('database') ?? '', /checks below/);
  assert.equal(setupReasonMessage('raw-provider-message-secret'), null);
  assert.equal(setupReasonMessage('<script>alert(1)</script>'), null);
  assert.equal(setupReasonMessage(['database', 'secret']), null);
  assert.equal(setupReasonMessage('__proto__'), null);
});


test('unexposed API schema has a targeted settings fix without a migration', () => {
  const check = classifySetupFailure('settings', { code: 'PGRST106', details: 'private provider text' });
  assert.equal(check.code, 'PGRST106');
  assert.equal(check.migration, undefined);
  assert.match(check.message, /Integrations → Data API/);
  assert.match(check.message, /keeping row-level security enabled/);
  assert.ok(!JSON.stringify(check).includes('private provider text'));
});
