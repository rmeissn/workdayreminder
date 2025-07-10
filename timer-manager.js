import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import { Timer } from './timer.js';
import { debugLog, MAX_RESTORE_MINUTES, isWithinActiveHours } from './utils.js';

/**
 * Manages all active timers, notifications, and timer persistence
 */
export class TimerManager {
    constructor(settings) {
        this._settings = settings;
        this._activeTimers = [];
        this._timerConfigs = [];
        this._activeNotifications = new Map();
        this._notificationSource = null;
    }

    /**
     * Load timer configurations from settings
     */
    loadTimerConfigs() {
        try {
            this._timerConfigs = JSON.parse(this._settings.get_string('timers'));
            debugLog(`Loaded ${this._timerConfigs.length} timer configurations`);
        } catch (e) {
            console.warn('Failed to load timers:', e);
            this._timerConfigs = [];
        }
        return this._timerConfigs;
    }

    /**
     * Get all active timers
     */
    getActiveTimers() {
        return this._activeTimers;
    }

    /**
     * Get next timer (earliest end time)
     */
    getNextTimer() {
        if (!this._activeTimers?.length) return null;
        
        return this._activeTimers.reduce((earliest, current) => 
            current.endTime < earliest.endTime ? current : earliest);
    }

    /**
     * Add a new timer
     */
    addTimer(timerIndex, minutes) {
        if (typeof timerIndex !== 'number' || typeof minutes !== 'number' || !this._isValidTimerIndex(timerIndex)) {
            console.warn('Invalid timer parameters:', { timerIndex, minutes });
            return;
        }
        
        // Close any active notification for this timer
        this._closeNotification(timerIndex);
        
        // Remove existing timer with same index
        this.removeTimer(timerIndex);
        
        // Get config and validate it
        const config = this._timerConfigs[timerIndex];
        if (!this._isValidTimer(config)) {
            console.warn('Invalid timer configuration for index:', timerIndex);
            return;
        }
        
        // Create new timer with specified duration
        const now = new Date();
        const endTime = new Date(now.getTime() + minutes * 60000);
        const timer = new Timer(timerIndex, config, now, endTime);
        
        this._activeTimers.push(timer);
        debugLog(`Added timer ${timerIndex} for ${minutes} minutes`);
        
        // Trigger UI updates
        this._triggerUIUpdates();
    }

    /**
     * Remove a specific timer
     */
    removeTimer(timerIndex) {
        const initialLength = this._activeTimers.length;
        this._activeTimers = this._activeTimers.filter(timer => {
            if (timer.matchesIndex(timerIndex)) {
                timer.destroy();
                return false;
            }
            return true;
        });
        
        const removed = initialLength - this._activeTimers.length;
        if (removed > 0) {
            debugLog(`Removed ${removed} timer(s) with index ${timerIndex}`);
        }
    }

    /**
     * Stop all active timers
     */
    stopAllTimers() {
        this._closeAllNotifications();
        this._activeTimers.forEach(timer => timer.destroy());
        this._activeTimers = [];
        
        debugLog('All timers stopped');
        this._triggerUIUpdates();
    }

    /**
     * Start all valid timers based on configurations
     */
    startValidTimers() {
        if (!this._timerConfigs?.length) return;
        
        this._timerConfigs.forEach((config, index) => {
            if (this._isValidTimer(config)) {
                this.addTimer(index, config.timeBetweenNotifications);
            }
        });
        
        debugLog(`Started ${this._activeTimers.length} valid timers`);
    }

    /**
     * Check all active timers for expiration
     */
    checkTimers() {
        if (!this._activeTimers || !Array.isArray(this._activeTimers)) {
            console.warn('Active timers array is invalid');
            this._activeTimers = [];
            return;
        }
        
        const currentTime = new Date();
        debugLog(`Checking ${this._activeTimers.length} active timers at ${currentTime.toLocaleTimeString()}`);
        
        for (let i = this._activeTimers.length - 1; i >= 0; i--) {
            const timer = this._activeTimers[i];
            
            if (!timer || !timer.isValid()) {
                console.warn('Invalid timer found, removing:', timer);
                if (timer) timer.destroy();
                this._activeTimers.splice(i, 1);
                continue;
            }
            
            const timeRemaining = timer.getRemainingTime();
            debugLog(`Timer ${timer.index}: ${Math.round(timeRemaining/1000)}s remaining, notified: ${timer.notified}`);
            
            if (timer.isExpired()) {
                debugLog(`Timer ${timer.index} has finished! Showing notification.`);
                // Remove timer from active list BEFORE showing notification
                this._activeTimers.splice(i, 1);
                this._showNotification(timer);
            }
        }
    }

