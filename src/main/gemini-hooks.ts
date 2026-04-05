import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { STATUS_DIR, STATUS_DIR_ENV_VAR } from './hook-status';
import { readJsonSafe } from './fs-utils';
import type { InspectorEventType, SettingsValidationResult } from '../shared/types';

export const GEMINI_HOOK_MARKER = '# vibeyard-hook';

const HOME_DIR = homedir();
const joinHomePath = (...parts: string[]): string =>
  HOME_DIR.startsWith('/')
    ? path.posix.join(HOME_DIR, ...parts)
    : path.join(HOME_DIR, ...parts);
const GEMINI_DIR = joinHomePath('.gemini');
const SETTINGS_PATH = joinHomePath('.gemini', 'settings.json');

export const SESSION_ID_VAR = 'VIBEYARD_SESSION_ID';

const EXPECTED_HOOK_EVENTS = ['SessionStart', 'BeforeAgent', 'AfterTool', 'AfterAgent', 'SessionEnd'];

interface HookHandler {
  type: string;
  command: string;
  name?: string;
}

interface HookMatcherEntry {
  matcher?: string;
  hooks: HookHandler[];
}

type HooksConfig = Record<string, HookMatcherEntry[]>;

function isIdeHook(h: HookHandler): boolean {
  return h.command?.includes(GEMINI_HOOK_MARKER) ?? false;
}

function buildNodeEvalCommand(code: string): string {
  const encoded = Buffer.from(code, 'utf8').toString('base64');
  return `node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))" ${GEMINI_HOOK_MARKER}`;
}

function buildStatusCommand(event: string, status: string): string {
  const payload = `${event}:${status}`;
  return buildNodeEvalCommand(
    `const fs=require('fs');` +
      `const path=require('path');` +
      `const sid=process.env[${JSON.stringify(SESSION_ID_VAR)}]||'';` +
      `const statusDir=process.env[${JSON.stringify(STATUS_DIR_ENV_VAR)}]||${JSON.stringify(STATUS_DIR)};` +
      `if(sid){` +
      `fs.mkdirSync(statusDir,{recursive:true});` +
      `fs.writeFileSync(path.join(statusDir,sid+'.status'),${JSON.stringify(payload)});` +
      `}`
  );
}

function buildStdinJsonCommand(body: string): string {
  return buildNodeEvalCommand(
    `let input='';` +
      `process.stdin.setEncoding('utf8');` +
      `process.stdin.on('data',chunk=>input+=chunk);` +
      `process.stdin.on('end',()=>{` +
      `let d;` +
      `try{d=JSON.parse(input||'{}');}catch{return;}` +
      body +
      `});` +
      `process.stdin.resume();`
  );
}

function buildEventCaptureCommand(hookEvent: string, eventType: InspectorEventType): string {
  return buildStdinJsonCommand(
    `const fs=require('fs');` +
      `const path=require('path');` +
      `const sid=process.env[${JSON.stringify(SESSION_ID_VAR)}]||'';` +
      `if(!sid)return;` +
      `const statusDir=process.env[${JSON.stringify(STATUS_DIR_ENV_VAR)}]||${JSON.stringify(STATUS_DIR)};` +
      `const e={type:${JSON.stringify(eventType)},timestamp:Date.now(),hookEvent:${JSON.stringify(hookEvent)}};` +
      `const toolName=d.tool_name||'';` +
      `if(toolName)e.tool_name=toolName;` +
      `if(d.tool_input)e.tool_input=d.tool_input;` +
      `for(const field of ['session_id','cwd']){` +
      `const value=d[field];` +
      `if(value)e[field]=value;` +
      `}` +
      `fs.mkdirSync(statusDir,{recursive:true});` +
      `fs.appendFileSync(path.join(statusDir,sid+'.events'),JSON.stringify(e)+'\\n');`
  );
}

