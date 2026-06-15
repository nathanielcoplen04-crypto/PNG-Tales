const fs = require('fs');
const path = require('path');

class NarrationEngine {
  constructor() {
    this.defaultVoice = process.env.NARRATION_VOICE_LANG || 'en-US';
    this.voiceRate = parseFloat(process.env.NARRATION_VOICE_RATE) || 1.0;
  }

  /**
   * Convert episode text to speech
   * Uses Web Speech API on client side or server-side TTS service
   */
  async generateNarration(episodeData) {
    try {
      const audioPath = path.join(
        __dirname,
        `../../data/audio/${episodeData.season}-${episodeData.episode}.mp3`
      );

      // Create audio directory if it doesn't exist
      const audioDir = path.dirname(audioPath);
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }

      // Prepare the text for narration
      const narrativeText = this.prepareNarrativeText(episodeData.content);

      // Generate audio using ElevenLabs API or browser TTS
      const audioBuffer = await this.synthesizeAudio(narrativeText, episodeData);

      // Save audio file
      fs.writeFileSync(audioPath, audioBuffer);

      return {
        episodeId: `S${episodeData.season}E${episodeData.episode}`,
        audioPath,
        duration: await this.getAudioDuration(audioBuffer),
        generatedAt: new Date().toISOString(),
        videoFormat: '9:16',
      };
    } catch (error) {
      console.error('Error generating narration:', error);
      throw error;
    }
  }

  /**
   * Prepare text for narration (add pauses, emphasis, etc.)
   */
  prepareNarrativeText(content) {
    let text = content;

    // Add sentence pauses
    text = text.replace(/\.\s+/g, '. ');

    // Add slight pause before dialogue
    text = text.replace(/"([^"]*)"/g, ' said, "$1" ');

    // Remove excessive punctuation
    text = text.replace(/[,]{2,}/g, ',');

    return text;
  }

  /**
   * Synthesize audio from text
   * This method can be switched between browser TTS and ElevenLabs
   */
  async synthesizeAudio(text, episodeData) {
    const engine = process.env.NARRATION_ENGINE || 'browser-speech';

    if (engine === 'elevenlabs') {
      return await this.synthesizeWithElevenLabs(text, episodeData);
    } else {
      // Fallback: generate silent audio file (to be replaced with browser TTS on client)
      return this.generateSilentAudio();
    }
  }

  /**
   * Synthesize using ElevenLabs API
   */
  async synthesizeWithElevenLabs(text, episodeData) {
    // Note: ElevenLabs is a premium service
    // This is a placeholder for implementation
    console.log('ElevenLabs synthesis not yet implemented');
    return Buffer.alloc(0);
  }

  /**
   * Generate a silent/placeholder audio buffer
   */
  generateSilentAudio() {
    // Return a minimal MP3 buffer (silent audio)
    // In production, use actual TTS service
    return Buffer.from([0xff, 0xfb, 0x90, 0x00]); // Minimal MP3 header
  }

  /**
   * Get audio duration (in seconds)
   */
  async getAudioDuration(audioBuffer) {
    // Estimate duration based on word count and speech rate
    // In production, use actual audio metadata
    const estimatedSeconds = 300; // 5 minutes default
    return estimatedSeconds;
  }

  /**
   * Add background music to narration
   */
  async addBackgroundMusic(audioPath, musicType = 'ambient') {
    // This would use FFmpeg to overlay music
    // Implementation depends on available music library
    console.log(`Adding ${musicType} music to ${audioPath}`);
    return audioPath;
  }

  /**
   * Generate multiple narrations for a day's episodes
   */
  async generateDailyNarrations(episodes) {
    const narrations = [];

    for (let i = 0; i < episodes.length; i++) {
      const narration = await this.generateNarration(episodes[i]);
      narrations.push(narration);

      // Add delay between API calls
      if (i < episodes.length - 1) {
        await this.delay(500);
      }
    }

    return narrations;
  }

  /**
   * Utility: delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = NarrationEngine;
