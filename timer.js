import { debugLog } from './utils.js';

/**
 * Represents a single timer instance with its configuration and state
 */
export class Timer {
    constructor(index, config, startTime = null, endTime = null) {
        this.index = index;
        this.config = config; // { name, timeBetweenNotifications, message, successButtonText, extraTime }
        this.startTime = startTime || new Date();
        this.endTime = endTime || new Date(this.startTime.getTime() + config.timeBetweenNotifications * 60000);
        this.notified = false;
    }

    /**
     * Get remaining time in milliseconds
     */
    getRemainingTime() {
        const now = new Date();
        return Math.max(0, this.endTime - now);
    }

    /**
     * Get remaining time in minutes
     */
    getRemainingMinutes() {
        const remainingMs = this.getRemainingTime();
        return remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 60000);
    }

    /**
     * Get progress as percentage (0-1)
     */
    getProgress() {
        const now = new Date();
        const totalDuration = this.endTime - this.startTime;
        const elapsed = now - this.startTime;
        const progress = elapsed / totalDuration;
        return Math.min(0.999, Math.max(0, progress));
    }

    /**
     * Check if timer has expired
     */
    isExpired() {
        return new Date() >= this.endTime && !this.notified;
    }

    /**
     * Check if timer is valid
     */
    isValid() {
        return this.config && 
               typeof this.config.timeBetweenNotifications === 'number' &&
               this.config.timeBetweenNotifications > 0 &&
               this.startTime instanceof Date &&
               this.endTime instanceof Date &&
               this.endTime > this.startTime;
    }

    /**
     * Reset timer with new duration
     */
    reset(minutes) {
        const now = new Date();
        this.startTime = now;
        this.endTime = new Date(now.getTime() + minutes * 60000);
        this.notified = false;
        debugLog(`Timer ${this.index} reset for ${minutes} minutes`);
    }

    /**
     * Convert timer to serializable state for persistence
     */
    toState() {
        const now = new Date();
        return {
            timerIndex: this.index,
            remainingMinutes: Math.ceil((this.endTime - now) / 60000)
        };
    }

    /**
     * Create timer from persisted state
     */
    static fromState(state, config) {
        const now = new Date();
        // Calculate start time based on how much time has already elapsed
        const totalDuration = config.timeBetweenNotifications * 60000; // total duration in ms
        const remainingTime = state.remainingMinutes * 60000; // remaining time in ms
        const elapsedTime = totalDuration - remainingTime; // elapsed time in ms
        
        const startTime = new Date(now.getTime() - elapsedTime);
        const endTime = new Date(now.getTime() + remainingTime);
        
        const timer = new Timer(state.timerIndex, config, startTime, endTime);
        debugLog(`Timer ${state.timerIndex} restored from state with ${state.remainingMinutes} minutes remaining`);
        return timer;
    }

    /**
     * Mark timer as notified
     */
    markNotified() {
        this.notified = true;
        debugLog(`Timer ${this.index} marked as notified`);
    }

    /**
     * Get timer name from config
     */
    getName() {
        return this.config?.name || 'Timer';
    }

    /**
     * Get formatted remaining time string
     */
    getRemainingTimeString() {
        const minutes = this.getRemainingMinutes();
        return minutes > 0 ? `${minutes} min` : '0 min';
    }

    /**
     * Check if this timer matches a specific index
     */
    matchesIndex(index) {
        return this.index === index;
    }

    /**
     * Clean up timer resources
     */
    destroy() {
        debugLog(`Destroying timer ${this.index}`);
        
        // Clear references to help garbage collection
        this.config = null;
        this.startTime = null;
        this.endTime = null;
        this.notified = false;
        this.index = null;
    }
}