    /**
     * Get remaining time for a specific timer
     */
    getRemainingTimeForTimer(timerIndex) {
        const timer = this._activeTimers?.find(t => t.matchesIndex(timerIndex) && !t.notified);
        return timer ? timer.getRemainingMinutes() : null;
    }

    /**
     * Calculate progress percentage for the next timer
     */
    calculateProgress() {
        const nextTimer = this.getNextTimer();
        return nextTimer ? nextTimer.getProgress() : 0;
    }

    /**
     * Get the name of the current (next) timer
     */
    getCurrentTimerName() {
        const nextTimer = this.getNextTimer();
        if (!nextTimer || !this._isValidTimerIndex(nextTimer.index)) {
            return nextTimer ? 'Unknown' : 'No Timer';
        }
        return nextTimer.getName();
    }

    /**
     * Validate timer index
     */
    _isValidTimerIndex(index) {
        return this._timerConfigs && index >= 0 && index < this._timerConfigs.length;
    }

    /**
     * Validate timer configuration
     */
    _isValidTimer(timer) {
        return timer && 
               typeof timer.timeBetweenNotifications === 'number' && 
               timer.timeBetweenNotifications > 0;
    }

    /**
     * Show notification for expired timer
     */
    _showNotification(timer) {
        const config = timer.config;
        debugLog(`Notification for timer ${timer.index}: ${config.name}`);
        
        try {
            const notification = new MessageTray.Notification({
                source: this._getNotificationSource(),
                title: `${config.name} Reminder`,
                body: config.message || `Time for your ${config.name} break!`,
                urgency: MessageTray.Urgency.CRITICAL
            });
            
            this._setupNotificationHandlers(timer, notification, config);
            this._getNotificationSource().addNotification(notification);
            
        } catch (error) {
            this._handleNotificationError(timer, config, error);
        }
        
        timer.markNotified();
        timer.destroy();
        this._triggerUIUpdates();
    }

    /**
     * Create or get notification source
     */
    _getNotificationSource() {
        if (!this._notificationSource) {
            this._notificationSource = new MessageTray.Source({
                title: 'Workday Reminder',
                iconName: 'alarm-symbolic'
            });
            Main.messageTray.add(this._notificationSource);
        }
        return this._notificationSource;
    }

    /**
     * Persist current timer state to settings
     */
    persistTimerState() {
        if (!this._activeTimers?.length) {
            this._settings.set_string('persisted-timer-state', '');
            return;
        }
        
        const now = new Date();
        const state = {
            disableTime: now.toISOString(),
            activeTimers: this._activeTimers.map(timer => timer.toState())
        };
        
        try {
            this._settings.set_string('persisted-timer-state', JSON.stringify(state));
            debugLog('Timer state persisted:', state);
        } catch (e) {
            console.warn('Failed to persist timer state:', e);
        }
    }

    /**
     * Try to restore timer state from settings
     */
    tryRestoreTimerState() {
        const stateString = this._settings.get_string('persisted-timer-state');
        if (!stateString) return false;
        
        try {
            const state = JSON.parse(stateString);
            const disableTime = new Date(state.disableTime);
            const now = new Date();
            const pauseDurationMinutes = (now - disableTime) / 60000;
            
            // Clear state after reading
            this._settings.set_string('persisted-timer-state', '');
            
            // Check if pause was longer than MAX_RESTORE_MINUTES
            if (pauseDurationMinutes > MAX_RESTORE_MINUTES) {
                debugLog(`Pause too long (${Math.round(pauseDurationMinutes)} min) - discarding timer state`);
                return false;
            }
            
            // Clear existing timers before restoring
            this.stopAllTimers();
            
            // Restore timers with adjusted remaining time
            state.activeTimers.forEach(timerState => {
                const adjustedMinutes = Math.max(0, timerState.remainingMinutes - pauseDurationMinutes);
                
                if (adjustedMinutes > 0 && this._isValidTimerIndex(timerState.timerIndex)) {
                    const config = this._timerConfigs[timerState.timerIndex];
                    if (this._isValidTimer(config)) {
                        const timer = Timer.fromState({
                            timerIndex: timerState.timerIndex,
                            remainingMinutes: adjustedMinutes
                        }, config);
                        
                        this._activeTimers.push(timer);
                    }
                }
            });
            
            debugLog(`Restored ${this._activeTimers.length} timers after ${Math.round(pauseDurationMinutes)} min pause`);
            return this._activeTimers.length > 0;
            
        } catch (e) {
            console.warn('Failed to restore timer state:', e);
            this._settings.set_string('persisted-timer-state', '');
            return false;
        }
    }

