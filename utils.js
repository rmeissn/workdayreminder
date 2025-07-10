import GLib from 'gi://GLib';

// Constants
export const REPAINT_SECONDS = 10;
export const CHECK_TIMER_SECONDS = 10;
export const UPDATE_MENU_SECONDS = 30;
export const MAX_RESTORE_MINUTES = 15;

// Debug mode configuration
export const DEBUG_MODE = GLib.getenv('WORKDAY_REMINDER_DEBUG') === '1' || 
                          GLib.getenv('G_MESSAGES_DEBUG') === 'all';

// Debug logging function
export const debugLog = (message, ...args) => {
    if (DEBUG_MODE) console.log(`[WorkdayReminder Debug] ${message}`, ...args);
};

// Utility functions
export const parseTime = timeString => timeString.split(':').map(Number);

export const timeToMinutes = (hour, minute) => hour * 60 + minute;

export const calculateTimeUntil = (timeString) => {
    const now = new Date();
    const target = new Date(now);
    const [hour, minute] = parseTime(timeString);
    target.setHours(hour, minute, 0, 0);
    if (now >= target) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
};

export const repaint = (area, percentageDone) => {
    const context = area.get_context();
    const [width, height] = area.get_surface_size();
    const [x, y, r] = [width / 2, height / 2, width / 2.5];
    
    // Background circle
    context.arc(x, y, r, 0, 2 * Math.PI);
    context.setSourceRGBA(148/255, 148/255, 148/255, 1);
    context.stroke();
    
    // Progress arc
    const startPoint = 1.5 * Math.PI;
    const endPoint = (startPoint + 2 * Math.PI * percentageDone) % (2 * Math.PI);
    context.arc(x, y, r, startPoint, endPoint);
    context.setSourceRGBA(242/255, 242/255, 242/255, 1);
    context.stroke();
    context.$dispose();
};

/**
 * Check if current time is within specified active hours
 */
export const isWithinActiveHours = (activateTime, deactivateTime) => {
    const now = new Date();
    const currentMinutes = timeToMinutes(now.getHours(), now.getMinutes());
    const [activateHour, activateMinute] = parseTime(activateTime);
    const [deactivateHour, deactivateMinute] = parseTime(deactivateTime);
    const activateMinutes = timeToMinutes(activateHour, activateMinute);
    const deactivateMinutes = timeToMinutes(deactivateHour, deactivateMinute);
    
    return deactivateMinutes <= activateMinutes
        ? currentMinutes >= activateMinutes || currentMinutes < deactivateMinutes
        : currentMinutes >= activateMinutes && currentMinutes < deactivateMinutes;
};
