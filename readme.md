
# eckPosEmulator 

**An ESC/POS Network & Serial Printer Emulator by XETRON (xelth.com/xetron)**

This Node.js application emulates an ESC/POS (Epson Standard Code for Printers) printer. Instead of printing to physical paper, it captures the raw ESC/POS data sent by a Point of Sale (POS) system or other application, parses it, and saves the output as structured text files containing both the printable text and tagged ESC/POS commands. It can listen for print jobs via TCP/IP network connections and/or serial (COM) ports, providing distinct audible notifications for each.

## Features

*   **Network Listener:** Acts as a TCP server listening on a configurable printer port (default: 9100).
*   **Serial Port Listener:** Can listen on a specified serial (COM) port (e.g., COM2, COM5) at a configured baud rate.
*   **Distinct Audible Notifications:** Produces different sound alerts for data received via TCP versus Serial, using PowerShell's `[Console]::Beep()` for reliable sound on Windows without triggering common intrusive system sounds. Includes a sound queueing mechanism for events arriving in rapid succession.
*   **ESC/POS Parsing:** Implements a custom parser to interpret incoming ESC/POS byte streams.
*   **Text Extraction:** Decodes and extracts printable text from the ESC/POS data, attempting to respect character encodings specified by `ESC t n` commands (with support for CP437, CP850, CP866, Windows-1251, Windows-1252, etc.).
*   **Command Tagging:** Identifies common ESC/POS commands and represents them as human-readable tags (e.g., `<Initialize Printer>`, `<Line Feed>`, `<Partial Cut>`) interspersed with the extracted text.
*   **File Output:** For each print job received (from TCP or Serial):
    *   Saves the original raw binary ESC/POS data (`*_pos-input-original.bin`).
    *   Saves the parsed output (text + command tags) as a UTF-8 encoded text file (`*_receipt-rich-text_UTF-8.txt`).
    *   Saves a plain text version (tags removed, basic newlines preserved) re-encoded into Windows-1251 (`*_receipt-plain-text_WINDOWS-1251.txt`).
*   **Console Logging:** Provides real-time logging of client connections (TCP) or serial port activity, data reception, sound notifications, and a formatted version of the parsed rich text output for immediate review.
*   **Organized File Naming:** Output files for each print job are prefixed with a common ISO timestamp and source identifier (IP address or COM port) for easy correlation.
*   **Configurable Listeners:** TCP and Serial listeners can be enabled/disabled individually via flags in the `emulator.js` script.
*   **Robust Error Handling:** Attempts to continue running other listeners if one fails (e.g., COM port busy but TCP listener can still operate).

## Purpose

This emulator is designed for:

*   **Debugging POS Systems:** Understanding the exact ESC/POS commands a POS system sends, with clear audible distinction for network or serial data.
*   **Developing Printer-Interfacing Applications:** Testing applications that generate ESC/POS without needing a physical printer.
*   **Data Analysis for LLMs:** Providing structured textual representations of receipts for analysis by Large Language Models.
*   **Troubleshooting Printer Issues:** Comparing expected ESC/POS output with what a physical printer produces.
*   **Testing Serial Port Communication:** Emulating a serial-connected printer for applications that use COM ports.

## How it Works

1.  The Node.js script starts listeners for TCP/IP and/or Serial (COM) ports based on configuration.
2.  A POS system or application sends print jobs to the emulator's TCP endpoint or configured COM port.
3.  Upon receiving data, the emulator:
    *   Plays a distinct audible notification (customizable frequency/duration via PowerShell `[Console]::Beep()`) indicating the source (TCP or Serial). A sound queue handles nearly simultaneous events to ensure each notification is played sequentially.
    *   Processes the data at the end of the TCP connection or after a timeout for serial data.
4.  The custom parser (`parseEscPosToRichText`) processes the received byte buffer, converting commands to tags and decoding text.
5.  The structured "rich text" is logged to the console and saved to files, along with the original raw binary data and a plain text Windows-1251 version.

## Output File Structure

For each print job, files are generated in the `receipts_output` directory (e.g., `2025-06-13T10-21-38-012Z_TCP-192.168.13.60_51711_...`):

*   **`..._pos-input-original.bin`**: Raw binary ESC/POS data.
*   **`..._receipt-rich-text_UTF-8.txt`**: Parsed text with command tags (UTF-8).
*   **`..._receipt-plain-text_WINDOWS-1251.txt`**: Plain text version (Windows-1251).

