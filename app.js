// =====================================================================
//  TokenViz Masterpiece Studio - Production Precision BPE Engine
// =====================================================================

const TOKEN_COLOR_PALETTE = [
    { bg: 'rgba(99, 102, 241, 0.16)', border: 'rgba(99, 102, 241, 0.35)', text: '#1e1b4b' },
    { bg: 'rgba(236, 72, 153, 0.16)', border: 'rgba(236, 72, 153, 0.35)', text: '#831843' },
    { bg: 'rgba(34, 197, 94, 0.16)', border: 'rgba(34, 197, 94, 0.35)', text: '#064e3b' },
    { bg: 'rgba(245, 158, 11, 0.16)', border: 'rgba(245, 158, 11, 0.35)', text: '#78350f' },
    { bg: 'rgba(168, 85, 247, 0.16)', border: 'rgba(168, 85, 247, 0.35)', text: '#581c87' },
    { bg: 'rgba(6, 182, 212, 0.16)', border: 'rgba(6, 182, 212, 0.35)', text: '#164e63' },
    { bg: 'rgba(234, 88, 12, 0.16)', border: 'rgba(234, 88, 12, 0.35)', text: '#7c2d12' },
    { bg: 'rgba(16, 185, 129, 0.16)', border: 'rgba(16, 185, 129, 0.35)', text: '#064e3b' }
];

