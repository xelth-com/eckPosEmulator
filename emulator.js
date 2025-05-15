// emulator.js (Corrected encoding based on printer's codepage list)
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const iconv = require('iconv-lite'); // For text decoding

// Quick check if iconv-lite supports cp858
// console.log("iconv-lite support for 'cp858':", iconv.encodingExists('cp858'));
// console.log("iconv-lite support for 'ibm858':", iconv.encodingExists('ibm858'));
// If 'cp858' is false, but 'ibm858' is true, use 'ibm858' in the parser.

const PORT = 9100;
const OUTPUT_DIR_NAME = 'receipts_output';
const OUTPUT_DIR = path.join(__dirname, OUTPUT_DIR_NAME);

if (!fs.existsSync(OUTPUT_DIR)) {
    try {
        fs.mkdirSync(OUTPUT_DIR);
        console.log(`Receipts directory created: ${OUTPUT_DIR}`);
    } catch (err) {
        console.error(`Failed to create receipts directory ${OUTPUT_DIR}:`, err);
        process.exit(1);
    }
}

/**
 * Advanced ESC/POS parser to extract text and log commands as tags.
 * @param {Buffer} escposBuffer - The raw ESC/POS data.
 * @param {string} defaultEncoding - Default encoding if ESC t n is not found or not recognized early.
 * @returns {string} - The extracted text mixed with command tags, lines separated by '\n'.
 */
