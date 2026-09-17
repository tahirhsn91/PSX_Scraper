import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

/**
 * Regression guard for the bug in #17.
 *
 * `page.evaluate(fn)` does not call `fn` in the worker — Puppeteer serialises it
 * with `Function.prototype.toString()` and evaluates that source inside the page.
 * The dev worker runs through tsx, which enables esbuild's `keepNames`; that
 * rewrites named functions and function-valued variables into
 * `__name(fn, "name")` calls. Those wrappers end up inside the serialised source,
 * and since `__name` does not exist in the browser, every scrape threw
 * "ReferenceError: __name is not defined" — both providers failed, every sync was
 * logged FAILED, and no price/company/change% was ever persisted.
 *
 * Jest runs through ts-jest (plain tsc, no `keepNames`), so relying on the test
 * runner's own transform would prove nothing. These specs reproduce the dev
 * runner's transform explicitly instead.
 */
const SCRAPERS_DIR = path.join(__dirname, '..', 'src', 'scrapers');
const SCRAPER_FILES = ['psx.scraper.ts', 'sarmaaya.scraper.ts', 'historical.scraper.ts'];

/** `__name(this, "Cls")` is emitted for a class declaration: never serialised. */
const CLASS_WRAPPER = /^__name\(this,\s*"/;

/** Transform a scraper exactly the way the dev runner (tsx) does. */
async function transformedForDevRunner(file: string): Promise<string> {
  const source = readFileSync(path.join(SCRAPERS_DIR, file), 'utf8');
  const { code } = await esbuild.transform(source, {
    loader: 'ts',
    format: 'cjs',
    keepNames: true, // what tsx switches on
  });
  return code;
}

/** Source of a top-level `function name(...) { ... }` in emitted code. */
function functionBody(code: string, name: string): string | null {
  const start = code.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const open = code.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return null;
}

describe('scrapers survive the bundler transform that broke every dev-stack sync (#17)', () => {
  it.each(SCRAPER_FILES)('%s adds no name-preserving wrapper inside a method body', async (file) => {
    const code = await transformedForDevRunner(file);

    const offenders = code
      .split('\n')
      .filter((line) => /^\s+\S/.test(line)) // indented => inside a class/method body
      .map((line) => line.trim())
      .filter((line) => line.includes('__name(') && !CLASS_WRAPPER.test(line));

    // A wrapper here is emitted inside the function Puppeteer serialises, so it
    // reaches the browser and throws. Move the helper to an inline anonymous
    // callback (`.find((n) => …)`) or to an object-literal shorthand method.
    expect(offenders).toEqual([]);
  });
});

describe('evaluated extractors can be passed to page.evaluate by reference', () => {
  const EXTRACTORS: Array<[file: string, fn: string]> = [
    ['psx.scraper.ts', 'extractPsxPageData'],
    ['sarmaaya.scraper.ts', 'extractSarmaayaPageData'],
  ];

  it.each(EXTRACTORS)('%s passes %s by reference, not as an inline arrow', (file, fn) => {
    const source = readFileSync(path.join(SCRAPERS_DIR, file), 'utf8');
    expect(source).toMatch(new RegExp(`page\\.evaluate\\(\\s*${fn}\\s*\\)`));
  });

  it.each(EXTRACTORS)('%s: %s serialises without bundler wrappers', async (file, fn) => {
    const code = await transformedForDevRunner(file);
    const body = functionBody(code, fn);

    // Null means the extractor is no longer a top-level declaration — it cannot be
    // handed to page.evaluate by reference, which is what keeps this check possible.
    expect(body).not.toBeNull();
    expect(body).not.toContain('__name(');
  });
});
