/**
 * build-practice-tests.ts — assemble pre-built adaptive practice tests from
 * harvested_questions into practice_tests + practice_test_questions.
 *
 * Every test is atomic and carries SIX modules of content:
 *   (reading-writing, 1, mixed)  27 questions
 *   (reading-writing, 2, easy)   27 questions   (~70% d2 / 30% d3)
 *   (reading-writing, 2, hard)   27 questions   (~30% d3 / 70% d4)
 *   (math, 1, mixed)             22 questions   (17 mcq / 5 grid_in)
 *   (math, 2, easy)              22 questions
 *   (math, 2, hard)              22 questions
 *
 * Domain quotas per module follow the real digital-SAT blueprint:
 *   RW:   Craft & Structure 8, Information & Ideas 7,
 *         Standard English Conventions 7, Expression of Ideas 5
 *   Math: Algebra 8, Advanced Math 8, Problem-Solving & Data Analysis 3,
 *         Geometry & Trigonometry 3
 *
 * Series (never mixed within a test, zero question reuse across tests —
 * enforced by the UNIQUE(source_id) constraint):
 *   A — origin='question_bank'   → labels A1, A2, ...
 *   B — origin='bluebook'        → labels B1, B2, ...
 *
 * A series is rebuilt from scratch each run (its rows are deleted first).
 * The loop stops when any bucket can no longer fill a complete test; a
 * per-bucket utilization report is printed at the end.
 *
 * Usage:
 *   npm run build:tests                 # both series, seed 42
 *   tsx scripts/build-practice-tests.ts --series B --seed 7 --dry-run
 */
import { connectOrPending } from './lib/db.js';

// ---------------------------------------------------------------- args / rng

const args = process.argv.slice(2);
const argValue = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const SERIES_ARG = (argValue('series') ?? 'both').toUpperCase();
const SEED = Number(argValue('seed') ?? '42');
const DRY_RUN = args.includes('--dry-run');

/** mulberry32 — small deterministic PRNG so builds are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ------------------------------------------------------------- test recipe

type Section = 'reading-writing' | 'math';
type Tier = 'mixed' | 'easy' | 'hard';
const D = [2, 3, 4] as const; // internal difficulty scale
type Difficulty = (typeof D)[number];

const RW_LENGTH = 27;
const MATH_LENGTH = 22;
const GRID_IN_PER_MATH_MODULE = 5;

/** Per-module domain quotas (largest-remainder on the real blueprint). */
const DOMAIN_QUOTAS: Record<Section, Array<[string, number]>> = {
  'reading-writing': [
    ['Craft and Structure', 8],
    ['Information and Ideas', 7],
    ['Standard English Conventions', 7],
    ['Expression of Ideas', 5],
  ],
  math: [
    ['Algebra', 8],
    ['Advanced Math', 8],
    ['Problem-Solving and Data Analysis', 3],
    ['Geometry and Trigonometry', 3],
  ],
};

/** Difficulty mix per tier, expressed as weights over [d2, d3, d4]. */
const TIER_MIX: Record<Tier, [number, number, number]> = {
  mixed: [0.3, 0.4, 0.3],
  easy: [0.7, 0.3, 0.0],
  hard: [0.0, 0.3, 0.7],
};

/** Grid-in difficulty mix per tier for the 5 SPR questions (d2/d3/d4). */
const GRID_MIX: Record<Tier, [number, number, number]> = {
  mixed: [0.2, 0.4, 0.4],
  easy: [0.4, 0.6, 0.0],
  hard: [0.0, 0.2, 0.8],
};

/** RW in-module ordering (canonical digital-SAT skill sequence):
 *  vocab → reading comprehension (main idea / underline-function / paired
 *  texts / textual evidence / inferences) → graphs → standard conventions →
 *  transitions → notes (rhetorical synthesis). Within a skill: easy → hard.
 *  Math ramps easy → hard. */
const RW_SKILL_ORDER = [
  'words-in-context',
  'central-ideas-details',
  'text-structure-purpose',
  'cross-text-connections',
  'command-evidence-textual',
  'inferences',
  'command-evidence-quantitative',
  'boundaries',
  'form-structure-sense',
  'transitions',
  'rhetorical-synthesis',
];

/** Largest-remainder split of `total` across weights. */
function splitCounts(total: number, weights: number[]): number[] {
  const raw = weights.map((w) => w * total);
  const floors = raw.map(Math.floor);
  let rem = total - floors.reduce((s, n) => s + n, 0);
  const order = raw.map((v, i) => [v - floors[i]!, i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rem <= 0) break;
    floors[i]! += 1;
    rem -= 1;
  }
  return floors;
}

