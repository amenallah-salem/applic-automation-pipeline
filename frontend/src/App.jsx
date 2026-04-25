import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IconBriefcase,
  IconClose,
  IconDoc,
  IconExternal,
  IconMoon,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSpark,
  IconSun,
  IconTrash,
  IconWebhook,
} from './icons.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const STATUSES = ['saved', 'applied', 'interview', 'rejected', 'offer'];
const DOC_TYPES = [
  { value: 'cv', label: 'CV' },
  { value: 'cover_letter', label: 'Cover letter' },
  { value: 'message', label: 'Message' },
];

const NAV_ITEMS = [
  { id: 'jobs',      label: 'Applications', icon: IconBriefcase },
  { id: 'documents', label: 'Documents',    icon: IconDoc },
  { id: 'generate',  label: 'AI Generate',  icon: IconSpark },
  { id: 'webhooks',  label: 'Webhooks',     icon: IconWebhook },
];

const emptyForm = {
  company_name: '',
  job_title: '',
  job_url: '',
  source: '',
  status: 'saved',
};

// ----- theme ---------------------------------------------------------------
function useTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light';
    return localStorage.getItem('theme') || 'light';
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))];
}

// ----- presentational pieces ----------------------------------------------
function StatusChip({ status }) {
  return <span className={`chip chip-${status}`}>{status}</span>;
}

