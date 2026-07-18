import Redis from "ioredis";
import { Kafka, type Consumer, type Producer } from "kafkajs";

export type RealtimeEventKind = "outcome" | "topic";

export interface RealtimeEvent {
  eventId: string;
  originInstanceId: string;
  topicKey: string;
  kind: RealtimeEventKind;
  payload: Record<string, unknown>;
  publishedAt: string;
}

export type RealtimeEventHandler = (event: RealtimeEvent) => void;

export interface RealtimeBus {
  readonly mode: string;
  start(handler: RealtimeEventHandler): Promise<void>;
  publish(event: RealtimeEvent): Promise<void>;
  stop(): Promise<void>;
}

export interface SnapshotStore {
  readonly mode: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  stop(): Promise<void>;
}

export class LocalRealtimeBus implements RealtimeBus {
  readonly mode = "local";
  private static readonly handlers = new Set<RealtimeEventHandler>();
  private handler: RealtimeEventHandler | null = null;

  async start(handler: RealtimeEventHandler): Promise<void> {
    this.handler = handler;
    LocalRealtimeBus.handlers.add(handler);
  }

  async publish(event: RealtimeEvent): Promise<void> {
    for (const handler of LocalRealtimeBus.handlers) queueMicrotask(() => handler(event));
  }

  async stop(): Promise<void> {
    if (this.handler) LocalRealtimeBus.handlers.delete(this.handler);
    this.handler = null;
  }
}

export class MemorySnapshotStore implements SnapshotStore {
  readonly mode = "memory";
  private static readonly values = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = MemorySnapshotStore.values.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      MemorySnapshotStore.values.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    MemorySnapshotStore.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1_000 });
  }

  async stop(): Promise<void> {}
}

export class RedisRealtimeBus implements RealtimeBus {
  readonly mode = "redis";
  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  constructor(private readonly url: string, private readonly channel: string) {
    this.publisher = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
    this.subscriber = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  }

  async start(handler: RealtimeEventHandler): Promise<void> {
    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
    await this.subscriber.subscribe(this.channel);
    this.subscriber.on("message", (_channel, raw) => {
      try { handler(JSON.parse(raw) as RealtimeEvent); } catch { /* Ignore malformed broker payloads. */ }
    });
  }

  async publish(event: RealtimeEvent): Promise<void> {
    await this.publisher.publish(this.channel, JSON.stringify(event));
  }

  async stop(): Promise<void> {
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }
}

export class RedisSnapshotStore implements SnapshotStore {
  readonly mode = "redis";
  private readonly client: Redis;

  constructor(url: string) {
    this.client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  }

  async get(key: string): Promise<string | null> {
    if (this.client.status === "wait") await this.client.connect();
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.client.status === "wait") await this.client.connect();
    await this.client.set(key, value, "EX", ttlSeconds);
  }

  async stop(): Promise<void> { await this.client.quit(); }
}

export class KafkaRealtimeBus implements RealtimeBus {
  readonly mode = "kafka";
  private readonly producer: Producer;
  private readonly consumer: Consumer;

  constructor(
    brokers: string[],
    private readonly topic: string,
    groupId: string,
    clientId: string,
  ) {
    const kafka = new Kafka({ clientId, brokers });
    this.producer = kafka.producer();
    this.consumer = kafka.consumer({ groupId });
  }

  async start(handler: RealtimeEventHandler): Promise<void> {
    await Promise.all([this.producer.connect(), this.consumer.connect()]);
    await this.consumer.subscribe({ topic: this.topic, fromBeginning: false });
    await this.consumer.run({ eachMessage: async ({ message }) => {
      if (!message.value) return;
      try { handler(JSON.parse(message.value.toString()) as RealtimeEvent); } catch { /* Ignore malformed broker payloads. */ }
    } });
  }

  async publish(event: RealtimeEvent): Promise<void> {
    await this.producer.send({ topic: this.topic, messages: [{ key: event.topicKey, value: JSON.stringify(event) }] });
  }

  async stop(): Promise<void> { await Promise.all([this.producer.disconnect(), this.consumer.disconnect()]); }
}

export interface DistributedRuntimeOptions {
  instanceId: string;
  redisUrl?: string;
  kafkaBrokers?: string[];
  kafkaTopic: string;
  kafkaGroupId: string;
  channel: string;
}

export function createRealtimeBus(options: DistributedRuntimeOptions): RealtimeBus {
  if (options.kafkaBrokers?.length) return new KafkaRealtimeBus(options.kafkaBrokers, options.kafkaTopic, options.kafkaGroupId, options.instanceId);
  if (options.redisUrl) return new RedisRealtimeBus(options.redisUrl, options.channel);
  return new LocalRealtimeBus();
}

export function createSnapshotStore(options: DistributedRuntimeOptions): SnapshotStore {
  return options.redisUrl ? new RedisSnapshotStore(options.redisUrl) : new MemorySnapshotStore();
}
