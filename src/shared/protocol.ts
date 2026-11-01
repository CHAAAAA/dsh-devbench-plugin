/**
 * Protocol constants shared by the DSH host half and the browser bundle.
 *
 * This module is the single source of truth for the HTTP surface and the
 * on-disk metadata directory. Keep it dependency-free: the client build
 * inlines it, so it must never import Node.js, React, or host modules.
 */

/** Prefix registered on the DSH web server by the host plugin. */
export const ROUTE_PREFIX = '/dsh-devbench'

/** Base path of the plugin JSON API. */
export const API_BASE = ROUTE_PREFIX + '/api'

/** Custom request header required on every API call (CSRF/local-only guard). */
export const REQUEST_HEADER = 'x-dsh-devbench'

/** Per-project metadata directory (requirement folders live here). */
export const META_DIR = '.dsh-devbench'

/** Per-user plugin configuration directory, relative to the home directory. */
export const CONFIG_DIR_NAME = '.dsh-devbench'

/**
 * MCP server name used by the DSH profile row type managed on the home page.
 * Kept here because both halves refer to it when listing configured servers.
 */
export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/**
 * Mask rendered instead of secret-looking MCP env/header values. The host
 * replaces an unchanged mask with the stored value on save; a submitted
 * literal value replaces the stored one.
 */
export const MCP_SECRET_MASK = '\u2022\u2022\u2022\u2022\u2022\u2022'

/** Browser request timeout for MCP save/delete/toggle (the host waits for DSH reload). */
export const MCP_SAVE_TIMEOUT_MS = 120000
