export default function InsightsDrawer({ text, loading, error, onGenerate }) {
  const hasContent = text?.length > 0;

  return (
    <div className="insights-drawer">
      <div className="section-label" style={{ marginBottom: 8 }}>AI Market Insights</div>

      {!hasContent && !loading && !error && (
        <button className="btn btn-accent" onClick={onGenerate}>
          Generate Insights
        </button>
      )}

      {loading && (
        <div className="insights-loading">
          <span className="loading-spinner" style={{ width: 14, height: 14 }} />
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Analysing region…</span>
        </div>
      )}

      {error && (
        <div className="insights-error">
          <span style={{ color: 'var(--score-low)', fontSize: 12 }}>{error}</span>
          <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={onGenerate}>
            Retry
          </button>
        </div>
      )}

      {hasContent && (
        <div className="insights-text">
          {text}
          {loading && <span className="insights-cursor" />}
        </div>
      )}
    </div>
  );
}
