// Native: SwiftUI for iOS, Jetpack Compose for Android. Both are committed into
// the app trees (apps/mobile sits outside the pnpm workspace, so Xcode and
// Gradle build without Node), and both use the same names — `VVColor.fgMuted`,
// `VVSpace.x4`, `VVRadius.lg` — so a spec written against one reads on the other.
import { HEADER_LINES, camel, parseColor } from '../model.mjs';

/** A scale key as an identifier: `2xl` → `xl2`, `0-5` → `x0_5` (space), `13` → `s13` (sizes). */
function ident(key, numericPrefix) {
  const k = String(key);
  if (/^\d/.test(k) && /[a-z]/i.test(k)) return k.replace(/^(\d+)(.*)$/, '$2$1'); // 2xl → xl2
  if (/^\d/.test(k)) return numericPrefix + k.replace('-', '_');
  return camel([k]);
}

const roleName = (r) => camel(r.name);
/** The accent is a person's choice, carried by the theme store as a `VVAccent` — never a fixed colour. */
const fixedRoles = (model) => model.roles.filter((r) => r.name[0] !== 'accent');
const typeName = (t) => camel([t.name]);

// ── Swift ──────────────────────────────────────────────────────────────────

function swiftUIColor(value) {
  const { r, g, b, a } = parseColor(value);
  return `UIColor(vv: ${r}, ${g}, ${b}, ${+a.toFixed(4)})`;
}
const swiftDynamic = (light, dark) => `vvColor(${swiftUIColor(light)}, ${swiftUIColor(dark)})`;
const swiftDoc = (d, indent = '    ') => (d ? `${indent}/// ${d}\n` : '');
const swiftNum = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(4)));

