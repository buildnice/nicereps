import assert from 'node:assert/strict';
import test from 'node:test';

import { digitTime, from12, isTime, onOrAfter, repeatDates, to12, type Repeat } from '../src/domain/rules.ts';

const rule = (r: Partial<Repeat>): Repeat => ({ every: 'daily', weekday: 'monday', day: 1, from: '2026-10-14', ...r });

test('daily and weekly reminders fall on each day or each chosen weekday', () => {
  assert.deepEqual(repeatDates(rule({}), '2026-10-30', 3), ['2026-10-30', '2026-10-31', '2026-11-01']);
  assert.deepEqual(repeatDates(rule({ every: 'weekly', weekday: 'friday' }), '2026-10-14', 3), ['2026-10-16', '2026-10-23', '2026-10-30']);
  assert.deepEqual(repeatDates(rule({ every: 'weekly', weekday: 'wednesday' }), '2026-10-14', 1), ['2026-10-14']);
});

test('fortnightly reminders start on the first chosen weekday on or after the day they are set', () => {
  assert.equal(onOrAfter('2026-10-14', 'wednesday'), '2026-10-14');
  assert.equal(onOrAfter('2026-10-14', 'monday'), '2026-10-19');
  const r = rule({ every: 'fortnightly', weekday: 'monday', from: onOrAfter('2026-10-14', 'monday') });
  assert.deepEqual(repeatDates(r, '2026-10-14', 3), ['2026-10-19', '2026-11-02', '2026-11-16']);
  assert.deepEqual(repeatDates(r, '2026-10-20', 2), ['2026-11-02', '2026-11-16']);
  assert.deepEqual(repeatDates(rule({ every: 'fortnightly', from: '2027-03-22' }), '2027-03-01', 3), ['2027-03-22', '2027-04-05', '2027-04-19']);
});

test('monthly reminders on the 29th to 31st fall on the last day of shorter months', () => {
  assert.deepEqual(repeatDates(rule({ every: 'monthly', day: 31 }), '2027-01-01', 4), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  assert.deepEqual(repeatDates(rule({ every: 'monthly', day: 29 }), '2028-02-01', 2), ['2028-02-29', '2028-03-29']);
  assert.deepEqual(repeatDates(rule({ every: 'monthly', day: 15 }), '2026-10-16', 1), ['2026-11-15']);
});

test('an unreadable rule yields no dates instead of looping', () => {
  assert.deepEqual(repeatDates(rule({ every: 'weekly', weekday: 'someday' }), '2026-10-14', 3), []);
});

test('keypad digits read as a 24-hour time', () => {
  assert.equal(digitTime('730'), '07:30');
  assert.equal(digitTime(''), '00:00');
  assert.equal(digitTime('2359'), '23:59');
  assert.ok(isTime('07:30') && isTime('00:00') && isTime('23:59'));
  assert.ok(!isTime('24:00') && !isTime('07:60') && !isTime('7:30'));
});

test('12-hour times convert to and from the stored 24-hour time', () => {
  assert.deepEqual([to12('00:05'), to12('08:00'), to12('12:30'), to12('23:59')], [{ text: '12:05', pm: false }, { text: '8:00', pm: false }, { text: '12:30', pm: true }, { text: '11:59', pm: true }]);
  assert.deepEqual([from12('12:05', false), from12('08:00', false), from12('12:30', true), from12('11:59', true)], ['00:05', '08:00', '12:30', '23:59']);
  assert.equal(from12('00:30', false), undefined);
  assert.equal(from12('13:00', true), undefined);
  assert.equal(from12('07:60', false), undefined);
});
