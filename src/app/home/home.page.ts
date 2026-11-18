import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject, NgZone, type OnDestroy, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Preferences } from '@capacitor/preferences';
import {
  IonAlert,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonChip,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonTextarea,
  IonTitle,
  IonToast,
  IonToolbar,
} from '@ionic/angular';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { addIcons } from 'ionicons';
import {
  checkmark,
  close,
  contrast,
  createOutline,
  fingerPrint,
  lockClosed,
  mic,
  micOutline,
  pause,
  play,
  shareSocialOutline,
  star,
  starOutline,
  trashOutline,
} from 'ionicons/icons';

import { type JournalCategory, type JournalRecord } from '../database/journal.db';
import { AuthService } from '../services/auth.service';
import { JournalService } from '../services/journal.service';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonAlert,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonChip,
    IonContent,
    IonHeader,
    IonIcon,
    IonInput,
    IonItem,
    IonLabel,
    IonSearchbar,
    IonSegment,
    IonSegmentButton,
    IonTextarea,
    IonTitle,
    IonToast,
    IonToolbar,
  ],
})
export class HomePage implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private journalService = inject(JournalService);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  // Navigation View
  activeTab: 'record' | 'logs' = 'record';

  // Security & Lock State (Runs on initial app startup only)
  isUnlocked = false;
  hasPinSet = false;
  pinInput = '';
  pinError = '';

  // Recording Studio State
  isRecording = false;
  isPaused = false;
  isBusy = false;
  recordingSeconds = 0;
  newEntryTitle = '';
  newEntryDescription = '';
  selectedNewCategory: JournalCategory = 'Personal';

  // Saved Logs & Natural Edit Modal State
  entries: JournalRecord[] = [];
  searchQuery = '';
  activeFilter = 'All';
  isDarkMode = false;
  editingEntry: JournalRecord | null = null;
  editTitle = '';
  editDescription = '';
  editCategory: JournalCategory = 'Personal';

  readonly categories: JournalCategory[] = ['Personal', 'Work', 'Ideas', 'Urgent'];
  readonly filterTabs = ['All', 'Favorites', 'Personal', 'Work', 'Ideas', 'Urgent'];

  // Native Toast & Delete Confirmation Alert State
  toastMessage = '';
  isToastOpen = false;
  entryPendingDelete: JournalRecord | null = null;
  readonly deleteAlertButtons = [
    {
      text: 'Cancel',
      role: 'cancel',
      handler: (): void => {
        this.entryPendingDelete = null;
      },
    },
    {
      text: 'Delete',
      role: 'destructive',
      handler: (): void => {
        void this.confirmDeleteEntry();
      },
    },
  ];

  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private recordingStartTime = 0;
  private accumulatedMs = 0;
  private hasMicPermission = false;
  private currentlyPlayingAudio: HTMLAudioElement | null = null;

  constructor() {
    addIcons({
      checkmark,
      close,
      contrast,
      createOutline,
      fingerPrint,
      lockClosed,
      mic,
      micOutline,
      pause,
      play,
      shareSocialOutline,
      star,
      starOutline,
      trashOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      await this.loadThemePreference();
    } catch (e) {
      console.error('Theme load error:', e);
    }

    try {
      await this.authService.enablePrivacyScreen();
    } catch (e) {
      console.error('Privacy screen error:', e);
    }

    try {
      await this.journalService.initialize();
    } catch (e) {
      console.error('Journal DB init error:', e);
    }

    try {
      const perm = await VoiceRecorder.hasAudioRecordingPermission();
      this.hasMicPermission = perm.value;
    } catch {
      this.hasMicPermission = false;
    }

    try {
      const configured = await this.authService.hasConfiguredPin();
      this.ngZone.run(() => {
        this.hasPinSet = configured;
        this.cdr.detectChanges();
      });

      if (configured) {
        await this.unlockWithBiometrics();
      }
    } catch (e) {
      console.error('Auth init error:', e);
      this.ngZone.run(() => {
        this.hasPinSet = false;
        this.cdr.detectChanges();
      });
    }
  }

  ngOnDestroy(): void {
    this.stopTimer();
    this.stopActiveAudio();
  }

  switchTab(tab: string): void {
    if (tab === 'record' || tab === 'logs') {
      if (tab === 'record') {
        this.stopActiveAudio();
      }
      this.activeTab = tab;
      this.cdr.detectChanges();
    }
  }

  // SECURITY & LOCK METHODS (AUTO-SUBMIT ON 4TH DIGIT)
  async onPinDigitInput(value: string): Promise<void> {
    const cleaned = (value || '').replace(/\D/g, '').slice(0, 4);
    this.pinInput = cleaned;
    this.pinError = '';

    if (cleaned.length === 4) {
      if (!this.hasPinSet) {
        await this.setupInitialPin();
      } else {
        await this.unlockWithPin();
      }
    }
  }

  async setupInitialPin(): Promise<void> {
    if (!/^\d{4}$/.test(this.pinInput)) {
      this.pinError = 'Enter a valid 4-digit numeric PIN.';
      return;
    }
    await this.authService.savePin(this.pinInput);
    this.ngZone.run(() => {
      this.hasPinSet = true;
      this.pinInput = '';
      this.pinError = '';
    });
    await this.completeUnlock();
    this.showToast('PIN saved & Journal unlocked.');
  }

  async unlockWithPin(): Promise<void> {
    const valid = await this.authService.verifyPin(this.pinInput);
    if (!valid) {
      this.ngZone.run(() => {
        this.pinError = 'Incorrect PIN. Try again.';
        this.pinInput = '';
        this.cdr.detectChanges();
      });
      return;
    }
    this.ngZone.run(() => {
      this.pinInput = '';
      this.pinError = '';
    });
    await this.completeUnlock();
  }

  async unlockWithBiometrics(): Promise<void> {
    this.ngZone.run(() => {
      this.pinError = '';
      this.cdr.detectChanges();
    });

    try {
      const verified = await this.authService.authenticateBiometric();
      if (verified) {
        await this.completeUnlock();
      } else {
        this.ngZone.run(() => {
          this.pinError = 'Biometric unavailable or canceled. Enter your 4-digit PIN.';
          this.cdr.detectChanges();
        });
      }
    } catch {
      this.ngZone.run(() => {
        this.pinError = 'Biometric failed. Ensure fingerprint/face is enrolled or enter PIN.';
        this.cdr.detectChanges();
      });
    }
  }

  private async completeUnlock(): Promise<void> {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    this.ngZone.run(() => {
      this.isUnlocked = true;
      this.pinError = '';
      this.pinInput = '';
      this.cdr.detectChanges();
    });

    try {
      await this.loadEntries();
    } catch (e) {
      console.error('Load entries error:', e);
    }
  }

  // START RECORDING
  async startNewRecording(event?: Event): Promise<void> {
    event?.stopPropagation();
    if (this.isRecording || this.isBusy) return;

    this.stopActiveAudio();

    if (!this.hasMicPermission) {
      const permission = await VoiceRecorder.requestAudioRecordingPermission();
      this.hasMicPermission = permission.value;
      if (!this.hasMicPermission) {
        this.showToast('Microphone permission is required.');
        return;
      }
    }

    this.ngZone.run(() => {
      this.isBusy = true;
      this.isRecording = true;
      this.isPaused = false;
      this.startTimer();
      this.cdr.detectChanges();
    });

    try {
      await VoiceRecorder.startRecording();
    } catch (error) {
      console.error('Start recording error:', error);
      this.ngZone.run(() => {
        this.isRecording = false;
        this.isPaused = false;
        this.stopTimer();
        this.cdr.detectChanges();
      });
      this.showToast('Could not start microphone.');
    } finally {
      this.ngZone.run(() => {
        this.isBusy = false;
        this.cdr.detectChanges();
      });
    }
  }

  async stopAndSaveRecording(event?: Event): Promise<void> {
    event?.stopPropagation();
    if (!this.isRecording || this.isBusy) return;

    const finalMs = this.accumulatedMs + (this.isPaused ? 0 : Date.now() - this.recordingStartTime);
    const durationMs = Math.max(1000, finalMs);

    this.ngZone.run(() => {
      this.isBusy = true;
      this.isRecording = false;
      this.isPaused = false;
      this.stopTimer();
      this.cdr.detectChanges();
    });

    try {
      const result = await VoiceRecorder.stopRecording();

      if (result.value?.recordDataBase64) {
        await this.journalService.createVoiceLog(
          result.value.recordDataBase64,
          durationMs,
          this.selectedNewCategory,
          this.newEntryTitle,
          this.newEntryDescription
        );
        this.ngZone.run(() => {
          this.newEntryTitle = '';
          this.newEntryDescription = '';
          this.activeTab = 'logs';
          this.cdr.detectChanges();
        });
        await this.loadEntries();
        this.showToast('Voice log saved securely.');
      }
    } catch (error) {
      console.error('Stop recording error:', error);
      this.showToast('Error saving recording.');
    } finally {
      this.ngZone.run(() => {
        this.isBusy = false;
        this.cdr.detectChanges();
      });
    }
  }

  async togglePauseResume(event?: Event): Promise<void> {
    event?.stopPropagation();
    if (!this.isRecording || this.isBusy) return;

    if (!this.isPaused) {
      this.ngZone.run(() => {
        this.isPaused = true;
        this.pauseTimer();
        this.cdr.detectChanges();
      });
      await VoiceRecorder.pauseRecording();
    } else {
      this.ngZone.run(() => {
        this.isPaused = false;
        this.resumeTimer();
        this.cdr.detectChanges();
      });
      await VoiceRecorder.resumeRecording();
    }
  }

  // SINGLE PLAY AUDIO
  onAudioPlay(event?: Event): void {
    event?.stopPropagation();
    const targetAudio = event?.target as HTMLAudioElement | null;
    if (!targetAudio) return;

    if (this.currentlyPlayingAudio && this.currentlyPlayingAudio !== targetAudio) {
      this.currentlyPlayingAudio.pause();
      this.currentlyPlayingAudio.currentTime = 0;
    }

    this.currentlyPlayingAudio = targetAudio;
  }

  onAudioEndedOrPaused(event?: Event): void {
    event?.stopPropagation();
    const targetAudio = event?.target as HTMLAudioElement | null;
    if (targetAudio && this.currentlyPlayingAudio === targetAudio) {
      this.currentlyPlayingAudio = null;
    }
  }

  private stopActiveAudio(): void {
    if (this.currentlyPlayingAudio) {
      this.currentlyPlayingAudio.pause();
      this.currentlyPlayingAudio.currentTime = 0;
      this.currentlyPlayingAudio = null;
    }
  }

  // --- CRUD, NATURAL EDIT MODAL, SEARCH & SHARE
  async loadEntries(): Promise<void> {
    const logs = await this.journalService.searchVoiceLogs(this.searchQuery, this.activeFilter);
    this.ngZone.run(() => {
      this.entries = logs;
      this.cdr.detectChanges();
    });
  }

  async onSearchChange(value: string): Promise<void> {
    this.searchQuery = value || '';
    await this.loadEntries();
  }

  async selectFilter(filter: string): Promise<void> {
    this.activeFilter = filter;
    await this.loadEntries();
  }

  openEditModal(entry: JournalRecord): void {
    this.editingEntry = entry;
    this.editTitle = entry.title;
    this.editDescription = entry.text_note;
    this.editCategory = entry.category;
  }

  closeEditModal(): void {
    this.editingEntry = null;
  }

  async saveEditedEntry(): Promise<void> {
    if (!this.editingEntry) return;
    await this.journalService.updateVoiceEntry(
      this.editingEntry.id,
      this.editTitle,
      this.editDescription,
      this.editCategory
    );
    this.editingEntry = null;
    await this.loadEntries();
    this.showToast('Changes saved.');
  }

  async toggleFavorite(entry: JournalRecord): Promise<void> {
    await this.journalService.toggleFavoriteEntry(entry);
    await this.loadEntries();
  }

  requestDeleteEntry(entry: JournalRecord): void {
    this.entryPendingDelete = entry;
  }

  private async confirmDeleteEntry(): Promise<void> {
    if (!this.entryPendingDelete) return;
    this.stopActiveAudio();
    await this.journalService.deleteVoiceLog(
      this.entryPendingDelete.id,
      this.entryPendingDelete.audio_file_path
    );
    this.entryPendingDelete = null;
    await this.loadEntries();
    this.showToast('Voice log deleted.');
  }

  async shareEntry(entry: JournalRecord): Promise<void> {
    try {
      await this.journalService.shareVoiceEntry(entry);
    } catch {
      this.showToast('Unable to share entry on this device.');
    }
  }

  // THEME DARK MODE, NIGHT MODE
  async toggleDarkMode(): Promise<void> {
    this.isDarkMode = !this.isDarkMode;
    this.applyTheme(this.isDarkMode);
    await Preferences.set({ key: 'journal_dark_mode', value: String(this.isDarkMode) });
    this.showToast(this.isDarkMode ? 'Dark mode enabled' : 'Light mode enabled');
  }

  private async loadThemePreference(): Promise<void> {
    const { value } = await Preferences.get({ key: 'journal_dark_mode' });
    this.isDarkMode = value === 'true';
    this.applyTheme(this.isDarkMode);
  }

  private applyTheme(enableDark: boolean): void {
    const htmlEl = document.documentElement;
    if (enableDark) {
      htmlEl.classList.add('ion-palette-dark');
      htmlEl.style.colorScheme = 'dark';
    } else {
      htmlEl.classList.remove('ion-palette-dark');
      htmlEl.style.colorScheme = 'light';
    }
  }

  showToast(message: string): void {
    this.ngZone.run(() => {
      this.toastMessage = message;
      this.isToastOpen = true;
      this.cdr.detectChanges();
    });
  }

  // DRIFT-FREE WALL-CLOCK TIMER
  private startTimer(): void {
    this.accumulatedMs = 0;
    this.recordingSeconds = 0;
    this.resumeTimer();
  }

  private resumeTimer(): void {
    this.clearIntervalOnly();
    this.recordingStartTime = Date.now();
    this.timerInterval = setInterval(() => {
      const totalMs = this.accumulatedMs + (Date.now() - this.recordingStartTime);
      const nextSeconds = Math.floor(totalMs / 1000);
      if (nextSeconds !== this.recordingSeconds) {
        this.ngZone.run(() => {
          this.recordingSeconds = nextSeconds;
          this.cdr.detectChanges();
        });
      }
    }, 250);
  }

  private pauseTimer(): void {
    this.accumulatedMs += Date.now() - this.recordingStartTime;
    this.clearIntervalOnly();
  }

  private stopTimer(): void {
    this.clearIntervalOnly();
    this.accumulatedMs = 0;
    this.recordingSeconds = 0;
  }

  private clearIntervalOnly(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  formatDurationFromMs(ms: number): string {
    return this.formatDuration(Math.max(1, Math.round(ms / 1000)));
  }
}
