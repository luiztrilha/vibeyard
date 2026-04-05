import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { STATUS_DIR, STATUS_DIR_ENV_VAR, getStatusLineScriptPath } from './hook-status';
import { joinHomePath, joinPath, readJsonSafe, readDirSafe } from './fs-utils';
import type { McpServer, Agent, Skill, Command, ClaudeConfig, InspectorEventType } from '../shared/types';

export type { McpServer, Agent, Skill, Command, ClaudeConfig } from '../shared/types';

/** Parse YAML-ish frontmatter from an .md file (between --- delimiters) */
function parseFrontmatter(filePath: string): Record<string, string> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return {};
    const result: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/** Read MCP servers from settings.json mcpServers key and .mcp.json files */
function readMcpServers(settingsPath: string, mcpJsonPath: string, scope: 'user' | 'project'): McpServer[] {
  const servers: McpServer[] = [];

  // Read from settings.json mcpServers
  const settings = readJsonSafe(settingsPath);
  if (settings && typeof settings.mcpServers === 'object' && settings.mcpServers !== null) {
    const mcpServers = settings.mcpServers as Record<string, unknown>;
    for (const [name, config] of Object.entries(mcpServers)) {
      const cfg = config as Record<string, unknown>;
      const url = (cfg.url as string) || (cfg.command as string) || '';
      servers.push({ name, url, status: 'configured', scope, filePath: settingsPath });
    }
  }

  // Read from .mcp.json
  const mcpJson = readJsonSafe(mcpJsonPath);
  if (mcpJson && typeof mcpJson.mcpServers === 'object' && mcpJson.mcpServers !== null) {
    const mcpServers = mcpJson.mcpServers as Record<string, unknown>;
    const existingNames = new Set(servers.map(s => s.name));
    for (const [name, config] of Object.entries(mcpServers)) {
      if (existingNames.has(name)) continue;
      const cfg = config as Record<string, unknown>;
      const url = (cfg.url as string) || (cfg.command as string) || '';
      servers.push({ name, url, status: 'configured', scope, filePath: mcpJsonPath });
    }
  }

  return servers;
}

/** Read agents from .md files in an agents directory */
function readAgentsFromDir(dirPath: string, scope: 'user' | 'project', category: 'plugin' | 'built-in'): Agent[] {
  const agents: Agent[] = [];
  for (const file of readDirSafe(dirPath)) {
    if (!file.endsWith('.md')) continue;
    const agentPath = joinPath(dirPath, file);
    const fm = parseFrontmatter(agentPath);
    if (fm.name) {
      agents.push({ name: fm.name, model: fm.model || '', category, scope, filePath: agentPath });
    }
  }
  return agents;
}

/** Read agents from installed plugins */
function readPluginAgents(): Agent[] {
  const installedPath = joinHomePath('.claude', 'plugins', 'installed_plugins.json');
  const installed = readJsonSafe(installedPath);
  if (!installed || typeof installed.plugins !== 'object' || installed.plugins === null) return [];

  const agents: Agent[] = [];
  const plugins = installed.plugins as Record<string, Array<{ installPath: string; scope?: string }>>;
  const enabledPlugins = getEnabledPlugins();

  for (const [pluginId, versions] of Object.entries(plugins)) {
    if (!enabledPlugins.has(pluginId)) continue;
    for (const version of versions) {
      const agentsDir = joinPath(version.installPath, 'agents');
      const scope = (version.scope as 'user' | 'project') || 'user';
      agents.push(...readAgentsFromDir(agentsDir, scope, 'plugin'));
    }
  }
  return agents;
}

/** Read skills from installed plugins */
function readPluginSkills(): Skill[] {
  const installedPath = joinHomePath('.claude', 'plugins', 'installed_plugins.json');
  const installed = readJsonSafe(installedPath);
  if (!installed || typeof installed.plugins !== 'object' || installed.plugins === null) return [];

  const skills: Skill[] = [];
  const plugins = installed.plugins as Record<string, Array<{ installPath: string; scope?: string }>>;
  const enabledPlugins = getEnabledPlugins();

  for (const [pluginId, versions] of Object.entries(plugins)) {
    if (!enabledPlugins.has(pluginId)) continue;
    for (const version of versions) {
      const skillsDir = joinPath(version.installPath, 'skills');
      const scope = (version.scope as 'user' | 'project') || 'user';
      for (const skillName of readDirSafe(skillsDir)) {
        const skillMd = joinPath(skillsDir, skillName, 'SKILL.md');
        const fm = parseFrontmatter(skillMd);
        if (fm.name || skillName) {
          skills.push({
            name: fm.name || skillName,
            description: fm.description || '',
            scope,
            filePath: skillMd,
          });
        }
      }
    }
  }
  return skills;
}

