export default function NotFound() {
  return (
    <section className="sus-page">
      <div className="card sus-card">
        <p className="sus-badge">404</p>
        <h1 className="sus-title">Nothing sus here.</h1>
        <p className="sus-copy">
          This slug does not exist. Either someone mistyped a perfectly
          legitimate URL, or this link was never sus to begin with.
        </p>
        <a className="btn btn-primary sus-continue" href="/">
          Back to the sus factory
        </a>
      </div>
    </section>
  );
}
