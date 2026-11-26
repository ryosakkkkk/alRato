import katex from 'katex';
import 'katex/dist/katex.min.css';
import { memo, type ReactNode } from 'react';

// Closing "$" may not be followed by a digit, so "$10 and $20" stays plain text.
const INLINE = /(\$\$[^$]+\$\$|\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d)|\*\*[^*\n]+\*\*)/g;

function Math({ source, display }: { source: string; display: boolean }) {
  // KaTeX escapes its input and, with trust off, refuses links and scripts.
  const html = katex.renderToString(source, { throwOnError: false, displayMode: display, trust: false, strict: 'ignore' });
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/** With `words`, plain text is split into one span per word, so the board can write it word by word. */
function plain(text: string, key: number, words: boolean): ReactNode {
  if (!words) return text;
  return text.split(/(\s+)/).map((part, n) =>
    /^\s*$/.test(part) ? part : (
      <span key={`${key}-${n}`} className="w">
        {part}
      </span>
    ),
  );
}

function inline(text: string, words: boolean): ReactNode[] {
  return text.split(INLINE).map((piece, i) => {
    if (piece.startsWith('$$') && piece.endsWith('$$') && piece.length > 4) {
      return <Math key={i} source={piece.slice(2, -2)} display />;
    }
    if (piece.startsWith('$') && piece.endsWith('$') && piece.length > 2) {
      return <Math key={i} source={piece.slice(1, -1)} display={false} />;
    }
    if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) {
      return (
        <strong key={i} className={words ? 'w' : undefined}>
          {piece.slice(2, -2)}
        </strong>
      );
    }
    return plain(piece, i, words);
  });
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

/** Renders model or student text safely: paragraphs, lists, bold and LaTeX. */
export const MathText = memo(function MathText({ text, words = false }: { text: string; words?: boolean }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const start = i;
    const pattern = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
    if (pattern) {
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(lines[i].replace(pattern, ''));
        i += 1;
      }
      const children = items.map((item, n) => <li key={n}>{inline(item, words)}</li>);
      // Keyed by where the block starts, so it never shares a key with the block that follows it.
      blocks.push(pattern === BULLET ? <ul key={start}>{children}</ul> : <ol key={start}>{children}</ol>);
    } else {
      blocks.push(<p key={i}>{inline(line, words)}</p>);
      i += 1;
    }
  }
  return <div className="math-text">{blocks}</div>;
});
