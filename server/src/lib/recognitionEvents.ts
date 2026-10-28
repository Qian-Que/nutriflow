import { EventEmitter } from 'node:events';

const events = new EventEmitter();
export function recognitionChanged(userId: string) { events.emit(userId); }
export function onRecognitionChange(userId: string, listener: () => void) {
  events.on(userId, listener);
  return () => { events.off(userId, listener); };
}
