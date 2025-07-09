import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const REPAINT_SECONDS = 10;
const CHECK_TIMER_SECONDS = 10;
const UPDATE_MENU_SECONDS = 30;

const repaint = (area, percentageDone) => {
    let context = area.get_context();
    const [width, height] = area.get_surface_size();
    const x =  width / 2;
    const y = height / 2;
    const r = width / 2.5;
    context.arc(x, y, r, 0, 2 * Math.PI);
    context.setSourceRGBA(148 / 255, 148 / 255, 148 / 255, 1);
    context.stroke();
    const angleDone = 2 * Math.PI * percentageDone;
    const startPoint = 1.5 * Math.PI;
    const endPoint = (1.5 * Math.PI + angleDone) % (2 * Math.PI);
    context.arc(x, y, r, startPoint, endPoint);
    context.setSourceRGBA(242 / 255, 242 / 255, 242 / 255, 1);
    context.stroke();

    context.$dispose();
}

export default class WorkDayReminder extends Extension {
    _loadTimers() {
        try {
            const timersJson = this._settings.get_string('timers');
            const timers = JSON.parse(timersJson);
            return timers;
        } catch (e) {
            console.warn('Failed to load timers:', e);
            return [];
        }
    }

    _updateTimerMenuItems() {
        // Remove existing timer menu items
        if (this._timerMenuItems) {
            this._timerMenuItems.forEach(item => {
                item.destroy();
            });
        }
        this._timerMenuItems = [];

        // Reload timers from settings
        this._timers = this._loadTimers();
        
        // Restart all timers with new settings
        this._activeTimers = [];
        if (this._timers && this._timers.length > 0) {
            this._timers.forEach((timer, index) => {
                if (timer && typeof timer.timeBetweenNotifications === 'number') {
                    this.addNewTimer(index, timer.timeBetweenNotifications);
                }
            });
        }
        
        // Update the label
        if (this._label) {
            this._label.set_text(this.getCurrentTimerName());
        }
        
        // Add menu items for each timer
        if (this._timers && this._indicator && this._indicator.menu) {
            this._timers.forEach((timer, index) => {
                if (timer && timer.name && typeof timer.timeBetweenNotifications === 'number') {
                    const menuItem = this._indicator.menu.addAction(this._getTimerMenuText(timer.name, index), () => {
                        this.addNewTimer(index, timer.timeBetweenNotifications);
                    });
                    this._timerMenuItems.push(menuItem);
                }
            });
            
            // Add separator and stop all timers button
            if (this._timers.length > 0) {
                this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                this._indicator.menu.addAction('Stop All Timers', () => {
                    this.stopAllTimers();
                });
            }
        }
        
        // Add a menu item to open the preferences window (always at the bottom)
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._indicator.menu.addAction('Preferences', () => this.openPreferences());
    }

    _getTimerMenuText(timerName, timerIndex) {
        const remainingTime = this.getRemainingTimeForTimer(timerIndex);
        if (remainingTime === null) {
            return `Reset ${timerName} Timer`;
        }
        return `Reset ${timerName} Timer [${remainingTime} min]`;
    }

    _updateTimerMenuTexts() {
        if (!this._timerMenuItems || !this._timers) {
            return;
        }
        
        this._timerMenuItems.forEach((menuItem, index) => {
            if (this._timers[index] && this._timers[index].name) {
                const newText = this._getTimerMenuText(this._timers[index].name, index);
                menuItem.label.set_text(newText);
            }
        });
    }

