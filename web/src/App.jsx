import { useState, useRef, useCallback, useEffect } from "react";

const MAX_FILES = 10;
const ACCEPTED = ".pdf,.png,.jpg,.jpeg,.tiff,.tif";

// ── Status → display mapping ──────────────────────────────
const TAGS = {
  waiting:    { cls: "tag-waiting",    label: "Queued" },
  processing: { cls: "tag-processing", label: "Reading" },
  renamed:    { cls: "tag-renamed",    label: "Renamed" },
  needs_review: { cls: "tag-review",   label: "Review" },
  failed:     { cls: "tag-failed",     label: "Failed" },
};

const ROW_CLS = {
  waiting: "is-waiting",
  processing: "is-processing",
  renamed: "is-renamed",
  needs_review: "is-review",
  failed: "is-failed",
};

function useCurrentUser() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    // Static Web Apps exposes the logged-in user here
    fetch("/.auth/me")
      .then((r) => r.json())
      .then((d) => {
        const p = d?.clientPrincipal;
        if (p) setUser(p.userDetails);
      })
      .catch(() => {});
  }, []);
  return user;
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const user = useCurrentUser();

  const addFiles = useCallback((incoming) => {
    const arr = Array.from(incoming).slice(0, MAX_FILES);
    setFiles(arr);
    setResults([]);
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const processAll = useCallback(async () => {
    if (!files.length) return;
    setRunning(true);

    // Seed all rows as waiting
    const seed = files.map((f) => ({
      key: f.name + f.size,
      original: f.name,
      status: "waiting",
    }));
    setResults(seed);

    // Process sequentially so the team sees each one resolve
    for (let i = 0; i < files.length; i++) {
      const f = files[i];

      setResults((prev) =>
        prev.map((r, idx) =>
          idx === i ? { ...r, status: "processing" } : r
        )
      );

      try {
        const form = new FormData();
        form.append("file", f);

        const resp = await fetch("/api/process", {
          method: "POST",
          body: form,
        });

        const data = await resp.json();

        setResults((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? {
                  ...r,
                  status: data.status === "error" ? "failed" : data.status,
                  newName: data.newName,
                  downloadUrl: data.downloadUrl,
                  fields: data.fields,
                  notes: data.notes,
                  message: data.message,
                }
              : r
          )
        );
      } catch (err) {
        setResults((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? { ...r, status: "failed", message: String(err) }
              : r
          )
        );
      }
    }

    setRunning(false);
  }, [files]);

  const tally = results.reduce(
    (acc, r) => {
      if (r.status === "renamed") acc.renamed++;
      else if (r.status === "needs_review") acc.review++;
      else if (r.status === "failed") acc.failed++;
      return acc;
    },
    { renamed: 0, review: 0, failed: 0 }
  );

  return (
    <>
      {/* ── Brand top bar ── */}
      <div className="topbar">
        <div className="topbar-inner">
          <img className="topbar-logo" src="/logo.png" alt="Aussiewide Financial Services" />
          {user && (
            <div className="topbar-user">
              {user} · <a href="/.auth/logout">Sign out</a>
            </div>
          )}
        </div>
      </div>

      <div className="shell">
        {/* ── Intro ── */}
        <div className="intro">
          <div className="intro-eyebrow">Docs to lender</div>
          <h1 className="intro-title">Statement Renamer</h1>
          <p className="intro-lede">
            Drop in a client's bank statements and they're renamed to our
            standard convention automatically — bank, account type, balance,
            account number, and statement period.
          </p>
        </div>

        {/* ── Drop zone ── */}
        <div
          className={"dropzone" + (dragging ? " dragging" : "")}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="dropzone-icon">↑</div>
          <div className="dropzone-primary">
            Drop bank statements here, or click to choose
          </div>
          <div className="dropzone-secondary">
            Up to {MAX_FILES} files · PDF, PNG, JPG, TIFF
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED}
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </div>

      {/* ── Action row ── */}
      {files.length > 0 && (
        <div className="action-row">
          <span className="selected-count">
            <strong>{files.length}</strong> file
            {files.length === 1 ? "" : "s"} selected
          </span>
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setFiles([]);
                setResults([]);
              }}
              disabled={running}
            >
              Clear
            </button>
            <button
              className="btn btn-primary"
              onClick={processAll}
              disabled={running}
            >
              {running ? "Processing…" : `Rename ${files.length}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Results ledger ── */}
      {results.length > 0 && (
        <section className="ledger">
          <div className="ledger-head">
            <h2 className="ledger-title">Results</h2>
            <span className="ledger-tally">
              {tally.renamed} renamed · {tally.review} review ·{" "}
              {tally.failed} failed
            </span>
          </div>

          {results.map((r) => (
            <StatementRow key={r.key} r={r} />
          ))}
        </section>
      )}

      {/* ── Footnote ── */}
      <p className="footnote">
        Files are read by Azure Document Intelligence and renamed to the
        standard convention: bank, account type, balance, last four digits,
        and statement period. Originals are never altered here — you download
        a renamed copy. The automatic SharePoint sync runs separately every
        15 minutes.
      </p>
      </div>
    </>
  );
}

// ── A single result row ───────────────────────────────────
function StatementRow({ r }) {
  const tag = TAGS[r.status] || TAGS.waiting;
  const rowCls = ROW_CLS[r.status] || "";

  return (
    <div className={"row " + rowCls}>
      <div className="row-top">
        <span className="row-original">{r.original}</span>
        <span className={"tag " + tag.cls}>
          {r.status === "processing" && <span className="spinner" />}
          {tag.label}
        </span>
      </div>

      {/* Renamed — show the transformation */}
      {r.status === "renamed" && r.newName && (
        <>
          <div className="transform">
            <div className="transform-new">
              <span className="transform-arrow">→</span>
              <span>{r.newName}</span>
            </div>
          </div>

          {r.fields && (
            <div className="fields">
              {r.fields.bank && (
                <span className="chip">
                  bank <strong>{r.fields.bank}</strong>
                </span>
              )}
              {r.fields.accountType && (
                <span className="chip">
                  type <strong>{r.fields.accountType}</strong>
                </span>
              )}
              {r.fields.balance != null && (
                <span className="chip">
                  bal <strong>{r.fields.balance}</strong>
                </span>
              )}
              {r.fields.last4 && (
                <span className="chip">
                  acct <strong>••{r.fields.last4}</strong>
                </span>
              )}
              {r.fields.periodStart && r.fields.periodEnd && (
                <span className="chip">
                  <strong>
                    {r.fields.periodStart} → {r.fields.periodEnd}
                  </strong>
                </span>
              )}
            </div>
          )}

          {r.downloadUrl && (
            <a className="download" href={r.downloadUrl} target="_blank" rel="noreferrer">
              ↓ Download renamed file
            </a>
          )}
        </>
      )}

      {/* Needs review */}
      {r.status === "needs_review" && (
        <div className="note">
          Couldn't confirm all details:{" "}
          {(r.notes || []).join("; ") || "extraction incomplete"}
        </div>
      )}

      {/* Failed */}
      {r.status === "failed" && (
        <div className="note">{r.message || "Processing failed"}</div>
      )}
    </div>
  );
}
