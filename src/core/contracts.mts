/** Durable facts. A sent event is created only after platform confirmation. */
export type EventKind = 'message.received' | 'message.sent' | 'task.result' | 'timer';

export interface StoredEvent {
  seq: number;
  id: string;
  kind: EventKind;
  channel: string;
  actorId: string;
  text: string;
  at: string;
  // Each platform has its own validated metadata schema. Do not forward this
  // dictionary wholesale into model contexts; use the scoped context service.
  meta: Record<string, any>;
}

export interface EventStoreOptions {
  stateDir: string;
  sharePlatformPrivate?: boolean;
}

export interface RecentEventsOptions {
  channel?: string;
  groups?: boolean;
  limit?: number;
  beforeSeq?: number;
  query?: unknown;
}

export interface EventContext {
  revision: number;
  events: Omit<StoredEvent, 'meta'>[];
  text: string;
}
