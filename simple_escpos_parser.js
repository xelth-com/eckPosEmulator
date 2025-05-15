// simple_escpos_parser.js (вместо emulator.js или как отдельная функция)

function parseEscPosToText(escposBuffer, encoding = 'cp866') {
    // Мы будем использовать iconv-lite для декодирования текста,
    // так как Buffer.toString() может не поддерживать все нужные кодировки (например, cp866).
    // Установите: npm install iconv-lite
    const iconv = require('iconv-lite');
    let textLines = [];
    let currentLine = '';
    let i = 0;
    let currentCodepage = encoding; // Начальная кодировка

    while (i < escposBuffer.length) {
        const byte = escposBuffer[i];

        if (byte === 0x1B) { // ESC-последовательность
            const nextByte = escposBuffer[i + 1];
            if (nextByte === 0x40) { // ESC @ (Initialize)
                // console.log('[Parser] CMD: Initialize Printer');
                i += 2;
                continue;
            } else if (nextByte === 0x74) { // ESC t n (Select character code table)
                const codepageNum = escposBuffer[i + 2];
                // console.log(`[Parser] CMD: Select Codepage ${codepageNum}`);
                if (codepageNum === 19 || codepageNum === 16 || codepageNum === 17) { // PC866 variants, or other common ones
                    currentCodepage = 'cp866'; // Или map codepageNum to iconv-lite name
                } else if (codepageNum === 0) { // PC437
                    currentCodepage = 'cp437';
                } else if (codepageNum === 2) { // Katakana
                     currentCodepage = 'cp437'; // Placeholder, Katakana needs specific handling
                }
                // Add more mappings as needed based on your printer/POS
                i += 3;
                continue;
            } else if (nextByte === 0x21) { // ESC ! n (Set print mode)
                // const mode = escposBuffer[i+2];
                // console.log(`[Parser] CMD: Set Print Mode ${mode}`);
                // For text extraction, we mostly ignore this, but you could parse font size if needed.
                i += 3;
                continue;
            }
            // Add other ESC commands you want to handle or ignore
            // For now, skip unknown ESC sequences by 2 bytes (ESC + next)
            // A more robust parser would check length of command.
            // console.log(`[Parser] Skipping unknown ESC sequence: 1B ${nextByte.toString(16)}`);
            i += 2; // Default skip for simple ESC commands
        } else if (byte === 0x1D) { // GS-последовательность
            const nextByte = escposBuffer[i + 1];
            if (nextByte === 0x42) { // GS B n (Invert color)
                // const mode = escposBuffer[i+2];
                // console.log(`[Parser] CMD: Invert Color ${mode}`);
                i += 3;
                continue;
            } else if (nextByte === 0x56) { // GS V (Cut)
                // console.log('[Parser] CMD: Cut Paper');
                if (currentLine.length > 0) {
                    textLines.push(currentLine);
                    currentLine = '';
                }
                // The parameter after GS V determines cut type, typically 1 or 2 bytes long
                if (escposBuffer[i+2] === 0x00 || escposBuffer[i+2] === 0x30 ||
                    escposBuffer[i+2] === 0x01 || escposBuffer[i+2] === 0x31 ||
                    escposBuffer[i+2] === 0x41 || escposBuffer[i+2] === 0x42 ) {
                     i += 3; // GS V m
                } else {
                     i += 4; // GS V m n (less common for simple cut)
                }
                continue;
            }
            // Add other GS commands
            // console.log(`[Parser] Skipping unknown GS sequence: 1D ${nextByte.toString(16)}`);
            i += 2; // Default skip
        } else if (byte === 0x0A) { // LF (Line Feed)
            textLines.push(currentLine);
            currentLine = '';
            i++;
        } else if (byte === 0x0D) { // CR (Carriage Return) - often ignored if LF is present
            i++; // Just skip CR for now
        } else { // Считаем это текстовым символом
            // Собираем байты для текущей строки
            let textBytes = [];
            while (i < escposBuffer.length && escposBuffer[i] >= 0x20) { // Пока это печатные символы
                // (и не основные управляющие ESC, GS, LF, CR)
                // Более сложная проверка может понадобиться, если есть другие управляющие символы внутри текста
                if (escposBuffer[i] === 0x1B || escposBuffer[i] === 0x1D ||
                    escposBuffer[i] === 0x0A || escposBuffer[i] === 0x0D) {
                    break;
                }
                textBytes.push(escposBuffer[i]);
                i++;
            }
            if (textBytes.length > 0) {
                try {
                    currentLine += iconv.decode(Buffer.from(textBytes), currentCodepage);
                } catch (e) {
                    console.error(`Error decoding text with ${currentCodepage}:`, e);
                    currentLine += Buffer.from(textBytes).toString('ascii'); // Fallback
                }
            }
            if (i < escposBuffer.length && (escposBuffer[i] < 0x20 && escposBuffer[i] !== 0x0A && escposBuffer[i] !== 0x0D)) {
                // Если после текста не LF/CR, а другой управляющий символ, пропускаем его, чтобы не зациклиться.
                // Это упрощение.
                i++;
            }
        }
    }

    if (currentLine.length > 0) { // Добавляем последнюю строку, если она не пуста
        textLines.push(currentLine);
    }

    return textLines.join('\n');
}

// --- Как это использовать в вашем emulator.js ---
// Внутри socket.on('end', ...)
// const iconv = require('iconv-lite'); // Поместите это вверху emulator.js

// ... (получение receivedData) ...
// const initCommand = Buffer.from([0x1B, 0x40]); // ESC @ (Initialize printer)
// const dataToParse = Buffer.concat([initCommand, receivedData]); // Используем данные с ESC @
// const dataToParse = receivedData; // ИЛИ попробуйте оригинальные данные БЕЗ ESC @,
                                   // так как ваша касса УЖЕ шлет ESC t для кодировки

// Предпочтительно использовать данные как есть, если касса сама задает кодировку.
// Если ваша касса НЕ шлет ESC t, то передавайте 'windows-1251' или 'windows-1252' в encoding.
// Так как ваша касса шлет ESC t 13 (PC866), парсер попытается использовать cp866.
// Вы можете передать 'cp866' как второй аргумент, чтобы установить начальную кодировку.
// const textOutput = parseEscPosToText(receivedData, 'cp866');
// ИЛИ, если хотите windows-1251/1252 по умолчанию, если ESC t не найдено:
const textOutput = parseEscPosToText(receivedData, 'windows-1251'); // Или 'windows-1252'

console.log(`[${clientAddress}] Parsed TEXT Output: \n${textOutput}`);

const textFilename = `receipt_PARSED_TEXT_${timestamp}.txt`;
const textFilepath = path.join(OUTPUT_DIR, textFilename);
// fs.writeFileSync будет сохранять строку как UTF-8 по умолчанию
fs.writeFileSync(textFilepath, textOutput, { encoding: 'utf-8' });
console.log(`[${clientAddress}] Parsed TEXT Receipt (UTF-8) saved as: ${textFilepath}`);

// Если вам нужен файл именно в Windows-1251:
// const win1251Buffer = iconv.encode(textOutput, 'win1251');
// const textFilepathWin1251 = path.join(OUTPUT_DIR, `receipt_PARSED_TEXT_${timestamp}_win1251.txt`);
// fs.writeFileSync(textFilepathWin1251, win1251Buffer);
// console.log(`[${clientAddress}] Parsed TEXT Receipt (Windows-1251) saved as: ${textFilepathWin1251}`);