    enable() {
        // Create a panel button
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

        // Create a container for the icon and label
        this._container = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        
        // Add an icon
        this._icon = new St.DrawingArea({ width: 25, height: 25 });
        this._icon.connect('repaint', (area) => repaint(area, this.calculatePercentageDone()));
        this._container.add_child(this._icon);
        
        // Add a label for the timer name
        this._label = new St.Label({ 
            text: 'No Timer',
            style_class: 'panel-button',
            y_align: 2 // CENTER
        });
        this._container.add_child(this._label);
        
        this._indicator.add_child(this._container);

        this._settings = this.getSettings();
        
        // Initialize timer menu items array
        this._timerMenuItems = [];
        
        // Load timers and create menu items
        this._updateTimerMenuItems();

        // Watch for changes to the timers setting
        this._settingsConnection = this._settings.connect('changed::timers', () => {
            this._updateTimerMenuItems();
        });

        // Add the indicator to the panel
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Initialize active timers array
        this._activeTimers = [];

        // Check for missed activation before starting timers
        this._checkForMissedActivation();

        // Start all timers automatically
        if (this._timers && this._timers.length > 0) {
            this._timers.forEach((timer, index) => {
                if (timer && typeof timer.timeBetweenNotifications === 'number') {
                    this.addNewTimer(index, timer.timeBetweenNotifications);
                }
            });
        }
        this._repaintTimeOut = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REPAINT_SECONDS, () => {
            if (this._icon) {
                this._icon.queue_repaint();
            }
            if (this._label) {
                this._label.set_text(this.getCurrentTimerName());
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._checkTimeOut = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CHECK_TIMER_SECONDS, () => {
            this.check();
            // Also check for missed activation every time we check timers
            this._checkForMissedActivation();
            return GLib.SOURCE_CONTINUE;
        });
        this._updateMenuTimeOut = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, UPDATE_MENU_SECONDS, () => {
            this._updateTimerMenuTexts();
            return GLib.SOURCE_CONTINUE;
        });
        
        // Schedule daily activation and deactivation
        this._scheduleTimerActivation();
    }

    check() {
        const currentTime = new Date();
        
        // Check each active timer - iterate backwards to safely remove items
        for (let i = this._activeTimers.length - 1; i >= 0; i--) {
            const activeTimer = this._activeTimers[i];
            
            if (activeTimer.endTime < currentTime && !activeTimer.notified) {
                // Validate timer index bounds
                if (!this._timers || activeTimer.timerIndex >= this._timers.length || activeTimer.timerIndex < 0) {
                    console.warn(`Invalid timer index: ${activeTimer.timerIndex}`);
                    this._activeTimers.splice(i, 1);
                    continue;
                }
                
                const timer = this._timers[activeTimer.timerIndex];
                console.log(`Notification for timer ${activeTimer.timerIndex}: ${timer.name}`);
                
                const source = new MessageTray.Source({
                    title: 'Workday Reminder',
                    icon_name: 'alarm-symbolic'
                });
                Main.messageTray.add(source);

                const notification = new MessageTray.Notification({
                    source,
                    title: `${timer.name} Reminder`,
                    body: timer.message,
                    urgency: MessageTray.Urgency.CRITICAL,
                });
                
                const accept = () => {
                    console.log("Accept");
                    this.addNewTimer(activeTimer.timerIndex, timer.timeBetweenNotifications);
                };
                
                const decline = () => {
                    console.log("Decline");
                    this.addNewTimer(activeTimer.timerIndex, timer.extraTime);
                };
                
                // Clicking Notification X button
                notification.connect('dismissed', decline);
                // Clicking the Notification itself
                notification.connect('activated', decline);
                notification.addAction(timer.successButtonText, accept);
                notification.addAction('Wait a bit', decline);

                source.addNotification(notification);
                activeTimer.notified = true;
                
                // Remove this timer from active timers after notification
                this._activeTimers.splice(i, 1);
            }
        }
    }

    addNewTimer(timerIndex, minutes) {
        // Validate inputs
        if (typeof timerIndex !== 'number' || typeof minutes !== 'number') {
            console.warn('Invalid timer parameters:', { timerIndex, minutes });
            return;
        }
        
        if (!this._timers || timerIndex < 0 || timerIndex >= this._timers.length) {
            console.warn('Invalid timer index:', timerIndex);
            return;
        }
        
        const startTime = new Date();
        const endTime = new Date();
        // SetMinutes manages the overflow 
        endTime.setMinutes(startTime.getMinutes() + minutes);
        
        // Remove any existing timer for this timer index
        this._activeTimers = this._activeTimers.filter(timer => timer.timerIndex !== timerIndex);
        
        // Add new timer
        this._activeTimers.push({
            timerIndex: timerIndex,
            startTime: startTime,
            endTime: endTime,
            notified: false
        });
        
        // Update the label immediately
        if (this._label) {
            this._label.set_text(this.getCurrentTimerName());
        }
        
        // Immediately update menu texts to show new remaining time
        this._updateTimerMenuTexts();
    }