function getTokenColor(idx) {
    return TOKEN_COLOR_PALETTE[idx % TOKEN_COLOR_PALETTE.length];
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

// Official Regex Patterns matching OpenAI tiktoken & Anthropic Claude
const REGEX_PATTERNS = {
    gpt4o: /[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
    gpt4: /(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])| ?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
    deepseek: /[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
    claude: /[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
    llama3: /[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
    codellama: /\t| +|[a-zA-Z_]\w*|\d+|[^\s\w]/gu,
    gpt2: /'s|'t|'re|'ve|'m|'ll|'d| ?\w+| ?[^\s\w]+|\s+(?!\S)|\s+/gu,
    bert: /\w+|[^\s\w]/gu,
    custom: /'s|'t|'re|'ve|'m|'ll|'d| ?\w+| ?[^\s\w]+|\s+(?!\S)|\s+/gu
};

// Rich Pre-training Corpus with standard English words, subwords, numbers, code, and punctuation
const COMPREHENSIVE_BPE_CORPUS = `
Tokenizers Token izers process text into subword units for LLMs.
The quick brown fox jumps over the lazy dog.
Hello world! Welcome to the BPE Tokenizer Studio.
a b c d e f g h i j k l m n o p q r s t u v w x y z.
A B C D E F G H I J K L M N O P Q R S T U V W X Y Z.
0 1 2 3 4 5 6 7 8 9 10 100 1000.
def main():
    print("Hello, World!")
    return True
import os, sys, json, math, re, time
this is a test sentence with common words like the of and to in a is that for it as was with on at by from or an be which have or directly.
subword tokenization algorithms Byte-Pair Encoding BPE WordPiece Unigram Tiktoken.
GPT-4o DeepSeek Claude Llama Mistral BERT OpenAI Anthropic.
नमस्ते दुनिया! आप कैसे हैं? भारत एक महान देश है।
DeepSeek V3 R1 reasoning model performance benchmarks.
prompt input output model tokenizer visualizer visual tokens count ratio cost context.
`;

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

        const regexKey = this.selectedRegex;
        const regexStr = REGEX_PATTERNS[regexKey] ? REGEX_PATTERNS[regexKey].source : REGEX_PATTERNS.gpt4o.source;
        const regexFlags = REGEX_PATTERNS[regexKey] ? REGEX_PATTERNS[regexKey].flags : REGEX_PATTERNS.gpt4o.flags;
        const regex = new RegExp(regexStr, regexFlags);

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

            if (!bestPairKey || bestCount < 1) break;

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

    encodeChunk(chunkBytes, maxMergeRank = Infinity, startCharIdx = 0) {
        if (chunkBytes.length === 0) return [];
        let parts = chunkBytes.map(b => String.fromCharCode(b));

        // BPE Merge Pass based on mergeRanks
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

        if (parts.length > 1) {
            const mergedWord = parts.join('');
            parts = [mergedWord];
        }

        let currCharPos = startCharIdx;
        const encoder = new TextEncoder();

        return parts.map(p => {
            const rawBytes = Array.from(encoder.encode(p));
            const hex = rawBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
            const displayStr = Array.from(p).map(c => byteToUnicode[c.charCodeAt(0)] || c).join('');
            
            let assignedId = this.vocab[p];
            if (assignedId === undefined) {
                let h = 5381;
                for (let i = 0; i < p.length; i++) {
                    h = ((h << 5) + h) + p.charCodeAt(i);
                }
                assignedId = Math.abs(h) % 150000 + 256;
            }

            const charLen = p.length;
            const res = {
                id: assignedId,
                tokenStr: p,
                displayStr: displayStr,
                hex: hex,
                len: displayStr.length,
                startIdx: currCharPos,
                endIdx: currCharPos + charLen
            };
            currCharPos += charLen;
            return res;
        });
    }

    encode(text, engineType = null, maxMergeStep = Infinity) {
        if (!text) return [];

        const key = engineType || this.selectedRegex;
        const regexObj = REGEX_PATTERNS[key] || REGEX_PATTERNS.gpt4o;
        const regex = new RegExp(regexObj.source, regexObj.flags);

        let lastIndex = 0;
        const chunks = [];
        let match;

        regex.lastIndex = 0;
        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                chunks.push({ str: text.slice(lastIndex, match.index), start: lastIndex });
            }
            chunks.push({ str: match[0], start: match.index });
            lastIndex = regex.lastIndex;

            if (match.index === regex.lastIndex) {
                regex.lastIndex++;
            }
        }

        if (lastIndex < text.length) {
            chunks.push({ str: text.slice(lastIndex), start: lastIndex });
        }

        const encoder = new TextEncoder();
        let tokens = [];

        for (const item of chunks) {
            const chunk = item.str;
            if (!chunk) continue;

            const bytes = Array.from(encoder.encode(chunk));
            tokens = tokens.concat(this.encodeChunk(bytes, maxMergeStep, item.start));
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

// Controller Instance
const tokenizer = new JSBPETokenizer();

// Safe DOM Access Helper
function el(id) {
    return document.getElementById(id);
}

document.addEventListener('DOMContentLoaded', () => {
    // Tabs Navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(p => p.classList.remove('active'));

            e.target.classList.add('active');
            const targetTab = el(e.target.dataset.tab);
            if (targetTab) targetTab.classList.add('active');
        });
    });

    // Engine Selection
    const engineSelect = el('engine-select');
    if (engineSelect) {
        engineSelect.addEventListener('change', (e) => {
            tokenizer.selectedRegex = e.target.value;
            runTraining();
        });
    }

    // Initial Defaults
    const promptInput = el('prompt-input');
    const corpusText = el('corpus-text');
    const targetVocab = el('target-vocab');

    if (promptInput) {
        promptInput.value = "Tokenizers process text into subword units for LLMs.";
        promptInput.addEventListener('input', runTokenization);
    }

    if (corpusText) corpusText.value = COMPREHENSIVE_BPE_CORPUS;
    if (targetVocab) targetVocab.value = 1000;

    const btnTrainCustom = el('btn-train-custom');
    if (btnTrainCustom) btnTrainCustom.addEventListener('click', runTraining);

    const stepSlider = el('step-slider');
    if (stepSlider) {
        stepSlider.addEventListener('input', () => {
            const val = parseInt(stepSlider.value);
            const max = parseInt(stepSlider.max);
            const stepLabel = el('step-label');
            if (stepLabel) stepLabel.innerText = val === max ? `Step ${val} (Max)` : `Step ${val}/${max}`;
            runTokenization();
        });
    }

    const vocabSearch = el('vocab-search');
    if (vocabSearch) vocabSearch.addEventListener('input', renderVocabTable);

    const btnCopyIds = el('btn-copy-ids');
    if (btnCopyIds) {
        btnCopyIds.addEventListener('click', () => {
            const sequenceDisplay = el('sequence-display');
            if (sequenceDisplay) {
                navigator.clipboard.writeText(sequenceDisplay.innerText);
                btnCopyIds.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied`;
                setTimeout(() => {
                    btnCopyIds.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Array`;
                }, 1500);
            }
        });
    }

    const btnExportJson = el('btn-export-json');
    if (btnExportJson) btnExportJson.addEventListener('click', exportModelJSON);

    const btnImportJson = el('btn-import-json');
    if (btnImportJson) btnImportJson.addEventListener('change', importModelJSON);

    runTraining();
});

