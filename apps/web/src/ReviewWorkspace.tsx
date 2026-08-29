import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, MessageSquareText, Pencil, Trash2, X } from 'lucide-react';
import type { Agreement, DocumentComment, Suggestion } from '@bytecrunch/contracts-domain';

export interface TextSelection { text: string; start: number; end: number }
export const SIGNATURE_BLOCKS_PLACEHOLDER = '{{signature_blocks}}';
export function visibleDocumentContent(content: string): string { return content.replace(/\n*\{\{signature_blocks\}\}\s*$/, '').trimEnd(); }

export function draftContent(agreement: Agreement, authorId: string): string {
  const changes = agreement.suggestions.filter((item) => item.status === 'open' && item.reviewRound === agreement.reviewRound && item.authorSubjectId === authorId && item.anchor?.revision === agreement.revision).sort((a, b) => b.anchor!.start - a.anchor!.start);
  return changes.reduce((content, item) => content.slice(0, item.anchor!.start) + item.replacementText + content.slice(item.anchor!.end), agreement.content);
}

function liveChangeRanges(before: string, after: string): Array<{ start: number; end: number; deletion: boolean }> {
  const a = before.match(/\s+|[^\s]+/g) ?? []; const b = after.match(/\s+|[^\s]+/g) ?? [];
  if (a.length * b.length > 2_000_000) { const change = singleLiveRange(before, after); return change ? [change] : []; }
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? 1 + table[i + 1]![j + 1]! : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const raw: Array<{ start: number; end: number; deletion: boolean }> = []; let i = 0; let j = 0; let offset = 0; let active: (typeof raw)[number] | undefined;
  const flush = () => { if (active) raw.push(active); active = undefined; };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { const token = b[j]!; if (active && /^\s+$/.test(token)) { active.end += token.length; offset += token.length; } else { flush(); offset += token.length; } i++; j++; }
    else if (j < b.length && (i === a.length || table[i]![j + 1]! >= table[i + 1]![j]!)) { const token = b[j]!; active ??= { start: offset, end: offset, deletion: false }; active.end += token.length; offset += token.length; j++; }
    else { active ??= { start: offset, end: offset, deletion: false }; active.deletion = true; i++; }
  }
  flush(); const clustered: typeof raw = [];
  for (const range of raw) { const previous = clustered.at(-1); const gap = previous ? after.slice(previous.end, range.start) : ''; if (previous && gap.length <= 24 && !gap.includes('\n\n')) { previous.end = range.end; previous.deletion ||= range.deletion; } else clustered.push(range); }
  return clustered;
}

function singleLiveRange(before: string, after: string) {
  let start = 0; while (start < before.length && start < after.length && before[start] === after[start]) start++;
  if (start === before.length && start === after.length) return undefined;
  let oldEnd = before.length; let end = after.length; while (oldEnd > start && end > start && before[oldEnd - 1] === after[end - 1]) { oldEnd--; end--; }
  return { start, end, deletion: oldEnd > start };
}

function DraftHighlightText({ original, draft }: { original: string; draft: string }) {
  const ranges = liveChangeRanges(original, draft); const parts: ReactNode[] = []; let cursor = 0;
  for (const [index, range] of ranges.entries()) { parts.push(draft.slice(cursor, range.start)); parts.push(<mark key={index} className={`live-change ${range.deletion ? 'has-deletion' : ''}`}>{draft.slice(range.start, range.end) || '\u200b'}</mark>); cursor = range.end; }
  parts.push(draft.slice(cursor)); return <div className="document-editor-highlights" aria-hidden="true">{parts}</div>;
}

export type DraftSaveState = 'saved' | 'pending' | 'saving' | 'error';

