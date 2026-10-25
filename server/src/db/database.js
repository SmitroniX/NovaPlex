import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.NOVAPLEX_DB_PATH || path.join(DATA_DIR, 'novaplex.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

class DatabaseManager {
  constructor(dbPath = DB_PATH) {
    this.dbPath = dbPath;
    this.db = new DatabaseSync(this.dbPath);
    this.init();
  }

  init() {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    this.db.exec(schemaSql);

    this.seedDefaults();
  }

  seedDefaults() {
    // Seed default admin user if no users exist
    const userStmt = this.db.prepare('SELECT COUNT(*) as count FROM users');
    const userCount = userStmt.get().count;

    if (userCount === 0) {
      const insertUser = this.db.prepare(`
        INSERT INTO users (id, username, pin, is_admin, avatar)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertUser.run(
        'user-admin',
        'Home Owner',
        '1234',
        1,
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80'
      );
      insertUser.run(
        'user-family',
        'Family',
        '',
        0,
        'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&auto=format&fit=crop&q=80'
      );
    }

    // Seed default server settings
    const defaultSettings = [
      ['server_name', 'NovaPlex Apple Media Server'],
      ['transcode_default_quality', 'lossless'],
      ['hdr_tonemap_mode', 'auto'], // 'auto', 'force_hdr', 'force_sdr'
      ['tmdb_api_key', ''],
      ['media_scan_interval_minutes', '30'],
      ['gofile_token', process.env.GOFILE_TOKEN || ''],
      ['gofile_root_folder', process.env.GOFILE_ROOT_FOLDER || ''],
      ['gofile_keep_alive', 'true'],
      ['gofile_last_heartbeat', '']
    ];

    const getSetting = this.db.prepare('SELECT value FROM server_settings WHERE key = ?');
    const setSetting = this.db.prepare('INSERT INTO server_settings (key, value) VALUES (?, ?)');

    for (const [key, value] of defaultSettings) {
      if (!getSetting.get(key)) {
        setSetting.run(key, value);
      }
    }
  }

  queryAll(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  queryOne(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.get(...params);
  }

  run(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.run(...params);
  }

  transaction(callback) {
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const result = callback(this);
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  close() {
    this.db.close();
  }
}

// Singleton instance
export const db = new DatabaseManager();
export { DatabaseManager };
