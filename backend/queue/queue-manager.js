const fs = require('fs');
const path = require('path');

/**
 * Queue Manager for PNG Tales
 * Handles multi-stage production pipeline with retry logic
 */
class QueueManager {
  constructor() {
    this.queueDir = path.join(__dirname, '../../data/queues');
    this.ensureQueueDir();
    
    this.queues = {
      storyGeneration: 'story-generation-queue.json',
      narration: 'narration-queue.json',
      videoCreation: 'video-creation-queue.json',
      youtubeUpload: 'youtube-upload-queue.json',
      dailyProgress: 'daily-progress.json',
    };
  }

  /**
   * Ensure queue directory exists
   */
  ensureQueueDir() {
    if (!fs.existsSync(this.queueDir)) {
      fs.mkdirSync(this.queueDir, { recursive: true });
    }
  }

  /**
   * Initialize daily progress tracker
   */
  initializeDailyProgress() {
    const progressPath = path.join(this.queueDir, this.queues.dailyProgress);
    const today = new Date().toISOString().split('T')[0];

    let progress = { date: today, completed: 0, pending: 0, backlog: 0 };

    if (fs.existsSync(progressPath)) {
      const existing = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
      if (existing.date === today) {
        return existing;
      }
    }

    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
    return progress;
  }

  /**
   * Get all queues status
   */
  getQueueStatus() {
    const status = {
      storyGeneration: this.loadQueue(this.queues.storyGeneration),
      narration: this.loadQueue(this.queues.narration),
      videoCreation: this.loadQueue(this.queues.videoCreation),
      youtubeUpload: this.loadQueue(this.queues.youtubeUpload),
      dailyProgress: this.loadQueue(this.queues.dailyProgress),
    };

    return status;
  }

  /**
   * Load queue from file
   */
  loadQueue(queueFile) {
    const queuePath = path.join(this.queueDir, queueFile);
    
    try {
      if (fs.existsSync(queuePath)) {
        return JSON.parse(fs.readFileSync(queuePath, 'utf8'));
      }
    } catch (error) {
      console.error(`Error loading queue ${queueFile}:`, error);
    }

    return { pending: [], generating: [], completed: [], failed: [] };
  }

  /**
   * Save queue to file
   */
  saveQueue(queueFile, queueData) {
    const queuePath = path.join(this.queueDir, queueFile);
    
    try {
      fs.writeFileSync(queuePath, JSON.stringify(queueData, null, 2));
    } catch (error) {
      console.error(`Error saving queue ${queueFile}:`, error);
    }
  }

  /**
   * Add episode to story generation queue
   */
  addToStoryQueue(season, episode, storylineName) {
    const queue = this.loadQueue(this.queues.storyGeneration);
    
    const episodeTask = {
      id: `S${season}E${episode}`,
      season,
      episode,
      storylineName,
      status: 'pending',
      createdAt: new Date().toISOString(),
      retries: 0,
      maxRetries: 3,
    };

    // Check if already exists
    if (!queue.pending.find(t => t.id === episodeTask.id)) {
      queue.pending.push(episodeTask);
      this.saveQueue(this.queues.storyGeneration, queue);
    }

    return episodeTask;
  }

  /**
   * Move episode from pending to generating
   */
  startStoryGeneration(episodeId) {
    const queue = this.loadQueue(this.queues.storyGeneration);
    
    const taskIndex = queue.pending.findIndex(t => t.id === episodeId);
    if (taskIndex !== -1) {
      const task = queue.pending.splice(taskIndex, 1)[0];
      task.status = 'generating';
      task.startedAt = new Date().toISOString();
      queue.generating.push(task);
      this.saveQueue(this.queues.storyGeneration, queue);
      return task;
    }

    return null;
  }

  /**
   * Mark story generation as completed
   */
  completeStoryGeneration(episodeId, storyContent) {
    const queue = this.loadQueue(this.queues.storyGeneration);
    
    const taskIndex = queue.generating.findIndex(t => t.id === episodeId);
    if (taskIndex !== -1) {
      const task = queue.generating.splice(taskIndex, 1)[0];
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.storyContent = storyContent;
      queue.completed.push(task);
      
      // Auto-add to narration queue
      this.addToNarrationQueue(task.season, task.episode, episodeId);
      
      this.saveQueue(this.queues.storyGeneration, queue);
      return task;
    }

    return null;
  }

  /**
   * Mark story generation as failed
   */
  failStoryGeneration(episodeId, reason) {
    const queue = this.loadQueue(this.queues.storyGeneration);
    
    const taskIndex = queue.generating.findIndex(t => t.id === episodeId);
    if (taskIndex !== -1) {
      const task = queue.generating.splice(taskIndex, 1)[0];
      task.status = 'failed';
      task.failedAt = new Date().toISOString();
      task.failureReason = reason;
      task.retries = (task.retries || 0) + 1;

      if (task.retries < (task.maxRetries || 3)) {
        task.status = 'pending';
        task.nextRetry = this.calculateNextRetry(task.retries);
        queue.pending.push(task);
      } else {
        queue.failed.push(task);
      }

      this.saveQueue(this.queues.storyGeneration, queue);
      return task;
    }

    return null;
  }

