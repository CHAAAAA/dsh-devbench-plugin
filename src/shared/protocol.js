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
