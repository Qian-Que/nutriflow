import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

export type PendingWrite = { id: string; path: string; body: Record<string, any>; error?: string; createdAt: string; serverRecord?: Record<string, any> };
export type Draft = { text: string; imageBase64: string | null; mimeType: string; date: string; entryMode?: 'AUTO' | 'FOOD' | 'EXERCISE' };
const sessions = new Map<string, string>();
const locks = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
export function bindStorageSession(token: string, server: string, userId: string) {
  sessions.set(token, `${server}:${userId}`);
}
function scope(token: string) {
  const value = sessions.get(token);
  if (!value) throw new Error("本地账号尚未初始化，请重新登录");
  return `nutrition_v3:${value}`;
}
function serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  locks.set(key, result);
  return result;
}
export function subscribePending(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function notify() { listeners.forEach(listener => listener()); }
async function readText(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
  const path = await storagePath(key);
  if (!(await FileSystem.getInfoAsync(path)).exists) return null;
  return FileSystem.readAsStringAsync(path);
}
async function storagePath(key: string) {
  const directory = `${FileSystem.documentDirectory}nutrition/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  // Two independent 32-bit hashes keep names short even for custom backend URLs.
  let a = 2166136261, b = 5381;
  for (let i = 0; i < key.length; i++) { a = Math.imul(a ^ key.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ key.charCodeAt(i); }
  return `${directory}${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}.json`;
}
async function writeText(key: string, value: string) {
  if (Platform.OS === 'web') return AsyncStorage.setItem(key, value);
  const path = await storagePath(key);
  await FileSystem.writeAsStringAsync(`${path}.tmp`, value);
  await FileSystem.moveAsync({ from: `${path}.tmp`, to: path });
}
export async function readPending(token: string): Promise<PendingWrite[]> {
  return JSON.parse(await readText(`${scope(token)}:outbox`) ?? '[]');
}
export function updatePending(token: string, update: (entries: PendingWrite[]) => PendingWrite[]) {
  const key = `${scope(token)}:outbox`;
  return serial(key, async () => {
    const entries = await readPending(token);
    await writeText(key, JSON.stringify(update(entries)));
    notify();
  });
}
export function enqueue(token: string, path: string, body: Record<string, any>) {
  const id = String(body.clientRequestId);
  return updatePending(token, entries => entries.some(entry => entry.id === id) ? entries : [...entries, { id, path, body, createdAt: new Date().toISOString() }]);
}
export function acknowledge(token: string, id: string, serverRecord: Record<string, any>) { return updatePending(token, entries => entries.map(entry => entry.id === id ? { ...entry, serverRecord, error: undefined } : entry)); }
export function markPendingError(token: string, id: string, error: string) { return updatePending(token, entries => entries.map(entry => entry.id === id ? { ...entry, error } : entry)); }
export function writeCache(token: string, name: string, data: unknown) { const key = `${scope(token)}:cache:${name}`; return serial(key, () => writeText(key, JSON.stringify(data))); }
export async function readCache<T>(token: string, name: string): Promise<T | null> { return JSON.parse(await readText(`${scope(token)}:cache:${name}`) ?? "null"); }

export function writeDraft(token: string, draft: Draft) {
  const key = `${scope(token)}:draft`;
  return serial(key, () => writeText(key, JSON.stringify(draft)));
}
export async function readDraft(token: string): Promise<Draft | null> {
  return JSON.parse(await readText(`${scope(token)}:draft`) ?? 'null');
}
