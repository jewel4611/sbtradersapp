import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LayoutDashboard, Package, ShoppingCart, Users, FileText, Plus, Search,
  Printer, X, Trash2, Pencil, AlertTriangle, Wallet, ArrowUpRight,
  ChevronRight, ChevronLeft, CheckCircle2, Menu, ShieldCheck, LogOut,
  KeyRound, Lock, UserPlus, Power, Settings as SettingsIcon, Upload
} from "lucide-react";
import {
  db, auth, emailFor, getSecondaryAuth, getSecondaryDb, resetSecondaryAuth
} from "./firebase";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, updatePassword
} from "firebase/auth";
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, runTransaction
} from "firebase/firestore";

/* ---------------------------------- helpers ---------------------------------- */

const money = (n) =>
  "৳" + (Number(n) || 0).toLocaleString("en-BD", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const todayISO = () => new Date().toISOString().slice(0, 10);
const slugUser = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

/* ---------------------------------- theme constants ---------------------------------- */

const INK = "#141c2e";
const PAPER = "#faf7f0";
const GOLD = "#c88b2a";
const EMERALD = "#2f7a4d";
const ROSE = "#b3392c";
const TEAL = "#0f5257";

const COMPANY = {
  name: "M/S SB TRADERS",
  tagline: "1st Class Contractor, Supplier & Importer",
  address: "104, Awlad Hossain Market, Old Airport Road, Tejgaon, Dhaka-1215",
  hotline: "+880 1601-285867",
  tel: "02-48110878",
  email: "sbtradersbahar@gmail.com",
  web: "www.sbtradersbd.com",
};

const ALL_TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "stock", label: "Stock", icon: Package },
  { id: "sale", label: "New Sale", icon: ShoppingCart },
  { id: "invoices", label: "Invoices", icon: FileText },
  { id: "clients", label: "Clients & Ledger", icon: Users },
];
const STAFF_ASSIGNABLE_TABS = ALL_TABS.map((t) => t.id);

function tabsForUser(user) {
  if (!user) return [];
  if (user.role === "admin") return [...ALL_TABS.map((t) => t.id), "users", "settings"];
  if (user.role === "manager") return [...ALL_TABS.map((t) => t.id), "settings"];
  return user.tabs && user.tabs.length ? user.tabs : ["dashboard"];
}
const roleLabel = (r) => (r === "admin" ? "Admin" : r === "manager" ? "Moderator" : "Staff");
const roleColor = (r) => (r === "admin" ? GOLD : r === "manager" ? TEAL : EMERALD);

/* ---------------------------------- Firestore collections ---------------------------------- */

const col = {
  users: collection(db, "users"),
  products: collection(db, "products"),
  clients: collection(db, "clients"),
  invoices: collection(db, "invoices"),
  payments: collection(db, "payments"),
};
const counterRef = doc(db, "meta", "counters");
const setupRef = doc(db, "meta", "setupComplete");
const brandingRef = doc(db, "settings", "branding");
const adRef = doc(db, "settings", "ad");
const loginNoticeRef = doc(db, "settings", "loginNotice");
const withId = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

// Creates a real Firebase Auth login (email+password, where the "password"
// is the staff member's PIN) via a secondary app instance so it doesn't
// disturb whoever is currently signed in on the primary app.
async function registerAuthAccount(username, pin) {
  const sAuth = getSecondaryAuth();
  const cred = await createUserWithEmailAndPassword(sAuth, emailFor(username), pin);
  return cred.user.uid;
}

/* ---------------------------------- Root (auth + realtime data) ---------------------------------- */

export default function Root() {
  const [setupComplete, setSetupComplete] = useState(null); // null = still loading
  const [authUser, setAuthUser] = useState(undefined); // undefined = unknown yet, null = signed out
  const [profile, setProfile] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [loginError, setLoginError] = useState(null);

  const [products, setProducts] = useState([]);
  const [clients, setClients] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [counters, setCounters] = useState({ inv: 0 });
  const [branding, setBranding] = useState({});
  const [ad, setAd] = useState({});
  const [loginNotice, setLoginNotice] = useState({});

  // The ONLY things readable before anyone signs in: a bare true/false flag
  // for whether first-run setup has happened, and the optional login-page
  // notice (which is meant to be seen pre-login, by design). No names, no
  // account list — login now works by typing a username, not picking from
  // a shown list, so an account can be genuinely invisible pre-login.
  useEffect(() => {
    const unsub = onSnapshot(setupRef, (s) => setSetupComplete(s.exists() && s.data().done === true), (e) => setAuthError(e.message));
    return unsub;
  }, []);
  useEffect(() => {
    const unsub = onSnapshot(loginNoticeRef, (s) => setLoginNotice(s.exists() ? s.data() : {}), () => {});
    return unsub;
  }, []);

  // Track the real Firebase Auth session.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setAuthUser(u || null));
    return unsub;
  }, []);

  // Once signed in, load this person's own profile (role/tabs/active).
  useEffect(() => {
    if (!authUser) { setProfile(null); return; }
    const unsub = onSnapshot(doc(db, "users", authUser.uid), (snap) => {
      if (!snap.exists() || snap.data().active === false) {
        // Profile removed or blocked — revoke access immediately, showing
        // whatever custom message the admin set when blocking this person.
        const blockMsg = snap.exists() ? snap.data().blockMessage : null;
        signOut(auth);
        setProfile(null);
        setLoginError(blockMsg || "This account is no longer active. Contact your admin.");
        return;
      }
      setProfile({ id: snap.id, ...snap.data() });
    }, (e) => setAuthError(e.message));
    return unsub;
  }, [authUser]);

  // Once we know who's signed in (with a role), subscribe to the shared data.
  useEffect(() => {
    if (!profile) return;
    const unsubs = [
      onSnapshot(col.products, (s) => setProducts(withId(s)), () => {}),
      onSnapshot(col.clients, (s) => setClients(withId(s)), () => {}),
      onSnapshot(col.invoices, (s) => setInvoices(withId(s)), () => {}),
      onSnapshot(col.payments, (s) => setPayments(withId(s)), () => {}),
      onSnapshot(counterRef, (s) => setCounters(s.exists() ? s.data() : { inv: 0 }), () => {}),
      onSnapshot(brandingRef, (s) => setBranding(s.exists() ? s.data() : {}), () => {}),
      onSnapshot(adRef, (s) => setAd(s.exists() ? s.data() : {}), () => {}),
    ];
    if (profile.role === "admin") {
      unsubs.push(onSnapshot(col.users, (s) => setAllUsers(withId(s)), () => {}));
    }
    return () => unsubs.forEach((u) => u());
  }, [profile]);

  if (authError) {
    return (
      <div style={{ background: PAPER }} className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-4">
          Couldn't connect to Firebase: {authError}. Check your <code>.env</code> Firebase config and that Firestore rules are published.
        </div>
      </div>
    );
  }

  if (setupComplete === null || authUser === undefined) {
    return (
      <div style={{ background: PAPER }} className="min-h-screen flex items-center justify-center">
        <div className="text-slate-500 text-sm tracking-wide">Loading SB Traders…</div>
      </div>
    );
  }

  if (!setupComplete) {
    return (
      <div style={{ background: PAPER }} className="min-h-screen flex items-center justify-center p-4">
        <SetupWizard onCreate={async (admin) => {
          const uid = await registerAuthAccount(admin.username, admin.pin);
          const sDb = getSecondaryDb();
          // Written using the SECONDARY session (signed in as the brand
          // new user) while first-run setup is still open.
          await setDoc(doc(sDb, "users", uid), { name: admin.name, username: admin.username, role: "admin", active: true, tabs: [], canManageAccounts: true });
          await setDoc(doc(sDb, "meta", "setupComplete"), { done: true });
          await resetSecondaryAuth();
        }} />
      </div>
    );
  }

  if (!authUser || !profile) {
    return (
      <div style={{ background: PAPER }} className="min-h-screen flex items-center justify-center p-4">
        <LoginScreen
          error={loginError}
          notice={loginNotice}
          onLogin={async (username, pin) => {
            setLoginError(null);
            try {
              await signInWithEmailAndPassword(auth, emailFor(username), pin);
            } catch (e) {
              setLoginError("Incorrect name or PIN.");
            }
          }}
        />
      </div>
    );
  }

  return (
    <MainApp
      currentUser={profile}
      logout={() => signOut(auth)}
      users={allUsers} products={products} clients={clients}
      invoices={invoices} payments={payments} counters={counters}
      branding={branding} ad={ad}
    />
  );
}


/* ---------------------------------- Auth screens ---------------------------------- */

function LogoMark({ size = 56, ring = true }) {
  return (
    <div
      className="rounded-full flex items-center justify-center overflow-hidden bg-white"
      style={{ width: size, height: size, border: ring ? `2px solid ${GOLD}` : "none" }}
    >
      <img src="/logo.png" alt="SB Traders" style={{ width: "82%", height: "82%", objectFit: "contain" }} />
    </div>
  );
}

function SetupWizard({ onCreate }) {
  const [admin, setAdmin] = useState({ name: "Jewel", pin: "", pin2: "" });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (admin.pin.length !== 6) { setErr("PIN must be exactly 6 digits (Firebase requires 6+ character passwords)."); return; }
    if (admin.pin !== admin.pin2) { setErr("PIN and confirmation don't match."); return; }
    if (!admin.name.trim()) { setErr("Please enter a name."); return; }
    setSaving(true);
    try {
      await onCreate({ name: admin.name.trim(), username: slugUser(admin.name), pin: admin.pin });
    } catch (e2) {
      setErr(e2.message || "Could not create the account.");
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      <div className="flex flex-col items-center mb-6">
        <LogoMark size={72} />
        <h1 className="font-display text-2xl mt-3 text-center" style={{ color: INK }}>Welcome to {COMPANY.name}</h1>
        <p className="text-xs text-slate-400 mt-0.5 text-center">{COMPANY.tagline}</p>
        <p className="text-sm text-slate-500 mt-3 text-center">Set up the Admin account to get started. It needs a 6-digit PIN used to sign in — this becomes the real login password behind the scenes. You can add Moderator or Staff accounts afterward from inside the app.</p>
      </div>
      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Admin name"><input autoFocus className={inputCls} style={inputStyle} value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="PIN"><input type="password" inputMode="numeric" maxLength={6} className={inputCls} style={inputStyle} value={admin.pin} onChange={(e) => setAdmin({ ...admin, pin: e.target.value.replace(/\D/g, "") })} required /></Field>
            <Field label="Confirm PIN"><input type="password" inputMode="numeric" maxLength={6} className={inputCls} style={inputStyle} value={admin.pin2} onChange={(e) => setAdmin({ ...admin, pin2: e.target.value.replace(/\D/g, "") })} required /></Field>
          </div>
          {err && <div className="text-xs px-3 py-2 rounded-md" style={{ background: ROSE + "1a", color: ROSE }}>{err}</div>}
          <PrimaryButton type="submit" disabled={saving} className="w-full justify-center"><ShieldCheck size={16} /> {saving ? "Creating…" : "Create Admin Account & Continue"}</PrimaryButton>
        </form>
      </Card>
      <p className="text-[11px] text-slate-400 text-center mt-4">Note: this is a lightweight PIN lock for your team's convenience, not bank-grade security. Don't reuse sensitive passwords here.</p>
    </div>
  );
}

