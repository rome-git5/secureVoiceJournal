import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

import { type JournalCategory, JournalDatabase, type JournalRecord } from '../database/journal.db';

@Injectable({
  providedIn: 'root',
})
export class JournalService {
  private db = inject(JournalDatabase);

  async initialize(): Promise<void> {
    await this.db.connect();
  }

  async createVoiceLog(
    base64Audio: string,
    durationMs: number,
    category: JournalCategory = 'Personal',
    customTitle = '',
    textNote = ''
  ): Promise<void> {
    const id = Date.now().toString();
    const fileName = `voice_${id}.aac`;
    const now = new Date().toISOString();
    const formattedDate = new Date().toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    await Filesystem.writeFile({
      path: fileName,
      data: base64Audio,
      directory: Directory.Data,
    });

    const finalTitle = customTitle.trim() || `Voice Note • ${formattedDate}`;

    const newRecord: JournalRecord = {
      id,
      title: finalTitle,
      audio_file_path: fileName,
      duration_ms: durationMs,
      text_note: textNote.trim(),
      category,
      is_favorite: 0,
      created_at: now,
      updated_at: now,
    };

    await this.db.insertEntry(newRecord);
  }

  async searchVoiceLogs(searchTerm = '', categoryFilter = 'All'): Promise<JournalRecord[]> {
    const records = await this.db.queryEntries(searchTerm, categoryFilter);
    for (const record of records) {
      record.playableUrl = await this.resolveAudioUri(record.audio_file_path);
    }
    return records;
  }

  async updateVoiceEntry(id: string, title: string, note: string, category: JournalCategory): Promise<void> {
    const cleanTitle = title.trim() || 'Untitled Voice Note';
    await this.db.updateEntryDetails(id, cleanTitle, note.trim(), category);
  }

  async toggleFavoriteEntry(entry: JournalRecord): Promise<void> {
    await this.db.toggleFavorite(entry.id, entry.is_favorite);
  }

  async deleteVoiceLog(id: string, fileName: string): Promise<void> {
    try {
      await Filesystem.deleteFile({ path: fileName, directory: Directory.Data });
    } catch {
      // File already deleted
    }
    await this.db.deleteEntryById(id);
  }

  async shareVoiceEntry(entry: JournalRecord): Promise<void> {
    if (Capacitor.getPlatform() === 'web') {
      await Share.share({
        title: entry.title,
        text: `${entry.title} [${entry.category}]\n\n${entry.text_note || 'No description attached.'}`,
      });
      return;
    }

    const fileUri = await Filesystem.getUri({
      path: entry.audio_file_path,
      directory: Directory.Data,
    });

    await Share.share({
      title: entry.title,
      text: `${entry.title} [${entry.category}]\n${entry.text_note || ''}`,
      url: fileUri.uri,
      dialogTitle: 'Export Voice Log',
    });
  }

  private async resolveAudioUri(fileName: string): Promise<string> {
    try {
      const file = await Filesystem.readFile({
        path: fileName,
        directory: Directory.Data,
      });
      const base64Data = typeof file.data === 'string' ? file.data : '';
      if (base64Data) {
        const mime = Capacitor.getPlatform() === 'web' ? 'audio/webm' : 'audio/aac';
        return base64Data.startsWith('data:') ? base64Data : `data:${mime};base64,${base64Data}`;
      }
    } catch {
      // Fallback to native file URI
    }

    if (Capacitor.getPlatform() !== 'web') {
      const uriResult = await Filesystem.getUri({ path: fileName, directory: Directory.Data });
      return Capacitor.convertFileSrc(uriResult.uri);
    }

    return '';
  }
}
