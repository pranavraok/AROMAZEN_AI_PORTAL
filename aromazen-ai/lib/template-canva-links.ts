const CANVA_EDIT_URL_BY_TEMPLATE_CATEGORY: Readonly<Record<string, string>> = {
  'hr_letter_template:offer': 'https://www.canva.com/d/0_iafxW7i0_VY7g',
}

export function canvaEditUrlForHrLetter(templateKey: string): string | null {
  return CANVA_EDIT_URL_BY_TEMPLATE_CATEGORY[`hr_letter_template:${templateKey}`] ?? null
}

export function canvaEditUrlForKnowledgeTemplate(documentCategory: string | null): string | null {
  if (!documentCategory?.startsWith('hr_letter_template:')) return null
  return CANVA_EDIT_URL_BY_TEMPLATE_CATEGORY[documentCategory] ?? null
}