function LoginScreen({ error, notice, onLogin }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (submitting || !name.trim() || pin.length !== 6) return;
    setSubmitting(true);
    await onLogin(slugUser(name), pin);
    setSubmitting(false);
  };

  return (
    <div className="w-full max-w-sm">
      <div className="flex flex-col items-center mb-6">
        <LogoMark size={72} />
        <h1 className="font-display text-2xl mt-3 text-center" style={{ color: INK }}>{COMPANY.name}</h1>
        <p className="text-xs text-slate-400 mt-0.5 text-center">{COMPANY.tagline}</p>
        <p className="text-sm text-slate-500 mt-2">Staff Login</p>
      </div>

      {notice?.enabled && (notice?.text || notice?.imageUrl) && (
        <div className="mb-4 rounded-md border p-4 text-sm" style={{ borderColor: GOLD, background: "#fdf5e8" }}>
          {notice.imageUrl && <img src={notice.imageUrl} alt="" className="w-full rounded mb-2 max-h-40 object-contain" />}
          {notice.text && <div className="whitespace-pre-wrap" style={{ color: "#8a5a00" }}>{notice.text}</div>}
        </div>
      )}

      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Your name">
            <input autoFocus className={inputCls} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jewel" required />
          </Field>
          <Field label="PIN">
            <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className={inputCls + " text-center tracking-[0.5em] text-lg"} style={inputStyle} />
          </Field>
          {error && <div className="text-xs text-center" style={{ color: ROSE }}>{error}</div>}
          <PrimaryButton type="submit" disabled={submitting || !name.trim() || pin.length !== 6} className="w-full justify-center"><Lock size={15} /> {submitting ? "Checking…" : "Login"}</PrimaryButton>
        </form>
      </Card>
    </div>
  );
}

/* ---------------------------------- Main App ---------------------------------- */

