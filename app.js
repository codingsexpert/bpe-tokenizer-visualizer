// =====================================================================
//  Byte-Level BPE Tokenizer - Interactive Web Engine (GPT-2/4 Style)
// =====================================================================

// Color palette generator for token pills
const PALETTE = [
    '#fecaca', '#fef08a', '#bbf7d0', '#bfdbfe', '#e9d5ff',
    '#fed7aa', '#ddd6fe', '#fbcfe8', '#a7f3d0', '#99f6e4',
    '#bae6fd', '#c7d2fe', '#fde68a', '#d9f99d', '#fae8ff'
];

function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % PALETTE.length;
    return PALETTE[index];
}

// Byte to Unicode mapping (GPT-2 style)
function getBytesToUnicode() {
    const bs = [];
    for (let i = '!'.charCodeAt(0); i <= '~'.charCodeAt(0); i++) bs.push(i);
    for (let i = '¡'.charCodeAt(0); i <= '¬'.charCodeAt(0); i++) bs.push(i);
    for (let i = '®'.charCodeAt(0); i <= 'ÿ'.charCodeAt(0); i++) bs.push(i);

    const cs = [...bs];
    let n = 0;
    for (let b = 0; b < 256; b++) {
        if (!bs.includes(b)) {
            bs.push(b);
            cs.push(256 + n);
            n++;
        }
    }
    const byteToUnicode = {};
    const unicodeToByte = {};
    for (let i = 0; i < bs.length; i++) {
        const char = String.fromCharCode(cs[i]);
        byteToUnicode[bs[i]] = char;
        unicodeToByte[char] = bs[i];
    }
    return { byteToUnicode, unicodeToByte };
}

const { byteToUnicode, unicodeToByte } = getBytesToUnicode();

class JSBPETokenizer {
    constructor() {
        self.vocab = {};            // string token -> ID
        self.idToVocab = {};       // ID -> string token
        self.merges = [];          // list of [p1, p2]
        self.mergeRanks = {};      // "p1|p2" -> rank
        self.specialTokens = {};   // str -> ID
        self.inverseSpecial = {};  // ID -> str
        self.reset();
    }

    reset() {
        self.vocab = {};
        self.idToVocab = {};
        self.merges = [];
        self.mergeRanks = {};

        // Base 256 single bytes
        for (let b = 0; b < 256; b++) {
            const ch = String.fromCharCode(b);
            self.vocab[ch] = b;
            self.idToVocab[b] = ch;
        }
    }

    train(text, targetVocabSize) {
        self.reset();
        const numMerges = targetVocabSize - 256;
        if (numMerges <= 0) return [];

        // Pre-tokenize using regex
        const regex = /'s|'t|'re|'ve|'m|'ll|'d| ?\w+| ?[^\s\w]+|\s+(?!\S)|\s+/gu;
        const chunks = text.match(regex) || [text];

        // Convert chunks to word byte tokens
        const wordFreq = new Map();
        const encoder = new TextEncoder();

        for (const chunk of chunks) {
            const bytes = Array.from(encoder.encode(chunk)).map(b => String.fromCharCode(b));
            const key = bytes.join('\0');
            wordFreq.set(key, (wordFreq.get(key) || 0) + 1);
        }

        let nextId = 256;
        const mergeLogs = [];

        for (let iter = 0; iter < numMerges; iter++) {
            const pairCounts = new Map();

            for (const [key, freq] of wordFreq.entries()) {
                const tokens = key.split('\0');
                for (let i = 0; i < tokens.length - 1; i++) {
                    const pairKey = tokens[i] + '\0' + tokens[i + 1];
                    pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + freq);
                }
            }

            if (pairCounts.size === 0) break;

            let bestPairKey = null;
            let bestCount = 0;
            for (const [pairKey, count] of pairCounts.entries()) {
                if (count > bestCount) {
                    bestCount = count;
                    bestPairKey = pairKey;
                }
            }

            if (!bestPairKey || bestCount < 2) break;

            const [p1, p2] = bestPairKey.split('\0');
            const merged = p1 + p2;

            self.vocab[merged] = nextId;
            self.idToVocab[nextId] = merged;
            self.merges.push([p1, p2]);
            self.mergeRanks[p1 + '|' + p2] = iter;
            nextId++;

            // Readable print strings
            const p1Str = Array.from(p1).map(c => byteToUnicode[c.charCodeAt(0)] || c).join('');
            const p2Str = Array.from(p2).map(c => byteToUnicode[c.charCodeAt(0)] || c).join('');
            const mStr = Array.from(merged).map(c => byteToUnicode[c.charCodeAt(0)] || c).join('');

            mergeLogs.push({ iter: iter + 1, p1: p1Str, p2: p2Str, merged: mStr, count: bestCount });

            // Apply merge
            const newWordFreq = new Map();
            for (const [key, freq] of wordFreq.entries()) {
                const tokens = key.split('\0');
                const newTokens = [];
                let i = 0;
                while (i < tokens.length) {
                    if (i < tokens.length - 1 && tokens[i] === p1 && tokens[i + 1] === p2) {
                        newTokens.push(merged);
                        i += 2;
                    } else {
                        newTokens.push(tokens[i]);
                        i += 1;
                    }
                }
                const newKey = newTokens.join('\0');
                newWordFreq.set(newKey, (newWordFreq.get(newKey) || 0) + freq);
            }
            wordFreq.clear();
            for (const [k, v] of newWordFreq.entries()) wordFreq.set(k, v);
        }

