import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';

export type JournalCategory = 'Personal' | 'Work' | 'Ideas' | 'Urgent';

export interface JournalRecord {
  id: string;
  title: string;
  audio_file_path: string;
  duration_ms: number;
  text_note: string;
  category: JournalCategory;
  is_favorite: number; // 1 = pinned/favorite, 0 = normal
  created_at: string;
  updated_at: string;
  playableUrl?: string;
}

@Injectable({
  providedIn: 'root',
})
export class JournalDatabase {
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db!: SQLiteDBConnection;
  private isInitialized = false;
  private readonly DB_NAME = 'secure_voice_journal_db';
  private webFallbackStore: JournalRecord[] = [];

  async connect(): Promise<void> {
    if (this.isInitialized) return;

    if (Capacitor.getPlatform() === 'web') {
      const saved = localStorage.getItem(this.DB_NAME);
      this.webFallbackStore = saved ? (JSON.parse(saved) as JournalRecord[]) : [];
      this.isInitialized = true;
      return;
    }

    try {
      const checkConn = await this.sqlite.isConnection(this.DB_NAME, false);
      this.db = checkConn.result
        ? await this.sqlite.retrieveConnection(this.DB_NAME, false)
        : await this.sqlite.createConnection(this.DB_NAME, false, 'no-encryption', 1, false);

      await this.db.open();

      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS journal_entries (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          audio_file_path TEXT NOT NULL,
          duration_ms INTEGER DEFAULT 0,
          text_note TEXT DEFAULT '',
          category TEXT DEFAULT 'Personal',
          is_favorite INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_journal_sort ON journal_entries(is_favorite DESC, created_at DESC);
      `);

      // Safe column migration if upgrading from v1 table
      await this.runSafeMigration('ALTER TABLE journal_entries ADD COLUMN category TEXT DEFAULT "Personal";');
      await this.runSafeMigration('ALTER TABLE journal_entries ADD COLUMN is_favorite INTEGER DEFAULT 0;');

      this.isInitialized = true;
    } catch (error) {
      console.error('SQLite Connection Error:', error);
    }
  }

  private async runSafeMigration(alterSql: string): Promise<void> {
    try {
      await this.db.execute(alterSql);
    } catch {
      // Column already exists; ignore safely
    }
  }

  // CREATE
  async insertEntry(record: JournalRecord): Promise<void> {
    if (Capacitor.getPlatform() === 'web') {
      this.webFallbackStore.unshift(record);
      this.saveWebStore();
      return;
    }

    const sql = `
      INSERT INTO journal_entries (
        id, title, audio_file_path, duration_ms, text_note, category, is_favorite, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;
    await this.db.run(sql, [
      record.id,
      record.title,
      record.audio_file_path,
      record.duration_ms,
      record.text_note,
      record.category,
      record.is_favorite,
      record.created_at,
      record.updated_at,
    ]);
  }

  // READ (Supports Search + Category + Favorites filtering)
  async queryEntries(searchTerm = '', categoryFilter = 'All'): Promise<JournalRecord[]> {
    const cleanSearch = searchTerm.trim().toLowerCase();

    if (Capacitor.getPlatform() === 'web') {
      return this.webFallbackStore
        .filter((item) => {
          const matchesSearch =
            !cleanSearch ||
            item.title.toLowerCase().includes(cleanSearch) ||
            item.text_note.toLowerCase().includes(cleanSearch);
          const matchesCategory =
            categoryFilter === 'All' ||
            (categoryFilter === 'Favorites' ? item.is_favorite === 1 : item.category === categoryFilter);
          return matchesSearch && matchesCategory;
        })
        .sort((a, b) => b.is_favorite - a.is_favorite || b.created_at.localeCompare(a.created_at));
    }

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (cleanSearch) {
      conditions.push('(LOWER(title) LIKE ? OR LOWER(text_note) LIKE ?)');
      params.push(`%${cleanSearch}%`, `%${cleanSearch}%`);
    }

    if (categoryFilter === 'Favorites') {
      conditions.push('is_favorite = 1');
    } else if (categoryFilter !== 'All') {
      conditions.push('category = ?');
      params.push(categoryFilter);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT id, title, audio_file_path, duration_ms, text_note, category, is_favorite, created_at, updated_at
      FROM journal_entries
      ${whereClause}
      ORDER BY is_favorite DESC, created_at DESC;
    `;

    const result = await this.db.query(sql, params);
    return (result.values as JournalRecord[]) || [];
  }

  // UPDATE (Title, Note, and Category)
  async updateEntryDetails(id: string, title: string, textNote: string, category: JournalCategory): Promise<void> {
    const updatedAt = new Date().toISOString();

    if (Capacitor.getPlatform() === 'web') {
      const target = this.webFallbackStore.find((item) => item.id === id);
      if (target) {
        target.title = title;
        target.text_note = textNote;
        target.category = category;
        target.updated_at = updatedAt;
        this.saveWebStore();
      }
      return;
    }

    const sql = `
      UPDATE journal_entries
      SET title = ?, text_note = ?, category = ?, updated_at = ?
      WHERE id = ?;
    `;
    await this.db.run(sql, [title, textNote, category, updatedAt, id]);
  }

  // UPDATE (Toggle Favorite Pin)
  async toggleFavorite(id: string, currentFavorite: number): Promise<void> {
    const nextValue = currentFavorite === 1 ? 0 : 1;
    const updatedAt = new Date().toISOString();

    if (Capacitor.getPlatform() === 'web') {
      const target = this.webFallbackStore.find((item) => item.id === id);
      if (target) {
        target.is_favorite = nextValue;
        target.updated_at = updatedAt;
        this.saveWebStore();
      }
      return;
    }

    const sql = `UPDATE journal_entries SET is_favorite = ?, updated_at = ? WHERE id = ?;`;
    await this.db.run(sql, [nextValue, updatedAt, id]);
  }

  // DELETE
  async deleteEntryById(id: string): Promise<void> {
    if (Capacitor.getPlatform() === 'web') {
      this.webFallbackStore = this.webFallbackStore.filter((item) => item.id !== id);
      this.saveWebStore();
      return;
    }

    const sql = `DELETE FROM journal_entries WHERE id = ?;`;
    await this.db.run(sql, [id]);
  }

  private saveWebStore(): void {
    localStorage.setItem(this.DB_NAME, JSON.stringify(this.webFallbackStore));
  }
}
