import { describe, expect, it } from 'vitest';
import { MemoryStorage } from './memory-storage.js';

describe('MemoryStorage', () => {
    it('returns null for missing key', () => {
        const storage = new MemoryStorage();
        expect(storage.getItem('nonexistent')).toBeNull();
    });

    it('stores and retrieves values', () => {
        const storage = new MemoryStorage();
        storage.setItem('key', 'value');
        expect(storage.getItem('key')).toBe('value');
    });

    it('overwrites existing values', () => {
        const storage = new MemoryStorage();
        storage.setItem('key', 'first');
        storage.setItem('key', 'second');
        expect(storage.getItem('key')).toBe('second');
    });

    it('removes values', () => {
        const storage = new MemoryStorage();
        storage.setItem('key', 'value');
        storage.removeItem('key');
        expect(storage.getItem('key')).toBeNull();
    });

    it('removing non-existent key does not throw', () => {
        const storage = new MemoryStorage();
        expect(() => storage.removeItem('nonexistent')).not.toThrow();
    });

    it('independent instances do not share state', () => {
        const a = new MemoryStorage();
        const b = new MemoryStorage();
        a.setItem('key', 'a-value');
        expect(b.getItem('key')).toBeNull();
    });
});