export function DirectContractEditor({ agreement, authorId, busy, onSave, onStateChange }: { agreement: Agreement; authorId: string; busy: boolean; onSave: (content: string) => Promise<boolean>; onStateChange?: (state: DraftSaveState) => void }) {
  const hasSignatureBlocks = agreement.content.includes(SIGNATURE_BLOCKS_PLACEHOLDER); const projected = visibleDocumentContent(draftContent(agreement, authorId)); const original = visibleDocumentContent(agreement.content); const [content, setContent] = useState(projected); const [saveState, setSaveState] = useState<DraftSaveState>('saved'); const [retry, setRetry] = useState(0);
  const contentRef = useRef(projected); const projectedRef = useRef(projected); const submittedRef = useRef(projected); const onSaveRef = useRef(onSave); const retryTimer = useRef<number | undefined>(undefined);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { onStateChange?.(saveState); }, [onStateChange, saveState]);
  useEffect(() => {
    if (projected === projectedRef.current) return;
    projectedRef.current = projected;
    if (contentRef.current === submittedRef.current || contentRef.current === projected) {
      contentRef.current = projected; submittedRef.current = projected; setContent(projected); setSaveState('saved');
    }
  }, [projected, agreement.revision]);
  useEffect(() => {
    window.clearTimeout(retryTimer.current);
    if (busy) return;
    if (content === projected) { setSaveState('saved'); return; }
    if (!content.trim()) { setSaveState('error'); return; }
    setSaveState('pending');
    const timer = window.setTimeout(() => {
      const submitted = content; submittedRef.current = submitted; setSaveState('saving');
      const persisted = hasSignatureBlocks ? `${submitted.trimEnd()}\n\n${SIGNATURE_BLOCKS_PLACEHOLDER}` : submitted;
      void onSaveRef.current(persisted).then((ok) => {
        if (ok) setSaveState(contentRef.current === submitted ? 'saved' : 'pending');
        else { setSaveState('error'); retryTimer.current = window.setTimeout(() => setRetry((value) => value + 1), 2000); }
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [busy, content, projected, retry]);
  useEffect(() => () => window.clearTimeout(retryTimer.current), []);
  const status = saveState === 'saving' ? <><BusyMark /> Saving tracked changes…</> : saveState === 'pending' ? <><i className="draft-status-dot" /> Tracking your edits…</> : saveState === 'error' ? <><i className="draft-status-dot error" /> Couldn’t save · retrying…</> : <><Check /> Saved automatically</>;
  return <div className="direct-editor-wrap"><div className="direct-editor-toolbar"><div><span className="bc-eyebrow bc-text-blue">// TRACK CHANGES</span><small>Type directly in the agreement. Every highlighted edit becomes a private redline.</small></div><span className={`draft-save-status ${saveState}`} role="status" aria-live="polite">{status}</span></div><div className="document-editor-surface"><DraftHighlightText original={original} draft={content} /><textarea aria-label="Edit agreement text with tracked changes" className="document-editor" value={content} onChange={(event) => { contentRef.current = event.target.value; setContent(event.target.value); setSaveState('pending'); }} spellCheck /></div></div>;
}

function offsetWithin(root: HTMLElement, target: Node, offset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let total = 0; let node = walker.nextNode();
  while (node) { if (node === target) return total + offset; total += node.textContent?.length ?? 0; node = walker.nextNode(); }
  return total;
}

export function SelectableContract({ agreement, onSelect, onOpenRedline }: { agreement: Agreement; onSelect: ((selection: TextSelection) => void) | undefined; onOpenRedline: ((id: string) => void) | undefined }) {
  const root = useRef<HTMLDivElement>(null);
  function selected() {
    const selection = window.getSelection(); const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!selection || !range || selection.isCollapsed || !root.current || !root.current.contains(range.commonAncestorContainer)) return;
    const text = selection.toString(); if (!text.trim()) return;
    const start = offsetWithin(root.current, range.startContainer, range.startOffset); const end = offsetWithin(root.current, range.endContainer, range.endOffset);
    onSelect?.({ text, start: Math.min(start, end), end: Math.max(start, end) });
  }
  const visibleContent = visibleDocumentContent(agreement.content); const highlights = agreement.suggestions.filter((item) => item.status === 'open' && item.anchor?.revision === agreement.revision && item.anchor.start <= visibleContent.length).sort((a, b) => a.anchor!.start - b.anchor!.start);
  const parts: ReactNode[] = []; let cursor = 0;
  for (const suggestion of highlights) {
    const anchor = suggestion.anchor!; if (anchor.start < cursor || agreement.content.slice(anchor.start, anchor.end) !== suggestion.originalText) continue;
    parts.push(agreement.content.slice(cursor, anchor.start));
    parts.push(<mark className="redline-anchor" key={suggestion.id} onClick={() => onOpenRedline?.(suggestion.id)}>{suggestion.originalText && <del>{agreement.content.slice(anchor.start, anchor.end)}</del>}<ins>{suggestion.replacementText || '∅'}</ins><i /></mark>);
    cursor = anchor.end;
  }
  parts.push(visibleContent.slice(cursor));
  return <div ref={root} className="document-body selectable-contract" onMouseUp={selected}>{parts}</div>;
}

function diffWords(before: string, after: string): Array<{ value: string; kind: 'same' | 'removed' | 'added' }> {
  const a = before.split(/(\s+)/); const b = after.split(/(\s+)/); const table = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? 1 + table[i + 1]![j + 1]! : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const result: Array<{ value: string; kind: 'same' | 'removed' | 'added' }> = []; let i = 0; let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { result.push({ value: a[i]!, kind: 'same' }); i++; j++; }
    else if (j < b.length && (i === a.length || table[i]![j + 1]! >= table[i + 1]![j]!)) { result.push({ value: b[j]!, kind: 'added' }); j++; }
    else { result.push({ value: a[i]!, kind: 'removed' }); i++; }
  }
  return result;
}

export function InlineDiff({ before, after }: { before: string; after: string }) {
  return <div className="inline-diff">{diffWords(before, after).map((part, index) => part.kind === 'same' ? <span key={index}>{part.value}</span> : part.kind === 'removed' ? <del key={index}>{part.value}</del> : <ins key={index}>{part.value}</ins>)}</div>;
}

export function RedlineCard({ suggestion, active, busy, canReply, canEdit, canResolve, onEdit, onRemove, onResolve, onReply, onSelect }: { suggestion: Suggestion; active?: boolean; busy: boolean; canReply: boolean; canEdit: boolean; canResolve: boolean; onEdit?: (replacementText: string, comment: string) => void; onRemove?: () => void; onResolve?: (resolution: 'accepted' | 'rejected') => void; onReply: (body: string) => void; onSelect?: () => void }) {
  const [editing, setEditing] = useState(false); const [replacementText, setReplacementText] = useState(suggestion.replacementText); const [comment, setComment] = useState(suggestion.comment);
  return <article className={`redline-card ${suggestion.status} ${active ? 'active' : ''}`} onClick={onSelect}><header><span className="bc-eyebrow">// REDLINE</span><b>{canEdit ? 'draft' : suggestion.status}</b></header>{editing ? <form className="redline-edit" onSubmit={(event) => { event.preventDefault(); onEdit?.(replacementText, comment); setEditing(false); }}><label>Replace with<textarea required autoFocus value={replacementText} onChange={(event) => setReplacementText(event.target.value)} /></label><label>Reason or context<textarea value={comment} onChange={(event) => setComment(event.target.value)} /></label><div><button type="button" className="text-button" onClick={() => { setReplacementText(suggestion.replacementText); setComment(suggestion.comment); setEditing(false); }}>Cancel</button><button disabled={busy} className="button button-secondary button-small">Save changes</button></div></form> : <><InlineDiff before={suggestion.originalText} after={suggestion.replacementText} />{suggestion.comment && <p>{suggestion.comment}</p>}</>}<div className="thread">{suggestion.messages.map((message) => <div key={message.id}><strong>{message.authorName}</strong><p>{message.body}</p></div>)}</div>{suggestion.status === 'open' && canReply && !editing && <ReplyBox busy={busy} onReply={onReply} />}{suggestion.status === 'open' && !editing && (canEdit || canResolve) && <footer>{canEdit && <><button disabled={busy} onClick={(event) => { event.stopPropagation(); setEditing(true); }}><Pencil /> Edit</button><button disabled={busy} onClick={(event) => { event.stopPropagation(); onRemove?.(); }}><Trash2 /> Remove</button></>}{canResolve && <><button disabled={busy} onClick={(event) => { event.stopPropagation(); onResolve?.('rejected'); }}><X /> Keep original</button><button disabled={busy} onClick={(event) => { event.stopPropagation(); onResolve?.('accepted'); }}><Check /> Accept change</button></>}</footer>}</article>;
}

function ReplyBox({ busy, onReply }: { busy: boolean; onReply: (body: string) => void }) {
  return <form className="thread-reply-wrap" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const field = new FormData(form).get('body'); if (typeof field === 'string' && field.trim()) { onReply(field.trim()); form.reset(); } }}><div className="thread-reply"><MessageSquareText /><input name="body" aria-label="Reply" placeholder="Reply to this redline…" /><button disabled={busy}>Reply</button></div></form>;
}

