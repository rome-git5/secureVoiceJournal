import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { PrivacyScreen } from '@capacitor-community/privacy-screen';
import { NativeBiometric } from 'capacitor-native-biometric';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly PIN_KEY = 'journal_security_pin';

  async enablePrivacyScreen(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await PrivacyScreen.enable();
    } catch (error) {
      console.warn('PrivacyScreen skipped:', error);
    }
  }

  async hasConfiguredPin(): Promise<boolean> {
    try {
      const { value } = await Preferences.get({ key: this.PIN_KEY });
      return Boolean(value && /^\d{4}$/.test(value));
    } catch {
      return false;
    }
  }

  async savePin(pin: string): Promise<void> {
    await Preferences.set({ key: this.PIN_KEY, value: pin });
  }

  async verifyPin(pin: string): Promise<boolean> {
    try {
      const { value } = await Preferences.get({ key: this.PIN_KEY });
      return value === pin;
    } catch {
      return false;
    }
  }

  async authenticateBiometric(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    try {
      const availability = await NativeBiometric.isAvailable();
      if (!availability.isAvailable) {
        return false;
      }

      await NativeBiometric.verifyIdentity({
        reason: 'Unlock Voice Journal',
        title: 'Biometric Authentication',
        subtitle: 'Verify your fingerprint or face',
        description: 'Authenticate to open your voice journal',
      });

      return true;
    } catch (error) {
      console.warn('Biometric authentication failed or canceled:', error);
      return false;
    }
  }
}