  /**
   * Add to narration queue
   */
  addToNarrationQueue(season, episode, episodeId) {
    const queue = this.loadQueue(this.queues.narration);
    
    const narrationTask = {
      id: episodeId,
      season,
      episode,
      status: 'pending',
      createdAt: new Date().toISOString(),
      retries: 0,
      maxRetries: 3,
    };

    if (!queue.pending.find(t => t.id === episodeId)) {
      queue.pending.push(narrationTask);
      this.saveQueue(this.queues.narration, queue);
    }

    return narrationTask;
  }

  /**
   * Complete narration
   */
  completeNarration(episodeId, audioPath) {
    const queue = this.loadQueue(this.queues.narration);
    
    const taskIndex = queue.generating.findIndex(t => t.id === episodeId);
    if (taskIndex !== -1) {
      const task = queue.generating.splice(taskIndex, 1)[0];
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.audioPath = audioPath;
      queue.completed.push(task);

      // Auto-add to video creation queue
      this.addToVideoQueue(task.season, task.episode, episodeId);
      
      this.saveQueue(this.queues.narration, queue);
      return task;
    }

    return null;
  }

  /**
   * Fail narration
   */
  failNarration(episodeId, reason) {
    const queue = this.loadQueue(this.queues.narration);
    
    const taskIndex = queue.generating.findIndex(t => t.id === episodeId);
    if (taskIndex !== -1) {
      const task = queue.generating.splice(taskIndex, 1)[0];
      task.status = 'failed';
      task.failedAt = new Date().toISOString();
      task.failureReason = reason;
      task.retries = (task.retries || 0) + 1;

      if (task.retries < (task.maxRetries || 3)) {
        task.status = 'pending';
        task.nextRetry = this.calculateNextRetry(task.retries);
        queue.pending.push(task);
      } else {
        queue.failed.push(task);
      }

      this.saveQueue(this.queues.narration, queue);
      return task;
    }

    return null;
  }

  /**
   * Add to video creation queue
   */
  addToVideoQueue(season, episode, episodeId) {
    const queue = this.loadQueue(this.queues.videoCreation);
    
    const videoTask = {
      id: episodeId,
      season,
      episode,
      status: 'pending',
      createdAt: new Date().toISOString(),
      retries: 0,
      maxRetries: 3,
    };

    if (!queue.pending.find(t => t.id === episodeId)) {
      queue.pending.push(videoTask);
      this.saveQueue(this.queues.videoCreation, queue);
    }

    return videoTask;
  }

  /**
   * Complete video creation
   */
  completeVideo(episodeId, videoPath) {
    const queue = this.loadQueue(this.queues.videoCreation);
    
    const taskIndex = queue.generating.findIndex(t => t.id === episodeId);
    if (taskIndex !== -1) {
      const task = queue.generating.splice(taskIndex, 1)[0];
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.videoPath = videoPath;
      queue.completed.push(task);

      // Auto-add to YouTube upload queue
      this.addToYouTubeQueue(task.season, task.episode, episodeId);
      
      this.saveQueue(this.queues.videoCreation, queue);
      return task;
    }

    return null;
  }

  /**
   * Fail video creation
   */
  failVideo(episodeId, reason) {
    const queue = this.loadQueue(this.queues.videoCreation);
    
    const taskIndex = queue.generating.findIndex(t => t.id === episodeId);
    if (taskIndex !== -1) {
      const task = queue.generating.splice(taskIndex, 1)[0];
      task.status = 'failed';
      task.failedAt = new Date().toISOString();
      task.failureReason = reason;
      task.retries = (task.retries || 0) + 1;

      if (task.retries < (task.maxRetries || 3)) {
        task.status = 'pending';
        task.nextRetry = this.calculateNextRetry(task.retries);
        queue.pending.push(task);
      } else {
        queue.failed.push(task);
      }

      this.saveQueue(this.queues.videoCreation, queue);
      return task;
    }

    return null;
  }

  /**
   * Add to YouTube upload queue
   */
  addToYouTubeQueue(season, episode, episodeId) {
    const queue = this.loadQueue(this.queues.youtubeUpload);
    
    const uploadTask = {
      id: episodeId,
      season,
      episode,
      status: 'pending',
      createdAt: new Date().toISOString(),
      retries: 0,
      maxRetries: 5, // More retries for network issues
      scheduledPublishTime: this.calculatePublishTime(episode),
    };

    if (!queue.pending.find(t => t.id === episodeId)) {
      queue.pending.push(uploadTask);
      this.saveQueue(this.queues.youtubeUpload, queue);
    }

    return uploadTask;
  }

  /**
   * Complete YouTube upload
   */
  completeYouTubeUpload(episodeId, videoId) {
    const queue = this.loadQueue(this.queues.youtubeUpload);
    
    const taskIndex = queue.generating.findIndex(t => t.id === episodeId);
    if (taskIndex !== -1) {
      const task = queue.generating.splice(taskIndex, 1)[0];
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.youtubeVideoId = videoId;
      queue.completed.push(task);
      
      this.saveQueue(this.queues.youtubeUpload, queue);
      this.updateDailyProgress('completed');
      return task;
    }

    return null;
  }

