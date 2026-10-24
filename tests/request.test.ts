import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSameOrigin } from '../lib/request';

function request(url: string, headers: Record<string, string> = {}) {
  return { url, headers: new Headers(headers) };
}

test('accepts the incoming browser host when Next reconstructs an internal localhost URL', () => {
  assert.equal(hasSameOrigin(request('http://localhost:3210/api/workspace', {
    host: '127.0.0.1:3210', origin: 'http://127.0.0.1:3210',
  })), true);
});

test('normalizes authority casing and default ports while preserving origin scheme and port', () => {
  assert.equal(hasSameOrigin(request('https://internal.example/api/leads', {
    host: 'WORKSPACE.EXAMPLE:443', origin: 'https://workspace.example',
  })), true);
  assert.equal(hasSameOrigin(request('https://internal.example/api/leads', {
    host: 'workspace.example', origin: 'http://workspace.example',
  })), false);
  assert.equal(hasSameOrigin(request('http://localhost:3000/api/leads', {
    host: 'localhost:3000', origin: 'http://localhost:3001',
  })), false);
});

test('rejects missing, opaque, cross-site and malformed origins', () => {
  for (const origin of [undefined, '', 'null', 'https://evil.example',
    'javascript:alert(1)', 'ftp://workspace.example',
    'https://workspace.example/path', 'https://workspace.example?x=1',
    'https://workspace.example#fragment', 'https://user:password@workspace.example',
    'https://workspace.example https://evil.example']) {
    const headers: Record<string, string> = { host: 'workspace.example' };
    if (origin !== undefined) headers.origin = origin;
    assert.equal(hasSameOrigin(request('https://localhost/api/leads', headers)), false);
  }
});

test('ignores forwarded-host and forwarded-proto values supplied by the request', () => {
  assert.equal(hasSameOrigin(request('https://localhost/api/leads', {
    host: 'workspace.example', origin: 'https://evil.example',
    'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https',
  })), false);
  assert.equal(hasSameOrigin(request('https://localhost/api/leads', {
    host: 'workspace.example', origin: 'https://workspace.example',
    'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http',
  })), true);
});

test('falls back to request URL host only when Host is absent and rejects malformed authorities', () => {
  assert.equal(hasSameOrigin(request('http://127.0.0.1:3210/api/leads', {
    origin: 'http://127.0.0.1:3210',
  })), true);
  for (const host of ['', 'workspace.example/extra', 'workspace.example/.',
    'user@workspace.example', 'workspace.example?x=1', 'workspace.example#fragment',
    'workspace.example,evil.example', 'workspace.example evil.example']) {
    assert.equal(hasSameOrigin(request('https://localhost/api/leads', {
      host, origin: 'https://workspace.example',
    })), false);
  }
});

test('an explicit trusted origin binds host and scheme without trusting proxy headers', () => {
  assert.equal(hasSameOrigin(request('http://localhost/api/leads', {
    host: 'workspace.example', origin: 'https://workspace.example',
  }), 'https://workspace.example'), true);
  assert.equal(hasSameOrigin(request('http://localhost/api/leads', {
    host: 'evil.example', origin: 'https://evil.example',
  }), 'https://workspace.example'), false);
  assert.equal(hasSameOrigin(request('https://localhost/api/leads', {
    host: 'workspace.example', origin: 'https://workspace.example',
  }), 'invalid origin'), false);
});
