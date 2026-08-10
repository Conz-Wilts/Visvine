import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getExperience, sortExperience, formatYearMonth, formatDuration,
  computeProfileCompletion, type FullProfile, type ExperienceEntry,
} from '../lib/types/profile';
import { matchCountryInLocation, locationFlag } from '../lib/countries';

const baseProfile = (metadata: Record<string, unknown> | null = null): FullProfile => ({
  id: 'person:1', name: 'Test', tags: [], metadata,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
});

describe('getExperience', () => {
  it('returns [] for missing/malformed metadata', () => {
    assert.deepEqual(getExperience(baseProfile()), []);
    assert.deepEqual(getExperience(baseProfile({ experience: 'nope' })), []);
    assert.deepEqual(getExperience(baseProfile({ experience: [{ bad: true }, null] })), []);
  });

  it('keeps only well-formed entries', () => {
    const good: ExperienceEntry = { id: 'a', title: 'CEO', org: 'Acme', start: '2020-01' };
    const parsed = getExperience(baseProfile({ experience: [good, { id: 'b', title: 'X' }] }));
    assert.deepEqual(parsed, [good]);
  });
});

describe('sortExperience', () => {
  it('puts current roles first, then newest start first', () => {
    const entries: ExperienceEntry[] = [
      { id: 'old', title: 'A', org: 'O', start: '2015-03', end: '2018-01' },
      { id: 'cur', title: 'B', org: 'O', start: '2019-06', current: true },
      { id: 'mid', title: 'C', org: 'O', start: '2018-02', end: '2019-05' },
    ];
    assert.deepEqual(sortExperience(entries).map(e => e.id), ['cur', 'mid', 'old']);
  });
});

describe('formatYearMonth / formatDuration', () => {
  it('formats YYYY-MM as "Mon YYYY"', () => {
    assert.equal(formatYearMonth('2024-03'), 'Mar 2024');
    assert.equal(formatYearMonth('2024-12'), 'Dec 2024');
    assert.equal(formatYearMonth(''), '');
    assert.equal(formatYearMonth('bogus'), 'bogus');
  });

  it('computes inclusive durations', () => {
    assert.equal(formatDuration('2020-01', '2020-01'), '1 mo');
    assert.equal(formatDuration('2020-01', '2020-12'), '1 yr');
    assert.equal(formatDuration('2018-08', '2021-12'), '3 yr 5 mo');
    assert.equal(formatDuration('2021-12', '2018-08'), ''); // inverted
    assert.equal(formatDuration('nope', '2020-01'), '');
  });

  it('open-ended roles run to now and never come out empty', () => {
    assert.notEqual(formatDuration('2020-01'), '');
  });
});

describe('computeProfileCompletion', () => {
  it('counts experience as a section', () => {
    const empty = computeProfileCompletion(baseProfile());
    assert.equal(empty.sections.experience.complete, false);
    const withExp = computeProfileCompletion(
      baseProfile({ experience: [{ id: 'a', title: 'CEO', org: 'Acme', start: '2020-01' }] })
    );
    assert.equal(withExp.sections.experience.complete, true);
    assert.ok(withExp.score > empty.score);
  });
});

describe('matchCountryInLocation', () => {
  it('matches the country after the last comma', () => {
    assert.equal(matchCountryInLocation('Auckland, New Zealand')?.code, 'NZ');
    assert.equal(matchCountryInLocation('Berlin, Germany')?.code, 'DE');
  });

  it('handles aliases and bare country strings', () => {
    assert.equal(matchCountryInLocation('San Francisco, USA')?.code, 'US');
    assert.equal(matchCountryInLocation('London, UK')?.code, 'GB');
    assert.equal(matchCountryInLocation('New Zealand')?.code, 'NZ');
    assert.equal(matchCountryInLocation('Wellington, NZ')?.code, 'NZ');
    assert.equal(matchCountryInLocation('Hong Kong')?.code, 'HK');
  });

  it('does not treat two-letter words as ISO codes without a city part', () => {
    assert.equal(matchCountryInLocation('It'), undefined);
    assert.equal(matchCountryInLocation(''), undefined);
    assert.equal(matchCountryInLocation(null), undefined);
    assert.equal(matchCountryInLocation('Middle Earth'), undefined);
  });

  it('locationFlag renders an emoji or empty string', () => {
    assert.equal(locationFlag('Auckland, New Zealand'), '🇳🇿');
    assert.equal(locationFlag('Nowhere Special'), '');
  });
});
