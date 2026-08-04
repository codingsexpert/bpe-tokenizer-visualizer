// =====================================================================
//  Byte-Level BPE Tokenizer - Clean 2-Tab Application Controller
// =====================================================================

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
    for (let i = 0; i < bs.length; i++) {
        byteToUnicode[bs[i]] = String.fromCharCode(cs[i]);
    }
    return { byteToUnicode };
}

const { byteToUnicode } = getBytesToUnicode();

const REGEX_PATTERNS = {
    gpt2: /'s|'t|'re|'ve|'m|'ll|'d| ?\w+| ?[^\s\w]+|\s+(?!\S)|\s+/gu,
    gpt4: /(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])|[^r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
    llama3: /[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
    whitespace: /\S+|\s+/gu
};

class JSBPETokenizer {
    constructor() {
        this.vocab = {};
        this.idToVocab = {};
        this.merges = [];
        this.mergeRanks = {};
        this.selectedRegex = 'gpt2';
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

        const regex = REGEX_PATTERNS[this.selectedRegex] || REGEX_PATTERNS.gpt2;
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

    encodeChunk(chunkBytes, maxMergeRank = Infinity) {
        if (chunkBytes.length === 0) return [];
        let parts = chunkBytes.map(b => String.fromCharCode(b));

        while (parts.length >= 2) {
            let minRank = Infinity;
            let bestIdx = -1;

            for (let i = 0; i < parts.length - 1; i++) {
                const key = parts[i] + '|' + parts[i + 1];
                if (key in this.mergeRanks) {
                    const rank = this.mergeRanks[key];
                    if (rank <= maxMergeRank && rank < minRank) {
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

    encode(text, maxMergeStep = Infinity) {
        const regex = REGEX_PATTERNS[this.selectedRegex] || REGEX_PATTERNS.gpt2;
        const chunks = text.match(regex) || (text ? [text] : []);
        const encoder = new TextEncoder();
        let tokens = [];

        for (const chunk of chunks) {
            const bytes = Array.from(encoder.encode(chunk));
            tokens = tokens.concat(this.encodeChunk(bytes, maxMergeStep));
        }
        return tokens;
    }
}

// Controller
const tokenizer = new JSBPETokenizer();

const SAMPLES = {
    multilingual: "Hello world! Don't worry, BPE tokenization is 100% working. नमस्ते दुनिया! Python BPE tokenizer is super fast.",
    english: "low low low low low lower lower newest newest newest",
    code: "function tokenize(x) { return x.split('').map(c => c.charCodeAt(0)); }"
};

// DOM Elements
const testTextEl = document.getElementById('test-text');
const tokenPillsEl = document.getElementById('token-pills');
const tokenIdsOutputEl = document.getElementById('token-ids-output');
const statTokensEl = document.getElementById('stat-tokens');
const statCharsEl = document.getElementById('stat-chars');
const btnCopyIds = document.getElementById('btn-copy-ids');

const trainTextEl = document.getElementById('train-text');
const targetVocabEl = document.getElementById('target-vocab');
const modelRegexSelect = document.getElementById('model-regex-select');
const btnTrain = document.getElementById('btn-train');
const mergeStepSlider = document.getElementById('merge-step-slider');
const currentStepLabel = document.getElementById('current-step-label');
const mergesListEl = document.getElementById('merges-list');
const mergesCountEl = document.getElementById('merges-count');

const vocabTableBody = document.getElementById('vocab-table-body');
const vocabSearchEl = document.getElementById('vocab-search');

document.addEventListener('DOMContentLoaded', () => {
    // Tab Navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            e.target.classList.add('active');
            const tabId = e.target.dataset.tab;
            document.getElementById(tabId).classList.add('active');
        });
    });

    // Preset Links
    document.querySelectorAll('.link-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const key = e.target.dataset.sample;
            testTextEl.value = SAMPLES[key];
            runTokenization();
        });
    });

    // Inputs
    testTextEl.value = SAMPLES.multilingual;
    trainTextEl.value = SAMPLES.multilingual;

    testTextEl.addEventListener('input', runTokenization);
    btnTrain.addEventListener('click', runTraining);
    modelRegexSelect.addEventListener('change', (e) => {
        tokenizer.selectedRegex = e.target.value;
        runTraining();
    });

    mergeStepSlider.addEventListener('input', () => {
        const val = parseInt(mergeStepSlider.value);
        const max = parseInt(mergeStepSlider.max);
        currentStepLabel.innerText = val === max ? `Step ${val} (Max)` : `Step ${val}/${max}`;
        runTokenization();
    });

    vocabSearchEl.addEventListener('input', renderVocabTable);

    btnCopyIds.addEventListener('click', () => {
        navigator.clipboard.writeText(tokenIdsOutputEl.innerText);
        btnCopyIds.innerText = "Copied!";
        setTimeout(() => btnCopyIds.innerText = "Copy IDs", 1500);
    });

    runTraining();
});

function runTraining() {
    const text = trainTextEl.value;
    const targetVocab = parseInt(targetVocabEl.value) || 300;
    const mergeLogs = tokenizer.train(text, targetVocab);

    mergeStepSlider.max = mergeLogs.length;
    mergeStepSlider.value = mergeLogs.length;
    currentStepLabel.innerText = `Step ${mergeLogs.length} (Max)`;

    renderMerges(mergeLogs);
    renderVocabTable();
    runTokenization();
}

function runTokenization() {
    const text = testTextEl.value;
    const currentStep = parseInt(mergeStepSlider.value) - 1;
    const maxStep = currentStep < 0 ? -1 : currentStep;

    const tokens = tokenizer.encode(text, maxStep);

    statCharsEl.innerText = text.length;
    statTokensEl.innerText = tokens.length;

    if (tokens.length === 0) {
        tokenPillsEl.innerHTML = `<span class="placeholder-text">Type text above...</span>`;
        tokenIdsOutputEl.innerText = '[ ]';
        return;
    }

    tokenPillsEl.innerHTML = tokens.map(tok => {
        const bgColor = stringToColor(tok.displayStr);
        const safeText = tok.displayStr
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        return `
            <div class="token-badge" style="background-color: ${bgColor}">
                <span>${safeText === ' ' ? '␣' : safeText}</span>
                <span class="token-id">${tok.id}</span>
            </div>
        `;
    }).join('');

    tokenIdsOutputEl.innerText = `[ ${tokens.map(t => t.id).join(', ')} ]`;
}

function renderMerges(mergeLogs) {
    mergesCountEl.innerText = mergeLogs.length;
    if (mergeLogs.length === 0) {
        mergesListEl.innerHTML = `<span class="placeholder-text">No merges learned.</span>`;
        return;
    }

    mergesListEl.innerHTML = mergeLogs.map(log => `
        <div class="merge-row">
            <span>'${log.p1}' + '${log.p2}'</span>
            <span>➔ '${log.merged}'</span>
        </div>
    `).join('');
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