function Stat({ label, value, tone }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function Sidebar({ active, onNavigate }) {
  return (
    <aside className="sidebar" aria-label="Primary">
      <div className="brand">
        <div className="brand-logo">A</div>
        <span>Applic</span>
      </div>
      <div className="nav-section">Workspace</div>
      <nav>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${active === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <Icon />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="nav-section">System</div>
      <nav>
        <button type="button" className="nav-item">
          <IconSettings />
          <span>Settings</span>
        </button>
      </nav>
    </aside>
  );
}

function TopBar({ search, onSearch, theme, onToggleTheme }) {
  return (
    <header className="topbar">
      <div className="brand-mobile">
        <div className="brand-logo" style={{ width: 28, height: 28, fontSize: 13 }}>A</div>
        <span>Applic</span>
      </div>
      <div className="search">
        <span className="search-icon"><IconSearch /></span>
        <input
          aria-label="Search applications"
          placeholder="Search by company, title, source…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="icon-btn"
        title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        aria-label="Toggle theme"
        onClick={onToggleTheme}
      >
        {theme === 'light' ? <IconMoon /> : <IconSun />}
      </button>
    </header>
  );
}

function JobModal({ open, onClose, onSubmit, form, setForm }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>New application</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <form
          className="modal-body"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="form-grid">
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Company</label>
              <input
                required
                className="input"
                value={form.company_name}
                onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                autoFocus
              />
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Job title</label>
              <input
                required
                className="input"
                value={form.job_title}
                onChange={(e) => setForm({ ...form, job_title: e.target.value })}
              />
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Job URL</label>
              <input
                className="input"
                placeholder="https://…"
                value={form.job_url}
                onChange={(e) => setForm({ ...form, job_url: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Source</label>
              <input
                className="input"
                placeholder="linkedin, glassdoor…"
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Status</label>
              <select
                className="select"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-text" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">
              <IconPlus /> Add application
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DocumentsDrawer({ job, documents, onClose, onGenerate }) {
  if (!job) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Documents">
        <div className="drawer-header">
          <div>
            <h3>Documents</h3>
            <div className="subtitle">
              {job.company_name} — {job.job_title}
            </div>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div className="drawer-body">
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {DOC_TYPES.map((d) => (
              <button
                key={d.value}
                className="btn btn-tonal btn-sm"
                onClick={() => onGenerate(job, d.value)}
              >
                <IconSpark /> Generate {d.label}
              </button>
            ))}
          </div>

          {documents.length === 0 && (
            <div className="empty-state" style={{ padding: '32px 12px' }}>
              <h4>No documents yet</h4>
              <p>Click a "Generate" button above to create one.</p>
            </div>
          )}

          {documents.map((d) => (
            <div key={d.id} className="doc-card">
              <div className="doc-head">
                <IconDoc />
                <span>{d.type.replace('_', ' ')}</span>
                <span className="meta">{new Date(d.created_at).toLocaleString()}</span>
              </div>
              <pre>{d.content}</pre>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

// ----- main app ------------------------------------------------------------
export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [view, setView] = useState('jobs');

  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const url = filter
        ? `${API_BASE}/jobs?status=${encodeURIComponent(filter)}`
        : `${API_BASE}/jobs`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GET /jobs failed: ${res.status}`);
      setJobs(await res.json());
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  async function createJob() {
    try {
      const res = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`POST /jobs failed: ${res.status}`);
      setForm(emptyForm);
      setModalOpen(false);
      loadJobs();
    } catch (e) {
      setError(String(e));
    }
  }

  async function updateStatus(id, status) {
    await fetch(`${API_BASE}/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    loadJobs();
  }

  async function deleteJob(id) {
    if (!window.confirm('Delete this application?')) return;
    await fetch(`${API_BASE}/jobs/${id}`, { method: 'DELETE' });
    if (selectedJob?.id === id) {
      setSelectedJob(null);
      setDocuments([]);
    }
    loadJobs();
  }

  async function viewDocuments(job) {
    setSelectedJob(job);
    const res = await fetch(
      `${API_BASE}/documents?job_id=${encodeURIComponent(job.id)}`
    );
    setDocuments(await res.json());
  }

  async function generateDoc(job, type) {
    await fetch(`${API_BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: job.id, type }),
    });
    viewDocuments(job);
  }

  // ----- derived state ----
  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) =>
      [j.company_name, j.job_title, j.source]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q))
    );
  }, [jobs, search]);

  const stats = useMemo(() => {
    const counts = STATUSES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
    jobs.forEach((j) => { if (counts[j.status] != null) counts[j.status]++; });
    return { total: jobs.length, ...counts };
  }, [jobs]);

  return (
    <div className="app-shell">
      <Sidebar active={view} onNavigate={setView} />
      <TopBar
        search={search}
        onSearch={setSearch}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main className="main">
        {error && (
          <div className="banner banner-error">
            <span>{error}</span>
          </div>
        )}

        {view === 'jobs' && (
          <>
            <div className="main-header">
              <div>
                <h2>Applications</h2>
                <div className="subtitle">
                  Track every job you've saved, applied to, and interviewed for.
                </div>
              </div>
              <div className="actions">
                <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
                  <IconPlus /> Add application
                </button>
              </div>
            </div>

            <div className="stats-grid">
              <Stat label="Total"     value={stats.total} />
              <Stat label="Saved"     value={stats.saved} />
              <Stat label="Applied"   value={stats.applied}   tone="primary" />
              <Stat label="Interview" value={stats.interview} tone="warning" />
              <Stat label="Offer"     value={stats.offer}     tone="success" />
            </div>

            <div className="table-wrap">
              <div className="table-toolbar">
                <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <label htmlFor="status-filter">Status</label>
                  <select
                    id="status-filter"
                    className="select"
                    style={{ width: 160 }}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="">All</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <span className="count">
                  {loading ? 'Loading…' : `${filteredJobs.length} of ${jobs.length}`}
                </span>
              </div>

              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Score</th>
                    <th className="col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-state">
                          <h4>No applications {search ? 'match your search' : 'yet'}</h4>
                          <p>
                            {search
                              ? 'Try a different keyword or clear the filter.'
                              : 'Click “Add application” to log your first one.'}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {filteredJobs.map((j) => (
                    <tr key={j.id}>
                      <td><strong>{j.company_name}</strong></td>
                      <td>
                        {j.job_url ? (
                          <a
                            href={j.job_url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            {j.job_title} <IconExternal />
                          </a>
                        ) : (
                          j.job_title
                        )}
                      </td>
                      <td>
                        <select
                          className="select"
                          style={{ width: 140, height: 32 }}
                          value={j.status}
                          onChange={(e) => updateStatus(j.id, e.target.value)}
                        >
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td>
                        {j.source ? <StatusChip status="saved" /> : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                        {j.source && <span style={{ marginLeft: 8 }}>{j.source}</span>}
                      </td>
                      <td>
                        {j.score != null
                          ? <strong>{j.score}</strong>
                          : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                      </td>
                      <td className="col-actions">
                        <button
                          className="btn btn-tonal btn-sm"
                          onClick={() => viewDocuments(j)}
                          title="View / generate documents"
                        >
                          <IconDoc /> Docs
                        </button>
                        <button
                          className="icon-btn"
                          aria-label="Delete"
                          title="Delete"
                          onClick={() => deleteJob(j.id)}
                          style={{ color: 'var(--danger)' }}
                        >
                          <IconTrash />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {view === 'documents' && (
          <>
            <div className="main-header">
              <div>
                <h2>Documents</h2>
                <div className="subtitle">Pick an application to see its generated artifacts.</div>
              </div>
            </div>
            <div className="card">
              <h3>How it works</h3>
              <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>
                Open <strong>Applications</strong>, click the <em>Docs</em> button on a row,
                and generate a CV, cover letter, or outreach message in one click.
              </p>
            </div>
          </>
        )}

        {view === 'generate' && (
          <>
            <div className="main-header">
              <div>
                <h2>AI Generate</h2>
                <div className="subtitle">Driven by Open WebUI + Groq. Connect & seed via <code>scripts/seed_openwebui.py</code>.</div>
              </div>
            </div>
            <div className="card">
              <h3>Models live in Open WebUI</h3>
              <div className="card-subtitle">
                Once seeded, Groq models appear at the top of the chat picker.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <a
                  className="btn btn-primary"
                  href="http://localhost:3001"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open WebUI <IconExternal />
                </a>
                <a
                  className="btn btn-text"
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noreferrer"
                >
                  Get a Groq API key
                </a>
              </div>
            </div>
          </>
        )}

        {view === 'webhooks' && (
          <>
            <div className="main-header">
              <div>
                <h2>Webhooks</h2>
                <div className="subtitle">n8n flows hit <code>POST /webhooks/n8n</code>.</div>
              </div>
            </div>
            <div className="card">
              <h3>n8n editor</h3>
              <div className="card-subtitle">Basic-auth credentials are in your <code>.env</code>.</div>
              <a
                className="btn btn-primary"
                href="http://localhost:5678"
                target="_blank"
                rel="noreferrer"
              >
                Open n8n <IconExternal />
              </a>
            </div>
          </>
        )}
      </main>

      <JobModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={createJob}
        form={form}
        setForm={setForm}
      />

      <DocumentsDrawer
        job={selectedJob}
        documents={documents}
        onClose={() => { setSelectedJob(null); setDocuments([]); }}
        onGenerate={generateDoc}
      />
    </div>
  );
}