export function DocumentCommentCard({ item, busy, canEdit, canResolve, onEdit, onRemove, onResolve }: { item: DocumentComment; busy: boolean; canEdit: boolean; canResolve: boolean; onEdit?: (body: string) => void; onRemove?: () => void; onResolve?: () => void }) {
  const [editing, setEditing] = useState(false); const [body, setBody] = useState(item.body);
  return <div className="document-comment"><strong>{item.authorName}</strong>{editing ? <form className="comment-edit" onSubmit={(event) => { event.preventDefault(); if (body.trim()) { onEdit?.(body.trim()); setEditing(false); } }}><textarea required autoFocus value={body} onChange={(event) => setBody(event.target.value)} /><div><button type="button" className="text-button" onClick={() => { setBody(item.body); setEditing(false); }}>Cancel</button><button disabled={busy} className="button button-secondary button-small">Save</button></div></form> : <p>{item.body}</p>} {!editing && (canEdit || canResolve) && <div className="comment-actions">{canEdit && <><button disabled={busy} className="text-button" onClick={() => setEditing(true)}>Edit</button><button disabled={busy} className="text-button danger" onClick={onRemove}>Remove</button></>}{canResolve && <button disabled={busy} className="text-button" onClick={onResolve}>Resolve feedback</button>}</div>}</div>;
}

export function BusyMark() { return <span className="busy-mark" aria-hidden="true">{Array.from({ length: 16 }, (_, index) => <i key={index} />)}</span>; }
