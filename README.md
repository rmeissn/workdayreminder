# Workday Reminder

A GNOME Shell extension that helps you maintain healthy work habits by providing customizable reminders throughout your workday.

## Features

- **Multiple Customizable Timers**: Set up different types of reminders (breaks, stand-ups, hydration, etc.)
- **Smart Scheduling**: Automatically activates during work hours and deactivates after hours
- **Visual Progress Indicator**: Panel icon shows progress of active timers with a circular progress bar
- **Interactive Notifications**: Choose how long to postpone reminders with custom action buttons
- **Flexible Configuration**: Fully configurable through GNOME preferences

## Installation

### From Source

1. Clone this repository:

   ```bash
   git clone https://github.com/rmeissn/workdayreminder.git
   cd workdayreminder
   ```
2. Install the extension:

   ```bash
   chmod +x install_extension.sh
   ./install_extension.sh
   ```
3. Enable the extension:

   ```bash
   gnome-extensions enable workdayreminder@rmeissn.gitlab.io
   ```

## Configuration

Access preferences through the extension's panel menu or GNOME Extensions app.

### Timer Settings

- **Name**: Display name for your reminder
- **Interval**: Time between notifications (in minutes)
- **Message**: Custom reminder text
- **Extra Time**: Additional delay when postponing (in minutes)
- **Success Button**: Custom text for the "completed" action

### Schedule Settings

- **Activate Time**: When to start timers each day (default: 07:00)
- **Deactivate Time**: When to stop timers each day (default: 16:00)

### Example Timer Configurations

```json
[
  {
    "name": "Pomodoro Break",
    "timeBetweenNotifications": 25,
    "extraTime": 5,
    "message": "Time for a 5-minute break!",
    "successButtonText": "Taking a breake now!"
  },
  {
    "name": "Stand Up",
    "timeBetweenNotifications": 60,
    "extraTime": 10,
    "message": "Stand up and stretch!",
    "successButtonText": "I'll do my best"
  }
]
```

## Usage

- **Panel Icon**: Shows the name of the next timer and visual progress
- **Panel Menu**: Reset individual timers or stop all timers
- **Notifications**: When a timer expires, choose to reset it or wait a bit longer
- **Auto-Management**: Timers automatically start/stop based on your work schedule

## Requirements

- GNOME Shell 48+
- Linux distribution with GNOME desktop environment

## Contributing

Contributions are welcome! Please feel free to submit issues, feature requests, or pull requests.

## License

This project is open source. Feel free to use, modify, and distribute according to your needs.

## Support

If you encounter any bugs or have suggestions for improvements, please [open an issue](https://github.com/rmeissn/workdayreminder/issues) on GitHub.
