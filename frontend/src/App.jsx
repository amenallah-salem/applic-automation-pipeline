import { useCallback, useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const STATUSES = ['saved', 'applied', 'interview', 'rejected', 'offer'];
const DOC_TYPES = [
  { value: 'cv', label: 'CV' },
  { value: 'cover_letter', label: 'Cover letter' },
  { value: 'message', label: 'Message' },
];

const emptyForm = {
  company_name: '',
  job_title: '',
  job_url: '',
  source: '',
  status: 'saved',
};

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [selectedJob, setSelectedJob] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState('');

  const loadJobs = useCallback(async () => {
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
    }
  }, [filter]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  async function createJob(e) {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`POST /jobs failed: ${res.status}`);
      setForm(emptyForm);
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

  return (
    <div className="container">
      <h1>Applic Automation — Dashboard</h1>
      {error && <div className="error">{error}</div>}

      <section>
        <h2>Add application</h2>
        <form onSubmit={createJob} className="form-row">
          <input
            required
            placeholder="Company"
            value={form.company_name}
            onChange={(e) => setForm({ ...form, company_name: e.target.value })}
          />
          <input
            required
            placeholder="Job title"
            value={form.job_title}
            onChange={(e) => setForm({ ...form, job_title: e.target.value })}
          />
          <input
            placeholder="URL"
            value={form.job_url}
            onChange={(e) => setForm({ ...form, job_url: e.target.value })}
          />
          <input
            placeholder="Source (linkedin, glassdoor…)"
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
          />
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="submit">Add</button>
        </form>
      </section>

      <section>
        <h2>Applications</h2>
        <label>Filter by status: </label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">all</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Title</th>
              <th>Status</th>
              <th>Source</th>
              <th>Score</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--muted)' }}>
                  No applications yet.
                </td>
              </tr>
            )}
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{j.company_name}</td>
                <td>
                  {j.job_url ? (
                    <a href={j.job_url} target="_blank" rel="noreferrer">
                      {j.job_title}
                    </a>
                  ) : (
                    j.job_title
                  )}
                </td>
                <td>
                  <select
                    value={j.status}
                    onChange={(e) => updateStatus(j.id, e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{j.source || '—'}</td>
                <td>{j.score ?? '—'}</td>
                <td>
                  <button onClick={() => viewDocuments(j)}>Docs</button>
                  {DOC_TYPES.map((d) => (
                    <button key={d.value} onClick={() => generateDoc(j, d.value)}>
                      Gen {d.label}
                    </button>
                  ))}
                  <button onClick={() => deleteJob(j.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {selectedJob && (
        <section>
          <h2>
            Documents for {selectedJob.company_name} — {selectedJob.job_title}
          </h2>
          <button
            onClick={() => {
              setSelectedJob(null);
              setDocuments([]);
            }}
          >
            Close
          </button>
          {documents.length === 0 && <p>No documents yet.</p>}
          {documents.map((d) => (
            <div key={d.id} className="doc">
              <h3>{d.type}</h3>
              <pre>{d.content}</pre>
              <small>{new Date(d.created_at).toLocaleString()}</small>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
