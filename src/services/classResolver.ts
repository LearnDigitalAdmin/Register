import { ClassStructure } from '../types';

/**
 * Resolves a raw, teacher-typed class/stream string (or a class + separate stream string)
 * into one of the school's actual canonical class codes (e.g. "Grade 6Blue").
 *
 * Canonical classes are always built as `${level}${stream}` with NO separator (see
 * `buildClassList` in academicYearService.ts) — so "Grade 6" + "Blue" = "Grade 6Blue".
 * Real-world spreadsheets almost never contain that exact string. They contain things like
 * "6blue", "Grade 6 Blue", "GRADE6BLUE", "6 Blue", "grade six blue" (not handled — no word
 * numerals), etc. This module normalises both sides and matches level first, then stream,
 * rather than requiring an exact match against the canonical list.
 *
 * Resolution never guesses between two equally-plausible answers — anything genuinely
 * ambiguous comes back as an issue for a human to fix, never a silent best-effort pick.
 */

export type ClassResolutionIssue =
  | 'no_class_data'        // school has no classStructure loaded yet — can't resolve anything
  | 'no_level_match'       // couldn't find any configured level in the text at all
  | 'ambiguous_level'      // text matches more than one configured level equally well
  | 'stream_missing'       // level matched, but streams are enabled and no stream text was found
  | 'stream_unresolved'    // level matched, leftover text doesn't match any configured stream
  | 'ambiguous_stream'     // leftover text matches more than one configured stream
  | 'unexpected_extra_text'; // level matched, streams aren't enabled, but there's leftover text

export interface ClassResolutionResult {
  /** Canonical class code (e.g. "Grade 6Blue") if resolution succeeded, else null. */
  resolved: string | null;
  issue?: ClassResolutionIssue;
  message?: string;
}

/** Lowercases and strips everything but letters/digits, so spacing/case/punctuation never matter. */
function normToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Attempts to resolve a raw class string (optionally with a separately-mapped stream string)
 * against the school's ClassStructure. Both `rawClass` and `rawStream` may be used together —
 * whether the source file has one combined column ("Grade 6 Blue") or two separate columns
 * ("Grade 6" / "Blue"), they're joined before matching so the same logic handles both.
 */
export function resolveClassCode(
  rawClass: string,
  rawStream: string | undefined,
  cs: ClassStructure | null,
): ClassResolutionResult {
  const classText = (rawClass || '').trim();
  const streamText = (rawStream || '').trim();
  const combined = streamText ? `${classText} ${streamText}` : classText;

  if (!combined) {
    return { resolved: null, issue: 'no_level_match', message: 'Class is missing.' };
  }
  if (!cs) {
    return { resolved: null, issue: 'no_class_data', message: 'This school has no class structure set up yet.' };
  }

  const combinedNorm = normToken(combined);

  // Fast path: the file already has the exact canonical class string (or matches it once normalised).
  const exact = cs.classes.find(c => normToken(c) === combinedNorm);
  if (exact) return { resolved: exact };

  // ── Match the level ───────────────────────────────────────────────────────
  // Prefer the longest matching configured level so e.g. "Grade 10" wins over "Grade 1"
  // when both are technically prefixes of the normalised text. A prefix match is rejected
  // when the level ends in a digit and the very next character continues that digit run —
  // e.g. "Grade 6" must NOT match inside "Grade 60Blue"; 60 is a different number entirely,
  // not "Grade 6" with some suffix.
  const prefixMatches = cs.levels
    .map(level => ({ level, norm: normToken(level) }))
    .filter(({ norm }) => {
      if (!combinedNorm.startsWith(norm)) return false;
      const nextChar = combinedNorm[norm.length];
      const levelEndsInDigit = /\d$/.test(norm);
      if (levelEndsInDigit && nextChar && /\d/.test(nextChar)) return false;
      return true;
    })
    .sort((a, b) => b.norm.length - a.norm.length);

  let matchedLevel: string | undefined = prefixMatches[0]?.level;
  let remainderNorm = matchedLevel ? combinedNorm.slice(normToken(matchedLevel).length) : combinedNorm;

  // Flag genuine ties (two configured levels with the same normalised length both matching) —
  // extremely unlikely in practice, but never silently pick one.
  if (prefixMatches.length > 1 && prefixMatches[0].norm.length === prefixMatches[1].norm.length) {
    return {
      resolved: null, issue: 'ambiguous_level',
      message: `"${combined}" matches more than one class level at this school (${prefixMatches.map(p => p.level).join(', ')}).`,
    };
  }

  // Numeric fallback: level not found as a text prefix (e.g. "6blue" when the configured level
  // is "Grade 6") — compare the leading digits of the input to the digits inside each level name.
  if (!matchedLevel) {
    const digits = combinedNorm.match(/^\d+/)?.[0];
    if (digits) {
      const candidates = cs.levels.filter(level => level.match(/\d+/)?.[0] === digits);
      if (candidates.length === 1) {
        matchedLevel = candidates[0];
        remainderNorm = combinedNorm.slice(digits.length);
      } else if (candidates.length > 1) {
        return {
          resolved: null, issue: 'ambiguous_level',
          message: `"${combined}" could mean more than one class level at this school (${candidates.join(', ')}).`,
        };
      }
    }
  }

  if (!matchedLevel) {
    return { resolved: null, issue: 'no_level_match', message: `"${combined}" doesn't match any class level at this school.` };
  }

  // ── No streams at this school: level alone is the whole class code ────────
  if (!cs.streamsEnabled || cs.streamMode === 'none') {
    if (remainderNorm) {
      return {
        resolved: null, issue: 'unexpected_extra_text',
        message: `"${combined}" has extra text after "${matchedLevel}" that doesn't match anything — this school doesn't use streams.`,
      };
    }
    return { resolved: matchedLevel };
  }

  // ── Match the stream ───────────────────────────────────────────────────────
  const allowedStreams = cs.streamMode === 'uniform'
    ? (cs.uniformStreams || [])
    : (cs.perClassStreams?.[matchedLevel] || []);

  if (!remainderNorm) {
    return {
      resolved: null, issue: 'stream_missing',
      message: `"${combined}" is missing a stream for ${matchedLevel} (e.g. ${allowedStreams[0] || 'A'}).`,
    };
  }

  const exactStream = allowedStreams.find(s => normToken(s) === remainderNorm);
  if (exactStream) return { resolved: `${matchedLevel}${exactStream}` };

  // Light fuzzy pass — only accepted when it narrows to exactly one candidate.
  const fuzzy = allowedStreams.filter(s => {
    const sn = normToken(s);
    return sn.length > 0 && (sn.includes(remainderNorm) || remainderNorm.includes(sn));
  });
  if (fuzzy.length === 1) return { resolved: `${matchedLevel}${fuzzy[0]}` };
  if (fuzzy.length > 1) {
    return {
      resolved: null, issue: 'ambiguous_stream',
      message: `"${combined}" stream is ambiguous between ${fuzzy.join(', ')} for ${matchedLevel}.`,
    };
  }

  return {
    resolved: null, issue: 'stream_unresolved',
    message: `"${combined}" isn't a recognised stream for ${matchedLevel} (expected one of: ${allowedStreams.join(', ') || 'none configured'}).`,
  };
}
