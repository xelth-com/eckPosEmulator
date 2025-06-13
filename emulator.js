// emulator.js
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const iconv = require('iconv-lite'); // For text decoding
const { SerialPort } = require('serialport');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// --- Configuration ---
const TCP_PORT = 9100;
const SERIAL_PORT_PATH = 'COM2';
const SERIAL_BAUD_RATE = 9600;
const SERIAL_DATA_TIMEOUT_MS = 500;
const OUTPUT_DIR_NAME = 'receipts_output';

const ENABLE_TCP_LISTENER = true;
const ENABLE_SERIAL_LISTENER = true;

const SOUND_BASE_COOLDOWN_MS = 400; // Базовый кулдаун после КАЖДОГО звука
                                    // Должен быть чуть больше самого длинного одиночного бипа
// ---------------------

console.log("eckPosEmulator by XETRON 08000-938766 (xelth.com/xetron)");
console.log("-------------------------------------");

let baseDir;
if (process.pkg) {
    baseDir = path.dirname(process.execPath);
} else {
    baseDir = __dirname;
}
const OUTPUT_DIR = path.join(baseDir, OUTPUT_DIR_NAME);

if (!fs.existsSync(OUTPUT_DIR)) {
    try {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        console.log(`Receipts directory created: ${OUTPUT_DIR}`);
    } catch (err) {
        console.error(`Failed to create receipts directory ${OUTPUT_DIR}:`, err);
    }
}

// --- Sound Notification Logic ---
let isSoundPlayingOrInCooldown = false; // Флаг: звук играет ИЛИ идет его персональный кулдаун
let queuedSoundType = null; // Тип звука в очереди ('TCP', 'SERIAL', или null)
let soundQueueTimer = null; // Таймер для обработки очереди

class SoundNotifier {
    static async _beepPS(frequency = 800, duration = 200, soundTypeName = "Default") {
        if (process.platform !== 'win32') {
            console.warn(`[SOUND] PowerShell beep for ${soundTypeName} is only supported on Windows.`);
            return;
        }
        const command = `powershell -Command "[console]::beep(${frequency},${duration})"`;
        try {
            // console.log(`[SOUND DEBUG] Executing for ${soundTypeName}: ${command}`);
            await execAsync(command);
            console.log(`[SOUND] ${soundTypeName} sound played (Freq: ${frequency}, Dur: ${duration}).`);
        } catch (error) {
            const errorMessage = error.stderr || error.message || 'Unknown PowerShell error';
            console.error(`[SOUND] PowerShell beep for ${soundTypeName} failed: ${errorMessage.split('\n')[0]}`);
        }
    }

    static async playTcpSound() {
        // Один бип для TCP, например, более высокий и короткий
        await this._beepPS(1200, 200, "TCP");
    }

    static async playSerialSound() {
        // Один бип для Serial, например, более низкий и чуть длиннее
        await this._beepPS(700, 300, "SERIAL");
    }

    static async playDefaultSound() {
        await this._beepPS(800, 250, "Default");
    }
}

async function processSoundQueue() {
    if (soundQueueTimer) {
        clearTimeout(soundQueueTimer); // Очищаем предыдущий таймер, если он был
        soundQueueTimer = null;
    }

    if (queuedSoundType && !isSoundPlayingOrInCooldown) {
        const typeToPlay = queuedSoundType;
        queuedSoundType = null; // Убираем из очереди ПЕРЕД воспроизведением

        console.log(`[SOUND QUEUE] Playing queued sound for ${typeToPlay}.`);
        isSoundPlayingOrInCooldown = true; // Занимаем "эфир"

        if (typeToPlay === 'TCP') {
            await SoundNotifier.playTcpSound();
        } else if (typeToPlay === 'SERIAL') {
            await SoundNotifier.playSerialSound();
        } else {
            await SoundNotifier.playDefaultSound();
        }
        
        setTimeout(() => {
            isSoundPlayingOrInCooldown = false;
            // console.log('[SOUND QUEUE] Cooldown finished for queued sound.');
            processSoundQueue(); // Проверить, не появилось ли что-то еще в очереди за это время
        }, SOUND_BASE_COOLDOWN_MS);

    } else if (queuedSoundType && isSoundPlayingOrInCooldown) {
        // Если что-то есть в очереди, но текущий звук еще играет/в кулдауне,
        // ставим таймер на повторную проверку очереди.
        // console.log(`[SOUND QUEUE] Queued sound for ${queuedSoundType} waiting for current sound/cooldown to finish.`);
        if (!soundQueueTimer) { // Чтобы не плодить таймеры
             soundQueueTimer = setTimeout(processSoundQueue, SOUND_BASE_COOLDOWN_MS / 2); // Проверить чуть раньше, чем закончится кулдаун
        }
    } else {
        // console.log('[SOUND QUEUE] Queue is empty or sound system is busy, no action.');
    }
}