function parseEscPosToRichText(escposBuffer, defaultEncoding = 'cp437') { // Basic DOS as ultimate fallback
    let outputLines = [];
    let currentTextBuffer = [];
    let i = 0;
    let currentCodepage = defaultEncoding; // This will be updated by ESC t n

    const flushCurrentTextBuffer = () => {
        if (currentTextBuffer.length > 0) {
            try {
                const decodedText = iconv.decode(Buffer.from(currentTextBuffer), currentCodepage);
                if (outputLines.length > 0 && !outputLines[outputLines.length - 1].startsWith('<') && !outputLines[outputLines.length - 1].endsWith('>')) {
                    outputLines[outputLines.length - 1] += decodedText;
                } else {
                    outputLines.push(decodedText);
                }
            } catch (e) {
                console.error(`[Parser] Error decoding line with ${currentCodepage} (bytes: ${Buffer.from(currentTextBuffer).toString('hex')}):`, e.message);
                // Fallback: try to display as latin1 or show hex
                try {
                    outputLines.push(Buffer.from(currentTextBuffer).toString('latin1'));
                } catch {
                    outputLines.push(`[DECODE_ERROR: ${Buffer.from(currentTextBuffer).toString('hex')}]`);
                }
            }
            currentTextBuffer = [];
        }
    };

    const addTag = (tag) => {
        flushCurrentTextBuffer();
        outputLines.push(tag);
    };

    while (i < escposBuffer.length) {
        const byte = escposBuffer[i];

        if (byte === 0x1B) { // ESC - Escape
            flushCurrentTextBuffer();
            const cmdByte = escposBuffer[i + 1];
            if (cmdByte === undefined) { addTag("<Incomplete ESC>"); i++; continue; }

            switch (cmdByte) {
                case 0x40: addTag("<Initialize Printer>"); i += 2; break; // ESC @
                case 0x21: // ESC ! n - Set print mode
                    if (escposBuffer[i + 2] !== undefined) {
                        addTag(`<Set Print Mode (n=0x${escposBuffer[i + 2].toString(16)})>`); i += 3;
                    } else { addTag("<Incomplete ESC !>"); i += 2;}
                    break;
                case 0x45: // ESC E n - Bold
                    if (escposBuffer[i + 2] !== undefined) {
                        addTag(escposBuffer[i + 2] === 1 ? "<Bold On>" : "<Bold Off>"); i += 3; // n=1 for On, n=0 for Off
                    } else { addTag("<Incomplete ESC E>"); i += 2;}
                    break;
                case 0x2D: // ESC - n - Underline
                     if (escposBuffer[i + 2] !== undefined) {
                        const u = escposBuffer[i + 2];
                        if (u === 0 || u === 48) addTag("<Underline Off>");
                        else if (u === 1 || u === 49) addTag("<Underline On (1-dot)>");
                        else if (u === 2 || u === 50) addTag("<Underline On (2-dot)>");
                        else addTag(`<Set Underline (n=${u})>`);
                        i += 3;
                    } else { addTag("<Incomplete ESC ->"); i += 2;}
                    break;
                case 0x4D: // ESC M n - Select Font
                    if (escposBuffer[i + 2] !== undefined) {
                        addTag((escposBuffer[i + 2] === 1 || escposBuffer[i+2] === 49) ? "<Select Font B>" : "<Select Font A>"); i += 3;
                    } else { addTag("<Incomplete ESC M>"); i += 2;}
                    break;
                case 0x74: // ESC t n - Select Character Code Table
                    if (escposBuffer[i + 2] !== undefined) {
                        const cp = escposBuffer[i + 2];
                        addTag(`<Select Code Table (n=${cp})>`);
                        let newCodepage = currentCodepage;
                        switch (cp) { // Based on your printer's list
                            case 0: newCodepage = 'cp437'; break;
                            case 2: newCodepage = 'cp850'; break;
                            case 16: newCodepage = 'windows-1252'; break; // WPC1252
                            case 17: newCodepage = 'cp866'; break;   // PC866 (Cyrillic#2)
                            case 19: newCodepage = 'cp858'; break;   // PC858 (YOUR CASE for German)
                            // Add other relevant codepages from your printer's list
                            // e.g., case 59: newCodepage = 'cp866'; break; // PC866 (Russian)
                            default:
                                console.warn(`[Parser] Unknown codepage ${cp} selected by ESC t. Using previous: ${currentCodepage}`);
                                break;
                        }
                        if (iconv.encodingExists(newCodepage)) {
                            currentCodepage = newCodepage;
                            console.log(`[Parser Debug] Codepage set to: ${currentCodepage} by ESC t ${cp}`);
                        } else {
                            console.warn(`[Parser] Codepage '${newCodepage}' (for ESC t ${cp}) is not supported by iconv-lite. Using previous: ${currentCodepage}`);
                        }
                        i += 3;
                    } else { addTag("<Incomplete ESC t>"); i += 2;}
                    break;
                case 0x61: // ESC a n - Justification
                    if (escposBuffer[i + 2] !== undefined) {
                        const align = escposBuffer[i + 2];
                        if (align === 0 || align === 48) addTag("<Align Left>");
                        else if (align === 1 || align === 49) addTag("<Align Center>");
                        else if (align === 2 || align === 50) addTag("<Align Right>");
                        else addTag(`<Select Justification (n=${align})>`);
                        i += 3;
                    } else { addTag("<Incomplete ESC a>"); i += 2;}
                    break;
                case 0x70: // ESC p m t1 t2 - Pulse Cash Drawer
                    if (i + 4 < escposBuffer.length) {
                        addTag(`<Pulse Drawer (pin=${escposBuffer[i+2]}, onTime=${escposBuffer[i+3]*2}ms, offTime=${escposBuffer[i+4]*2}ms)>`);
                        i += 5;
                    } else { addTag("<Incomplete ESC p>"); i = escposBuffer.length; }
                    break;
                case 0x4A: // ESC J n - Print and Feed n dots
                    if (escposBuffer[i + 2] !== undefined) {
                        addTag(`<Print and Feed Paper (n=${escposBuffer[i + 2]} dots)>`); i += 3;
                    } else { addTag("<Incomplete ESC J>"); i += 2; }
                    break;
                case 0x64: // ESC d n - Print and Feed n Lines
                    if (escposBuffer[i + 2] !== undefined) {
                        addTag(`<Print and Feed Paper (n=${escposBuffer[i + 2]} lines)>`); i += 3;
                    } else { addTag("<Incomplete ESC d>"); i += 2; }
                    break;
                default:
                    addTag(`<Unknown ESC Command (0x1B 0x${cmdByte.toString(16)})>`);
                    i += 2;
                    break;
            }
        } else if (byte === 0x1D) { // GS - Group Separator
            flushCurrentTextBuffer();
            const cmdByte = escposBuffer[i + 1];
            if (cmdByte === undefined) { addTag("<Incomplete GS>"); i++; continue; }

            switch (cmdByte) {
                case 0x42: // GS B n - Invert Printing
                    if (escposBuffer[i + 2] !== undefined) {
                        addTag(escposBuffer[i + 2] === 1 ? "<Invert On>" : "<Invert Off>"); i += 3;
                    } else { addTag("<Incomplete GS B>"); i += 2; }
                    break;
                case 0x21: // GS ! n - Character Size
                    if (escposBuffer[i + 2] !== undefined) {
                        const sizeByte = escposBuffer[i+2];
                        const width = ((sizeByte >> 4) & 0x0F) + 1; // Width multiplier (0-7 means 1x-8x)
                        const height = (sizeByte & 0x0F) + 1;    // Height multiplier (0-7 means 1x-8x)
                        addTag(`<Set Char Size (Wx${width} Hx${height})>`);
                        i += 3;
                    } else { addTag("<Incomplete GS !>"); i += 2; }
                    break;
                case 0x56: // GS V m [n] - Paper Cut
                    const cutMode = escposBuffer[i + 2];
                    if (cutMode !== undefined) {
                        let cutType = "Unknown Cut";
                        if (cutMode === 0x00 || cutMode === 0x30) cutType = "<Full Cut>";
                        else if (cutMode === 0x01 || cutMode === 0x31) cutType = "<Partial Cut>";
                        else if (cutMode === 0x41) cutType = "<Partial Cut (Type A)>"; // Epson specific
                        else if (cutMode === 0x42) cutType = "<Full Cut (Type B)>";   // Epson specific
                        else cutType = `<Paper Cut (mode=0x${cutMode.toString(16)})>`;
                        addTag(cutType);
                        // GS V m usually has one parameter m. Some forms GS V m n have two.
                        // For simplicity, assuming one parameter for now.
                        i += 3; // GS V m
                    } else { addTag("<Incomplete GS V>"); i += 2; }
                    break;
                case 0x2F: // GS / m - Print NV bit image
                     if (escposBuffer[i + 2] !== undefined) {
                        addTag(`<Print NV Bit Image (mode=${escposBuffer[i+2]})>`);
                        i += 3;
                    } else { addTag("<Incomplete GS />"); i += 2; }
                    break;
                // Add more GS commands here if needed
                default:
                    addTag(`<Unknown GS Command (0x1D 0x${cmdByte.toString(16)})>`);
                    i += 2;
                    break;
            }
        } else if (byte === 0x0A) { // LF - Line Feed
            flushCurrentTextBuffer();
            addTag("<Line Feed>");
            i++;
        } else if (byte === 0x0D) { // CR - Carriage Return
            flushCurrentTextBuffer();
            addTag("<Carriage Return>");
            i++;
        } else if (byte >= 0x20 || byte === 0x09) { // Printable characters (including space and TAB)
            currentTextBuffer.push(byte);
            i++;
        } else {
            // Other control characters
            flushCurrentTextBuffer();
            addTag(`<Control Char (0x${byte.toString(16)})>`);
            i++;
        }
    }
    flushCurrentTextBuffer(); // Add any remaining text
    return outputLines.join('\n');
}