function MainApp({ currentUser, logout, users, products, clients, invoices, payments, counters, branding, ad }) {
  const allowed = tabsForUser(currentUser);
  const [tab, setTab] = useState(allowed[0] || "dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const [activeClientId, setActiveClientId] = useState(null);
  const [printDoc, setPrintDoc] = useState(null); // { id, kind: 'invoice' | 'challan' }
  const [toast, setToast] = useState(null);
  const [showChangePin, setShowChangePin] = useState(false);

  const notify = useCallback((msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2600);
  }, []);
  const notifyErr = useCallback((e) => notify(e?.message || "Something went wrong", "err"), [notify]);

  const clientDue = useCallback((clientId) => {
    const client = clients.find((c) => c.id === clientId);
    const opening = client?.openingBalance || 0;
    const inv = invoices.filter((i) => i.clientId === clientId).reduce((s, i) => s + i.grandTotal, 0);
    const pay = payments.filter((p) => p.clientId === clientId).reduce((s, p) => s + p.amount, 0);
    return opening + inv - pay;
  }, [invoices, payments, clients]);

  const stockValue = useMemo(() => products.reduce((s, p) => s + p.qty * p.purchasePrice, 0), [products]);
  const totalSales = useMemo(() => invoices.reduce((s, i) => s + i.grandTotal, 0), [invoices]);
  const totalDue = useMemo(() => clients.reduce((s, c) => s + Math.max(clientDue(c.id), 0), 0), [clients, clientDue]);
  const lowStock = useMemo(() => products.filter((p) => p.qty <= (p.minStock ?? 5)), [products]);

  const visibleNav = ALL_TABS.filter((n) => allowed.includes(n.id));
  const canSeeUsers = allowed.includes("users");
  const canSeeSettings = allowed.includes("settings");
  const canEditRecords = currentUser.role === "admin" || currentUser.role === "manager" || (currentUser.role === "staff" && currentUser.canEditRecords === true);
  const canManageAccounts = currentUser.role === "admin" && currentUser.canManageAccounts === true;
  const openPrint = (id, kind) => setPrintDoc({ id, kind });

  return (
    <div style={{ background: PAPER, fontFamily: "Inter, sans-serif" }} className="min-h-screen text-slate-900">
      <div className="flex">
        <aside
          className={`fixed z-30 inset-y-0 left-0 w-64 transform ${navOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 md:static transition-transform duration-200`}
          style={{ background: INK }}
        >
          <div className="h-full flex flex-col text-stone-200">
            <div className="px-6 py-6 border-b border-white/10 flex items-center gap-3">
              <LogoMark size={40} />
              <div>
                <div className="font-display text-lg leading-tight text-white tracking-wide">SB TRADERS</div>
                <div className="text-[10px] uppercase tracking-[0.1em] text-stone-400 leading-snug">{COMPANY.tagline}</div>
              </div>
            </div>
            <nav className="flex-1 px-3 py-5 space-y-1">
              {visibleNav.map((n) => {
                const Icon = n.icon;
                const active = tab === n.id;
                return (
                  <button
                    key={n.id}
                    onClick={() => { setTab(n.id); setActiveClientId(null); setNavOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${active ? "text-white" : "text-stone-400 hover:text-stone-100 hover:bg-white/5"}`}
                    style={active ? { background: "rgba(200,139,42,0.18)", borderLeft: `3px solid ${GOLD}` } : { borderLeft: "3px solid transparent" }}
                  >
                    <Icon size={17} />
                    {n.label}
                  </button>
                );
              })}
              {canSeeUsers && (
                <button
                  onClick={() => { setTab("users"); setActiveClientId(null); setNavOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${tab === "users" ? "text-white" : "text-stone-400 hover:text-stone-100 hover:bg-white/5"}`}
                  style={tab === "users" ? { background: "rgba(200,139,42,0.18)", borderLeft: `3px solid ${GOLD}` } : { borderLeft: "3px solid transparent" }}
                >
                  <ShieldCheck size={17} /> Staff Accounts
                </button>
              )}
              {canSeeSettings && (
                <button
                  onClick={() => { setTab("settings"); setActiveClientId(null); setNavOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${tab === "settings" ? "text-white" : "text-stone-400 hover:text-stone-100 hover:bg-white/5"}`}
                  style={tab === "settings" ? { background: "rgba(200,139,42,0.18)", borderLeft: `3px solid ${GOLD}` } : { borderLeft: "3px solid transparent" }}
                >
                  <SettingsIcon size={17} /> Settings
                </button>
              )}
            </nav>
            <div className="px-4 py-4 border-t border-white/10">
              <div className="flex items-center justify-between px-2">
                <div>
                  <div className="text-sm font-medium text-white">{currentUser.name}</div>
                  <Pill color={roleColor(currentUser.role)}>{roleLabel(currentUser.role)}</Pill>
                </div>
                <div className="flex items-center gap-1">
                  <button title="Change PIN" onClick={() => setShowChangePin(true)} className="p-1.5 rounded hover:bg-white/10 text-stone-400"><KeyRound size={15} /></button>
                  <button title="Logout" onClick={logout} className="p-1.5 rounded hover:bg-white/10 text-stone-400"><LogOut size={15} /></button>
                </div>
              </div>
            </div>
          </div>
        </aside>
        {navOpen && <div onClick={() => setNavOpen(false)} className="fixed inset-0 bg-black/40 z-20 md:hidden" />}

        <main className="flex-1 min-w-0">
          <div className="md:hidden flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#e7e0d3" }}>
            <button onClick={() => setNavOpen(true)} className="p-2"><Menu size={20} /></button>
            <div className="font-display text-sm tracking-wide">SB TRADERS</div>
            <div className="w-8" />
          </div>

          <div className="max-w-6xl mx-auto px-5 md:px-8 py-6 md:py-8">
            {tab === "dashboard" && allowed.includes("dashboard") && (
              <Dashboard
                stockValue={stockValue} totalSales={totalSales} totalDue={totalDue}
                lowStock={lowStock} invoices={invoices} clients={clients} clientDue={clientDue}
                goTab={setTab} openClient={(id) => { setActiveClientId(id); setTab("clients"); }}
                openInvoice={(id) => openPrint(id, "invoice")} allowed={allowed} ad={ad}
              />
            )}
            {tab === "stock" && allowed.includes("stock") && (
              <StockView products={products} notify={notify} notifyErr={notifyErr} />
            )}
            {tab === "sale" && allowed.includes("sale") && (
              <NewSale
                products={products} clients={clients}
                notify={notify} notifyErr={notifyErr}
                onDone={(id) => { openPrint(id, "invoice"); setTab("invoices"); }}
              />
            )}
            {tab === "invoices" && allowed.includes("invoices") && (
              <InvoicesView invoices={invoices} clients={clients} products={products} payments={payments} onPrint={openPrint}
                canEdit={canEditRecords} notify={notify} notifyErr={notifyErr} />
            )}
            {tab === "clients" && allowed.includes("clients") && (
              <ClientsView
                clients={clients} invoices={invoices} payments={payments} products={products}
                clientDue={clientDue} activeClientId={activeClientId} setActiveClientId={setActiveClientId}
                notify={notify} notifyErr={notifyErr} onPrint={openPrint} canEdit={canEditRecords}
              />
            )}
            {tab === "users" && canSeeUsers && (
              <UsersView users={users} currentUser={currentUser} canManageAccounts={canManageAccounts} notify={notify} notifyErr={notifyErr} />
            )}
            {tab === "settings" && canSeeSettings && (
              <SettingsView branding={branding} canManageAccounts={canManageAccounts} notify={notify} notifyErr={notifyErr} />
            )}
            {!allowed.includes(tab) && tab !== "users" && tab !== "settings" && (
              <EmptyNote text="You don't have access to this section. Ask your admin if you need it." />
            )}
          </div>
        </main>
      </div>

      {printDoc && printDoc.kind === "invoice" && (
        <InvoiceModal
          invoice={invoices.find((i) => i.id === printDoc.id)}
          client={clients.find((c) => c.id === (invoices.find((i) => i.id === printDoc.id) || {}).clientId)}
          branding={branding}
          onClose={() => setPrintDoc(null)}
        />
      )}
      {printDoc && printDoc.kind === "challan" && (
        <ChallanModal
          invoice={invoices.find((i) => i.id === printDoc.id)}
          client={clients.find((c) => c.id === (invoices.find((i) => i.id === printDoc.id) || {}).clientId)}
          branding={branding}
          onClose={() => setPrintDoc(null)}
        />
      )}

      {showChangePin && (
        <ChangePinModal
          onClose={() => setShowChangePin(false)}
          onSave={async (newPin) => {
            try {
              await updatePassword(auth.currentUser, newPin);
              setShowChangePin(false);
              notify("PIN updated");
            } catch (e) {
              notifyErr(e.code === "auth/requires-recent-login"
                ? { message: "For security, please log out and back in before changing your PIN." }
                : e);
            }
          }}
        />
      )}

      {toast && (
        <div
          className="fixed bottom-5 right-5 z-50 px-4 py-3 rounded-md shadow-lg text-sm text-white flex items-center gap-2"
          style={{ background: toast.kind === "err" ? ROSE : EMERALD }}
        >
          <CheckCircle2 size={16} /> {toast.msg}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- small ui ---------------------------------- */

function Card({ children, className = "" }) {
  return (
    <div className={`bg-white rounded-lg border shadow-sm ${className}`} style={{ borderColor: "#e7e0d3" }}>
      {children}
    </div>
  );
}
function StatCard({ label, value, icon: Icon, accent, sub }) {
  return (
    <Card className="p-4 flex items-start justify-between">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
        <div className="font-display text-2xl mt-1" style={{ color: INK }}>{value}</div>
        {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
      </div>
      <div className="w-9 h-9 rounded-md flex items-center justify-center" style={{ background: accent + "22" }}>
        <Icon size={18} style={{ color: accent }} />
      </div>
    </Card>
  );
}
function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-slate-600 mb-1">{label}</div>
      {children}
    </label>
  );
}
const inputCls =
  "w-full px-3 py-2 rounded-md border text-sm outline-none focus:ring-2 transition";
const inputStyle = { borderColor: "#d9d0bb", "--tw-ring-color": "#c88b2a55" };

function PrimaryButton({ children, onClick, type = "button", className = "", disabled }) {
  return (
    <button
      type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white transition disabled:opacity-40 ${className}`}
      style={{ background: INK }}
    >
      {children}
    </button>
  );
}
function GhostButton({ children, onClick, className = "" }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border transition hover:bg-stone-50 ${className}`}
      style={{ borderColor: "#d9d0bb", color: INK }}
    >
      {children}
    </button>
  );
}
function Pill({ children, color }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: color + "1c", color }}>
      {children}
    </span>
  );
}

/* ---------------------------------- Dashboard ---------------------------------- */

const normalizeUrl = (url) => {
  if (!url) return "";
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

function AdBanner({ ad }) {
  const [dismissed, setDismissed] = useState(false);
  if (!ad?.enabled || dismissed || (!ad?.imageUrl && !ad?.caption)) return null;
  const link = normalizeUrl(ad.link);
  const Wrapper = link ? "a" : "div";
  const wrapperProps = link ? { href: link, target: "_blank", rel: "noopener noreferrer" } : {};
  return (
    <Card className="p-0 overflow-hidden relative">
      <button onClick={() => setDismissed(true)} className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full flex items-center justify-center bg-white/90 shadow" style={{ color: INK }}>
        <X size={13} />
      </button>
      <Wrapper {...wrapperProps} className={`flex flex-col sm:flex-row items-stretch ${link ? "hover:opacity-95 cursor-pointer" : ""}`}>
        {ad.imageUrl && (
          <div className="w-full sm:w-56 h-40 shrink-0 bg-stone-100 flex items-center justify-center">
            <img src={ad.imageUrl} alt="" className="w-full h-full object-contain" />
          </div>
        )}
        {ad.caption && (
          <div className="p-4 flex items-center text-sm text-slate-700">{ad.caption}</div>
        )}
      </Wrapper>
    </Card>
  );
}

function Dashboard({ stockValue, totalSales, totalDue, lowStock, invoices, clients, clientDue, goTab, openClient, openInvoice, allowed, ad }) {
  const recent = [...invoices].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const topDue = [...clients].map((c) => ({ ...c, due: clientDue(c.id) })).filter((c) => c.due > 0).sort((a, b) => b.due - a.due).slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl" style={{ color: INK }}>Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Overview of stock, sales and outstanding dues.</p>
      </div>

      <AdBanner ad={ad} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Stock Value" value={money(stockValue)} icon={Package} accent={TEAL} sub="at purchase cost" />
        <StatCard label="Total Sales" value={money(totalSales)} icon={ArrowUpRight} accent={EMERALD} sub={`${invoices.length} invoices`} />
        <StatCard label="Outstanding Dues" value={money(totalDue)} icon={Wallet} accent={ROSE} sub={`${clients.length} clients`} />
        <StatCard label="Low Stock Items" value={lowStock.length} icon={AlertTriangle} accent={GOLD} sub="need restock" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg" style={{ color: INK }}>Recent Invoices</h2>
            {allowed.includes("invoices") && (
              <button onClick={() => goTab("invoices")} className="text-xs font-medium flex items-center gap-1" style={{ color: TEAL }}>
                View all <ChevronRight size={14} />
              </button>
            )}
          </div>
          {recent.length === 0 ? (
            <EmptyNote text="No sales recorded yet. Create your first invoice from New Sale." />
          ) : (
            <div className="space-y-2">
              {recent.map((inv) => (
                <button key={inv.id} onClick={() => openInvoice(inv.id)} className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-stone-50 text-left">
                  <div>
                    <div className="text-sm font-medium font-mono">{inv.invoiceNo}</div>
                    <div className="text-xs text-slate-500">{inv.clientName} · {fmtDate(inv.date)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{money(inv.grandTotal)}</div>
                    {inv.due > 0 ? <Pill color={ROSE}>Due {money(inv.due)}</Pill> : <Pill color={EMERALD}>Paid</Pill>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg" style={{ color: INK }}>Top Outstanding Clients</h2>
            {allowed.includes("clients") && (
              <button onClick={() => goTab("clients")} className="text-xs font-medium flex items-center gap-1" style={{ color: TEAL }}>
                View ledger <ChevronRight size={14} />
              </button>
            )}
          </div>
          {topDue.length === 0 ? (
            <EmptyNote text="No dues right now — every client is settled." />
          ) : (
            <div className="space-y-2">
              {topDue.map((c) => (
                <button key={c.id} onClick={() => openClient(c.id)} className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-stone-50 text-left">
                  <div>
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-xs text-slate-500">{c.phone}</div>
                  </div>
                  <div className="text-sm font-semibold" style={{ color: ROSE }}>{money(c.due)}</div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {lowStock.length > 0 && (
        <Card className="p-5 border-l-4" style={{ borderLeftColor: GOLD }}>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} style={{ color: GOLD }} />
            <h2 className="font-display text-lg" style={{ color: INK }}>Low Stock Alert</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {lowStock.map((p) => (
              <span key={p.id} className="text-xs px-2.5 py-1 rounded-full" style={{ background: "#fff3e0", color: "#8a5a00" }}>
                {p.name} — {p.qty} {p.unit} left
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function EmptyNote({ text }) {
  return <div className="text-sm text-slate-400 py-6 text-center border border-dashed rounded-md" style={{ borderColor: "#e7e0d3" }}>{text}</div>;
}

/* ---------------------------------- Stock ---------------------------------- */

function StockView({ products, notify, notifyErr }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [restockId, setRestockId] = useState(null);
  const [q, setQ] = useState("");

  const filtered = products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.category || "").toLowerCase().includes(q.toLowerCase()));

  const save = async (data) => {
    try {
      if (editing) {
        await updateDoc(doc(db, "products", editing.id), data);
        notify("Product updated");
      } else {
        await addDoc(col.products, { dateAdded: todayISO(), ...data });
        notify("New stock added");
      }
      setShowForm(false); setEditing(null);
    } catch (e) { notifyErr(e); }
  };

  const remove = async (id) => {
    if (!confirm("Remove this product from stock?")) return;
    try { await deleteDoc(doc(db, "products", id)); notify("Product removed"); }
    catch (e) { notifyErr(e); }
  };

  const doRestock = async (id, addQty, newPurchasePrice) => {
    try {
      const p = products.find((x) => x.id === id);
      await updateDoc(doc(db, "products", id), {
        qty: (p?.qty || 0) + addQty,
        ...(newPurchasePrice !== undefined ? { purchasePrice: newPurchasePrice } : {}),
      });
      notify("Stock updated");
      setRestockId(null);
    } catch (e) { notifyErr(e); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl" style={{ color: INK }}>Stock</h1>
          <p className="text-sm text-slate-500 mt-0.5">{products.length} products · value {money(products.reduce((s, p) => s + p.qty * p.purchasePrice, 0))}</p>
        </div>
        <PrimaryButton onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={16} /> Add New Stock</PrimaryButton>
      </div>

      <div className="relative max-w-xs">
        <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" className={inputCls} style={{ ...inputStyle, paddingLeft: "2rem" }} />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b" style={{ borderColor: "#e7e0d3" }}>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3 text-right">Purchase Price</th>
              <th className="px-4 py-3 text-right">Sell Price</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No products yet — add your first stock item.</td></tr>
            )}
            {filtered.map((p) => {
              const low = p.qty <= (p.minStock ?? 5);
              return (
                <tr key={p.id} className="border-b last:border-0 hover:bg-stone-50" style={{ borderColor: "#f0ebe0" }}>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-slate-500">{p.category || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">{money(p.purchasePrice)}</td>
                  <td className="px-4 py-3 text-right font-mono">{money(p.sellPrice)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono font-semibold" style={{ color: low ? ROSE : INK }}>{p.qty}</span>
                    <span className="text-slate-400 text-xs"> {p.unit}</span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setRestockId(p.id)} className="text-xs font-medium px-2 py-1 rounded" style={{ color: TEAL }}>Restock</button>
                    <button onClick={() => { setEditing(p); setShowForm(true); }} className="text-xs font-medium px-2 py-1 rounded ml-1" style={{ color: GOLD }}><Pencil size={12} className="inline" /></button>
                    <button onClick={() => remove(p.id)} className="text-xs font-medium px-2 py-1 rounded ml-1" style={{ color: ROSE }}><Trash2 size={12} className="inline" /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {showForm && (
        <ProductFormModal initial={editing} onClose={() => { setShowForm(false); setEditing(null); }} onSave={save} />
      )}
      {restockId && (
        <RestockModal product={products.find((p) => p.id === restockId)} onClose={() => setRestockId(null)} onSave={doRestock} />
      )}
    </div>
  );
}

function ProductFormModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(initial || { name: "", category: "", purchasePrice: "", sellPrice: "", qty: "", unit: "pcs", minStock: 5 });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e) => {
    e.preventDefault();
    if (!form.name || form.purchasePrice === "" || form.sellPrice === "" || form.qty === "") return;
    onSave({
      name: form.name.trim(), category: form.category.trim(),
      purchasePrice: Number(form.purchasePrice), sellPrice: Number(form.sellPrice),
      qty: Number(form.qty), unit: form.unit || "pcs", minStock: Number(form.minStock) || 5,
    });
  };

  return (
    <Modal onClose={onClose} title={initial ? "Edit Product" : "Add New Stock"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Product name"><input className={inputCls} style={inputStyle} value={form.name} onChange={(e) => set("name", e.target.value)} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><input className={inputCls} style={inputStyle} value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Electronics" /></Field>
          <Field label="Unit"><input className={inputCls} style={inputStyle} value={form.unit} onChange={(e) => set("unit", e.target.value)} placeholder="pcs / kg / ctn" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Purchase price (৳)"><input type="number" step="0.01" className={inputCls} style={inputStyle} value={form.purchasePrice} onChange={(e) => set("purchasePrice", e.target.value)} required /></Field>
          <Field label="Sell price (৳)"><input type="number" step="0.01" className={inputCls} style={inputStyle} value={form.sellPrice} onChange={(e) => set("sellPrice", e.target.value)} required /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={initial ? "Quantity" : "Opening quantity"}><input type="number" className={inputCls} style={inputStyle} value={form.qty} onChange={(e) => set("qty", e.target.value)} required /></Field>
          <Field label="Low-stock alert below"><input type="number" className={inputCls} style={inputStyle} value={form.minStock} onChange={(e) => set("minStock", e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit">{initial ? "Save Changes" : "Add to Stock"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function RestockModal({ product, onClose, onSave }) {
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState(product?.purchasePrice ?? "");
  if (!product) return null;
  return (
    <Modal onClose={onClose} title={`Restock — ${product.name}`}>
      <div className="space-y-4">
        <div className="text-sm text-slate-500">Current stock: <b className="text-slate-800">{product.qty} {product.unit}</b></div>
        <Field label={`Quantity to add (${product.unit})`}><input type="number" autoFocus className={inputCls} style={inputStyle} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="New purchase price (optional, ৳)"><input type="number" step="0.01" className={inputCls} style={inputStyle} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={() => qty && onSave(product.id, Number(qty), price === "" ? undefined : Number(price))}>Add Stock</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------- New Sale ---------------------------------- */

function NewSale({ products, clients, notify, notifyErr, onDone }) {
  const [clientId, setClientId] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [showNewClient, setShowNewClient] = useState(false);
  const [cart, setCart] = useState([]);
  const [productQuery, setProductQuery] = useState("");
  const [discount, setDiscount] = useState(0);
  const [paidNow, setPaidNow] = useState(0);
  const [date, setDate] = useState(todayISO());
  const [submitting, setSubmitting] = useState(false);

  const [clientFocused, setClientFocused] = useState(false);
  const [productFocused, setProductFocused] = useState(false);

  const client = clients.find((c) => c.id === clientId);
  const matchingClients = clientFocused
    ? clients.filter((c) => c.name.toLowerCase().includes(clientQuery.toLowerCase())).slice(0, 8)
    : [];
  const matchingProducts = productFocused
    ? products.filter((p) => p.qty > 0 && p.name.toLowerCase().includes(productQuery.toLowerCase())).slice(0, 8)
    : [];

  const addToCart = (p) => {
    if (cart.find((c) => c.productId === p.id)) { notify("Already in cart", "err"); return; }
    setCart([...cart, { productId: p.id, name: p.name, unit: p.unit, price: p.sellPrice, qty: 1, maxQty: p.qty }]);
    setProductQuery("");
  };
  const updateCartQty = (id, qty) => setCart(cart.map((c) => (c.productId === id ? { ...c, qty } : c)));
  const updateCartPrice = (id, price) => setCart(cart.map((c) => (c.productId === id ? { ...c, price } : c)));
  const removeFromCart = (id) => setCart(cart.filter((c) => c.productId !== id));

  const subtotal = cart.reduce((s, c) => s + c.qty * c.price, 0);
  const grandTotal = Math.max(subtotal - Number(discount || 0), 0);
  const due = Math.max(grandTotal - Number(paidNow || 0), 0);

  const createClient = async (data) => {
    try {
      const ref = await addDoc(col.clients, data);
      setClientId(ref.id);
      setShowNewClient(false);
      notify("Client added");
    } catch (e) { notifyErr(e); }
  };

  const submit = async () => {
    if (!clientId) { notify("Select or add a client first", "err"); return; }
    if (cart.length === 0) { notify("Add at least one product", "err"); return; }
    for (const c of cart) {
      if (c.qty <= 0 || c.qty > c.maxQty) { notify(`Invalid quantity for ${c.name}`, "err"); return; }
    }
    if (submitting) return;
    setSubmitting(true);
    const year = new Date(date).getFullYear();
    try {
      const invoiceId = await runTransaction(db, async (tx) => {
        const counterSnap = await tx.get(counterRef);
        const seq = (counterSnap.exists() ? (counterSnap.data().inv || 0) : 0) + 1;

        const productRefs = cart.map((c) => doc(db, "products", c.productId));
        const productSnaps = await Promise.all(productRefs.map((r) => tx.get(r)));

        for (let i = 0; i < productSnaps.length; i++) {
          const cur = productSnaps[i].data();
          if (!productSnaps[i].exists() || cur.qty < cart[i].qty) {
            throw new Error(`Not enough stock for ${cart[i].name} — only ${cur ? cur.qty : 0} left.`);
          }
        }

        const invoiceNo = `SB-INV-${year}-${String(seq).padStart(4, "0")}`;
        const challanNo = `SB-CH-${year}-${String(seq).padStart(4, "0")}`;
        const invRef = doc(col.invoices);
        tx.set(invRef, {
          invoiceNo, challanNo, date, clientId, clientName: client.name,
          items: cart.map((c) => ({ productId: c.productId, name: c.name, unit: c.unit, qty: c.qty, price: c.price, total: c.qty * c.price })),
          subtotal, discount: Number(discount || 0), grandTotal, paid: Number(paidNow || 0), due,
        });

        productSnaps.forEach((snap, i) => {
          tx.update(productRefs[i], { qty: snap.data().qty - cart[i].qty });
        });

        tx.set(counterRef, { inv: seq }, { merge: true });

        if (Number(paidNow) > 0) {
          const payRef = doc(col.payments);
          tx.set(payRef, { clientId, amount: Number(paidNow), date, note: `Payment at sale ${invoiceNo}`, invoiceId: invRef.id });
        }

        return invRef.id;
      });

      notify("Invoice created");
      setCart([]); setClientId(""); setDiscount(0); setPaidNow(0);
      onDone(invoiceId);
    } catch (e) {
      notifyErr(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl" style={{ color: INK }}>New Sale</h1>
        <p className="text-sm text-slate-500 mt-0.5">Sell stock and generate an invoice with challan automatically.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <Card className="p-5">
            <h2 className="font-display text-lg mb-3" style={{ color: INK }}>Client</h2>
            {client ? (
              <div className="flex items-center justify-between px-3 py-2 rounded-md" style={{ background: "#f4efe2" }}>
                <div>
                  <div className="text-sm font-medium">{client.name}</div>
                  <div className="text-xs text-slate-500">{client.phone}</div>
                </div>
                <button onClick={() => setClientId("")} className="text-xs" style={{ color: ROSE }}>Change</button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
                  <input
                    value={clientQuery} onChange={(e) => setClientQuery(e.target.value)}
                    onFocus={() => setClientFocused(true)} onBlur={() => setTimeout(() => setClientFocused(false), 150)}
                    placeholder="Click to see all clients, or type to search…" className={inputCls} style={{ ...inputStyle, paddingLeft: "2rem" }}
                  />
                  {matchingClients.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full border rounded-md divide-y bg-white shadow-md max-h-64 overflow-y-auto" style={{ borderColor: "#e7e0d3" }}>
                      {matchingClients.map((c) => (
                        <button key={c.id} type="button" onClick={() => { setClientId(c.id); setClientQuery(""); }} className="w-full text-left px-3 py-2 text-sm hover:bg-stone-50">
                          {c.name} <span className="text-slate-400">· {c.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <GhostButton onClick={() => setShowNewClient(true)}><Plus size={14} /> Add new client</GhostButton>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-lg mb-3" style={{ color: INK }}>Items</h2>
            <div className="relative mb-3">
              <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                value={productQuery} onChange={(e) => setProductQuery(e.target.value)}
                onFocus={() => setProductFocused(true)} onBlur={() => setTimeout(() => setProductFocused(false), 150)}
                placeholder="Click to see all stock, or type to search…" className={inputCls} style={{ ...inputStyle, paddingLeft: "2rem" }}
              />
              {matchingProducts.length > 0 && (
                <div className="absolute z-10 mt-1 w-full border rounded-md divide-y bg-white shadow-md max-h-64 overflow-y-auto" style={{ borderColor: "#e7e0d3" }}>
                  {matchingProducts.map((p) => (
                    <button key={p.id} type="button" onClick={() => addToCart(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-stone-50 flex justify-between">
                      <span>{p.name}</span>
                      <span className="text-slate-400 text-xs">{p.qty} {p.unit} avail · {money(p.sellPrice)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {cart.length === 0 ? (
              <EmptyNote text="No items added yet — search stock above." />
            ) : (
              <div className="space-y-2">
                {cart.map((c) => (
                  <div key={c.productId} className="flex items-center gap-2 px-3 py-2 rounded-md" style={{ background: "#f9f6ee" }}>
                    <div className="flex-1 text-sm font-medium">{c.name}</div>
                    <input type="number" min={1} max={c.maxQty} value={c.qty} onChange={(e) => updateCartQty(c.productId, Number(e.target.value))} className="w-16 px-2 py-1 rounded border text-sm text-right" style={inputStyle} />
                    <span className="text-xs text-slate-400 w-8">{c.unit}</span>
                    <span className="text-xs text-slate-400">×</span>
                    <input type="number" step="0.01" value={c.price} onChange={(e) => updateCartPrice(c.productId, Number(e.target.value))} className="w-24 px-2 py-1 rounded border text-sm text-right font-mono" style={inputStyle} />
                    <div className="w-24 text-right text-sm font-semibold font-mono">{money(c.qty * c.price)}</div>
                    <button onClick={() => removeFromCart(c.productId)}><Trash2 size={15} style={{ color: ROSE }} /></button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="font-display text-lg mb-3" style={{ color: INK }}>Summary</h2>
            <Field label="Sale date"><input type="date" className={inputCls} style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <div className="mt-3"><Field label="Discount (৳)"><input type="number" className={inputCls} style={inputStyle} value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field></div>
            <div className="mt-3"><Field label="Amount received now (৳)"><input type="number" className={inputCls} style={inputStyle} value={paidNow} onChange={(e) => setPaidNow(e.target.value)} /></Field></div>

            <div className="mt-4 pt-4 border-t space-y-1.5" style={{ borderColor: "#e7e0d3" }}>
              <Row label="Subtotal" value={money(subtotal)} />
              <Row label="Discount" value={"− " + money(discount || 0)} />
              <Row label="Grand Total" value={money(grandTotal)} bold />
              <Row label="Received" value={money(paidNow || 0)} color={EMERALD} />
              <Row label="Due" value={money(due)} color={due > 0 ? ROSE : EMERALD} bold />
            </div>

            <PrimaryButton onClick={submit} disabled={submitting} className="w-full justify-center mt-4"><FileText size={16} /> {submitting ? "Saving…" : "Generate Invoice & Challan"}</PrimaryButton>
          </Card>
        </div>
      </div>

      {showNewClient && <ClientFormModal onClose={() => setShowNewClient(false)} onSave={createClient} />}
    </div>
  );
}

function Row({ label, value, bold, color }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono ${bold ? "font-bold text-base" : ""}`} style={color ? { color } : {}}>{value}</span>
    </div>
  );
}

/* ---------------------------------- Invoices list ---------------------------------- */

/* ---------------------------------- Edit Invoice (with correct stock reconciliation) ---------------------------------- */

// Applies an edited invoice atomically: reverses the ORIGINAL item quantities
// back into stock, then applies the NEW item quantities, validates nothing
// goes negative, updates the invoice doc, and reconciles the auto-created
// "payment at sale" record if the paid amount changed. Only items that carry
// a productId (every invoice created after this feature shipped) get their
// stock adjusted automatically — older items are left alone with a warning
// shown in the UI.
async function runEditInvoiceTransaction({ invoice, clientId, clientName, date, items, discount, paidNow, linkedPayment }) {
  const subtotal = items.reduce((s, c) => s + c.qty * c.price, 0);
  const grandTotal = Math.max(subtotal - Number(discount || 0), 0);
  const newPaid = Number(paidNow || 0);
  const due = Math.max(grandTotal - newPaid, 0);

  return runTransaction(db, async (tx) => {
    const oldQtyMap = {};
    (invoice.items || []).forEach((it) => { if (it.productId) oldQtyMap[it.productId] = (oldQtyMap[it.productId] || 0) + it.qty; });
    const newQtyMap = {};
    items.forEach((it) => { if (it.productId) newQtyMap[it.productId] = (newQtyMap[it.productId] || 0) + it.qty; });

    const affectedIds = Array.from(new Set([...Object.keys(oldQtyMap), ...Object.keys(newQtyMap)]));
    const refs = affectedIds.map((id) => doc(db, "products", id));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));

    const stockUpdates = [];
    for (let i = 0; i < affectedIds.length; i++) {
      const snap = snaps[i];
      if (!snap.exists()) continue; // product removed since — can't adjust it, skip
      const id = affectedIds[i];
      const delta = (oldQtyMap[id] || 0) - (newQtyMap[id] || 0); // +ve = give back, -ve = take more
      const next = snap.data().qty + delta;
      if (next < 0) throw new Error(`Not enough stock for ${snap.data().name} — this change would take it to ${next}.`);
      stockUpdates.push({ ref: refs[i], qty: next });
    }

    const invRef = doc(db, "invoices", invoice.id);
    tx.update(invRef, {
      clientId, clientName, date,
      items: items.map((c) => ({ productId: c.productId || null, name: c.name, unit: c.unit, qty: c.qty, price: c.price, total: c.qty * c.price })),
      subtotal, discount: Number(discount || 0), grandTotal, paid: newPaid, due,
      editedAt: todayISO(),
    });

    stockUpdates.forEach((u) => tx.update(u.ref, { qty: u.qty }));

    if (linkedPayment) {
      const payRef = doc(db, "payments", linkedPayment.id);
      if (newPaid > 0) tx.update(payRef, { amount: newPaid });
      else tx.delete(payRef);
    } else if (newPaid > 0) {
      const payRef = doc(col.payments);
      tx.set(payRef, { clientId, amount: newPaid, date, note: `Payment at sale ${invoice.invoiceNo} (edited)`, invoiceId: invoice.id });
    }
  });
}

function EditInvoiceModal({ invoice, clients, products, payments, onClose, notify, notifyErr }) {
  const [clientId, setClientId] = useState(invoice.clientId);
  const [clientQuery, setClientQuery] = useState("");
  const [date, setDate] = useState(invoice.date);
  const [items, setItems] = useState(
    (invoice.items || []).map((it) => ({ ...it, key: it.productId || it.name }))
  );
  const [productQuery, setProductQuery] = useState("");
  const [discount, setDiscount] = useState(invoice.discount || 0);
  const [paidNow, setPaidNow] = useState(invoice.paid || 0);
  const [saving, setSaving] = useState(false);
  const [clientFocused, setClientFocused] = useState(false);
  const [productFocused, setProductFocused] = useState(false);

  const client = clients.find((c) => c.id === clientId);
  const matchingClients = clientFocused ? clients.filter((c) => c.name.toLowerCase().includes(clientQuery.toLowerCase())).slice(0, 8) : [];
  const matchingProducts = productFocused ? products.filter((p) => p.name.toLowerCase().includes(productQuery.toLowerCase())).slice(0, 8) : [];
  const missingProductIds = items.some((it) => !it.productId);

  const addItem = (p) => {
    if (items.find((it) => it.productId === p.id)) { notify("Already in this invoice", "err"); return; }
    setItems([...items, { productId: p.id, name: p.name, unit: p.unit, price: p.sellPrice, qty: 1, key: p.id }]);
    setProductQuery("");
  };
  const updateQty = (key, qty) => setItems(items.map((it) => (it.key === key ? { ...it, qty } : it)));
  const updatePrice = (key, price) => setItems(items.map((it) => (it.key === key ? { ...it, price } : it)));
  const removeItem = (key) => setItems(items.filter((it) => it.key !== key));

  const subtotal = items.reduce((s, c) => s + c.qty * c.price, 0);
  const grandTotal = Math.max(subtotal - Number(discount || 0), 0);
  const due = Math.max(grandTotal - Number(paidNow || 0), 0);

  const save = async () => {
    if (!clientId) { notify("Select a client", "err"); return; }
    if (items.length === 0) { notify("Add at least one item", "err"); return; }
    if (items.some((it) => it.qty <= 0)) { notify("Quantities must be greater than 0", "err"); return; }
    setSaving(true);
    try {
      const linkedPayment = payments.find((p) => p.invoiceId === invoice.id);
      await runEditInvoiceTransaction({ invoice, clientId, clientName: client.name, date, items, discount, paidNow, linkedPayment });
      notify("Invoice updated and stock adjusted");
      onClose();
    } catch (e) {
      notifyErr(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: "rgba(20,28,46,0.45)" }}>
      <div className="bg-white rounded-lg w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "#e7e0d3" }}>
          <div>
            <h3 className="font-display text-lg" style={{ color: INK }}>Edit Invoice {invoice.invoiceNo}</h3>
            <p className="text-xs text-slate-400">Challan {invoice.challanNo} — stock will be re-adjusted to match your changes.</p>
          </div>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          {missingProductIds && (
            <div className="text-xs px-3 py-2 rounded-md flex items-start gap-2" style={{ background: GOLD + "1a", color: "#8a5a00" }}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              One or more items on this invoice were created before item-level editing was supported, so their stock won't auto-adjust — check Stock manually if you change those lines.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Client">
              {client ? (
                <div className="flex items-center justify-between px-3 py-2 rounded-md border" style={{ borderColor: "#d9d0bb" }}>
                  <span className="text-sm">{client.name}</span>
                  <button onClick={() => setClientId("")} className="text-xs" style={{ color: ROSE }}>Change</button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    value={clientQuery} onChange={(e) => setClientQuery(e.target.value)}
                    onFocus={() => setClientFocused(true)} onBlur={() => setTimeout(() => setClientFocused(false), 150)}
                    placeholder="Click to see all clients, or type to search…" className={inputCls} style={inputStyle}
                  />
                  {matchingClients.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full border rounded-md divide-y bg-white shadow-md max-h-56 overflow-y-auto" style={{ borderColor: "#e7e0d3" }}>
                      {matchingClients.map((c) => (
                        <button key={c.id} type="button" onClick={() => { setClientId(c.id); setClientQuery(""); }} className="w-full text-left px-3 py-2 text-sm hover:bg-stone-50">{c.name}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Field>
            <Field label="Date"><input type="date" className={inputCls} style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-600 mb-2">Items</div>
            <div className="relative mb-2">
              <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                value={productQuery} onChange={(e) => setProductQuery(e.target.value)}
                onFocus={() => setProductFocused(true)} onBlur={() => setTimeout(() => setProductFocused(false), 150)}
                placeholder="Click to see all stock, or type to search…" className={inputCls} style={{ ...inputStyle, paddingLeft: "2rem" }}
              />
              {matchingProducts.length > 0 && (
                <div className="absolute z-10 mt-1 w-full border rounded-md divide-y bg-white shadow-md max-h-56 overflow-y-auto" style={{ borderColor: "#e7e0d3" }}>
                  {matchingProducts.map((p) => (
                    <button key={p.id} type="button" onClick={() => addItem(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-stone-50 flex justify-between">
                      <span>{p.name}</span><span className="text-slate-400 text-xs">{p.qty} {p.unit} avail</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              {items.map((it) => (
                <div key={it.key} className="flex items-center gap-2 px-3 py-2 rounded-md" style={{ background: "#f9f6ee" }}>
                  <div className="flex-1 text-sm font-medium">{it.name}{!it.productId && <span className="text-[10px] ml-1" style={{ color: GOLD }}>(no stock link)</span>}</div>
                  <input type="number" min={1} value={it.qty} onChange={(e) => updateQty(it.key, Number(e.target.value))} className="w-16 px-2 py-1 rounded border text-sm text-right" style={inputStyle} />
                  <span className="text-xs text-slate-400 w-8">{it.unit}</span>
                  <input type="number" step="0.01" value={it.price} onChange={(e) => updatePrice(it.key, Number(e.target.value))} className="w-24 px-2 py-1 rounded border text-sm text-right font-mono" style={inputStyle} />
                  <div className="w-24 text-right text-sm font-semibold font-mono">{money(it.qty * it.price)}</div>
                  <button onClick={() => removeItem(it.key)}><Trash2 size={15} style={{ color: ROSE }} /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount (৳)"><input type="number" className={inputCls} style={inputStyle} value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
            <Field label="Total paid (৳)"><input type="number" className={inputCls} style={inputStyle} value={paidNow} onChange={(e) => setPaidNow(e.target.value)} /></Field>
          </div>

          <div className="pt-3 border-t space-y-1.5" style={{ borderColor: "#e7e0d3" }}>
            <Row label="Subtotal" value={money(subtotal)} />
            <Row label="Grand Total" value={money(grandTotal)} bold />
            <Row label="Due" value={money(due)} color={due > 0 ? ROSE : EMERALD} bold />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- Invoices list ---------------------------------- */

function InvoicesView({ invoices, clients, products, payments, onPrint, canEdit, notify, notifyErr }) {
  const [q, setQ] = useState("");
  const [editingInvoice, setEditingInvoice] = useState(null);
  const sorted = [...invoices].sort((a, b) => b.date.localeCompare(a.date) || b.invoiceNo.localeCompare(a.invoiceNo));
  const filtered = sorted.filter((i) => i.invoiceNo.toLowerCase().includes(q.toLowerCase()) || i.clientName.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl" style={{ color: INK }}>Invoices</h1>
          <p className="text-sm text-slate-500 mt-0.5">{invoices.length} total</p>
        </div>
        <div className="relative max-w-xs">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice or client…" className={inputCls} style={{ ...inputStyle, paddingLeft: "2rem" }} />
        </div>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b" style={{ borderColor: "#e7e0d3" }}>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Due</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No invoices found.</td></tr>
            )}
            {filtered.map((inv) => (
              <tr key={inv.id} className="border-b last:border-0 hover:bg-stone-50" style={{ borderColor: "#f0ebe0" }}>
                <td className="px-4 py-3 font-mono text-xs">{inv.invoiceNo}{inv.editedAt && <span className="text-slate-400 ml-1">(edited)</span>}</td>
                <td className="px-4 py-3">{inv.clientName}</td>
                <td className="px-4 py-3 text-slate-500">{fmtDate(inv.date)}</td>
                <td className="px-4 py-3 text-right font-mono">{money(inv.grandTotal)}</td>
                <td className="px-4 py-3 text-right">
                  {inv.due > 0 ? <Pill color={ROSE}>{money(inv.due)}</Pill> : <Pill color={EMERALD}>Paid</Pill>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => onPrint(inv.id, "invoice")} className="text-xs font-medium ml-2" style={{ color: TEAL }}>Invoice</button>
                  <button onClick={() => onPrint(inv.id, "challan")} className="text-xs font-medium ml-2" style={{ color: TEAL }}>Challan</button>
                  {canEdit && <button onClick={() => setEditingInvoice(inv)} className="text-xs font-medium ml-2" style={{ color: GOLD }}><Pencil size={12} className="inline" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {editingInvoice && (
        <EditInvoiceModal
          invoice={editingInvoice} clients={clients} products={products} payments={payments}
          onClose={() => setEditingInvoice(null)} notify={notify} notifyErr={notifyErr}
        />
      )}
    </div>
  );
}

/* ---------------------------------- Clients & Ledger ---------------------------------- */

function ClientsView({ clients, invoices, payments, products, clientDue, activeClientId, setActiveClientId, notify, notifyErr, onPrint, canEdit }) {
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [q, setQ] = useState("");
  const active = clients.find((c) => c.id === activeClientId);

  const createClient = async (data) => {
    try {
      await addDoc(col.clients, data);
      setShowForm(false);
      notify("Client added");
    } catch (e) { notifyErr(e); }
  };

  const saveClientEdit = async (data) => {
    try {
      await updateDoc(doc(db, "clients", editingClient.id), data);
      setEditingClient(null);
      notify("Client updated");
    } catch (e) { notifyErr(e); }
  };

  if (active) {
    return (
      <>
        <ClientLedger
          client={active} invoices={invoices.filter((i) => i.clientId === active.id)}
          payments={payments.filter((p) => p.clientId === active.id)}
          allPayments={payments} products={products} clients={clients}
          due={clientDue(active.id)}
          onBack={() => setActiveClientId(null)}
          onAddPayment={async (data) => {
            try {
              await addDoc(col.payments, { clientId: active.id, ...data });
              notify("Payment recorded");
            } catch (e) { notifyErr(e); }
          }}
          onPrint={onPrint}
          canEdit={canEdit}
          notify={notify} notifyErr={notifyErr}
          onEditClient={() => setEditingClient(active)}
        />
        {editingClient && <ClientFormModal initial={editingClient} onClose={() => setEditingClient(null)} onSave={saveClientEdit} />}
      </>
    );
  }

  const filtered = clients.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl" style={{ color: INK }}>Clients &amp; Ledger</h1>
          <p className="text-sm text-slate-500 mt-0.5">{clients.length} clients</p>
        </div>
        <PrimaryButton onClick={() => setShowForm(true)}><Plus size={16} /> Add Client</PrimaryButton>
      </div>

      <div className="relative max-w-xs">
        <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className={inputCls} style={{ ...inputStyle, paddingLeft: "2rem" }} />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b" style={{ borderColor: "#e7e0d3" }}>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Address</th>
              <th className="px-4 py-3 text-right">Due</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No clients yet.</td></tr>
            )}
            {filtered.map((c) => {
              const due = clientDue(c.id);
              return (
                <tr key={c.id} className="border-b last:border-0 hover:bg-stone-50 cursor-pointer" style={{ borderColor: "#f0ebe0" }} onClick={() => setActiveClientId(c.id)}>
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-slate-500">{c.phone}</td>
                  <td className="px-4 py-3 text-slate-500">{c.address || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: due > 0 ? ROSE : EMERALD }}>{money(due)}</td>
                  <td className="px-4 py-3 text-right"><ChevronRight size={16} className="ml-auto text-slate-400" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {showForm && <ClientFormModal onClose={() => setShowForm(false)} onSave={createClient} />}
    </div>
  );
}

function ClientLedger({ client, invoices, payments, allPayments, products, clients, due, onBack, onAddPayment, onPrint, canEdit, notify, notifyErr, onEditClient }) {
  const [showPay, setShowPay] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const opening = client.openingBalance || 0;

  const entries = [
    ...invoices.map((i) => ({ date: i.date, type: "invoice", ref: i.invoiceNo, invoiceId: i.id, debit: i.grandTotal, credit: 0, id: i.id })),
    ...payments.map((p) => ({ date: p.date, type: "payment", ref: [p.method, p.reference].filter(Boolean).join(" · ") || p.note || "Payment received", debit: 0, credit: p.amount, id: p.id })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  let running = opening;
  const withBalance = entries.map((e) => { running += e.debit - e.credit; return { ...e, balance: running }; });
  if (opening !== 0) {
    withBalance.unshift({ date: null, type: "opening", ref: "Opening Balance", debit: opening > 0 ? opening : 0, credit: opening < 0 ? -opening : 0, id: "opening", balance: opening });
  }

  const totalInvoiced = invoices.reduce((s, i) => s + i.grandTotal, 0) + (opening > 0 ? opening : 0);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0) + (opening < 0 ? -opening : 0);

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-sm flex items-center gap-1 text-slate-500 hover:text-slate-800">
        <ChevronLeft size={15} /> Back to clients
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl" style={{ color: INK }}>{client.name}</h1>
            {canEdit && <button onClick={onEditClient} className="text-xs font-medium" style={{ color: GOLD }}><Pencil size={13} className="inline" /> Edit</button>}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">{client.phone} {client.address ? `· ${client.address}` : ""}</p>
        </div>
        <PrimaryButton onClick={() => setShowPay(true)}><Wallet size={16} /> Record Payment</PrimaryButton>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Invoiced" value={money(totalInvoiced)} icon={FileText} accent={TEAL} />
        <StatCard label="Total Paid" value={money(totalPaid)} icon={Wallet} accent={EMERALD} />
        <StatCard label="Current Due" value={money(due)} icon={AlertTriangle} accent={due > 0 ? ROSE : EMERALD} />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm ledger">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b" style={{ borderColor: "#e7e0d3" }}>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3 text-right">Debit (Sale)</th>
              <th className="px-4 py-3 text-right">Credit (Paid)</th>
              <th className="px-4 py-3 text-right">Balance</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {withBalance.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No transactions yet.</td></tr>
            )}
            {withBalance.map((e) => (
              <tr key={e.type + e.id} className="border-b last:border-0 hover:bg-stone-50" style={{ borderColor: "#f0ebe0" }}>
                <td className="px-4 py-3 text-slate-500">{e.date ? fmtDate(e.date) : "—"}</td>
                <td className="px-4 py-3">
                  {e.type === "invoice" ? <Pill color={TEAL}>Sale</Pill> : e.type === "payment" ? <Pill color={EMERALD}>Payment</Pill> : <Pill color={GOLD}>Opening</Pill>}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{e.ref}</td>
                <td className="px-4 py-3 text-right font-mono">{e.debit ? money(e.debit) : "—"}</td>
                <td className="px-4 py-3 text-right font-mono">{e.credit ? money(e.credit) : "—"}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: e.balance > 0 ? ROSE : INK }}>{money(e.balance)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {e.type === "invoice" && (
                    <>
                      <button onClick={() => onPrint(e.invoiceId, "invoice")} className="text-xs font-medium ml-1" style={{ color: TEAL }}>Inv</button>
                      <button onClick={() => onPrint(e.invoiceId, "challan")} className="text-xs font-medium ml-1" style={{ color: TEAL }}>Ch</button>
                      {canEdit && <button onClick={() => setEditingInvoice(invoices.find((i) => i.id === e.invoiceId))} className="text-xs font-medium ml-1" style={{ color: GOLD }}><Pencil size={12} className="inline" /></button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showPay && (
        <PaymentModal client={client} onClose={() => setShowPay(false)} onSave={(data) => { onAddPayment(data); setShowPay(false); }} />
      )}
      {editingInvoice && (
        <EditInvoiceModal
          invoice={editingInvoice} clients={clients} products={products} payments={allPayments}
          onClose={() => setEditingInvoice(null)} notify={notify} notifyErr={notifyErr}
        />
      )}
    </div>
  );
}

function ClientFormModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState({
    name: initial?.name || "", phone: initial?.phone || "", address: initial?.address || "",
    openingBalance: initial?.openingBalance ?? 0,
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = (e) => {
    e.preventDefault();
    if (!form.name) return;
    onSave({
      name: form.name.trim(), phone: form.phone.trim(), address: form.address.trim(),
      openingBalance: Number(form.openingBalance) || 0,
    });
  };
  return (
    <Modal onClose={onClose} title={initial ? "Edit Client" : "Add Client"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Client / shop name"><input autoFocus className={inputCls} style={inputStyle} value={form.name} onChange={(e) => set("name", e.target.value)} required /></Field>
        <Field label="Phone"><input className={inputCls} style={inputStyle} value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Address"><input className={inputCls} style={inputStyle} value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field label="Opening balance (৳) — leave 0 if none">
          <input type="number" className={inputCls} style={inputStyle} value={form.openingBalance} onChange={(e) => set("openingBalance", e.target.value)} />
        </Field>
        <div className="text-[11px] text-slate-400 -mt-2">Positive = client already owed you money before this app. Negative = client had a credit/advance with you.</div>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit">{initial ? "Save Changes" : "Save Client"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

const PAYMENT_METHODS = ["Cash", "bKash", "Nagad", "Rocket", "Bank Transfer", "Cheque", "Other"];

function PaymentModal({ client, onClose, onSave }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  return (
    <Modal onClose={onClose} title={`Record Payment — ${client.name}`}>
      <div className="space-y-4">
        <Field label="Amount received (৳)"><input type="number" autoFocus className={inputCls} style={inputStyle} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" className={inputCls} style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Method">
            <select className={inputCls} style={inputStyle} value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Reference / Transaction ID (optional)"><input className={inputCls} style={inputStyle} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. bKash TrxID" /></Field>
        <Field label="Note (optional)"><input className={inputCls} style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={() => amount && onSave({ amount: Number(amount), date, method, reference: reference.trim(), note: note.trim() })}>Save Payment</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------- Users / Staff accounts (admin only) ---------------------------------- */

function UsersView({ users, currentUser, canManageAccounts, notify, notifyErr }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [blockTarget, setBlockTarget] = useState(null);

  const activeAdminCount = users.filter((u) => u.role === "admin" && u.active !== false).length;
  const isLastActiveAdmin = (u) => u.role === "admin" && u.active !== false && activeAdminCount <= 1;

  // Only show accounts that are either not shielded, or are the viewer's
  // own account — this is also enforced in firestore.rules, so a shielded
  // account is genuinely hidden and untouchable to everyone else, not just
  // hidden in this list.
  const visibleUsers = users.filter((u) => !u.shielded || u.id === currentUser.id);

  const saveAccount = async (data) => {
    try {
      if (editing) {
        // Editing never touches login credentials — just name/role/tabs.
        // Note: role here can only ever be 'manager' or 'staff' — the
        // form never offers 'admin', and Jewel can't edit her own row.
        const patch = { name: data.name, role: data.role, tabs: data.role === "staff" ? data.tabs : [], canEditRecords: data.role === "staff" ? !!data.canEditRecords : false };
        await updateDoc(doc(db, "users", editing.id), patch);
        notify("Account updated");
      } else {
        // 1) Register a real Firebase Auth login for this person (their
        //    PIN becomes their password) without disturbing the admin's
        //    own signed-in session.
        const uid = await registerAuthAccount(data.username, data.pin);
        await resetSecondaryAuth();
        // 2) Write their profile as the admin.
        const tabs = data.role === "staff" ? data.tabs : [];
        const canEditRecords = data.role === "staff" ? !!data.canEditRecords : false;
        await setDoc(doc(db, "users", uid), { name: data.name, username: data.username, role: data.role, active: true, tabs, shielded: false, canManageAccounts: false, canEditRecords });
        notify(data.role === "manager" ? "Moderator account created" : "Staff account created");
      }
      setShowForm(false); setEditing(null);
    } catch (e) {
      notifyErr(e.code === "auth/email-already-in-use"
        ? { message: "That name is already taken — if you're re-adding someone after a failed setup, delete their old login in Firebase Console → Authentication first." }
        : e);
    }
  };

  const toggleShielded = async (u) => {
    try {
      // Rules only allow changing your OWN 'shielded' field — nobody
      // else, including another Admin, can shield or unshield you.
      await updateDoc(doc(db, "users", u.id), { shielded: !u.shielded });
      notify(u.shielded ? "No longer hidden from other admins" : "Hidden from other admins — they can't see or remove this account");
    } catch (e) { notifyErr(e); }
  };

  const blockUser = async (u, message) => {
    try {
      await updateDoc(doc(db, "users", u.id), { active: false, blockMessage: message });
      notify(`${u.name} has been blocked`);
      setBlockTarget(null);
    } catch (e) { notifyErr(e); }
  };

  const unblockUser = async (u) => {
    try {
      await updateDoc(doc(db, "users", u.id), { active: true, blockMessage: "" });
      notify(`${u.name} has been unblocked`);
    } catch (e) { notifyErr(e); }
  };

  const handlePower = (u) => {
    if (u.id === currentUser.id) { notify("You can't block your own account", "err"); return; }
    if (u.active !== false && isLastActiveAdmin(u)) { notify("Can't block the last remaining Admin", "err"); return; }
    if (u.active === false) unblockUser(u);
    else setBlockTarget(u);
  };

  const removeAccount = async (u) => {
    if (u.id === currentUser.id) { notify("You can't remove your own account", "err"); return; }
    if (isLastActiveAdmin(u)) { notify("Can't remove the last remaining Admin", "err"); return; }
    if (!confirm(`Remove "${u.name}"'s account? They will immediately lose access.`)) return;
    try {
      await deleteDoc(doc(db, "users", u.id));
      notify("Account removed");
    } catch (e) { notifyErr(e); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl" style={{ color: INK }}>Staff Accounts</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {canManageAccounts ? "Add a Moderator, or a limited Staff account for a specific job." : "You can view accounts here — only Jewel can add, block, or remove them."}
          </p>
        </div>
        {canManageAccounts && <PrimaryButton onClick={() => { setEditing(null); setShowForm(true); }}><UserPlus size={16} /> Add Account</PrimaryButton>}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b" style={{ borderColor: "#e7e0d3" }}>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Access</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((u) => (
              <tr key={u.id} className="border-b last:border-0 hover:bg-stone-50" style={{ borderColor: "#f0ebe0" }}>
                <td className="px-4 py-3 font-medium">{u.name}{u.id === currentUser.id && <span className="text-slate-400 font-normal text-xs"> (you)</span>}</td>
                <td className="px-4 py-3"><Pill color={roleColor(u.role)}>{roleLabel(u.role)}</Pill></td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {u.role === "admin"
                    ? (u.canManageAccounts ? "Everything, incl. managing accounts" : "Everything except managing accounts")
                    : u.role === "manager"
                      ? "Everything except staff accounts"
                      : ((u.tabs || []).map((t) => ALL_TABS.find((n) => n.id === t)?.label).filter(Boolean).join(", ") || "None") + (u.canEditRecords ? " · can edit records" : "")}
                </td>
                <td className="px-4 py-3">
                  {u.active !== false ? <Pill color={EMERALD}>Active</Pill> : <Pill color={ROSE}>Blocked</Pill>}
                  {u.shielded && <span className="ml-1"><Pill color={INK}>Hidden</Pill></span>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {u.id === currentUser.id && (
                    <button onClick={() => toggleShielded(u)} className="text-xs font-medium px-2 py-1 rounded" style={{ color: u.shielded ? EMERALD : TEAL }}>
                      {u.shielded ? "Unhide me" : "Hide me from other admins"}
                    </button>
                  )}
                  {u.id !== currentUser.id && canManageAccounts && (
                    <>
                      <button onClick={() => { setEditing(u); setShowForm(true); }} className="text-xs font-medium px-2 py-1 rounded" style={{ color: GOLD }}><Pencil size={12} className="inline" /></button>
                      <button onClick={() => handlePower(u)} className="text-xs font-medium px-2 py-1 rounded ml-1" style={{ color: TEAL }}><Power size={12} className="inline" /></button>
                      <button onClick={() => removeAccount(u)} className="text-xs font-medium px-2 py-1 rounded ml-1" style={{ color: ROSE }}><Trash2 size={12} className="inline" /></button>
                    </>
                  )}
                  {u.id !== currentUser.id && !canManageAccounts && (
                    <span className="text-xs text-slate-300">view only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showForm && <StaffFormModal initial={editing} onClose={() => { setShowForm(false); setEditing(null); }} onSave={saveAccount} />}
      {blockTarget && <BlockUserModal user={blockTarget} onClose={() => setBlockTarget(null)} onBlock={(msg) => blockUser(blockTarget, msg)} />}
    </div>
  );
}

const DEFAULT_BLOCK_MESSAGE = "Your access has been paused. Please contact the admin to renew your subscription and continue using this app.";

function BlockUserModal({ user, onClose, onBlock }) {
  const [message, setMessage] = useState(DEFAULT_BLOCK_MESSAGE);
  return (
    <Modal onClose={onClose} title={`Block ${user.name}`}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">They'll be signed out immediately, and will see this exact message the next time they try to log in.</p>
        <Field label="Message shown to this person">
          <textarea rows={4} className={inputCls} style={inputStyle} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <button onClick={() => onBlock(message.trim() || DEFAULT_BLOCK_MESSAGE)} className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white" style={{ background: ROSE }}>Block Account</button>
        </div>
      </div>
    </Modal>
  );
}

function StaffFormModal({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState(initial?.role === "manager" ? "manager" : initial?.role === "staff" ? "staff" : "staff");
  const [tabs, setTabs] = useState(initial?.tabs || ["dashboard", "sale"]);
  const [canEditRecords, setCanEditRecords] = useState(!!initial?.canEditRecords);
  const [err, setErr] = useState("");

  const toggleTab = (id) => setTabs((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Enter a name."); return; }
    if (!initial && pin.length !== 6) { setErr("PIN must be exactly 6 digits."); return; }
    if (role === "staff" && tabs.length === 0) { setErr("Give access to at least one section."); return; }
    const data = initial
      ? { name: name.trim(), role, tabs, canEditRecords }
      : { name: name.trim(), username: slugUser(name), tabs, pin, role, canEditRecords };
    onSave(data);
  };

  return (
    <Modal onClose={onClose} title={initial ? "Edit Account" : "Add Account"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name"><input autoFocus className={inputCls} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <div>
          <div className="text-xs font-medium text-slate-600 mb-2">Role</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-sm px-3 py-2 rounded-md border cursor-pointer" style={{ borderColor: role === "manager" ? GOLD : "#e7e0d3", background: role === "manager" ? "#fdf5e8" : "white" }}>
              <input type="radio" name="role" checked={role === "manager"} onChange={() => setRole("manager")} /> Moderator — full operational access
            </label>
            <label className="flex items-center gap-2 text-sm px-3 py-2 rounded-md border cursor-pointer" style={{ borderColor: role === "staff" ? GOLD : "#e7e0d3", background: role === "staff" ? "#fdf5e8" : "white" }}>
              <input type="radio" name="role" checked={role === "staff"} onChange={() => setRole("staff")} /> Staff — limited access
            </label>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Moderator can't manage staff accounts. Only Jewel can.</div>
        </div>
        {!initial && (
          <Field label="PIN (exactly 6 digits)">
            <input type="password" inputMode="numeric" maxLength={6} className={inputCls} style={inputStyle} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          </Field>
        )}
        {initial && (
          <div className="text-xs text-slate-400 -mt-1">PINs can only be changed by the account holder themselves, from their own "Change PIN" menu after logging in.</div>
        )}
        {role === "staff" && (
          <div>
            <div className="text-xs font-medium text-slate-600 mb-2">Give access to</div>
            <div className="grid grid-cols-2 gap-2">
              {STAFF_ASSIGNABLE_TABS.map((id) => {
                const t = ALL_TABS.find((n) => n.id === id);
                const checked = tabs.includes(id);
                return (
                  <label key={id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-md border cursor-pointer" style={{ borderColor: checked ? GOLD : "#e7e0d3", background: checked ? "#fdf5e8" : "white" }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleTab(id)} />
                    {t.label}
                  </label>
                );
              })}
            </div>
          </div>
        )}
        {role === "staff" && (
          <label className="flex items-start gap-2 text-sm px-3 py-2 rounded-md border cursor-pointer" style={{ borderColor: canEditRecords ? GOLD : "#e7e0d3", background: canEditRecords ? "#fdf5e8" : "white" }}>
            <input type="checkbox" className="mt-0.5" checked={canEditRecords} onChange={(e) => setCanEditRecords(e.target.checked)} />
            <span>Allow editing invoices, challans &amp; client records
              <div className="text-[11px] text-slate-400 font-normal">Off by default — turn on only for staff you trust to correct mistakes in existing sales and client info.</div>
            </span>
          </label>
        )}
        {err && <div className="text-xs px-3 py-2 rounded-md" style={{ background: ROSE + "1a", color: ROSE }}>{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit">{initial ? "Save Changes" : "Create Account"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ChangePinModal({ onClose, onSave }) {
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState("");
  const submit = (e) => {
    e.preventDefault();
    if (pin.length !== 6) { setErr("PIN must be exactly 6 digits."); return; }
    if (pin !== pin2) { setErr("PINs don't match."); return; }
    onSave(pin);
  };
  return (
    <Modal onClose={onClose} title="Change My PIN">
      <form onSubmit={submit} className="space-y-4">
        <Field label="New PIN"><input type="password" inputMode="numeric" maxLength={6} autoFocus className={inputCls} style={inputStyle} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label="Confirm New PIN"><input type="password" inputMode="numeric" maxLength={6} className={inputCls} style={inputStyle} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} /></Field>
        {err && <div className="text-xs px-3 py-2 rounded-md" style={{ background: ROSE + "1a", color: ROSE }}>{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit">Save</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------- Modal shell ---------------------------------- */

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: "rgba(20,28,46,0.45)" }}>
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "#e7e0d3" }}>
          <h3 className="font-display text-lg" style={{ color: INK }}>{title}</h3>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ---------------------------------- Invoice / Challan print view ---------------------------------- */

function SignatureBlock({ branding }) {
  return (
    <div className="mt-10 grid grid-cols-2 gap-10 text-xs text-slate-600">
      <div className="flex flex-col justify-end">
        <div className="h-14" />
        <div className="border-t pt-1" style={{ borderColor: "#999" }}>Receiver's Signature</div>
      </div>
      <div className="flex flex-col items-end justify-end">
        <div className="h-14 flex items-end justify-end gap-2">
          {branding?.signatureUrl && <img src={branding.signatureUrl} alt="" style={{ height: 40, objectFit: "contain" }} />}
          {branding?.sealUrl && <img src={branding.sealUrl} alt="" style={{ height: 56, objectFit: "contain", opacity: 0.92 }} />}
        </div>
        <div className="border-t pt-1 w-full text-right" style={{ borderColor: "#999" }}>Authorized Signature</div>
        {(branding?.signatoryName || branding?.signatoryDesignation) && (
          <div className="text-right mt-0.5">
            {branding?.signatoryName && <div className="font-medium">{branding.signatoryName}</div>}
            {branding?.signatoryDesignation && <div className="text-slate-400">{branding.signatoryDesignation}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function DocHeader({ invoice, docLabel }) {
  return (
    <>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <LogoMark size={48} />
          <div>
            <div className="font-display text-2xl leading-tight" style={{ color: INK }}>{COMPANY.name}</div>
            <div className="text-xs font-medium" style={{ color: GOLD }}>{COMPANY.tagline}</div>
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div className="font-display text-sm font-semibold uppercase tracking-wide" style={{ color: GOLD }}>{docLabel}</div>
          <div className="font-mono text-sm font-semibold" style={{ color: INK }}>{docLabel === "Invoice" ? invoice.invoiceNo : invoice.challanNo}</div>
          <div>{fmtDate(invoice.date)}</div>
        </div>
      </div>
      <div className="text-center text-[11px] text-slate-500 leading-relaxed mb-6 pb-3 border-b" style={{ borderColor: "#e7e0d3" }}>
        <div>Head Office: {COMPANY.address}</div>
        <div>Hotline: {COMPANY.hotline}, Tel: {COMPANY.tel}, E-mail: {COMPANY.email}, Web: {COMPANY.web}</div>
      </div>
    </>
  );
}

function InvoiceModal({ invoice, client, branding, onClose }) {
  if (!invoice) return null;
  const paidFull = invoice.due <= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center p-3 md:p-6 overflow-y-auto" style={{ background: "rgba(20,28,46,0.55)" }}>
      <div className="no-print flex justify-end gap-2 w-full max-w-2xl mb-2">
        <GhostButton onClick={() => window.print()} className="bg-white"><Printer size={15} /> Print</GhostButton>
        <GhostButton onClick={onClose} className="bg-white"><X size={15} /> Close</GhostButton>
      </div>
      <div id="invoice-print-area" className="bg-white w-full max-w-2xl rounded-md shadow-xl relative overflow-hidden" style={{ fontFamily: "Inter, sans-serif" }}>
        <div className="h-2" style={{ background: `linear-gradient(90deg, ${INK}, ${GOLD})` }} />
        <div className="p-8 relative">
          <div
            className="absolute select-none pointer-events-none"
            style={{ top: 90, right: 40, transform: "rotate(-18deg)", border: `3px solid ${paidFull ? EMERALD : ROSE}`, color: paidFull ? EMERALD : ROSE, padding: "6px 18px", borderRadius: 8, fontFamily: "'Zilla Slab', serif", fontWeight: 700, fontSize: 22, letterSpacing: 2, opacity: 0.85 }}
          >
            {paidFull ? "PAID" : "DUE"}
          </div>

          <DocHeader invoice={invoice} docLabel="Invoice" />

          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Billed To</div>
              <div className="font-medium">{invoice.clientName}</div>
              {client?.phone && <div className="text-slate-500 text-xs">{client.phone}</div>}
              {client?.address && <div className="text-slate-500 text-xs">{client.address}</div>}
            </div>
          </div>

          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b-2" style={{ borderColor: INK }}>
                <th className="py-2">Item</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Rate</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((it, idx) => (
                <tr key={idx} className="border-b" style={{ borderColor: "#eee6d3" }}>
                  <td className="py-2">{it.name}</td>
                  <td className="py-2 text-right">{it.qty} {it.unit}</td>
                  <td className="py-2 text-right font-mono">{money(it.price)}</td>
                  <td className="py-2 text-right font-mono">{money(it.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end">
            <div className="w-56 space-y-1.5 text-sm">
              <Row label="Subtotal" value={money(invoice.subtotal)} />
              <Row label="Discount" value={"− " + money(invoice.discount)} />
              <Row label="Grand Total" value={money(invoice.grandTotal)} bold />
              <Row label="Paid" value={money(invoice.paid)} color={EMERALD} />
              <Row label="Due" value={money(invoice.due)} color={invoice.due > 0 ? ROSE : EMERALD} bold />
            </div>
          </div>

          <SignatureBlock branding={branding} />

          <div className="mt-4 pt-3 border-t text-[10px] text-slate-400" style={{ borderColor: "#eee6d3" }}>
            This is a computer-generated invoice. Corresponding delivery details are on Challan {invoice.challanNo}.
          </div>
        </div>
      </div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #invoice-print-area, #invoice-print-area * { visibility: visible; }
          #invoice-print-area { position: fixed; inset: 0; margin: auto; box-shadow: none; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

function ChallanModal({ invoice, client, branding, onClose }) {
  if (!invoice) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center p-3 md:p-6 overflow-y-auto" style={{ background: "rgba(20,28,46,0.55)" }}>
      <div className="no-print flex justify-end gap-2 w-full max-w-2xl mb-2">
        <GhostButton onClick={() => window.print()} className="bg-white"><Printer size={15} /> Print</GhostButton>
        <GhostButton onClick={onClose} className="bg-white"><X size={15} /> Close</GhostButton>
      </div>
      <div id="challan-print-area" className="bg-white w-full max-w-2xl rounded-md shadow-xl relative overflow-hidden" style={{ fontFamily: "Inter, sans-serif" }}>
        <div className="h-2" style={{ background: `linear-gradient(90deg, ${INK}, ${GOLD})` }} />
        <div className="p-8 relative">
          <DocHeader invoice={invoice} docLabel="Delivery Challan" />

          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Delivered To</div>
              <div className="font-medium">{invoice.clientName}</div>
              {client?.phone && <div className="text-slate-500 text-xs">{client.phone}</div>}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Delivery Address</div>
              <div className="text-sm text-slate-700">{client?.address || "—"}</div>
              <div className="text-slate-500 text-xs mt-1">Delivery date: {fmtDate(invoice.date)}</div>
            </div>
          </div>

          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b-2" style={{ borderColor: INK }}>
                <th className="py-2">Item</th>
                <th className="py-2 text-right">Quantity</th>
                <th className="py-2 text-right">Unit</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((it, idx) => (
                <tr key={idx} className="border-b" style={{ borderColor: "#eee6d3" }}>
                  <td className="py-2">{it.name}</td>
                  <td className="py-2 text-right">{it.qty}</td>
                  <td className="py-2 text-right">{it.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <SignatureBlock branding={branding} />

          <div className="mt-4 pt-3 border-t text-[10px] text-slate-400" style={{ borderColor: "#eee6d3" }}>
            This challan confirms delivery of goods only. Pricing and payment details are on Invoice {invoice.invoiceNo}.
          </div>
        </div>
      </div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #challan-print-area, #challan-print-area * { visibility: visible; }
          #challan-print-area { position: fixed; inset: 0; margin: auto; box-shadow: none; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

/* ---------------------------------- Settings (branding: signature & seal) ---------------------------------- */

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function SettingsView({ branding, canManageAccounts, notify, notifyErr }) {
  const [signaturePreview, setSignaturePreview] = useState(branding?.signatureUrl || null);
  const [sealPreview, setSealPreview] = useState(branding?.sealUrl || null);
  const [signatoryName, setSignatoryName] = useState(branding?.signatoryName || "");
  const [signatoryDesignation, setSignatoryDesignation] = useState(branding?.signatoryDesignation || "");
  const [saving, setSaving] = useState(false);

  const handleFile = async (file, setter) => {
    if (!file) return;
    if (file.size > 400 * 1024) { notify("Please use a smaller image (under 400KB) — a plain PNG works best.", "err"); return; }
    const dataUrl = await fileToDataUrl(file);
    setter(dataUrl);
  };

  const save = async () => {
    setSaving(true);
    try {
      await setDoc(brandingRef, {
        signatureUrl: signaturePreview || "", sealUrl: sealPreview || "",
        signatoryName: signatoryName.trim(), signatoryDesignation: signatoryDesignation.trim(),
      }, { merge: true });
      notify("Signature & seal saved — they'll now appear on every invoice and challan");
    } catch (e) { notifyErr(e); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h1 className="font-display text-2xl" style={{ color: INK }}>Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Upload a digital signature and company seal — they'll appear by default on every invoice and challan.</p>
      </div>

      <Card className="p-5 space-y-5">
        <div>
          <div className="text-xs font-medium text-slate-600 mb-2">Digital Signature</div>
          <div className="flex items-center gap-4">
            <div className="w-32 h-16 border rounded-md flex items-center justify-center bg-stone-50" style={{ borderColor: "#e7e0d3" }}>
              {signaturePreview ? <img src={signaturePreview} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-slate-300">No image</span>}
            </div>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md border text-sm cursor-pointer" style={{ borderColor: "#d9d0bb", color: INK }}>
              <Upload size={14} /> Upload
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files[0], setSignaturePreview)} />
            </label>
            {signaturePreview && <button onClick={() => setSignaturePreview(null)} className="text-xs" style={{ color: ROSE }}>Remove</button>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Signatory name"><input className={inputCls} style={inputStyle} value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} placeholder="e.g. Md. Jewel Islam" /></Field>
          <Field label="Designation"><input className={inputCls} style={inputStyle} value={signatoryDesignation} onChange={(e) => setSignatoryDesignation(e.target.value)} placeholder="e.g. Managing Director" /></Field>
        </div>
        <div className="text-[11px] text-slate-400 -mt-2">Shown printed under the signature/seal on every invoice and challan.</div>

        <div>
          <div className="text-xs font-medium text-slate-600 mb-2">Company Seal / Stamp</div>
          <div className="flex items-center gap-4">
            <div className="w-32 h-16 border rounded-md flex items-center justify-center bg-stone-50" style={{ borderColor: "#e7e0d3" }}>
              {sealPreview ? <img src={sealPreview} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-slate-300">No image</span>}
            </div>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md border text-sm cursor-pointer" style={{ borderColor: "#d9d0bb", color: INK }}>
              <Upload size={14} /> Upload
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files[0], setSealPreview)} />
            </label>
            {sealPreview && <button onClick={() => setSealPreview(null)} className="text-xs" style={{ color: ROSE }}>Remove</button>}
          </div>
        </div>

        <div className="text-[11px] text-slate-400">Tip: a signature or seal saved as a PNG with a transparent background looks best. Keep each file under 400KB.</div>

        <PrimaryButton onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</PrimaryButton>
      </Card>

      {canManageAccounts && <AdSettingsCard notify={notify} notifyErr={notifyErr} />}
      {canManageAccounts && <LoginNoticeSettingsCard notify={notify} notifyErr={notifyErr} />}
    </div>
  );
}

function AdSettingsCard({ notify, notifyErr }) {
  const [enabled, setEnabled] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [caption, setCaption] = useState("");
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(adRef, (s) => {
      const d = s.exists() ? s.data() : {};
      setEnabled(!!d.enabled); setImagePreview(d.imageUrl || null); setCaption(d.caption || ""); setLink(d.link || "");
      setLoaded(true);
    });
    return unsub;
  }, []);

  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > 500 * 1024) { notify("Please use a smaller image (under 500KB).", "err"); return; }
    setImagePreview(await fileToDataUrl(file));
  };

  const save = async () => {
    setSaving(true);
    try {
      await setDoc(adRef, { enabled, imageUrl: imagePreview || "", caption: caption.trim(), link: normalizeUrl(link) }, { merge: true });
      notify("Advertisement saved");
    } catch (e) { notifyErr(e); } finally { setSaving(false); }
  };

  if (!loaded) return null;

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="font-display text-lg" style={{ color: INK }}>Advertisement</h2>
        <p className="text-xs text-slate-500 mt-0.5">Shows as a banner at the top of everyone's Dashboard — the first screen any role sees after logging in.</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Show this advertisement
      </label>
      <div className="flex items-center gap-4">
        <div className="w-32 h-16 border rounded-md flex items-center justify-center bg-stone-50" style={{ borderColor: "#e7e0d3" }}>
          {imagePreview ? <img src={imagePreview} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-slate-300">No image</span>}
        </div>
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md border text-sm cursor-pointer" style={{ borderColor: "#d9d0bb", color: INK }}>
          <Upload size={14} /> Upload
          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
        </label>
        {imagePreview && <button onClick={() => setImagePreview(null)} className="text-xs" style={{ color: ROSE }}>Remove</button>}
      </div>
      <Field label="Caption text"><input className={inputCls} style={inputStyle} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. New shipment arriving — book early!" /></Field>
      <Field label="Link (optional — opens when clicked)"><input className={inputCls} style={inputStyle} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" /></Field>
      <PrimaryButton onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Advertisement"}</PrimaryButton>
    </Card>
  );
}

function LoginNoticeSettingsCard({ notify, notifyErr }) {
  const [enabled, setEnabled] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(loginNoticeRef, (s) => {
      const d = s.exists() ? s.data() : {};
      setEnabled(!!d.enabled); setImagePreview(d.imageUrl || null); setText(d.text || "");
      setLoaded(true);
    });
    return unsub;
  }, []);

  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > 500 * 1024) { notify("Please use a smaller image (under 500KB).", "err"); return; }
    setImagePreview(await fileToDataUrl(file));
  };

  const save = async () => {
    setSaving(true);
    try {
      await setDoc(loginNoticeRef, { enabled, imageUrl: imagePreview || "", text: text.trim() }, { merge: true });
      notify("Login page notice saved");
    } catch (e) { notifyErr(e); } finally { setSaving(false); }
  };

  if (!loaded) return null;

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="font-display text-lg" style={{ color: INK }}>Login Page Notice</h2>
        <p className="text-xs text-slate-500 mt-0.5">Shows to everyone, even before they log in — good for a subscription reminder or an important announcement.</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Show this notice on the login page
      </label>
      <div className="flex items-center gap-4">
        <div className="w-32 h-16 border rounded-md flex items-center justify-center bg-stone-50" style={{ borderColor: "#e7e0d3" }}>
          {imagePreview ? <img src={imagePreview} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-slate-300">No image</span>}
        </div>
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md border text-sm cursor-pointer" style={{ borderColor: "#d9d0bb", color: INK }}>
          <Upload size={14} /> Upload
          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
        </label>
        {imagePreview && <button onClick={() => setImagePreview(null)} className="text-xs" style={{ color: ROSE }}>Remove</button>}
      </div>
      <Field label="Message"><textarea rows={3} className={inputCls} style={inputStyle} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Subscription renewal due — please contact admin to continue using this app." /></Field>
      <PrimaryButton onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Notice"}</PrimaryButton>
    </Card>
  );
}