async function playReceiptSound(sourceDescription) {
    const sourceType = sourceDescription.toUpperCase().startsWith('TCP') ? 'TCP' :
                       (sourceDescription.toUpperCase().startsWith('SERIAL') ? 'SERIAL' : 'UNKNOWN');

    if (isSoundPlayingOrInCooldown) {
        // Если звук уже играет или в кулдауне, ставим новый звук в очередь (перезаписывая предыдущий ожидающий, если он был)
        console.log(`[SOUND] Sound system busy. Queuing sound for ${sourceType}. Currently queued: ${queuedSoundType === null ? "None" : queuedSoundType}`);
        queuedSoundType = sourceType; // Простая очередь на один звук, последний пришедший имеет приоритет в очереди
        if (!soundQueueTimer) { // Если таймер обработки очереди еще не запущен
            soundQueueTimer = setTimeout(processSoundQueue, SOUND_BASE_COOLDOWN_MS / 2); // Запустить проверку очереди
        }
        return;
    }

    // Если "эфир" свободен, играем звук немедленно
    isSoundPlayingOrInCooldown = true;
    queuedSoundType = null; // Очищаем очередь, так как текущий звук сейчас будет проигран
    if(soundQueueTimer) { clearTimeout(soundQueueTimer); soundQueueTimer = null; } // Останавливаем таймер очереди

    console.log(`[SOUND] Playing immediate sound for ${sourceType}.`);

    if (sourceType === 'TCP') {
        await SoundNotifier.playTcpSound();
    } else if (sourceType === 'SERIAL') {
        await SoundNotifier.playSerialSound();
    } else {
        await SoundNotifier.playDefaultSound();
    }

    setTimeout(() => {
        isSoundPlayingOrInCooldown = false;
        // console.log('[SOUND] Cooldown finished for immediate sound.');
        processSoundQueue(); // После кулдауна немедленного звука, обработать очередь
    }, SOUND_BASE_COOLDOWN_MS);
}
// --- End Sound Notification Logic ---


/**
 * Advanced ESC/POS parser to extract text and log commands as tags.
 * (Функция parseEscPosToRichText остается без изменений)
 */
