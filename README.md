# ⚡ TokenViz - World-Class Byte-Level BPE Tokenizer & Visualizer Studio

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/)
[![JavaScript](https://img.shields.io/badge/javascript-ES6+-yellow.svg)](https://developer.mozilla.org/)

**TokenViz Studio** is a state-of-the-art, production-grade **Byte-Level Byte Pair Encoding (BPE) Tokenizer & Comparative Benchmark Suite** built for Large Language Models (LLMs).

Inspired by OpenAI's `tiktoken`, Anthropic, DeepSeek, and Hugging Face Tokenizers, TokenViz visualizes subword tokenization, token density heatmaps, BPE merge hierarchy trees, and multi-model token benchmarks side-by-side.

---

## 🌟 Key Features

* **8-Model Comparative Benchmark Suite:** Side-by-side tokenization comparison across **GPT-4o (`o200k_base`)**, **DeepSeek V3 / R1**, **Claude 3.5 Sonnet**, **GPT-4 (`cl100k_base`)**, **Llama 3 (`128k`)**, **CodeLlama**, **GPT-2 (`r50k_base`)**, and **BERT (`WordPiece`)**.
* **Byte-Level UTF-8 Encoding:** 100% lossless UTF-8 byte handling. Zero Out-Of-Vocabulary (UNK) errors across Hindi, Multilingual text, Emojis, Math symbols, and Code.
* **Token Compression Density Heatmap:** Real-time color-coded heatmap highlighting subword compression efficiency (Green = High compression subwords, Yellow/Red = Rare bytes).
* **Interactive Merge Hierarchy Tree:** Visual step-by-step DAG tree showing how character byte pairs merge iteratively into subwords.
* **Synchronized Token Inspector Table:** Click any subword badge in the visualizer to highlight its exact Index, ID, Subword String, and UTF-8 Hex Bytes in the Inspector Table.
* **LLM Analytics & Cost Calculator:** Real-time calculation of token-to-character ratio, estimated GPT-4o prompt costs, and 128K context window utilization progress.
* **Model Serialization (JSON):** 1-Click Export and Import of custom trained BPE vocabulary and merge rule files (`.json`).
* **Production Python Implementation:** Includes [`tokenizer.py`](tokenizer.py) — a pure, dependency-free Python implementation of Byte-Level BPE.

---

## 📁 Repository Structure

```
├── tokenizer.py            # Standalone Production Python BPE Tokenizer
├── index.html              # TokenViz Studio Web UI Layout
├── style.css               # Clean Helvetica / Vercel Studio Styles
├── app.js                  # Client-side 8-Engine BPE Tokenizer Controller
├── bpe_tokenizer.json      # Serialized BPE Model File
└── README.md               # Documentation
```

---

## 🚀 Quick Start

### 1. Run Web UI Locally
You can run the interactive visualizer web app directly with Python's built-in HTTP server:

```bash
# Clone the repository
git clone https://github.com/codingsexpert/bpe-tokenizer-visualizer.git
cd bpe-tokenizer-visualizer

# Start local server
python3 -m http.server 8000
```
Open **[http://localhost:8000](http://localhost:8000)** in your browser.

---

### 2. Use Python BPE Tokenizer ([`tokenizer.py`](tokenizer.py))

```python
from tokenizer import BPETokenizer

# Initialize Tokenizer
tokenizer = BPETokenizer()

# Register Special Tokens
tokenizer.register_special_tokens(["<|endoftext|>", "<|im_start|>", "<|im_end|>"])

# Train on Corpus
corpus = "Hello world! Don't worry, BPE tokenization is 100% working. नमस्ते दुनिया!"
tokenizer.train(corpus, vocab_size=300)

# Encode Text
text = "Hello world! नमस्ते दुनिया! <|endoftext|>"
allowed_special = {"<|endoftext|>"}
token_ids = tokenizer.encode(text, allowed_special=allowed_special)
print("Token IDs:", token_ids)

# Decode Back to Text
decoded_text = tokenizer.decode(token_ids)
print("Decoded Text:", decoded_text)
assert text == decoded_text, "Roundtrip Verified!"

# Save & Load Model
tokenizer.save("bpe_tokenizer.json")
new_tokenizer = BPETokenizer()
new_tokenizer.load("bpe_tokenizer.json")
```

---

## 🔬 How Byte-Level BPE Works

1. **Byte Representation:** Text is converted to raw UTF-8 bytes (IDs `0..255`).
2. **Regex Pre-tokenization:** Text is split using LLM-specific regex rules to preserve punctuation and contractions (e.g. `'s`, `'t`, `'re`).
3. **Iterative Pair Merging:** The most frequent adjacent byte pair `(A, B)` across the corpus is iteratively merged into a new subword token `AB` until target vocabulary size is reached.
4. **Rank-based Encoding:** At inference, adjacent token pairs in text are merged in order of lowest merge rank (earliest learned during training).

---

## 📜 License
[MIT License](LICENSE) — Feel free to use, modify, and build upon this project.
