import Redis from 'ioredis';

let redis: Redis | null = null;
const memoryStore = new Map<string, string>();
let useMemory = true;

if (process.env.REDIS_URL) {
  try {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) {
          console.warn('Redis connection failed too many times. Falling back to in-memory caching.');
          useMemory = true;
          return null; // Stop retrying
        }
        return Math.min(times * 100, 2000);
      }
    });

    redis.on('connect', () => {
      console.log('Redis connected successfully.');
      useMemory = false;
    });

    redis.on('error', (err) => {
      console.warn('Redis error encountered:', err.message);
    });
  } catch (error) {
    console.warn('Redis initialization error, running in in-memory mode.', error);
    useMemory = true;
  }
} else {
  console.log('No REDIS_URL found. Running with in-memory cache.');
}

export const cache = {
  isMock: () => useMemory,

  get: async (key: string): Promise<string | null> => {
    if (useMemory || !redis) {
      return memoryStore.get(key) || null;
    }
    try {
      return await redis.get(key);
    } catch {
      return memoryStore.get(key) || null;
    }
  },

  set: async (key: string, value: string, ttlSeconds?: number): Promise<void> => {
    if (useMemory || !redis) {
      memoryStore.set(key, value);
      // Simple TTL mock
      if (ttlSeconds) {
        setTimeout(() => memoryStore.delete(key), ttlSeconds * 1000);
      }
      return;
    }
    try {
      if (ttlSeconds) {
        await redis.set(key, value, 'EX', ttlSeconds);
      } else {
        await redis.set(key, value);
      }
    } catch {
      memoryStore.set(key, value);
    }
  },

  del: async (key: string): Promise<void> => {
    if (useMemory || !redis) {
      memoryStore.delete(key);
      return;
    }
    try {
      await redis.del(key);
    } catch {
      memoryStore.delete(key);
    }
  }
};
