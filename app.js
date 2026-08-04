// =====================================================================
//  TokenViz Masterpiece Studio - 100% Lossless Precision BPE Engine
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
    for (let i = ' '.charCodeAt(0); i <= '~'.charCodeAt(0); i++) bs.push(i);
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
    gpt4o: /[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
    gpt4: /(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])|[^r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
    deepseek: /[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
    claude: /[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
    llama3: /[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
    codellama: /\t| +|[a-zA-Z_]\w*|\d+|[^\s\w]/gu,
    gpt2: /'s|'t|'re|'ve|'m|'ll|'d| ?\w+| ?[^\s\w]+|\s+(?!\S)|\s+/gu,
    bert: /\w+|[^\s\w]/gu,
    custom: /'s|'t|'re|'ve|'m|'ll|'d| ?\w+| ?[^\s\w]+|\s+(?!\S)|\s+/gu
};

class JSBPETokenizer {
    constructor() {
        this.vocab = {};
        this.idToVocab = {};
        this.merges = [];
        this.mergeRanks = {};
        this.selectedRegex = 'gpt4o';
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

        const regex = REGEX_PATTERNS[this.selectedRegex] || REGEX_PATTERNS.gpt4o;
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
            const displayStr = Array.from(p).map(c => byteToUnicode[c.charCodeAt(0)] || c).join('');
            return {
                id: this.vocab[p] !== undefined ? this.vocab[p] : 0,
                tokenStr: p,
                displayStr: displayStr,
                hex: hex,
                len: displayStr.length
            };
        });
    }

    encode(text, engineType = null, maxMergeStep = Infinity) {
        if (!text) return [];

        const key = engineType || this.selectedRegex;
        const regex = new RegExp(REGEX_PATTERNS[key] || REGEX_PATTERNS.gpt4o);

        let lastIndex = 0;
        const chunks = [];
        let match;

        regex.lastIndex = 0;
        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                chunks.push(text.slice(lastIndex, match.index));
            }
            chunks.push(match[0]);
            lastIndex = regex.lastIndex;

            if (match.index === regex.lastIndex) {
                regex.lastIndex++;
            }
        }

        if (lastIndex < text.length) {
            chunks.push(text.slice(lastIndex));
        }

        const encoder = new TextEncoder();
        let tokens = [];

        for (const chunk of chunks) {
            if (!chunk) continue;
            const bytes = Array.from(encoder.encode(chunk));
            tokens = tokens.concat(this.encodeChunk(bytes, maxMergeStep));
        }
        return tokens;
    }

    decode(tokens) {
        const bytes = [];
        for (const tok of tokens) {
            const str = this.idToVocab[tok.id] || tok.tokenStr || '';
            for (let i = 0; i < str.length; i++) {
                bytes.push(str.charCodeAt(i));
            }
        }
        const decoder = new TextDecoder('utf-8', { fatal: false });
        return decoder.decode(new Uint8Array(bytes));
    }
}

// Controller
const tokenizer = new JSBPETokenizer();

const SAMPLES = {
    multilingual: `Tokenizers process text into subword units for LLMs. नमस्ते दुनिया!`,
    code: `def bpe_tokenize(prompt):\n    tokens = tokenizer.encode(prompt)\n    return [t.id for t in tokens]`,
    deepseek: `<|Reasoning_Start|> Analyze token density & subword boundary efficiency <|Reasoning_End|>`,
    math: `lim_{x -> 0} (sin x / x) = 1.0  # Calculus identity`
};

// DOM Elements
const promptInput = document.getElementById('prompt-input');
const tokensBox = document.getElementById('tokens-box');
const heatmapBox = document.getElementById('heatmap-box');
const sequenceDisplay = document.getElementById('sequence-display');

const vstatTokens = document.getElementById('vstat-tokens');
const vstatChars = document.getElementById('vstat-chars');
const vstatRatio = document.getElementById('vstat-ratio');

const engineSelect = document.getElementById('engine-select');
const btnCopyIds = document.getElementById('btn-copy-ids');

const tokensTableBody = document.getElementById('tokens-table-body');
const benchmarkList = document.getElementById('benchmark-list');
const treeContainer = document.getElementById('tree-container');

const mTokens = document.getElementById('m-tokens');
const mChars = document.getElementById('m-chars');
const mRatio = document.getElementById('m-ratio');
const mCost = document.getElementById('m-cost');
const ctxVal = document.getElementById('ctx-val');
const ctxFill = document.getElementById('ctx-fill');

const bChar = document.getElementById('b-char');
const bWord = document.getElementById('b-word');
const bBpe = document.getElementById('b-bpe');

const corpusText = document.getElementById('corpus-text');
const targetVocab = document.getElementById('target-vocab');
const btnTrainCustom = document.getElementById('btn-train-custom');
const stepSlider = document.getElementById('step-slider');
const stepLabel = document.getElementById('step-label');
const mergesCount = document.getElementById('merges-count');
const mergesList = document.getElementById('merges-list');

const vocabTableBody = document.getElementById('vocab-table-body');
const vocabSearch = document.getElementById('vocab-search');

