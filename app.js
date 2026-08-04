// =====================================================================
//  Byte-Level BPE Tokenizer Pro Engine
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
    const unicodeToByte = {};
    for (let i = 0; i < bs.length; i++) {
        const char = String.fromCharCode(cs[i]);
        byteToUnicode[bs[i]] = char;
        unicodeToByte[char] = bs[i];
    }
    return { byteToUnicode, unicodeToByte };
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

// Global App Instance
const tokenizer = new JSBPETokenizer();
let isPlaying = false;
let playInterval = null;

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

const modelRegexSelect = document.getElementById('model-regex-select');
const mergeStepSlider = document.getElementById('merge-step-slider');
const currentStepLabel = document.getElementById('current-step-label');
const btnPlayPause = document.getElementById('btn-play-pause');

const charTokenCountEl = document.getElementById('char-token-count');
const wordTokenCountEl = document.getElementById('word-token-count');
const bpeTokenCountEl = document.getElementById('bpe-token-count');
const estCostEl = document.getElementById('est-cost');
const contextPctEl = document.getElementById('context-pct');
const contextProgressBar = document.getElementById('context-progress-bar');

const btnExportModel = document.getElementById('btn-export-model');
const btnImportModel = document.getElementById('btn-import-model');

const vocabTableBody = document.getElementById('vocab-table-body');
const vocabSearchEl = document.getElementById('vocab-search');

document.addEventListener('DOMContentLoaded', () => {
    trainTextEl.value = `Hello world! Don't worry, BPE tokenization is 100% working. नमस्ते दुनिया! Python BPE tokenizer is super fast and clean. low lower lowest newest newer.`;
    testTextEl.value = "Hello world! Don't worry, नमस्ते दुनिया!";

    targetVocabEl.addEventListener('input', () => {
        const val = parseInt(targetVocabEl.value) || 300;
        maxMergesEl.value = Math.max(0, val - 256);
    });

    modelRegexSelect.addEventListener('change', (e) => {
        tokenizer.selectedRegex = e.target.value;
        runTraining();
    });

    mergeStepSlider.addEventListener('input', () => {
        updateStepLabel();
        runTokenization();
    });

    btnPlayPause.addEventListener('click', togglePlayPause);
    btnTrain.addEventListener('click', runTraining);
    testTextEl.addEventListener('input', runTokenization);
    showIdsToggle.addEventListener('change', runTokenization);
    vocabSearchEl.addEventListener('input', renderVocabTable);

    btnCopyIds.addEventListener('click', () => {
        navigator.clipboard.writeText(tokenIdsOutputEl.innerText);
        btnCopyIds.innerText = "Copied!";
        setTimeout(() => btnCopyIds.innerText = "Copy IDs", 1500);
    });

    btnExportModel.addEventListener('click', exportModel);
    btnImportModel.addEventListener('change', importModel);

    maxMergesEl.value = parseInt(targetVocabEl.value) - 256;
    runTraining();
});

function runTraining() {
    const text = trainTextEl.value;
    const targetVocab = parseInt(targetVocabEl.value) || 300;
    const mergeLogs = tokenizer.train(text, targetVocab);
    
    // Update Slider Bounds
    const maxMerges = mergeLogs.length;
    mergeStepSlider.max = maxMerges;
    mergeStepSlider.value = maxMerges;
    updateStepLabel();

    renderMerges(mergeLogs);
    renderVocabTable();
    runTokenization();
}

function updateStepLabel() {
    const val = parseInt(mergeStepSlider.value);
    const max = parseInt(mergeStepSlider.max);
    currentStepLabel.innerText = val === max ? `Step ${val} (Max)` : `Step ${val}/${max}`;
}

function togglePlayPause() {
    if (isPlaying) {
        clearInterval(playInterval);
        isPlaying = false;
        btnPlayPause.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    } else {
        isPlaying = true;
        btnPlayPause.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
        
        if (parseInt(mergeStepSlider.value) >= parseInt(mergeStepSlider.max)) {
            mergeStepSlider.value = 0;
        }

        playInterval = setInterval(() => {
            let curr = parseInt(mergeStepSlider.value);
            let max = parseInt(mergeStepSlider.max);
            if (curr < max) {
                mergeStepSlider.value = curr + 1;
                updateStepLabel();
                runTokenization();
            } else {
                togglePlayPause();
            }
        }, 300);
    }
}

function runTokenization() {
    const text = testTextEl.value;
    const currentStep = parseInt(mergeStepSlider.value) - 1;
    const maxStep = currentStep < 0 ? -1 : currentStep;

    const tokens = tokenizer.encode(text, maxStep);

    // Stats
    statCharsEl.innerText = text.length;
    statTokensEl.innerText = tokens.length;
    const ratio = tokens.length > 0 ? (text.length / tokens.length).toFixed(1) : '0.0';
    statRatioEl.innerText = ratio;

    // Analytics Calculation
    const encoder = new TextEncoder();
    const charTokensCount = Array.from(encoder.encode(text)).length;
    const wordTokensCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    const bpeTokensCount = tokens.length;

    charTokenCountEl.innerText = charTokensCount;
    wordTokenCountEl.innerText = wordTokensCount;
    bpeTokenCountEl.innerText = bpeTokensCount;

    // Est GPT-4o cost ($0.0025 per 1000 tokens)
    const cost = (bpeTokensCount / 1000) * 0.0025;
    estCostEl.innerText = `$${cost.toFixed(5)}`;

    // 128k Context Window usage %
    const contextPct = ((bpeTokensCount / 128000) * 100).toFixed(3);
    contextPctEl.innerText = `${contextPct}%`;
    contextProgressBar.style.width = `${Math.min(100, Math.max(0.5, parseFloat(contextPct)))}%`;

    // Render Pills
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

function exportModel() {
    const data = {
        vocab: tokenizer.vocab,
        merges: tokenizer.merges,
        selectedRegex: tokenizer.selectedRegex
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bpe_tokenizer_model.json';
    a.click();
    URL.revokeObjectURL(url);
}

function importModel(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const data = JSON.parse(evt.target.result);
            tokenizer.vocab = data.vocab || {};
            tokenizer.idToVocab = {};
            for (const [k, v] of Object.entries(tokenizer.vocab)) {
                tokenizer.idToVocab[v] = k;
            }
            tokenizer.merges = data.merges || [];
            tokenizer.mergeRanks = {};
            tokenizer.merges.forEach((pair, idx) => {
                tokenizer.mergeRanks[pair[0] + '|' + pair[1]] = idx;
            });
            if (data.selectedRegex) {
                tokenizer.selectedRegex = data.selectedRegex;
                modelRegexSelect.value = data.selectedRegex;
            }

            renderVocabTable();
            runTokenization();
            alert("✓ Tokenizer Model Imported Successfully!");
        } catch (err) {
            alert("Failed to parse JSON model file.");
        }
    };
    reader.readAsText(file);
}