/** Read commands from .md files in a commands directory */
function readCommandsFromDir(dirPath: string, scope: 'user' | 'project'): Command[] {
  const commands: Command[] = [];
  for (const file of readDirSafe(dirPath)) {
    if (!file.endsWith('.md')) continue;
    const name = file.slice(0, -3);
    const commandPath = joinPath(dirPath, file);
    const fm = parseFrontmatter(commandPath);
    commands.push({ name, description: fm.description || '', scope, filePath: commandPath });
  }
  return commands;
}

/** Read skills from a directory (user or project scope) */
function readSkillsFromDir(dirPath: string, scope: 'user' | 'project'): Skill[] {
  const skills: Skill[] = [];
  for (const skillName of readDirSafe(dirPath)) {
    const skillMd = joinPath(dirPath, skillName, 'SKILL.md');
    const fm = parseFrontmatter(skillMd);
    if (fm.name || skillName) {
      skills.push({ name: fm.name || skillName, description: fm.description || '', scope, filePath: skillMd });
    }
  }
  return skills;
}

/** Get set of enabled plugin IDs from user settings */
function getEnabledPlugins(): Set<string> {
  const settings = readJsonSafe(joinHomePath('.claude', 'settings.json'));
  if (!settings || typeof settings.enabledPlugins !== 'object' || settings.enabledPlugins === null) {
    return new Set();
  }
  const enabled = settings.enabledPlugins as Record<string, boolean>;
  return new Set(Object.entries(enabled).filter(([, v]) => v).map(([k]) => k));
}

export const HOOK_MARKER = '# vibeyard-hook';

interface HookHandler {
  type: string;
  command: string;
}

interface HookMatcherEntry {
  matcher: string;
  hooks: HookHandler[];
}

type HooksConfig = Record<string, HookMatcherEntry[]>;

function isIdeHook(h: HookHandler): boolean {
  return h.command?.includes(HOOK_MARKER) ?? false;
}

function buildNodeEvalCommand(code: string): string {
  const encoded = Buffer.from(code, 'utf8').toString('base64');
  return `node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))" ${HOOK_MARKER}`;
}