// ------------------------------------------------------------------- pools

interface Item {
  source_id: string;
  section: Section;
  domain: string;
  skill: string;
  difficulty: Difficulty;
  type: 'mcq' | 'grid_in';
}

type BucketKey = `${string}|${Difficulty}|${Item['type']}`;
const key = (domain: string, d: Difficulty, t: Item['type']): BucketKey => `${domain}|${d}|${t}`;

interface SectionPools {
  buckets: Map<BucketKey, Item[]>;
  domains: string[];
}

interface BuildStats {
  /** picks that fell back to a non-target difficulty (same domain) */
  difficultyFallbacks: number;
  /** picks that fell back to a different domain */
  domainFallbacks: number;
  /** mcq slots filled by grid_in or vice versa */
  typeFallbacks: number;
}

function take(
  pools: SectionPools,
  domain: string,
  d: Difficulty,
  type: Item['type'] | 'any',
): Item | undefined {
  if (type !== 'any') {
    const v = pools.buckets.get(key(domain, d, type));
    if (v && v.length > 0) return v.pop();
    return undefined;
  }
  for (const t of ['mcq', 'grid_in'] as const) {
    const v = pools.buckets.get(key(domain, d, t));
    if (v && v.length > 0) return v.pop();
  }
  return undefined;
}

/** Difficulty preference order when the target bucket is empty. */
function fallbackOrder(d: Difficulty): Difficulty[] {
  if (d === 2) return [2, 3, 4];
  if (d === 4) return [4, 3, 2];
  return [3, 2, 4];
}

/** Draw one question for (domain, targetDifficulty); fall back within the
 *  domain first, then across other domains in the section. */
function draw(
  pools: SectionPools,
  domain: string,
  target: Difficulty,
  type: Item['type'] | 'any',
  stats: BuildStats,
): Item | undefined {
  for (const d of fallbackOrder(target)) {
    const item = take(pools, domain, d, type);
    if (item) {
      if (d !== target) stats.difficultyFallbacks++;
      return item;
    }
    if (type !== 'any') {
      const anyItem = take(pools, domain, d, 'any');
      if (anyItem) {
        stats.difficultyFallbacks += d === target ? 0 : 1;
        stats.typeFallbacks++;
        return anyItem;
      }
    }
  }
  for (const other of shuffle(pools.domains.filter((x) => x !== domain))) {
    for (const d of fallbackOrder(target)) {
      const item = take(pools, other, d, type) ?? (type !== 'any' ? take(pools, other, d, 'any') : undefined);
      if (item) {
        stats.domainFallbacks++;
        return item;
      }
    }
  }
  return undefined;
}

// ------------------------------------------------------- module assembly

interface ModuleSpec {
  section: Section;
  module: 1 | 2;
  tier: Tier;
  length: number;
}

const MODULE_SPECS: ModuleSpec[] = [
  { section: 'reading-writing', module: 1, tier: 'mixed', length: RW_LENGTH },
  { section: 'reading-writing', module: 2, tier: 'easy', length: RW_LENGTH },
  { section: 'reading-writing', module: 2, tier: 'hard', length: RW_LENGTH },
  { section: 'math', module: 1, tier: 'mixed', length: MATH_LENGTH },
  { section: 'math', module: 2, tier: 'easy', length: MATH_LENGTH },
  { section: 'math', module: 2, tier: 'hard', length: MATH_LENGTH },
];

/** Assemble one module; returns ordered items or null when the pools can no
 *  longer fill it completely (caller stops the series). */
