import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Pause, Play, Search } from 'lucide-react';
import type { LogEntry } from '@/types';
import { cx, formatLogSource, formatProcessState, formatTimestamp, localizeAlertMessage } from '@/lib/format';

interface LogConsoleProps {
  lines: LogEntry[];
  meta?: Record<string, any> | null;
  error?: string | null;
}

function getLineTone(line: string) {
  const upper = line.toUpperCase();
  if (upper.includes('403') || upper.includes('429') || upper.includes('WAF')) return 'danger';
  if (upper.includes('ERROR') || upper.includes('FAILED')) return 'danger';
  if (upper.includes('HOLD') || upper.includes('RE-CATCH')) return 'warning';
  if (upper.includes('HOT RELOAD') || upper.includes('CHECKOUT') || upper.includes('PAY')) return 'success';
  if (upper.includes('DEPLOY') || upper.includes('CONFIG')) return 'info';
  return 'neutral';
}

function renderHighlightedLine(text: string, query: string) {
  if (!query) return text;
  const parts: Array<JSX.Element | string> = [];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  let startIndex = 0;

  while (startIndex < text.length) {
    const matchIndex = lower.indexOf(needle, startIndex);
    if (matchIndex === -1) {
      parts.push(text.slice(startIndex));
      break;
    }

    if (matchIndex > startIndex) {
      parts.push(text.slice(startIndex, matchIndex));
    }

    parts.push(
      <mark key={`${matchIndex}-${startIndex}`} className="log-highlight">
        {text.slice(matchIndex, matchIndex + needle.length)}
      </mark>
    );
    startIndex = matchIndex + needle.length;
  }

  return parts;
}

export function LogConsole({ lines, meta, error }: LogConsoleProps) {
  const [search, setSearch] = useState('');
  const [paused, setPaused] = useState(false);
  const [followTail, setFollowTail] = useState(true);
  const [frozenLines, setFrozenLines] = useState<LogEntry[] | null>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (paused && !frozenLines) {
      setFrozenLines(lines);
    }
    if (!paused && frozenLines) {
      setFrozenLines(null);
    }
  }, [paused, lines, frozenLines]);

  const displayLines = paused && frozenLines ? frozenLines : lines;
  const filteredLines = deferredSearch
    ? displayLines.filter((entry) => entry.line.toLowerCase().includes(deferredSearch.toLowerCase()))
    : displayLines;

  useEffect(() => {
    if (!followTail || paused) return;
    const element = scrollerRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [filteredLines.length, followTail, paused]);

  return (
    <section className="panel panel-log">
      <div className="panel-toolbar">
        <div className="panel-title-block">
          <h3>Поток логов</h3>
          <span className="panel-caption">
            {formatLogSource(meta?.source)} / {formatProcessState(meta?.processState)}
          </span>
        </div>

        <div className="toolbar-inline">
          <label className="search-field">
            <Search size={16} />
            <input
              className="search-input"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="HOLD / 403 / HOT RELOAD"
            />
          </label>
          <button
            type="button"
            className="icon-text-btn"
            onClick={() => setPaused((current) => !current)}
            aria-label={paused ? 'Продолжить поток логов' : 'Поставить поток логов на паузу'}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
            {paused ? 'Продолжить' : 'Пауза'}
          </button>
          <button
            type="button"
            className={followTail ? 'icon-text-btn active' : 'icon-text-btn'}
            onClick={() => setFollowTail((current) => !current)}
            aria-label={followTail ? 'Отключить автопрокрутку хвоста' : 'Включить автопрокрутку хвоста'}
          >
            <ArrowDownToLine size={16} />
            {followTail ? 'Хвост вкл.' : 'Хвост выкл.'}
          </button>
        </div>
      </div>

      <div className="meta-strip">
        <span className="chip tone-muted">строк: {filteredLines.length}</span>
        <span className="chip tone-muted">путь: {meta?.logPath || 'нет'}</span>
        <span className="chip tone-muted">обновлено: {formatTimestamp(meta?.mtimeMs || meta?.updatedAt)}</span>
        {error ? <span className="chip tone-danger">{localizeAlertMessage(error)}</span> : null}
      </div>

      <div className="log-scroller" ref={scrollerRef}>
        {filteredLines.length === 0 ? (
          <div className="empty-state compact">По текущему фильтру строк нет.</div>
        ) : (
          filteredLines.map((entry) => (
            <div key={entry.seq} className={cx('log-line', `tone-${getLineTone(entry.line)}`)}>
              <span className="log-seq">{String(entry.seq).padStart(4, '0')}</span>
              <span className="log-time">{entry.ts ? formatTimestamp(entry.ts) : 'сейчас'}</span>
              <span className="log-text">{renderHighlightedLine(entry.line, deferredSearch)}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