    /**
     * Set callback functions for UI updates
     */
    setUpdateCallbacks(updateLabel, updateIcon, updateMenuTexts) {
        this._updateLabel = updateLabel;
        this._updateIcon = updateIcon;
        this._updateMenuTexts = updateMenuTexts;
    }

    /**
     * Trigger UI updates
     */
    _triggerUIUpdates() {
        if (this._updateLabel) this._updateLabel();
        if (this._updateIcon) this._updateIcon();
        if (this._updateMenuTexts) this._updateMenuTexts();
    }

    /**
     * Get timer configurations
     */
    getTimerConfigs() {
        return this._timerConfigs;
    }

    /**
     * Destroy all timers and notifications
     */
    destroy() {
        debugLog('Destroying TimerManager');
        
        this.persistTimerState();
        this._closeAllNotifications();
        
        if (this._notificationSource) {
            this._notificationSource.destroy();
            this._notificationSource = null;
        }
        
        this._activeTimers.forEach(timer => timer.destroy());
        this._activeTimers = [];
        this._timerConfigs = [];
        this._settings = null;
        
        debugLog('TimerManager destroy complete');
    }
    
    /**
     * Setup notification event handlers
     */
    _setupNotificationHandlers(timer, notification, config) {
        this._activeNotifications.set(timer.index, notification);
        
        let handlerExecuted = false;
        const resetTimer = (minutes) => () => {
            if (handlerExecuted) return;
            handlerExecuted = true;
            debugLog(`Resetting timer ${timer.index} for ${minutes} minutes`);
            this.addTimer(timer.index, minutes);
        };
        
        const acceptAction = resetTimer(config.timeBetweenNotifications);
        const declineAction = resetTimer(config.extraTime || config.timeBetweenNotifications);
        
        // Add action buttons
        if (config.successButtonText) {
            notification.addAction(config.successButtonText, acceptAction);
        }
        notification.addAction('Wait a bit', declineAction);
        
        // Handle notification events
        notification.connect('destroy', (notification, reason) => {
            this._activeNotifications.delete(timer.index);
            if (!handlerExecuted && 
                (reason === MessageTray.NotificationDestroyedReason.DISMISSED || 
                 reason === MessageTray.NotificationDestroyedReason.EXPIRED)) {
                handlerExecuted = true;
                debugLog(`Notification dismissed - resetting timer ${timer.index}`);
                this.addTimer(timer.index, config.extraTime || config.timeBetweenNotifications);
            }
        });
        
        notification.connect('activated', () => {
            if (!handlerExecuted) declineAction();
        });
    }

    /**
     * Handle notification display errors
     */
    _handleNotificationError(timer, config, error) {
        console.error('Error showing notification:', error);
        Main.notify('Workday Reminder', `${config.name} - ${config.message || 'Time for a break!'}`);
        
        const resetTime = config.extraTime || config.timeBetweenNotifications;
        debugLog(`Fallback: resetting timer ${timer.index} for ${resetTime} minutes`);
        this.addTimer(timer.index, resetTime);
    }
    
    /**
     * Close notification for specific timer
     */
    _closeNotification(timerIndex) {
        const notification = this._activeNotifications.get(timerIndex);
        if (notification) {
            debugLog(`Closing notification for timer ${timerIndex}`);
            this._activeNotifications.delete(timerIndex);
            try {
                notification.destroy();
            } catch (e) {
                debugLog('Notification already destroyed');
            }
        }
    }

    /**
     * Close all active notifications
     */
    _closeAllNotifications() {
        this._activeNotifications.forEach((notification, timerIndex) => {
            this._closeNotification(timerIndex);
        });
    }

    /**
     * Check if current time is within active hours from settings
     */
    isWithinActiveHours() {
        const activateTime = this._settings.get_string('activate-time');
        const deactivateTime = this._settings.get_string('deactivate-time');
        return isWithinActiveHours(activateTime, deactivateTime);
    }

    /**
     * Start all timers if within active hours
     */
    startAllTimersIfActive() {
        if (!this.isWithinActiveHours()) {
            debugLog('Not within active hours - timers not started');
            return false;
        }
        this.startValidTimers();
        debugLog(`All timers started - ${this._activeTimers.length} active timers`);
        return true;
    }

    /**
     * Check active hours and stop/start timers accordingly
     */
    checkActiveHours() {
        if (!this.isWithinActiveHours()) {
            debugLog('Outside active hours - stopping timers');
            this.stopAllTimers();
            return false;
        } else {
            debugLog('Within active hours - timers can run');
            return true;
        }
    }

    /**
     * Validate timer configuration (public method)
     */
    isValidTimer(timer) {
        return this._isValidTimer(timer);
    }

    /**
     * Validate timer index (public method)
     */
    isValidTimerIndex(index) {
        return this._isValidTimerIndex(index);
    }
}
