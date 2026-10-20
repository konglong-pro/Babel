import type { NoteTemplateDto } from "@/lib/types";

export const CHEMISTRY_TEMPLATES = [
  {
    id: "chemistry:concept",
    name: "Concept",
    description: "Connect definitions, relationships, and questions.",
    contentMd: `# Concept

## Definition

<!-- 用自己的话写下定义、适用范围与前提。 -->

## Key relationships

<!-- 记录与其他概念的联系；用双方括号包围已有笔记标题来创建连接。 -->

## Formulas & notation

<!-- 写下所用公式，注明每个符号的含义、单位与适用条件。 -->

## Questions

<!-- 记下尚未理解或需要验证的问题。 -->

## Sources

<!-- 记录教材页码、文献或链接。 -->
`,
  },
  {
    id: "chemistry:reaction",
    name: "Reaction",
    description: "Study an equation, its mechanism, and supporting evidence.",
    contentMd: `# Reaction

## Overview

<!-- 概括所研究的反应与它涉及的化学概念。 -->

## Equation

<!-- 记录配平后的方程式，并说明物态、电荷和符号。 -->

## Conditions & scope

<!-- 注明参考来源描述的适用条件和限制。 -->

## Mechanism

<!-- 说明关键的电子转移或化学键变化，并连接相关概念笔记。 -->

## Evidence & observations

<!-- 区分直接观察、文献结论与自己的推断。 -->

## Questions & sources

<!-- 列出待验证问题和参考来源。 -->
`,
  },
  {
    id: "chemistry:experiment",
    name: "Experiment",
    description: "Keep observations, measurements, and conclusions together.",
    contentMd: `# Experiment

## Question

<!-- 写下实验要回答的问题或检验的假设。 -->

## Reference & context

<!-- 记录已批准的实验方案来源、日期及相关背景。 -->

## Safety & waste

<!-- 按实验室要求记录风险评估、防护措施与废弃物处置来源。 -->

## Observations & data

<!-- 记录实际观察与测量，保留单位、有效数字和原始数据来源。 -->

## Analysis & uncertainty

<!-- 说明计算过程、误差来源及结果的局限。 -->

## Conclusion & next questions

<!-- 根据证据回答最初的问题，并注明尚未解决之处。 -->
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
