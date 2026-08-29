import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowRight, Bell, Check, ChevronRight, CircleUserRound, FileCheck2, FileClock, FilePenLine,
  FilePlus2, Files, LayoutDashboard, Moon, Plus, Settings, ShieldCheck, Sun, Webhook, X,
} from 'lucide-react';
import type { Agreement, CreateAgreement, Notification, Template } from '@bytecrunch/contracts-domain';
import logo from './assets/logomark.svg';
import { api, statusLabel, type User } from './api';
import ExternalPortal from './ExternalPortal';
import { BusyMark, DirectContractEditor, DocumentCommentCard, RedlineCard, SIGNATURE_BLOCKS_PLACEHOLDER, SelectableContract, type DraftSaveState, type TextSelection } from './ReviewWorkspace';
import { NextActionBanner, SignatureBlocks, SignatureCeremony } from './SigningExperience';

type View = 'dashboard' | 'agreements' | 'settings';

function App() {
  if (window.location.pathname === '/invite') return <ExternalPortal />;
  return <AdminApp />;
}

function AdminApp() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const stored = localStorage.getItem('bc-contracts-theme-choice');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const [view, setView] = useState<View>('dashboard');
  const [user, setUser] = useState<User>();
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]); const [showNotifications, setShowNotifications] = useState(false);
  const [selected, setSelected] = useState<Agreement>();
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    document.documentElement.className = theme;
  }, [theme]);
  useEffect(() => {
    if (localStorage.getItem('bc-contracts-theme-choice')) return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => setTheme(media.matches ? 'light' : 'dark');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  async function refresh() {
    try {
      setLoading(true); setError(undefined);
      const [nextUser, nextAgreements, nextTemplates, nextNotifications] = await Promise.all([api.me(), api.agreements(), api.templates(), api.notifications()]);
      setUser(nextUser); setAgreements(nextAgreements); setTemplates(nextTemplates); setNotifications(nextNotifications);
      if (selected) setSelected(nextAgreements.find((item) => item.id === selected.id));
      else { const linkedAgreement = new URLSearchParams(window.location.search).get('agreement'); if (linkedAgreement) { const match = nextAgreements.find((item) => item.id === linkedAgreement); if (match) { setSelected(match); setView('agreements'); } } }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load contracts.');
    } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (!user) return; const timer = window.setInterval(() => void api.notifications().then(setNotifications).catch(() => undefined), 15_000); return () => window.clearInterval(timer); }, [user]);

  function openAgreement(agreement: Agreement) {
    setSelected(agreement); setView('agreements');
  }

  const counts = useMemo(() => ({
    active: agreements.filter((item) => !['executed', 'declined', 'voided', 'expired'].includes(item.status)).length,
    review: agreements.filter((item) => item.status === 'in_review').length,
    signing: agreements.filter((item) => ['out_for_signature', 'partially_signed'].includes(item.status)).length,
    executed: agreements.filter((item) => item.status === 'executed').length,
  }), [agreements]);

  if (!user && !loading) return <SignIn {...(error ? { error } : {})} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => { setView('dashboard'); setSelected(undefined); }}>
          <img src={logo} alt="" /><span>BYTECRUNCH</span><b>CONTRACTS</b>
        </button>
        <nav className="side-nav" aria-label="Primary navigation">
          <NavButton icon={<LayoutDashboard />} active={view === 'dashboard'} onClick={() => { setView('dashboard'); setSelected(undefined); }}>Overview</NavButton>
          <NavButton icon={<Files />} active={view === 'agreements'} onClick={() => setView('agreements')}>Agreements</NavButton>
          <NavButton icon={<Settings />} active={view === 'settings'} onClick={() => { setView('settings'); setSelected(undefined); }}>Integrations</NavButton>
        </nav>
        <div className="sidebar-foot">
          <div className="environment"><span className="status-dot" /> Local environment</div>
          <div className="user-block"><CircleUserRound /><div><strong>{user?.name}</strong><span>{user?.email}</span></div></div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div><span className="bc-eyebrow">// CONTRACT WORKSPACE</span></div>
          <div className="top-actions">
            <button className="icon-button notification-trigger" aria-label="Notifications" onClick={() => setShowNotifications((value) => !value)}><Bell />{notifications.some((item) => !item.readAt) && <i>{notifications.filter((item) => !item.readAt).length}</i>}</button>
            <button className="icon-button" aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => { const next = theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('bc-contracts-theme-choice', next); setTheme(next); }}>{theme === 'dark' ? <Sun /> : <Moon />}</button>
            <button className="button button-accent" onClick={() => setCreating(true)}><Plus /> New agreement</button>
          </div>
        </header>
        {showNotifications && <NotificationCenter notifications={notifications} onClose={() => setShowNotifications(false)} onReadAll={() => void api.readAllNotifications().then(() => setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() }))))} onOpen={(notification) => void api.readNotification(notification.id).then(() => { setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item)); const agreement = agreements.find((item) => item.id === notification.agreementId); if (agreement) openAgreement(agreement); setShowNotifications(false); })} />}

        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(undefined)}><X /></button></div>}
        {loading && <div className="loading-line" />}
        {view === 'dashboard' && <Dashboard agreements={agreements} counts={counts} onOpen={openAgreement} onCreate={() => setCreating(true)} />}
        {view === 'agreements' && (selected
          ? <AgreementDetail agreement={selected} user={user!} onBack={() => setSelected(undefined)} onUpdate={(agreement) => { setSelected(agreement); setAgreements((items) => items.map((item) => item.id === agreement.id ? agreement : item)); }} onError={setError} />
          : <AgreementList agreements={agreements} onOpen={openAgreement} />)}
        {view === 'settings' && <IntegrationSettings />}
      </main>
      {creating && <CreateAgreementModal templates={templates} onClose={() => setCreating(false)} onCreated={(agreement) => { setAgreements((items) => [agreement, ...items]); setCreating(false); openAgreement(agreement); }} onError={setError} />}
    </div>
  );
}

