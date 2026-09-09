'use strict';

/**
 * Captures the stored placement layer.
 *
 * Read-only: it issues SELECT statements against the QA database and writes a
 * JSON capture file. Nothing is updated, normalised or rounded — the raw TEXT
 * column is preserved alongside the parsed values so a later diff can prove the
 * bytes did not move either.
 *
 * Usage: node tools/capture-stored.js [outfile]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  CONTROL_ENGINE_VERSION, CONTROL_COMMIT, IMPLIED_SCALE,
  parseStoredPosition, parseStoredRotation,
} = require('../lib/contract');

const CONTAINER = process.env.CTR_QA_DB_CONTAINER || 'xite162qa-db-1';
const DATABASE = process.env.CTR_QA_DB_NAME || 'cybertown';
const OUT = process.argv[2] || path.join(__dirname, '..', 'baselines', 'stored-15.1.12.json');

const QUERY = `
SELECT 'object_instance' AS source, oi.id, oi.object_id, oi.member_id, oi.place_id,
       p.type AS place_type, p.slug AS place_slug, o.directory, o.filename,
       oi.position, oi.rotation, oi.created_at
  FROM object_instance oi
  JOIN object o ON o.id = oi.object_id
  JOIN place  p ON p.id = oi.place_id
 WHERE oi.place_id <> 0
UNION ALL
SELECT 'mall_object' AS source, mo.id, mo.object_id, NULL, mo.place_id,
       p.type, p.slug, o.directory, o.filename,
       mo.position, mo.rotation, mo.created_at
  FROM mall_object mo
  JOIN object o ON o.id = mo.object_id
  JOIN place  p ON p.id = mo.place_id
 ORDER BY 1, 2;
`;

function query(sql) {
  const out = execFileSync('docker', [
    'exec', '-i', CONTAINER, 'sh', '-c',
    `mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --batch --raw ${DATABASE}`,
  ], { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const rows = out.trim().split('\n');
  const header = rows.shift().split('\t');
  return rows.map(row => {
    const cells = row.split('\t');
    const record = {};
    header.forEach((name, i) => {
      record[name] = cells[i] === 'NULL' ? null : cells[i];
    });
    return record;
  });
}

const records = query(QUERY).map(row => ({
  source: row.source,
  id: Number(row.id),
  stored: {
    placeId: Number(row.place_id),
    placeType: row.place_type,
    placeSlug: row.place_slug,
    objectId: Number(row.object_id),
    memberId: row.member_id === null ? null : Number(row.member_id),
    url: `/assets/object/${row.directory}/${row.filename}`,
    position: parseStoredPosition(row.position),
    rotation: parseStoredRotation(row.rotation),
    rawPosition: row.position,
    rawRotation: row.rotation,
    createdAt: row.created_at,
  },
  impliedScale: IMPLIED_SCALE,
}));

const capture = {
  layer: 'stored',
  // The stored layer is database-only, but the label has to match the run it
  // belongs to, or a comparison reports the control version against itself.
  engine: process.env.CTR_QA_ENGINE || CONTROL_ENGINE_VERSION,
  commit: CONTROL_COMMIT,
  database: DATABASE,
  capturedAt: new Date().toISOString(),
  records,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(capture, null, 2)}\n`);
console.log(`wrote ${OUT}: ${records.length} stored placement records`);