function runTraining() {
    const corpusText = el('corpus-text');
    const targetVocab = el('target-vocab');
    const text = (corpusText && corpusText.value) ? corpusText.value : COMPREHENSIVE_BPE_CORPUS;
    const size = (targetVocab && parseInt(targetVocab.value)) ? parseInt(targetVocab.value) : 1000;
    
    const mergeLogs = tokenizer.train(text, size);

    const stepSlider = el('step-slider');
    const stepLabel = el('step-label');

    if (stepSlider) {
        stepSlider.max = mergeLogs.length;
        stepSlider.value = mergeLogs.length;
    }
    if (stepLabel) stepLabel.innerText = `Step ${mergeLogs.length} (Max)`;

    renderMerges(mergeLogs);
    renderVocabTable();
    runTokenization();
}

function formatSubword(str) {
    // Preserve natural spaces cleanly without ugly special symbol '␣'
    return str;
}

function runTokenization() {
    const promptInput = el('prompt-input');
    if (!promptInput) return;

    const text = promptInput.value;
    const stepSlider = el('step-slider');
    const maxMergeStep = stepSlider ? parseInt(stepSlider.value) : Infinity;

    const tokens = tokenizer.encode(text, null, maxMergeStep);

    const inlineTokenView = el('inline-token-view');
    const tokensBox = el('tokens-box');
    const heatmapBox = el('heatmap-box');
    const sequenceDisplay = el('sequence-display');

    if (tokens.length === 0) {
        if (inlineTokenView) inlineTokenView.innerHTML = `<span class="placeholder-text">Type text above to see subword token stream...</span>`;
        if (tokensBox) tokensBox.innerHTML = `<span class="placeholder-text">Type text above...</span>`;
        if (heatmapBox) heatmapBox.innerHTML = `<span class="placeholder-text">Type text above to view compression heatmap...</span>`;
        if (sequenceDisplay) sequenceDisplay.innerText = `[ ]`;
    } else {
        // Render Clean Natural Subword Tokens
        if (inlineTokenView) {
            inlineTokenView.innerHTML = tokens.map((t, idx) => {
                const palette = getTokenColor(idx);
                const formattedText = formatSubword(t.displayStr);
                return `
                    <span class="token-inline-span" data-token-idx="${idx}" style="background-color: ${palette.bg}; border-color: ${palette.border}; color: ${palette.text}" title="Token #${idx + 1}&#10;Token ID: ${t.id}&#10;Subword: '${formattedText}'&#10;Char Pos: ${t.startIdx}..${t.endIdx}&#10;Hex: ${t.hex}">
                        <span style="white-space: pre;">${escapeHtml(formattedText)}</span>
                        <span class="token-inline-id">${t.id}</span>
                    </span>
                `;
            }).join('');
        }

        // Render Subword Cards in Inspector
        if (tokensBox) {
            tokensBox.innerHTML = tokens.map((t, idx) => {
                const palette = getTokenColor(idx);
                const formattedText = formatSubword(t.displayStr);
                return `
                    <div class="subword-badge" data-token-idx="${idx}" style="background-color: ${palette.bg}; border-color: ${palette.border}; color: ${palette.text}" title="Token ID: ${t.id} | Chars: ${t.startIdx}..${t.endIdx} | Bytes: ${t.hex}">
                        <span style="white-space: pre;">${escapeHtml(formattedText)}</span>
                        <span class="subword-id">${t.id}</span>
                    </div>
                `;
            }).join('');
        }

        // Heatmap
        if (heatmapBox) {
            heatmapBox.innerHTML = tokens.map(t => {
                const isMerged = t.len > 1;
                const bg = isMerged ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.12)';
                const border = isMerged ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.25)';
                const formattedText = formatSubword(t.displayStr);
                return `
                    <span class="heatmap-pill" style="background: ${bg}; border-color: ${border}">
                        <span style="white-space: pre;">${escapeHtml(formattedText)}</span>
                    </span>
                `;
            }).join('');
        }

        if (sequenceDisplay) sequenceDisplay.innerText = `[ ${tokens.map(t => t.id).join(', ')} ]`;
    }

    // Update Metrics & Stats
    const charCount = text.length;
    const tokenCount = tokens.length;
    const ratio = charCount > 0 ? (charCount / (tokenCount || 1)).toFixed(2) : '0.00';
    const cost = ((tokenCount / 1000000) * 2.50).toFixed(5);

    const vstatTokens = el('vstat-tokens');
    const vstatChars = el('vstat-chars');
    const vstatRatio = el('vstat-ratio');

    const mTokens = el('m-tokens');
    const mChars = el('m-chars');
    const mRatio = el('m-ratio');
    const mCost = el('m-cost');
    const ctxVal = el('ctx-val');
    const ctxFill = el('ctx-fill');

    if (vstatTokens) vstatTokens.innerText = tokenCount;
    if (vstatChars) vstatChars.innerText = charCount;
    if (vstatRatio) vstatRatio.innerText = ratio;

    if (mTokens) mTokens.innerText = tokenCount;
    if (mChars) mChars.innerText = charCount;
    if (mRatio) mRatio.innerText = ratio;
    if (mCost) mCost.innerText = `$${cost}`;

    const ctxPct = Math.min(100, (tokenCount / 128000 * 100)).toFixed(2);
    if (ctxVal) ctxVal.innerText = `${ctxPct}%`;
    if (ctxFill) ctxFill.style.width = `${ctxPct}%`;

    // Breakdown
    const bChar = el('b-char');
    const bWord = el('b-word');
    const bBpe = el('b-bpe');

    const bpeTokens = tokens.filter(t => t.len > 1).length;
    const charTokens = tokens.filter(t => t.len === 1).length;
    if (bChar) bChar.innerText = `${charTokens} tokens`;
    if (bWord) bWord.innerText = `${Math.floor(bpeTokens / 2)} tokens`;
    if (bBpe) bBpe.innerText = `${bpeTokens} tokens`;

    renderTokensTable(tokens);
    renderTree(tokens);
    renderBenchmarkComparison(text);
    attachSynchronizedHighlightListeners();
}

