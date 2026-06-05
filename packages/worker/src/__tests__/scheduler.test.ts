import { describe, it, expect } from 'bun:test';
import {
  parseCron,
  nextRun,
  shouldRun,
  getNextScheduledRun,
  VALID_CRONS,
} from '../scheduler.ts';

describe('Scheduler — Cron Parser', () => {
  describe('parseCron', () => {
    it('parses "every minute" (* * * * *)', () => {
      const fields = parseCron('* * * * *');
      expect(fields[0].values.size).toBe(60); // all minutes
      expect(fields[1].values.size).toBe(24); // all hours
      expect(fields[2].values.size).toBe(31); // all days
      expect(fields[3].values.size).toBe(12); // all months
      expect(fields[4].values.size).toBe(7);  // all weekdays
    });

    it('parses specific times (0 9 * * 1)', () => {
      const fields = parseCron('0 9 * * 1');
      expect(fields[0].values.has(0)).toBe(true);
      expect(fields[1].values.has(9)).toBe(true);
      expect(fields[4].values.has(1)).toBe(true); // Monday
    });

    it('parses step values (*/5 * * * *)', () => {
      const fields = parseCron('*/5 * * * *');
      expect(fields[0].values.has(0)).toBe(true);
      expect(fields[0].values.has(5)).toBe(true);
      expect(fields[0].values.has(55)).toBe(true);
      expect(fields[0].values.has(1)).toBe(false);
    });

    it('parses ranges (0 9-17 * * 1-5)', () => {
      const fields = parseCron('0 9-17 * * 1-5');
      expect(fields[1].values.has(9)).toBe(true);
      expect(fields[1].values.has(12)).toBe(true);
      expect(fields[1].values.has(17)).toBe(true);
      expect(fields[1].values.has(8)).toBe(false);
      expect(fields[4].values.has(1)).toBe(true);
      expect(fields[4].values.has(5)).toBe(true);
      expect(fields[4].values.has(0)).toBe(false); // Sunday
    });

    it('parses list values (0,30 * * * *)', () => {
      const fields = parseCron('0,30 * * * *');
      expect(fields[0].values.has(0)).toBe(true);
      expect(fields[0].values.has(30)).toBe(true);
      expect(fields[0].values.has(15)).toBe(false);
    });

    it('throws on invalid number of fields', () => {
      expect(() => parseCron('* * * *')).toThrow('Invalid cron expression');
      expect(() => parseCron('* * * * * *')).toThrow('Invalid cron expression');
    });
  });

  describe('shouldRun', () => {
    it('returns true when time matches', () => {
      const testDate = new Date('2026-01-05T09:00:00Z'); // Monday 9:00
      expect(shouldRun('0 9 * * 1', testDate)).toBe(true);
    });

    it('returns false when time does not match', () => {
      const testDate = new Date('2026-01-05T09:01:00Z'); // Monday 9:01
      expect(shouldRun('0 9 * * 1', testDate)).toBe(false);
    });

    it('always true for * * * * *', () => {
      const testDate = new Date('2026-06-05T12:34:56Z');
      expect(shouldRun('* * * * *', testDate)).toBe(true);
    });

    it('true for weekday 9-5 on Monday at 9am', () => {
      const monday9am = new Date('2026-01-05T09:00:00Z');
      expect(shouldRun('0 9-17 * * 1-5', monday9am)).toBe(true);
    });

    it('false for weekday 9-5 on Saturday', () => {
      const saturday10am = new Date('2026-01-10T10:00:00Z');
      expect(shouldRun('0 9-17 * * 1-5', saturday10am)).toBe(false);
    });
  });

  describe('nextRun', () => {
    it('finds next run for every 5 min', () => {
      const from = new Date('2026-01-05T10:03:00Z');
      const next = nextRun('*/5 * * * *', from);
      expect(next.getMinutes()).toBe(5);
      expect(next.getHours()).toBe(10);
    });

    it('finds next run for specific hour', () => {
      const from = new Date('2026-01-05T10:00:00Z');
      const next = nextRun('0 9 * * *', from);
      // Next day at 9:00
      expect(next.getHours()).toBe(9);
      expect(next.getMinutes()).toBe(0);
      expect(next.getDate()).toBe(6); // next day
    });

    it('finds next Monday at 9am from Wednesday', () => {
      const wed = new Date('2026-01-07T12:00:00Z'); // Wednesday
      const next = nextRun('0 9 * * 1', wed); // Monday
      expect(next.getDay()).toBe(1); // Monday
      expect(next.getHours()).toBe(9);
      expect(next.getDate()).toBe(12); // next Monday
    });
  });

  describe('getNextScheduledRun', () => {
    it('returns Date for valid cron', () => {
      const result = getNextScheduledRun('* * * * *');
      expect(result).toBeInstanceOf(Date);
    });

    it('returns null for invalid cron', () => {
      const result = getNextScheduledRun('invalid');
      expect(result).toBeNull();
    });
  });

  describe('VALID_CRONS presets', () => {
    it('every minute parses correctly', () => {
      expect(() => parseCron(VALID_CRONS.everyMinute.expr)).not.toThrow();
    });

    it('every 5 minutes parses correctly', () => {
      const fields = parseCron(VALID_CRONS.every5Minutes.expr);
      expect(fields[0].values.has(0)).toBe(true);
      expect(fields[0].values.has(5)).toBe(true);
    });

    it('every hour parses correctly', () => {
      const fields = parseCron(VALID_CRONS.everyHour.expr);
      expect(fields[0].values.has(0)).toBe(true);
      // Only minute 0
      expect(fields[0].values.size).toBe(1);
    });

    it('weekdays 9-5 parses correctly', () => {
      const fields = parseCron(VALID_CRONS.weekdays9to5.expr);
      expect(fields[1].values.has(9)).toBe(true);
      expect(fields[1].values.has(17)).toBe(true);
      expect(fields[4].values.has(1)).toBe(true); // Monday
      expect(fields[4].values.has(5)).toBe(true); // Friday
    });
  });
});
