import { describe, it, expect } from 'vitest';
import { isExcluded } from '../src/pre-scan.js';
import type { ExclusionEntry } from '../src/types.js';

describe('isExcluded', () => {
  const exclusions: ExclusionEntry[] = [
    { path: '.env', reason: 'environment variables' },
    { path: '.git/', reason: 'version control' },
    { path: 'node_modules/', reason: 'too large' },
    { path: 'src/secrets.json', reason: 'credentials' },
  ];

  it('exact file path match', () => {
    expect(isExcluded('.env', exclusions)).toBe(true);
  });

  it('directory prefix match (.git/config)', () => {
    // .git/ is stored with trailing slash; isExcluded strips it, then checks startsWith
    expect(isExcluded('.git/config', exclusions)).toBe(true);
  });

  it('no match for unrelated paths', () => {
    expect(isExcluded('src/index.ts', exclusions)).toBe(false);
  });

  it('no partial match (.env.example.bak is not .env)', () => {
    // isExcluded does exact match or directory-prefix match — .env.example.bak !== .env
    // and .env.example.bak does not start with ".env/"
    expect(isExcluded('.env.example.bak', exclusions)).toBe(false);
  });

  it('nested excluded file inside excluded dir', () => {
    expect(isExcluded('node_modules/lodash/index.js', exclusions)).toBe(true);
  });

  it('empty exclusion list never excludes anything', () => {
    expect(isExcluded('any/path/file.ts', [])).toBe(false);
  });

  it('deep nested path under excluded dir', () => {
    expect(isExcluded('node_modules/a/b/c/d/e/deep.js', exclusions)).toBe(true);
  });

  it('.github is not matched by .git/ exclusion', () => {
    // .git strips trailing slash -> ".git"; ".github" does not equal ".git"
    // and ".github" does not start with ".git/"
    expect(isExcluded('.github/workflows/ci.yml', exclusions)).toBe(false);
  });
});