function parseEscPosToRichText(escposBuffer, initialEncoding = 'windows-1252') {
    let outputLines = [];
    let currentTextBuffer = [];
    let i = 0;
    let currentCodepage = initialEncoding;

    const flushCurrentTextBuffer = () => {
        if (currentTextBuffer.length > 0) {
            try {
                const decodedText = iconv.decode(Buffer.from(currentTextBuffer), currentCodepage);
                if (outputLines.length > 0 &&
                    !outputLines[outputLines.length - 1].startsWith('<') &&
                    !outputLines[outputLines.length - 1].endsWith('>') &&
                    !outputLines[outputLines.length - 1].endsWith('\n')) {
                    outputLines[outputLines.length - 1] += decodedText;
                } else {
                    outputLines.push(decodedText);
                }
            } catch (e) {
                console.error(`[Parser] Error decoding text with ${currentCodepage} (bytes: ${Buffer.from(currentTextBuffer).toString('hex')}):`, e.message);
                try {
                    outputLines.push(Buffer.from(currentTextBuffer).toString('latin1')); // Fallback
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
                        addTag(escposBuffer[i + 2] === 1 ? "<Bold On>" : "<Bold Off>"); i += 3;
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
                        switch (cp) {
                            case 0: newCodepage = 'cp437'; break;
                            case 2: newCodepage = 'cp850'; break;
                            case 17: newCodepage = 'cp866'; break;
                            case 19: newCodepage = 'cp858'; break;
                            case 20: newCodepage = 'windows-1251'; break;
                            case 67: newCodepage = 'cp866'; break;
                            case 66: newCodepage = 'windows-1251'; break;
                            default:
                                if (cp === 16) newCodepage = 'windows-1252';
                                else console.warn(`[Parser] Unknown codepage ID ${cp} selected by ESC t. Using previous: ${currentCodepage}`);
                                break;
                        }
                        if (iconv.encodingExists(newCodepage)) {
                            currentCodepage = newCodepage;
                        } else {
                            console.warn(`[Parser] Codepage '${newCodepage}' (for ESC t ${cp}) is not supported by iconv-lite. Sticking with: ${currentCodepage}`);
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
                        addTag(`<Print and Feed Paper (${escposBuffer[i + 2]} dots)>`); i += 3;
                    } else { addTag("<Incomplete ESC J>"); i += 2; }
                    break;
                case 0x64: // ESC d n - Print and Feed n Lines
                    if (escposBuffer[i + 2] !== undefined) {
                        addTag(`<Print and Feed Paper (${escposBuffer[i + 2]} lines)>`); i += 3;
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
                        const width = ((sizeByte >> 4) & 0x0F) + 1;
                        const height = (sizeByte & 0x0F) + 1;
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
                        else if (cutMode === 0x41) cutType = "<Full Cut (mode A)>";
                        else if (cutMode === 0x42) cutType = "<Partial Cut (mode B)>";
                        else cutType = `<Paper Cut (mode=0x${cutMode.toString(16)})>`;

                        if ((cutMode === 0x00 || cutMode === 0x30 || cutMode === 0x01 || cutMode === 0x31 || cutMode === 0x41 || cutMode === 0x42) && escposBuffer[i + 3] !== undefined) {
                           addTag(`${cutType} (with param 0x${escposBuffer[i+3].toString(16)})`);
                           i += 4;
                        } else {
                           addTag(cutType);
                           i += 3;
                        }
                    } else { addTag("<Incomplete GS V>"); i += 2; }
                    break;
                case 0x2F:
                     if (escposBuffer[i + 2] !== undefined) {
                        addTag(`<Print NV Bit Image (mode=${escposBuffer[i+2]})>`);
                        i += 3;
                    } else { addTag("<Incomplete GS />"); i += 2; }
                    break;
                case 0x48: // GS H n - Select HRI print position
                    if (escposBuffer[i + 2] !== undefined) {
                        const n = escposBuffer[i + 2];
                        let hriPos = `HRI Pos=${n}`;
                        if (n === 0 || n === 48) hriPos = "<HRI Text Off>";
                        else if (n === 1 || n === 49) hriPos = "<HRI Above Barcode>";
                        else if (n === 2 || n === 50) hriPos = "<HRI Below Barcode>";
                        else if (n === 3 || n === 51) hriPos = "<HRI Above & Below Barcode>";
                        addTag(hriPos);
                        i += 3;
                    } else { addTag("<Incomplete GS H>"); i += 2; }
                    break;
                default:
                    addTag(`<Unknown GS Command (0x1D 0x${cmdByte.toString(16)})>`);
                    i += 2;
                    break;
            }
        } else if (byte === 0x1F) { // FS
            flushCurrentTextBuffer();
            if (escposBuffer[i+1] === 0x1B && escposBuffer[i+2] === 0x1F) {
                const subCmdGroup = escposBuffer[i+3];
                if (subCmdGroup === undefined) { addTag("<Incomplete 1F 1B 1F sequence>"); i = escposBuffer.length; continue; }

                if (subCmdGroup === 0x91 && escposBuffer[i+4] === 0x00 && escposBuffer[i+5] === 0x49 && escposBuffer[i+6] === 0x50) {
                    if (i + 10 < escposBuffer.length) {
                        const ipBytes = escposBuffer.slice(i+7, i+11);
                        addTag(`<Set IP Address (${ipBytes.join('.')})>`);
                        i += 11;
                    } else {
                        addTag("<Incomplete Set IP Command>");
                        i = escposBuffer.length;
                    }
                } else if (subCmdGroup === 0xBF) {
                    if (i + 5 < escposBuffer.length) {
                        const brVal1 = escposBuffer[i+4];
                        const brVal2 = escposBuffer[i+5];
                        let baudRate = "Unknown Baud";
                        if (brVal1 === 0x48 && brVal2 === 0x00) baudRate = "9600";
                        else if (brVal1 === 0x08 && brVal2 === 0x00) baudRate = "19200";
                        else if (brVal1 === 0xC8 && brVal2 === 0x00) baudRate = "38400";
                        else if (brVal1 === 0x88 && brVal2 === 0x00) baudRate = "115200";
                        addTag(`<Set Baud Rate (${baudRate} - 0x${brVal1.toString(16)} 0x${brVal2.toString(16)})>`);
                        i += 6;
                    } else {
                        addTag("<Incomplete Set Baud Rate Command>");
                        i = escposBuffer.length;
                    }
                } else {
                     addTag(`<Unknown 1F 1B 1F sequence (subCmd=0x${subCmdGroup.toString(16)})>`);
                     i += 4;
                }
            } else {
                addTag(`<Control Char (0x${byte.toString(16)})>`);
                i++;
            }
        }
        else if (byte === 0x0A) { // LF - Line Feed
            flushCurrentTextBuffer();
            outputLines.push("");
            i++;
        } else if (byte === 0x0D) { // CR - Carriage Return
            flushCurrentTextBuffer();
            i++;
        } else if (byte >= 0x20 || byte === 0x09) { // Printable characters and Tab
            currentTextBuffer.push(byte);
            i++;
        } else {
            flushCurrentTextBuffer();
            addTag(`<Control Char (0x${byte.toString(16)})>`);
            i++;
        }
    }
    flushCurrentTextBuffer();
    return outputLines.join('\n');
}

/**
 * Processes the received ESC/POS data, parses it, and saves it to files.
 * @param {Buffer} dataBuffer - The raw ESC/POS data.
 * @param {string} sourceDescription - A string describing the source (e.g., IP:port or COM port).
 */
async function processReceivedData(dataBuffer, sourceDescription) { // Сделали функцию async
    if (!fs.existsSync(OUTPUT_DIR)) {
        console.warn(`[${sourceDescription}] Output directory ${OUTPUT_DIR} does not exist. Cannot save files.`);
        try {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
            console.log(`[${sourceDescription}] Output directory ${OUTPUT_DIR} re-created.`);
        } catch (mkdirErr) {
            console.error(`[${sourceDescription}] Failed to re-create output directory ${OUTPUT_DIR}:`, mkdirErr);
            return;
        }
    }

    if (dataBuffer.length > 0) {
        await playReceiptSound(sourceDescription); // Вызов функции звука, теперь await

        const baseTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeSourceDesc = sourceDescription.replace(/[:\/\\*?"<>|]/g, '_');

        const originalRawFilename = `${baseTimestamp}_${safeSourceDesc}_pos-input-original.bin`;
        const originalRawFilepath = path.join(OUTPUT_DIR, originalRawFilename);
        try {
            fs.writeFileSync(originalRawFilepath, dataBuffer);
            console.log(`[${sourceDescription}] Original POS input saved: ${originalRawFilepath}`);
        } catch (writeError) {
            console.error(`[${sourceDescription}] Failed to save original POS input to ${originalRawFilepath}:`, writeError);
        }

        try {
            const richTextOutputForFile = parseEscPosToRichText(dataBuffer);

            console.log(`\n============================== START JOB ${baseTimestamp} (${sourceDescription}) ==============================`);
            const consoleOutput = richTextOutputForFile
                .split('\n')
                .filter(line => line.trim() !== "<Carriage Return>" && line.trim() !== "<Line Feed>")
                .join('\n')
                .replace(/\n\n+/g, '\n');
            console.log(consoleOutput);
            console.log(`============================== END JOB ${baseTimestamp} (${sourceDescription}) ===============================\n`);

            const richTextUtf8Filename = `${baseTimestamp}_${safeSourceDesc}_receipt-rich-text_UTF-8.txt`;
            const richTextUtf8Filepath = path.join(OUTPUT_DIR, richTextUtf8Filename);
            try {
                fs.writeFileSync(richTextUtf8Filepath, richTextOutputForFile, { encoding: 'utf-8' });
                console.log(`[${sourceDescription}] Parsed Rich TEXT Receipt (UTF-8) saved to: ${richTextUtf8Filepath}`);
            } catch (writeError) {
                console.error(`[${sourceDescription}] Failed to save UTF-8 rich text to ${richTextUtf8Filepath}:`, writeError);
            }

            try {
                const plainText = richTextOutputForFile.replace(/<[^>]+>/g, (match) => {
                    if (match.includes("Feed Paper") || match.includes("Cut>")) return "\n";
                    if (match.startsWith("<Control Char") || match.startsWith("<Unknown")) return "";
                    return "";
                }).replace(/\n\s*\n+/g, '\n').trim();

                const win1251Buffer = iconv.encode(plainText, 'windows-1251');
                const plainTextWin1251Filename = `${baseTimestamp}_${safeSourceDesc}_receipt-plain-text_WINDOWS-1251.txt`;
                const plainTextWin1251Filepath = path.join(OUTPUT_DIR, plainTextWin1251Filename);
                fs.writeFileSync(plainTextWin1251Filepath, win1251Buffer);
                console.log(`[${sourceDescription}] Parsed PLAIN TEXT Receipt (Windows-1251) saved to: ${plainTextWin1251Filepath}`);
            } catch (encodeOrWriteError) {
                console.error(`[${sourceDescription}] Error processing or saving plain text Windows-1251:`, encodeOrWriteError);
            }

        } catch (error) {
            console.error(`[${sourceDescription}] Error processing receipt data with custom parser:`, error);
            if (error.stack) console.error(error.stack);
        }
    }
}

let tcpServerInstance = null;

// --- TCP Server Setup ---
if (ENABLE_TCP_LISTENER) {
    const server = net.createServer((socket) => {
        const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;
        console.log(`TCP Client connected: ${clientAddress}`);
        let receivedData = Buffer.alloc(0);

        socket.on('data', (chunk) => {
            receivedData = Buffer.concat([receivedData, chunk]);
            console.log(`[TCP ${clientAddress}] Received ${chunk.length} bytes.`);
        });

        socket.on('end', async () => {
            console.log(`[TCP ${clientAddress}] Client disconnected. Total bytes received: ${receivedData.length}.`);
            await processReceivedData(receivedData, `TCP-${clientAddress}`);
            receivedData = Buffer.alloc(0);
        });

        socket.on('error', (err) => {
            console.error(`[TCP ${clientAddress}] Socket error:`, err.message);
        });

        socket.on('close', (hadError) => {
            console.log(`[TCP ${clientAddress}] Connection closed. Had error: ${hadError}`);
        });
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`TCP Error: Port ${TCP_PORT} is already in use. TCP listener will not start.`);
        } else {
            console.error('TCP Server error:', err);
        }
        tcpServerInstance = null;
        checkIfAnyListenerRunning();
    });

    server.listen(TCP_PORT, '0.0.0.0', () => {
        tcpServerInstance = server;
        console.log(`TCP Listener active on port ${TCP_PORT}`);
        console.log('---------------------------------------------------------');
        console.log("To connect your POS system via TCP, use one of your computer's IP addresses:");
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    console.log(`  Interface "${name}": ${iface.address}:${TCP_PORT}`);
                }
            }
        }
        console.log('---------------------------------------------------------');
        checkIfAnyListenerRunning();
    });
}

