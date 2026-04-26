import { resolveMediaUrl, API_BASE } from '../api';

describe('resolveMediaUrl', () => {
  it('returns null for null/undefined/empty', () => {
    expect(resolveMediaUrl(null)).toBeNull();
    expect(resolveMediaUrl(undefined)).toBeNull();
    expect(resolveMediaUrl('')).toBeNull();
  });

  it('passes absolute http(s) and data URLs through unchanged', () => {
    expect(resolveMediaUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(resolveMediaUrl('http://example.com/a.png')).toBe('http://example.com/a.png');
    expect(resolveMediaUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
  });

  it('prefixes relative paths with API_BASE', () => {
    expect(resolveMediaUrl('/media/photo.webp')).toBe(`${API_BASE}/media/photo.webp`);
  });

  it('leaves bare path tokens alone (no leading slash, no scheme)', () => {
    expect(resolveMediaUrl('bucket/key.webp')).toBe('bucket/key.webp');
  });
});
