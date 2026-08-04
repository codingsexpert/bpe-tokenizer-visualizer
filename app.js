// =====================================================================
//  BPE Tokenizer Studio Pro - Client Controller (GPT-4o / GPT-2 / Llama 3)
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
    gpt4: /(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])|[^r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
    gpt2: /'s|'t|'re|'ve|'m|'ll|'d| ?\w+| ?[^\s\w]+|\s+(?!\S)|\s+/gu,
    llama3: /[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
    custom: /'s|'t|'re|'ve|'m|'ll|'d| ?\w+| ?[^\s\w]+|\s+(?!\S)|\s+/gu
};

class JSBPETokenizer {
    constructor() {
        this.vocab = {};
        this.idToVocab = {};
        this.merges = [];
        this.mergeRanks = {};
        this.selectedRegex = 'gpt4';
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

        const regex = REGEX_PATTERNS[this.selectedRegex] || REGEX_PATTERNS.gpt4;
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

        return parts.map(p => {
            const rawBytes = Array.from(p).map(c => c.charCodeAt(0));
            const hex = rawBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
            return {
                id: this.vocab[p] !== undefined ? this.vocab[p] : 0,
                tokenStr: p,
                displayStr: Array.from(p).map(c => byteToUnicode[c.charCodeAt(0)] || c).join(''),
                hex: hex
            };
        });
    }

    encode(text, maxMergeStep = Infinity) {
        const regex = REGEX_PATTERNS[this.selectedRegex] || REGEX_PATTERNS.gpt4;
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
    multilingual: `Hello world! Don't worry, BPE tokenization is 100% working. नमस्ते दुनिया! Tokenizer Studio is ready.`,
    code: `def bpe_encode(text):\n    tokens = tokenizer.encode(text)\n    return [t.id for t in tokens]`,
    classic: `low low low low low lower lower newest newest newest`
};

// DOM Elements
const promptInput = document.getElementById('prompt-input');
const tokensDisplay = document.getElementById('tokens-display');
const tokenSequence = document.getElementById('token-sequence');
const countTokens = document.getElementById('count-tokens');

const modelSelect = document.getElementById('model-select');
const btnCopySequence = document.getElementById('btn-copy-sequence');

const tokensTableBody = document.getElementById('tokens-table-body');
const vocabTableBody = document.getElementById('vocab-table-body');
const vocabQuery = document.getElementById('vocab-query');

const metricTokens = document.getElementById('metric-tokens');
const metricChars = document.getElementById('metric-chars');
const metricRatio = document.getElementById('metric-ratio');
const metricCost = document.getElementById('metric-cost');
const contextVal = document.getElementById('context-val');
const contextFill = document.getElementById('context-fill');

const compChar = document.getElementById('comp-char');
const compWord = document.getElementById('comp-word');
const compBpe = document.getElementById('comp-bpe');

const corpusInput = document.getElementById('corpus-input');
const targetVocab = document.getElementById('target-vocab');
const btnTrainModel = document.getElementById('btn-train-model');
const stepSlider = document.getElementById('step-slider');
const stepCountLabel = document.getElementById('step-count-label');
const mergesTotal = document.getElementById('merges-total');
const mergesListBody = document.getElementById('merges-list-body');

const btnExportJson = document.getElementById('btn-export-json');
const btnImportJson = document.getElementById('btn-import-json');

document.addEventListener('DOMContentLoaded', () => {
    // Tab Switching
    document.querySelectorAll('.inspector-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.inspector-tab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            
            e.target.classList.add('active');
            document.getElementById(e.target.dataset.tab).classList.add('active');
        });
    });

    // Preset Sample Chips
    document.querySelectorAll('.sample-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            const key = e.target.dataset.sample;
            promptInput.value = SAMPLES[key];
            runTokenization();
        });
    });

    // Model Change
    modelSelect.addEventListener('change', (e) => {
        tokenizer.selectedRegex = e.target.value;
        runTraining();
    });

    // Input Listeners
    promptInput.value = SAMPLES.multilingual;
    corpusInput.value = SAMPLES.multilingual;

    promptInput.addEventListener('input', runTokenization);
    btnTrainModel.addEventListener('click', runTraining);

    stepSlider.addEventListener('input', () => {
        const val = parseInt(stepSlider.value);
        const max = parseInt(stepSlider.max);
        stepCountLabel.innerText = val === max ? `Step ${val} (Max)` : `Step ${val}/${max}`;
        runTokenization();
    });

    vocabQuery.addEventListener('input', renderVocabTable);

    btnCopySequence.addEventListener('click', () => {
        navigator.clipboard.writeText(tokenSequence.innerText);
        btnCopySequence.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied`;
        setTimeout(() => {
            btnCopySequence.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Array`;
        }, 1500);
    });

    btnExportJson.addEventListener('click', exportModelJSON);
    btnImportJson.addEventListener('change', importModelJSON);

    runTraining();
});

function runTraining() {
    const text = corpusInput.value;
    const size = parseInt(targetVocab.value) || 300;
    const mergeLogs = tokenizer.train(text, size);

    stepSlider.max = mergeLogs.length;
    stepSlider.value = mergeLogs.length;
    stepCountLabel.innerText = `Step ${mergeLogs.length} (Max)`;

    renderMerges(mergeLogs);
    renderVocabTable();
    runTokenization();
}

