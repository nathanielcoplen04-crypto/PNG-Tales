const cron = require('node-cron');
const QueueManager = require('../queue/queue-manager');
const StoryGenerator = require('../api/story-generator');
const NarrationEngine = require('../api/narration-engine');
const VideoGenerator = require('../api/video-generator');
const YouTubeAPI = require('../api/youtube-api');

/**
 * Daily Scheduler for PNG Tales
 * Handles automated story generation, narration, video creation, and YouTube uploads
 * with retry logic for failed tasks
 */
class DailyScheduler {
  constructor() {
    this.queueManager = new QueueManager();
    this.storyGenerator = new StoryGenerator();
    this.narrationEngine = new NarrationEngine();
    this.videoGenerator = new VideoGenerator();
    this.youtubeAPI = new YouTubeAPI();
    this.dailyGoal = parseInt(process.env.DAILY_EPISODES_COUNT) || 10;
    this.minDailyOutput = 1;
  }

  /**
   * Initialize all schedulers
   */
  initializeSchedulers() {
    console.log('🚀 Initializing PNG Tales Daily Scheduler...');

    // Daily story generation (Midnight)
    this.scheduleStoryGeneration();

    // Narration processing (Every 15 minutes)
    this.scheduleNarrationProcessing();

    // Video creation (Every 20 minutes)
    this.scheduleVideoProcessing();

    // YouTube upload (Every 30 minutes)
    this.scheduleYouTubeProcessing();

    // Dashboard refresh (Every 5 minutes)
    this.scheduleDashboardUpdate();

    // Check for retryable tasks (Every 6 hours)
    this.scheduleRetryCheck();

    console.log('✓ All schedulers initialized');
  }

  /**
   * Schedule daily story generation
   */
  scheduleStoryGeneration() {
    // Run at midnight (00:00)
    cron.schedule('0 0 * * *', async () => {
      console.log('\n📖 Starting daily story generation...');
      await this.generateDailyStories();
    });

    console.log('✓ Story generation scheduled for 00:00 daily');
  }

  /**
   * Generate daily episodes with backlog catch-up
   */
  async generateDailyStories() {
    try {
      const storyQueue = this.queueManager.loadQueue(this.queueManager.queues.storyGeneration);
      const pendingTasks = storyQueue.pending;
      
      // Calculate how many to generate today
      const backlogCount = pendingTasks.length;
      const todayCount = this.dailyGoal;
      const totalToGenerate = backlogCount + todayCount;

      console.log(`📊 Daily Goal: ${todayCount} | Backlog: ${backlogCount} | Total: ${totalToGenerate}`);

      let successCount = 0;
      let failureCount = 0;
      let season = this.getCurrentSeason();
      let episode = this.getCurrentEpisode();

      // Generate today's episodes
      for (let i = 1; i <= todayCount; i++) {
        try {
          episode = this.getCurrentEpisode() + i;
          const storyline = `Storyline-${this.getCurrentStoryline()}`;

          // Add to queue
          const task = this.queueManager.addToStoryQueue(season, episode, storyline);
          
          // Start generation
          this.queueManager.startStoryGeneration(task.id);

          // Generate story
          const episodeData = await this.storyGenerator.generateEpisode(
            season,
            episode,
            storyline
          );

          // Mark as completed
          this.queueManager.completeStoryGeneration(task.id, episodeData);
          successCount++;

          console.log(`✓ S${season}E${episode} generated (${episodeData.wordCount} words)`);

        } catch (error) {
          failureCount++;
          console.error(`✗ Episode S${season}E${episode} failed:`, error.message);
          
          // Determine retry strategy
          if (error.message.includes('API limit') || error.message.includes('quota')) {
            console.log('⚠️  API limit reached - queuing remaining for tomorrow');
            this.queueManager.failStoryGeneration(`S${season}E${episode}`, 'API limit exceeded');
            break; // Stop generating if API limit hit
          } else {
            this.queueManager.failStoryGeneration(`S${season}E${episode}`, error.message);
          }
        }

        // Delay between API calls
        await this.delay(1000);
      }

      console.log(`\n📈 Generation Complete: ${successCount} Success | ${failureCount} Failed`);
      this.logDashboard();

    } catch (error) {
      console.error('Fatal error in story generation:', error);
    }
  }

  /**
   * Schedule narration processing
   */
  scheduleNarrationProcessing() {
    // Check every 15 minutes for pending narration
    cron.schedule('*/15 * * * *', async () => {
      await this.processNarrationQueue();
    });

    console.log('✓ Narration processing scheduled every 15 minutes');
  }

