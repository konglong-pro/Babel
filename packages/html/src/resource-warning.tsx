export function HtmlResourceWarning({ warnings, checking = false, importing = false }: { warnings: readonly string[]; checking?: boolean; importing?: boolean }) {
  if (checking) return <p className="babel-pdf-folders__hint" role="status">Checking local styles, scripts and images…</p>;
  if (!warnings.length) return null;
  return <details className="babel-html-resource-warning" open>
    <summary>Some document resources are unavailable ({warnings.length})</summary>
    <p>Layout, formulas or interactive diagrams may be incomplete. Choose Folder batch and select the project folder containing both the HTML and its resources, such as the parent of modules and assets.{importing && " Import can continue with these warnings."}</p>
    <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
  </details>;
}
