/**
 * locateEdge — pure, so every case runs with an injected env and an
 * injected `exists` rather than the real filesystem.
 */
import { describe, it, expect } from 'vitest';
import { locateEdge } from './edge.js';

const NONE: NodeJS.ProcessEnv = {};

describe('locateEdge', () => {
  it('finds Edge under Program Files (x86) — the normal 64-bit Windows location', () => {
    const env = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)' } as NodeJS.ProcessEnv;
    const exists = (p: string) => p === 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const r = locateEdge(env, exists);
    expect(r).toEqual({ ok: true, path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', reason: null });
  });

  it('falls back to Program Files when the x86 copy is absent', () => {
    const env = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files' } as NodeJS.ProcessEnv;
    const exists = (p: string) => p === 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
    const r = locateEdge(env, exists);
    expect(r.ok).toBe(true);
    expect(r.path).toBe('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe');
  });

  it('falls back to the per-user LocalAppData install last', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\op\\AppData\\Local' } as NodeJS.ProcessEnv;
    const exists = (p: string) => p === 'C:\\Users\\op\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe';
    const r = locateEdge(env, exists);
    expect(r.ok).toBe(true);
    expect(r.path).toBe('C:\\Users\\op\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe');
  });

  it('fails loudly, with a named actionable reason, when nothing is found anywhere', () => {
    const r = locateEdge(NONE, () => false);
    expect(r.ok).toBe(false);
    expect(r.path).toBeNull();
    expect(r.reason).toMatch(/Microsoft Edge was not found/);
    expect(r.reason).toMatch(/PDF_EDGE_PATH/);
  });

  it('an explicit PDF_EDGE_PATH override wins even when the standard locations also have a copy', () => {
    const env = {
      PDF_EDGE_PATH: 'D:\\custom\\msedge.exe',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    } as NodeJS.ProcessEnv;
    const exists = (p: string) => p === 'D:\\custom\\msedge.exe' || p === 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const r = locateEdge(env, exists);
    expect(r).toEqual({ ok: true, path: 'D:\\custom\\msedge.exe', reason: null });
  });

  it('a wrong PDF_EDGE_PATH override fails loudly and does NOT silently fall back to the auto-probe', () => {
    const env = {
      PDF_EDGE_PATH: 'D:\\wrong\\msedge.exe',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    } as NodeJS.ProcessEnv;
    // The x86 copy genuinely exists, but the override must still win — and fail.
    const exists = (p: string) => p === 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const r = locateEdge(env, exists);
    expect(r.ok).toBe(false);
    expect(r.path).toBeNull();
    expect(r.reason).toMatch(/PDF_EDGE_PATH is set to "D:\\wrong\\msedge\.exe"/);
  });
});
