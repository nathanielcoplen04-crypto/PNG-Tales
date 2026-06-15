const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

class StoryGenerator {
  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.storyMemoryPath = path.join(__dirname, '../database/story-memory.json');
    this.charactersPath = path.join(__dirname, '../database/characters.json');
    this.locationsPath = path.join(__dirname, '../database/locations.json');
  }

  /**
   * Generate a new episode for a storyline
   */
  async generateEpisode(season, episode, storylineName, previousContext = {}) {
    try {
      // Load story memory to maintain consistency
      const storyMemory = this.loadStoryMemory();
      const characters = this.loadCharacters();
      const locations = this.loadLocations();

      // Build context for the AI
      const context = this.buildContext(
        season,
        episode,
        storylineName,
        characters,
        locations,
        previousContext
      );

      // Generate episode content
      const prompt = this.createPrompt(season, episode, storylineName, context);

      const response = await this.client.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: `You are a master storyteller creating fictional Papua New Guinea-inspired fantasy stories. 
Create engaging, family-friendly episodes with vivid descriptions and compelling narratives.
Each episode should be 400-600 words, designed to be read aloud in approximately 3 minutes.
Always end with a cliffhanger to encourage listeners to continue to the next episode.
Include character development, world-building, and emotional depth.
Format the story to work well in a vertical 9:16 video format (think of it being displayed on a mobile screen).
Keep pacing fast to maintain engagement in the shorter 3-minute format.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.8,
        max_tokens: 900,
        top_p: 0.95,
      });

      const episodeContent = response.choices[0].message.content;

      // Parse and structure the episode
      const episodeData = {
        season,
        episode,
        storyline: storylineName,
        content: episodeContent,
        wordCount: episodeContent.split(' ').length,
        generatedAt: new Date().toISOString(),
        characters: this.extractCharacters(episodeContent),
        locations: this.extractLocations(episodeContent),
        videoFormat: '9:16',
        resolution: '1080x1920',
        duration: 180, // 3 minutes in seconds
      };

      // Save to memory
      this.saveEpisodeToMemory(episodeData);

      return episodeData;
    } catch (error) {
      console.error('Error generating episode:', error);
      throw error;
    }
  }

  /**
   * Generate multiple episodes for a day
   */
  async generateDailyEpisodes(day, season, startEpisode = 1) {
    const episodes = [];
    const dailyCount = parseInt(process.env.DAILY_EPISODES_COUNT) || 10;

    for (let i = 0; i < dailyCount; i++) {
      const episodeNum = startEpisode + i;
      const previousContext = episodes[i - 1] || {};

      const episode = await this.generateEpisode(
        season,
        episodeNum,
        `Storyline-${this.getCurrentStoryline()}`,
        previousContext
      );

      episodes.push(episode);

      // Add a small delay between API calls
      if (i < dailyCount - 1) {
        await this.delay(1000);
      }
    }

    return episodes;
  }

  /**
   * Create the prompt for story generation
   */
  createPrompt(season, episode, storylineName, context) {
    const categories = (process.env.STORY_CATEGORIES || '').split(',');
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];

    return `
Write Episode ${episode} of Season ${season} for the story "${storylineName}".

Story Category: ${randomCategory}

Context Information:
- Main Character: ${context.mainCharacter || 'To be determined'}
- Setting: ${context.location || 'PNG-inspired fantasy realm'}
- Previous Episode Summary: ${context.previousSummary || 'This is the first episode'}
- Active Conflicts: ${context.activeConflicts || 'Setting up the main conflict'}
- Known Characters: ${context.knownCharacters || 'Introduce main characters'}

Requirements:
1. Length: 400-600 words
2. Reading time: ~3 minutes when read aloud
3. Opening Hook: Start with something compelling within the first 30 seconds
4. Main Conflict: Include danger, mystery, romance, or betrayal
5. Story Flow: Maintain continuity with previous episodes
6. Cliffhanger Ending: End with an unresolved question or major event
7. Tone: Engaging, immersive, and suitable for all ages
8. Voice: Third-person narrative with vivid descriptions
9. Format: Optimized for vertical 9:16 video format (mobile screens)
10. Pacing: Fast-moving narrative to maintain engagement on short-form video
11. Dialogue: Include character dialogue to break up narration
12. Action: Keep action-packed and dramatic for quick retention

Write the episode now:
`;
  }

  /**
   * Build context from story memory
   */
  buildContext(season, episode, storylineName, characters, locations, previousContext) {
    return {
      mainCharacter: characters[0]?.name || 'Unknown Hero',
      location: locations[0]?.name || 'PNG Fantasy Realm',
      previousSummary: previousContext.summary || '',
      activeConflicts: this.getActiveConflicts(season),
      knownCharacters: characters.slice(0, 5).map(c => c.name).join(', '),
    };
  }

  /**
   * Get active conflicts based on season
   */
  getActiveConflicts(season) {
    const conflicts = {
      1: 'Discovering hidden powers and facing initial threats',
      2: 'Building alliances and uncovering a larger conspiracy',
      3: 'Major confrontation with the first villain',
      4: 'Unexpected betrayal and new revelations',
      5: 'Leadership challenges and growing responsibilities',
      6: 'The rise of the main antagonist',
      7: 'Internal conflicts and sacrifices',
      8: 'Gathering forces for the final battle',
      9: 'Strategic warfare and key reversals',
      10: 'Final confrontation and ultimate destiny',
    };
    return conflicts[season] || 'Ongoing struggles and growth';
  }

  /**
   * Extract mentioned characters from episode
   */
  extractCharacters(content) {
    // Simple extraction - can be enhanced with NLP
    const characterPatterns = /(?:The|A|Our)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;
    const matches = content.matchAll(characterPatterns);
    return [...new Set([...matches].map(m => m[1]))].slice(0, 10);
  }

  /**
   * Extract mentioned locations from episode
   */
  extractLocations(content) {
    // Simple extraction - can be enhanced
    const locationPatterns = /(?:in|at|from)\s+([A-Z][a-z]+(?:\s+(?:Valley|Mountain|River|Forest|Cave|Temple))?)/g;
    const matches = content.matchAll(locationPatterns);
    return [...new Set([...matches].map(m => m[1]))].slice(0, 5);
  }

  /**
   * Load story memory
   */
  loadStoryMemory() {
    try {
      if (fs.existsSync(this.storyMemoryPath)) {
        const data = fs.readFileSync(this.storyMemoryPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading story memory:', error);
    }
    return {};
  }

  /**
   * Load characters database
   */
  loadCharacters() {
    try {
      if (fs.existsSync(this.charactersPath)) {
        const data = fs.readFileSync(this.charactersPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading characters:', error);
    }
    return [];
  }

  /**
   * Load locations database
   */
  loadLocations() {
    try {
      if (fs.existsSync(this.locationsPath)) {
        const data = fs.readFileSync(this.locationsPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading locations:', error);
    }
    return [];
  }

  /**
   * Save episode to story memory
   */
  saveEpisodeToMemory(episodeData) {
    try {
      const memory = this.loadStoryMemory();
      if (!memory.episodes) {
        memory.episodes = [];
      }
      memory.episodes.push(episodeData);
      fs.writeFileSync(this.storyMemoryPath, JSON.stringify(memory, null, 2));
    } catch (error) {
      console.error('Error saving episode to memory:', error);
    }
  }

  /**
   * Get current storyline number
   */
  getCurrentStoryline() {
    // This can be enhanced to track storylines
    return 1;
  }

  /**
   * Utility: delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = StoryGenerator;