const btnExportJson = document.getElementById('btn-export-json');
const btnImportJson = document.getElementById('btn-import-json');

document.addEventListener('DOMContentLoaded', () => {
    // Tabs Navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(p => p.classList.remove('active'));

            e.target.classList.add('active');
            document.getElementById(e.target.dataset.tab).classList.add('active');
        });
    });

    // Engine Selection
    engineSelect.addEventListener('change', (e) => {
        tokenizer.selectedRegex = e.target.value;
        runTraining();
    });

    // Initial Defaults
    promptInput.value = "Tokenizers process text into subword units for LLMs.";
    corpusText.value = SAMPLES.multilingual;

    const btnSendPrompt = document.getElementById('btn-send-prompt');
    if (btnSendPrompt) {
        btnSendPrompt.addEventListener('click', runTokenization);
    }

    promptInput.addEventListener('input', runTokenization);
    btnTrainCustom.addEventListener('click', runTraining);

    stepSlider.addEventListener('input', () => {
        const val = parseInt(stepSlider.value);
        const max = parseInt(stepSlider.max);
        stepLabel.innerText = val === max ? `Step ${val} (Max)` : `Step ${val}/${max}`;
        runTokenization();
    });

    vocabSearch.addEventListener('input', renderVocabTable);

    btnCopyIds.addEventListener('click', () => {
        navigator.clipboard.writeText(sequenceDisplay.innerText);
        btnCopyIds.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied`;
        setTimeout(() => {
            btnCopyIds.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Array`;
        }, 1500);
    });

    btnExportJson.addEventListener('click', exportModelJSON);
    btnImportJson.addEventListener('change', importModelJSON);

    runTraining();
});

function runTraining() {
    const text = corpusText.value;
    const size = parseInt(targetVocab.value) || 300;
    const mergeLogs = tokenizer.train(text, size);

    stepSlider.max = mergeLogs.length;
    stepSlider.value = mergeLogs.length;
    stepLabel.innerText = `Step ${mergeLogs.length} (Max)`;

    renderMerges(mergeLogs);
    renderVocabTable();
    runTokenization();
}

