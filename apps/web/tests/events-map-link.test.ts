import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLinksFor, preferredMapLink } from '../lib/events/mapLink';

test('a bare label is a search by name in both services', () => {
  const links = mapLinksFor({ label: 'The Grand Hall' });
  assert.ok(links);
  assert.equal(links.google, 'https://www.google.com/maps/search/?api=1&query=The+Grand+Hall');
  assert.equal(links.apple, 'https://maps.apple.com/?q=The+Grand+Hall');
});

test('coordinates pin the spot and a place id opens the listing', () => {
  const links = mapLinksFor({ label: 'Halter HQ', address: '12 Bond St, Auckland', lat: -36.85, lon: 174.76, placeId: 'ChIJabc' });
  assert.ok(links);
  const google = new URL(links.google);
  assert.equal(google.searchParams.get('query'), '-36.85,174.76');
  assert.equal(google.searchParams.get('query_place_id'), 'ChIJabc');
  const apple = new URL(links.apple);
  assert.equal(apple.searchParams.get('ll'), '-36.85,174.76');
  assert.equal(apple.searchParams.get('q'), 'Halter HQ, 12 Bond St, Auckland');
});

test('an address that already names the venue is not repeated', () => {
  const links = mapLinksFor({ label: 'Sky Tower', address: 'Sky Tower, Victoria St W, Auckland' });
  assert.equal(new URL(links!.google).searchParams.get('query'), 'Sky Tower, Victoria St W, Auckland');
});

test('nothing to open without a label', () => {
  assert.equal(mapLinksFor(undefined), null);
  assert.equal(mapLinksFor({ label: '  ' }), null);
});

test('Apple devices get Apple Maps, everything else Google', () => {
  const links = mapLinksFor({ label: 'x' })!;
  assert.equal(preferredMapLink(links, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), links.apple);
  assert.equal(preferredMapLink(links, 'Mozilla/5.0 (Macintosh; Intel Mac OS X)'), links.apple);
  assert.equal(preferredMapLink(links, 'Mozilla/5.0 (Linux; Android 14)'), links.google);
  assert.equal(preferredMapLink(links, undefined), links.google);
});
