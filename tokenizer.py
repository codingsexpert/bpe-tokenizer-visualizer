# =====================================================================
#  Production-Grade Byte-Level BPE Tokenizer (GPT-2 / GPT-4 Style)
#
#  Features:
#   1. Byte-level UTF-8 encoding (Zero UNK errors, supports Hindi, Emojis, any unicode)
#   2. GPT-style Regex Pre-tokenization (Clean handling of punctuation & contractions)
#   3. Rank-based merge algorithm (Priority-based subword encoding)
#   4. Special Tokens support (<|endoftext|>, <|im_start|>, etc.)
#   5. Model Save & Load (Serialization to JSON)
# =====================================================================

import json
import os
import re
from typing import Dict, List, Optional, Set, Tuple


def bytes_to_unicode() -> Dict[int, str]:
    """
    Returns a mapping between UTF-8 bytes and printable unicode characters.
    Same encoding technique used in GPT-2 / GPT-4 for pretty string rendering.
    """
    bs = (
        list(range(ord("!"), ord("~") + 1))
        + list(range(ord("¡"), ord("¬") + 1))
        + list(range(ord("®"), ord("ÿ") + 1))
    )
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    cs_chars = [chr(n) for n in cs]
    return dict(zip(bs, cs_chars))


class BPETokenizer:
    def __init__(self):
        # Byte-to-Unicode maps for pretty printing
        self.byte_encoder = bytes_to_unicode()
        self.byte_decoder = {v: k for k, v in self.byte_encoder.items()}

        # Pair -> Rank (0, 1, 2, ...)
        self.merges: Dict[Tuple[bytes, bytes], int] = {}
        # Token bytes -> ID
        self.vocab: Dict[bytes, int] = {}
        # ID -> Token bytes
        self.id_to_vocab: Dict[int, bytes] = {}

        # Special tokens set and mappings
        self.special_tokens_list: List[str] = []
        self.special_tokens: Dict[str, int] = {}
        self.inverse_special_tokens: Dict[int, str] = {}

        # Standard GPT-2 style pre-tokenization regex pattern
        self.pat = re.compile(
            r"""'s|'t|'re|'ve|'m|'ll|'d| ?\w+| ?[^\s\w]+|\s+(?!\S)|\s+""",
            re.UNICODE,
        )

        self._init_base_vocab()

    def _init_base_vocab(self):
        """Initialize base vocabulary with 256 single bytes."""
        self.vocab = {}
        self.id_to_vocab = {}
        for b in range(256):
            token_bytes = bytes([b])
            self.vocab[token_bytes] = b
            self.id_to_vocab[b] = token_bytes

    def register_special_tokens(self, special_tokens: List[str]):
        """Add special tokens to tokenizer."""
        for st in special_tokens:
            if st not in self.special_tokens_list:
                self.special_tokens_list.append(st)
        self._assign_special_token_ids()

    def _assign_special_token_ids(self):
        """Assign IDs to special tokens guaranteeing no overlap with vocab IDs."""
        current_max_id = max(self.id_to_vocab.keys(), default=255)

        # Clear existing special maps to re-assign cleanly if needed
        self.special_tokens = {}
        self.inverse_special_tokens = {}

        for st in self.special_tokens_list:
            current_max_id += 1
            self.special_tokens[st] = current_max_id
            self.inverse_special_tokens[current_max_id] = st

    def train(self, text: str, vocab_size: int, verbose: bool = True):
        """Train BPE vocabulary on text up to target vocab_size."""
        num_merges = vocab_size - 256 - len(self.special_tokens_list)
        if num_merges <= 0:
            if verbose:
                print(f"Target vocab_size {vocab_size} is <= base bytes + special tokens.")
            return

        if verbose:
            print("=== TRAINING BPE TOKENIZER ===")
            print(f"Input text length: {len(text)} characters")
            print(f"Target vocabulary size: {vocab_size}")
            print(f"Number of merges to perform: {num_merges}\n")

        # 1. Pre-tokenize text into word chunks using regex
        raw_chunks = self.pat.findall(text)

        # 2. Convert each chunk to sequence of single bytes & count frequency
        word_counts: Dict[Tuple[bytes, ...], int] = {}
        for chunk in raw_chunks:
            chunk_bytes = chunk.encode("utf-8")
            byte_seq = tuple(bytes([b]) for b in chunk_bytes)
            word_counts[byte_seq] = word_counts.get(byte_seq, 0) + 1

        if verbose:
            print(f"Unique pre-tokenized chunks: {len(word_counts)}\n")

        # 3. Iteratively merge most frequent adjacent pairs
        self._init_base_vocab()
        self.merges = {}
        next_id = 256

        for i in range(num_merges):
            # Count pair frequencies
            pair_counts: Dict[Tuple[bytes, bytes], int] = {}
            for seq, freq in word_counts.items():
                for j in range(len(seq) - 1):
                    pair = (seq[j], seq[j + 1])
                    pair_counts[pair] = pair_counts.get(pair, 0) + freq

            if not pair_counts:
                if verbose:
                    print("No more pairs to merge. Stopping early.")
                break

            # Find pair with max frequency
            best_pair = max(pair_counts, key=pair_counts.get)
            best_freq = pair_counts[best_pair]

            if best_freq < 2:
                if verbose:
                    print("Most frequent pair appears less than 2 times. Stopping early.")
                break

            # Merge pair
            merged_token = best_pair[0] + best_pair[1]

            # Assign rank and vocab ID
            self.merges[best_pair] = i
            self.vocab[merged_token] = next_id
            self.id_to_vocab[next_id] = merged_token
            next_id += 1

            if verbose and (i < 5 or (i + 1) % 10 == 0 or i == num_merges - 1):
                p0_str = "".join(self.byte_encoder[b] for b in best_pair[0])
                p1_str = "".join(self.byte_encoder[b] for b in best_pair[1])
                m_str = "".join(self.byte_encoder[b] for b in merged_token)
                print(
                    f"Merge {i + 1}/{num_merges}: ('{p0_str}', '{p1_str}') -> '{m_str}'  (freq: {best_freq})"
                )

            # Update word_counts with merged token
            new_word_counts: Dict[Tuple[bytes, ...], int] = {}
            for seq, freq in word_counts.items():
                new_seq = []
                j = 0
                while j < len(seq):
                    if (
                        j < len(seq) - 1
                        and seq[j] == best_pair[0]
                        and seq[j + 1] == best_pair[1]
                    ):
                        new_seq.append(merged_token)
                        j += 2
                    else:
                        new_seq.append(seq[j])
                        j += 1
                new_seq_tuple = tuple(new_seq)
                new_word_counts[new_seq_tuple] = (
                    new_word_counts.get(new_seq_tuple, 0) + freq
                )

            word_counts = new_word_counts

        # Re-assign special token IDs above the max vocab ID
        self._assign_special_token_ids()

        if verbose:
            print("\n=== TRAINING COMPLETE ===")
            print(f"Final Vocab Size: {len(self.vocab) + len(self.special_tokens)} tokens")
            print(f"Total Merges Learned: {len(self.merges)}\n")

    def _encode_chunk(self, chunk_bytes: bytes) -> List[int]:
        """Encode a single chunk of bytes using lowest-rank merges."""
        if not chunk_bytes:
            return []

        parts = [bytes([b]) for b in chunk_bytes]

        while len(parts) >= 2:
            # Find pair with lowest merge rank
            min_rank = float("inf")
            best_idx = -1

            for i in range(len(parts) - 1):
                pair = (parts[i], parts[i + 1])
                if pair in self.merges:
                    rank = self.merges[pair]
                    if rank < min_rank:
                        min_rank = rank
                        best_idx = i

            if best_idx == -1:
                # No more mergeable pairs
                break

            # Apply merge at best_idx
            parts[best_idx] = parts[best_idx] + parts[best_idx + 1]
            parts.pop(best_idx + 1)

        return [self.vocab[p] for p in parts]

    def encode(
        self, text: str, allowed_special: Optional[Set[str]] = None
    ) -> List[int]:
        """Encode string text into list of token IDs with special token and regex support."""
        if allowed_special is None:
            allowed_special = set()

        self._assign_special_token_ids()

        # Handle special tokens via regex splitting if allowed
        if allowed_special:
            special_pattern = "|".join(re.escape(st) for st in allowed_special)
            parts = re.split(f"({special_pattern})", text)
        else:
            parts = [text]

        ids = []
        for part in parts:
            if part in allowed_special:
                ids.append(self.special_tokens[part])
            else:
                # Regex pre-tokenize normal text
                chunks = self.pat.findall(part)
                for chunk in chunks:
                    chunk_bytes = chunk.encode("utf-8")
                    ids.extend(self._encode_chunk(chunk_bytes))

        return ids

    def decode(self, ids: List[int]) -> str:
        """Decode list of token IDs back into readable text string."""
        byte_parts = []
        text_parts = []

        for token_id in ids:
            if token_id in self.inverse_special_tokens:
                # Flush accumulated bytes first
                if byte_parts:
                    text_parts.append(
                        b"".join(byte_parts).decode("utf-8", errors="replace")
                    )
                    byte_parts = []
                text_parts.append(self.inverse_special_tokens[token_id])
            elif token_id in self.id_to_vocab:
                byte_parts.append(self.id_to_vocab[token_id])

        if byte_parts:
            text_parts.append(b"".join(byte_parts).decode("utf-8", errors="replace"))

        return "".join(text_parts)

    def save(self, file_path: str = "bpe_tokenizer.json"):
        """Save vocabulary, merges, and special tokens to a JSON file."""
        vocab_serialized = {
            token_bytes.hex(): token_id
            for token_bytes, token_id in self.vocab.items()
        }
        merges_serialized = [
            [p[0].hex(), p[1].hex(), rank] for p, rank in self.merges.items()
        ]

        data = {
            "vocab": vocab_serialized,
            "merges": merges_serialized,
            "special_tokens_list": self.special_tokens_list,
            "special_tokens": self.special_tokens,
        }

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        print(f"✓ Saved tokenizer model to '{file_path}'")

    def load(self, file_path: str = "bpe_tokenizer.json"):
        """Load vocabulary, merges, and special tokens from a JSON file."""
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.vocab = {
            bytes.fromhex(hex_str): token_id
            for hex_str, token_id in data["vocab"].items()
        }
        self.id_to_vocab = {v: k for k, v in self.vocab.items()}

        self.merges = {
            (bytes.fromhex(p0), bytes.fromhex(p1)): rank
            for p0, p1, rank in data["merges"]
        }

        self.special_tokens_list = data.get("special_tokens_list", [])
        self.special_tokens = {k: int(v) for k, v in data["special_tokens"].items()}
        self.inverse_special_tokens = {
            int(v): k for k, v in self.special_tokens.items()
        }

        print(f"✓ Loaded tokenizer model from '{file_path}'")