    calculatePercentageDone() {
        if (!this._activeTimers || this._activeTimers.length === 0) {
            return 0;
        }
        
        // Calculate percentage for the timer that finishes next (earliest end time)
        const time = new Date();
        const nextToFinish = this._activeTimers.reduce((earliest, current) => 
            current.endTime < earliest.endTime ? current : earliest
        );
        
        const done = (time - nextToFinish.startTime) / (nextToFinish.endTime - nextToFinish.startTime);
        return Math.min(0.999, done);
    }

    getCurrentTimerName() {
        if (!this._activeTimers || this._activeTimers.length === 0) {
            return 'No Timer';
        }
        
        // Get name for the timer that finishes next (earliest end time)
        const nextToFinish = this._activeTimers.reduce((earliest, current) => 
            current.endTime < earliest.endTime ? current : earliest
        );
        
        if (!this._timers || nextToFinish.timerIndex >= this._timers.length || nextToFinish.timerIndex < 0) {
            return 'Unknown';
        }
        
        return this._timers[nextToFinish.timerIndex].name || 'Timer';
    }

    getRemainingTimeForTimer(timerIndex) {
        if (!this._activeTimers || this._activeTimers.length === 0) {
            return null;
        }
        
        const activeTimer = this._activeTimers.find(timer => timer.timerIndex === timerIndex);
        if (!activeTimer) {
            return null;
        }
        
        const currentTime = new Date();
        const remainingMs = activeTimer.endTime - currentTime;
        
        if (remainingMs <= 0) {
            return 0;
        }
        
        return Math.ceil(remainingMs / (1000 * 60)); // Convert to minutes and round up
    }

    openPreferences() {
        try {
            // Use the built-in openPreferences method from Extension class
            super.openPreferences();
        } catch (e) {
            console.warn('Failed to open preferences:', e);
            // Fallback: just log that preferences were requested
            console.log('Preferences requested but could not be opened');
        }
    }

    stopAllTimers() {
        // Clear all active timers
        this._activeTimers = [];
        
        // Update the label
        if (this._label) {
            this._label.set_text('No Timer');
        }
        
        // Force repaint to show empty progress
        if (this._icon) {
            this._icon.queue_repaint();
        }
        
        // Immediately update menu texts to remove remaining time indicators
        this._updateTimerMenuTexts();
        
        console.log('All timers stopped');
    }

    _parseTimeString(timeString) {
        const [hour, minute] = timeString.split(':').map(Number);
        return { hour, minute };
    }

    _calculateTimeUntilTarget(targetTimeString) {
        const now = new Date();
        const target = new Date(now);
        const { hour, minute } = this._parseTimeString(targetTimeString);
        
        // Set to target time today
        target.setHours(hour, minute, 0, 0);
        
        // If it's already past target time today, set to target time tomorrow
        if (now >= target) {
            target.setDate(target.getDate() + 1);
        }
        
        return target.getTime() - now.getTime();
    }

    _isWithinActiveHours() {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTimeInMinutes = currentHour * 60 + currentMinute;
        
        const activateTime = this._settings.get_string('activate-time');
        const deactivateTime = this._settings.get_string('deactivate-time');
        
        const { hour: activateHour, minute: activateMinute } = this._parseTimeString(activateTime);
        const { hour: deactivateHour, minute: deactivateMinute } = this._parseTimeString(deactivateTime);
        
        const activateTimeInMinutes = activateHour * 60 + activateMinute;
        const deactivateTimeInMinutes = deactivateHour * 60 + deactivateMinute;
        
        // Handle cases where deactivate time is next day (e.g., 23:00 to 07:00)
        if (deactivateTimeInMinutes <= activateTimeInMinutes) {
            // Time span crosses midnight
            return currentTimeInMinutes >= activateTimeInMinutes || currentTimeInMinutes < deactivateTimeInMinutes;
        } else {
            // Normal case (e.g., 07:00 to 16:00)
            return currentTimeInMinutes >= activateTimeInMinutes && currentTimeInMinutes < deactivateTimeInMinutes;
        }
    }

    _startAllTimers() {
        // Only start timers if we're within active hours
        if (!this._isWithinActiveHours()) {
            console.log('Not within active hours - timers not started');
            return;
        }
        
        // Start all timers automatically
        if (this._timers && this._timers.length > 0) {
            this._timers.forEach((timer, index) => {
                if (timer && typeof timer.timeBetweenNotifications === 'number') {
                    this.addNewTimer(index, timer.timeBetweenNotifications);
                }
            });
        }
        console.log('All timers started');
    }