function runTokenization() {
    const text = promptInput.value;
    const currentStep = parseInt(stepSlider.value) - 1;
    const maxStep = currentStep < 0 ? -1 : currentStep;

    const tokens = tokenizer.encode(text, maxStep);

    countTokens.innerText = tokens.length;
    metricTokens.innerText = tokens.length;
    metricChars.innerText = text.length;

    const ratio = tokens.length > 0 ? (text.length / tokens.length).toFixed(2) : '0.00';
    metricRatio.innerText = ratio;

    // GPT-4o pricing ($0.0025 / 1k tokens)
    const cost = (tokens.length / 1000) * 0.0025;
    metricCost.innerText = `$${cost.toFixed(5)}`;

    // Context Window
    const contextPct = ((tokens.length / 128000) * 100).toFixed(3);
    contextVal.innerText = `${contextPct}%`;
    contextFill.style.width = `${Math.min(100, Math.max(0.5, parseFloat(contextPct)))}%`;

    // Efficiency Comparison
    const encoder = new TextEncoder();
    const charCount = Array.from(encoder.encode(text)).length;
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    compChar.innerText = `${charCount} tokens`;
    compWord.innerText = `${wordCount} tokens`;
    compBpe.innerText = `${tokens.length} tokens`;

    if (tokens.length === 0) {
        tokensDisplay.innerHTML = `<span class="placeholder-text">Type text above...</span>`;
        tokenSequence.innerText = '[ ]';
        tokensTableBody.innerHTML = `<tr><td colspan="4" class="empty-cell">No tokens generated</td></tr>`;
        return;
    }

    // Render Subword Badges
    tokensDisplay.innerHTML = tokens.map((tok, idx) => {
        const bgColor = stringToColor(tok.displayStr);
        const safeText = tok.displayStr
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        return `
            <div class="token-chip" style="background-color: ${bgColor}" data-index="${idx}">
                <span>${safeText === ' ' ? '␣' : safeText}</span>
                <span class="chip-id">${tok.id}</span>
            </div>
        `;
    }).join('');

    tokenSequence.innerText = `[ ${tokens.map(t => t.id).join(', ')} ]`;

    // Render Tokens Table
    tokensTableBody.innerHTML = tokens.map((tok, idx) => `
        <tr id="token-row-${idx}">
            <td style="color: var(--text-muted)">#${idx + 1}</td>
            <td style="color: var(--accent-color); font-weight:700;">${tok.id}</td>
            <td style="font-weight:600;">'${tok.displayStr}'</td>
            <td style="color: var(--text-muted); font-size:0.78rem;">${tok.hex}</td>
        </tr>
    `).join('');

    // Token Chip Click -> Scroll & Highlight Row in Table
    document.querySelectorAll('.token-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            const index = e.currentTarget.dataset.index;
            document.querySelectorAll('.inspector-table tr').forEach(r => r.classList.remove('selected'));
            const row = document.getElementById(`token-row-${index}`);
            if (row) {
                row.classList.add('selected');
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    });
}

function renderMerges(mergeLogs) {
    mergesTotal.innerText = mergeLogs.length;
    if (mergeLogs.length === 0) {
        mergesListBody.innerHTML = `<span class="placeholder-text">No merges learned.</span>`;
        return;
    }

    mergesListBody.innerHTML = mergeLogs.map(log => `
        <div class="merge-item">
            <span>'${log.p1}' + '${log.p2}'</span>
            <span>➔ '${log.merged}'</span>
        </div>
    `).join('');
}

function renderVocabTable() {
    const q = vocabQuery.value.toLowerCase();
    const rows = [];

    for (const [tokenStr, id] of Object.entries(tokenizer.vocab)) {
        const displayStr = Array.from(tokenStr).map(c => byteToUnicode[c.charCodeAt(0)] || c).join('');
        const type = id < 256 ? 'Base Byte' : 'Subword';

        if (q && !id.toString().includes(q) && !displayStr.toLowerCase().includes(q)) {
            continue;
        }

        rows.push(`
            <tr>
                <td style="color: var(--accent-color); font-weight:700;">${id}</td>
                <td style="font-weight:600;">'${displayStr}'</td>
                <td style="color: var(--text-muted); font-size:0.78rem;">${type}</td>
            </tr>
        `);
    }

    vocabTableBody.innerHTML = rows.join('');
}

function exportModelJSON() {
    const data = {
        vocab: tokenizer.vocab,
        merges: tokenizer.merges,
        selectedRegex: tokenizer.selectedRegex
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bpe_tokenizer_studio_model.json';
    a.click();
    URL.revokeObjectURL(url);
}

function importModelJSON(e) {
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
                modelSelect.value = data.selectedRegex;
            }

            renderVocabTable();
            runTokenization();
            alert("✓ Industry Tokenizer Model Imported!");
        } catch (err) {
            alert("Error loading model JSON.");
        }
    };
    reader.readAsText(file);
}
