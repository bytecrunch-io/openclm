import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Download,
  FileCheck2,
  Send,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import { api, statusLabel, type ExternalView } from "./api";
import {
  DirectContractEditor,
  DocumentCommentCard,
  RedlineCard,
  SIGNATURE_BLOCKS_PLACEHOLDER,
  SelectableContract,
  type DraftSaveState,
  type TextSelection,
} from "./ReviewWorkspace";
import {
  NextActionBanner,
  SignatureBlocks,
  SignatureCeremony,
} from "./SigningExperience";
import { BrandIdentity, BusyMark, Dialog, IconButton, PlatformCredit } from "./components";
import type { EntityBranding } from "@bytecrunch/contracts-domain";

export default function ExternalPortal() {
  const [view, setView] = useState<ExternalView>();
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string>();
  const [error, setError] = useState<string>();
  const [recoveryMessage, setRecoveryMessage] = useState<string>();
  async function load() {
    try {
      setLoading(true);
      setError(undefined);
      const token = new URLSearchParams(window.location.search).get("token");
      const accessToken = new URLSearchParams(window.location.search).get(
        "accessToken",
      );
      const integrationToken = new URLSearchParams(window.location.search).get(
        "integrationToken",
      );
      if (accessToken) {
        await api.exchangeAccess(accessToken);
        window.history.replaceState({}, "", "/invite");
      } else if (token) {
        const result = await api.exchangeInvitation(token);
        if (!result.accepted) {
          setRecoveryMessage(result.message);
          return;
        }
        window.history.replaceState({}, "", "/invite");
      } else if (integrationToken) {
        await api.exchangeIntegrationSession(integrationToken);
        window.history.replaceState({}, "", "/invite");
      }
      setView(await api.externalSession());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The invitation could not be opened.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function update(
    action: () => Promise<ExternalView>,
    label = "working",
  ) {
    try {
      setLoading(true);
      setBusyAction(label);
      setError(undefined);
      setView(await action());
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The action could not be completed.",
      );
      return false;
    } finally {
      setLoading(false);
      setBusyAction(undefined);
    }
  }

  if (loading && !view)
    return (
      <PortalFrame>
        <div className="portal-loading">
          <BusyMark />
          <span className="bc-eyebrow">// OPENING SECURE INVITATION</span>
        </div>
      </PortalFrame>
    );
  if (recoveryMessage && !view)
    return (
      <PortalFrame>
        <div className="portal-error">
          <ShieldCheck />
          <span className="bc-eyebrow bc-text-orange">// CHECK YOUR EMAIL</span>
          <h1>A fresh return link is on its way.</h1>
          <p>{recoveryMessage}</p>
          <small>
            You can close this tab. The new link expires in 15 minutes.
          </small>
        </div>
      </PortalFrame>
    );
  if (!view)
    return (
      <PortalFrame>
        <div className="portal-error">
          <ShieldCheck />
          <span className="bc-eyebrow bc-text-orange">
            // INVITATION UNAVAILABLE
          </span>
          <h1>This link can’t be opened.</h1>
          <p>{error ?? "Ask the sender for a new invitation."}</p>
        </div>
      </PortalFrame>
    );

  if (!view.participant.onboardingCompletedAt) {
    return (
      <PortalFrame branding={view.branding}>
        <Onboarding
          view={view}
          busy={loading}
          {...(error ? { error } : {})}
          onSubmit={(input) => update(() => api.onboardExternal(input))}
        />
      </PortalFrame>
    );
  }
  return (
    <PortalFrame branding={view.branding}>
      <Workspace
        view={view}
        busy={busyAction}
        {...(error ? { error } : {})}
        update={update}
        onError={setError}
      />
    </PortalFrame>
  );
}

function PortalFrame({ children, branding }: { children: ReactNode; branding?: EntityBranding | null }) {
  return (
    <main className="external-shell" style={{ '--bc-orange': branding?.primaryColor, '--bc-blue': branding?.secondaryColor } as CSSProperties}>
      <header className="external-header">
        <BrandIdentity branding={branding} className="external-brand" />
        <div className="external-header-actions">
          <a href="/inbox">All my agreements</a>
          <span className="secure-label">
            <ShieldCheck /> Secure participant portal
          </span>
        </div>
      </header>
      {children}
      <PlatformCredit />
    </main>
  );
}

function Onboarding({
  view,
  busy,
  error,
  onSubmit,
}: {
  view: ExternalView;
  busy: boolean;
  error?: string;
  onSubmit: (input: Parameters<typeof api.onboardExternal>[0]) => void;
}) {
  const [name, setName] = useState(view.participant.name);
  const [title, setTitle] = useState(view.participant.title ?? "");
  const [capacity, setCapacity] = useState("authorized_representative");
  const [authority, setAuthority] = useState(false);
  const [legalName, setLegalName] = useState(
    view.party?.entity.legalName ?? "",
  );
  const [businessAddress, setBusinessAddress] = useState(
    view.party?.entity.businessAddress ?? "",
  );
  const [registration, setRegistration] = useState(
    view.party?.entity.registrationNumber ?? "",
  );
  const [jurisdiction, setJurisdiction] = useState(
    view.party?.entity.jurisdiction ?? "",
  );
  const businessAddressRequired = view.requiredEntityFields.includes("businessAddress");
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      name,
      title,
      capacity,
      authorityConfirmed: authority,
      entity: {
        legalName,
        ...(businessAddress ? { businessAddress } : {}),
        ...(registration ? { registrationNumber: registration } : {}),
        ...(jurisdiction ? { jurisdiction } : {}),
      },
    });
  }
  return (
    <section className="onboarding">
      <div className="onboarding-intro">
        <span className="bc-eyebrow bc-text-orange">// BEFORE YOU REVIEW</span>
        <h1>Confirm who you represent.</h1>
        <p>
          We use these details to record who reviewed the agreement and, where
          applicable, who had authority to bind the legal entity.
        </p>
        <div className="step-list">
          <span>
            <b>01</b> Your identity
          </span>
          <span>
            <b>02</b> Legal entity
          </span>
          <span>
            <b>03</b> Signing authority
          </span>
        </div>
      </div>
      <form onSubmit={submit} className="onboarding-form">
        <h2>Your details</h2>
        <div className="form-split">
          <label>
            Full legal name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Job title
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Director"
            />
          </label>
        </div>
        <h2>Entity details</h2>
        <label>
          Legal entity name
          <input
            required
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
          />
        </label>
        <label>
          Business address
          <textarea
            required={businessAddressRequired}
            value={businessAddress}
            onChange={(e) => setBusinessAddress(e.target.value)}
            placeholder={businessAddressRequired ? "Street, city, postal code, country" : "Street, city, postal code, country (optional)"}
            rows={3}
          />
          {businessAddressRequired && <small>Required because the agreement includes your entity’s business address.</small>}
        </label>
        <div className="form-split">
          <label>
            Registration number
            <input
              value={registration}
              onChange={(e) => setRegistration(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <label>
            Jurisdiction
            <input
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              placeholder="e.g. Denmark"
            />
          </label>
        </div>
        <h2>Your capacity</h2>
        <label>
          Signing capacity
          <select
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          >
            <option value="authorized_representative">
              Authorized representative
            </option>
            <option value="director">Director</option>
            <option value="officer">Officer</option>
            <option value="personally">Personally</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={authority}
            onChange={(e) => setAuthority(e.target.checked)}
          />
          <span>
            <strong>I am authorized to bind this entity</strong>
            <small>
              Leave this unchecked if you are reviewing only. You can nominate
              an authorized signatory next.
            </small>
          </span>
        </label>
        {error && <div className="inline-error">{error}</div>}
        <button disabled={busy} className="button button-accent">
          {busy ? (
            <>
              <BusyMark /> Saving details…
            </>
          ) : (
            <>
              Continue to agreement <ArrowRight />
            </>
          )}
        </button>
      </form>
    </section>
  );
}

function Workspace({
  view,
  busy,
  error,
  update,
  onError,
}: {
  view: ExternalView;
  busy: string | undefined;
  error?: string;
  update: (
    action: () => Promise<ExternalView>,
    label?: string,
  ) => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const [selection, setSelection] = useState<TextSelection>();
  const [replacement, setReplacement] = useState("");
  const [comment, setComment] = useState("");
  const [documentComment, setDocumentComment] = useState("");
  const [activeRedline, setActiveRedline] = useState<string>();
  const [showSigning, setShowSigning] = useState(false);
  const [showNominate, setShowNominate] = useState(false);
  const [showReopen, setShowReopen] = useState(false);
  const [draftState, setDraftState] = useState<DraftSaveState>("saved");
  const [downloading, setDownloading] = useState(false);
  async function downloadCompletion() {
    try {
      setDownloading(true);
      const artifacts = await api.externalArtifacts();
      const document = artifacts.find((item) => item.kind === "executed_pdf");
      if (!document) throw new Error("The sealed executed PDF is not available yet.");
      await api.downloadExternalArtifact(document.id);
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Could not download the executed agreement.",
      );
    } finally {
      setDownloading(false);
    }
  }
  const canReview =
    view.agreement.status === "in_review" &&
    (view.agreement.reviewAssignedTo === "counterparty" ||
      view.agreement.reviewAssignedTo === null);
  const canSign =
    ["out_for_signature", "partially_signed"].includes(view.agreement.status) &&
    view.participant.role === "signatory" &&
    view.participant.status !== "signed";
  const canReopenReview =
    ["out_for_signature", "partially_signed"].includes(view.agreement.status) &&
    view.participant.status !== "signed" &&
    view.participant.permissions.includes("suggest");
  const actorId = view.participant.personId ?? view.participant.id;
  const incomingOpenSuggestions = view.agreement.suggestions.filter(
    (item) =>
      item.status === "open" && item.reviewRound < view.agreement.reviewRound,
  );
  const hasDraftChanges =
    view.agreement.suggestions.some(
      (item) =>
        item.status === "open" &&
        item.reviewRound === view.agreement.reviewRound &&
        item.authorSubjectId === actorId,
    ) ||
    view.agreement.documentComments.some(
      (item) =>
        item.status === "open" &&
        item.reviewRound === view.agreement.reviewRound &&
        item.authorId === actorId,
    );
  const canApproveAndSign =
    canReview &&
    draftState === "saved" &&
    incomingOpenSuggestions.length === 0 &&
    !hasDraftChanges &&
    view.participant.role === "signatory" &&
    view.participant.permissions.includes("sign") &&
    view.participant.authorityConfirmed;
  async function suggest(event: FormEvent) {
    event.preventDefault();
    if (!selection) return;
    await update(
      () =>
        api.externalSuggest({
          originalText: selection.text,
          replacementText: replacement,
          comment,
          anchor: { start: selection.start, end: selection.end },
        }),
      "redline",
    );
    setSelection(undefined);
    setReplacement("");
    setComment("");
    window.getSelection()?.removeAllRanges();
  }
  return (
    <div className="external-workspace">
      <div className="external-title">
        <div>
          <span className="bc-eyebrow bc-text-orange">
            // {view.party?.entity.legalName ?? "EXTERNAL PARTY"}
          </span>
          <h1>{view.agreement.title}</h1>
          <p>
            You’re participating as {view.participant.name} ·{" "}
            {view.participant.title}
          </p>
        </div>
        <span className={`portal-status ${view.agreement.status}`}>
          {statusLabel(view.agreement.status)}
        </span>
      </div>
      {error && <div className="inline-error">{error}</div>}
      {canSign ? (
        <NextActionBanner
          title="Your signature is required"
          body="The review is complete. Review the final revision and add your signature to continue."
          action={{
            label: "Review and sign",
            onClick: () => setShowSigning(true),
            busy: busy === "sign",
          }}
        />
      ) : canApproveAndSign ? (
        <NextActionBanner
          title="Happy with the agreement?"
          body="You do not need to send an unchanged review back. Approve this revision and sign it now, or edit the document below to propose changes."
          action={{
            label: "Approve & sign",
            onClick: () =>
              void update(
                () => api.approveExternalForSignature(),
                "approve-sign",
              ).then((ok) => {
                if (ok) setShowSigning(true);
              }),
            busy: busy === "approve-sign",
          }}
        />
      ) : canReview ? (
        <NextActionBanner
          title="Your review draft"
          body="Edit directly in the document. Saved changes stay private until you send them to the sender."
        />
      ) : view.agreement.status === "in_review" ? (
        <NextActionBanner
          waiting
          title="Waiting for the sender"
          body="Your review was sent. We’ll let you know when the sender sends changes or requests your signature."
        />
      ) : view.participant.status === "signed" &&
        view.agreement.status !== "executed" ? (
        <NextActionBanner
          waiting
          title="Your signature is complete"
          body="The agreement is waiting for the remaining required signatures."
        />
      ) : view.agreement.status === "executed" ? (
        <NextActionBanner
          eyebrow="// COMPLETE"
          waiting
          title="Agreement executed"
          body="Every required signature has been collected and is shown in the document below."
        />
      ) : null}
      {canReopenReview && (
        <section className="reopen-review-strip">
          <div>
            <AlertTriangle />
            <span>
              <strong>Not ready to sign?</strong>
              <small>
                You can reopen negotiation, but every signature already attached
                to this revision will be voided.
              </small>
            </span>
          </div>
          <button
            className="button button-secondary button-small"
            onClick={() => setShowReopen(true)}
          >
            Propose more changes
          </button>
        </section>
      )}
      <div className="external-contract-grid">
        <article className="external-document">
          <div className="document-meta">
            <span>Revision {view.agreement.revision}</span>
            <span>SHA-256 · {view.agreement.contentSha256.slice(0, 12)}…</span>
          </div>
          <div className="document-paper">
            {canReview && view.participant.permissions.includes("suggest") ? (
              <DirectContractEditor
                agreement={view.agreement}
                busy={busy === "draft"}
                activeRedlineId={activeRedline}
                onOpenRedline={setActiveRedline}
                onStateChange={setDraftState}
                onSave={(content) =>
                  update(() => api.externalSaveReviewDraft(content), "draft")
                }
              />
            ) : (
              <SelectableContract
                agreement={view.agreement}
                onSelect={undefined}
                onOpenRedline={setActiveRedline}
              />
            )}
            {(view.agreement.content.includes(SIGNATURE_BLOCKS_PLACEHOLDER) ||
              view.agreement.templateKey === "mutual-nda") && (
              <SignatureBlocks agreement={view.agreement} />
            )}
          </div>
        </article>
        <aside className="external-actions">
          {view.agreement.status === "in_review" && (
            <section className="review-turn">
              <div>
                <span>{canReview ? "Your review" : "With sender"}</span>
                <p>
                  {canReview
                    ? draftState !== "saved"
                      ? "Tracking and saving your latest edits…"
                      : incomingOpenSuggestions.length
                        ? `Accept, keep the original, or edit inline to counter ${incomingOpenSuggestions.length} incoming redline${incomingOpenSuggestions.length === 1 ? "" : "s"}.`
                        : hasDraftChanges
                          ? "Your saved edits are private until you send these changes."
                          : canApproveAndSign
                            ? "No changes drafted. Approve and sign above, or edit the document."
                            : "Review the document and send your response when ready."
                    : "You sent your review. Waiting for the sender."}
                </p>
              </div>
              {canReview &&
                draftState === "saved" &&
                hasDraftChanges &&
                incomingOpenSuggestions.length === 0 && (
                  <button
                    disabled={Boolean(busy)}
                    className="button button-accent button-small"
                    onClick={() =>
                      void update(() => api.returnReview(), "return-review")
                    }
                  >
                    {busy === "return-review" ? (
                      <>
                        <BusyMark /> Sending…
                      </>
                    ) : (
                      <>
                        Send changes <ArrowRight />
                      </>
                    )}
                  </button>
                )}
              {canReview &&
                draftState === "saved" &&
                !hasDraftChanges &&
                !canApproveAndSign &&
                incomingOpenSuggestions.length === 0 && (
                  <button
                    disabled={Boolean(busy)}
                    className="button button-secondary button-small"
                    onClick={() =>
                      void update(() => api.returnReview(), "return-review")
                    }
                  >
                    {busy === "return-review" ? (
                      <>
                        <BusyMark /> Sending…
                      </>
                    ) : (
                      <>
                        Send review <ArrowRight />
                      </>
                    )}
                  </button>
                )}
            </section>
          )}
          {view.agreement.suggestions.length > 0 && (
            <section className="redline-list">
              <span className="bc-eyebrow">// REDLINES</span>
              {view.agreement.suggestions.map((suggestion) => {
                const actorId =
                  view.participant.personId ?? view.participant.id;
                const isDraftOwner =
                  canReview &&
                  suggestion.status === "open" &&
                  suggestion.reviewRound === view.agreement.reviewRound &&
                  suggestion.authorSubjectId === actorId;
                const isIncoming =
                  canReview &&
                  suggestion.status === "open" &&
                  suggestion.reviewRound < view.agreement.reviewRound;
                return (
                  <RedlineCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    active={activeRedline === suggestion.id}
                    busy={Boolean(busy)}
                    canReply={canReview}
                    canEdit={isDraftOwner}
                    canResolve={isIncoming}
                    onSelect={() => setActiveRedline(suggestion.id)}
                    onReply={(body) =>
                      void update(
                        () => api.externalReplySuggestion(suggestion.id, body),
                        `reply-${suggestion.id}`,
                      )
                    }
                    onEdit={(nextReplacement, nextComment) =>
                      void update(
                        () =>
                          api.externalUpdateSuggestion(suggestion.id, {
                            replacementText: nextReplacement,
                            comment: nextComment,
                          }),
                        `edit-${suggestion.id}`,
                      )
                    }
                    onRemove={() =>
                      void update(
                        () => api.externalRemoveSuggestion(suggestion.id),
                        `remove-${suggestion.id}`,
                      )
                    }
                    onResolve={(resolution) =>
                      void update(
                        () =>
                          api.externalResolveSuggestion(
                            suggestion.id,
                            resolution,
                          ),
                        `resolve-${suggestion.id}`,
                      )
                    }
                  />
                );
              })}
            </section>
          )}
          {(canReview || view.agreement.documentComments.length > 0) && (
            <section className="document-comments">
              <span className="bc-eyebrow">// GENERAL FEEDBACK</span>
              {view.agreement.documentComments.map((item) => {
                const actorId =
                  view.participant.personId ?? view.participant.id;
                const isDraftOwner =
                  canReview &&
                  item.status === "open" &&
                  item.reviewRound === view.agreement.reviewRound &&
                  item.authorId === actorId;
                return (
                  <DocumentCommentCard
                    key={item.id}
                    item={item}
                    busy={Boolean(busy)}
                    canEdit={isDraftOwner}
                    canResolve={false}
                    onEdit={(body) =>
                      void update(
                        () => api.externalUpdateDocumentComment(item.id, body),
                        `edit-comment-${item.id}`,
                      )
                    }
                    onRemove={() =>
                      void update(
                        () => api.externalRemoveDocumentComment(item.id),
                        `remove-comment-${item.id}`,
                      )
                    }
                  />
                );
              })}
              {canReview && (
                <form
                  className="thread-reply-wrap"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!documentComment.trim()) return;
                    void update(
                      () => api.externalDocumentComment(documentComment.trim()),
                      "document-comment",
                    ).then((saved) => {
                      if (saved) setDocumentComment("");
                    });
                  }}
                >
                  <div className="thread-reply">
                    <Send />
                    <input
                      value={documentComment}
                      onChange={(event) =>
                        setDocumentComment(event.target.value)
                      }
                      placeholder="Comment on the document overall…"
                    />
                    <button disabled={Boolean(busy)}>
                      {busy === "document-comment" ? <BusyMark /> : "Add"}
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}
          {canSign && (
            <section className="signature-card">
              <FileCheck2 />
              <span className="bc-eyebrow bc-text-blue">
                // READY TO EXECUTE
              </span>
              <h2>Sign for {view.party?.entity.legalName}</h2>
              <p>
                Create a typed or drawn signature. On a phone, the drawing
                surface works directly with touch.
              </p>
              <button
                disabled={Boolean(busy)}
                className="button button-accent"
                onClick={() => setShowSigning(true)}
              >
                Open signing <ArrowRight />
              </button>
            </section>
          )}
          {(view.participant.status === "signed" ||
            view.agreement.status === "executed") && (
            <section className="completion-card">
              <div>
                <Check />
              </div>
              <span className="bc-eyebrow">// SIGNATURE RECORDED</span>
              <h2>
                {view.agreement.status === "executed"
                  ? "Agreement executed."
                  : "Your part is complete."}
              </h2>
              <p>
                {view.agreement.status === "executed"
                  ? "Every required signature has been collected."
                  : "We’ll notify you when the remaining signatories complete the agreement."}
              </p>
              {view.agreement.status === "executed" && (
                <button
                  disabled={downloading}
                  className="button button-secondary"
                  onClick={() => void downloadCompletion()}
                >
                  {downloading ? (
                    <>
                      <BusyMark /> Preparing download…
                    </>
                  ) : (
                    <>
                      <Download /> Download sealed PDF
                    </>
                  )}
                </button>
              )}
              {view.agreement.status === 'executed' && view.agreement.verificationCode && <a className="button button-secondary" href={`/verify/${view.agreement.verificationCode}`} target="_blank" rel="noreferrer">Verify document</a>}
              {view.agreement.status === "executed" &&
                view.agreement.integrationContext && (
                  <a
                    className="button button-accent"
                    href={view.agreement.integrationContext.returnUrl}
                  >
                    Return to connected app <ArrowRight />
                  </a>
                )}
            </section>
          )}
          {view.participant.permissions.includes("nominate_signatory") &&
            view.participant.status !== "signed" && (
              <section className="nominate-card">
                <UserPlus />
                <h3>Someone else should sign?</h3>
                <p>
                  Nominate an authorized representative from{" "}
                  {view.party?.entity.legalName}.
                </p>
                <button
                  className="text-button"
                  onClick={() => setShowNominate(!showNominate)}
                >
                  Nominate a signatory →
                </button>
                {showNominate && (
                  <NominateForm
                    busy={Boolean(busy)}
                    onSubmit={(input) =>
                      update(async () => {
                        const result = await api.nominateSignatory(input);
                        return "agreement" in result ? result : result;
                      }, "nominate")
                    }
                  />
                )}
              </section>
            )}
          <section className="participant-list">
            <span className="bc-eyebrow">// PARTICIPANTS</span>
            {view.agreement.participants
              .filter(
                (p) =>
                  !view.participant.partyId ||
                  p.partyId === view.participant.partyId,
              )
              .map((p) => (
                <div key={p.id}>
                  <span>
                    {p.name}
                    <small>{p.title ?? p.role}</small>
                  </span>
                  <b>{p.status}</b>
                </div>
              ))}
          </section>
        </aside>
      </div>
      {showSigning && (
        <SignatureCeremony
          agreement={view.agreement}
          signer={view.participant}
          busy={busy === "sign"}
          onClose={() => setShowSigning(false)}
          onDownload={() => void api.downloadExternalSigningPdf().catch((cause) => onError(cause instanceof Error ? cause.message : 'Could not download the frozen PDF.'))}
          onSign={(signature) =>
            void update(() => api.externalSign(signature), "sign").then(
              (signed) => {
                if (signed) setShowSigning(false);
              },
            )
          }
        />
      )}
      {showReopen && (
        <ReopenReviewDialog
          signedNames={view.agreement.participants
            .filter((item) => item.signature)
            .map((item) => item.name)}
          busy={busy === "reopen-review"}
          onClose={() => setShowReopen(false)}
          onConfirm={() =>
            void update(() => api.reopenExternalReview(), "reopen-review").then(
              (ok) => {
                if (ok) setShowReopen(false);
              },
            )
          }
        />
      )}
    </div>
  );
}

function ReopenReviewDialog({
  signedNames,
  busy,
  onClose,
  onConfirm,
}: {
  signedNames: string[];
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [understood, setUnderstood] = useState(false);
  return (
    <Dialog
      labelledBy="reopen-review-title"
      onClose={onClose}
      busy={busy}
      className="modal reopen-review-dialog"
    >
      <header>
        <div>
          <span className="bc-eyebrow bc-text-orange">
            // SIGNATURE WARNING
          </span>
          <h2 id="reopen-review-title">
            {step === 1
              ? "Reopen this agreement?"
              : "Confirm signature invalidation"}
          </h2>
        </div>
        <IconButton
          disabled={busy}
          label="Close signature warning"
          onClick={onClose}
        >
          <X />
        </IconButton>
      </header>
      <div className="reopen-review-content">
        <AlertTriangle />
        {step === 1 ? (
          <>
            <p>
              You are about to move the agreement out of signing and back into
              negotiation. Any signature on this exact revision can no longer
              remain valid if its text changes.
            </p>
            {signedNames.length > 0 ? (
              <div className="invalidated-signer-list">
                <span>
                  The following signature{signedNames.length === 1 ? "" : "s"}{" "}
                  will be voided
                </span>
                {signedNames.map((name) => (
                  <strong key={name}>{name}</strong>
                ))}
              </div>
            ) : (
              <p>
                No signatures have been recorded yet, but the current signing
                request will be cancelled.
              </p>
            )}
          </>
        ) : (
          <>
            <p>
              This action is recorded in the agreement history. Everyone whose
              signature is voided will need to review and sign the eventual new
              revision again.
            </p>
            <label className="check-field">
              <input
                type="checkbox"
                checked={understood}
                onChange={(event) => setUnderstood(event.target.checked)}
              />
              <span>
                <strong>
                  I understand that all existing signatures will be voided
                </strong>
                <small>
                  The signature evidence remains in the audit history as
                  invalidated.
                </small>
              </span>
            </label>
          </>
        )}
      </div>
      <footer>
        <button
          disabled={busy}
          className="button button-secondary"
          onClick={step === 1 ? onClose : () => setStep(1)}
        >
          Back
        </button>
        {step === 1 ? (
          <button className="button button-accent" onClick={() => setStep(2)}>
            Continue <ArrowRight />
          </button>
        ) : (
          <button
            disabled={busy || !understood}
            className="button button-danger"
            onClick={onConfirm}
          >
            {busy ? (
              <>
                <BusyMark /> Reopening…
              </>
            ) : (
              "Void signatures & reopen review"
            )}
          </button>
        )}
      </footer>
    </Dialog>
  );
}

function NominateForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: Parameters<typeof api.nominateSignatory>[0]) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  return (
    <form
      className="nominate-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ name, email, ...(title ? { title } : {}) });
      }}
    >
      <label>
        Name
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Email
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <button disabled={busy} className="button button-secondary button-small">
        {busy ? (
          <>
            <BusyMark /> Sending…
          </>
        ) : (
          "Send invitation"
        )}
      </button>
    </form>
  );
}
