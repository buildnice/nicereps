import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/catalog.ts <free-exercise-db checkout>');
const out = join(import.meta.dirname, '../assets/catalog');
const budget = 25_000_000;

type Raw = { id: string; name: string; category: string; force: string | null; equipment: string | null; primaryMuscles: string[]; secondaryMuscles: string[]; instructions: string[]; images: string[] };
const raw: Raw[] = JSON.parse(readFileSync(join(source, 'dist/exercises.json'), 'utf8'));
const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const file = (id: string, i: number) => `${id.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${i}.webp`;
const names = new Set<string>();
const files = new Set<string>();
const catalog: Record<string, unknown> = {};
const images: string[] = [];

rmSync(join(out, 'images'), { recursive: true, force: true });
mkdirSync(join(out, 'images'), { recursive: true });

for (const e of raw) {
  const name = e.name.trim().replace(/\s+/g, ' ');
  assert(name && !names.has(name.toLowerCase()), `Bad or duplicate name: ${e.id}`);
  names.add(name.toLowerCase());
  assert(e.primaryMuscles.length && [...e.primaryMuscles, ...e.secondaryMuscles].every((m) => typeof m === 'string' && m.trim()), `Bad muscles: ${e.id}`);
  assert(e.instructions.every((s) => typeof s === 'string'), `Bad instructions: ${e.id}`);
  catalog[e.id] = {
    name,
    mode: ['stretching', 'cardio'].includes(e.category) || e.force === 'static' ? 'duration' : 'reps',
    equipment: e.equipment,
    primary: e.primaryMuscles,
    secondary: e.secondaryMuscles.filter((m) => !e.primaryMuscles.includes(m)),
    instructions: e.instructions.map((s) => s.trim()).filter(Boolean),
  };
  const sources = e.images.map((image, i) => {
    const name = file(e.id, i);
    assert(!files.has(name), `Image name collision: ${name}`);
    files.add(name);
    execFileSync('magick', [join(source, 'exercises', image), '-resize', '480x480>', '-strip', '-quality', '60', join(out, 'images', name)]);
    return `require('./images/${name}')`;
  });
  if (sources.length) images.push(`  ${JSON.stringify(e.id)}: [${sources.join(', ')}],`);
}

const size = [...files].reduce((n, f) => n + statSync(join(out, 'images', f)).size, 0);
assert(size < budget, `Images are ${size} bytes, over the ${budget} byte budget`);

writeFileSync(
  join(out, 'exercises.ts'),
  `export type CatalogEntry = { name: string; mode: 'reps' | 'duration'; equipment: string | null; primary: string[]; secondary: string[]; instructions: string[] };

export const catalog: Record<string, CatalogEntry> = ${JSON.stringify(catalog)};
`,
);
writeFileSync(join(out, 'images.ts'), `export const images: Record<string, number[]> = {\n${images.join('\n')}\n};\n`);
writeFileSync(
  join(out, 'NOTICE.md'),
  `# Exercise catalog source

Exercise metadata, instructions and images come from [Free Exercise DB](https://github.com/yuhonas/free-exercise-db) at commit \`${commit}\`. Images were resized to at most 480 px and converted to WebP by \`scripts/catalog.ts\`.

${readFileSync(join(source, 'LICENSE.md'), 'utf8')}`,
);
console.log(`${raw.length} exercises, ${files.size} images, ${size} bytes`);
