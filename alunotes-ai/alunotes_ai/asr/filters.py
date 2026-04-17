"""Post-transcription hallucination filters.

Detects and collapses repeated n-grams that are common ASR hallucination
artifacts (e.g. the model repeating the same phrase over and over).
"""


def filter_hallucinations(text: str, n: int = 5, max_repeats: int = 2) -> str:
    """Remove repeated n-gram sequences from transcribed text.

    If the same sequence of `n` words appears more than `max_repeats` times
    consecutively, collapse it down to `max_repeats` occurrences.

    Args:
        text: Transcribed text to filter.
        n: N-gram size to detect (default 5 words).
        max_repeats: Maximum allowed consecutive repetitions (default 2).

    Returns:
        Filtered text with hallucination repeats collapsed.
    """
    if not text or not text.strip():
        return text

    words = text.split()
    if len(words) < n * (max_repeats + 1):
        return text

    result = _collapse_ngram_repeats(words, n, max_repeats)

    # Also check smaller n-grams (3, 4) for shorter repeated phrases
    for smaller_n in (3, 4):
        if smaller_n < n:
            result = _collapse_ngram_repeats(result, smaller_n, max_repeats)

    return " ".join(result)


def _collapse_ngram_repeats(
    words: list[str], n: int, max_repeats: int
) -> list[str]:
    """Collapse consecutive repeated n-grams in a word list."""
    if len(words) < n * (max_repeats + 1):
        return words

    result: list[str] = []
    i = 0

    while i < len(words):
        # Check if an n-gram starting at i repeats consecutively
        if i + n <= len(words):
            ngram = words[i : i + n]
            repeat_count = 1
            j = i + n

            while j + n <= len(words) and words[j : j + n] == ngram:
                repeat_count += 1
                j += n

            if repeat_count > max_repeats:
                # Keep only max_repeats copies
                for _ in range(max_repeats):
                    result.extend(ngram)
                i = j  # skip past all repeats
                continue

        result.append(words[i])
        i += 1

    return result