export function swift(model) {
  const o = [];
  o.push(HEADER_LINES.map((l) => `// ${l}`).join('\n'));
  o.push('');
  o.push('import SwiftUI');
  o.push('import UIKit');
  o.push('');
  o.push('private extension UIColor {');
  o.push('    convenience init(vv r: Int, _ g: Int, _ b: Int, _ a: Double) {');
  o.push('        self.init(red: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: a)');
  o.push('    }');
  o.push('}');
  o.push('');
  o.push('/// A colour that follows the appearance between its light and dark value. The');
  o.push('/// app pins itself light, so today every one of these is its light value.');
  o.push('private func vvColor(_ light: UIColor, _ dark: UIColor) -> Color {');
  o.push('    Color(UIColor { $0.userInterfaceStyle == .dark ? dark : light })');
  o.push('}');
  o.push('');
  o.push('/// Semantic colours. Paint with these, never a literal. The accent is not here:');
  o.push('/// it is the person\'s choice, a `VVAccent` held by the theme store.');
  o.push('enum VVColor {');
  for (const r of fixedRoles(model)) o.push(`${swiftDoc(r.description)}    static let ${roleName(r)} = ${swiftDynamic(r.light, r.dark)}`);
  o.push('}');
  o.push('');
  o.push('/// A built-in type\'s colours: `base` for its chip and glyph, `fg` for text in its hue, `wash` behind it.');
  o.push('struct VVSwatch {');
  o.push('    let base: Color');
  o.push('    let fg: Color');
  o.push('    let wash: Color');
  o.push('}');
  o.push('');
  o.push('/// The default colour of each built-in type. A space may override one.');
  o.push('enum VVTypeColor {');
  for (const t of model.types) {
    o.push(`    static let ${typeName(t)} = VVSwatch(`);
    o.push(`        base: ${swiftDynamic(t.light.default, t.dark.default)},`);
    o.push(`        fg: ${swiftDynamic(t.light.fg, t.dark.fg)},`);
    o.push(`        wash: ${swiftDynamic(t.light.wash, t.dark.wash)}`);
    o.push('    )');
  }
  o.push('');
  o.push('    /// A type by the name a node carries (`Person`, `space`…); `other` when it is not built in.');
  o.push('    static func named(_ name: String) -> VVSwatch {');
  o.push('        switch name.lowercased() {');
  for (const t of model.types.filter((t) => t.name !== 'other')) o.push(`        case "${t.name}": return ${typeName(t)}`);
  o.push('        default: return other');
  o.push('        }');
  o.push('    }');
  o.push('}');
  o.push('');
  o.push('/// A hue a person picks from in Settings. The id is what is stored.');
  o.push('struct VVAccent: Identifiable, Hashable {');
  o.push('    let id: String');
  o.push('    let name: String');
  o.push('    /// Fills and the selected state.');
  o.push('    let base: Color');
  o.push('    /// Text and icons in the accent, on white.');
  o.push('    let strong: Color');
  o.push('    /// A wash behind a selected row.');
  o.push('    let soft: Color');
  o.push('');
  o.push('    static let all: [VVAccent] = [');
  for (const a of model.accents) {
    o.push('        VVAccent(');
    o.push(`            id: "${a.id}", name: "${a.name}",`);
    o.push(`            base: ${swiftDynamic(a.light.default, a.dark.default)},`);
    o.push(`            strong: ${swiftDynamic(a.light.strong, a.dark.strong)},`);
    o.push(`            soft: ${swiftDynamic(a.light.soft, a.dark.soft)}`);
    o.push('        ),');
  }
  o.push('    ]');
  o.push('');
  o.push('    static let `default` = all[0]');
  o.push('');
  o.push('    static func named(_ id: String?) -> VVAccent {');
  o.push('        all.first { $0.id == id } ?? .default');
  o.push('    }');
  o.push('}');
  o.push('');
  const cgEnum = (name, doc, list, prefix) => {
    o.push(`/// ${doc}`);
    o.push(`enum ${name} {`);
    for (const s of list) o.push(`    static let ${ident(s.key, prefix)}: CGFloat = ${swiftNum(s.value)}`);
    o.push('}');
    o.push('');
  };
  cgEnum('VVSpace', 'Spacing in points, named like Tailwind: `x4` is `p-4` is 16.', model.space, 'x');
  cgEnum('VVRadius', 'Corner radius in points.', model.radius, 'r');
  cgEnum('VVFontSize', 'Font size in points, named by size.', model.fontSize, 's');
  o.push('enum VVFontWeight {');
  const weights = { 300: '.light', 400: '.regular', 500: '.medium', 600: '.semibold', 700: '.bold' };
  for (const w of model.fontWeight) o.push(`    static let ${camel([w.key])}: Font.Weight = ${weights[w.value]}`);
  o.push('}');
  o.push('');
  o.push('/// Durations in seconds, and the curves they run on.');
  o.push('enum VVMotion {');
  for (const d of model.duration) o.push(`${swiftDoc(d.description)}    static let ${camel([d.key])}: Double = ${swiftNum(d.value / 1000)}`);
  o.push('');
  for (const e of model.ease) {
    const [x1, y1, x2, y2] = e.value;
    o.push(`${swiftDoc(e.description)}    static func ${camel([e.key])}(_ duration: Double = base) -> Animation {`);
    o.push(`        .timingCurve(${x1}, ${y1}, ${x2}, ${y2}, duration: duration)`);
    o.push('    }');
  }
  o.push('}');
  return o.join('\n') + '\n';
}

// ── Kotlin ─────────────────────────────────────────────────────────────────

function kotlinColor(value) {
  const { r, g, b, a } = parseColor(value);
  const hex = [r, g, b].map((n) => n.toString(16).padStart(2, '0').toUpperCase()).join('');
  return a === 1 ? `Color(0xFF${hex})` : `Color(0xFF${hex}).copy(alpha = ${+a.toFixed(4)}f)`;
}
const ktDoc = (d, indent = '    ') => (d ? `${indent}/** ${d} */\n` : '');
const ktFloat = (n) => `${Number.isInteger(n) ? n : +n.toFixed(4)}f`;

