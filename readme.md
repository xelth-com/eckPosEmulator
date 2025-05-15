# ESC/POS Printer Emulator (Text & Command Tag Output)

This Node.js application emulates an ESC/POS (Epson Standard Code for Printers) network printer. Instead of printing to physical paper, it captures the raw ESC/POS data sent by a Point of Sale (POS) system or other application, parses it, and saves the output as structured text files containing both the printable text and tagged ESC/POS commands.

## Features

*   **Network Listener:** Acts as a TCP server listening on a standard printer port (default: 9100).
*   **ESC/POS Parsing:** Implements a custom parser to interpret incoming ESC/POS byte streams.
*   **Text Extraction:** Decodes and extracts printable text from the ESC/POS data, attempting to respect character encodings specified by `ESC t n` commands.
*   **Command Tagging:** Identifies common ESC/POS commands and represents them as human-readable tags (e.g., `<Initialize Printer>`, `<Line Feed>`, `<Partial Cut>`) interspersed with the extracted text.
*   **File Output:** For each print job received:
    *   Saves the original raw binary ESC/POS data (`*_pos-input-original.bin`).
    *   Saves the parsed output (text + command tags) as a UTF-8 encoded text file (`*_receipt-rich-text_UTF-8.txt`).
    *   Optionally saves the parsed output re-encoded into Windows-1251 (`*_receipt-rich-text_WINDOWS-1251.txt`).
*   **Console Logging:** Provides real-time logging of client connections, data reception, and a formatted version of the parsed rich text output for immediate review.
*   **Organized File Naming:** Output files for each print job are prefixed with a common ISO timestamp for easy correlation.

## Purpose

This emulator is designed for:

*   **Debugging POS Systems:** Understanding the exact ESC/POS commands a POS system sends for different types of receipts or operations.
*   **Developing Printer-Interfacing Applications:** Testing applications that generate ESC/POS without needing a physical printer.
*   **Data Analysis for LLMs:** Providing structured textual representations of receipts (including control commands) that can be ingested and analyzed by Large Language Models for tasks such as:
    *   Receipt data extraction.
    *   Understanding printing patterns.
    *   Training models on receipt layouts and command sequences.
*   **Troubleshooting Printer Issues:** Comparing expected ESC/POS output with what a physical printer produces.

## How it Works

1.  The Node.js script starts a TCP server that listens for incoming connections on the specified port (e.g., 9100).
2.  A POS system is configured to send print jobs to the IP address of the machine running the emulator, on the listener port.
3.  When the POS system "prints," it establishes a TCP connection and sends a stream of ESC/POS command bytes.
4.  The emulator receives these bytes.
5.  Upon connection close (indicating end of print job), the custom parser (`parseEscPosToRichText`) processes the received byte buffer:
    *   It iterates through the bytes, identifying known ESC/POS command sequences.
    *   Recognized commands are converted into descriptive tags (e.g., `<Align Center>`).
    *   Text segments between commands are decoded using the appropriate character set (attempting to follow `ESC t n` commands, with a configurable default).
    *   The parser maintains a list of output lines, which can be either decoded text or command tags.
6.  The resulting structured "rich text" (text mixed with command tags) is logged to the console and saved to text files.
7.  The original raw binary data is also saved for reference.

## Output File Structure

For each print job, the following files are typically generated in the `receipts_output` directory, prefixed with a timestamp (e.g., `2025-05-15T08-10-49-271Z`):

*   **`{timestamp}_pos-input-original.bin`**:
    *   Content: Raw binary ESC/POS data exactly as received from the POS system.
    *   Use: For low-level analysis, debugging, or replaying to other parsers/printers.

*   **`{timestamp}_receipt-rich-text_UTF-8.txt`**:
    *   Content: A textual representation of the receipt. Printable text is decoded (primarily from the encoding specified by `ESC t n` or a default like CP866) and interspersed with human-readable tags for ESC/POS commands. Lines are separated by newlines.
    *   Encoding: UTF-8.
    *   Use: Primary output for analysis by humans or LLMs. The tags provide context about formatting, control operations (like cuts or drawer kicks), and character set changes.

*   **`{timestamp}_receipt-rich-text_WINDOWS-1251.txt`**:
    *   Content: Same as the UTF-8 rich text file, but the entire string content is re-encoded and saved as Windows-1251.
    *   Encoding: Windows-1251 (CP1251).
    *   Use: If a specific system requires input in Windows-1251 Cyrillic.

**Example content of a `_receipt-rich-text_UTF-8.txt` file:**