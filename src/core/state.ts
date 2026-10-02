/**
 * Shared mutable application state (inventory, logs, requests, selectedItem).
 * Read through ESM live bindings; write through the exported set* helpers,
 * because imported bindings are read-only. */

import type { InventoryItem, ActivityLog, RequestRecord } from '../types';

// Shared mutable application state.
// Importers get live bindings for reads; writes must go through the setters,
// because ES module bindings are read-only to the importing module.
export let inventory: InventoryItem[] = [];
export let logs: ActivityLog[] = [];
export let requests: RequestRecord[] = [];
export let selectedItem: InventoryItem | null = null;

export function setInventory(value: InventoryItem[]): void { inventory = value; }
export function setLogs(value: ActivityLog[]): void { logs = value; }
export function setRequests(value: RequestRecord[]): void { requests = value; }
export function setSelectedItem(value: InventoryItem | null): void { selectedItem = value; }
