import { EventEmitter } from 'events';
import { resetSearchPathOnAcquire } from './pool-hygiene';

describe('resetSearchPathOnAcquire', () => {
  const makePool = () => {
    const pool = new EventEmitter();
    resetSearchPathOnAcquire(pool as unknown as Parameters<typeof resetSearchPathOnAcquire>[0]);
    return pool;
  };

  it('queues a RESET search_path on every connection handed out', () => {
    const pool = makePool();
    const query = jest.fn().mockResolvedValue(undefined);
    pool.emit('acquire', { query });
    pool.emit('acquire', { query });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith('RESET search_path');
  });

  it('issues the reset synchronously, so it is ahead of whatever the caller runs first', () => {
    const pool = makePool();
    const order: string[] = [];
    const client = { query: jest.fn((sql: string) => { order.push(sql); return Promise.resolve(); }) };
    pool.emit('acquire', client);
    client.query('SELECT 1'); // what the caller does right after being handed the connection
    expect(order).toEqual(['RESET search_path', 'SELECT 1']);
  });

  it('swallows a failed reset instead of raising an unhandled rejection', async () => {
    const pool = makePool();
    const query = jest.fn().mockRejectedValue(new Error('connection terminated'));
    expect(() => pool.emit('acquire', { query })).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