let serialPortInstance = null;

// --- Serial Port Setup ---
if (ENABLE_SERIAL_LISTENER) {
    const serialPort = new SerialPort({
        path: SERIAL_PORT_PATH,
        baudRate: SERIAL_BAUD_RATE,
        autoOpen: false,
    });

    let serialBuffer = Buffer.alloc(0);
    let serialDataTimeout = null;

    serialPort.open((err) => {
        if (err) {
            if (err.message.includes('Access denied') || err.message.includes('Port is already open') || err.message.includes('ENOENT') || err.message.includes('UNKNOWN')) {
                 console.warn(`Serial Warning: Could not open port ${SERIAL_PORT_PATH} (may be in use or does not exist): ${err.message}. Serial listener will not start.`);
            } else {
                 console.error(`Serial Error: Error opening serial port ${SERIAL_PORT_PATH}: ${err.message}. Serial listener will not start.`);
            }
            serialPortInstance = null;
            checkIfAnyListenerRunning();
            return;
        }
        serialPortInstance = serialPort;
        console.log(`Serial Listener active on ${SERIAL_PORT_PATH} at ${SERIAL_BAUD_RATE} baud.`);
        console.log('---------------------------------------------------------');
        checkIfAnyListenerRunning();
    });

    serialPort.on('data', (chunk) => {
        serialBuffer = Buffer.concat([serialBuffer, chunk]);
        console.log(`[Serial ${SERIAL_PORT_PATH}] Received ${chunk.length} bytes.`);

        if (serialDataTimeout) {
            clearTimeout(serialDataTimeout);
        }

        serialDataTimeout = setTimeout(async () => {
            console.log(`[Serial ${SERIAL_PORT_PATH}] Data timeout. Processing ${serialBuffer.length} accumulated bytes.`);
            await processReceivedData(serialBuffer, `SERIAL-${SERIAL_PORT_PATH}`);
            serialBuffer = Buffer.alloc(0);
        }, SERIAL_DATA_TIMEOUT_MS);
    });

    serialPort.on('error', (err) => {
        console.error(`[Serial ${SERIAL_PORT_PATH}] Runtime Error: `, err.message);
    });

    serialPort.on('close', async (hadError) => {
        console.log(`[Serial ${SERIAL_PORT_PATH}] Port closed. Had error: ${hadError}`);
         if (serialDataTimeout) {
            clearTimeout(serialDataTimeout);
        }
        if (serialBuffer.length > 0) {
            console.log(`[Serial ${SERIAL_PORT_PATH}] Processing ${serialBuffer.length} bytes on close.`);
            await processReceivedData(serialBuffer, `SERIAL-${SERIAL_PORT_PATH}-onclose`);
            serialBuffer = Buffer.alloc(0);
        }
        serialPortInstance = null;
        checkIfAnyListenerRunning();
    });
}