function assembleModule(spec: ModuleSpec, pools: SectionPools, stats: BuildStats): Item[] | null {
  const quotas = DOMAIN_QUOTAS[spec.section];
  const mix = TIER_MIX[spec.tier];
  const picked: Item[] = [];

  if (spec.section === 'math') {
    // Phase 1: exactly 5 grid-ins per math module, spread across domains,
    // never exceeding a domain's quota (that would overflow module length).
    const gridTargets = splitCounts(GRID_IN_PER_MATH_MODULE, [...GRID_MIX[spec.tier]]);
    const gridCapacity = new Map<string, number>(quotas.map(([dom, q]) => [dom, q]));
    const rotation = shuffle(quotas.flatMap(([dom, q]) => Array<string>(q).fill(dom)));
    const gridByDomain = new Map<string, Item[]>();
    let rot = 0;
    const withCapacity = (): string[] => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (let i = 0; i < rotation.length; i++) {
        const dom = rotation[(rot + i) % rotation.length]!;
        if (!seen.has(dom) && (gridCapacity.get(dom) ?? 0) > 0) {
          seen.add(dom);
          out.push(dom);
        }
      }
      return out;
    };
    D.forEach((d, di) => {
      for (let n = 0; n < gridTargets[di]!; n++) {
        let item: Item | undefined;
        const candidates = withCapacity();
        // target difficulty, rotation order
        for (const dom of candidates) {
          item = take(pools, dom, d, 'grid_in');
          if (item) break;
        }
        // any difficulty grid_in, then any type, still within capacity
        if (!item) {
          for (const dom of candidates) {
            for (const dd of fallbackOrder(d)) {
              item = take(pools, dom, dd, 'grid_in');
              if (item) break;
            }
            if (item) break;
          }
        }
        if (!item) {
          for (const dom of candidates) {
            item = draw(pools, dom, d, 'any', stats);
            if (item) break;
          }
        }
        if (!item) continue; // module length check below catches this
        if (item.type !== 'grid_in') stats.typeFallbacks++;
        if ((gridCapacity.get(item.domain) ?? 0) <= 0) continue; // safety: never overfill a domain
        gridCapacity.set(item.domain, (gridCapacity.get(item.domain) ?? 0) - 1);
        const list = gridByDomain.get(item.domain) ?? [];
        list.push(item);
        gridByDomain.set(item.domain, list);
        picked.push(item);
      }
    });

    // Phase 2: fill remaining domain quotas (preferring mcq) at the tier mix.
    for (const [dom, q] of quotas) {
      const grids = gridByDomain.get(dom) ?? [];
      const remaining = q - grids.length;
      if (remaining <= 0) continue;
      const targets = splitCounts(q, [...mix]);
      // grid-ins already drawn count toward the domain's difficulty targets
      for (const g of grids) {
        const gi = D.indexOf(g.difficulty);
        if (targets[gi]! > 0) targets[gi]!--;
      }
      // grids that couldn't be absorbed above still occupy domain slots —
      // cut the excess from the largest remaining targets
      let over = targets.reduce((s, n) => s + n, 0) - remaining;
      const order = targets.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
      for (const [, i] of order) {
        if (over <= 0) break;
        const cut = Math.min(over, targets[i]!);
        targets[i]! -= cut;
        over -= cut;
      }
      D.forEach((d, di) => {
        for (let n = 0; n < targets[di]!; n++) {
          const item =
            take(pools, dom, d, 'mcq') ??
            draw(pools, dom, d, 'any', stats);
          if (!item) return;
          picked.push(item);
        }
      });
    }
    if (picked.length < spec.length) {
      // top up from anywhere in the section so length stays exact
      for (const dom of shuffle([...pools.domains])) {
        for (const d of D) {
          while (picked.length < spec.length) {
            const item = take(pools, dom, d, 'any');
            if (!item) break;
            stats.domainFallbacks++;
            picked.push(item);
          }
          if (picked.length >= spec.length) break;
        }
        if (picked.length >= spec.length) break;
      }
    }
  } else {
    // RW: straight per-domain quota at the tier mix.
    for (const [dom, q] of quotas) {
      const targets = splitCounts(q, [...mix]);
      D.forEach((d, di) => {
        for (let n = 0; n < targets[di]!; n++) {
          const item = draw(pools, dom, d, 'any', stats);
          if (item) picked.push(item);
        }
      });
    }
  }

  if (picked.length < spec.length) return null;
  return orderModule(spec, picked);
}

