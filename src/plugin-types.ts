/**
 * Quipu Plugin Type Definitions
 *
 * These types define the API surface exposed to plugins via their init(api) function.
 * Plugin authors: copy this file to your project and reference it in tsconfig.json.
 *
 * Plugin entry point pattern:
 *   import type { PluginApi } from './plugin-types';
 *   export function init(api: PluginApi): void { ... }
 */

import type { ComponentType } from 'react';

// ---------------------------------------------------------------------------
// Core data types (mirrors src/types/tab.ts — duplicated for plugin portability)
// ---------------------------------------------------------------------------

export interface Frontmatter {
  [key: string]: unknown;
}

export interface Tab {
  id: string;
  path: string;
  name: string;
  content: string | unknown | null;
  isDirty: boolean;
  isQuipu: boolean;
  isMarkdown: boolean;
  isMedia?: boolean;
  isPdf?: boolean;
  isNotebook?: boolean;
  scrollPosition: number;
  frontmatter: Frontmatter | null;
  frontmatterRaw: string | null;
  diskContent: string | null;
}

export interface ActiveFile {
  path: string;
  name: string;
  content: string | unknown | null;
  isQuipu: boolean;
}

export type ToastType = 'error' | 'warning' | 'success' | 'info';

// ---------------------------------------------------------------------------
// Extension descriptor (for api.register())
// ---------------------------------------------------------------------------

export interface ExtensionCommand {
  id: string;
  label: string;
  handler: (...args: unknown[]) => void;
}

/**
 * Describes a viewer component registered by a plugin.
 * The host calls canHandle() to decide which plugin renders a given tab.
 * Higher priority wins; built-in TipTap editor has priority 0.
 */
export interface ExtensionDescriptor {
  id: string;
  canHandle: (tab: Tab, activeFile: ActiveFile | null) => boolean;
  priority: number;
  component: ComponentType<ViewerProps>;
  commands?: ExtensionCommand[];
  onSave?: (tab: Tab) => Promise<string | null>;
  onSnapshot?: (tab: Tab) => unknown;
}

// ---------------------------------------------------------------------------
// Viewer component props
// ---------------------------------------------------------------------------

/**
 * Props the host passes to every plugin viewer component.
 * Plugins must accept at least these props; additional internal props
 * may be passed and should be ignored if not needed.
 */
export interface ViewerProps {
  tab: Tab;
  activeFile: ActiveFile | null;
  onContentChange: (content: string) => void;
  isActive: boolean;
  /** Absolute path of the currently open workspace directory */
  workspacePath: string;
  /** Show a toast notification in the host UI */
  showToast: (message: string, type: ToastType) => void;
}

// ---------------------------------------------------------------------------
// Panel descriptor (for api.registerPanel())
// ---------------------------------------------------------------------------

/**
 * Describes a sidebar panel registered by a plugin.
 * Panels appear in the activity bar after built-in panels (Explorer, Search).
 */
export interface PanelDescriptor {
  id: string;
  label: string;
  /**
   * Phosphor icon name to display in the activity bar (e.g. "GitBranchIcon",
   * "DatabaseIcon"). The host resolves the icon component; plugins do not need
   * to bundle Phosphor.
   */
  icon: string;
  component: ComponentType;
  /**
   * Sort position after built-in panels. Built-ins use 0–9.
   * Plugin panels default to 100 if omitted.
   */
  order?: number;
  /**
   * Returns the badge count to display on the activity bar icon,
   * or null/undefined to show no badge.
   */
  badge?: () => number | null;
}

// ---------------------------------------------------------------------------
// Command types (for api.commands.register())
// ---------------------------------------------------------------------------

export type PluginCommandHandler = (...args: unknown[]) => void;

export interface PluginCommandOptions {
  label: string;
  category: string;
  /** Shortcut string for display in the command palette (e.g. "Ctrl+Shift+G") */
  shortcut?: string;
}

export interface PluginCommand {
  id: string;
  handler: PluginCommandHandler;
  label: string;
  category: string;
  shortcut?: string;
}

// ---------------------------------------------------------------------------
// Service interfaces (mirrors host service adapters — duplicated for portability)
// ---------------------------------------------------------------------------

/** File system operations (dual-runtime: Electron IPC + browser REST) */
export interface FileSystemService {
  openFolderDialog: () => Promise<string | null>;
  getHomeDir: () => Promise<string>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>;
  createFile: (filePath: string) => Promise<{ success: boolean }>;
  createFolder: (folderPath: string) => Promise<{ success: boolean }>;
  deletePath: (targetPath: string) => Promise<{ success: boolean }>;
  /** Returns a URL suitable for use in <img>, <video>, etc. */
  getFileUrl: (filePath: string) => string;
}

/** Git operations */
export interface GitService {
  status: (dirPath: string) => Promise<unknown>;
  diff: (dirPath: string, file: string, staged: boolean) => Promise<string>;
  stage: (dirPath: string, files: string[]) => Promise<unknown>;
  unstage: (dirPath: string, files: string[]) => Promise<unknown>;
  commit: (dirPath: string, message: string) => Promise<unknown>;
  push: (dirPath: string) => Promise<unknown>;
  pull: (dirPath: string) => Promise<unknown>;
  branches: (dirPath: string) => Promise<unknown>;
  checkout: (dirPath: string, branch: string) => Promise<unknown>;
}

/** Jupyter kernel management */
export interface KernelService {
  validate: (venvPath: string) => Promise<{ valid: boolean; pythonPath?: string; error?: string }>;
  start: (venvPath: string, workspaceRoot: string) => Promise<{ success: boolean; port?: number; error?: string }>;
  stop: () => Promise<{ success: boolean }>;
  proxyRest: (method: string, apiPath: string, body: unknown) => Promise<unknown>;
  getChannelUrl: (kernelId: string) => Promise<string>;
}

/** Terminal I/O */
export interface TerminalService {
  sendInput: (terminalId: string, data: string) => void;
  getSelection: (terminalId: string) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Plugin API — passed to init()
// ---------------------------------------------------------------------------

export interface PluginApi {
  /**
   * Register a viewer component for specific file types.
   * The host calls canHandle() to decide which plugin renders a tab.
   */
  register: (descriptor: ExtensionDescriptor) => void;

  /**
   * Register a sidebar panel in the activity bar.
   */
  registerPanel: (descriptor: PanelDescriptor) => void;

  commands: {
    /**
     * Register a global command reachable from the command palette (Ctrl+Shift+P)
     * and via api.commands.execute().
     */
    register: (id: string, handler: PluginCommandHandler, options?: PluginCommandOptions) => void;
    /**
     * Execute any registered command by id.
     * Built-in command ids may also be used.
     */
    execute: (id: string, ...args: unknown[]) => void;
  };

  services: {
    fileSystem: FileSystemService;
    gitService: GitService;
    kernelService: KernelService;
    terminalService: TerminalService;
  };

  /**
   * Shared React instance. Plugins MUST use this rather than their own bundled
   * React to ensure hook deduplication and correct context sharing with the host.
   * Externalize 'react' and 'react-dom' in your plugin's build config.
   */
  React: typeof import('react');

  /**
   * Shared ReactDOM instance. Externalize 'react-dom' in your plugin's build config.
   */
  ReactDOM: typeof import('react-dom');
}

// ---------------------------------------------------------------------------
// Plugin module interface — the shape of a plugin's entry point
// ---------------------------------------------------------------------------

export interface PluginModule {
  init: (api: PluginApi) => void;
}
