// =====================================================================
//  Byte-Level BPE Tokenizer - Clean Minimal Web Engine
// =====================================================================

// Refined subtle pastel color palette for tokens
const PASTEL_PALETTE = [
    '#fef2f2', '#fefce8', '#f0fdf4', '#eff6ff', '#faf5ff',
    '#fff7ed', '#f5f3ff', '#fdf2f8', '#ecfdf5', '#f0fdfa',
    '#e0f2fe', '#e0e7ff', '#fef9c3', '#ecfccb', '#fae8ff'
];

function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % PASTEL_PALETTE.length;
    return PASTEL_PALETTE[index];
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

const { byteToUnicode } = getBytesToUnicode();

class JSBPETokenizer {
    constructor() {
        this.vocab = {};
        this.idToVocab = {};
        this.merges = [];
        this.mergeRanks = {};
        this.reset();
    }

    reset() {
        this.vocab = {};
        this.idToVocab = {};
        this.merges = [];
        this.mergeRanks = {};

        for (let b = 0; b < 256; b++) {
            const ch = String.fromCharCode(b);
            this.vocab[ch] = b;
            this.idToVocab[b] = ch;
        }
    }

    train(text, targetVocabSize) {
        this.reset();
        const numMerges = targetVocabSize - 256;
        if (numMerges <= 0) return [];

        const regex = /'s|'t|'re|'ve|'m|'ll|'d| ?\w+| ?[^\s\w]+|\s+(?!\S)|\s+/gu;
        const chunks = text.match(regex) || [text];

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

            this.vocab[merged] = nextId;
            this.idToVocab[nextId] = merged;
            this.merges.push([p1, p2]);
            this.mergeRanks[p1 + '|' + p2] = iter;
            nextId++;

            const p1Str = Array.from(p1).map(c => byteToUnicode[c.charCodeAt(0)] || c).join('');
            const p2Str = Array.from(p2).map(c => byteToUnicode[c.charCodeAt(0)] || c).join('');
            const mStr = Array.from(merged).map(c => byteToUnicode[c.charCodeAt(0)] || c).join('');

            mergeLogs.push({ iter: iter + 1, p1: p1Str, p2: p2Str, merged: mStr, count: bestCount });

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
                if (key in this.mergeRanks) {
                    const rank = this.mergeRanks[key];
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
            id: this.vocab[p] !== undefined ? this.vocab[p] : 0,
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
            tokens = tokens.concat(this.encodeChunk(bytes));
        }
        return tokens;
    }
}

// Controller
const tokenizer = new JSBPETokenizer();

const PRESETS = {
    multilingual: `Hello world! Don't worry, BPE tokenization is 100% working. नमस्ते दुनिया! Python BPE tokenizer is super fast and clean. low lower lowest newest newer.`,
    classic: `low low low low low lower lower newest newest newest`,
    code: `function bpeTokenize(text) { return text.split('').map(c => c.charCodeAt(0)); }`
};

// DOM Elements
const trainTextEl = document.getElementById('train-text');
const targetVocabEl = document.getElementById('target-vocab');
const maxMergesEl = document.getElementById('max-merges');
const btnTrain = document.getElementById('btn-train');
const mergesListEl = document.getElementById('merges-list');
const mergesCountEl = document.getElementById('merges-count');

const testTextEl = document.getElementById('test-text');
const tokenPillsEl = document.getElementById('token-pills');
const tokenIdsOutputEl = document.getElementById('token-ids-output');
const showIdsToggle = document.getElementById('show-ids-toggle');
const btnCopyIds = document.getElementById('btn-copy-ids');

const statCharsEl = document.getElementById('stat-chars');
const statTokensEl = document.getElementById('stat-tokens');
const statRatioEl = document.getElementById('stat-ratio');

const vocabTableBody = document.getElementById('vocab-table-body');
const vocabSearchEl = document.getElementById('vocab-search');

document.addEventListener('DOMContentLoaded', () => {
    trainTextEl.value = PRESETS.multilingual;
    testTextEl.value = "Hello world! Don't worry, नमस्ते दुनिया!";

    document.querySelectorAll('.preset-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.preset-tab').forEach(b => b.classList.remove('active'));
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
        btnCopyIds.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied`;
        setTimeout(() => {
            btnCopyIds.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy IDs`;
        }, 1500);
    });

    maxMergesEl.value = parseInt(targetVocabEl.value) - 256;
    runTraining();
});

function runTraining() {
    const text = trainTextEl.value;
    const targetVocab = parseInt(targetVocabEl.value) || 300;
    const mergeLogs = tokenizer.train(text, targetVocab);
    
    renderMerges(mergeLogs);
    renderVocabTable();
    runTokenization();
}

function renderMerges(mergeLogs) {
    mergesCountEl.innerText = mergeLogs.length;
    if (mergeLogs.length === 0) {
        mergesListEl.innerHTML = `<span class="placeholder-text">No merges learned.</span>`;
        return;
    }

    mergesListEl.innerHTML = mergeLogs.map(log => `
        <div class="merge-row">
            <span class="merge-pair">'${log.p1}' + '${log.p2}'</span>
            <span>➔ '${log.merged}'</span>
        </div>
    `).join('');
}

function runTokenization() {
    const text = testTextEl.value;
    const tokens = tokenizer.encode(text);

    statCharsEl.innerText = text.length;
    statTokensEl.innerText = tokens.length;
    const ratio = tokens.length > 0 ? (text.length / tokens.length).toFixed(1) : '0.0';
    statRatioEl.innerText = ratio;

    const showIds = showIdsToggle.checked;
    if (tokens.length === 0) {
        tokenPillsEl.innerHTML = `<span class="placeholder-text">Type text above...</span>`;
        tokenIdsOutputEl.innerText = '[ ]';
        return;
    }

    tokenPillsEl.innerHTML = tokens.map(tok => {
        const bgColor = stringToColor(tok.displayStr);
        const tag = showIds ? `<span class="token-id">${tok.id}</span>` : '';
        const safeText = tok.displayStr
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        return `
            <div class="token-badge" style="background-color: ${bgColor}">
                <span>${safeText === ' ' ? '␣' : safeText}</span>
                ${tag}
            </div>
        `;
    }).join('');

    tokenIdsOutputEl.innerText = `[ ${tokens.map(t => t.id).join(', ')} ]`;
}

function renderVocabTable() {
    const search = vocabSearchEl.value.toLowerCase();
    const rows = [];

    for (const [tokenStr, id] of Object.entries(tokenizer.vocab)) {
        const displayStr = Array.from(tokenStr).map(c => byteToUnicode[c.charCodeAt(0)] || c).join('');
        const type = id < 256 ? 'Byte' : 'Subword';

        if (search && !id.toString().includes(search) && !displayStr.toLowerCase().includes(search)) {
            continue;
        }

        rows.push(`
            <tr>
                <td style="color: var(--accent-color); font-weight:600;">${id}</td>
                <td>'${displayStr}'</td>
                <td style="color: var(--text-muted);">${type}</td>
            </tr>
        `);
    }

    vocabTableBody.innerHTML = rows.join('');
}
