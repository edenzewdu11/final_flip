let useAudioPlayer = null;
let AudioModule = null;
try {
  const expoAudio = require('expo-audio');
  useAudioPlayer = expoAudio.useAudioPlayer;
  AudioModule = expoAudio;
} catch (e) {
  console.warn('expo-audio not available, sounds disabled');
}

const SOUNDS = {
  coin: require('../../assets/coin.mp3'),
  notification: require('../../assets/notfication.mp3'),
};

class SoundManager {
  constructor() {
    this.players = {};
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized || !AudioModule) return;
    
    try {
      for (const [key, source] of Object.entries(SOUNDS)) {
        const player = AudioModule.createAudioPlayer(source);
        this.players[key] = player;
      }
      
      this.isInitialized = true;
    } catch (error) {
      console.warn('Sound initialization failed:', error);
    }
  }

  async playSound(soundName) {
    if (!AudioModule) return;
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    try {
      const player = this.players[soundName];
      if (player) {
        player.seekTo(0);
        player.play();
      }
    } catch (error) {
      console.warn(`Failed to play sound ${soundName}:`, error);
    }
  }

  async playNotificationSound() {
    await this.playSound('notification');
  }

  async playCoinSound() {
    await this.playSound('coin');
  }

  async cleanup() {
    for (const player of Object.values(this.players)) {
      try { player.release(); } catch {}
    }
    this.players = {};
    this.isInitialized = false;
  }
}

export default new SoundManager();