/** In-module presentation order (position 1..n). */
function orderModule(spec: ModuleSpec, items: Item[]): Item[] {
  if (spec.section === 'math') {
    // ramp easy → hard, shuffled within a difficulty
    return [...D].flatMap((d) => shuffle(items.filter((q) => q.difficulty === d)));
  }
  const rank = (q: Item): number => {
    const i = RW_SKILL_ORDER.indexOf(q.skill);
    return i === -1 ? RW_SKILL_ORDER.length : i;
  }
  // skill sequence, then easy → hard within a skill, shuffled tiebreak
  const bucket = new Map<string, Item[]>();
  for (const q of items) {
    const k = `${rank(q)}|${q.difficulty}`;
    const list = bucket.get(k) ?? [];
    list.push(q);
    bucket.set(k, list);
  }
  return [...bucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .flatMap(([, v]) => shuffle(v));
}

// ------------------------------------------------------------------- main

interface SeriesDef {
  series: 'A' | 'B';
  origin: 'question_bank' | 'bluebook';
}
const SERIES: SeriesDef[] = [
  { series: 'A', origin: 'question_bank' },
  { series: 'B', origin: 'bluebook' },
];

async function main(): Promise<void> {
  const client = await connectOrPending('build:tests');
  try {
    const wanted = SERIES.filter((s) => SERIES_ARG === 'BOTH' || s.series === SERIES_ARG);
    for (const def of wanted) {
      console.log(`\n=== Series ${def.series} (origin=${def.origin}) ===`);
      if (!DRY_RUN) {
        // rebuild from scratch: release this series' questions back into the pool
        await client.query('DELETE FROM practice_tests WHERE series = $1', [def.series]);
      }
      const res = await client.query<{
        source_id: string;
        section: Section;
        domain: string;
        skill: string;
        difficulty_internal: Difficulty;
        question_type: Item['type'];
      }>(
        `SELECT source_id, section, domain, skill, difficulty_internal, question_type
         FROM harvested_questions
         WHERE origin = $1
           AND NOT (payload ? 'curated'
                    AND coalesce(payload->'curated'->'review'->>'status', '') <> 'approved')
           AND source_id NOT IN (SELECT source_id FROM practice_test_questions)`,
        [def.origin],
      );

      const poolsBySection = new Map<Section, SectionPools>();
      for (const row of res.rows) {
        let p = poolsBySection.get(row.section);
        if (!p) {
          p = { buckets: new Map(), domains: [] };
          poolsBySection.set(row.section, p);
        }
        const item: Item = {
          source_id: row.source_id,
          section: row.section,
          domain: row.domain,
          skill: row.skill,
          difficulty: row.difficulty_internal,
          type: row.question_type,
        };
        const k = key(item.domain, item.difficulty, item.type);
        const list = p.buckets.get(k) ?? [];
        list.push(item);
        p.buckets.set(k, list);
      }
      for (const p of poolsBySection.values()) {
        for (const [k, v] of p.buckets) p.buckets.set(k, shuffle(v));
        p.domains = [...new Set([...p.buckets.keys()].map((b) => b.split('|')[0]!))];
      }

      const totalStats: BuildStats = { difficultyFallbacks: 0, domainFallbacks: 0, typeFallbacks: 0 };
      let built = 0;
      for (let n = 1; ; n++) {
        const label = `${def.series}${n}`;
        const modules: Array<{ spec: ModuleSpec; items: Item[] }> = [];
        let complete = true;
        for (const spec of MODULE_SPECS) {
          const pools = poolsBySection.get(spec.section)!;
          const items = assembleModule(spec, pools, totalStats);
          if (!items) {
            console.log(`  ${label}: cannot fill ${spec.section} module ${spec.module} (${spec.tier}) — series complete`);
            complete = false;
            break;
          }
          modules.push({ spec, items });
        }
        if (!complete) break;

        if (!DRY_RUN) {
          await client.query('BEGIN');
          try {
            const ins = await client.query<{ id: string }>(
              'INSERT INTO practice_tests (label, series, origin) VALUES ($1, $2, $3) RETURNING id',
              [label, def.series, def.origin],
            );
            const testId = ins.rows[0]!.id;
            for (const { spec, items } of modules) {
              const values: unknown[] = [];
              const tuples = items
                .map((item, i) => {
                  values.push(testId, item.source_id, spec.section, spec.module, spec.tier, i + 1);
                  const b = values.length - 5;
                  return `($${b}, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
                })
                .join(', ');
              await client.query(
                `INSERT INTO practice_test_questions (test_id, source_id, section, module, tier, position) VALUES ${tuples}`,
                values,
              );
            }
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK');
            throw err;
          }
        }
        built++;
        console.log(`  ${label}: 6 modules OK (${DRY_RUN ? 'dry run' : 'written'})`);
      }

      console.log(`  → ${built} ${def.series}-series tests ${DRY_RUN ? 'would be' : ''} built`);
      console.log(
        `  fallbacks: difficulty=${totalStats.difficultyFallbacks} domain=${totalStats.domainFallbacks} type=${totalStats.typeFallbacks}`,
      );
      console.log('  remaining inventory:');
      for (const section of ['reading-writing', 'math'] as const) {
        const p = poolsBySection.get(section)!;
        const lines = new Map<string, { d: Difficulty; t: string; n: number }[]>();
        for (const [k, v] of p.buckets) {
          const [dom, d, t] = k.split('|');
          const list = lines.get(dom!) ?? [];
          list.push({ d: Number(d) as Difficulty, t: t!, n: v.length });
          lines.set(dom!, list);
        }
        console.log(`    ${section}:`);
        for (const [dom, cells] of [...lines.entries()].sort()) {
          const cellStr = cells
            .sort((a, b) => a.d - b.d || a.t.localeCompare(b.t))
            .map((c) => `d${c.d}/${c.t}:${c.n}`)
            .join(' ');
          console.log(`      ${dom.padEnd(36)} ${cellStr}`);
        }
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`build:tests FAILED — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
