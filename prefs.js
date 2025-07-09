import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export default class ExamplePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settings = this.getSettings();
        this._timers = this._loadTimers();
        
        // Create a preferences page
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'dialog-information-symbolic',
        });
        window.add(page);

        // Timer schedule group (moved to top)
        const scheduleGroup = new Adw.PreferencesGroup({
            title: 'Timer Schedule',
            description: 'Configure when timers should be automatically activated and deactivated',
        });
        page.add(scheduleGroup);

        // Activation time row
        const activateTimeRow = this._createTimeRow(
            'Activation Time',
            'Time when timers should start in the morning',
            'activate-time'
        );
        scheduleGroup.add(activateTimeRow);

        // Deactivation time row
        const deactivateTimeRow = this._createTimeRow(
            'Deactivation Time', 
            'Time when timers should stop in the evening',
            'deactivate-time'
        );
        scheduleGroup.add(deactivateTimeRow);

        // Add timer button group (moved after schedule)
        this._addTimerGroup = new Adw.PreferencesGroup({
            title: 'Timer Management',
        });
        page.add(this._addTimerGroup);

        // Add button row
        this._addButtonRow = new Adw.ActionRow({
            title: 'Add new timer',
            subtitle: 'Create a new timer with custom settings',
        });
        
        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        addButton.connect('clicked', () => this._addNewTimer());
        this._addButtonRow.add_suffix(addButton);
        
        this._addTimerGroup.add(this._addButtonRow);

        // Store reference to the page for adding timer groups
        this._page = page;

        // Keep track of timer groups for easier removal
        this._timerGroups = [];

        // Load and display existing timers
        this._refreshTimersList();
    }

    _loadTimers() {
        try {
            const timersJson = this._settings.get_string('timers');
            const timers = JSON.parse(timersJson);
            // Ensure we have at least one timer
            if (!timers || timers.length === 0) {
                return [{"name": "Timer 1", "timeBetweenNotifications": 20, "extraTime": 5, "message": "Time for a break!", "successButtonText": "Got it"}];
            }
            return timers;
        } catch (e) {
            console.warn('Failed to load timers:', e);
            return [{"name": "Timer 1", "timeBetweenNotifications": 20, "extraTime": 5, "message": "Time for a break!", "successButtonText": "Got it"}];
        }
    }

    _saveTimers() {
        const timersJson = JSON.stringify(this._timers);
        console.log('Saving timers JSON:', timersJson);
        this._settings.set_string('timers', timersJson);
    }

    _addNewTimer() {
        console.log('Before adding timer - current timers:', JSON.stringify(this._timers));
        
        // Find the highest timer number to avoid duplicates
        let maxTimerNumber = 0;
        this._timers.forEach(timer => {
            const match = timer.name.match(/Timer (\d+)/);
            if (match) {
                const timerNumber = parseInt(match[1]);
                maxTimerNumber = Math.max(maxTimerNumber, timerNumber);
            }
        });
        
        const newTimerNumber = maxTimerNumber + 1;
        const newTimer = {
            name: `Timer ${newTimerNumber}`,
            timeBetweenNotifications: 20,
            extraTime: 5,
            message: "Time for a break!",
            successButtonText: "Got it"
        };
        
        this._timers.push(newTimer);
        console.log('After adding timer - current timers:', JSON.stringify(this._timers));
        this._saveTimers();
        this._refreshTimersList();
    }

    _removeTimer(index) {
        if (this._timers.length > 1) { // Keep at least one timer
            this._timers.splice(index, 1);
            this._saveTimers();
            this._refreshTimersList();
        }
    }

    _updateTimer(index, property, value) {
        if (this._timers[index]) {
            this._timers[index][property] = value;
            this._saveTimers();
        }
    }

    _refreshTimersList() {
        console.log('Refreshing timers list - current timers:', JSON.stringify(this._timers));
        
        // Remove all existing timer groups
        this._timerGroups.forEach(group => {
            this._page.remove(group);
        });
        this._timerGroups = [];

        // Add timer groups
        this._timers.forEach((timer, index) => {
            this._createTimerGroup(timer, index);
        });
    }

    _createTimerGroup(timer, index) {
        // Create a separate group for each timer
        const timerGroup = new Adw.PreferencesGroup({
        });
        this._page.add(timerGroup);
        this._timerGroups.push(timerGroup);

        // Timer name row
        const nameRow = new Adw.EntryRow({
            title: 'Timer Name',
            text: timer.name,
        });
        nameRow.connect('changed', () => {
            this._updateTimer(index, 'name', nameRow.get_text());
        });

        // Delete button for the name row (only show if more than one timer exists)
        if (this._timers.length > 1) {
            const deleteButton = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['destructive-action'],
                tooltip_text: 'Delete this timer',
            });
            deleteButton.connect('clicked', () => this._removeTimer(index));
            nameRow.add_suffix(deleteButton);
        }

        timerGroup.add(nameRow);

        // Time between notifications row
        const breakTimeRow = Adw.SpinRow.new_with_range(1, 1440, 1);
        breakTimeRow.title = 'Time between Notifications';
        breakTimeRow.subtitle = 'How often to notify you (in minutes)';
        breakTimeRow.value = timer.timeBetweenNotifications;
        breakTimeRow.connect('changed', () => {
            this._updateTimer(index, 'timeBetweenNotifications', breakTimeRow.get_value());
        });
        timerGroup.add(breakTimeRow);

        // Extra time row
        const extraTimeRow = Adw.SpinRow.new_with_range(1, 1440, 1);
        extraTimeRow.title = 'Time to add when postponing';
        extraTimeRow.subtitle = 'How much time to wait after postponing the notification (in minutes)';
        extraTimeRow.value = timer.extraTime;
        extraTimeRow.connect('changed', () => {
            this._updateTimer(index, 'extraTime', extraTimeRow.get_value());
        });
        timerGroup.add(extraTimeRow);

        // Message row
        const messageRow = new Adw.EntryRow({
            title: 'Notification Message',
            text: timer.message || 'Time for a break!',
        });
        messageRow.connect('changed', () => {
            this._updateTimer(index, 'message', messageRow.get_text());
        });
        timerGroup.add(messageRow);

        // Success button text row
        const successButtonRow = new Adw.EntryRow({
            title: 'Success Button Text',
            text: timer.successButtonText || 'Got it',
        });
        successButtonRow.connect('changed', () => {
            this._updateTimer(index, 'successButtonText', successButtonRow.get_text());
        });
        timerGroup.add(successButtonRow);
    }

    _createTimeRow(title, subtitle, settingKey) {
        const timeRow = new Adw.ActionRow({
            title: title,
            subtitle: subtitle,
        });

        // Create container for time inputs with improved styling
        const timeBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 3,
            valign: Gtk.Align.CENTER,
            css_classes: ['linked'], // Groups the spinbuttons visually
        });

        // Hour spinner with improved UX
        const hourSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 23,
                step_increment: 1,
            }),
            value: 7,
            digits: 0,
            numeric: true,
            wrap: true, // Allow wrapping from 23 to 0
            width_chars: 2, // Fixed width for consistent layout
        });

        // Separator label with subtle styling
        const separatorLabel = new Gtk.Label({
            label: ':',
            css_classes: ['dim-label'],
        });

        // Minute spinner with improved UX
        const minuteSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 59,
                step_increment: 1,
            }),
            value: 0,
            digits: 0,
            numeric: true,
            wrap: true, // Allow wrapping from 59 to 0
            width_chars: 2, // Fixed width for consistent layout
        });

        // Format values to always show two digits
        hourSpin.connect('output', () => {
            hourSpin.set_text(hourSpin.get_value().toString().padStart(2, '0'));
            return true;
        });

        minuteSpin.connect('output', () => {
            minuteSpin.set_text(minuteSpin.get_value().toString().padStart(2, '0'));
            return true;
        });

        timeBox.append(hourSpin);
        timeBox.append(separatorLabel);
        timeBox.append(minuteSpin);

        // Load current setting value
        const currentTime = this._settings.get_string(settingKey);
        if (currentTime) {
            const [hour, minute] = currentTime.split(':').map(Number);
            if (!isNaN(hour) && !isNaN(minute)) {
                hourSpin.set_value(hour);
                minuteSpin.set_value(minute);
            }
        }

        // Connect change handlers with debouncing
        let timeoutId = null;
        const updateTime = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            timeoutId = setTimeout(() => {
                const hour = hourSpin.get_value().toString().padStart(2, '0');
                const minute = minuteSpin.get_value().toString().padStart(2, '0');
                const timeString = `${hour}:${minute}`;
                this._settings.set_string(settingKey, timeString);
            }, 200); // Small delay to avoid excessive updates
        };

        hourSpin.connect('value-changed', updateTime);
        minuteSpin.connect('value-changed', updateTime);

        timeRow.add_suffix(timeBox);
        return timeRow;
    }
}