import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
// Node 24+ 内置 SQLite，零原生依赖、零编译。本项目目标 Node ≥24。
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrations.js";

export type DB = DatabaseSync;

/**
 * 打开(或创建) SQLite 数据库，开启 WAL，并运行增量迁移。
 * 迁移只进不退、不覆盖数据；重复启动安全。
 * @param dbPath 例如 `${DATA_DIR}/app.db`
 */
export function openDb(dbPath: string): DB {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(dbPath);
  // 这些 PRAGMA 必须在事务外设置
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  migrate(db);
  return db;
}

export { migrate, MIGRATIONS } from "./migrations.js";
export { SCHEMA_SQL } from "./schema.js";