export function kotlin(model, { packageName }) {
  const o = [];
  o.push(HEADER_LINES.map((l) => `// ${l}`).join('\n'));
  o.push('');
  o.push(`package ${packageName}`);
  o.push('');
  o.push('import androidx.compose.animation.core.CubicBezierEasing');
  o.push('import androidx.compose.ui.graphics.Color');
  o.push('import androidx.compose.ui.text.font.FontWeight');
  o.push('import androidx.compose.ui.unit.dp');
  o.push('import androidx.compose.ui.unit.sp');
  o.push('');
  const colorObject = (name, doc, mode) => {
    o.push(`/** ${doc} */`);
    o.push(`object ${name} {`);
    for (const r of fixedRoles(model)) o.push(`${mode === 'light' ? ktDoc(r.description) : ''}    val ${roleName(r)} = ${kotlinColor(r[mode])}`);
    o.push('}');
    o.push('');
  };
  colorObject('VVColor', 'Semantic colours, light — the theme the app shows. Paint with these, never a literal. The accent is the person\'s choice, a VVAccent held by the theme controller.', 'light');
  colorObject('VVColorDark', 'PROVISIONAL dark theme, same names as VVColor. Switched on nowhere yet.', 'dark');

  o.push("/** A built-in type's colours: `base` for its chip and glyph, `fg` for text in its hue, `wash` behind it. */");
  o.push('data class VVSwatch(val base: Color, val fg: Color, val wash: Color)');
  o.push('');
  const typeObject = (name, doc, mode) => {
    o.push(`/** ${doc} */`);
    o.push(`object ${name} {`);
    for (const t of model.types) {
      o.push(`    val ${typeName(t)} = VVSwatch(${kotlinColor(t[mode].default)}, ${kotlinColor(t[mode].fg)}, ${kotlinColor(t[mode].wash)})`);
    }
    o.push('');
    o.push('    /** A type by the name a node carries (`Person`, `space`…); `other` when it is not built in. */');
    o.push('    fun named(name: String): VVSwatch = when (name.lowercase()) {');
    for (const t of model.types.filter((t) => t.name !== 'other')) o.push(`        "${t.name}" -> ${typeName(t)}`);
    o.push('        else -> other');
    o.push('    }');
    o.push('}');
    o.push('');
  };
  typeObject('VVTypeColor', 'The default colour of each built-in type. A space may override one.', 'light');
  typeObject('VVTypeColorDark', 'PROVISIONAL dark type colours.', 'dark');

  o.push('/** One accent in one theme: `base` for fills and the selected state, `strong` for text and icons, `soft` behind a selected row. */');
  o.push('data class VVAccentSet(val base: Color, val strong: Color, val soft: Color)');
  o.push('');
  o.push('/** A hue a person picks from in Settings. The id is what is stored. */');
  o.push('data class VVAccent(val id: String, val name: String, val light: VVAccentSet, val dark: VVAccentSet)');
  o.push('');
  o.push('object VVAccents {');
  o.push('    val all: List<VVAccent> = listOf(');
  for (const a of model.accents) {
    const set = (s) => `VVAccentSet(${kotlinColor(s.default)}, ${kotlinColor(s.strong)}, ${kotlinColor(s.soft)})`;
    o.push(`        VVAccent("${a.id}", "${a.name}", ${set(a.light)}, ${set(a.dark)}),`);
  }
  o.push('    )');
  o.push('');
  o.push('    val default: VVAccent get() = all.first()');
  o.push('');
  o.push('    fun named(id: String?): VVAccent = all.firstOrNull { it.id == id } ?: default');
  o.push('}');
  o.push('');
  const unitObject = (name, doc, list, prefix, unit) => {
    o.push(`/** ${doc} */`);
    o.push(`object ${name} {`);
    for (const s of list) o.push(`    val ${ident(s.key, prefix)} = ${Number.isInteger(s.value) ? s.value : s.value}.${unit}`);
    o.push('}');
    o.push('');
  };
  unitObject('VVSpace', 'Spacing, named like Tailwind: `x4` is `p-4` is 16.dp.', model.space, 'x', 'dp');
  unitObject('VVRadius', 'Corner radius.', model.radius, 'r', 'dp');
  unitObject('VVFontSize', 'Font size, named by size.', model.fontSize, 's', 'sp');
  o.push('object VVFontWeight {');
  for (const w of model.fontWeight) o.push(`    val ${camel([w.key])} = FontWeight(${w.value})`);
  o.push('}');
  o.push('');
  o.push('/** Durations in milliseconds, and the curves they run on. */');
  o.push('object VVMotion {');
  for (const d of model.duration) o.push(`${ktDoc(d.description)}    const val ${camel([d.key])} = ${d.value}`);
  o.push('');
  for (const e of model.ease) {
    o.push(`${ktDoc(e.description)}    val ${camel([e.key])} = CubicBezierEasing(${e.value.map(ktFloat).join(', ')})`);
  }
  o.push('}');
  return o.join('\n') + '\n';
}