    _checkForMissedActivation() {
        // Check if we missed the activation time while system was suspended
        const now = new Date();
        const lastActivationKey = 'last-activation-date';
        
        try {
            const lastActivationString = this._settings.get_string(lastActivationKey);
            const lastActivationDate = lastActivationString ? new Date(lastActivationString) : null;
            
            const activateTime = this._settings.get_string('activate-time');
            const { hour, minute } = this._parseTimeString(activateTime);
            
            // Get today's activation time
            const todayActivation = new Date(now);
            todayActivation.setHours(hour, minute, 0, 0);
            
            // If it's past activation time today and we haven't activated today, and we're within active hours
            if (now >= todayActivation && (!lastActivationDate || lastActivationDate < todayActivation) && this._isWithinActiveHours()) {
                console.log('Missed activation detected - performing activation now');
                this.stopAllTimers();
                this._startAllTimers();
                
                // Store today's activation
                this._settings.set_string(lastActivationKey, now.toISOString());
            }
        } catch (e) {
            console.warn('Error checking for missed activation:', e);
        }
    }

    _scheduleTimerActivation() {
        // Cancel existing timeouts
        if (this._activationTimeOut) {
            GLib.Source.remove(this._activationTimeOut);
        }
        if (this._deactivationTimeOut) {
            GLib.Source.remove(this._deactivationTimeOut);
        }
        
        const activateTime = this._settings.get_string('activate-time');
        const deactivateTime = this._settings.get_string('deactivate-time');
        
        // Schedule activation
        const msUntilActivation = this._calculateTimeUntilTarget(activateTime);
        const secondsUntilActivation = Math.ceil(msUntilActivation / 1000);
        
        console.log(`Scheduling timer activation in ${secondsUntilActivation} seconds (${Math.ceil(msUntilActivation / 1000 / 60 / 60)} hours) at ${activateTime}`);
        
        this._activationTimeOut = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secondsUntilActivation, () => {
            console.log(`Timer activation at ${activateTime} triggered`);
            this.stopAllTimers();
            // Small delay to ensure stopping is complete
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._startAllTimers();
                
                // Store the activation timestamp
                const now = new Date();
                this._settings.set_string('last-activation-date', now.toISOString());
                
                // Schedule the next activation
                this._scheduleTimerActivation();
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
        
        // Schedule deactivation
        const msUntilDeactivation = this._calculateTimeUntilTarget(deactivateTime);
        const secondsUntilDeactivation = Math.ceil(msUntilDeactivation / 1000);
        
        console.log(`Scheduling timer deactivation in ${secondsUntilDeactivation} seconds (${Math.ceil(msUntilDeactivation / 1000 / 60 / 60)} hours) at ${deactivateTime}`);
        
        this._deactivationTimeOut = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secondsUntilDeactivation, () => {
            console.log(`Timer deactivation at ${deactivateTime} triggered`);
            this.stopAllTimers();
            
            // Store the deactivation timestamp
            const now = new Date();
            this._settings.set_string('last-deactivation-date', now.toISOString());
            
            // Schedule the next deactivation
            this._scheduleTimerActivation();
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        // Remove timeouts
        if (this._repaintTimeOut) {
            GLib.Source.remove(this._repaintTimeOut);
            this._repaintTimeOut = null;
        }
        if (this._checkTimeOut) {
            GLib.Source.remove(this._checkTimeOut);
            this._checkTimeOut = null;
        }
        if (this._updateMenuTimeOut) {
            GLib.Source.remove(this._updateMenuTimeOut);
            this._updateMenuTimeOut = null;
        }
        if (this._activationTimeOut) {
            GLib.Source.remove(this._activationTimeOut);
            this._activationTimeOut = null;
        }
        if (this._deactivationTimeOut) {
            GLib.Source.remove(this._deactivationTimeOut);
            this._deactivationTimeOut = null;
        }
        
        // Disconnect settings connection
        if (this._settingsConnection) {
            this._settings.disconnect(this._settingsConnection);
            this._settingsConnection = null;
        }
        
        // Destroy timer menu items
        if (this._timerMenuItems) {
            this._timerMenuItems.forEach(item => {
                item.destroy();
            });
            this._timerMenuItems = null;
        }
        
        // Remove indicator from panel and destroy it
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        
        // Clear all references
        this._settings = null;
        this._timers = null;
        this._activeTimers = null;
        this._icon = null;
        this._label = null;
        this._container = null;
    }
}