function buildSessionIdCaptureCommand(): string {
  return buildStdinJsonCommand(
    `const fs=require('fs');` +
      `const path=require('path');` +
      `const sid=process.env[${JSON.stringify(SESSION_ID_VAR)}]||'';` +
      `const cliSid=d.session_id||'';` +
      `const statusDir=process.env[${JSON.stringify(STATUS_DIR_ENV_VAR)}]||${JSON.stringify(STATUS_DIR)};` +
      `if(!sid||!cliSid)return;` +
      `fs.mkdirSync(statusDir,{recursive:true});` +
      `fs.writeFileSync(path.join(statusDir,sid+'.sessionid'),cliSid);`
  );
}

// ---------------------------------------------------------------------------
// Hook installation
// ---------------------------------------------------------------------------

function cleanHooks(existing: HooksConfig): HooksConfig {
  const cleaned: HooksConfig = {};
  for (const [event, matchers] of Object.entries(existing)) {
    const filteredMatchers = matchers
      .map((m) => ({
        ...m,
        hooks: (m.hooks ?? []).filter((h) => !isIdeHook(h)),
      }))
      .filter((m) => m.hooks.length > 0);
    if (filteredMatchers.length > 0) {
      cleaned[event] = filteredMatchers;
    }
  }
  return cleaned;
}

export function installGeminiHooks(): void {
  fs.mkdirSync(GEMINI_DIR, { recursive: true });

  const settings = readJsonSafe(SETTINGS_PATH) ?? {};
  const existingHooks: HooksConfig = (settings.hooks ?? {}) as HooksConfig;
  const cleaned = cleanHooks(existingHooks);

  const captureSessionIdCmd = buildSessionIdCaptureCommand();

  // Status-changing events
  const ideEvents: Record<string, string> = {
    SessionStart: 'waiting',
    BeforeAgent: 'working',
    AfterTool: 'working',
    AfterAgent: 'completed',
    SessionEnd: 'completed',
  };

  const eventTypeMap: Record<string, InspectorEventType> = {
    SessionStart: 'session_start',
    BeforeAgent: 'user_prompt',
    AfterTool: 'tool_use',
    AfterAgent: 'stop',
    SessionEnd: 'stop',
  };

  for (const [event, status] of Object.entries(ideEvents)) {
    const existing = cleaned[event] ?? [];
    const hooks: HookHandler[] = [
      { type: 'command', command: buildStatusCommand(event, status), name: 'vibeyard-status' },
    ];
    if (event === 'SessionStart' || event === 'BeforeAgent') {
      hooks.push({ type: 'command', command: captureSessionIdCmd, name: 'vibeyard-sessionid' });
    }
    hooks.push({ type: 'command', command: buildEventCaptureCommand(event, eventTypeMap[event]), name: 'vibeyard-events' });
    existing.push({ matcher: '', hooks });
    cleaned[event] = existing;
  }

  const output = { ...settings, hooks: cleaned };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(output, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateGeminiHooks(): SettingsValidationResult {
  const settings = readJsonSafe(SETTINGS_PATH);
  const existingHooks: HooksConfig = (settings?.hooks ?? {}) as HooksConfig;
  const hookDetails: Record<string, boolean> = Object.fromEntries(EXPECTED_HOOK_EVENTS.map(e => [e, false]));
  let found = 0;

  for (const event of EXPECTED_HOOK_EVENTS) {
    const matchers = existingHooks[event];
    const installed = matchers?.some(m => m.hooks?.some(h => isIdeHook(h))) ?? false;
    hookDetails[event] = installed;
    if (installed) found++;
  }

  let hooks: SettingsValidationResult['hooks'] = 'missing';
  if (found === EXPECTED_HOOK_EVENTS.length) {
    hooks = 'complete';
  } else if (found > 0) {
    hooks = 'partial';
  }

  return { statusLine: 'vibeyard', hooks, hookDetails };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function cleanupGeminiHooks(): void {
  const settings = readJsonSafe(SETTINGS_PATH);
  if (!settings) return;

  const existingHooks: HooksConfig = (settings.hooks ?? {}) as HooksConfig;
  const cleaned = cleanHooks(existingHooks);

  if (Object.keys(cleaned).length === 0) {
    delete (settings as Record<string, unknown>).hooks;
  } else {
    (settings as Record<string, unknown>).hooks = cleaned;
  }

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
}