  /**
   * Fail YouTube upload
   */
  failYouTubeUpload(episodeId, reason) {
    const queue = this.loadQueue(this.queues.youtubeUpload);
    
    const taskIndex = queue.generating.findIndex(t => t.id === episodeId);
    if (taskIndex !== -1) {
      const task = queue.generating.splice(taskIndex, 1)[0];
      task.status = 'failed';
      task.failedAt = new Date().toISOString();
      task.failureReason = reason;
      task.retries = (task.retries || 0) + 1;

      if (task.retries < (task.maxRetries || 5)) {
        task.status = 'pending';
        task.nextRetry = this.calculateNextRetry(task.retries);
        queue.pending.push(task);
      } else {
        queue.failed.push(task);
      }

      this.saveQueue(this.queues.youtubeUpload, queue);
      return task;
    }

    return null;
  }

  /**
   * Get retryable tasks
   */
  getRetryableTasks(queueFile) {
    const queue = this.loadQueue(queueFile);
    const now = new Date();

    return queue.pending.filter(task => {
      if (!task.nextRetry) return true;
      return new Date(task.nextRetry) <= now;
    });
  }

  /**
   * Calculate next retry time (exponential backoff)
   */
  calculateNextRetry(retryCount) {
    // Retry after 1 hour, 4 hours, 12 hours
    const delays = [1, 4, 12]; // hours
    const delay = delays[Math.min(retryCount - 1, delays.length - 1)];
    const nextRetry = new Date();
    nextRetry.setHours(nextRetry.getHours() + delay);
    return nextRetry.toISOString();
  }

  /**
   * Calculate YouTube publish time
   */
  calculatePublishTime(episodeNumber) {
    const publishTimes = [
      '06:00', '08:00', '10:00', '12:00', '14:00',
      '16:00', '18:00', '20:00', '22:00', '23:55'
    ];
    
    const time = publishTimes[(episodeNumber - 1) % publishTimes.length];
    const [hours, minutes] = time.split(':');
    
    const publishDate = new Date();
    publishDate.setHours(parseInt(hours), parseInt(minutes), 0);
    
    if (publishDate < new Date()) {
      publishDate.setDate(publishDate.getDate() + 1);
    }
    
    return publishDate.toISOString();
  }

  /**
   * Update daily progress
   */
  updateDailyProgress(action) {
    const progressPath = path.join(this.queueDir, this.queues.dailyProgress);
    const progress = this.initializeDailyProgress();

    if (action === 'completed') {
      progress.completed += 1;
    } else if (action === 'pending') {
      progress.pending += 1;
    }

    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
  }

  /**
   * Get dashboard summary
   */
  getDashboardSummary() {
    const storyQueue = this.loadQueue(this.queues.storyGeneration);
    const narrationQueue = this.loadQueue(this.queues.narration);
    const videoQueue = this.loadQueue(this.queues.videoCreation);
    const uploadQueue = this.loadQueue(this.queues.youtubeUpload);
    const progress = this.initializeDailyProgress();

    const totalBacklog = 
      storyQueue.pending.length + 
      narrationQueue.pending.length + 
      videoQueue.pending.length + 
      uploadQueue.pending.length;

    const dailyGoal = parseInt(process.env.DAILY_EPISODES_COUNT) || 10;
    const catchUpDays = totalBacklog > 0 ? Math.ceil(totalBacklog / dailyGoal) : 0;

    return {
      todaysGoal: dailyGoal,
      completed: progress.completed,
      pending: progress.pending,
      storyGeneration: {
        pending: storyQueue.pending.length,
        generating: storyQueue.generating.length,
        completed: storyQueue.completed.length,
        failed: storyQueue.failed.length,
      },
      narration: {
        pending: narrationQueue.pending.length,
        generating: narrationQueue.generating.length,
        completed: narrationQueue.completed.length,
        failed: narrationQueue.failed.length,
      },
      videoCreation: {
        pending: videoQueue.pending.length,
        generating: videoQueue.generating.length,
        completed: videoQueue.completed.length,
        failed: videoQueue.failed.length,
      },
      youtubeUpload: {
        pending: uploadQueue.pending.length,
        generating: uploadQueue.generating.length,
        completed: uploadQueue.completed.length,
        failed: uploadQueue.failed.length,
      },
      totalBacklog,
      estimatedCatchUpDays: catchUpDays,
    };
  }

  /**
   * Get pending tasks sorted by priority
   */
  getPrioritizedPendingTasks() {
    return {
      storyGeneration: this.getRetryableTasks(this.queues.storyGeneration),
      narration: this.getRetryableTasks(this.queues.narration),
      videoCreation: this.getRetryableTasks(this.queues.videoCreation),
      youtubeUpload: this.getRetryableTasks(this.queues.youtubeUpload),
    };
  }
}

module.exports = QueueManager;
