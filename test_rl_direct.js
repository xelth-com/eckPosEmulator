// test_rl_direct.js
const { transform } = require('receiptline');

// ESC @ (Init), "Hello\n" (Text with Line Feed)
const minimalHex = '1b4048656c6c6f0a';

try {
    console.log("Testing receiptline directly (latest version, 'multilingual' encoding)...");

    const textOptions = {
        command: 'escpos',    // We are providing ESC/POS commands
        input: 'hex',         // The input 'doc' is a hex string
        output: 'text',       // We want plain text output
        encoding: 'multilingual', // TRYING THIS!
        cpl: 42               // Characters per line
    };
    const textOutput = transform(minimalHex, textOptions);
    console.log("--- TEXT OUTPUT ---");
    console.log(textOutput); // Should be "Hello"
    console.log("--------------------");

    const svgOptions = {
        command: 'escpos',
        input: 'hex',
        output: 'svg',
        encoding: 'multilingual', // TRYING THIS!
        cpl: 42
    };
    const svgOutput = transform(minimalHex, svgOptions);
    console.log("--- SVG OUTPUT (first 200 chars) ---");
    console.log(svgOutput.substring(0, 200)); // Should start with <svg ...
    console.log("--------------------");

} catch (e) {
    console.error("Error during direct receiptline test:", e);
}