## Requirements

*   Node.js (e.g., v18.x or as targeted by `pkg`)
*   npm (for installing dependencies)
*   Windows Operating System (for PowerShell `[Console]::Beep()` functionality. For other OS, sound notification might fallback or be disabled).
*   `iconv-lite` (for character encoding, included in dependencies)
*   `serialport` (for serial communication, included in dependencies)

## Installation & Setup

1.  **Clone the repository or download the files.**
2.  **Navigate to the project directory** in your terminal.
3.  **Install dependencies:**
    ```bash
    npm install
    ```
4.  **Configure Listeners & Sound (Optional):**
    Open `emulator.js` and adjust constants at the top:
    *   `ENABLE_TCP_LISTENER`, `TCP_PORT`
    *   `ENABLE_SERIAL_LISTENER`, `SERIAL_PORT_PATH`, `SERIAL_BAUD_RATE`
    *   `SOUND_BASE_COOLDOWN_MS`: Cooldown between sound notifications.
    *   Sound parameters (frequency, duration) within the `SoundNotifier` class methods (`playTcpSound`, `playSerialSound`) can be tweaked for preference.
    *   `OUTPUT_DIR_NAME`.

5.  **Setting up Virtual COM Ports for Local Testing (Optional):**
    If sending data from another application on the *same machine* to the emulator's serial listener, use a virtual COM port pair tool like `com0com` for Windows (ensure signed drivers for Win10/11) or `socat` for Linux. (See previous `readme.md` versions for detailed `com0com`/`socat` setup if needed, or the `firewall.md` for `com0com` example command `setupc.exe install PortName=COM1 PortName=COM2`).

## Firewall Configuration (for TCP Listener)

If using the **TCP listener** and connecting from other machines, allow the application through Windows Defender Firewall. Serial (COM) port access typically doesn't require firewall rules.

**Administrator Privileges Required** for modifying firewall rules.

**How to open Command Prompt/PowerShell as Administrator:**
1.  Windows Key, type `cmd` or `powershell`.
2.  Right-click -> "Run as administrator".
3.  UAC: Click "Yes".

**Creating Firewall Rule (Command Prompt, as Administrator):**
(Replace `9100` with `TCP_PORT` if changed)
```batch
netsh advfirewall firewall add rule name="ESC/POS Emulator (TCP 9100)" dir=in action=allow protocol=TCP localport=9100
```
To check: `netsh advfirewall firewall show rule name="ESC/POS Emulator (TCP 9100)"`
To delete: `netsh advfirewall firewall delete rule name="ESC/POS Emulator (TCP 9100)"`

## Running the Emulator

1.  Open terminal/command prompt in the project directory.
2.  Run: `node emulator.js`
3.  Console shows listener status, IP addresses, output directory.
4.  Configure your sending application to the emulator's IP:Port (TCP) or COM port (Serial).
5.  Data reception triggers console logs, file saving, and distinct audible alerts.
6.  Press `Ctrl+C` to stop.

## Building an Executable

Use `pkg` to package into a standalone executable.
1.  Install `pkg` globally: `npm install -g pkg`
2.  From project directory:
    *   Windows x64: `npm run build` (creates `dist/eckPos-emulator.exe`)
    *   All platforms (Win, Linux, macOS x64): `npm run build-all`

The executable is self-contained. `receipts_output` is created relative to the executable. PowerShell must be available on the target Windows system for sound notifications to work as intended.

## Troubleshooting

*   **"Port X is already in use" (TCP):** Change `TCP_PORT` or stop the other application.
*   **"Could not open port COMx" (Serial):** Port in use, non-existent, or permission issue. Check virtual COM setup if used.
*   **No sound (Windows):**
    *   Ensure PowerShell is installed and accessible.
    *   Check system volume and audio output device.
    *   The `execAsync` command for PowerShell might be failing; check console for `[SOUND] PowerShell beep failed` errors. This could be due to execution policies or PowerShell being unavailable in very restricted environments.
*   **No files created:** Check console for directory/file write permission errors. Ensure data is being sent.
*   **Incorrect text decoding:** `initialEncoding` in parser or `ESC t n` commands might need review.
*   **Firewall blocking (TCP):** Ensure rule is correctly added for external connections.