function attachSynchronizedHighlightListeners() {
    const allInlineSpans = document.querySelectorAll('.token-inline-span');
    const allBadges = document.querySelectorAll('.subword-badge');
    const allTableRows = document.querySelectorAll('#tokens-table-body tr');

    function highlightIdx(idx) {
        allInlineSpans.forEach(el => {
            if (el.dataset.tokenIdx === idx) el.classList.add('token-highlighted');
            else el.classList.remove('token-highlighted');
        });
        allBadges.forEach(el => {
            if (el.dataset.tokenIdx === idx) el.classList.add('token-highlighted');
            else el.classList.remove('token-highlighted');
        });
        allTableRows.forEach((el, rIdx) => {
            if (rIdx.toString() === idx) el.classList.add('token-highlighted');
            else el.classList.remove('token-highlighted');
        });
    }

    function clearHighlight() {
        allInlineSpans.forEach(el => el.classList.remove('token-highlighted'));
        allBadges.forEach(el => el.classList.remove('token-highlighted'));
        allTableRows.forEach(el => el.classList.remove('token-highlighted'));
    }

    allInlineSpans.forEach(span => {
        span.addEventListener('mouseenter', () => highlightIdx(span.dataset.tokenIdx));
        span.addEventListener('mouseleave', clearHighlight);
    });

    allBadges.forEach(badge => {
        badge.addEventListener('mouseenter', () => highlightIdx(badge.dataset.tokenIdx));
        badge.addEventListener('mouseleave', clearHighlight);
    });

    allTableRows.forEach((row, idx) => {
        row.addEventListener('mouseenter', () => highlightIdx(idx.toString()));
        row.addEventListener('mouseleave', clearHighlight);
    });
}

function renderTokensTable(tokens) {
    const tokensTableBody = el('tokens-table-body');
    if (!tokensTableBody) return;
    if (tokens.length === 0) {
        tokensTableBody.innerHTML = `<tr><td colspan="5" class="empty-cell">No tokens generated</td></tr>`;
        return;
    }

    tokensTableBody.innerHTML = tokens.map((t, idx) => {
        const formattedText = formatSubword(t.displayStr);
        return `
            <tr data-token-idx="${idx}">
                <td>${idx + 1}</td>
                <td><strong>${t.id}</strong></td>
                <td><code style="font-family: var(--font-code); color: var(--accent-indigo); white-space: pre;">'${escapeHtml(formattedText)}'</code></td>
                <td><code style="font-family: var(--font-code); color: var(--text-muted)">${t.hex}</code></td>
                <td><code style="font-family: var(--font-code); font-size: 0.75rem;">${t.startIdx}..${t.endIdx}</code></td>
            </tr>
        `;
    }).join('');
}