        return mergeLogs;
    }

    encodeChunk(chunkBytes) {
        if (chunkBytes.length === 0) return [];
        let parts = chunkBytes.map(b => String.fromCharCode(b));

        while (parts.length >= 2) {
            let minRank = Infinity;
            let bestIdx = -1;

            for (let i = 0; i < parts.length - 1; i++) {
                const key = parts[i] + '|' + parts[i + 1];
                if (key in self.mergeRanks) {
                    const rank = self.mergeRanks[key];
                    if (rank < minRank) {
                        minRank = rank;
                        bestIdx = i;
                    }
                }
            }

            if (bestIdx === -1) break;

            parts[bestIdx] = parts[bestIdx] + parts[bestIdx + 1];
            parts.splice(bestIdx + 1, 1);
        }

        return parts.map(p => ({
            id: self.vocab[p] !== undefined ? self.vocab[p] : 0,
            tokenStr: p,
            displayStr: Array.from(p).map(c => byteToUnicode[c.charCodeAt(0)] || c).join('')
        }));
    }

    encode(text) {
        const regex = /'s|'t|'re|'ve|'m|'ll|'d| ?\w+| ?[^\s\w]+|\s+(?!\S)|\s+/gu;
        const chunks = text.match(regex) || (text ? [text] : []);
        const encoder = new TextEncoder();
        let tokens = [];

        for (const chunk of chunks) {
            const bytes = Array.from(encoder.encode(chunk));
            tokens = tokens.concat(self.encodeChunk(bytes));
        }
        return tokens;
    }

    decode(tokens) {
        const bytes = [];
        for (const tok of tokens) {
            const str = self.idToVocab[tok.id] || '';
            for (let i = 0; i < str.length; i++) {
                bytes.push(str.charCodeAt(i));
            }
        }
        const decoder = new TextDecoder('utf-8', { fatal: false });
        return decoder.decode(new Uint8Array(bytes));
    }
}

// Global UI Application Controller
const tokenizer = new JSBPETokenizer();

const PRESETS = {
    multilingual: `Hello world! Don't worry, BPE tokenization is 100% working. नमस्ते दुनिया! Python BPE tokenizer is super fast and clean. low lower lowest newest newer.`,
    classic: `low low low low low lower lower newest newest newest`,
    emojis: `AI Models 🤖 & Emojis 🎉 rock! function tokenize(x) { return x * 42; } नमस्ते!`
};

// DOM Elements
const trainTextEl = document.getElementById('train-text');
const targetVocabEl = document.getElementById('target-vocab');
const maxMergesEl = document.getElementById('max-merges');
const btnTrain = document.getElementById('btn-train');
const mergesListEl = document.getElementById('merges-list');
const mergesCountEl = document.getElementById('merges-count');
const trainSpinner = document.getElementById('train-spinner');

const testTextEl = document.getElementById('test-text');
const tokenPillsEl = document.getElementById('token-pills');
const tokenIdsOutputEl = document.getElementById('token-ids-output');
const decodedOutputEl = document.getElementById('decoded-output');
const showIdsToggle = document.getElementById('show-ids-toggle');
const btnCopyIds = document.getElementById('btn-copy-ids');

const statCharsEl = document.getElementById('stat-chars');
const statTokensEl = document.getElementById('stat-tokens');
const statRatioEl = document.getElementById('stat-ratio');
const statVocabEl = document.getElementById('stat-vocab');

const vocabTableBody = document.getElementById('vocab-table-body');
const vocabSearchEl = document.getElementById('vocab-search');