function NotificationCenter({ notifications, onClose, onReadAll, onOpen }: { notifications: Notification[]; onClose: () => void; onReadAll: () => void; onOpen: (notification: Notification) => void }) {
  return <aside className="notification-center"><header><div><span className="bc-eyebrow bc-text-orange">// ACTIVITY</span><h2>Notifications</h2></div><button className="icon-button" onClick={onClose}><X /></button></header><div className="notification-toolbar"><span>{notifications.filter((item) => !item.readAt).length} unread</span>{notifications.some((item) => !item.readAt) && <button className="text-button" onClick={onReadAll}>Mark all read</button>}</div><div className="notification-list">{notifications.length === 0 ? <p className="notification-empty">No notifications yet.</p> : notifications.map((notification) => <button className={notification.readAt ? '' : 'unread'} key={notification.id} onClick={() => onOpen(notification)}><i /><div><strong>{notification.title}</strong><p>{notification.body}</p><span>{notification.actorName} · {new Date(notification.createdAt).toLocaleString()}</span></div></button>)}</div></aside>;
}

function NavButton({ icon, active, onClick, children }: { icon: React.ReactNode; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{children}</span></button>;
}

function SignIn({ error }: { error?: string }) {
  return <main className="signin"><div className="bc-bytewave" /><section><img src={logo} alt="Bytecrunch" /><span className="bc-eyebrow">// AGREEMENT INFRASTRUCTURE</span><h1>Contracts move faster when the workflow is clear.</h1><p>Review, redline, execute, and verify agreements from one auditable workspace.</p>{error && <div className="error-banner">{error}</div>}<a className="button button-accent" href={api.loginUrl}>Continue with SSO <ArrowRight /></a></section></main>;
}

function Dashboard({ agreements, counts, onOpen, onCreate }: { agreements: Agreement[]; counts: Record<string, number>; onOpen: (agreement: Agreement) => void; onCreate: () => void }) {
  const attention = agreements.filter((agreement) => ownerNextAction(agreement).actionable);
  return <div className="page"><div className="page-heading"><div><span className="bc-eyebrow bc-text-orange">// OVERVIEW</span><h1>Agreements in motion.</h1><p>Everything that needs review, resolution, or signature.</p></div><button className="button button-secondary" onClick={onCreate}>Create agreement <ArrowRight /></button></div>
    <section className="metric-grid"><Metric label="Active" value={counts.active ?? 0} icon={<FileClock />} /><Metric label="In review" value={counts.review ?? 0} icon={<FilePenLine />} /><Metric label="Signing" value={counts.signing ?? 0} icon={<ShieldCheck />} /><Metric label="Executed" value={counts.executed ?? 0} icon={<FileCheck2 />} /></section>
    {attention.length > 0 && <section className="section-block"><div className="section-title"><div><span className="bc-eyebrow bc-text-orange">// NEEDS YOUR ATTENTION</span><h2>Your next actions</h2></div><b className="attention-count">{String(attention.length).padStart(2, '0')}</b></div><div className="attention-grid">{attention.map((agreement) => { const next = ownerNextAction(agreement); return <button key={agreement.id} onClick={() => onOpen(agreement)}><span>{next.label}</span><strong>{agreement.title}</strong><p>{next.body}</p><ArrowRight /></button>; })}</div></section>}
    <section className="section-block"><div className="section-title"><div><span className="bc-eyebrow">// RECENT</span><h2>Latest agreements</h2></div></div>{agreements.length ? <AgreementTable agreements={agreements.slice(0, 6)} onOpen={onOpen} /> : <EmptyState onCreate={onCreate} />}</section>
  </div>;
}

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) { return <article className="metric"><div className="metric-icon">{icon}</div><strong>{String(value).padStart(2, '0')}</strong><span>{label}</span></article>; }

function AgreementList({ agreements, onOpen }: { agreements: Agreement[]; onOpen: (agreement: Agreement) => void }) {
  return <div className="page"><div className="page-heading"><div><span className="bc-eyebrow bc-text-blue">// REPOSITORY</span><h1>Agreements</h1><p>The current record of every negotiation and execution.</p></div></div><AgreementTable agreements={agreements} onOpen={onOpen} /></div>;
}

function AgreementTable({ agreements, onOpen }: { agreements: Agreement[]; onOpen: (agreement: Agreement) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Agreement</th><th>Status</th><th>Participants</th><th>Revision</th><th>Updated</th><th /></tr></thead><tbody>{agreements.map((agreement) => <tr key={agreement.id} onClick={() => onOpen(agreement)}><td><strong>{agreement.title}</strong><span>{agreement.templateKey} · v{agreement.templateVersion}</span></td><td><StatusBadge status={agreement.status} /></td><td>{agreement.participants.length}</td><td className="mono">R{String(agreement.revision).padStart(2, '0')}</td><td>{new Date(agreement.updatedAt).toLocaleDateString()}</td><td><ChevronRight /></td></tr>)}</tbody></table></div>;
}

function StatusBadge({ status }: { status: Agreement['status'] }) {
  const tone = status === 'executed' ? 'success' : status.includes('signature') || status === 'partially_signed' ? 'blue' : status === 'in_review' ? 'orange' : 'neutral';
  return <span className={`status-badge ${tone}`}><i />{statusLabel(status)}</span>;
}

function counterpartySignaturesComplete(agreement: Agreement) { return agreement.parties.every((party) => agreement.participants.filter((participant) => participant.partyId === party.id && participant.role === 'signatory' && participant.status === 'signed').length >= party.minimumSignatures); }
function ownerNextAction(agreement: Agreement): { actionable: boolean; label: string; body: string } {
  const owner = agreement.participants.find((participant) => participant.id === agreement.createdByParticipantId);
  if (['out_for_signature', 'partially_signed'].includes(agreement.status) && owner?.status !== 'signed') return { actionable: true, label: 'Sign agreement', body: 'Your signature is required. Sign now while the other signatures are collected.' };
  if (agreement.status === 'in_review' && agreement.reviewAssignedTo === 'sender') { const open = agreement.suggestions.filter((item) => item.status === 'open').length + agreement.documentComments.filter((item) => item.status === 'open').length; return open ? { actionable: true, label: 'Review returned changes', body: `${open} item${open === 1 ? '' : 's'} need your decision.` } : { actionable: true, label: 'Advance the agreement', body: 'Review is back with you and ready for its next step.' }; }
  if (agreement.status === 'draft') return { actionable: true, label: 'Invite the counterparty', body: 'Send the agreement to begin review.' };
  return { actionable: false, label: 'Waiting', body: 'No action is currently required from you.' };
}

function EmptyState({ onCreate }: { onCreate: () => void }) { return <div className="empty"><FilePlus2 /><h3>No agreements yet</h3><p>Create one from a versioned template to start the workflow.</p><button className="button button-accent" onClick={onCreate}>Create agreement <ArrowRight /></button></div>; }

function AgreementDetail({ agreement, user, onBack, onUpdate, onError }: { agreement: Agreement; user: User; onBack: () => void; onUpdate: (agreement: Agreement) => void; onError: (message: string) => void }) {
  const [selection, setSelection] = useState<TextSelection>(); const [replacementText, setReplacementText] = useState(''); const [comment, setComment] = useState(''); const [documentComment, setDocumentComment] = useState(''); const [activeRedline, setActiveRedline] = useState<string>(); const [busy, setBusy] = useState<string>(); const [signing, setSigning] = useState(false);
  const [finishingReview, setFinishingReview] = useState(false); const [draftState, setDraftState] = useState<DraftSaveState>('saved');
  async function mutate(action: () => Promise<Agreement>, label: string) { try { setBusy(label); onUpdate(await action()); return true; } catch (cause) { onError(cause instanceof Error ? cause.message : 'Action failed.'); return false; } finally { setBusy(undefined); } }
  async function suggest(event: FormEvent) { event.preventDefault(); if (!selection) return; await mutate(() => api.addSuggestion(agreement.id, { authorSubjectId: user.id, originalText: selection.text, replacementText, comment, anchor: { start: selection.start, end: selection.end } }), 'redline'); setSelection(undefined); setReplacementText(''); setComment(''); window.getSelection()?.removeAllRanges(); }
  const openSuggestions = agreement.suggestions.filter((item) => item.status === 'open');
  const canEdit = agreement.status === 'in_review' && agreement.reviewAssignedTo === 'sender';
  const owner = agreement.participants.find((participant) => participant.id === agreement.createdByParticipantId); const ownerCanSign = Boolean(owner && owner.status !== 'signed' && ['out_for_signature', 'partially_signed'].includes(agreement.status)); const pendingInvitee = agreement.participants.find((participant) => participant.id !== agreement.createdByParticipantId && participant.status === 'not_invited'); const openReviewItems = openSuggestions.length + agreement.documentComments.filter((item) => item.status === 'open').length;
  const nextBanner = ownerCanSign && owner ? <NextActionBanner title="Your signature is required" body="The signing version is ready. You and the other required signatories may sign in any order." action={{ label: 'Sign agreement', onClick: () => setSigning(true), busy: busy === 'sign' }} /> : agreement.status === 'draft' ? <NextActionBanner title="Send this agreement for review" body="Invite the first counterparty representative. They’ll confirm their entity and review the document in a secure workspace." action={{ label: pendingInvitee ? `Invite ${pendingInvitee.name}` : 'Start review', onClick: () => void mutate(pendingInvitee ? async () => { await api.invite(agreement.id, pendingInvitee.id); return api.agreement(agreement.id); } : () => api.startReview(agreement.id), 'next-action'), busy: busy === 'next-action' }} /> : agreement.status === 'in_review' && agreement.reviewAssignedTo === 'sender' ? <NextActionBanner title={openReviewItems ? `Review ${openReviewItems} tracked item${openReviewItems === 1 ? '' : 's'}` : 'The document is ready to finish'} body={openReviewItems ? 'Resolve returned feedback or edit the document directly. Send changes when your draft is ready.' : 'You can sign now and request the remaining signatures, or request signatures and sign later.'} action={openReviewItems ? { label: draftState === 'saved' ? 'Send changes' : 'Saving edits…', onClick: () => void mutate(() => api.sendReview(agreement.id), 'review'), busy: busy === 'review' || draftState !== 'saved' } : { label: draftState === 'saved' ? 'Finish review' : 'Saving edits…', onClick: () => setFinishingReview(true), busy: draftState !== 'saved' }} /> : ['out_for_signature', 'partially_signed'].includes(agreement.status) ? <NextActionBanner waiting title="Waiting for signatures" body={`${agreement.participants.filter((item) => item.role === 'signatory' && item.status === 'signed').length} of ${agreement.participants.filter((item) => item.role === 'signatory' && item.required).length} required signatories have signed. Everyone may sign in any order.`} /> : agreement.status === 'in_review' ? <NextActionBanner waiting title="Review is with the counterparty" body="Their draft work remains private until they send their review." /> : agreement.status === 'executed' ? <NextActionBanner eyebrow="// COMPLETE" waiting title="Agreement executed" body={`Every required signature was collected on ${agreement.executedAt ? new Date(agreement.executedAt).toLocaleString() : 'the final revision'}.`} /> : null;
  return <div className="detail-page"><div className="detail-bar"><button className="text-button" onClick={onBack}>← Agreements</button><div className="detail-actions"><StatusBadge status={agreement.status} />{agreement.status === 'draft' && <button disabled={Boolean(busy)} className="button button-secondary button-small" onClick={() => void mutate(() => api.startReview(agreement.id), 'review')}>{busy === 'review' ? <><BusyMark /> Sending…</> : 'Start review'}</button>}{agreement.status === 'in_review' && agreement.reviewAssignedTo === 'sender' && <button disabled={Boolean(busy)} className={`button ${openReviewItems ? 'button-secondary' : 'button-accent'} button-small`} onClick={() => openReviewItems ? void mutate(() => api.sendReview(agreement.id), 'review') : setFinishingReview(true)}>{busy === 'review' ? <><BusyMark /> Sending…</> : openReviewItems ? 'Send changes' : 'Finish review'}</button>}{['out_for_signature', 'partially_signed'].includes(agreement.status) && !agreement.signatureNotificationsSentAt && <button disabled={Boolean(busy)} className="button button-secondary button-small" onClick={() => void mutate(() => api.sendForSignature(agreement.id), 'signature')}>{busy === 'signature' ? <><BusyMark /> Sending…</> : 'Request signatures'}</button>}{ownerCanSign && <button disabled={Boolean(busy)} className="button button-accent button-small" onClick={() => setSigning(true)}>Sign agreement</button>}</div></div>{nextBanner}
    <div className="contract-layout"><article className="document"><header><span className="bc-eyebrow">// REVISION {String(agreement.revision).padStart(2, '0')}</span><h1>{agreement.title}</h1><div className="document-meta"><span>{agreement.templateKey} · v{agreement.templateVersion}</span><span>SHA-256 · {agreement.contentSha256.slice(0, 12)}…</span></div></header><div className="document-paper">{canEdit ? <DirectContractEditor agreement={agreement} authorId={user.id} busy={busy === 'draft'} onStateChange={setDraftState} onSave={(content) => mutate(() => api.saveReviewDraft(agreement.id, content), 'draft')} /> : <SelectableContract agreement={agreement} onSelect={undefined} onOpenRedline={setActiveRedline} />}{(agreement.content.includes(SIGNATURE_BLOCKS_PLACEHOLDER) || agreement.templateKey === 'mutual-nda') && <SignatureBlocks agreement={agreement} />}</div></article>
      <aside className="review-panel"><div className="review-heading"><span className="bc-eyebrow bc-text-orange">// REVIEW</span><strong>{openSuggestions.length} open redline{openSuggestions.length === 1 ? '' : 's'}</strong></div>{agreement.status === 'in_review' && <div className="review-turn"><div><span>With {agreement.reviewAssignedTo}</span><p>{canEdit ? 'Edit directly in the document. Your saved redlines stay private until you send changes.' : 'Waiting for the counterparty to send their review.'}</p></div></div>}
        <div className="redline-list">{agreement.suggestions.map((suggestion) => { const isDraftOwner = canEdit && suggestion.status === 'open' && suggestion.reviewRound === agreement.reviewRound && suggestion.authorSubjectId === user.id; return <RedlineCard key={suggestion.id} suggestion={suggestion} active={activeRedline === suggestion.id} busy={Boolean(busy)} canReply={canEdit} canEdit={isDraftOwner} canResolve={canEdit && !isDraftOwner} onSelect={() => setActiveRedline(suggestion.id)} onReply={(body) => void mutate(() => api.replySuggestion(agreement.id, suggestion.id, body), `reply-${suggestion.id}`)} onEdit={(nextReplacement, nextComment) => void mutate(() => api.updateSuggestion(agreement.id, suggestion.id, { replacementText: nextReplacement, comment: nextComment }), `edit-${suggestion.id}`)} onRemove={() => void mutate(() => api.removeSuggestion(agreement.id, suggestion.id), `remove-${suggestion.id}`)} onResolve={(resolution) => void mutate(() => api.resolveSuggestion(agreement.id, suggestion.id, resolution), `resolve-${suggestion.id}`)} />; })}</div>
        <div className="document-comments"><span className="bc-eyebrow">// GENERAL FEEDBACK</span>{agreement.documentComments.map((item) => { const isDraftOwner = canEdit && item.status === 'open' && item.reviewRound === agreement.reviewRound && item.authorId === user.id; return <DocumentCommentCard key={item.id} item={item} busy={Boolean(busy)} canEdit={isDraftOwner} canResolve={canEdit && item.status === 'open' && !isDraftOwner} onEdit={(body) => void mutate(() => api.updateDocumentComment(agreement.id, item.id, body), `edit-comment-${item.id}`)} onRemove={() => void mutate(() => api.removeDocumentComment(agreement.id, item.id), `remove-comment-${item.id}`)} onResolve={() => void mutate(() => api.resolveDocumentComment(agreement.id, item.id), `comment-${item.id}`)} />; })}{canEdit && <form className="thread-reply-wrap" onSubmit={(event) => { event.preventDefault(); if (!documentComment.trim()) return; void mutate(() => api.addDocumentComment(agreement.id, documentComment.trim()), 'document-comment').then((saved) => { if (saved) setDocumentComment(''); }); }}><div className="thread-reply"><FilePenLine /><input value={documentComment} onChange={(event) => setDocumentComment(event.target.value)} placeholder="Comment on the document overall…" /><button disabled={Boolean(busy)}>{busy === 'document-comment' ? <BusyMark /> : 'Add'}</button></div></form>}</div>
        <div className="signatories"><span className="bc-eyebrow">// PARTIES & PARTICIPANTS</span>{agreement.parties.map((party) => <div className="party-row" key={party.id}><strong>{party.entity.legalName ?? 'Counterparty details pending'}</strong>{party.entity.businessAddress && <address>{party.entity.businessAddress}</address>}<span>{party.role} · {party.minimumSignatures} signature{party.minimumSignatures === 1 ? '' : 's'} required · {party.entity.verificationStatus.replace('_', ' ')}</span>{party.entity.proposedDetails && <span>Proposed: {party.entity.proposedDetails.legalName}{party.entity.proposedDetails.businessAddress ? ` · ${party.entity.proposedDetails.businessAddress}` : ''}{party.entity.proposedDetails.registrationNumber ? ` · ${party.entity.proposedDetails.registrationNumber}` : ''}{party.entity.proposedDetails.jurisdiction ? ` · ${party.entity.proposedDetails.jurisdiction}` : ''}</span>}{party.entity.verificationStatus === 'change_pending' && <button disabled={Boolean(busy)} onClick={() => void mutate(() => api.acceptEntity(agreement.id, party.id), `entity-${party.id}`)}>{busy === `entity-${party.id}` ? <><BusyMark /> Accepting…</> : 'Accept proposed details'}</button>}</div>)}{agreement.participants.map((participant) => <div className="signatory" key={participant.id}><div><strong>{participant.name}</strong><span>{participant.email} · {participant.role} · {participant.status.replace('_', ' ')}</span></div>{participant.status === 'signed' ? <span className="signed"><Check /> Signed</span> : ['draft', 'in_review'].includes(agreement.status) && participant.id !== agreement.createdByParticipantId && ['not_invited', 'invited'].includes(participant.status) ? <button disabled={Boolean(busy)} onClick={() => void mutate(async () => { await api.invite(agreement.id, participant.id); return api.agreement(agreement.id); }, `invite-${participant.id}`)}>{busy === `invite-${participant.id}` ? <><BusyMark /> {participant.status === 'invited' ? 'Resending…' : 'Sending…'}</> : participant.status === 'invited' ? 'Resend invite' : 'Send invite'}</button> : ownerCanSign && participant.id === agreement.createdByParticipantId ? <button disabled={Boolean(busy)} onClick={() => setSigning(true)}>Sign</button> : null}</div>)}</div>
      </aside></div>{finishingReview && <FinishReviewDialog busy={Boolean(busy)} onClose={() => setFinishingReview(false)} onRequest={() => void mutate(() => api.sendForSignature(agreement.id), 'signature').then((ok) => { if (ok) setFinishingReview(false); })} onSign={() => void mutate(() => api.prepareForSignature(agreement.id), 'signature').then((ok) => { if (ok) { setFinishingReview(false); setSigning(true); } })} />}{signing && owner && <SignatureCeremony agreement={agreement} signer={owner} busy={busy === 'sign'} onClose={() => setSigning(false)} onSign={(signature) => void mutate(() => api.sign(agreement.id, owner.id, signature), 'sign').then((signed) => { if (signed) setSigning(false); })} />}</div>;
}

function FinishReviewDialog({ busy, onClose, onRequest, onSign }: { busy: boolean; onClose: () => void; onRequest: () => void; onSign: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal finish-review" role="dialog" aria-modal="true" aria-labelledby="finish-review-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="bc-eyebrow bc-text-orange">// FINISH REVIEW</span><h2 id="finish-review-title">The final revision is ready.</h2></div><button className="icon-button" onClick={onClose}><X /></button></header><div className="finish-review-options"><button disabled={busy} onClick={onSign}><ShieldCheck /><span><strong>Sign & request signatures</strong><small>Add your signature now, then notify every remaining signatory.</small></span><ArrowRight /></button><button disabled={busy} onClick={onRequest}><FileCheck2 /><span><strong>Request signatures</strong><small>Open signing for everyone and add your own signature later.</small></span><ArrowRight /></button></div>{busy && <div className="finish-review-busy"><BusyMark /> Preparing the signing version…</div>}</section></div>;
}

function CreateAgreementModal({ templates, onClose, onCreated, onError }: { templates: Template[]; onClose: () => void; onCreated: (agreement: Agreement) => void; onError: (message: string) => void }) {
  type Invitee = { id: string; name: string; email: string; role: 'reviewer' | 'signatory' };
  const [title, setTitle] = useState(''); const [templateKey, setTemplateKey] = useState(templates[0]?.key ?? ''); const [externalId, setExternalId] = useState(''); const [busy, setBusy] = useState(false);
  const [entityName, setEntityName] = useState(''); const [businessAddress, setBusinessAddress] = useState(''); const [registration, setRegistration] = useState(''); const [jurisdiction, setJurisdiction] = useState('');
  const [invitees, setInvitees] = useState<Invitee[]>([{ id: crypto.randomUUID(), name: '', email: '', role: 'signatory' }]); const [minimumSignatures, setMinimumSignatures] = useState(1);
  const updateInvitee = (id: string, patch: Partial<Invitee>) => setInvitees((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  async function submit(event: FormEvent) { event.preventDefault(); try { setBusy(true); const signerCount = invitees.filter((item) => item.role === 'signatory').length; if (minimumSignatures > signerCount) throw new Error('Required signatures cannot exceed the number of signatories.'); const input: CreateAgreement = { title, templateKey, participants: [], parties: [{ role: 'counterparty', entity: { ...(entityName ? { legalName: entityName } : {}), ...(businessAddress ? { businessAddress } : {}), ...(registration ? { registrationNumber: registration } : {}), ...(jurisdiction ? { jurisdiction } : {}) }, minimumSignatures, participants: invitees.map(({ id: _, name, ...person }) => ({ ...person, ...(name ? { name } : {}), required: person.role === 'signatory', permissions: person.role === 'signatory' ? ['read', 'comment', 'suggest', 'sign', 'nominate_signatory'] : ['read', 'comment', 'suggest', 'nominate_signatory'] })) }], metadata: {}, ...(externalId ? { externalId } : {}) }; onCreated(await api.createAgreement(input)); } catch (cause) { onError(cause instanceof Error ? cause.message : 'Could not create agreement.'); } finally { setBusy(false); } }
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-heading" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span className="bc-eyebrow bc-text-orange">// NEW WORKFLOW</span><h2 id="create-heading">Create agreement</h2></div><button className="icon-button" onClick={onClose}><X /></button></header>
      <form onSubmit={(event) => void submit(event)}>
        <label>Agreement title<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Acme mutual NDA" /></label>
        <label>Template<select required value={templateKey} onChange={(event) => setTemplateKey(event.target.value)}>{templates.map((template) => <option key={template.id} value={template.key}>{template.name} · v{template.version}</option>)}</select></label>
        <label>Internal reference<input value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="deal_123 (optional)" /></label>
        <div className="form-divider"><span className="bc-eyebrow">// EXPECTED COUNTERPARTY (OPTIONAL)</span></div>
        <label>Legal entity name<input value={entityName} onChange={(event) => setEntityName(event.target.value)} placeholder="Let the counterparty provide this" /><small>The recipient confirms their legal entity during onboarding. Material changes to prefilled details require your approval.</small></label>
        <label>Business address<textarea value={businessAddress} onChange={(event) => setBusinessAddress(event.target.value)} placeholder="Street, city, postal code, country (optional)" rows={3} /></label>
        <div className="form-split"><label>Registration number<input value={registration} onChange={(event) => setRegistration(event.target.value)} placeholder="Optional" /></label><label>Jurisdiction<input value={jurisdiction} onChange={(event) => setJurisdiction(event.target.value)} placeholder="Optional" /></label></div>
        <div className="form-divider"><span className="bc-eyebrow">// PARTICIPANTS</span></div>
        {invitees.map((invitee, index) => <div className="participant-editor" key={invitee.id}><div className="form-split"><label>Name<input value={invitee.name} onChange={(event) => updateInvitee(invitee.id, { name: event.target.value })} placeholder="Optional" /></label><label>Email<input required type="email" value={invitee.email} onChange={(event) => updateInvitee(invitee.id, { email: event.target.value })} /></label></div><div className="form-split"><label>Role<select value={invitee.role} onChange={(event) => updateInvitee(invitee.id, { role: event.target.value as Invitee['role'] })}><option value="signatory">Signatory</option><option value="reviewer">Reviewer</option></select></label>{invitees.length > 1 && <button type="button" className="text-button" onClick={() => setInvitees((items) => items.filter((item) => item.id !== invitee.id))}>Remove participant {index + 1}</button>}</div></div>)}
        <button type="button" className="button button-secondary button-small" onClick={() => setInvitees((items) => [...items, { id: crypto.randomUUID(), name: '', email: '', role: 'reviewer' }])}><Plus /> Add participant</button>
        <label>Signatures required<input type="number" min="0" max={invitees.filter((item) => item.role === 'signatory').length} value={minimumSignatures} onChange={(event) => setMinimumSignatures(Number(event.target.value))} /><small>Any required number of this counterparty’s signatories may complete the entity’s signature requirement.</small></label>
        <footer><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button disabled={busy || templates.length === 0} className="button button-accent">{busy ? <><BusyMark /> Creating…</> : <>Create agreement <ArrowRight /></>}</button></footer>
      </form>
    </section>
  </div>;
}

function IntegrationSettings() { return <div className="page"><div className="page-heading"><div><span className="bc-eyebrow bc-text-blue">// INTEGRATIONS</span><h1>Connect without coupling.</h1><p>OAuth2 clients create secure handoffs and query execution state. External subjects stay scoped to their integration.</p></div></div><div className="integration-grid"><article><Webhook /><span className="bc-eyebrow">// CALLBACKS</span><h3>Webhooks</h3><p>Receive signed, idempotent events when agreements move through review and execution.</p><code>agreement.executed</code></article><article><ShieldCheck /><span className="bc-eyebrow">// SECURE HANDOFF</span><h3>Host-mediated sessions</h3><p>Your backend authenticates the visitor, creates a short-lived handoff, and redirects them to Contracts. No external ID is entered in the browser.</p><code>POST /v1/integration-sessions</code></article></div><div className="api-call"><div><span className="method">GET</span><code>/v1/integration-status</code></div><pre>{`?integrationKey=fiftysixty\n&subject=user_01JXYZ\n&templateKey=mutual-nda\n&minimumVersion=1`}</pre></div></div>; }

export default App;