def main():
    # -------------------------------------------------------------
    # 1. Training Setup
    # -------------------------------------------------------------
    sample_text = (
        "Hello world! Don't worry, BPE tokenization is 100% working. "
        "नमस्ते दुनिया! Python BPE tokenizer is super fast and clean. "
        "low lower lowest newest newer."
    )

    tokenizer = BPETokenizer()
    tokenizer.register_special_tokens(["<|endoftext|>", "<|im_start|>", "<|im_end|>"])

    # Train to a vocab size of 300
    tokenizer.train(sample_text, vocab_size=300)

    # -------------------------------------------------------------
    # 2. Test Encoding & Decoding with Punctuation, Contractions & Hindi
    # -------------------------------------------------------------
    print("=== ENCODING & DECODING TEST ===")
    test_text = "Hello world! Don't worry, नमस्ते दुनिया! <|endoftext|>"
    print(f"Original Text:  {repr(test_text)}")

    # Encode allowing special tokens
    allowed = {"<|endoftext|>"}
    encoded_ids = tokenizer.encode(test_text, allowed_special=allowed)
    print(f"Encoded IDs:    {encoded_ids}")

    # Decode back
    decoded_text = tokenizer.decode(encoded_ids)
    print(f"Decoded Text:   {repr(decoded_text)}")
    assert test_text == decoded_text, f"Mismatch!\nExpected: {repr(test_text)}\nGot:      {repr(decoded_text)}"
    print("✓ Roundtrip Test Passed!\n")

    # -------------------------------------------------------------
    # 3. Test Save & Load Functionality
    # -------------------------------------------------------------
    print("=== SAVE & LOAD TEST ===")
    model_filename = "bpe_tokenizer.json"
    tokenizer.save(model_filename)

    new_tokenizer = BPETokenizer()
    new_tokenizer.load(model_filename)

    re_encoded = new_tokenizer.encode(test_text, allowed_special=allowed)
    re_decoded = new_tokenizer.decode(re_encoded)
    print(f"Re-loaded Decoded: {repr(re_decoded)}")
    assert decoded_text == re_decoded, "Error: Loaded model output mismatched!"
    print("✓ Save/Load Verification Passed!")


if __name__ == "__main__":
    main()