function buildStatusCommand(event: string, status: string): string {
  const payload = `${event}:${status}`;
  return buildNodeEvalCommand(
    `const fs=require('fs');` +
      `const path=require('path');` +
      `const sid=process.env.CLAUDE_IDE_SESSION_ID||'';` +
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

function buildSessionIdCaptureCommand(): string {
  return buildStdinJsonCommand(
    `const fs=require('fs');` +
      `const path=require('path');` +
      `const sid=process.env.CLAUDE_IDE_SESSION_ID||'';` +
      `const cliSid=d.session_id||'';` +
      `const statusDir=process.env[${JSON.stringify(STATUS_DIR_ENV_VAR)}]||${JSON.stringify(STATUS_DIR)};` +
      `if(!sid||!cliSid)return;` +
      `fs.mkdirSync(statusDir,{recursive:true});` +
      `fs.writeFileSync(path.join(statusDir,sid+'.sessionid'),cliSid);`
  );
}

function buildToolFailureCaptureCommand(): string {
  return buildStdinJsonCommand(
    `const fs=require('fs');` +
      `const path=require('path');` +
      `const sid=process.env.CLAUDE_IDE_SESSION_ID||'';` +
      `const toolName=d.tool_name||'';` +
      `const toolInput=d.tool_input||{};` +
      `const error=d.error||'';` +
      `const statusDir=process.env[${JSON.stringify(STATUS_DIR_ENV_VAR)}]||${JSON.stringify(STATUS_DIR)};` +
      `if(!sid||!toolName)return;` +
      `fs.mkdirSync(statusDir,{recursive:true});` +
      `const suffix=Math.random().toString(36).slice(2,8);` +
      `fs.writeFileSync(path.join(statusDir,sid+'-'+suffix+'.toolfailure'),JSON.stringify({tool_name:toolName,tool_input:toolInput,error:error}));`
  );
}

function buildEventCaptureCommand(hookEvent: string, eventType: InspectorEventType): string {
  return buildStdinJsonCommand(
    `const fs=require('fs');` +
      `const path=require('path');` +
      `const sid=process.env.CLAUDE_IDE_SESSION_ID||'';` +
      `if(!sid)return;` +
      `const statusDir=process.env[${JSON.stringify(STATUS_DIR_ENV_VAR)}]||${JSON.stringify(STATUS_DIR)};` +
      `const e={type:${JSON.stringify(eventType)},timestamp:Date.now(),hookEvent:${JSON.stringify(hookEvent)}};` +
      `const toolName=d.tool_name||'';` +
      `if(toolName)e.tool_name=toolName;` +
      `if(d.tool_input)e.tool_input=d.tool_input;` +
      `const error=d.error||'';` +
      `if(error)e.error=error;` +
      `for(const field of ['agent_id','agent_type','last_assistant_message','agent_transcript_path','message','task_id','worktree_path','cwd','file_path','config_key','question','answer']){` +
      `const value=d[field];` +
      `if(value)e[field]=value;` +
      `}` +
      `if(d.cost){` +
      `e.cost_snapshot={};` +
      `if(d.cost.total_cost_usd!==undefined)e.cost_snapshot.total_cost_usd=d.cost.total_cost_usd;` +
      `if(d.cost.total_duration_ms!==undefined)e.cost_snapshot.total_duration_ms=d.cost.total_duration_ms;` +
      `}` +
      `if(d.context_window){` +
      `const totalTokens=(d.context_window.total_input_tokens||0)+(d.context_window.total_output_tokens||0);` +
      `e.context_snapshot={total_tokens:totalTokens,context_window_size:d.context_window.context_window_size||200000,used_percentage:d.context_window.used_percentage||0};` +
      `}` +
      `if(toolName&&${JSON.stringify(hookEvent)}==='PostToolUse'){` +
      `const result=d.tool_result||d.tool_response||'';` +
      `const failureText=typeof result==='string'?result:(result?JSON.stringify(result):'');` +
      `if(failureText){` +
      `fs.mkdirSync(statusDir,{recursive:true});` +
      `const suffix=Math.random().toString(36).slice(2,8);` +
      `fs.writeFileSync(path.join(statusDir,sid+'-'+suffix+'.toolfailure'),JSON.stringify({tool_name:toolName,tool_input:d.tool_input||{},error:failureText}));` +
      `}` +
      `}` +
      `fs.mkdirSync(statusDir,{recursive:true});` +
      `fs.appendFileSync(path.join(statusDir,sid+'.events'),JSON.stringify(e)+'\\n');`
  );
}

/**
 * Read and clean Claude settings, returning the settings object and cleaned hooks.
 */
function prepareSettings(): { settings: Record<string, unknown>; cleaned: HooksConfig } {
  const settingsPath = joinHomePath('.claude', 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    // File may not exist yet
  }

  const existingHooks: HooksConfig = (settings.hooks ?? {}) as HooksConfig;

  // Remove any previously-installed vibeyard hooks from all event types
  const cleaned: HooksConfig = {};
  for (const [event, matchers] of Object.entries(existingHooks)) {
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

  return { settings, cleaned };
}

function writeSettings(settings: Record<string, unknown>): void {
  const settingsPath = joinHomePath('.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

/**
 * Install only the hooks portion of Claude Code settings (additive, non-destructive).
 */
export function installHooksOnly(): void {
  const { settings, cleaned } = prepareSettings();
  const captureSessionIdCmd = buildSessionIdCaptureCommand();
  const captureToolFailureCmd = buildToolFailureCaptureCommand();

  // Add our hooks for each event type
  const ideEvents: Record<string, string> = {
    SessionStart: 'waiting',
    UserPromptSubmit: 'working',
    PostToolUse: 'working',
    PostToolUseFailure: 'working',
    Stop: 'completed',
    StopFailure: 'waiting',
    PermissionRequest: 'input',
  };

  const eventTypeMap: Record<string, InspectorEventType> = {
    SessionStart: 'session_start',
    UserPromptSubmit: 'user_prompt',
    PostToolUse: 'tool_use',
    PostToolUseFailure: 'tool_failure',
    Stop: 'stop',
    StopFailure: 'stop_failure',
    PermissionRequest: 'permission_request',
  };

  for (const [event, status] of Object.entries(ideEvents)) {
    const existing = cleaned[event] ?? [];
    const hooks: HookHandler[] = [{ type: 'command', command: buildStatusCommand(event, status) }];
    // Capture Claude session ID on session start and prompt submission
    if (event === 'SessionStart' || event === 'UserPromptSubmit') {
      hooks.push({ type: 'command', command: captureSessionIdCmd });
    }
    // Capture tool failure details for missing-tool detection
    if (event === 'PostToolUseFailure') {
      hooks.push({ type: 'command', command: captureToolFailureCmd });
    }
    // Capture inspector event log for session inspection
    hooks.push({ type: 'command', command: buildEventCaptureCommand(event, eventTypeMap[event]) });
    existing.push({
      matcher: '',
      hooks,
    });
    cleaned[event] = existing;
  }

  // Inspector-only hooks: log to .events file without changing session status
  const inspectorOnlyEvents: Record<string, InspectorEventType> = {
    PreToolUse: 'pre_tool_use',
    PermissionDenied: 'permission_denied',
    SubagentStart: 'subagent_start',
    SubagentStop: 'subagent_stop',
    Notification: 'notification',
    PreCompact: 'pre_compact',
    PostCompact: 'post_compact',
    SessionEnd: 'session_end',
    TaskCreated: 'task_created',
    TaskCompleted: 'task_completed',
    WorktreeCreate: 'worktree_create',
    WorktreeRemove: 'worktree_remove',
    CwdChanged: 'cwd_changed',
    FileChanged: 'file_changed',
    ConfigChange: 'config_change',
    Elicitation: 'elicitation',
    ElicitationResult: 'elicitation_result',
    InstructionsLoaded: 'instructions_loaded',
    TeammateIdle: 'teammate_idle',
  };

  for (const [event, eventType] of Object.entries(inspectorOnlyEvents)) {
    const existing = cleaned[event] ?? [];
    existing.push({
      matcher: '',
      hooks: [{ type: 'command', command: buildEventCaptureCommand(event, eventType) }],
    });
    cleaned[event] = existing;
  }

  settings.hooks = cleaned;
  writeSettings(settings);
}

/**
 * Install only the statusLine setting (exclusive — overwrites any existing value).
 */
export function installStatusLine(): void {
  const settingsPath = path.join(homedir(), '.claude', 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    // File may not exist yet
  }

  settings.statusLine = {
    type: 'command',
    command: getStatusLineScriptPath(),
  };

  writeSettings(settings);
}

/**
 * Install both hooks and statusLine unconditionally (legacy convenience function).
 */
export function installHooks(): void {
  installHooksOnly();
  installStatusLine();
}

/** Read MCP servers from ~/.claude.json (where `claude mcp add` stores them) */
function readMcpFromClaudeJson(filePath: string, projectPath?: string): McpServer[] {
  const json = readJsonSafe(filePath);
  if (!json) return [];
  const servers: McpServer[] = [];

  // Top-level mcpServers → user scope
  if (typeof json.mcpServers === 'object' && json.mcpServers !== null) {
    for (const [name, config] of Object.entries(json.mcpServers as Record<string, unknown>)) {
      const cfg = config as Record<string, unknown>;
      const url = (cfg.url as string) || (cfg.command as string) || '';
      servers.push({ name, url, status: 'configured', scope: 'user', filePath });
    }
  }

  // Project-specific (local scope) servers stored under projects key
  if (projectPath && typeof json.projects === 'object' && json.projects !== null) {
    const projects = json.projects as Record<string, Record<string, unknown>>;
    const projectEntry = projects[projectPath];
    if (projectEntry && typeof projectEntry.mcpServers === 'object' && projectEntry.mcpServers !== null) {
      for (const [name, config] of Object.entries(projectEntry.mcpServers as Record<string, unknown>)) {
        const cfg = config as Record<string, unknown>;
        const url = (cfg.url as string) || (cfg.command as string) || '';
        servers.push({ name, url, status: 'configured', scope: 'project', filePath });
      }
    }
  }

  return servers;
}

/** Read managed MCP servers from system-level config */
function readManagedMcpServers(): McpServer[] {
  const managedPath = process.platform === 'darwin'
    ? '/Library/Application Support/ClaudeCode/managed-mcp.json'
    : process.platform === 'win32'
      ? 'C:\\Program Files\\ClaudeCode\\managed-mcp.json'
      : '/etc/claude-code/managed-mcp.json';

  const json = readJsonSafe(managedPath);
  if (!json || typeof json.mcpServers !== 'object' || json.mcpServers === null) return [];

  const servers: McpServer[] = [];
  for (const [name, config] of Object.entries(json.mcpServers as Record<string, unknown>)) {
    const cfg = config as Record<string, unknown>;
    const url = (cfg.url as string) || (cfg.command as string) || '';
    servers.push({ name, url, status: 'configured', scope: 'user', filePath: managedPath });
  }
  return servers;
}

export type McpServerConfig =
  | { command: string; args?: string[]; env?: Record<string, string> }
  | { url: string };

/**
 * Add an MCP server to ~/.claude.json at user or project scope.
 */
export function addMcpServer(
  name: string,
  config: McpServerConfig,
  scope: 'user' | 'project',
  projectPath?: string,
): void {
  const filePath = joinHomePath('.claude.json');
  const json = readJsonSafe(filePath) ?? {};

  if (scope === 'project' && projectPath) {
    const projects = (json.projects ?? {}) as Record<string, Record<string, unknown>>;
    const entry = projects[projectPath] ?? {};
    const servers = (entry.mcpServers ?? {}) as Record<string, unknown>;
    servers[name] = config;
    entry.mcpServers = servers;
    projects[projectPath] = entry;
    json.projects = projects;
  } else {
    const servers = (json.mcpServers ?? {}) as Record<string, unknown>;
    servers[name] = config;
    json.mcpServers = servers;
  }

  fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n');
}

/**
 * Remove an MCP server from a config file at the given scope.
 * filePath is the config file where the server was found (e.g. ~/.claude.json, ~/.mcp.json).
 */
export function removeMcpServer(
  name: string,
  filePath: string,
  scope: 'user' | 'project',
  projectPath?: string,
): void {
  const json = readJsonSafe(filePath);
  if (!json) return;

  if (scope === 'project' && projectPath) {
    const projects = json.projects as Record<string, Record<string, unknown>> | undefined;
    const entry = projects?.[projectPath];
    if (entry && typeof entry.mcpServers === 'object' && entry.mcpServers !== null) {
      const servers = entry.mcpServers as Record<string, unknown>;
      delete servers[name];
    }
  } else {
    if (typeof json.mcpServers === 'object' && json.mcpServers !== null) {
      const servers = json.mcpServers as Record<string, unknown>;
      delete servers[name];
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n');
}

export async function getClaudeConfig(projectPath: string): Promise<ClaudeConfig> {
  const home = homedir();
  const claudeDir = joinPath(home, '.claude');

  // MCP Servers from multiple sources (matching Claude CLI resolution order)
  // 1. ~/.claude.json (user + local scope — primary location for `claude mcp add`)
  const claudeJsonServers = readMcpFromClaudeJson(joinPath(home, '.claude.json'), projectPath);
  // 2. ~/.claude/settings.json and ~/.mcp.json (legacy/additional user scope)
  const userServers = readMcpServers(
    joinPath(claudeDir, 'settings.json'),
    joinPath(home, '.mcp.json'),
    'user',
  );
  // 3. Project-level: .claude/settings.json and .mcp.json
  const projectServers = readMcpServers(
    joinPath(projectPath, '.claude', 'settings.json'),
    joinPath(projectPath, '.mcp.json'),
    'project',
  );
  // 4. System-managed servers
  const managedServers = readManagedMcpServers();

  // Deduplicate: local/project servers override user servers by name
  const serverMap = new Map<string, McpServer>();
  for (const s of managedServers) serverMap.set(s.name, s);
  for (const s of userServers) serverMap.set(s.name, s);
  for (const s of claudeJsonServers) serverMap.set(s.name, s);
  for (const s of projectServers) serverMap.set(s.name, s);
  const mcpServers = Array.from(serverMap.values());

  // Agents
  const pluginAgents = readPluginAgents();
  const userAgents = readAgentsFromDir(joinPath(claudeDir, 'agents'), 'user', 'plugin');
  const projectAgents = readAgentsFromDir(joinPath(projectPath, '.claude', 'agents'), 'project', 'plugin');

  const agentNames = new Set<string>();
  const agents: Agent[] = [];
  for (const list of [pluginAgents, userAgents, projectAgents]) {
    for (const a of list) {
      if (!agentNames.has(a.name)) {
        agentNames.add(a.name);
        agents.push(a);
      }
    }
  }

  // Skills
  const pluginSkills = readPluginSkills();
  const userSkills = readSkillsFromDir(joinPath(claudeDir, 'skills'), 'user');
  const projectSkills = readSkillsFromDir(joinPath(projectPath, '.claude', 'skills'), 'project');

  const skillNames = new Set<string>();
  const skills: Skill[] = [];
  for (const list of [pluginSkills, userSkills, projectSkills]) {
    for (const s of list) {
      if (!skillNames.has(s.name)) {
        skillNames.add(s.name);
        skills.push(s);
      }
    }
  }

  // Commands
  const userCommands = readCommandsFromDir(joinPath(claudeDir, 'commands'), 'user');
  const projectCommands = readCommandsFromDir(joinPath(projectPath, '.claude', 'commands'), 'project');

  const commandNames = new Set<string>();
  const commands: Command[] = [];
  // Project commands override user commands
  for (const list of [projectCommands, userCommands]) {
    for (const c of list) {
      if (!commandNames.has(c.name)) {
        commandNames.add(c.name);
        commands.push(c);
      }
    }
  }

  return { mcpServers, agents, skills, commands };
}