// --- General Info ---
function displayInitialMessages() {
    if ((ENABLE_TCP_LISTENER && tcpServerInstance) || (ENABLE_SERIAL_LISTENER && serialPortInstance)) {
        console.log(`Output files will be located in the directory: ${path.resolve(OUTPUT_DIR)}`);
    }
}
checkIfAnyListenerRunning.hasRun = false;

function checkIfAnyListenerRunning() {
    setTimeout(() => {
        const tcpRunning = ENABLE_TCP_LISTENER && tcpServerInstance;
        const serialRunning = ENABLE_SERIAL_LISTENER && serialPortInstance;

        if (tcpRunning || serialRunning) {
            if (!checkIfAnyListenerRunning.hasRun) {
                displayInitialMessages();
                console.log('To stop the emulator, press Ctrl+C');
                checkIfAnyListenerRunning.hasRun = true;
            }
        } else if (!ENABLE_TCP_LISTENER && !ENABLE_SERIAL_LISTENER) {
             if (!checkIfAnyListenerRunning.hasRun) {
                console.log('No listeners enabled. Set ENABLE_TCP_LISTENER or ENABLE_SERIAL_LISTENER to true in the script.');
                checkIfAnyListenerRunning.hasRun = true;
             }
        } else if ((ENABLE_TCP_LISTENER || ENABLE_SERIAL_LISTENER) && !checkIfAnyListenerRunning.hasRun) {
            console.log('No active listeners. Please check error messages above.');
            checkIfAnyListenerRunning.hasRun = true;
        }
    }, 200);
}

if (!ENABLE_TCP_LISTENER && !ENABLE_SERIAL_LISTENER) {
    checkIfAnyListenerRunning();
}