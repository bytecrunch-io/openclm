import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import {
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  CircleUserRound,
  Cloud,
  FileCheck2,
  FileClock,
  FilePenLine,
  Download,
  BookOpen,
  Braces,
  Building2,
  FilePlus2,
  Files,
  History,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Plus,
  Save,
  Settings,
  Trash2,
  ShieldCheck,
  UserPlus,
  UsersRound,
  Webhook,
  X,
} from "lucide-react";
import {
  requiredEntityFieldsForTemplate,
  type Agreement,
  type CreateAgreement,
  type CreateTemplate,
  type Notification,
  type CustomerEntity,
  type EntityBranding,
  type Template,
} from "@bytecrunch/contracts-domain";
import logo from "./assets/logo.svg";
import {
  api,
  statusLabel,
  type EntityMemberList,
  type EntityRole,
  type Passkey,
  type PublicVerification,
  type RecipientInboxItem,
  type User,
  type PluginInstallation,
  type PluginManifest,
} from "./api";
import ExternalPortal from "./ExternalPortal";
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
import {
  BrandIdentity,
  BusyMark,
  Dialog,
  IconButton,
  InlineAlert,
  PlatformCredit,
  ThemeToggle,
} from "./components";

type View =
  "dashboard" | "my-work" | "agreements" | "templates" | "members" | "settings";

function App() {
  if (window.location.pathname === "/invite") return <ExternalPortal />;
  if (window.location.pathname === "/inbox") return <RecipientInboxPage />;
  if (window.location.pathname === "/membership")
    return <MembershipInvitationPage />;
  if (window.location.pathname.startsWith('/verify/')) return <VerificationPage />;
  return <AdminApp />;
}

function VerificationPage() {
  const code = decodeURIComponent(window.location.pathname.slice('/verify/'.length));
  const [result, setResult] = useState<PublicVerification>(); const [error, setError] = useState<string>(); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!code) { setError('The verification code is missing.'); return; } void api.verifyAgreement(code).then(setResult).catch((cause) => setError(cause instanceof Error ? cause.message : 'Verification failed.')); }, [code]);
  return <main className="membership-invitation verification-page"><section>
    <img src={logo} alt="" /><span className="bc-eyebrow bc-text-orange">// DOCUMENT VERIFICATION</span>
    {result ? <>
      <h1>{result.validation?.documentIntegrityValid ? 'Document integrity verified' : 'Document could not be verified'}</h1>
      <p><strong>{result.title}</strong> was completed on {new Date(result.executedAt).toLocaleString()}.</p>
      <div className="verification-facts"><span>Agreement ID<strong>{result.agreementId}</strong></span><span>Revision<strong>{result.revision}</strong></span><span>Seal profile<strong>{result.validation?.profile ?? 'Unavailable'}</strong></span><span>Certificate trust<strong>{result.validation?.certificateTrust.replaceAll('_', ' ') ?? 'Unavailable'}</strong></span></div>
      <div className="verification-signers">{result.signers.map((signer) => <span key={`${signer.name}-${signer.signedAt}`}><Check /> <strong>{signer.name}</strong> signed {new Date(signer.signedAt).toLocaleString()}</span>)}</div>
      {result.validation?.limitations.map((limitation) => <small key={limitation}>{limitation}</small>)}
      {result.executedPdf && <button className="button button-accent" disabled={busy} onClick={() => { setBusy(true); void api.downloadVerifiedAgreement(code).catch((cause) => setError(cause instanceof Error ? cause.message : 'Download failed.')).finally(() => setBusy(false)); }}>{busy ? <><BusyMark /> Downloading…</> : <><Download /> Download sealed PDF</>}</button>}
    </> : !error ? <div className="portal-loading"><BusyMark /></div> : null}
    {error && <div className="inline-error">{error}</div>}
  </section></main>;
}

