import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ExamplePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // Aarrays to track signal handlers and timeouts for cleanup
        this._signalConnections = [];
        this._activeTimeouts = [];

        // Clean up all object references when window closes
        window.connect('close-request', () => {
            this._cleanup();
        });

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
        const addTimerGroup = new Adw.PreferencesGroup({
            title: 'Timer Management',
        });
        page.add(addTimerGroup);

        // Add button row
        const addButtonRow = new Adw.ActionRow({
            title: 'Add new timer',
            subtitle: 'Create a new timer with custom settings',
        });
        
        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        const addButtonHandlerId = addButton.connect('clicked', () => this._addNewTimer());
        this._signalConnections.push({ object: addButton, handlerId: addButtonHandlerId });
        addButtonRow.add_suffix(addButton);
        
        addTimerGroup.add(addButtonRow);

        // Store reference to the page for adding timer groups
        this._page = page;

        // Keep track of timer groups for easier removal
        this._timerGroups = [];

        // Load and display existing timers
        this._refreshTimersList();
    }

    _loadTimers() {
        const defaultTimer = {"name": "Timer 1", "timeBetweenNotifications": 20, "extraTime": 5, "message": "Time for a break!", "successButtonText": "Got it"};
        try {
            const timers = JSON.parse(this._settings.get_string('timers'));
            return (timers && timers.length > 0) ? timers : [defaultTimer];
        } catch (e) {
            console.warn('Failed to load timers:', e);
            return [defaultTimer];
        }
    }

    _saveTimers() {
        this._settings.set_string('timers', JSON.stringify(this._timers));
    }

    _addNewTimer() {
        const maxTimerNumber = Math.max(0, ...this._timers.map(timer => {
            const match = timer.name.match(/Timer (\d+)/);
            return match ? parseInt(match[1]) : 0;
        }));
        
        this._timers.push({
            name: `Timer ${maxTimerNumber + 1}`,
            timeBetweenNotifications: 20,
            extraTime: 5,
            message: "Time for a break!",
            successButtonText: "Got it"
        });
        
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
        // Clean up signal handlers for widgets being removed
        this._signalConnections = this._signalConnections.filter(({ object }) => {
            // Check if the object is still part of the current timer groups
            let keepConnection = true;
            for (const group of this._timerGroups) {
                if (this._isWidgetInGroup(object, group)) {
                    keepConnection = false;
                    break;
                }
            }
            return keepConnection;
        });
        
        this._timerGroups.forEach(group => this._page.remove(group));
        this._timerGroups = [];
        this._timers.forEach((timer, index) => this._createTimerGroup(timer, index));
    }

    _isWidgetInGroup(widget, group) {
        // Helper method to check if a widget belongs to a group, this is a simplified check
        try {
            let current = widget;
            while (current) {
                if (current === group) return true;
                current = current.get_parent();
            }
        } catch (e) {
            // Widget might be destroyed
        }
        return false;
    }

    _createTimerGroup(timer, index) {
        const timerGroup = new Adw.PreferencesGroup({});
        this._page.add(timerGroup);
        this._timerGroups.push(timerGroup);

        // Timer name row with delete button
        const nameRow = this._createEntryRow('Timer Name', timer.name, index, 'name');
        if (this._timers.length > 1) {
            const deleteButton = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['destructive-action'],
                tooltip_text: 'Delete this timer',
            });
            const deleteHandlerId = deleteButton.connect('clicked', () => this._removeTimer(index));
            this._signalConnections.push({ object: deleteButton, handlerId: deleteHandlerId });
            nameRow.add_suffix(deleteButton);
        }
        timerGroup.add(nameRow);

        // Add other rows
        timerGroup.add(this._createSpinRow('Time between Notifications', 'How often to notify you (in minutes)', timer.timeBetweenNotifications, [1, 1440, 1], index, 'timeBetweenNotifications'));
        timerGroup.add(this._createSpinRow('Time to add when postponing', 'How much time to wait after postponing the notification (in minutes)', timer.extraTime, [1, 1440, 1], index, 'extraTime'));
        timerGroup.add(this._createEntryRow('Notification Message', timer.message || 'Time for a break!', index, 'message'));
        timerGroup.add(this._createEntryRow('Success Button Text', timer.successButtonText || 'Got it', index, 'successButtonText'));
    }

    _createSpinRow(title, subtitle, value, range, index, property) {
        const row = Adw.SpinRow.new_with_range(...range);
        row.title = title;
        row.subtitle = subtitle;
        row.value = value;
        const handlerId = row.connect('changed', () => this._updateTimer(index, property, row.get_value()));
        this._signalConnections.push({ object: row, handlerId });
        return row;
    }

    _createEntryRow(title, text, index, property) {
        const row = new Adw.EntryRow({ title, text: text || '' });
        const handlerId = row.connect('changed', () => this._updateTimer(index, property, row.get_text()));
        this._signalConnections.push({ object: row, handlerId });
        return row;
    }

    _createTimeRow(title, subtitle, settingKey) {
        const timeRow = new Adw.ActionRow({ title, subtitle });
        const timeBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 3,
            valign: Gtk.Align.CENTER,
            css_classes: ['linked'],
        });

        const hourSpin = this._createTimeSpinner(0, 23, 7);
        const minuteSpin = this._createTimeSpinner(0, 59, 0);
        const separatorLabel = new Gtk.Label({ label: ':', css_classes: ['dim-label'] });

        timeBox.append(hourSpin);
        timeBox.append(separatorLabel);
        timeBox.append(minuteSpin);

        // Load current setting
        const currentTime = this._settings.get_string(settingKey);
        if (currentTime) {
            const [hour, minute] = currentTime.split(':').map(Number);
            if (!isNaN(hour) && !isNaN(minute)) {
                hourSpin.set_value(hour);
                minuteSpin.set_value(minute);
            }
        }

        // Debounced update handler
        let timeoutId = null;
        const updateTime = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                // Remove the old timeout from tracking
                const index = this._activeTimeouts.indexOf(timeoutId);
                if (index > -1) this._activeTimeouts.splice(index, 1);
            }
            
            timeoutId = setTimeout(() => {
                // Add null check to prevent errors after cleanup
                if (this._settings) {
                    const timeString = `${hourSpin.get_value().toString().padStart(2, '0')}:${minuteSpin.get_value().toString().padStart(2, '0')}`;
                    this._settings.set_string(settingKey, timeString);
                }
                // Remove timeout from tracking once it's executed
                const index = this._activeTimeouts.indexOf(timeoutId);
                if (index > -1) this._activeTimeouts.splice(index, 1);
            }, 200);
            
            // Track the new timeout
            this._activeTimeouts.push(timeoutId);
        };

        const hourHandlerId = hourSpin.connect('value-changed', updateTime);
        const minuteHandlerId = minuteSpin.connect('value-changed', updateTime);
        this._signalConnections.push({ object: hourSpin, handlerId: hourHandlerId });
        this._signalConnections.push({ object: minuteSpin, handlerId: minuteHandlerId });
        timeRow.add_suffix(timeBox);
        return timeRow;
    }

    _createTimeSpinner(lower, upper, value) {
        const spinner = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({ lower, upper, step_increment: 1 }),
            value,
            digits: 0,
            numeric: true,
            wrap: true,
            width_chars: 2,
        });
        
        const outputHandlerId = spinner.connect('output', () => {
            spinner.set_text(spinner.get_value().toString().padStart(2, '0'));
            return true;
        });
        this._signalConnections.push({ object: spinner, handlerId: outputHandlerId });
        
        return spinner;
    }

    _cleanup() {
        // Clear all active timeouts
        this._activeTimeouts.forEach(timeoutId => {
            if (timeoutId) clearTimeout(timeoutId);
        });
        this._activeTimeouts = [];

        // Disconnect all signal handlers
        this._signalConnections.forEach(({ object, handlerId }) => {
            if (object && handlerId) {
                try {
                    object.disconnect(handlerId);
                } catch (e) {
                    console.warn('Failed to disconnect signal handler:', e);
                }
            }
        });
        this._signalConnections = [];

        // Clear object references
        this._settings = null;
        this._timers = null;
        this._page = null;
        this._timerGroups = null;
    }
}