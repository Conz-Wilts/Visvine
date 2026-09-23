// The guarantees the token set keeps, checked against the resolved values —
// the same model every platform is generated from.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import StyleDictionary from 'style-dictionary';
import { buildModel, parseColor } from '../sd/model.mjs';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function resolve(theme) {
  const sd = new StyleDictionary(
    {
      source: [
        path.join(pkg, 'tokens/primitive/*.json'),
        path.join(pkg, 'tokens/semantic/base.json'),
        path.join(pkg, 'tokens/semantic/accents.json'),
        path.join(pkg, `tokens/semantic/${theme}.json`),
      ],
      platforms: { t: { transforms: ['name/kebab'] } },
      log: { verbosity: 'silent' },
    },
    { warnings: 'error' },
  );
  return (await sd.getPlatformTokens('t')).allTokens;
}

const model = buildModel(await resolve('light'), await resolve('dark'));
const role = (name) => model.roles.find((r) => r.name.join('.') === name);

/** WCAG 2 contrast of an opaque foreground over an opaque background. */
function contrast(fg, bg) {
  const lum = (c) => {
    const { r, g, b } = parseColor(c);
    const ch = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

test('reading text meets AA on the surface, in both themes', () => {
  for (const mode of ['light', 'dark']) {
    const surface = role('surface')[mode];
    for (const name of ['fg', 'fg.secondary', 'fg.muted', 'fg.link', 'danger', 'warning', 'success', 'info']) {
      const ratio = contrast(role(name)[mode], surface);
      assert.ok(ratio >= 4.5, `${mode} ${name} is ${ratio.toFixed(2)}:1 on the surface`);
    }
  }
});

test('an accent\'s strong shade is readable on white, and its label reads on its fill', () => {
  for (const a of model.accents) {
    const ratio = contrast(a.light.strong, '#ffffff');
    assert.ok(ratio >= 4.5, `${a.id} strong is ${ratio.toFixed(2)}:1 on white`);
    const onSoft = contrast(a.light.strong, a.light.soft);
    assert.ok(onSoft >= 4.5, `${a.id} strong is ${onSoft.toFixed(2)}:1 on its soft wash`);
  }
});

test('a type\'s fg is readable on white and on its own wash', () => {
  for (const t of model.types) {
    assert.ok(contrast(t.light.fg, '#ffffff') >= 4.5, `${t.name} fg on white`);
    assert.ok(contrast(t.light.fg, t.light.wash) >= 4.5, `${t.name} fg on its wash`);
  }
});

test('the logo green is fixed and is the default accent', () => {
  assert.equal(role('brand').light, '#78d870');
  assert.equal(role('brand').dark, '#78d870');
  assert.equal(model.accents[0].id, 'green');
  assert.equal(model.accents[0].light.default, role('brand').light);
  assert.equal(role('accent').light, model.accents[0].light.default);
});

test('every built-in type has a distinct base colour', () => {
  const seen = new Map();
  for (const t of model.types) {
    const prior = seen.get(t.light.default);
    assert.ok(!prior, `${t.name} and ${prior} share ${t.light.default}`);
    seen.set(t.light.default, t.name);
  }
});

test('every role has a dark value, and dark differs from light where a surface does', () => {
  for (const r of model.roles) assert.ok(r.dark, `${r.name.join('.')} has no dark value`);
  assert.notEqual(role('surface').dark, role('surface').light);
  assert.notEqual(role('fg').dark, role('fg').light);
});

test('every generated file is current', () => {
  execFileSync(process.execPath, [path.join(pkg, 'scripts/build.mjs'), '--check'], { stdio: 'pipe' });
});