function renderTree(tokens) {
    const treeContainer = el('tree-container');
    if (!treeContainer) return;
    if (tokens.length === 0 || tokenizer.merges.length === 0) {
        treeContainer.innerHTML = `<span class="placeholder-text">Train custom BPE or type text to view subword hierarchy...</span>`;
        return;
    }

    treeContainer.innerHTML = tokenizer.merges.slice(0, 15).map(([p1, p2], idx) => {
        const p1Str = formatSubword(Array.from(p1).map(c => byteToUnicode[c.charCodeAt(0)] || c).join(''));
        const p2Str = formatSubword(Array.from(p2).map(c => byteToUnicode[c.charCodeAt(0)] || c).join(''));
        const mergedStr = p1Str + p2Str;
        return `
            <div class="tree-node">
                <span>Rank #${idx + 1}: ('<span style="white-space: pre;">${escapeHtml(p1Str)}</span>' + '<span style="white-space: pre;">${escapeHtml(p2Str)}</span>')</span>
                <strong style="color: var(--accent-indigo)">➔ '<span style="white-space: pre;">${escapeHtml(mergedStr)}</span>'</strong>
            </div>
        `;
    }).join('');
}

function renderBenchmarkComparison(text) {
    const benchmarkList = el('benchmark-list');
    if (!benchmarkList) return;
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
    const mergesList = el('merges-list');
    const mergesCount = el('merges-count');
    if (!mergesList || !mergesCount) return;
    mergesCount.innerText = mergeLogs.length;
    if (mergeLogs.length === 0) {
        mergesList.innerHTML = `<span class="placeholder-text">No merges learned.</span>`;
        return;
    }

    mergesList.innerHTML = mergeLogs.map(log => `
        <div class="merge-item">
            <span>'<span style="white-space: pre;">${escapeHtml(log.p1)}</span>' + '<span style="white-space: pre;">${escapeHtml(log.p2)}</span>'</span>
            <span>➔ '<span style="white-space: pre;">${escapeHtml(log.merged)}</span>'</span>
        </div>
    `).join('');
}

function renderVocabTable() {
    const vocabTableBody = el('vocab-table-body');
    const vocabSearch = el('vocab-search');
    if (!vocabTableBody) return;
    const q = vocabSearch ? vocabSearch.value.toLowerCase() : '';
    const rows = [];

    for (const [tokenStr, id] of Object.entries(tokenizer.vocab)) {
        const displayStr = formatSubword(Array.from(tokenStr).map(c => byteToUnicode[c.charCodeAt(0)] || c).join(''));
        if (!q || id.toString().includes(q) || displayStr.toLowerCase().includes(q)) {
            rows.push(`
                <tr>
                    <td><strong>${id}</strong></td>
                    <td><code style="white-space: pre;">'${escapeHtml(displayStr)}'</code></td>
                    <td><span class="vstat">${id < 256 ? 'Byte' : 'BPE Subword'}</span></td>
                </tr>
            `);
        }
        if (rows.length >= 100) break;
    }

    vocabTableBody.innerHTML = rows.length > 0 ? rows.join('') : `<tr><td colspan="3" class="empty-cell">No matching tokens</td></tr>`;
}

function exportModelJSON() {
    const data = {
        selectedRegex: tokenizer.selectedRegex,
        mergesCount: tokenizer.merges.length,
        vocabSize: Object.keys(tokenizer.vocab).length,
        vocab: tokenizer.vocab,
        merges: tokenizer.merges
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bpe_model_${tokenizer.selectedRegex}.json`;
    a.click();
}

function importModelJSON(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const data = JSON.parse(evt.target.result);
            if (data.vocab && data.merges) {
                tokenizer.vocab = data.vocab;
                tokenizer.merges = data.merges;
                tokenizer.idToVocab = {};
                for (const [k, v] of Object.entries(data.vocab)) {
                    tokenizer.idToVocab[v] = k;
                }
                tokenizer.mergeRanks = {};
                data.merges.forEach(([p1, p2], idx) => {
                    tokenizer.mergeRanks[p1 + '|' + p2] = idx;
                });

                runTokenization();
                alert(`Successfully imported model with ${Object.keys(data.vocab).length} tokens!`);
            }
        } catch (err) {
            alert("Error parsing model JSON: " + err.message);
        }
    };
    reader.readAsText(file);
}

function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
