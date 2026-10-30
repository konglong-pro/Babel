import type { NoteTemplateDto } from "@/lib/types";

export const CHEMISTRY_TEMPLATES = [
  {
    id: "chemistry:concept",
    name: "Concept",
    description: "Connect definitions, relationships, and questions.",
    contentMd: `# Concept

## Definition

<!-- Define the concept in your own words, including its scope and assumptions. -->

## Key relationships

<!-- Connect related concepts; wrap an existing note title in double brackets to link it. -->

## Formulas & notation

<!-- Record formulas, defining each symbol, its units, and applicable conditions. -->

## Questions

<!-- List questions you still need to understand or verify. -->

## Sources

<!-- Record textbook pages, references, or links. -->
`,
  },
  {
    id: "chemistry:reaction",
    name: "Reaction",
    description: "Study an equation, its mechanism, and supporting evidence.",
    contentMd: `# Reaction

## Overview

<!-- Summarize the reaction and the chemical concepts involved. -->

## Equation

<!-- Record the balanced equation, explaining states, charges, and symbols. -->

## Conditions & scope

<!-- Note the applicable conditions and limitations described in your sources. -->

## Mechanism

<!-- Explain key electron transfers or bond changes and link related concept notes. -->

## Evidence & observations

<!-- Distinguish direct observations, published findings, and your own inferences. -->

## Questions & sources

<!-- List open questions and their reference sources. -->
`,
  },
  {
    id: "chemistry:experiment",
    name: "Experiment",
    description: "Keep observations, measurements, and conclusions together.",
    contentMd: `# Experiment

## Question

<!-- State the question or hypothesis the experiment will test. -->

## Reference & context

<!-- Record the approved procedure's source, date, and relevant context. -->

## Safety & waste

<!-- Follow your lab's requirements to record risk assessments, precautions, and waste guidance sources. -->

## Observations & data

<!-- Record observations and measurements with units, significant figures, and raw data sources. -->

## Analysis & uncertainty

<!-- Explain calculations, sources of error, and limitations of the results. -->

## Conclusion & next questions

<!-- Answer the original question using evidence and note what remains unresolved. -->
`,
  },
] as const;

export type ChemistryTemplateId = (typeof CHEMISTRY_TEMPLATES)[number]["id"];

export function resolveNoteTemplateContent(
  templateId: string,
  customTemplates: readonly Pick<NoteTemplateDto, "id" | "contentMd">[],
): string | undefined {
  if (templateId === "") return "";
  return CHEMISTRY_TEMPLATES.find((template) => template.id === templateId)?.contentMd
    ?? customTemplates.find((template) => String(template.id) === templateId)?.contentMd;
}