const server = net.createServer((socket) => {
    const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`Client connected: ${clientAddress}`);
    let receivedData = Buffer.alloc(0);

    socket.on('data', (chunk) => {
        receivedData = Buffer.concat([receivedData, chunk]);
        console.log(`[${clientAddress}] Received ${chunk.length} bytes.`);
    });

    socket.on('end', () => {
        console.log(`[${clientAddress}] Client disconnected. Total bytes received: ${receivedData.length}.`);
        if (receivedData.length > 0) {
            const baseTimestamp = new Date().toISOString().replace(/[:.]/g, '-');

            const originalRawFilename = `${baseTimestamp}_pos-input-original.bin`;
            const originalRawFilepath = path.join(OUTPUT_DIR, originalRawFilename);
            try {
                fs.writeFileSync(originalRawFilepath, receivedData);
                console.log(`[${clientAddress}] Original POS input saved: ${originalRawFilepath}`);
            } catch (writeError) {
                console.error(`[${clientAddress}] Failed to save original POS input:`, writeError);
            }

            try {
                const dataToParse = receivedData;
                // The parser will now try to set currentCodepage to 'cp858' when it sees ESC t 19.
                // The defaultEncoding is a fallback if no ESC t command is encountered early.
                const richTextOutputForFile = parseEscPosToRichText(dataToParse, 'cp437'); // Fallback to basic DOS page

                // --- BEGIN: Modified Console Output ---
                console.log(`\n============================== START JOB ${baseTimestamp} (${clientAddress}) ==============================`);
                const consoleOutput = richTextOutputForFile
                    .replace(/\n<Line Feed>\n/g, '\n\n')
                    .replace(/<Line Feed>\n/g, '\n')
                    .replace(/\n<Line Feed>/g, '\n')
                    .replace(/<Line Feed>/g, '\n')
                    .replace(/<Carriage Return>/g, '');
                console.log(consoleOutput);
                console.log(`============================== END JOB ${baseTimestamp} (${clientAddress}) ===============================\n`);
                // --- END: Modified Console Output ---

                const richTextUtf8Filename = `${baseTimestamp}_receipt-rich-text_UTF-8.txt`;
                const richTextUtf8Filepath = path.join(OUTPUT_DIR, richTextUtf8Filename);
                fs.writeFileSync(richTextUtf8Filepath, richTextOutputForFile, { encoding: 'utf-8' });
                console.log(`[${clientAddress}] Parsed Rich TEXT Receipt (UTF-8) saved to: ${richTextUtf8Filepath}`);

                // Save as Windows-1252 as it's common for German text viewing on Windows
                // even if original was CP858
                try {
                    const win1252Buffer = iconv.encode(richTextOutputForFile.replace(/<[^>]+>/g, ''), 'win1252'); // Remove tags for plain text win1252
                    const plainTextWin1252Filename = `${baseTimestamp}_receipt-plain-text_WINDOWS-1252.txt`;
                    const plainTextWin1252Filepath = path.join(OUTPUT_DIR, plainTextWin1252Filename);
                    fs.writeFileSync(plainTextWin1252Filepath, win1252Buffer);
                    console.log(`[${clientAddress}] Parsed PLAIN TEXT Receipt (Windows-1252) saved to: ${plainTextWin1252Filepath}`);
                } catch (encodeError) {
                    console.error(`[${clientAddress}] Error encoding plain text to Windows-1252:`, encodeError)
                }

            } catch (error) {
                console.error(`[${clientAddress}] Error processing receipt data with custom parser:`, error);
            }
        }
        receivedData = Buffer.alloc(0);
    });

    socket.on('error', (err) => {
        console.error(`[${clientAddress}] Socket error:`, err.message);
    });

    socket.on('close', (hadError) => {
        console.log(`[${clientAddress}] Connection closed. Had error: ${hadError}`);
    });
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use.`);
    } else {
        console.error('Server error:', err);
    }
    process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`ESC/POS Printer Emulator (Adv. Text+Tag Parser, CP858 aware) started and listening on port ${PORT}`);
    // ... (остальной код server.listen без изменений) ...
    console.log('---------------------------------------------------------');
    console.log("To connect your POS system, use one of your computer's IP addresses:");
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                console.log(`  Interface "${name}": ${iface.address}`);
            }
        }
    }
    console.log('---------------------------------------------------------');
    console.log(`Output files will be located in the directory: ${path.resolve(OUTPUT_DIR)}`);
    console.log('To stop the emulator, press Ctrl+C');
});