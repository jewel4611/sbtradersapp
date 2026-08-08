import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LayoutDashboard, Package, ShoppingCart, Users, FileText, Plus, Search,
  Printer, X, Trash2, Pencil, AlertTriangle, Wallet, ArrowUpRight,
  ChevronRight, ChevronLeft, CheckCircle2, Menu, ShieldCheck, LogOut,
  KeyRound, Lock, UserPlus, Power
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
  if (user.role === "admin") return [...ALL_TABS.map((t) => t.id), "users"];
  if (user.role === "manager") return ALL_TABS.map((t) => t.id);
  return user.tabs && user.tabs.length ? user.tabs : ["dashboard"];
}
const roleLabel = (r) => (r === "admin" ? "Admin" : r === "manager" ? "Manager" : "Staff");
const roleColor = (r) => (r === "admin" ? GOLD : r === "manager" ? TEAL : EMERALD);

/* ---------------------------------- Firestore collections ---------------------------------- */

const col = {
  users: collection(db, "users"),
  directory: collection(db, "directory"),
  products: collection(db, "products"),
  clients: collection(db, "clients"),
  invoices: collection(db, "invoices"),
  payments: collection(db, "payments"),
};
const counterRef = doc(db, "meta", "counters");
const setupRef = doc(db, "meta", "setupComplete");
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
  const [directory, setDirectory] = useState(null); // null = still loading
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

  // Public directory — always readable, drives the login screen list and
  // tells us whether first-run setup has happened yet.
  useEffect(() => {
    const unsub = onSnapshot(col.directory, (s) => setDirectory(withId(s)), (e) => setAuthError(e.message));
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
        // Profile removed or deactivated — revoke access immediately.
        signOut(auth);
        setProfile(null);
        setLoginError("This account is no longer active. Contact your admin.");
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

  if (directory === null || authUser === undefined) {
    return (
      <div style={{ background: PAPER }} className="min-h-screen flex items-center justify-center">
        <div className="text-slate-500 text-sm tracking-wide">Loading SB Traders…</div>
      </div>
    );
  }

  if (directory.length === 0) {
    return (
      <div style={{ background: PAPER }} className="min-h-screen flex items-center justify-center p-4">
        <SetupWizard onCreate={async (admin, manager) => {
          for (const person of [admin, manager]) {
            const uid = await registerAuthAccount(person.username, person.pin);
            const sDb = getSecondaryDb();
            // Written using the SECONDARY session (signed in as the brand
            // new user) while first-run setup is still open.
            await setDoc(doc(sDb, "users", uid), { name: person.name, username: person.username, role: person.role, active: true, tabs: [] });
            await setDoc(doc(sDb, "directory", uid), { name: person.name, username: person.username, role: person.role, active: true });
            await setDoc(doc(sDb, "meta", "setupComplete"), { done: true });
            await resetSecondaryAuth();
          }
        }} />
      </div>
    );
  }

  if (!authUser || !profile) {
    return (
      <div style={{ background: PAPER }} className="min-h-screen flex items-center justify-center p-4">
        <LoginScreen
          people={directory.filter((u) => u.active !== false)}
          error={loginError}
          onLogin={async (username, pin) => {
            setLoginError(null);
            try {
              await signInWithEmailAndPassword(auth, emailFor(username), pin);
            } catch (e) {
              setLoginError("Incorrect PIN. Try again.");
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
  const [manager, setManager] = useState({ name: "Bahar", pin: "", pin2: "" });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (admin.pin.length !== 6 || manager.pin.length !== 6) { setErr("PINs must be exactly 6 digits (Firebase requires 6+ character passwords)."); return; }
    if (admin.pin !== admin.pin2 || manager.pin !== manager.pin2) { setErr("PIN and confirmation don't match."); return; }
    if (!admin.name.trim() || !manager.name.trim()) { setErr("Please enter both names."); return; }
    setSaving(true);
    try {
      await onCreate(
        { name: admin.name.trim(), username: slugUser(admin.name), pin: admin.pin, role: "admin" },
        { name: manager.name.trim(), username: slugUser(manager.name), pin: manager.pin, role: "manager" }
      );
    } catch (e2) {
      setErr(e2.message || "Could not create accounts.");
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-lg">
      <div className="flex flex-col items-center mb-6">
        <LogoMark size={72} />
        <h1 className="font-display text-2xl mt-3 text-center" style={{ color: INK }}>Welcome to {COMPANY.name}</h1>
        <p className="text-xs text-slate-400 mt-0.5 text-center">{COMPANY.tagline}</p>
        <p className="text-sm text-slate-500 mt-3 text-center">Set up your two core accounts to get started. Each needs a 6-digit PIN used to sign in — this becomes their real login password behind the scenes.</p>
      </div>
      <Card className="p-6">
        <form onSubmit={submit} className="space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Pill color={GOLD}>Admin</Pill>
              <span className="text-xs text-slate-400">Full access — manages stock, sales, ledger and staff accounts</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Name"><input className={inputCls} style={inputStyle} value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} required /></Field>
              <Field label="PIN"><input type="password" inputMode="numeric" maxLength={6} className={inputCls} style={inputStyle} value={admin.pin} onChange={(e) => setAdmin({ ...admin, pin: e.target.value.replace(/\D/g, "") })} required /></Field>
              <Field label="Confirm PIN"><input type="password" inputMode="numeric" maxLength={6} className={inputCls} style={inputStyle} value={admin.pin2} onChange={(e) => setAdmin({ ...admin, pin2: e.target.value.replace(/\D/g, "") })} required /></Field>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Pill color={TEAL}>Manager</Pill>
              <span className="text-xs text-slate-400">Moderator power — everything except managing staff accounts</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Name"><input className={inputCls} style={inputStyle} value={manager.name} onChange={(e) => setManager({ ...manager, name: e.target.value })} required /></Field>
              <Field label="PIN"><input type="password" inputMode="numeric" maxLength={6} className={inputCls} style={inputStyle} value={manager.pin} onChange={(e) => setManager({ ...manager, pin: e.target.value.replace(/\D/g, "") })} required /></Field>
              <Field label="Confirm PIN"><input type="password" inputMode="numeric" maxLength={6} className={inputCls} style={inputStyle} value={manager.pin2} onChange={(e) => setManager({ ...manager, pin2: e.target.value.replace(/\D/g, "") })} required /></Field>
            </div>
          </div>
          {err && <div className="text-xs px-3 py-2 rounded-md" style={{ background: ROSE + "1a", color: ROSE }}>{err}</div>}
          <PrimaryButton type="submit" disabled={saving} className="w-full justify-center"><ShieldCheck size={16} /> {saving ? "Creating…" : "Create Accounts & Continue"}</PrimaryButton>
        </form>
      </Card>
      <p className="text-[11px] text-slate-400 text-center mt-4">Note: this is a lightweight PIN lock for your team's convenience, not bank-grade security. Don't reuse sensitive passwords here.</p>
    </div>
  );
}

function LoginScreen({ people, error, onLogin }) {
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    await onLogin(selected.username, pin);
    setSubmitting(false);
    setPin("");
  };

  return (
    <div className="w-full max-w-sm">
      <div className="flex flex-col items-center mb-6">
        <LogoMark size={72} />
        <h1 className="font-display text-2xl mt-3 text-center" style={{ color: INK }}>{COMPANY.name}</h1>
        <p className="text-xs text-slate-400 mt-0.5 text-center">{COMPANY.tagline}</p>
        <p className="text-sm text-slate-500 mt-2">Staff Login</p>
      </div>

      {!selected ? (
        <Card className="p-4">
          <div className="space-y-2">
            {people.length === 0 && <div className="text-sm text-slate-400 text-center py-4">No active accounts.</div>}
            {people.map((u) => (
              <button key={u.id} onClick={() => setSelected(u)} className="w-full flex items-center justify-between px-4 py-3 rounded-md border hover:bg-stone-50 transition" style={{ borderColor: "#e7e0d3" }}>
                <span className="text-sm font-medium">{u.name}</span>
                <Pill color={roleColor(u.role)}>{roleLabel(u.role)}</Pill>
              </button>
            ))}
          </div>
        </Card>
      ) : (
        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">{selected.name}</div>
                <Pill color={roleColor(selected.role)}>{roleLabel(selected.role)}</Pill>
              </div>
              <button type="button" onClick={() => { setSelected(null); setPin(""); }} className="text-xs text-slate-400 flex items-center gap-1"><ChevronLeft size={13} /> Change user</button>
            </div>
            <Field label="Enter PIN">
              <input autoFocus type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className={inputCls + " text-center tracking-[0.5em] text-lg"} style={inputStyle} />
            </Field>
            {error && <div className="text-xs text-center" style={{ color: ROSE }}>{error}</div>}
            <PrimaryButton type="submit" disabled={submitting || pin.length !== 6} className="w-full justify-center"><Lock size={15} /> {submitting ? "Checking…" : "Login"}</PrimaryButton>
          </form>
        </Card>
      )}
    </div>
  );
}

/* ---------------------------------- Main App ---------------------------------- */

function MainApp({ currentUser, logout, users, products, clients, invoices, payments, counters }) {
  const allowed = tabsForUser(currentUser);
  const [tab, setTab] = useState(allowed[0] || "dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const [activeClientId, setActiveClientId] = useState(null);
  const [printInvoiceId, setPrintInvoiceId] = useState(null);
  const [toast, setToast] = useState(null);
  const [showChangePin, setShowChangePin] = useState(false);

  const notify = useCallback((msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2600);
  }, []);
  const notifyErr = useCallback((e) => notify(e?.message || "Something went wrong", "err"), [notify]);

  const clientDue = useCallback((clientId) => {
    const inv = invoices.filter((i) => i.clientId === clientId).reduce((s, i) => s + i.grandTotal, 0);
    const pay = payments.filter((p) => p.clientId === clientId).reduce((s, p) => s + p.amount, 0);
    return inv - pay;
  }, [invoices, payments]);

  const stockValue = useMemo(() => products.reduce((s, p) => s + p.qty * p.purchasePrice, 0), [products]);
  const totalSales = useMemo(() => invoices.reduce((s, i) => s + i.grandTotal, 0), [invoices]);
  const totalDue = useMemo(() => clients.reduce((s, c) => s + Math.max(clientDue(c.id), 0), 0), [clients, clientDue]);
  const lowStock = useMemo(() => products.filter((p) => p.qty <= (p.minStock ?? 5)), [products]);

  const visibleNav = ALL_TABS.filter((n) => allowed.includes(n.id));
  const canSeeUsers = allowed.includes("users");

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
                openInvoice={setPrintInvoiceId} allowed={allowed}
              />
            )}
            {tab === "stock" && allowed.includes("stock") && (
              <StockView products={products} notify={notify} notifyErr={notifyErr} />
            )}
            {tab === "sale" && allowed.includes("sale") && (
              <NewSale
                products={products} clients={clients}
                notify={notify} notifyErr={notifyErr}
                onDone={(id) => { setPrintInvoiceId(id); setTab("invoices"); }}
              />
            )}
            {tab === "invoices" && allowed.includes("invoices") && (
              <InvoicesView invoices={invoices} clients={clients} onPrint={setPrintInvoiceId} />
            )}
            {tab === "clients" && allowed.includes("clients") && (
              <ClientsView
                clients={clients} invoices={invoices} payments={payments}
                clientDue={clientDue} activeClientId={activeClientId} setActiveClientId={setActiveClientId}
                notify={notify} notifyErr={notifyErr} onPrint={setPrintInvoiceId}
              />
            )}
            {tab === "users" && canSeeUsers && (
              <UsersView users={users} currentUser={currentUser} notify={notify} notifyErr={notifyErr} />
            )}
            {!allowed.includes(tab) && tab !== "users" && (
              <EmptyNote text="You don't have access to this section. Ask your admin if you need it." />
            )}
          </div>
        </main>
      </div>

      {printInvoiceId && (
        <InvoiceModal
          invoice={invoices.find((i) => i.id === printInvoiceId)}
          client={clients.find((c) => c.id === (invoices.find((i) => i.id === printInvoiceId) || {}).clientId)}
          onClose={() => setPrintInvoiceId(null)}
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

function Dashboard({ stockValue, totalSales, totalDue, lowStock, invoices, clients, clientDue, goTab, openClient, openInvoice, allowed }) {
  const recent = [...invoices].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const topDue = [...clients].map((c) => ({ ...c, due: clientDue(c.id) })).filter((c) => c.due > 0).sort((a, b) => b.due - a.due).slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl" style={{ color: INK }}>Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Overview of stock, sales and outstanding dues.</p>
      </div>

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

  const client = clients.find((c) => c.id === clientId);
  const matchingClients = clientQuery
    ? clients.filter((c) => c.name.toLowerCase().includes(clientQuery.toLowerCase())).slice(0, 6)
    : [];
  const matchingProducts = productQuery
    ? products.filter((p) => p.qty > 0 && p.name.toLowerCase().includes(productQuery.toLowerCase())).slice(0, 6)
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
          items: cart.map((c) => ({ name: c.name, unit: c.unit, qty: c.qty, price: c.price, total: c.qty * c.price })),
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
                  <input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Search existing client…" className={inputCls} style={{ ...inputStyle, paddingLeft: "2rem" }} />
                </div>
                {matchingClients.length > 0 && (
                  <div className="border rounded-md divide-y" style={{ borderColor: "#e7e0d3" }}>
                    {matchingClients.map((c) => (
                      <button key={c.id} onClick={() => { setClientId(c.id); setClientQuery(""); }} className="w-full text-left px-3 py-2 text-sm hover:bg-stone-50">
                        {c.name} <span className="text-slate-400">· {c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
                <GhostButton onClick={() => setShowNewClient(true)}><Plus size={14} /> Add new client</GhostButton>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-lg mb-3" style={{ color: INK }}>Items</h2>
            <div className="relative mb-3">
              <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
              <input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Search stock to add…" className={inputCls} style={{ ...inputStyle, paddingLeft: "2rem" }} />
              {matchingProducts.length > 0 && (
                <div className="absolute z-10 mt-1 w-full border rounded-md divide-y bg-white shadow-md" style={{ borderColor: "#e7e0d3" }}>
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

function InvoicesView({ invoices, clients, onPrint }) {
  const [q, setQ] = useState("");
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
                <td className="px-4 py-3 font-mono text-xs">{inv.invoiceNo}</td>
                <td className="px-4 py-3">{inv.clientName}</td>
                <td className="px-4 py-3 text-slate-500">{fmtDate(inv.date)}</td>
                <td className="px-4 py-3 text-right font-mono">{money(inv.grandTotal)}</td>
                <td className="px-4 py-3 text-right">
                  {inv.due > 0 ? <Pill color={ROSE}>{money(inv.due)}</Pill> : <Pill color={EMERALD}>Paid</Pill>}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => onPrint(inv.id)} className="text-xs font-medium flex items-center gap-1 ml-auto" style={{ color: TEAL }}>
                    <Printer size={13} /> View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ---------------------------------- Clients & Ledger ---------------------------------- */

function ClientsView({ clients, invoices, payments, clientDue, activeClientId, setActiveClientId, notify, notifyErr, onPrint }) {
  const [showForm, setShowForm] = useState(false);
  const [q, setQ] = useState("");
  const active = clients.find((c) => c.id === activeClientId);

  const createClient = async (data) => {
    try {
      await addDoc(col.clients, data);
      setShowForm(false);
      notify("Client added");
    } catch (e) { notifyErr(e); }
  };

  if (active) {
    return (
      <ClientLedger
        client={active} invoices={invoices.filter((i) => i.clientId === active.id)}
        payments={payments.filter((p) => p.clientId === active.id)}
        due={clientDue(active.id)}
        onBack={() => setActiveClientId(null)}
        onAddPayment={async (amount, date, note) => {
          try {
            await addDoc(col.payments, { clientId: active.id, amount, date, note });
            notify("Payment recorded");
          } catch (e) { notifyErr(e); }
        }}
        onPrint={onPrint}
      />
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

function ClientLedger({ client, invoices, payments, due, onBack, onAddPayment, onPrint }) {
  const [showPay, setShowPay] = useState(false);
  const entries = [
    ...invoices.map((i) => ({ date: i.date, type: "invoice", ref: i.invoiceNo, debit: i.grandTotal, credit: 0, id: i.id })),
    ...payments.map((p) => ({ date: p.date, type: "payment", ref: p.note || "Payment received", debit: 0, credit: p.amount, id: p.id })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  let running = 0;
  const withBalance = entries.map((e) => { running += e.debit - e.credit; return { ...e, balance: running }; });

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-sm flex items-center gap-1 text-slate-500 hover:text-slate-800">
        <ChevronLeft size={15} /> Back to clients
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl" style={{ color: INK }}>{client.name}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{client.phone} {client.address ? `· ${client.address}` : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[11px] uppercase text-slate-500">Current Due</div>
            <div className="font-display text-xl" style={{ color: due > 0 ? ROSE : EMERALD }}>{money(due)}</div>
          </div>
          <PrimaryButton onClick={() => setShowPay(true)}><Wallet size={16} /> Record Payment</PrimaryButton>
        </div>
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
                <td className="px-4 py-3 text-slate-500">{fmtDate(e.date)}</td>
                <td className="px-4 py-3">
                  {e.type === "invoice" ? <Pill color={TEAL}>Sale</Pill> : <Pill color={EMERALD}>Payment</Pill>}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{e.ref}</td>
                <td className="px-4 py-3 text-right font-mono">{e.debit ? money(e.debit) : "—"}</td>
                <td className="px-4 py-3 text-right font-mono">{e.credit ? money(e.credit) : "—"}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: e.balance > 0 ? ROSE : INK }}>{money(e.balance)}</td>
                <td className="px-4 py-3 text-right">
                  {e.type === "invoice" && (
                    <button onClick={() => onPrint(e.id)} className="text-xs font-medium flex items-center gap-1 ml-auto" style={{ color: TEAL }}><Printer size={13} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showPay && (
        <PaymentModal client={client} onClose={() => setShowPay(false)} onSave={(amount, date, note) => { onAddPayment(amount, date, note); setShowPay(false); }} />
      )}
    </div>
  );
}

function ClientFormModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name: "", phone: "", address: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = (e) => { e.preventDefault(); if (!form.name) return; onSave({ name: form.name.trim(), phone: form.phone.trim(), address: form.address.trim() }); };
  return (
    <Modal onClose={onClose} title="Add Client">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Client / shop name"><input autoFocus className={inputCls} style={inputStyle} value={form.name} onChange={(e) => set("name", e.target.value)} required /></Field>
        <Field label="Phone"><input className={inputCls} style={inputStyle} value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Address"><input className={inputCls} style={inputStyle} value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit">Save Client</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function PaymentModal({ client, onClose, onSave }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  return (
    <Modal onClose={onClose} title={`Record Payment — ${client.name}`}>
      <div className="space-y-4">
        <Field label="Amount received (৳)"><input type="number" autoFocus className={inputCls} style={inputStyle} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Date"><input type="date" className={inputCls} style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Note (optional)"><input className={inputCls} style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Cash / bKash / Bank" /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={() => amount && onSave(Number(amount), date, note)}>Save Payment</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------- Users / Staff accounts (admin only) ---------------------------------- */

function UsersView({ users, currentUser, notify, notifyErr }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const saveStaff = async (data) => {
    try {
      if (editing) {
        // Editing never touches login credentials — just permissions/name.
        const { name, tabs } = data;
        await updateDoc(doc(db, "users", editing.id), { name, tabs });
        await updateDoc(doc(db, "directory", editing.id), { name });
        notify("Staff account updated");
      } else {
        // 1) Register a real Firebase Auth login for this person (their
        //    PIN becomes their password) without disturbing the admin's
        //    own signed-in session.
        const uid = await registerAuthAccount(data.username, data.pin);
        await resetSecondaryAuth();
        // 2) Write their profile + public directory entry as the admin.
        await setDoc(doc(db, "users", uid), { name: data.name, username: data.username, role: "staff", active: true, tabs: data.tabs });
        await setDoc(doc(db, "directory", uid), { name: data.name, username: data.username, role: "staff", active: true });
        notify("Staff account created");
      }
      setShowForm(false); setEditing(null);
    } catch (e) {
      notifyErr(e.code === "auth/email-already-in-use"
        ? { message: "That name is already taken — try a slightly different name." }
        : e);
    }
  };

  const toggleActive = async (u) => {
    try {
      await updateDoc(doc(db, "users", u.id), { active: !u.active });
      await updateDoc(doc(db, "directory", u.id), { active: !u.active });
      notify(u.active ? "Account deactivated" : "Account activated");
    } catch (e) { notifyErr(e); }
  };

  const removeStaff = async (u) => {
    if (!confirm(`Remove staff account "${u.name}"? They will immediately lose access.`)) return;
    try {
      await deleteDoc(doc(db, "users", u.id));
      await deleteDoc(doc(db, "directory", u.id));
      notify("Staff account removed");
    } catch (e) { notifyErr(e); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl" style={{ color: INK }}>Staff Accounts</h1>
          <p className="text-sm text-slate-500 mt-0.5">Admin and Manager are fixed. Add limited staff accounts as needed.</p>
        </div>
        <PrimaryButton onClick={() => { setEditing(null); setShowForm(true); }}><UserPlus size={16} /> Add Staff Account</PrimaryButton>
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
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-0 hover:bg-stone-50" style={{ borderColor: "#f0ebe0" }}>
                <td className="px-4 py-3 font-medium">{u.name}{u.id === currentUser.id && <span className="text-slate-400 font-normal text-xs"> (you)</span>}</td>
                <td className="px-4 py-3"><Pill color={roleColor(u.role)}>{roleLabel(u.role)}</Pill></td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {u.role === "admin" ? "Everything" : u.role === "manager" ? "Everything except staff accounts" : (u.tabs || []).map((t) => ALL_TABS.find((n) => n.id === t)?.label).filter(Boolean).join(", ") || "None"}
                </td>
                <td className="px-4 py-3">
                  {u.active !== false ? <Pill color={EMERALD}>Active</Pill> : <Pill color={ROSE}>Inactive</Pill>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {u.role === "staff" ? (
                    <>
                      <button onClick={() => { setEditing(u); setShowForm(true); }} className="text-xs font-medium px-2 py-1 rounded" style={{ color: GOLD }}><Pencil size={12} className="inline" /></button>
                      <button onClick={() => toggleActive(u)} className="text-xs font-medium px-2 py-1 rounded ml-1" style={{ color: TEAL }}><Power size={12} className="inline" /></button>
                      <button onClick={() => removeStaff(u)} className="text-xs font-medium px-2 py-1 rounded ml-1" style={{ color: ROSE }}><Trash2 size={12} className="inline" /></button>
                    </>
                  ) : (
                    <span className="text-xs text-slate-300">fixed role</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showForm && <StaffFormModal initial={editing} onClose={() => { setShowForm(false); setEditing(null); }} onSave={saveStaff} />}
    </div>
  );
}

function StaffFormModal({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [pin, setPin] = useState("");
  const [tabs, setTabs] = useState(initial?.tabs || ["dashboard", "sale"]);
  const [err, setErr] = useState("");

  const toggleTab = (id) => setTabs((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Enter a name."); return; }
    if (!initial && pin.length !== 6) { setErr("PIN must be exactly 6 digits."); return; }
    if (tabs.length === 0) { setErr("Give access to at least one section."); return; }
    const data = initial
      ? { name: name.trim(), tabs }
      : { name: name.trim(), username: slugUser(name), tabs, pin };
    onSave(data);
  };

  return (
    <Modal onClose={onClose} title={initial ? "Edit Staff Account" : "Add Staff Account"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Staff name"><input autoFocus className={inputCls} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        {!initial && (
          <Field label="PIN (exactly 6 digits)">
            <input type="password" inputMode="numeric" maxLength={6} className={inputCls} style={inputStyle} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          </Field>
        )}
        {initial && (
          <div className="text-xs text-slate-400 -mt-1">PINs can only be changed by the staff member themselves, from their own "Change PIN" menu after logging in.</div>
        )}
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

function InvoiceModal({ invoice, client, onClose }) {
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

          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <LogoMark size={48} />
              <div>
                <div className="font-display text-2xl leading-tight" style={{ color: INK }}>{COMPANY.name}</div>
                <div className="text-xs font-medium" style={{ color: GOLD }}>{COMPANY.tagline}</div>
              </div>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div className="font-mono text-sm font-semibold" style={{ color: INK }}>{invoice.invoiceNo}</div>
              <div>Challan: {invoice.challanNo}</div>
              <div>{fmtDate(invoice.date)}</div>
            </div>
          </div>

          <div className="text-center text-[11px] text-slate-500 leading-relaxed mb-6 pb-3 border-b" style={{ borderColor: "#e7e0d3" }}>
            <div>Head Office: {COMPANY.address}</div>
            <div>Hotline: {COMPANY.hotline}, Tel: {COMPANY.tel}, E-mail: {COMPANY.email}, Web: {COMPANY.web}</div>
          </div>

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

          <div className="mt-10 pt-4 border-t text-[11px] text-slate-400 flex justify-between" style={{ borderColor: "#eee6d3" }}>
            <span>Goods once sold as per this challan are recorded against the client ledger.</span>
            <span>Authorized Signature ______________</span>
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
