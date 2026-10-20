"use client";

import { CHEMISTRY_TEMPLATES, type ChemistryTemplateId } from "@/lib/chemistry-templates";

interface CarbonWelcomeProps {
  noteCount: number;
  folderCount: number;
  busy: boolean;
  onCreate: (templateId?: ChemistryTemplateId) => void;
  onBrowse: () => void;
}

export function CarbonWelcome({ noteCount, folderCount, busy, onCreate, onBrowse }: CarbonWelcomeProps) {
  return (
    <>
      <div className="carbon-welcome-top">
        <span className="carbon-edition">FIELD NOTES / No. 006</span>
        <button className="carbon-browse" type="button" onClick={onBrowse}>Browse notes <span aria-hidden="true">↗</span></button>
      </div>
      <div className="carbon-poster">
        <span className="carbon-tape" aria-hidden="true" />
        <p className="carbon-kicker"><span aria-hidden="true">✳</span> A LITTLE CURIOSITY. A LOT OF CHEMISTRY.</p>
        <h1>THINK.<br />REACT.<br /><span>REMEMBER.</span></h1>
        <p className="carbon-intro">Good ideas make strong bonds.</p>
        <p className="carbon-description">A home for your concepts, reactions, and lab discoveries.<br />Put it on paper. Connect the dots. Make it stick.</p>
        <button className="carbon-start" type="button" disabled={busy} onClick={() => onCreate()}>
          <span aria-hidden="true">＋</span> {busy ? "Getting ready…" : "New chemistry note"} <span aria-hidden="true">↗</span>
        </button>
        <svg className="carbon-molecule" viewBox="0 0 180 180" fill="none" aria-hidden="true">
          <path d="m90 30 52 30v60l-52 30-52-30V60Z" stroke="currentColor" strokeWidth="3" />
          <path d="m90 43 41 24m0 46-41 24m-41-24V67M90 30V9m52 51 22-13m-22 73 22 13M90 150v21m-52-51-22 13m22-73L16 47" stroke="currentColor" strokeWidth="3" />
          <circle cx="90" cy="90" r="26" stroke="currentColor" strokeWidth="2" strokeDasharray="4 5" />
        </svg>
        <div className="carbon-sticker" aria-hidden="true"><small>ELEMENT OF CURIOSITY</small><strong>C</strong><span>06 / 12.011</span></div>
        <span className="carbon-handwritten" aria-hidden="true">stay curious ↗</span>
      </div>
      <div className="carbon-starters" aria-label="Chemistry note starters">
        <div className="carbon-starters-heading"><span>START WITH A SPARK</span><span>↓ PICK A TEMPLATE</span></div>
        <div className="carbon-starter-grid">
          {CHEMISTRY_TEMPLATES.map((template, index) => (
            <button key={template.id} type="button" disabled={busy} onClick={() => onCreate(template.id)}>
              <span className="carbon-starter-number">0{index + 1}<span aria-hidden="true">↗</span></span>
              <strong>{template.name}</strong>
              <span>{template.description}</span>
            </button>
          ))}
        </div>
      </div>
      <footer className="carbon-welcome-footer"><span>{String(noteCount).padStart(2, "0")} NOTES · {String(folderCount).padStart(2, "0")} FOLDERS</span><span><i aria-hidden="true" /> LOCAL BY NATURE.</span></footer>
    </>
  );
}