// Event Listeners Setup
document.addEventListener('DOMContentLoaded', () => {
    // Initial Preset
    trainTextEl.value = PRESETS.multilingual;
    testTextEl.value = "Hello world! Don't worry, नमस्ते दुनिया!";

    // Preset Buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const key = e.target.dataset.preset;
            trainTextEl.value = PRESETS[key];
            runTraining();
        });
    });

    targetVocabEl.addEventListener('input', () => {
        const val = parseInt(targetVocabEl.value) || 300;
        maxMergesEl.value = Math.max(0, val - 256);
    });

    btnTrain.addEventListener('click', runTraining);
    testTextEl.addEventListener('input', runTokenization);
    showIdsToggle.addEventListener('change', runTokenization);
    vocabSearchEl.addEventListener('input', renderVocabTable);

    btnCopyIds.addEventListener('click', () => {
        navigator.clipboard.writeText(tokenIdsOutputEl.innerText);
        btnCopyIds.innerText = "✓ Copied!";
        setTimeout(() => btnCopyIds.innerText = "📋 Copy", 1500);
    });

    // Initial Training & Run
    maxMergesEl.value = parseInt(targetVocabEl.value) - 256;
    runTraining();
});

function runTraining() {
    trainSpinner.classList.remove('hidden');
    
    setTimeout(() => {
        const text = trainTextEl.value;
        const targetVocab = parseInt(targetVocabEl.value) || 300;
        
        const mergeLogs = tokenizer.train(text, targetVocab);
        
        renderMerges(mergeLogs);
        renderVocabTable();
        runTokenization();
        
        trainSpinner.classList.add('hidden');
    }, 50);
}

function renderMerges(mergeLogs) {
    mergesCountEl.innerText = mergeLogs.length;
    if (mergeLogs.length === 0) {
        mergesListEl.innerHTML = `<div class="empty-state">No merges performed.</div>`;
        return;
    }

    mergesListEl.innerHTML = mergeLogs.map(log => `
        <div class="merge-item">
            <span>#${log.iter}: <span class="merge-pair">('${log.p1}', '${log.p2}')</span></span>
            <span class="merge-result">➔ '${log.merged}' <small style="color:var(--text-muted)">(${log.count}x)</small></span>
        </div>
    `).join('');
}

function runTokenization() {
    const text = testTextEl.value;
    const tokens = tokenizer.encode(text);
    const decoded = tokenizer.decode(tokens);

    // Update Stats
    statCharsEl.innerText = text.length;
    statTokensEl.innerText = tokens.length;
    const ratio = tokens.length > 0 ? (text.length / tokens.length).toFixed(2) : '0.00';
    statRatioEl.innerText = `${ratio} chars/token`;
    statVocabEl.innerText = Object.keys(tokenizer.vocab).length;

    // Render Token Pills
    const showIds = showIdsToggle.checked;
    if (tokens.length === 0) {
        tokenPillsEl.innerHTML = `<div class="empty-state">Type text above to see subword tokens...</div>`;
        tokenIdsOutputEl.innerText = '[ ]';
        decodedOutputEl.innerText = '';
        return;
    }

    tokenPillsEl.innerHTML = tokens.map(tok => {
        const bgColor = stringToColor(tok.displayStr);
        const tag = showIds ? `<span class="token-id-tag">${tok.id}</span>` : '';
        // Escape HTML
        const safeText = tok.displayStr
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        return `
            <div class="token-pill" style="background-color: ${bgColor}" title="ID: ${tok.id} | Raw: ${JSON.stringify(tok.displayStr)}">
                <span>${safeText === ' ' ? '␣' : safeText}</span>
                ${tag}
            </div>
        `;
    }).join('');

    // Token IDs Array
    tokenIdsOutputEl.innerText = `[ ${tokens.map(t => t.id).join(', ')} ]`;

    // Decoded Verification
    decodedOutputEl.innerText = decoded;
}

function renderVocabTable() {
    const search = vocabSearchEl.value.toLowerCase();
    const rows = [];

    for (const [tokenStr, id] of Object.entries(tokenizer.vocab)) {
        const displayStr = Array.from(tokenStr).map(c => byteToUnicode[c.charCodeAt(0)] || c).join('');
        const hex = Array.from(tokenStr).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
        const type = id < 256 ? 'Base Byte' : 'Merged Subword';

        if (search && !id.toString().includes(search) && !displayStr.toLowerCase().includes(search)) {
            continue;
        }

        rows.push(`
            <tr>
                <td style="color: var(--accent-indigo)">${id}</td>
                <td style="color: var(--text-main); font-weight:600;">'${displayStr}'</td>
                <td style="color: var(--text-muted)">${hex}</td>
                <td><span class="badge" style="${id < 256 ? 'background:rgba(56,189,248,0.15); color:var(--accent-blue);' : ''}">${type}</span></td>
            </tr>
        `);
    }

    vocabTableBody.innerHTML = rows.join('');
}
