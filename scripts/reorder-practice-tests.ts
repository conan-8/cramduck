/**
 * reorder-practice-tests.ts — renumber `position` for every Reading & Writing
 * module in practice_test_questions to the canonical digital-SAT order:
 *
 *   1. vocab (words-in-context)
 *   2. reading comprehension: central-ideas-details, text-structure-purpose
 *      (underline-function), cross-text-connections, command-evidence-textual,
 *      inferences
 *   3. graphs (command-evidence-quantitative)
 *   4. standard conventions (boundaries, form-structure-sense)
 *   5. transitions
 *   6. notes (rhetorical-synthesis)
 *
 * Within a skill group, questions ramp easy → hard (difficulty asc), with the
 * previous position as a stable tiebreak. Math modules are untouched
 * (already easy → hard from the builder).
 *
 * Idempotent. Usage: tsx --env-file=.env scripts/reorder-practice-tests.ts [--dry-run]
 */
import { connectOrPending } from './lib/db.js';

/** Skill-group order for RW modules (index = sort key). Unknown skills land
 *  after the listed ones, preserving previous relative order. */
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

const skillRank = (skill: string): number => {
  const i = RW_SKILL_ORDER.indexOf(skill);
  return i === -1 ? RW_SKILL_ORDER.length : i;
};

const DRY_RUN = process.argv.includes('--dry-run');

interface Row {
  test_id: string;
  module: 1 | 2;
  tier: 'mixed' | 'easy' | 'hard';
  source_id: string;
  position: number;
  skill: string;
  difficulty_internal: number;
  label: string;
}

async function main(): Promise<void> {
  const client = await connectOrPending('reorder:practice-tests');
  try {
    const res = await client.query<Row>(`
      SELECT q.test_id, q.module, q.tier, q.source_id, q.position,
             h.skill, h.difficulty_internal, t.label
      FROM practice_test_questions q
      JOIN harvested_questions h ON h.source_id = q.source_id
      JOIN practice_tests t ON t.id = q.test_id
      WHERE q.section = 'reading-writing'
      ORDER BY t.label, q.module, q.tier, q.position
    `);
    console.log(`reorder: ${res.rows.length} RW rows across tests`);

    // group by module instance
    const groups = new Map<string, Row[]>();
    for (const r of res.rows) {
      const k = `${r.test_id}|${r.module}|${r.tier}`;
      const g = groups.get(k) ?? [];
      g.push(r);
      groups.set(k, g);
    }

    const updates: Array<{ test_id: string; source_id: string; module: number; tier: string; position: number }> = [];
    let reordered = 0;
    for (const rows of groups.values()) {
      const sorted = [...rows].sort(
        (a, b) =>
          skillRank(a.skill) - skillRank(b.skill) ||
          a.difficulty_internal - b.difficulty_internal ||
          a.position - b.position,
      );
      sorted.forEach((r, i) => {
        const newPos = i + 1;
        if (newPos !== r.position) reordered++;
        updates.push({ test_id: r.test_id, source_id: r.source_id, module: r.module, tier: r.tier, position: newPos });
      });
    }
    console.log(`reorder: ${reordered} of ${updates.length} rows change position`);

    if (DRY_RUN) {
      // sample: show one module's new order
      const sample = groups.get([...groups.keys()][0]!)!;
      const sorted = [...sample].sort(
        (a, b) =>
          skillRank(a.skill) - skillRank(b.skill) ||
          a.difficulty_internal - b.difficulty_internal ||
          a.position - b.position,
      );
      for (const r of sorted) {
        console.log(`  ${r.label} rw${r.module}/${r.tier}  Q${r.position} -> Q${sorted.indexOf(r) + 1}  ${r.skill} d${r.difficulty_internal}`);
      }
      return;
    }

    await client.query('BEGIN');
    try {
      // positions are 1..27 per (test, module, tier) — shift to a scratch
      // range first so the per-row UPDATEs never collide on the PK
      await client.query(
        `UPDATE practice_test_questions SET position = position + 1000 WHERE section = 'reading-writing'`,
      );
      for (const u of updates) {
        await client.query(
          `UPDATE practice_test_questions
           SET position = $5
           WHERE test_id = $1 AND source_id = $2 AND module = $3 AND tier = $4`,
          [u.test_id, u.source_id, u.module, u.tier, u.position],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    console.log('reorder: done');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`reorder FAILED — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