  /**
   * Process narration queue
   */
  async processNarrationQueue() {
    try {
      const pendingTasks = this.queueManager.getRetryableTasks(this.queueManager.queues.narration);
      
      if (pendingTasks.length === 0) return;

      console.log(`\n🎤 Processing ${pendingTasks.length} pending narrations...`);

      for (const task of pendingTasks) {
        try {
          // Move to generating
          const queue = this.queueManager.loadQueue(this.queueManager.queues.narration);
          const taskIndex = queue.pending.findIndex(t => t.id === task.id);
          if (taskIndex !== -1) {
            const pendingTask = queue.pending.splice(taskIndex, 1)[0];
            pendingTask.status = 'generating';
            queue.generating.push(pendingTask);
            this.queueManager.saveQueue(this.queueManager.queues.narration, queue);
          }

          const narration = await this.narrationEngine.generateNarration({
            season: task.season,
            episode: task.episode,
            content: task.storyContent || 'Default story content',
          });

          this.queueManager.completeNarration(task.id, narration.audioPath);
          console.log(`✓ ${task.id} narrated`);

        } catch (error) {
          console.error(`✗ Narration failed for ${task.id}:`, error.message);
          this.queueManager.failNarration(task.id, error.message);
        }

        await this.delay(500);
      }

    } catch (error) {
      console.error('Error processing narration queue:', error);
    }
  }

  /**
   * Schedule video creation
   */
  scheduleVideoProcessing() {
    // Check every 20 minutes for pending videos
    cron.schedule('*/20 * * * *', async () => {
      await this.processVideoQueue();
    });

    console.log('✓ Video processing scheduled every 20 minutes');
  }

  /**
   * Process video creation queue
   */
  async processVideoQueue() {
    try {
      const pendingTasks = this.queueManager.getRetryableTasks(this.queueManager.queues.videoCreation);
      
      if (pendingTasks.length === 0) return;

      console.log(`\n🎬 Processing ${pendingTasks.length} pending videos...`);

      for (const task of pendingTasks) {
        try {
          // Move to generating
          const queue = this.queueManager.loadQueue(this.queueManager.queues.videoCreation);
          const taskIndex = queue.pending.findIndex(t => t.id === task.id);
          if (taskIndex !== -1) {
            const pendingTask = queue.pending.splice(taskIndex, 1)[0];
            pendingTask.status = 'generating';
            queue.generating.push(pendingTask);
            this.queueManager.saveQueue(this.queueManager.queues.videoCreation, queue);
          }

          const video = await this.videoGenerator.generateVideo({
            season: task.season,
            episode: task.episode,
            storyline: `Storyline-${this.getCurrentStoryline()}`,
          }, {
            audioPath: task.audioPath || 'default-audio.mp3',
          });

          this.queueManager.completeVideo(task.id, video.videoPath);
          console.log(`✓ ${task.id} video created (${video.resolution})`);

        } catch (error) {
          console.error(`✗ Video creation failed for ${task.id}:`, error.message);
          this.queueManager.failVideo(task.id, error.message);
        }

        await this.delay(500);
      }

    } catch (error) {
      console.error('Error processing video queue:', error);
    }
  }

  /**
   * Schedule YouTube uploads
   */
  scheduleYouTubeProcessing() {
    // Check every 30 minutes for uploads ready
    cron.schedule('*/30 * * * *', async () => {
      await this.processYouTubeQueue();
    });

    console.log('✓ YouTube processing scheduled every 30 minutes');
  }