function AdminApp() {
  const [view, setView] = useState<View>("dashboard");
  const [user, setUser] = useState<User>();
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [selected, setSelected] = useState<Agreement>();
  const [creating, setCreating] = useState(false);
  const [creatingEntity, setCreatingEntity] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  async function refresh() {
    try {
      setLoading(true);
      setError(undefined);
      const nextUser = await api.me();
      if (!nextUser.activeEntityId) {
        setUser(nextUser);
        setAgreements([]);
        setTemplates([]);
        setNotifications([]);
        return;
      }
      api.selectEntity(nextUser.activeEntityId);
      const [nextAgreements, nextTemplates, nextNotifications] =
        await Promise.all([
          api.agreements(),
          api.templates(),
          api.notifications(),
        ]);
      setUser(nextUser);
      setAgreements(nextAgreements);
      setTemplates(nextTemplates);
      setNotifications(nextNotifications);
      if (selected)
        setSelected(nextAgreements.find((item) => item.id === selected.id));
      else {
        const linkedAgreement = new URLSearchParams(window.location.search).get(
          "agreement",
        );
        if (linkedAgreement) {
          const match = nextAgreements.find(
            (item) => item.id === linkedAgreement,
          );
          if (match) {
            setSelected(match);
            setView("agreements");
          }
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load contracts.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(
      () =>
        void api
          .notifications()
          .then(setNotifications)
          .catch(() => undefined),
      15_000,
    );
    return () => window.clearInterval(timer);
  }, [user]);

  function openAgreement(agreement: Agreement) {
    setSelected(agreement);
    setView("agreements");
  }
  async function openPersonalWork(item: RecipientInboxItem) {
    try {
      setLoading(true);
      api.selectEntity(item.tenantId);
      const [nextUser, agreement] = await Promise.all([
        api.me(),
        api.agreement(item.agreementId),
      ]);
      setUser(nextUser);
      setSelected(agreement);
      setView("agreements");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not open this agreement.",
      );
    } finally {
      setLoading(false);
    }
  }

  const counts = useMemo(
    () => ({
      active: agreements.filter(
        (item) =>
          !["executed", "declined", "voided", "expired"].includes(item.status),
      ).length,
      review: agreements.filter((item) => item.status === "in_review").length,
      signing: agreements.filter((item) =>
        ["out_for_signature", "partially_signed"].includes(item.status),
      ).length,
      executed: agreements.filter((item) => item.status === "executed").length,
    }),
    [agreements],
  );
  const activeMembership = user?.entities.find(
    (item) => item.entityId === user.activeEntityId,
  );
  useEffect(() => {
    const root = document.documentElement;
    const branding = activeMembership?.entity.branding;
    root.style.setProperty("--bc-orange", branding?.primaryColor ?? "#ed650f");
    root.style.setProperty("--bc-blue", branding?.secondaryColor ?? "#05a9ef");
    return () => {
      root.style.removeProperty("--bc-orange");
      root.style.removeProperty("--bc-blue");
    };
  }, [activeMembership?.entity.branding]);

  if (!user && !loading) return <SignIn {...(error ? { error } : {})} />;
  if (user && user.entities.length === 0)
    return (
      <CustomerEntityOnboarding
        user={user}
        onCreated={(entityId) => {
          api.selectEntity(entityId);
          void refresh();
        }}
      />
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => {
            setView("dashboard");
            setSelected(undefined);
          }}
        >
          <BrandIdentity branding={activeMembership?.entity.branding} />
        </button>
        <nav className="side-nav" aria-label="Primary navigation">
          <NavButton
            icon={<LayoutDashboard />}
            active={view === "dashboard"}
            onClick={() => {
              setView("dashboard");
              setSelected(undefined);
            }}
          >
            Overview
          </NavButton>
          <NavButton
            icon={<Inbox />}
            active={view === "my-work"}
            onClick={() => {
              setView("my-work");
              setSelected(undefined);
            }}
          >
            My work
          </NavButton>
          <NavButton
            icon={<Files />}
            active={view === "agreements"}
            onClick={() => setView("agreements")}
          >
            Agreements
          </NavButton>
          {activeMembership?.permissions.includes("templates.read") && (
            <NavButton
              icon={<BookOpen />}
              active={view === "templates"}
              onClick={() => {
                setView("templates");
                setSelected(undefined);
              }}
            >
              Templates
            </NavButton>
          )}
          {activeMembership?.permissions.includes("members.manage") && (
            <NavButton
              icon={<UsersRound />}
              active={view === "members"}
              onClick={() => {
                setView("members");
                setSelected(undefined);
              }}
            >
              People
            </NavButton>
          )}
          <NavButton
            icon={<Settings />}
            active={view === "settings"}
            onClick={() => {
              setView("settings");
              setSelected(undefined);
            }}
          >
            Settings
          </NavButton>
        </nav>
        <div className="sidebar-foot">
          <div className="environment">
            <span className="status-dot" /> Local environment
          </div>
          <div className="user-block">
            <CircleUserRound />
            <div>
              <strong>{user?.name}</strong>
              <span>{user?.email}</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="entity-context">
            <span className="bc-eyebrow">// ACTING FOR</span>
            {user && (
              <label>
                <Building2 />
                <select
                  aria-label="Active customer entity"
                  value={user.activeEntityId ?? ""}
                  onChange={(event) => {
                    api.selectEntity(event.target.value);
                    setSelected(undefined);
                    void refresh();
                  }}
                >
                  {user.entities.map((membership) => (
                    <option
                      key={membership.entityId}
                      value={membership.entityId}
                    >
                      {membership.entity.legalName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="text-button"
              onClick={() => setCreatingEntity(true)}
            >
              Add entity
            </button>
          </div>
          <div className="top-actions">
            <button
              className="icon-button notification-trigger"
              aria-label="Notifications"
              onClick={() => setShowNotifications((value) => !value)}
            >
              <Bell />
              {notifications.some((item) => !item.readAt) && (
                <i>{notifications.filter((item) => !item.readAt).length}</i>
              )}
            </button>
            <ThemeToggle />
            <button
              className="button button-accent"
              onClick={() => setCreating(true)}
            >
              <Plus /> New agreement
            </button>
          </div>
        </header>
        {showNotifications && (
          <NotificationCenter
            notifications={notifications}
            onClose={() => setShowNotifications(false)}
            onReadAll={() =>
              void api.readAllNotifications().then(() =>
                setNotifications((items) =>
                  items.map((item) => ({
                    ...item,
                    readAt: item.readAt ?? new Date().toISOString(),
                  })),
                ),
              )
            }
            onOpen={(notification) =>
              void api.readNotification(notification.id).then(() => {
                setNotifications((items) =>
                  items.map((item) =>
                    item.id === notification.id
                      ? { ...item, readAt: new Date().toISOString() }
                      : item,
                  ),
                );
                const agreement = agreements.find(
                  (item) => item.id === notification.agreementId,
                );
                if (agreement) openAgreement(agreement);
                setShowNotifications(false);
              })
            }
          />
        )}

        {error && (
          <InlineAlert
            className="error-banner"
            onDismiss={() => setError(undefined)}
          >
            {error}
          </InlineAlert>
        )}
        {loading && <div className="loading-line" />}
        {view === "dashboard" && (
          <Dashboard
            agreements={agreements}
            counts={counts}
            onOpen={openAgreement}
            onCreate={() => setCreating(true)}
          />
        )}
        {view === "my-work" && (
          <PersonalWork
            onOpen={(item) => void openPersonalWork(item)}
            onError={setError}
          />
        )}
        {view === "agreements" &&
          (selected ? (
            <AgreementDetail
              agreement={selected}
              user={user!}
              onBack={() => setSelected(undefined)}
              onUpdate={(agreement) => {
                setSelected(agreement);
                setAgreements((items) =>
                  items.map((item) =>
                    item.id === agreement.id ? agreement : item,
                  ),
                );
              }}
              onError={setError}
            />
          ) : (
            <AgreementList agreements={agreements} onOpen={openAgreement} />
          ))}
        {view === "templates" && user && (
          <TemplateWorkspace
            key={user.activeEntityId}
            templates={templates}
            entityName={activeMembership?.entity.legalName ?? "Customer entity"}
            canWrite={Boolean(
              activeMembership?.permissions.includes("templates.write"),
            )}
            onCreated={(template) =>
              setTemplates((items) => [template, ...items])
            }
            onError={setError}
          />
        )}
        {view === "members" && user && (
          <MemberSettings user={user} onError={setError} />
        )}
        {view === "settings" && activeMembership && (
          <IntegrationSettings
            entity={activeMembership.entity}
            canManage={activeMembership.permissions.includes("entity.manage")}
            onSaved={(entity) => setUser((current) => current ? {
              ...current,
              entities: current.entities.map((membership) => membership.entityId === entity.id ? { ...membership, entity } : membership),
            } : current)}
            onError={setError}
          />
        )}
      </main>
      <PlatformCredit />
      {creating && (
        <CreateAgreementModal
          templates={latestTemplates(templates)}
          onClose={() => setCreating(false)}
          onCreated={(agreement) => {
            setAgreements((items) => [agreement, ...items]);
            setCreating(false);
            openAgreement(agreement);
          }}
          onError={setError}
        />
      )}
      {creatingEntity && (
        <CreateEntityModal
          onClose={() => setCreatingEntity(false)}
          onCreated={(entityId) => {
            api.selectEntity(entityId);
            setCreatingEntity(false);
            setSelected(undefined);
            setView("settings");
            void refresh();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function NotificationCenter({
  notifications,
  onClose,
  onReadAll,
  onOpen,
}: {
  notifications: Notification[];
  onClose: () => void;
  onReadAll: () => void;
  onOpen: (notification: Notification) => void;
}) {
  return (
    <aside className="notification-center">
      <header>
        <div>
          <span className="bc-eyebrow bc-text-orange">// ACTIVITY</span>
          <h2>Notifications</h2>
        </div>
        <button className="icon-button" onClick={onClose}>
          <X />
        </button>
      </header>
      <div className="notification-toolbar">
        <span>
          {notifications.filter((item) => !item.readAt).length} unread
        </span>
        {notifications.some((item) => !item.readAt) && (
          <button className="text-button" onClick={onReadAll}>
            Mark all read
          </button>
        )}
      </div>
      <div className="notification-list">
        {notifications.length === 0 ? (
          <p className="notification-empty">No notifications yet.</p>
        ) : (
          notifications.map((notification) => (
            <button
              className={notification.readAt ? "" : "unread"}
              key={notification.id}
              onClick={() => onOpen(notification)}
            >
              <i />
              <div>
                <strong>{notification.title}</strong>
                <p>{notification.body}</p>
                <span>
                  {notification.actorName} ·{" "}
                  {new Date(notification.createdAt).toLocaleString()}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

function NavButton({
  icon,
  active,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`nav-button ${active ? "active" : ""}`}
      onClick={onClick}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function SignIn({ error }: { error?: string }) {
  const [companySlug, setCompanySlug] = useState('');
  return (
    <main className="signin">
      <div className="bc-bytewave" />
      <section>
        <img src={logo} alt="Bytecrunch" />
        <span className="bc-eyebrow">// AGREEMENT INFRASTRUCTURE</span>
        <h1>Contracts move faster when the workflow is clear.</h1>
        <p>
          Review, redline, execute, and verify agreements from one auditable
          workspace.
        </p>
        {error && <div className="error-banner">{error}</div>}
        <div className="signin-actions">
          <a className="button button-accent" href={api.loginUrl}>
            Sign in or create a company <ArrowRight />
          </a>
          <a className="button button-secondary" href="/inbox">
            Open invited agreements
          </a>
        </div>
        <form className="company-sso-login" onSubmit={(event) => { event.preventDefault(); if (companySlug) window.location.assign(api.entitySsoUrl(companySlug)); }}><label>Use your company SSO<div><input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={companySlug} onChange={(event) => setCompanySlug(event.target.value.toLowerCase())} placeholder="company-workspace" /><button className="button button-secondary">Continue</button></div><small>Enter the workspace identifier provided by your company.</small></label></form>
      </section>
    </main>
  );
}

function PersonalWork({
  onOpen,
  onError,
}: {
  onOpen: (item: RecipientInboxItem) => void;
  onError: (message: string) => void;
}) {
  const [items, setItems] = useState<RecipientInboxItem[]>();
  useEffect(() => {
    void api
      .myWork()
      .then(setItems)
      .catch((cause) =>
        onError(
          cause instanceof Error ? cause.message : "Could not load your work.",
        ),
      );
  }, []);
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="bc-eyebrow bc-text-orange">
            // CROSS-ENTITY INBOX
          </span>
          <h1>My work</h1>
          <p>
            Reviews and signatures assigned to you, regardless of which customer
            entity is currently selected.
          </p>
        </div>
      </div>
      {!items ? (
        <div className="member-loading">
          <BusyMark /> Loading assignments…
        </div>
      ) : (
        <WorkItemList
          items={items}
          onOpen={onOpen}
          empty="Nothing needs your attention yet."
        />
      )}
    </div>
  );
}

function RecipientInboxPage() {
  const [items, setItems] = useState<RecipientInboxItem[]>();
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [email, setEmail] = useState("");
  const [requestId, setRequestId] = useState<string>();
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    void Promise.all([api.recipientInbox(), api.recipientPasskeys()])
      .then(([nextItems, nextPasskeys]) => {
        setItems(nextItems);
        setPasskeys(nextPasskeys);
      })
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, []);
  async function requestCode(event: FormEvent) {
    event.preventDefault();
    try {
      setBusy(true);
      setError(undefined);
      const response = await api.requestRecipientCode(email);
      setRequestId(response.requestId);
      setExpiresAt(response.expiresAt);
      if (response.developmentCode) setCode(response.developmentCode);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not request a code.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!requestId) return;
    try {
      setBusy(true);
      setError(undefined);
      await api.verifyRecipientCode(requestId, code);
      const [nextItems, nextPasskeys] = await Promise.all([
        api.recipientInbox(),
        api.recipientPasskeys(),
      ]);
      setItems(nextItems);
      setPasskeys(nextPasskeys);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not verify that code.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function signInWithPasskey() {
    try {
      setBusy(true);
      setError(undefined);
      const generated = await api.recipientPasskeyOptions();
      const response = await startAuthentication({
        optionsJSON:
          generated.options as unknown as PublicKeyCredentialRequestOptionsJSON,
      });
      await api.verifyRecipientPasskey(generated.requestId, response);
      const [nextItems, nextPasskeys] = await Promise.all([
        api.recipientInbox(),
        api.recipientPasskeys(),
      ]);
      setItems(nextItems);
      setPasskeys(nextPasskeys);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The passkey could not be used.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function addPasskey() {
    try {
      setBusy(true);
      setError(undefined);
      const generated = await api.recipientPasskeyRegistrationOptions();
      const response = await startRegistration({
        optionsJSON:
          generated.options as unknown as PublicKeyCredentialCreationOptionsJSON,
      });
      await api.verifyRecipientPasskeyRegistration(
        generated.requestId,
        response,
      );
      setPasskeys(await api.recipientPasskeys());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The passkey could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function removePasskey(passkey: Passkey) {
    if (
      !window.confirm(
        `Remove ${passkey.name}? You can still return with an email code.`,
      )
    )
      return;
    try {
      setBusy(true);
      setError(undefined);
      await api.deleteRecipientPasskey(passkey.id);
      setPasskeys(await api.recipientPasskeys());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The passkey could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function open(item: RecipientInboxItem) {
    try {
      setBusy(true);
      await api.openRecipientAgreement(item.accessId);
      window.location.assign("/invite");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not open that agreement.",
      );
      setBusy(false);
    }
  }
  if (checking)
    return (
      <main className="recipient-inbox-page">
        <div className="portal-loading">
          <BusyMark />
        </div>
      </main>
    );
  return (
    <main className="recipient-inbox-page">
      <header>
        <div>
          <img src={logo} alt="" />
          <strong>BYTECRUNCH</strong>
          <span>CONTRACTS</span>
        </div>
        {items && (
          <div className="recipient-account-actions">
            {browserSupportsWebAuthn() && (
              <button
                disabled={busy}
                className="button button-secondary button-small"
                onClick={() => void addPasskey()}
              >
                <KeyRound />
                {passkeys.length ? "Add another passkey" : "Add a passkey"}
              </button>
            )}
            <button
              className="button button-secondary button-small"
              onClick={() =>
                void api.logoutRecipient().then(() => {
                  setItems(undefined);
                  setPasskeys([]);
                })
              }
            >
              <LogOut /> Sign out
            </button>
          </div>
        )}
      </header>
      {items ? (
        <section className="recipient-inbox-content">
          <span className="bc-eyebrow bc-text-orange">// YOUR AGREEMENTS</span>
          <h1>Welcome back.</h1>
          <p>
            Every agreement assigned to this email address, across all senders.
          </p>
          {passkeys.length > 0 && (
            <div className="passkey-status">
              <KeyRound />
              <span>
                <strong>
                  {passkeys.length} passkey{passkeys.length === 1 ? "" : "s"}{" "}
                  ready
                </strong>
                <small>
                  Use a passkey next time instead of waiting for email.
                </small>
              </span>
              <div>
                {passkeys.map((passkey) => (
                  <button
                    key={passkey.id}
                    disabled={busy}
                    title={`Remove ${passkey.name}`}
                    aria-label={`Remove ${passkey.name}`}
                    onClick={() => void removePasskey(passkey)}
                  >
                    {passkey.name}
                    <X />
                  </button>
                ))}
              </div>
            </div>
          )}
          <WorkItemList
            items={items}
            onOpen={open}
            empty="There are no active agreement assignments for this address."
          />
          {error && <div className="inline-error">{error}</div>}
        </section>
      ) : (
        <section className="recipient-login">
          <div>
            <Mail />
            <span className="bc-eyebrow bc-text-orange">
              // SECURE RECIPIENT ACCESS
            </span>
            <h1>Return to your agreements.</h1>
            <p>
              Enter the email address that received an agreement invitation.
              We’ll send a six-digit code if active assignments exist.
            </p>
            {browserSupportsWebAuthn() && (
              <button
                disabled={busy}
                className="button button-secondary passkey-login"
                onClick={() => void signInWithPasskey()}
              >
                <KeyRound /> Use a passkey
              </button>
            )}
          </div>
          {!requestId ? (
            <form onSubmit={(event) => void requestCode(event)}>
              <label>
                Email address
                <input
                  required
                  type="email"
                  autoComplete="email webauthn"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              {error && <div className="inline-error">{error}</div>}
              <button disabled={busy} className="button button-accent">
                {busy ? (
                  <>
                    <BusyMark /> Sending…
                  </>
                ) : (
                  <>
                    Email me a code <ArrowRight />
                  </>
                )}
              </button>
              <small>
                For privacy, the response is the same whether or not an
                assignment exists.
              </small>
            </form>
          ) : (
            <form onSubmit={(event) => void verify(event)}>
              <KeyRound />
              <label>
                Six-digit code
                <input
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
              </label>
              {error && <div className="inline-error">{error}</div>}
              <button
                disabled={busy || code.length !== 6}
                className="button button-accent"
              >
                {busy ? (
                  <>
                    <BusyMark /> Verifying…
                  </>
                ) : (
                  <>
                    Open my inbox <ArrowRight />
                  </>
                )}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setRequestId(undefined);
                  setCode("");
                  setError(undefined);
                }}
              >
                Use another email
              </button>
              {expiresAt && (
                <small>
                  Code expires {new Date(expiresAt).toLocaleTimeString()}.
                </small>
              )}
            </form>
          )}
        </section>
      )}
    </main>
  );
}

function WorkItemList({
  items,
  onOpen,
  empty,
}: {
  items: RecipientInboxItem[];
  onOpen: (item: RecipientInboxItem) => void;
  empty: string;
}) {
  if (items.length === 0)
    return (
      <div className="work-empty">
        <Inbox />
        <p>{empty}</p>
      </div>
    );
  return (
    <div className="work-list">
      {items.map((item) => (
        <button
          key={`${item.tenantId}:${item.agreementId}:${item.participantId}`}
          onClick={() => onOpen(item)}
        >
          <span className={`work-action ${item.action}`}>{item.action}</span>
          <div>
            <strong>{item.title}</strong>
            <p>
              {item.entityName} · {statusLabel(item.agreementStatus)}
            </p>
          </div>
          <time>{new Date(item.updatedAt).toLocaleDateString()}</time>
          <ChevronRight />
        </button>
      ))}
    </div>
  );
}

function CustomerEntityOnboarding({
  user,
  onCreated,
}: {
  user: User;
  onCreated: (entityId: string) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [entity, setEntity] = useState<CustomerEntity>();
  const [legalName, setLegalName] = useState("");
  const [slug, setSlug] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [branding, setBranding] = useState<EntityBranding>({ displayName: null, primaryColor: '#ed650f', secondaryColor: '#05a9ef', logoDataUrl: null, markDataUrl: null });
  const suggestedSlug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const readBrandImage = (file: File, field: 'logoDataUrl' | 'markDataUrl') => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 300_000) { setError('Use a PNG, JPEG, or WebP image smaller than 300 KB.'); return; }
    const reader = new FileReader(); reader.onload = () => setBranding((current) => ({ ...current, [field]: String(reader.result) })); reader.readAsDataURL(file);
  };
  async function submitEntity(event: FormEvent) {
    event.preventDefault();
    try {
      setBusy(true);
      setError(undefined);
      const entity = await api.createEntity({
        legalName,
        slug,
        ...(businessAddress ? { businessAddress } : {}),
        ...(registrationNumber ? { registrationNumber } : {}),
        ...(jurisdiction ? { jurisdiction } : {}),
      });
      api.selectEntity(entity.id); setEntity(entity); setBranding((current) => ({ ...current, displayName: entity.legalName })); setStep(2);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create the customer entity.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submitBranding(event: FormEvent) { event.preventDefault(); if (!entity) return; try { setBusy(true); setError(undefined); const updated = await api.updateEntityBranding(branding); setEntity(updated); setStep(3); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save company branding.'); } finally { setBusy(false); } }
  return (
    <main className="entity-onboarding">
      <section className="entity-onboarding-intro">
        <img src={logo} alt="Bytecrunch" />
        <span className="bc-eyebrow bc-text-orange">
          // WELCOME, {user.name.toUpperCase()}
        </span>
        <h1>Who are you acting for?</h1>
        <p>
          Create the first customer entity you represent. This becomes an
          independent tenant and contracting context—not a ByteCrunch subsidiary
          or shared parent workspace.
        </p>
        <ol className="onboarding-steps"><li className={step >= 1 ? 'active' : ''}>Company</li><li className={step >= 2 ? 'active' : ''}>Brand</li><li className={step >= 3 ? 'active' : ''}>Integrations</li></ol>
      </section>
      {step === 1 && <form
        className="entity-onboarding-form"
        onSubmit={(event) => void submitEntity(event)}
      >
        <span className="bc-eyebrow bc-text-blue">// CUSTOMER ENTITY</span>
        <h2>Set up your workspace</h2>
        <label>
          Legal name
          <input
            required
            value={legalName}
            onChange={(event) => {
              const previousSuggestion = suggestedSlug(legalName);
              setLegalName(event.target.value);
              if (!slug || slug === previousSuggestion)
                setSlug(suggestedSlug(event.target.value));
            }}
            placeholder="Example ApS"
          />
        </label>
        <label>
          Entity identifier
          <input
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
            placeholder="example-aps"
          />
          <small>
            Used in API context and cannot be changed in this version.
          </small>
        </label>
        <label>
          Business address
          <textarea
            value={businessAddress}
            onChange={(event) => setBusinessAddress(event.target.value)}
            rows={3}
          />
        </label>
        <div className="form-split">
          <label>
            Registration number
            <input
              value={registrationNumber}
              onChange={(event) => setRegistrationNumber(event.target.value)}
            />
          </label>
          <label>
            Jurisdiction
            <input
              value={jurisdiction}
              onChange={(event) => setJurisdiction(event.target.value)}
              placeholder="e.g. DK"
            />
          </label>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <button disabled={busy} className="button button-accent">
          {busy ? (
            <>
              <BusyMark /> Creating…
            </>
          ) : (
            <>
              Create customer entity <ArrowRight />
            </>
          )}
        </button>
        <small>Signed in as {user.email}</small>
      </form>}
      {step === 2 && <form className="entity-onboarding-form" onSubmit={(event) => void submitBranding(event)}>
        <span className="bc-eyebrow bc-text-blue">// COMPANY BRAND</span><h2>Make the workspace yours</h2>
        <label>Display name<input required value={branding.displayName ?? ''} onChange={(event) => setBranding((current) => ({ ...current, displayName: event.target.value }))} /></label>
        <div className="form-split"><label>Primary colour<input type="color" value={branding.primaryColor} onChange={(event) => setBranding((current) => ({ ...current, primaryColor: event.target.value }))} /></label><label>Secondary colour<input type="color" value={branding.secondaryColor} onChange={(event) => setBranding((current) => ({ ...current, secondaryColor: event.target.value }))} /></label></div>
        <div className="form-split"><label>Logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) readBrandImage(file, 'logoDataUrl'); }} /><small>Square company symbol, up to 300 KB.</small></label><label>Logomark<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) readBrandImage(file, 'markDataUrl'); }} /><small>Horizontal logo with company name, up to 300 KB.</small></label></div>
        <div className="onboarding-brand-preview" style={{ borderColor: branding.primaryColor }}><BrandIdentity branding={branding} /></div>
        {error && <div className="inline-error">{error}</div>}<footer><button type="button" className="button button-secondary" onClick={() => setStep(3)}>Skip for now</button><button disabled={busy} className="button button-accent">{busy ? <><BusyMark /> Saving…</> : <>Continue <ArrowRight /></>}</button></footer>
      </form>}
      {step === 3 && entity && <div className="entity-onboarding-form onboarding-integrations"><PluginManager entity={entity} canManage onError={setError} onboarding onContinue={() => onCreated(entity.id)} />{error && <div className="inline-error">{error}</div>}<button className="text-button" onClick={() => onCreated(entity.id)}>Skip integrations for now</button></div>}
    </main>
  );
}

function Dashboard({
  agreements,
  counts,
  onOpen,
  onCreate,
}: {
  agreements: Agreement[];
  counts: Record<string, number>;
  onOpen: (agreement: Agreement) => void;
  onCreate: () => void;
}) {
  const attention = agreements.filter(
    (agreement) => ownerNextAction(agreement).actionable,
  );
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="bc-eyebrow bc-text-orange">// OVERVIEW</span>
          <h1>Agreements in motion.</h1>
          <p>Everything that needs review, resolution, or signature.</p>
        </div>
        <button className="button button-secondary" onClick={onCreate}>
          Create agreement <ArrowRight />
        </button>
      </div>
      <section className="metric-grid">
        <Metric
          label="Active"
          value={counts.active ?? 0}
          icon={<FileClock />}
        />
        <Metric
          label="In review"
          value={counts.review ?? 0}
          icon={<FilePenLine />}
        />
        <Metric
          label="Signing"
          value={counts.signing ?? 0}
          icon={<ShieldCheck />}
        />
        <Metric
          label="Executed"
          value={counts.executed ?? 0}
          icon={<FileCheck2 />}
        />
      </section>
      {attention.length > 0 && (
        <section className="section-block">
          <div className="section-title">
            <div>
              <span className="bc-eyebrow bc-text-orange">
                // NEEDS YOUR ATTENTION
              </span>
              <h2>Your next actions</h2>
            </div>
            <b className="attention-count">
              {String(attention.length).padStart(2, "0")}
            </b>
          </div>
          <div className="attention-grid">
            {attention.map((agreement) => {
              const next = ownerNextAction(agreement);
              return (
                <button key={agreement.id} onClick={() => onOpen(agreement)}>
                  <span>{next.label}</span>
                  <strong>{agreement.title}</strong>
                  <p>{next.body}</p>
                  <ArrowRight />
                </button>
              );
            })}
          </div>
        </section>
      )}
      <section className="section-block">
        <div className="section-title">
          <div>
            <span className="bc-eyebrow">// RECENT</span>
            <h2>Latest agreements</h2>
          </div>
        </div>
        {agreements.length ? (
          <AgreementTable agreements={agreements.slice(0, 6)} onOpen={onOpen} />
        ) : (
          <EmptyState onCreate={onCreate} />
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <article className="metric">
      <div className="metric-icon">{icon}</div>
      <strong>{String(value).padStart(2, "0")}</strong>
      <span>{label}</span>
    </article>
  );
}

function AgreementList({
  agreements,
  onOpen,
}: {
  agreements: Agreement[];
  onOpen: (agreement: Agreement) => void;
}) {
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="bc-eyebrow bc-text-blue">// REPOSITORY</span>
          <h1>Agreements</h1>
          <p>The current record of every negotiation and execution.</p>
        </div>
      </div>
      <AgreementTable agreements={agreements} onOpen={onOpen} />
    </div>
  );
}

function latestTemplates(templates: Template[]): Template[] {
  return [...templates]
    .sort(
      (left, right) =>
        right.version - left.version ||
        right.createdAt.localeCompare(left.createdAt),
    )
    .filter(
      (template, index, items) =>
        items.findIndex((item) => item.key === template.key) === index,
    );
}

const templateVariables = [
  "{{sender.legal_name}}",
  "{{sender.business_address}}",
  "{{counterparty.legal_name}}",
  "{{counterparty.business_address}}",
  "{{signature_blocks}}",
] as const;

function TemplateWorkspace({
  templates,
  entityName,
  canWrite,
  onCreated,
  onError,
}: {
  templates: Template[];
  entityName: string;
  canWrite: boolean;
  onCreated: (template: Template) => void;
  onError: (message: string) => void;
}) {
  const latest = latestTemplates(templates);
  const [selectedKey, setSelectedKey] = useState(latest[0]?.key);
  const [editor, setEditor] = useState<{ base?: Template }>();
  const selected = latest.find((item) => item.key === selectedKey) ?? latest[0];
  const versions = selected
    ? templates
        .filter((item) => item.key === selected.key)
        .sort((left, right) => right.version - left.version)
    : [];
  return (
    <div className="page template-page">
      <div className="page-heading">
        <div>
          <span className="bc-eyebrow bc-text-orange">
            // {entityName.toUpperCase()} · TEMPLATES
          </span>
          <h1>Reusable agreements.</h1>
          <p>
            Templates belong only to the customer entity you’re acting for.
            Published versions remain immutable so existing agreements never
            change underneath their participants.
          </p>
        </div>
        {canWrite && (
          <button
            className="button button-accent"
            onClick={() => setEditor({})}
          >
            <Plus /> New template
          </button>
        )}
      </div>
      {latest.length === 0 ? (
        <div className="work-empty">
          <BookOpen />
          <p>No templates exist for {entityName}.</p>
          {canWrite && (
            <button
              className="button button-accent"
              onClick={() => setEditor({})}
            >
              Create the first template
            </button>
          )}
        </div>
      ) : (
        <div className="template-workspace">
          <aside className="template-library">
            <header>
              <span className="bc-eyebrow">// LIBRARY</span>
              <b>{String(latest.length).padStart(2, "0")}</b>
            </header>
            {latest.map((template) => (
              <button
                key={template.key}
                className={selected?.key === template.key ? "active" : ""}
                onClick={() => setSelectedKey(template.key)}
              >
                <BookOpen />
                <span>
                  <strong>{template.name}</strong>
                  <small>
                    {template.key} · latest v{template.version}
                  </small>
                </span>
              </button>
            ))}
          </aside>
          {selected && (
            <section className="template-detail">
              <header>
                <div>
                  <span className="bc-eyebrow bc-text-blue">
                    // ACTIVE VERSION
                  </span>
                  <h2>{selected.name}</h2>
                  <p>{selected.description || "No description provided."}</p>
                </div>
                {canWrite && (
                  <button
                    className="button button-secondary"
                    onClick={() => setEditor({ base: selected })}
                  >
                    Edit as new version <History />
                  </button>
                )}
              </header>
              <div className="template-meta">
                <span>
                  Key <b>{selected.key}</b>
                </span>
                <span>
                  Version <b>{selected.version}</b>
                </span>
                <span>
                  Published{" "}
                  <b>{new Date(selected.createdAt).toLocaleDateString()}</b>
                </span>
              </div>
              <TemplatePreview content={selected.content} />
              <div className="template-history">
                <span className="bc-eyebrow">// VERSION HISTORY</span>
                {versions.map((version) => (
                  <div key={version.id}>
                    <span>v{version.version}</span>
                    <p>{version.name}</p>
                    <time>{new Date(version.createdAt).toLocaleString()}</time>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      {editor && (
        <TemplateEditorModal
          entityName={entityName}
          {...(editor.base ? { base: editor.base } : {})}
          existingKeys={latest.map((item) => item.key)}
          onClose={() => setEditor(undefined)}
          onSave={async (input) => {
            try {
              const created = await api.createTemplate(input);
              onCreated(created);
              setSelectedKey(created.key);
              setEditor(undefined);
            } catch (cause) {
              onError(
                cause instanceof Error
                  ? cause.message
                  : "Could not publish the template.",
              );
              throw cause;
            }
          }}
        />
      )}
    </div>
  );
}

function TemplatePreview({ content }: { content: string }) {
  const parts = content.split(/(\{\{[a-z0-9_.]+\}\})/g);
  return (
    <article className="template-preview">
      <span className="bc-eyebrow">// DOCUMENT PREVIEW</span>
      <div>
        {parts.map((part, index) =>
          part === "{{signature_blocks}}" ? (
            <section className="template-signature-placeholder" key={index}>
              <span>Signature blocks</span>
              <div>
                <i />
                <i />
              </div>
            </section>
          ) : /^\{\{.+\}\}$/.test(part) ? (
            <mark key={index}>{part}</mark>
          ) : (
            <span key={index}>{part}</span>
          ),
        )}
      </div>
    </article>
  );
}

function TemplateEditorModal({
  base,
  entityName,
  existingKeys,
  onClose,
  onSave,
}: {
  base?: Template;
  entityName: string;
  existingKeys: string[];
  onClose: () => void;
  onSave: (input: CreateTemplate) => Promise<void>;
}) {
  const starter = `AGREEMENT\n\nThis agreement is made between {{sender.legal_name}} and {{counterparty.legal_name}}.\n\n1. Terms\nAdd the operative terms here.\n\n{{signature_blocks}}`;
  const [name, setName] = useState(base?.name ?? "");
  const [key, setKey] = useState(base?.key ?? "");
  const [description, setDescription] = useState(base?.description ?? "");
  const [content, setContent] = useState(base?.content ?? starter);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const textArea = useRef<HTMLTextAreaElement>(null);
  const suggestedKey = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  function insertVariable(variable: string) {
    const field = textArea.current;
    if (!field) {
      setContent((value) => `${value}${variable}`);
      return;
    }
    const start = field.selectionStart;
    const end = field.selectionEnd;
    setContent(
      (value) => `${value.slice(0, start)}${variable}${value.slice(end)}`,
    );
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + variable.length, start + variable.length);
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setBusy(true);
      setError(undefined);
      await onSave({ key, name, description, content });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not publish the template.",
      );
    } finally {
      setBusy(false);
    }
  }
  const createsExistingVersion = !base && existingKeys.includes(key);
  return (
    <Dialog
      labelledBy="template-editor-title"
      onClose={onClose}
      busy={busy}
      overlayClassName="modal-backdrop template-editor-backdrop"
      className="modal template-editor-modal"
    >
      <header>
        <div>
          <span className="bc-eyebrow bc-text-orange">
            // {entityName.toUpperCase()}
          </span>
          <h2 id="template-editor-title">
            {base
              ? `Create ${base.name} v${base.version + 1}`
              : "Create a template"}
          </h2>
        </div>
        <IconButton
          disabled={busy}
          label="Close template editor"
          onClick={onClose}
        >
          <X />
        </IconButton>
      </header>
      <form onSubmit={(event) => void submit(event)}>
        <div className="template-editor-fields">
          <div className="form-split">
            <label>
              Template name
              <input
                required
                value={name}
                onChange={(event) => {
                  const previous = suggestedKey(name);
                  setName(event.target.value);
                  if (!base && (!key || key === previous))
                    setKey(suggestedKey(event.target.value));
                }}
                placeholder="Mutual NDA"
              />
            </label>
            <label>
              Template key
              <input
                required
                disabled={Boolean(base)}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                value={key}
                onChange={(event) => setKey(event.target.value.toLowerCase())}
                placeholder="mutual-nda"
              />
            </label>
          </div>
          <label>
            Description
            <textarea
              maxLength={500}
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="When should this template be used?"
            />
          </label>
          {createsExistingVersion && (
            <div className="template-version-note">
              <History /> This key already exists. Publishing will create its
              next immutable version.
            </div>
          )}
        </div>
        <div className="template-editor-grid">
          <section>
            <div className="template-editor-toolbar">
              <span>
                <Braces /> Insert variable
              </span>
              {templateVariables.map((variable) => (
                <button
                  type="button"
                  key={variable}
                  onClick={() => insertVariable(variable)}
                >
                  {variable.replace(/[{}]/g, "")}
                </button>
              ))}
            </div>
            <label>
              Document content
              <textarea
                ref={textArea}
                required
                value={content}
                onChange={(event) => setContent(event.target.value)}
                spellCheck
                rows={28}
              />
            </label>
            {!content.includes("{{signature_blocks}}") && (
              <div className="template-warning">
                This template has no signature block placeholder. Signatures can
                still be collected, but they will not appear inside the
                document.
              </div>
            )}
          </section>
          <TemplatePreview content={content} />
        </div>
        {error && <div className="inline-error">{error}</div>}
        <footer>
          <button
            type="button"
            disabled={busy}
            className="button button-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button disabled={busy} className="button button-accent">
            {busy ? (
              <>
                <BusyMark /> Publishing…
              </>
            ) : (
              <>
                <Save />{" "}
                {base || createsExistingVersion
                  ? "Publish new version"
                  : "Publish template"}
              </>
            )}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function AgreementTable({
  agreements,
  onOpen,
}: {
  agreements: Agreement[];
  onOpen: (agreement: Agreement) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Agreement</th>
            <th>Status</th>
            <th>Participants</th>
            <th>Revision</th>
            <th>Updated</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {agreements.map((agreement) => (
            <tr key={agreement.id} onClick={() => onOpen(agreement)}>
              <td>
                <strong>{agreement.title}</strong>
                <span>
                  {agreement.templateKey} · v{agreement.templateVersion}
                </span>
              </td>
              <td>
                <StatusBadge status={agreement.status} />
              </td>
              <td>{agreement.participants.length}</td>
              <td className="mono">
                R{String(agreement.revision).padStart(2, "0")}
              </td>
              <td>{new Date(agreement.updatedAt).toLocaleDateString()}</td>
              <td>
                <ChevronRight />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: Agreement["status"] }) {
  const tone =
    status === "executed"
      ? "success"
      : status.includes("signature") || status === "partially_signed"
        ? "blue"
        : status === "in_review"
          ? "orange"
          : "neutral";
  return (
    <span className={`status-badge ${tone}`}>
      <i />
      {statusLabel(status)}
    </span>
  );
}

function counterpartySignaturesComplete(agreement: Agreement) {
  return agreement.parties.every(
    (party) =>
      agreement.participants.filter(
        (participant) =>
          participant.partyId === party.id &&
          participant.role === "signatory" &&
          participant.status === "signed",
      ).length >= party.minimumSignatures,
  );
}
function ownerNextAction(agreement: Agreement): {
  actionable: boolean;
  label: string;
  body: string;
} {
  const owner = agreement.participants.find(
    (participant) => participant.id === agreement.createdByParticipantId,
  );
  if (
    ["out_for_signature", "partially_signed"].includes(agreement.status) &&
    owner?.status !== "signed"
  )
    return {
      actionable: true,
      label: "Sign agreement",
      body: "Your signature is required. Sign now while the other signatures are collected.",
    };
  if (
    agreement.status === "in_review" &&
    agreement.reviewAssignedTo === "sender"
  ) {
    const open =
      agreement.suggestions.filter((item) => item.status === "open").length +
      agreement.documentComments.filter((item) => item.status === "open")
        .length;
    return open
      ? {
          actionable: true,
          label: "Review returned changes",
          body: `${open} item${open === 1 ? "" : "s"} need your decision.`,
        }
      : {
          actionable: true,
          label: "Advance the agreement",
          body: "Review is back with you and ready for its next step.",
        };
  }
  if (agreement.status === "draft")
    return {
      actionable: true,
      label: "Invite the counterparty",
      body: "Send the agreement to begin review.",
    };
  return {
    actionable: false,
    label: "Waiting",
    body: "No action is currently required from you.",
  };
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty">
      <FilePlus2 />
      <h3>No agreements yet</h3>
      <p>Create one from a versioned template to start the workflow.</p>
      <button className="button button-accent" onClick={onCreate}>
        Create agreement <ArrowRight />
      </button>
    </div>
  );
}

function AgreementDetail({
  agreement,
  user,
  onBack,
  onUpdate,
  onError,
}: {
  agreement: Agreement;
  user: User;
  onBack: () => void;
  onUpdate: (agreement: Agreement) => void;
  onError: (message: string) => void;
}) {
  const [selection, setSelection] = useState<TextSelection>();
  const [replacementText, setReplacementText] = useState("");
  const [comment, setComment] = useState("");
  const [documentComment, setDocumentComment] = useState("");
  const [activeRedline, setActiveRedline] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [signing, setSigning] = useState(false);
  const [finishingReview, setFinishingReview] = useState(false);
  const [draftState, setDraftState] = useState<DraftSaveState>("saved");
  async function mutate(action: () => Promise<Agreement>, label: string) {
    try {
      setBusy(label);
      onUpdate(await action());
      return true;
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Action failed.");
      return false;
    } finally {
      setBusy(undefined);
    }
  }
  async function downloadCompletion() {
    try {
      setBusy("download");
      const artifacts = await api.agreementArtifacts(agreement.id);
      const document = artifacts.find((item) => item.kind === "executed_pdf");
      if (!document) throw new Error("The sealed executed PDF is not available yet.");
      await api.downloadAgreementArtifact(agreement.id, document.id);
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Could not download the executed agreement.",
      );
    } finally {
      setBusy(undefined);
    }
  }
  async function suggest(event: FormEvent) {
    event.preventDefault();
    if (!selection) return;
    await mutate(
      () =>
        api.addSuggestion(agreement.id, {
          authorSubjectId: user.id,
          originalText: selection.text,
          replacementText,
          comment,
          anchor: { start: selection.start, end: selection.end },
        }),
      "redline",
    );
    setSelection(undefined);
    setReplacementText("");
    setComment("");
    window.getSelection()?.removeAllRanges();
  }
  const openSuggestions = agreement.suggestions.filter(
    (item) => item.status === "open",
  );
  const canEdit =
    agreement.status === "in_review" && agreement.reviewAssignedTo === "sender";
  const incomingOpenSuggestions = openSuggestions.filter(
    (item) => item.reviewRound < agreement.reviewRound,
  );
  const owner = agreement.participants.find(
    (participant) => participant.id === agreement.createdByParticipantId,
  );
  const ownerCanSign = Boolean(
    owner &&
    owner.status !== "signed" &&
    ["out_for_signature", "partially_signed"].includes(agreement.status),
  );
  const pendingInvitee = agreement.participants.find(
    (participant) =>
      participant.id !== agreement.createdByParticipantId &&
      participant.status === "not_invited",
  );
  const openReviewItems =
    openSuggestions.length +
    agreement.documentComments.filter((item) => item.status === "open").length;
  const nextBanner =
    ownerCanSign && owner ? (
      <NextActionBanner
        title="Your signature is required"
        body="The signing version is ready. You and the other required signatories may sign in any order."
        action={{
          label: "Sign agreement",
          onClick: () => setSigning(true),
          busy: busy === "sign",
        }}
      />
    ) : agreement.status === "draft" ? (
      <NextActionBanner
        title="Send this agreement for review"
        body="Invite the first counterparty representative. They’ll confirm their entity and review the document in a secure workspace."
        action={{
          label: pendingInvitee
            ? `Invite ${pendingInvitee.name}`
            : "Start review",
          onClick: () =>
            void mutate(
              pendingInvitee
                ? async () => {
                    await api.invite(agreement.id, pendingInvitee.id);
                    return api.agreement(agreement.id);
                  }
                : () => api.startReview(agreement.id),
              "next-action",
            ),
          busy: busy === "next-action",
        }}
      />
    ) : agreement.status === "in_review" &&
      agreement.reviewAssignedTo === "sender" ? (
      <NextActionBanner
        title={
          incomingOpenSuggestions.length
            ? `Decide ${incomingOpenSuggestions.length} returned redline${incomingOpenSuggestions.length === 1 ? "" : "s"}`
            : openReviewItems
              ? "Your response is ready"
              : "The document is ready to finish"
        }
        body={
          incomingOpenSuggestions.length
            ? "Accept or keep the original explicitly, or edit the clause directly to create a counterproposal."
            : openReviewItems
              ? "Your counterproposals and new redlines are saved. Send them when ready."
              : "You can sign now and request the remaining signatures, or request signatures and sign later."
        }
        action={
          openReviewItems
            ? {
                label: incomingOpenSuggestions.length
                  ? `Resolve ${incomingOpenSuggestions.length} redline${incomingOpenSuggestions.length === 1 ? "" : "s"}`
                  : draftState === "saved"
                    ? "Send changes"
                    : "Saving edits…",
                onClick: () =>
                  void mutate(() => api.sendReview(agreement.id), "review"),
                busy:
                  busy === "review" ||
                  draftState !== "saved" ||
                  incomingOpenSuggestions.length > 0,
              }
            : {
                label:
                  draftState === "saved" ? "Finish review" : "Saving edits…",
                onClick: () => setFinishingReview(true),
                busy: draftState !== "saved",
              }
        }
      />
    ) : ["out_for_signature", "partially_signed"].includes(agreement.status) ? (
      <NextActionBanner
        waiting
        title="Waiting for signatures"
        body={`${agreement.participants.filter((item) => item.role === "signatory" && item.status === "signed").length} of ${agreement.participants.filter((item) => item.role === "signatory" && item.required).length} required signatories have signed. Everyone may sign in any order.`}
      />
    ) : agreement.status === "in_review" ? (
      <NextActionBanner
        waiting
        title="Review is with the counterparty"
        body="Their draft work remains private until they send their review."
      />
    ) : agreement.status === "executed" ? (
      <NextActionBanner
        eyebrow="// COMPLETE"
        waiting
        title="Agreement executed"
        body={`Every required signature was collected on ${agreement.executedAt ? new Date(agreement.executedAt).toLocaleString() : "the final revision"}.`}
      />
    ) : null;
  return (
    <div className="detail-page">
      <div className="detail-bar">
        <button className="text-button" onClick={onBack}>
          ← Agreements
        </button>
        <div className="detail-actions">
          <StatusBadge status={agreement.status} />
          {agreement.status === "executed" && (
            <button
              disabled={Boolean(busy)}
              className="button button-secondary button-small"
              onClick={() => void downloadCompletion()}
            >
              {busy === "download" ? (
                <>
                  <BusyMark /> Preparing…
                </>
              ) : (
                <>
                  <Download /> Download sealed PDF
                </>
              )}
            </button>
          )}
          {agreement.status === 'executed' && agreement.verificationCode && <a className="button button-secondary button-small" href={`/verify/${agreement.verificationCode}`} target="_blank" rel="noreferrer"><ShieldCheck /> Verify</a>}
          {agreement.status === "draft" && (
            <button
              disabled={Boolean(busy)}
              className="button button-secondary button-small"
              onClick={() =>
                void mutate(() => api.startReview(agreement.id), "review")
              }
            >
              {busy === "review" ? (
                <>
                  <BusyMark /> Sending…
                </>
              ) : (
                "Start review"
              )}
            </button>
          )}
          {agreement.status === "in_review" &&
            agreement.reviewAssignedTo === "sender" && (
              <button
                disabled={Boolean(busy) || incomingOpenSuggestions.length > 0}
                className={`button ${openReviewItems ? "button-secondary" : "button-accent"} button-small`}
                onClick={() =>
                  openReviewItems
                    ? void mutate(() => api.sendReview(agreement.id), "review")
                    : setFinishingReview(true)
                }
              >
                {busy === "review" ? (
                  <>
                    <BusyMark /> Sending…
                  </>
                ) : incomingOpenSuggestions.length ? (
                  `Resolve ${incomingOpenSuggestions.length}`
                ) : openReviewItems ? (
                  "Send changes"
                ) : (
                  "Finish review"
                )}
              </button>
            )}
          {["out_for_signature", "partially_signed"].includes(
            agreement.status,
          ) &&
            !agreement.signatureNotificationsSentAt && (
              <button
                disabled={Boolean(busy)}
                className="button button-secondary button-small"
                onClick={() =>
                  void mutate(
                    () => api.sendForSignature(agreement.id),
                    "signature",
                  )
                }
              >
                {busy === "signature" ? (
                  <>
                    <BusyMark /> Sending…
                  </>
                ) : (
                  "Request signatures"
                )}
              </button>
            )}
          {ownerCanSign && (
            <button
              disabled={Boolean(busy)}
              className="button button-accent button-small"
              onClick={() => setSigning(true)}
            >
              Sign agreement
            </button>
          )}
        </div>
      </div>
      {nextBanner}
      <div className="contract-layout">
        <article className="document">
          <header>
            <span className="bc-eyebrow">
              // REVISION {String(agreement.revision).padStart(2, "0")}
            </span>
            <h1>{agreement.title}</h1>
            <div className="document-meta">
              <span>
                {agreement.templateKey} · v{agreement.templateVersion}
              </span>
              <span>SHA-256 · {agreement.contentSha256.slice(0, 12)}…</span>
            </div>
          </header>
          <div className="document-paper">
            {canEdit ? (
              <DirectContractEditor
                agreement={agreement}
                busy={busy === "draft"}
                activeRedlineId={activeRedline}
                onOpenRedline={setActiveRedline}
                onStateChange={setDraftState}
                onSave={(content) =>
                  mutate(
                    () => api.saveReviewDraft(agreement.id, content),
                    "draft",
                  )
                }
              />
            ) : (
              <SelectableContract
                agreement={agreement}
                onSelect={undefined}
                onOpenRedline={setActiveRedline}
              />
            )}
            {(agreement.content.includes(SIGNATURE_BLOCKS_PLACEHOLDER) ||
              agreement.templateKey === "mutual-nda") && (
              <SignatureBlocks agreement={agreement} />
            )}
          </div>
        </article>
        <aside className="review-panel">
          <div className="review-heading">
            <span className="bc-eyebrow bc-text-orange">// REVIEW</span>
            <strong>
              {openSuggestions.length} open redline
              {openSuggestions.length === 1 ? "" : "s"}
            </strong>
          </div>
          {agreement.status === "in_review" && (
            <div className="review-turn">
              <div>
                <span>With {agreement.reviewAssignedTo}</span>
                <p>
                  {canEdit
                    ? "Edit directly in the document. Your saved redlines stay private until you send changes."
                    : "Waiting for the counterparty to send their review."}
                </p>
              </div>
            </div>
          )}
          <div className="redline-list">
            {agreement.suggestions.map((suggestion) => {
              const isDraftOwner =
                canEdit &&
                suggestion.status === "open" &&
                suggestion.reviewRound === agreement.reviewRound &&
                suggestion.authorSubjectId === user.id;
              const isIncoming =
                canEdit &&
                suggestion.status === "open" &&
                suggestion.reviewRound < agreement.reviewRound;
              return (
                <RedlineCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  active={activeRedline === suggestion.id}
                  busy={Boolean(busy)}
                  canReply={canEdit}
                  canEdit={isDraftOwner}
                  canResolve={isIncoming}
                  onSelect={() => setActiveRedline(suggestion.id)}
                  onReply={(body) =>
                    void mutate(
                      () =>
                        api.replySuggestion(agreement.id, suggestion.id, body),
                      `reply-${suggestion.id}`,
                    )
                  }
                  onEdit={(nextReplacement, nextComment) =>
                    void mutate(
                      () =>
                        api.updateSuggestion(agreement.id, suggestion.id, {
                          replacementText: nextReplacement,
                          comment: nextComment,
                        }),
                      `edit-${suggestion.id}`,
                    )
                  }
                  onRemove={() =>
                    void mutate(
                      () => api.removeSuggestion(agreement.id, suggestion.id),
                      `remove-${suggestion.id}`,
                    )
                  }
                  onResolve={(resolution) =>
                    void mutate(
                      () =>
                        api.resolveSuggestion(
                          agreement.id,
                          suggestion.id,
                          resolution,
                        ),
                      `resolve-${suggestion.id}`,
                    )
                  }
                />
              );
            })}
          </div>
          <div className="document-comments">
            <span className="bc-eyebrow">// GENERAL FEEDBACK</span>
            {agreement.documentComments.map((item) => {
              const isDraftOwner =
                canEdit &&
                item.status === "open" &&
                item.reviewRound === agreement.reviewRound &&
                item.authorId === user.id;
              return (
                <DocumentCommentCard
                  key={item.id}
                  item={item}
                  busy={Boolean(busy)}
                  canEdit={isDraftOwner}
                  canResolve={
                    canEdit && item.status === "open" && !isDraftOwner
                  }
                  onEdit={(body) =>
                    void mutate(
                      () =>
                        api.updateDocumentComment(agreement.id, item.id, body),
                      `edit-comment-${item.id}`,
                    )
                  }
                  onRemove={() =>
                    void mutate(
                      () => api.removeDocumentComment(agreement.id, item.id),
                      `remove-comment-${item.id}`,
                    )
                  }
                  onResolve={() =>
                    void mutate(
                      () => api.resolveDocumentComment(agreement.id, item.id),
                      `comment-${item.id}`,
                    )
                  }
                />
              );
            })}
            {canEdit && (
              <form
                className="thread-reply-wrap"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!documentComment.trim()) return;
                  void mutate(
                    () =>
                      api.addDocumentComment(
                        agreement.id,
                        documentComment.trim(),
                      ),
                    "document-comment",
                  ).then((saved) => {
                    if (saved) setDocumentComment("");
                  });
                }}
              >
                <div className="thread-reply">
                  <FilePenLine />
                  <input
                    value={documentComment}
                    onChange={(event) => setDocumentComment(event.target.value)}
                    placeholder="Comment on the document overall…"
                  />
                  <button disabled={Boolean(busy)}>
                    {busy === "document-comment" ? <BusyMark /> : "Add"}
                  </button>
                </div>
              </form>
            )}
          </div>
          <div className="signatories">
            <span className="bc-eyebrow">// PARTIES & PARTICIPANTS</span>
            {agreement.parties.map((party) => (
              <div className="party-row" key={party.id}>
                <strong>
                  {party.entity.legalName ?? "Counterparty details pending"}
                </strong>
                {party.entity.businessAddress && (
                  <address>{party.entity.businessAddress}</address>
                )}
                <span>
                  {party.role} · {party.minimumSignatures} signature
                  {party.minimumSignatures === 1 ? "" : "s"} required ·{" "}
                  {party.entity.verificationStatus.replace("_", " ")}
                </span>
                {party.entity.proposedDetails && (
                  <span>
                    Proposed: {party.entity.proposedDetails.legalName}
                    {party.entity.proposedDetails.businessAddress
                      ? ` · ${party.entity.proposedDetails.businessAddress}`
                      : ""}
                    {party.entity.proposedDetails.registrationNumber
                      ? ` · ${party.entity.proposedDetails.registrationNumber}`
                      : ""}
                    {party.entity.proposedDetails.jurisdiction
                      ? ` · ${party.entity.proposedDetails.jurisdiction}`
                      : ""}
                  </span>
                )}
                {party.entity.verificationStatus === "change_pending" && (
                  <button
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void mutate(
                        () => api.acceptEntity(agreement.id, party.id),
                        `entity-${party.id}`,
                      )
                    }
                  >
                    {busy === `entity-${party.id}` ? (
                      <>
                        <BusyMark /> Accepting…
                      </>
                    ) : (
                      "Accept proposed details"
                    )}
                  </button>
                )}
              </div>
            ))}
            {agreement.participants.map((participant) => (
              <div className="signatory" key={participant.id}>
                <div>
                  <strong>{participant.name}</strong>
                  <span>
                    {participant.email} · {participant.role} ·{" "}
                    {participant.status.replace("_", " ")}
                  </span>
                </div>
                {participant.status === "signed" ? (
                  <span className="signed">
                    <Check /> Signed
                  </span>
                ) : ["draft", "in_review"].includes(agreement.status) &&
                  participant.id !== agreement.createdByParticipantId &&
                  ["not_invited", "invited"].includes(participant.status) ? (
                  <button
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void mutate(async () => {
                        await api.invite(agreement.id, participant.id);
                        return api.agreement(agreement.id);
                      }, `invite-${participant.id}`)
                    }
                  >
                    {busy === `invite-${participant.id}` ? (
                      <>
                        <BusyMark />{" "}
                        {participant.status === "invited"
                          ? "Resending…"
                          : "Sending…"}
                      </>
                    ) : participant.status === "invited" ? (
                      "Resend invite"
                    ) : (
                      "Send invite"
                    )}
                  </button>
                ) : ownerCanSign &&
                  participant.id === agreement.createdByParticipantId ? (
                  <button
                    disabled={Boolean(busy)}
                    onClick={() => setSigning(true)}
                  >
                    Sign
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </aside>
      </div>
      {finishingReview && (
        <FinishReviewDialog
          busy={Boolean(busy)}
          onClose={() => setFinishingReview(false)}
          onRequest={() =>
            void mutate(
              () => api.sendForSignature(agreement.id),
              "signature",
            ).then((ok) => {
              if (ok) setFinishingReview(false);
            })
          }
          onSign={() =>
            void mutate(
              () => api.prepareForSignature(agreement.id),
              "signature",
            ).then((ok) => {
              if (ok) {
                setFinishingReview(false);
                setSigning(true);
              }
            })
          }
        />
      )}
      {signing && owner && (
        <SignatureCeremony
          agreement={agreement}
          signer={owner}
          busy={busy === "sign"}
          onClose={() => setSigning(false)}
          onDownload={() => void api.downloadSigningPdf(agreement.id).catch((cause) => onError(cause instanceof Error ? cause.message : 'Could not download the frozen PDF.'))}
          onSign={(signature) =>
            void mutate(
              () => api.sign(agreement.id, owner.id, signature),
              "sign",
            ).then((signed) => {
              if (signed) setSigning(false);
            })
          }
        />
      )}
    </div>
  );
}

function FinishReviewDialog({
  busy,
  onClose,
  onRequest,
  onSign,
}: {
  busy: boolean;
  onClose: () => void;
  onRequest: () => void;
  onSign: () => void;
}) {
  return (
    <Dialog
      labelledBy="finish-review-title"
      onClose={onClose}
      busy={busy}
      className="modal finish-review"
    >
      <header>
        <div>
          <span className="bc-eyebrow bc-text-orange">// FINISH REVIEW</span>
          <h2 id="finish-review-title">The final revision is ready.</h2>
        </div>
        <IconButton
          disabled={busy}
          label="Close review options"
          onClick={onClose}
        >
          <X />
        </IconButton>
      </header>
      <div className="finish-review-options">
        <button disabled={busy} onClick={onSign}>
          <ShieldCheck />
          <span>
            <strong>Sign & request signatures</strong>
            <small>
              Add your signature now, then notify every remaining signatory.
            </small>
          </span>
          <ArrowRight />
        </button>
        <button disabled={busy} onClick={onRequest}>
          <FileCheck2 />
          <span>
            <strong>Request signatures</strong>
            <small>
              Open signing for everyone and add your own signature later.
            </small>
          </span>
          <ArrowRight />
        </button>
      </div>
      {busy && (
        <div className="finish-review-busy">
          <BusyMark /> Preparing the signing version…
        </div>
      )}
    </Dialog>
  );
}

function CreateAgreementModal({
  templates,
  onClose,
  onCreated,
  onError,
}: {
  templates: Template[];
  onClose: () => void;
  onCreated: (agreement: Agreement) => void;
  onError: (message: string) => void;
}) {
  type Invitee = {
    id: string;
    name: string;
    email: string;
    role: "reviewer" | "signatory";
  };
  const [title, setTitle] = useState("");
  const [templateKey, setTemplateKey] = useState(templates[0]?.key ?? "");
  const [externalId, setExternalId] = useState("");
  const [busy, setBusy] = useState(false);
  const [entityName, setEntityName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [registration, setRegistration] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [invitees, setInvitees] = useState<Invitee[]>([
    { id: crypto.randomUUID(), name: "", email: "", role: "signatory" },
  ]);
  const [minimumSignatures, setMinimumSignatures] = useState(1);
  const selectedTemplate = templates.find((template) => template.key === templateKey);
  const counterpartyAddressRequired = requiredEntityFieldsForTemplate(selectedTemplate?.content ?? "", "counterparty").includes("businessAddress");
  const updateInvitee = (id: string, patch: Partial<Invitee>) =>
    setInvitees((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setBusy(true);
      const signerCount = invitees.filter(
        (item) => item.role === "signatory",
      ).length;
      if (minimumSignatures > signerCount)
        throw new Error(
          "Required signatures cannot exceed the number of signatories.",
        );
      const input: CreateAgreement = {
        title,
        templateKey,
        participants: [],
        parties: [
          {
            role: "counterparty",
            entity: {
              ...(entityName ? { legalName: entityName } : {}),
              ...(businessAddress ? { businessAddress } : {}),
              ...(registration ? { registrationNumber: registration } : {}),
              ...(jurisdiction ? { jurisdiction } : {}),
            },
            minimumSignatures,
            participants: invitees.map(({ id: _, name, ...person }) => ({
              ...person,
              ...(name ? { name } : {}),
              required: person.role === "signatory",
              permissions:
                person.role === "signatory"
                  ? ["read", "comment", "suggest", "sign", "nominate_signatory"]
                  : ["read", "comment", "suggest", "nominate_signatory"],
            })),
          },
        ],
        metadata: {},
        ...(externalId ? { externalId } : {}),
      };
      onCreated(await api.createAgreement(input));
    } catch (cause) {
      onError(
        cause instanceof Error ? cause.message : "Could not create agreement.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog labelledBy="create-heading" onClose={onClose} busy={busy}>
      <header>
        <div>
          <span className="bc-eyebrow bc-text-orange">// NEW WORKFLOW</span>
          <h2 id="create-heading">Create agreement</h2>
        </div>
        <IconButton
          disabled={busy}
          label="Close agreement form"
          onClick={onClose}
        >
          <X />
        </IconButton>
      </header>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Agreement title
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Acme mutual NDA"
          />
        </label>
        <label>
          Template
          <select
            required
            value={templateKey}
            onChange={(event) => setTemplateKey(event.target.value)}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.key}>
                {template.name} · v{template.version}
              </option>
            ))}
          </select>
        </label>
        <label>
          Internal reference
          <input
            value={externalId}
            onChange={(event) => setExternalId(event.target.value)}
            placeholder="deal_123 (optional)"
          />
        </label>
        <div className="form-divider">
          <span className="bc-eyebrow">
            // EXPECTED COUNTERPARTY (OPTIONAL)
          </span>
        </div>
        <label>
          Legal entity name
          <input
            value={entityName}
            onChange={(event) => setEntityName(event.target.value)}
            placeholder="Let the counterparty provide this"
          />
          <small>
            The recipient confirms their legal entity during onboarding.
            Material changes to prefilled details require your approval.
          </small>
        </label>
        <label>
          Business address
          <textarea
            value={businessAddress}
            onChange={(event) => setBusinessAddress(event.target.value)}
            placeholder={counterpartyAddressRequired ? "Prefill now or let the recipient provide it" : "Street, city, postal code, country (optional)"}
            rows={3}
          />
          {counterpartyAddressRequired && <small>This template includes the counterparty address. You may prefill it now; otherwise the recipient must provide it during onboarding.</small>}
        </label>
        <div className="form-split">
          <label>
            Registration number
            <input
              value={registration}
              onChange={(event) => setRegistration(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label>
            Jurisdiction
            <input
              value={jurisdiction}
              onChange={(event) => setJurisdiction(event.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>
        <div className="form-divider">
          <span className="bc-eyebrow">// PARTICIPANTS</span>
        </div>
        {invitees.map((invitee, index) => (
          <div className="participant-editor" key={invitee.id}>
            <div className="form-split">
              <label>
                Name
                <input
                  value={invitee.name}
                  onChange={(event) =>
                    updateInvitee(invitee.id, { name: event.target.value })
                  }
                  placeholder="Optional"
                />
              </label>
              <label>
                Email
                <input
                  required
                  type="email"
                  value={invitee.email}
                  onChange={(event) =>
                    updateInvitee(invitee.id, { email: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="form-split">
              <label>
                Role
                <select
                  value={invitee.role}
                  onChange={(event) =>
                    updateInvitee(invitee.id, {
                      role: event.target.value as Invitee["role"],
                    })
                  }
                >
                  <option value="signatory">Signatory</option>
                  <option value="reviewer">Reviewer</option>
                </select>
              </label>
              {invitees.length > 1 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setInvitees((items) =>
                      items.filter((item) => item.id !== invitee.id),
                    )
                  }
                >
                  Remove participant {index + 1}
                </button>
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={() =>
            setInvitees((items) => [
              ...items,
              {
                id: crypto.randomUUID(),
                name: "",
                email: "",
                role: "reviewer",
              },
            ])
          }
        >
          <Plus /> Add participant
        </button>
        <label>
          Signatures required
          <input
            type="number"
            min="0"
            max={invitees.filter((item) => item.role === "signatory").length}
            value={minimumSignatures}
            onChange={(event) =>
              setMinimumSignatures(Number(event.target.value))
            }
          />
          <small>
            Any required number of this counterparty’s signatories may complete
            the entity’s signature requirement.
          </small>
        </label>
        <footer>
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            disabled={busy || templates.length === 0}
            className="button button-accent"
          >
            {busy ? (
              <>
                <BusyMark /> Creating…
              </>
            ) : (
              <>
                Create agreement <ArrowRight />
              </>
            )}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

const entityRoles: EntityRole[] = [
  "administrator",
  "template_manager",
  "contract_manager",
  "signatory",
  "viewer",
];
const entityRoleLabel = (role: EntityRole) => role.replace("_", " ");

function MembershipInvitationPage() {
  const token = new URLSearchParams(window.location.search).get("token");
  const [preview, setPreview] = useState<{
    entityName: string;
    emailHint: string;
    roles: EntityRole[];
    expiresAt: string;
  }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) {
      setError("The membership invitation token is missing.");
      return;
    }
    void api
      .previewEntityMemberInvitation(token)
      .then(setPreview)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "The invitation could not be opened.",
        ),
      );
  }, [token]);
  async function accept() {
    if (!token) return;
    try {
      setBusy(true);
      setError(undefined);
      const result = await api.acceptEntityMemberInvitation(token);
      api.selectEntity(result.entity.id);
      window.location.assign("/");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The invitation could not be accepted.",
      );
    } finally {
      setBusy(false);
    }
  }
  const returnTo = `${window.location.pathname}${window.location.search}`;
  return (
    <main className="membership-invitation">
      <section>
        <img src={logo} alt="" />
        <span className="bc-eyebrow bc-text-orange">
          // CUSTOMER ENTITY INVITATION
        </span>
        {preview ? (
          <>
            <h1>Join {preview.entityName}</h1>
            <p>
              This invitation grants{" "}
              <strong>{preview.roles.map(entityRoleLabel).join(", ")}</strong>{" "}
              access to the customer entity. Sign in as{" "}
              <strong>{preview.emailHint}</strong> to accept it.
            </p>
            <div className="membership-invite-actions">
              <button
                disabled={busy}
                className="button button-accent"
                onClick={() => void accept()}
              >
                {busy ? (
                  <>
                    <BusyMark /> Accepting…
                  </>
                ) : (
                  <>
                    Accept invitation <ArrowRight />
                  </>
                )}
              </button>
              <a
                className="button button-secondary"
                href={api.loginUrlFor(returnTo)}
              >
                Sign in with SSO
              </a>
            </div>
            <small>
              Expires {new Date(preview.expiresAt).toLocaleString()}
            </small>
          </>
        ) : !error ? (
          <div className="portal-loading">
            <BusyMark />
          </div>
        ) : null}
        {error && <div className="inline-error">{error}</div>}
        {error?.toLowerCase().includes("sign in") && (
          <a className="button button-accent" href={api.loginUrlFor(returnTo)}>
            Sign in with the invited email <ArrowRight />
          </a>
        )}
      </section>
    </main>
  );
}

function MemberSettings({
  user,
  onError,
}: {
  user: User;
  onError: (message: string) => void;
}) {
  const [data, setData] = useState<EntityMemberList>();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [inviteRoles, setInviteRoles] = useState<EntityRole[]>([
    "contract_manager",
  ]);
  const [busy, setBusy] = useState<string>();
  const entityName =
    user.entities.find((item) => item.entityId === user.activeEntityId)?.entity
      .legalName ?? "this entity";
  async function refreshMembers() {
    try {
      setLoading(true);
      setData(await api.entityMembers());
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Could not load entity members.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refreshMembers();
  }, [user.activeEntityId]);
  async function invite(event: FormEvent) {
    event.preventDefault();
    try {
      setBusy("invite");
      await api.inviteEntityMember({ email, roles: inviteRoles });
      setEmail("");
      await refreshMembers();
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Could not invite this person.",
      );
    } finally {
      setBusy(undefined);
    }
  }
  async function updateMember(id: string, roles: EntityRole[]) {
    try {
      setBusy(id);
      await api.updateEntityMember(id, roles);
      await refreshMembers();
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Could not update this member.",
      );
    } finally {
      setBusy(undefined);
    }
  }
  async function suspendMember(id: string) {
    if (
      !window.confirm(
        "Suspend this person’s access to the active customer entity? Their account and other entity memberships will remain active.",
      )
    )
      return;
    try {
      setBusy(`suspend-${id}`);
      await api.suspendEntityMember(id);
      await refreshMembers();
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Could not suspend this member.",
      );
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="bc-eyebrow bc-text-blue">
            // PEOPLE & PERMISSIONS
          </span>
          <h1>{entityName}</h1>
          <p>
            Manage who can create templates, run agreements, and sign for this
            customer entity.
          </p>
        </div>
      </div>
      <section className="member-admin-grid">
        <form
          className="member-invite-card"
          onSubmit={(event) => void invite(event)}
        >
          <UserPlus />
          <span className="bc-eyebrow bc-text-orange">// INVITE MEMBER</span>
          <h2>Add someone to this entity</h2>
          <label>
            Email address
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="colleague@example.com"
            />
          </label>
          <RolePicker roles={inviteRoles} onChange={setInviteRoles} />
          <button
            disabled={busy === "invite" || inviteRoles.length === 0}
            className="button button-accent"
          >
            {busy === "invite" ? (
              <>
                <BusyMark /> Sending…
              </>
            ) : (
              <>
                Send invitation <ArrowRight />
              </>
            )}
          </button>
        </form>
        <div className="member-list-card">
          <div className="section-title">
            <div>
              <span className="bc-eyebrow">// ACTIVE MEMBERS</span>
              <h2>Entity access</h2>
            </div>
            <b className="attention-count">
              {String(
                data?.members.filter(
                  (item) => item.membership.status === "active",
                ).length ?? 0,
              ).padStart(2, "0")}
            </b>
          </div>
          {loading && !data ? (
            <div className="member-loading">
              <BusyMark /> Loading members…
            </div>
          ) : (
            data?.members.map((item) => (
              <MemberRow
                key={item.membership.id}
                item={item}
                currentAccountId={user.id}
                busy={busy}
                onSave={updateMember}
                onSuspend={suspendMember}
              />
            ))
          )}
        </div>
      </section>
      {data?.invitations.some((item) => item.status === "pending") && (
        <section className="section-block pending-member-invites">
          <div className="section-title">
            <div>
              <span className="bc-eyebrow bc-text-orange">// PENDING</span>
              <h2>Membership invitations</h2>
            </div>
          </div>
          {data.invitations
            .filter((item) => item.status === "pending")
            .map((invitation) => (
              <div key={invitation.id}>
                <span>
                  <strong>{invitation.email}</strong>
                  <small>
                    {invitation.roles.map(entityRoleLabel).join(", ")} · expires{" "}
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </small>
                </span>
                <b>invited</b>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}

function MemberRow({
  item,
  currentAccountId,
  busy,
  onSave,
  onSuspend,
}: {
  item: EntityMemberList["members"][number];
  currentAccountId: string;
  busy: string | undefined;
  onSave: (id: string, roles: EntityRole[]) => void;
  onSuspend: (id: string) => void;
}) {
  const [roles, setRoles] = useState<EntityRole[]>(item.membership.roles);
  const changed =
    [...roles].sort().join() !== [...item.membership.roles].sort().join();
  return (
    <article className={`member-row ${item.membership.status}`}>
      <div className="member-identity">
        <CircleUserRound />
        <span>
          <strong>
            {item.account.displayName}
            {item.account.id === currentAccountId ? " · You" : ""}
          </strong>
          <small>
            {item.account.email} · {item.membership.status}
          </small>
        </span>
      </div>
      <RolePicker roles={roles} onChange={setRoles} compact />
      <div className="member-row-actions">
        {changed && (
          <button
            disabled={busy === item.membership.id || roles.length === 0}
            className="button button-accent button-small"
            onClick={() => onSave(item.membership.id, roles)}
          >
            {busy === item.membership.id ? <BusyMark /> : "Save roles"}
          </button>
        )}
        <button
          disabled={Boolean(busy) || item.membership.status === "suspended"}
          className="button button-secondary button-small"
          onClick={() => onSuspend(item.membership.id)}
        >
          {busy === `suspend-${item.membership.id}` ? (
            <>
              <BusyMark /> Suspending…
            </>
          ) : (
            "Suspend access"
          )}
        </button>
      </div>
    </article>
  );
}

function RolePicker({
  roles,
  onChange,
  compact = false,
}: {
  roles: EntityRole[];
  onChange: (roles: EntityRole[]) => void;
  compact?: boolean;
}) {
  return (
    <fieldset className={`role-picker ${compact ? "compact" : ""}`}>
      <legend>Roles</legend>
      {entityRoles.map((role) => (
        <label key={role}>
          <input
            type="checkbox"
            checked={roles.includes(role)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...roles, role]
                  : roles.filter((item) => item !== role),
              )
            }
          />
          <span>{entityRoleLabel(role)}</span>
        </label>
      ))}
    </fieldset>
  );
}

function CreateEntityModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (entityId: string) => void;
  onError: (message: string) => void;
}) {
  const [legalName, setLegalName] = useState("");
  const [slug, setSlug] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [busy, setBusy] = useState(false);
  const suggestedSlug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setBusy(true);
      const entity = await api.createEntity({
        legalName,
        slug,
        ...(businessAddress ? { businessAddress } : {}),
        ...(registrationNumber ? { registrationNumber } : {}),
        ...(jurisdiction ? { jurisdiction } : {}),
      });
      onCreated(entity.id);
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Could not create customer entity.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog labelledBy="create-entity-heading" onClose={onClose} busy={busy}>
      <header>
        <div>
          <span className="bc-eyebrow bc-text-orange">// CUSTOMER ENTITY</span>
          <h2 id="create-entity-heading">Add an entity you represent</h2>
        </div>
        <IconButton disabled={busy} label="Close entity form" onClick={onClose}>
          <X />
        </IconButton>
      </header>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Legal name
          <input
            required
            value={legalName}
            onChange={(event) => {
              const previousSuggestion = suggestedSlug(legalName);
              setLegalName(event.target.value);
              if (!slug || slug === previousSuggestion)
                setSlug(suggestedSlug(event.target.value));
            }}
            placeholder="Example ApS"
          />
        </label>
        <label>
          Entity identifier
          <input
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
            placeholder="example-aps"
          />
          <small>
            Used in URLs and API context. It cannot be changed in this version.
          </small>
        </label>
        <label>
          Business address
          <textarea
            value={businessAddress}
            onChange={(event) => setBusinessAddress(event.target.value)}
            rows={3}
          />
        </label>
        <div className="form-split">
          <label>
            Registration number
            <input
              value={registrationNumber}
              onChange={(event) => setRegistrationNumber(event.target.value)}
            />
          </label>
          <label>
            Jurisdiction
            <input
              value={jurisdiction}
              onChange={(event) => setJurisdiction(event.target.value)}
              placeholder="e.g. DK"
            />
          </label>
        </div>
        <footer>
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button disabled={busy} className="button button-accent">
            {busy ? (
              <>
                <BusyMark /> Adding…
              </>
            ) : (
              <>
                Add entity <ArrowRight />
              </>
            )}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function IntegrationSettings({ entity, canManage, onSaved, onError }: { entity: CustomerEntity; canManage: boolean; onSaved: (entity: CustomerEntity) => void; onError: (message: string) => void }) {
  const [branding, setBranding] = useState<EntityBranding>(entity.branding);
  const [busy, setBusy] = useState(false);
  const readImage = (file: File, field: "logoDataUrl" | "markDataUrl") => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { onError('Use a PNG, JPEG, or WebP brand image.'); return; }
    if (file.size > 300_000) { onError('Brand images must be smaller than 300 KB.'); return; }
    const reader = new FileReader();
    reader.onload = () => setBranding((value) => ({ ...value, [field]: String(reader.result) }));
    reader.readAsDataURL(file);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { onSaved(await api.updateEntityBranding(branding)); }
    catch (cause) { onError(cause instanceof Error ? cause.message : 'Could not save entity branding.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="bc-eyebrow bc-text-blue">// ENTITY SETTINGS</span>
          <h1>Identity here. Connections there.</h1>
          <p>
            OAuth2 clients create secure handoffs and evaluate contract
            conditions. External subjects stay scoped to their integration; the
            calling system decides what a satisfied condition enables.
          </p>
        </div>
      </div>
      <form className="branding-settings" onSubmit={(event) => void save(event)}>
        <div className="branding-preview" style={{ '--preview-primary': branding.primaryColor, '--preview-secondary': branding.secondaryColor } as CSSProperties}>
          <div className="branding-preview-logo"><img src={branding.logoDataUrl ?? logo} alt="Square logo preview" /></div>
          {branding.markDataUrl ? <img className="branding-preview-lockup" src={branding.markDataUrl} alt={`${branding.displayName ?? entity.legalName} logomark preview`} /> : <strong>{branding.displayName ?? entity.legalName}</strong>}
          <span>CONTRACTS</span>
        </div>
        <div className="branding-fields">
          <span className="bc-eyebrow bc-text-orange">// ENTITY BRANDING</span>
          <h2>Make the workspace recognisably yours.</h2>
          <p>Branding follows this customer entity into its workspace and participant-facing contract experience.</p>
          <label>Display name<input disabled={!canManage} value={branding.displayName ?? ''} onChange={(event) => setBranding((value) => ({ ...value, displayName: event.target.value || null }))} /></label>
          <div className="form-split">
            <label>Primary colour<input disabled={!canManage} type="color" value={branding.primaryColor} onChange={(event) => setBranding((value) => ({ ...value, primaryColor: event.target.value }))} /></label>
            <label>Secondary colour<input disabled={!canManage} type="color" value={branding.secondaryColor} onChange={(event) => setBranding((value) => ({ ...value, secondaryColor: event.target.value }))} /></label>
          </div>
          <div className="form-split">
            <label>Logo<input disabled={!canManage} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) readImage(file, 'logoDataUrl'); }} /><small>Square company symbol, up to 300 KB.</small></label>
            <label>Logomark<input disabled={!canManage} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) readImage(file, 'markDataUrl'); }} /><small>Horizontal logo with company name, up to 300 KB.</small></label>
          </div>
          {canManage && <button className="button button-accent" disabled={busy}>{busy ? <><BusyMark /> Saving…</> : <><Save /> Save branding</>}</button>}
        </div>
      </form>
      {canManage && <PluginManager entity={entity} canManage onError={onError} />}
      <div className="integration-grid">
        <article>
          <Webhook />
          <span className="bc-eyebrow">// CALLBACKS</span>
          <h3>Webhooks</h3>
          <p>
            Receive signed, idempotent events when agreements move through
            review and execution.
          </p>
          <code>agreement.executed</code>
        </article>
        <article>
          <ShieldCheck />
          <span className="bc-eyebrow">// SECURE HANDOFF</span>
          <h3>Host-mediated sessions</h3>
          <p>
            Your backend authenticates the visitor, creates a short-lived
            handoff, and redirects them to Contracts. No external ID is entered
            in the browser.
          </p>
          <code>POST /v1/integration-sessions</code>
        </article>
      </div>
      <div className="api-call">
        <div>
          <span className="method">POST</span>
          <code>/v1/conditions/evaluate</code>
        </div>
        <pre>{`{
  "integrationKey": "customer-portal",
  "subject": "user_01JXYZ",
  "operator": "all",
  "conditions": [{
    "kind": "agreement_executed",
    "templateKey": "mutual-nda",
    "minimumVersion": 1
  }]
}`}</pre>
      </div>
    </div>
  );
}

function PluginManager({ entity, canManage, onError, onboarding = false, onContinue }: { entity: CustomerEntity; canManage: boolean; onError: (message: string) => void; onboarding?: boolean; onContinue?: () => void }) {
  const [catalog, setCatalog] = useState<PluginManifest[]>([]); const [installations, setInstallations] = useState<PluginInstallation[]>([]); const [editing, setEditing] = useState<PluginManifest>(); const [values, setValues] = useState<Record<string, string>>({}); const [busy, setBusy] = useState<string>();
  const load = () => Promise.all([api.pluginCatalog(), api.pluginInstallations()]).then(([nextCatalog, nextInstallations]) => { setCatalog(nextCatalog); setInstallations(nextInstallations); }).catch((cause) => onError(cause instanceof Error ? cause.message : 'Could not load integrations.'));
  useEffect(() => { void load(); }, [entity.id]);
  const installationFor = (key: PluginManifest['key']) => installations.find((item) => item.pluginKey === key);
  const open = (manifest: PluginManifest) => { const installation = installationFor(manifest.key); const initial: Record<string, string> = {}; for (const field of manifest.fields) { const stored = installation?.configuration[field.key]; initial[field.key] = Array.isArray(stored) ? stored.join(', ') : typeof stored === 'string' ? stored : ''; } setValues(initial); setEditing(manifest); };
  const savePlugin = async (event: FormEvent) => { event.preventDefault(); if (!editing) return; setBusy(`save-${editing.key}`); try { const configuration: Record<string, unknown> = {}; for (const field of editing.fields) { if (field.secret && !values[field.key]) continue; configuration[field.key] = field.kind === 'string_list' ? values[field.key]?.split(',').map((item) => item.trim()).filter(Boolean) : values[field.key] ?? ''; } const saved = await api.configurePlugin(editing.key, configuration); setInstallations((items) => [...items.filter((item) => item.pluginKey !== saved.pluginKey), saved]); setEditing(undefined); } catch (cause) { onError(cause instanceof Error ? cause.message : 'Could not configure integration.'); } finally { setBusy(undefined); } };
  const test = async (key: PluginManifest['key']) => { setBusy(`test-${key}`); try { const result = await api.testPlugin(key); setInstallations((items) => [...items.filter((item) => item.pluginKey !== key), result]); } catch (cause) { onError(cause instanceof Error ? cause.message : 'Could not test integration.'); } finally { setBusy(undefined); } };
  const remove = async (key: PluginManifest['key']) => { if (!window.confirm('Disconnect this integration and remove its stored credentials?')) return; setBusy(`remove-${key}`); try { await api.removePlugin(key); setInstallations((items) => items.filter((item) => item.pluginKey !== key)); } catch (cause) { onError(cause instanceof Error ? cause.message : 'Could not disconnect integration.'); } finally { setBusy(undefined); } };
  return <section className={`plugin-manager ${onboarding ? 'onboarding' : ''}`}>
    <div className="plugin-manager-heading"><div><span className="bc-eyebrow bc-text-blue">// AVAILABLE INTEGRATIONS</span><h2>{onboarding ? 'Connect the tools your company uses.' : 'Installed per entity.'}</h2><p>ByteCrunch operators make trusted plugins available. Entity administrators control their configuration and credentials.</p></div>{onContinue && <button className="button button-accent" onClick={onContinue}>Finish setup <ArrowRight /></button>}</div>
    <div className="plugin-catalog">{catalog.map((manifest) => { const installation = installationFor(manifest.key); return <article key={manifest.key} className="plugin-card"><div className="plugin-icon">{manifest.key === 'google-drive' ? <Cloud /> : <ShieldCheck />}</div><span className={`plugin-status ${installation?.status ?? 'available'}`}>{installation?.status ?? 'available'}</span><h3>{manifest.name}</h3><p>{manifest.description}</p>{manifest.key === 'enterprise-oidc' && installation && <code>{api.entitySsoUrl(entity.slug)}</code>}<div className="plugin-actions"><button disabled={!canManage || Boolean(busy)} className="button button-secondary button-small" onClick={() => open(manifest)}>{installation ? 'Configure' : 'Set up'}</button>{installation && <button disabled={Boolean(busy)} className="button button-secondary button-small" onClick={() => void test(manifest.key)}>{busy === `test-${manifest.key}` ? <><BusyMark /> Testing…</> : 'Test connection'}</button>}{installation && <button disabled={Boolean(busy)} className="icon-button" aria-label={`Disconnect ${manifest.name}`} onClick={() => void remove(manifest.key)}>{busy === `remove-${manifest.key}` ? <BusyMark /> : <Trash2 />}</button>}</div>{installation?.lastError && <small className="plugin-error">{installation.lastError}</small>}</article>; })}</div>
    {editing && <Dialog labelledBy="plugin-config-heading" onClose={() => setEditing(undefined)} busy={Boolean(busy)}><header><div><span className="bc-eyebrow bc-text-orange">// {editing.capability.replaceAll('_', ' ')}</span><h2 id="plugin-config-heading">Configure {editing.name}</h2></div><IconButton label="Close integration form" onClick={() => setEditing(undefined)}><X /></IconButton></header><form onSubmit={(event) => void savePlugin(event)}>{editing.key === 'enterprise-oidc' && <div className="inline-note"><strong>Callback URL</strong><code>{new URL('/auth/entity-callback', api.entitySsoUrl(entity.slug)).toString()}</code></div>}{editing.fields.map((field) => <label key={field.key}>{field.label}{field.kind === 'textarea' ? <textarea required={field.required && !(field.secret && installationFor(editing.key)?.configuredSecretFields.includes(field.key))} rows={7} value={values[field.key] ?? ''} placeholder={field.secret && installationFor(editing.key) ? 'Configured — leave blank to keep it' : ''} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} /> : <input required={field.required && !(field.secret && installationFor(editing.key)?.configuredSecretFields.includes(field.key))} type={field.kind === 'password' ? 'password' : field.kind === 'email' ? 'email' : field.kind === 'url' ? 'url' : 'text'} value={values[field.key] ?? ''} placeholder={field.secret && installationFor(editing.key) ? 'Configured — leave blank to keep it' : ''} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />}<small>{field.help}</small></label>)}<footer><button type="button" className="button button-secondary" onClick={() => setEditing(undefined)}>Cancel</button><button className="button button-accent" disabled={Boolean(busy)}>{busy ? <><BusyMark /> Saving…</> : <><Save /> Save and enable</>}</button></footer></form></Dialog>}
  </section>;
}

export default App;