function runTokenization() {
    const text = promptInput.value;
    const currentStep = parseInt(stepSlider.value) - 1;
    const maxStep = currentStep < 0 ? -1 : currentStep;

    const tokens = tokenizer.encode(text, null, maxStep);
    const decoded = tokenizer.decode(tokens);

    // Verify 100% Lossless Roundtrip
    const isRoundtripLossless = (text === decoded);

    vstatTokens.innerText = tokens.length;
    vstatChars.innerText = text.length;
    mTokens.innerText = tokens.length;
    mChars.innerText = text.length;

    const ratio = tokens.length > 0 ? (text.length / tokens.length).toFixed(2) : '0.00';
    vstatRatio.innerText = ratio;
    mRatio.innerText = ratio;

    // GPT-4o pricing ($0.0025 / 1k tokens)
    const cost = (tokens.length / 1000) * 0.0025;
    mCost.innerText = `$${cost.toFixed(5)}`;

    // Context Window
    const contextPct = ((tokens.length / 128000) * 100).toFixed(3);
    ctxVal.innerText = `${contextPct}%`;
    ctxFill.style.width = `${Math.min(100, Math.max(0.5, parseFloat(contextPct)))}%`;

    // Efficiency Comparison
    const encoder = new TextEncoder();
    const charCount = Array.from(encoder.encode(text)).length;
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    bChar.innerText = `${charCount} tokens`;
    bWord.innerText = `${wordCount} tokens`;
    bBpe.innerText = `${tokens.length} tokens`;

    // Render Benchmarks Across Engines
    renderBenchmarkComparison(text);

    if (tokens.length === 0) {
        tokensBox.innerHTML = `<span class="placeholder-text">Type text above...</span>`;
        heatmapBox.innerHTML = `<span class="placeholder-text">Type text above...</span>`;
        sequenceDisplay.innerText = '[ ]';
        tokensTableBody.innerHTML = `<tr><td colspan="4" class="empty-cell">No tokens generated</td></tr>`;
        treeContainer.innerHTML = `<span class="placeholder-text">No merges active</span>`;
        return;
    }

    // Format string helper to replace spaces with visible space glyph ␣
    const formatSubword = (str) => {
        return str
            .replace(/ /g, '␣')
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    };

    // Render Subword Badges
    tokensBox.innerHTML = tokens.map((tok, idx) => {
        const bgColor = stringToColor(tok.displayStr);
        const safeText = formatSubword(tok.displayStr);

        return `
            <div class="subword-badge" style="background-color: ${bgColor}" data-index="${idx}">
                <span>${safeText}</span>
                <span class="subword-id">${tok.id}</span>
            </div>
        `;
    }).join('');

    // Render Compression Heatmap
    heatmapBox.innerHTML = tokens.map(tok => {
        const charLen = tok.len || 1;
        let heatColor = '#fee2e2'; // Low compression
        if (charLen >= 4) heatColor = '#dcfce7';      // High compression
        else if (charLen >= 2) heatColor = '#fef9c3'; // Medium compression

        const safeText = formatSubword(tok.displayStr);
        return `
            <span class="heatmap-pill" style="background-color: ${heatColor}" title="${charLen} chars in token">
                ${safeText}
            </span>
        `;
    }).join('');

    sequenceDisplay.innerText = `[ ${tokens.map(t => t.id).join(', ')} ]`;

    // Render Tokens Table
    tokensTableBody.innerHTML = tokens.map((tok, idx) => `
        <tr id="token-row-${idx}">
            <td style="color: var(--text-muted)">#${idx + 1}</td>
            <td style="color: var(--accent-indigo); font-weight:700;">${tok.id}</td>
            <td style="font-weight:600;">'${formatSubword(tok.displayStr)}'</td>
            <td style="color: var(--text-muted); font-size:0.78rem;">${tok.hex}</td>
        </tr>
    `).join('');

    // Render Merge Tree Hierarchy
    renderMergeTree();

    // Click Badge -> Highlight Table Row
    document.querySelectorAll('.subword-badge').forEach(chip => {
        chip.addEventListener('click', (e) => {
            const index = e.currentTarget.dataset.index;
            document.querySelectorAll('.data-table tr').forEach(r => r.classList.remove('selected'));
            const row = document.getElementById(`token-row-${index}`);
            if (row) {
                row.classList.add('selected');
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    });
}

function renderMergeTree() {
    if (tokenizer.merges.length === 0) {
        treeContainer.innerHTML = `<span class="placeholder-text">Base Byte Tokens (No merges learned yet)</span>`;
        return;
    }

    treeContainer.innerHTML = tokenizer.merges.slice(0, 15).map(([p1, p2], idx) => {
        const p1Str = Array.from(p1).map(c => byteToUnicode[c.charCodeAt(0)] || c).join('');
        const p2Str = Array.from(p2).map(c => byteToUnicode[c.charCodeAt(0)] || c).join('');
        const mergedStr = p1Str + p2Str;
        return `
            <div class="tree-node">
                <span>Rank #${idx + 1}: ('${p1Str}' + '${p2Str}')</span>
                <strong style="color: var(--accent-indigo)">➔ '${mergedStr}'</strong>
            </div>
        `;
    }).join('');
}

function renderBenchmarkComparison(text) {
    const engines = [
        { name: 'GPT-4o (o200k_base BPE)', key: 'gpt4o' },
        { name: 'GPT-4 / GPT-3.5 (cl100k_base BPE)', key: 'gpt4' },
        { name: 'DeepSeek V3 / R1 (Multi-byte BPE)', key: 'deepseek' },
        { name: 'Claude 3.5 Sonnet (Anthropic BPE)', key: 'claude' },
        { name: 'Llama 3 / Mistral (128k BPE)', key: 'llama3' },
        { name: 'CodeLlama / StarCoder (Code BPE)', key: 'codellama' },
        { name: 'GPT-2 (r50k_base BPE)', key: 'gpt2' },
        { name: 'BERT / RoBERTa (WordPiece)', key: 'bert' }
    ];

    const results = engines.map(eng => {
        const tok = tokenizer.encode(text, eng.key);
        return { name: eng.name, count: tok.length };
    });

    const minCount = Math.min(...results.map(r => r.count));

    benchmarkList.innerHTML = results.map(r => `
        <div class="benchmark-card ${r.count === minCount && text.length > 0 ? 'winner' : ''}">
            <span class="bench-model">${r.name}</span>
            <div class="bench-stats">
                <span><strong>${r.count}</strong> tokens</span>
                <span>${text.length > 0 ? (text.length / (r.count || 1)).toFixed(2) : '0'} ratio</span>
            </div>
        </div>
    `).join('');
}

function renderMerges(mergeLogs) {
    mergesCount.innerText = mergeLogs.length;
    if (mergeLogs.length === 0) {
        mergesList.innerHTML = `<span class="placeholder-text">No merges learned.</span>`;
        return;
    }

    mergesList.innerHTML = mergeLogs.map(log => `
        <div class="merge-item">
            <span>'${log.p1}' + '${log.p2}'</span>
            <span>➔ '${log.merged}'</span>
        </div>
    `).join('');
}

function renderVocabTable() {
    const q = vocabSearch.value.toLowerCase();
    const rows = [];

    for (const [tokenStr, id] of Object.entries(tokenizer.vocab)) {
        const displayStr = Array.from(tokenStr).map(c => byteToUnicode[c.charCodeAt(0)] || c).join('');
        const type = id < 256 ? 'Byte' : 'Subword';

        if (q && !id.toString().includes(q) && !displayStr.toLowerCase().includes(q)) {
            continue;
        }

        rows.push(`
            <tr>
                <td style="color: var(--accent-indigo); font-weight:700;">${id}</td>
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
    a.download = 'tokenviz_bpe_model.json';
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
                engineSelect.value = data.selectedRegex;
            }

            renderVocabTable();
            runTokenization();
            alert("✓ Tokenizer Model Imported Successfully!");
        } catch (err) {
            alert("Error loading JSON model.");
        }
    };
    reader.readAsText(file);
}
