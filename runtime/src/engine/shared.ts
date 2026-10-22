import pino from 'pino';
export const MAX_ACTION_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
export const ORG_SECRET_FIELD = 'value';
export const ORG_SECRET_PROVIDER = 'org-secret';
export function createLogger(name: string): pino.Logger {
  return pino({ name, level: process.env.LOG_LEVEL ?? 'warn' }, pino.destination(2));
}