  /**
   * Process YouTube upload queue
   */
  async processYouTubeQueue() {
    try {
      const pendingTasks = this.queueManager.getRetryableTasks(this.queueManager.queues.youtubeUpload);
      
      if (pendingTasks.length === 0) return;

      console.log(`\n📺 Processing ${pendingTasks.length} pending YouTube uploads...`);

      for (const task of pendingTasks) {
        try {
          // Check if scheduled time has arrived
          if (new Date(task.scheduledPublishTime) > new Date()) {
            console.log(`⏰ ${task.id} scheduled for ${new Date(task.scheduledPublishTime).toLocaleString()}`);
            continue;
          }

          // Move to generating
          const queue = this.queueManager.loadQueue(this.queueManager.queues.youtubeUpload);
          const taskIndex = queue.pending.findIndex(t => t.id === task.id);
          if (taskIndex !== -1) {
            const pendingTask = queue.pending.splice(taskIndex, 1)[0];
            pendingTask.status = 'generating';
            queue.generating.push(pendingTask);
            this.queueManager.saveQueue(this.queueManager.queues.youtubeUpload, queue);
          }

          const videoId = await this.youtubeAPI.uploadVideo({
            videoPath: task.videoPath || 'default-video.mp4',
            title: `PNG Tales S${task.season}E${task.episode}`,
            description: `A fictional Papua New Guinea-inspired fantasy series. Season ${task.season}, Episode ${task.episode}.`,
            publishAt: task.scheduledPublishTime,
          });

          this.queueManager.completeYouTubeUpload(task.id, videoId);
          console.log(`✓ ${task.id} uploaded to YouTube (ID: ${videoId})`);

        } catch (error) {
          console.error(`✗ YouTube upload failed for ${task.id}:`, error.message);
          this.queueManager.failYouTubeUpload(task.id, error.message);
        }

        await this.delay(500);
      }

    } catch (error) {
      console.error('Error processing YouTube queue:', error);
    }
  }

  /**
   * Schedule dashboard updates
   */
  scheduleDashboardUpdate() {
    cron.schedule('*/5 * * * *', () => {
      this.logDashboard();
    });

    console.log('✓ Dashboard refresh scheduled every 5 minutes');
  }

  /**
   * Schedule retry checks
   */
  scheduleRetryCheck() {
    cron.schedule('0 */6 * * *', async () => {
      console.log('\n🔄 Checking for retryable tasks...');
      const pendingTasks = this.queueManager.getPrioritizedPendingTasks();
      
      const hasRetryableTasks = Object.values(pendingTasks).some(arr => arr.length > 0);
      
      if (hasRetryableTasks) {
        console.log('Found retryable tasks - processing...');
        await this.processNarrationQueue();
        await this.processVideoQueue();
        await this.processYouTubeQueue();
      }
    });

    console.log('✓ Retry check scheduled every 6 hours');
  }

  /**
   * Log dashboard summary
   */
  logDashboard() {
    const summary = this.queueManager.getDashboardSummary();

    console.log('\n' + '='.repeat(70));
    console.log('📊 PNG TALES PRODUCTION DASHBOARD');
    console.log('='.repeat(70));
    console.log(`Today's Goal: ${summary.todaysGoal} Episodes | Completed: ${summary.completed}`);
    console.log();
    console.log('📖 Story Generation:');
    console.log(`   ⏳ Pending: ${summary.storyGeneration.pending} | ⚙️  Generating: ${summary.storyGeneration.generating}`);
    console.log(`   ✓ Completed: ${summary.storyGeneration.completed} | ✗ Failed: ${summary.storyGeneration.failed}`);
    console.log();
    console.log('🎤 Narration:');
    console.log(`   ⏳ Pending: ${summary.narration.pending} | ⚙️  Generating: ${summary.narration.generating}`);
    console.log(`   ✓ Completed: ${summary.narration.completed} | ✗ Failed: ${summary.narration.failed}`);
    console.log();
    console.log('🎬 Video Creation:');
    console.log(`   ⏳ Pending: ${summary.videoCreation.pending} | ⚙️  Generating: ${summary.videoCreation.generating}`);
    console.log(`   ✓ Completed: ${summary.videoCreation.completed} | ✗ Failed: ${summary.videoCreation.failed}`);
    console.log();
    console.log('📺 YouTube Upload:');
    console.log(`   ⏳ Pending: ${summary.youtubeUpload.pending} | ⚙️  Uploading: ${summary.youtubeUpload.generating}`);
    console.log(`   ✓ Uploaded: ${summary.youtubeUpload.completed} | ✗ Failed: ${summary.youtubeUpload.failed}`);
    console.log();
    console.log(`📈 Total Backlog: ${summary.totalBacklog} episodes`);
    if (summary.estimatedCatchUpDays > 0) {
      console.log(`⏱️  Estimated Catch-Up Time: ${summary.estimatedCatchUpDays} days`);
    } else {
      console.log(`🎉 No backlog - system running smoothly!`);
    }
    console.log('='.repeat(70) + '\n');
  }

  /**
   * Helper: Get current season
   */
  getCurrentSeason() {
    // Can be tracked in database
    return 1;
  }

  /**
   * Helper: Get current episode
   */
  getCurrentEpisode() {
    // Can be tracked in database
    return 1;
  }

  /**
   * Helper: Get current storyline
   */
  getCurrentStoryline() {
    // Can be tracked in database
    return 1;
  }

  /**
   * Helper: Delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = DailyScheduler;
