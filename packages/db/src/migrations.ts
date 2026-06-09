import type { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "./schema.js";

/**
 * 迁移系统 —— 只进不退、增量改表。
 *
 * 规则（务必遵守，否则生产数据会丢）：
 *  1. 每条迁移有唯一递增 version；用 `PRAGMA user_version` 记录已应用到第几版。
 *  2. **已发布/已应用的迁移永不修改**。改表 = 追加一条新的 version+1 迁移。
 *  3. 迁移内容用增量操作（ALTER TABLE ADD COLUMN / CREATE TABLE IF NOT EXISTS /
 *     CREATE INDEX …），**禁止 DROP TABLE 后重建** 来"更新表结构"——那会清空数据。
 *  4. 每条迁移在一个事务内执行，失败整体回滚，user_version 不前进。
 *
 * 开发期改表示例：给 clips 加一列
 *   { version: 2, name: "clips_add_label",
 *     up: `ALTER TABLE clips ADD COLUMN label TEXT;` }
 */
export interface Migration {
  version: number;
  name: string;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "init",
    up: SCHEMA_SQL,
  },
  // ↓ 后续改表在此追加，version 严格递增；不要改动上面已存在的迁移
];

function getUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as
    | { user_version: number }
    | undefined;
  return row?.user_version ?? 0;
}

/** 应用所有未执行的迁移。幂等：已是最新则什么都不做。 */
export function migrate(db: DatabaseSync): { from: number; to: number } {
  const sorted = [...MIGRATIONS].sort((a, b) => a.version - b.version);

  // 基本校验：version 必须唯一且从 1 连续递增，避免漏写/重号
  sorted.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(
        `migration version 不连续：期望 ${i + 1}，实际 ${m.version} (${m.name})`,
      );
    }
  });

  const from = getUserVersion(db);
  const target = sorted.length;
  if (from > target) {
    throw new Error(
      `数据库版本(${from})高于代码已知的最新迁移(${target})。` +
        `可能是用旧代码打开了新库——拒绝降级以保护数据。`,
    );
  }

  for (const m of sorted) {
    if (m.version <= from) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.up);
      // version 来自受控的迁移列表(整数)，无注入风险
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
      console.log(`[db] migrated -> v${m.version} (${m.name})`);
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(
        `migration v${m.version} (${m.name}) 失败，已回滚：${String(e)}`,
      );
    }
  }

  return { from, to: target };
}
