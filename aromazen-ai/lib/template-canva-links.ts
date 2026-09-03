const CANVA_EDIT_URL_BY_TEMPLATE_CATEGORY: Readonly<Record<string, string>> = {
  'hr_letter_template:offer': 'https://www.canva.com/d/0_iafxW7i0_VY7g',
  'hr_letter_template:appointment': 'https://www.canva.com/d/eBVwbXE-ZRtumpw',
  'hr_letter_template:spot_appreciation': 'https://www.canva.com/d/9QGL9y7_Jwn2YGW',
  'hr_letter_template:special_increment': 'https://www.canva.com/d/uupB7aLzDIONer5',
  salary_slip_template: 'https://www.canva.com/d/9PfWz1w3mTx4E3f',
  qa_coa_template: 'https://www.canva.com/d/22DzkdhTpOfj6CV',
}

export function canvaEditUrlForHrLetter(templateKey: string): string | null {
  return CANVA_EDIT_URL_BY_TEMPLATE_CATEGORY[`hr_letter_template:${templateKey}`] ?? null
}

export function canvaEditUrlForKnowledgeTemplate(documentCategory: string | null): string | null {
  if (!documentCategory) return null
  return CANVA_EDIT_URL_BY_TEMPLATE_CATEGORY[documentCategory] ?? null
}

export function canvaEditUrlForSalarySlip(): string {
  return CANVA_EDIT_URL_BY_TEMPLATE_CATEGORY.salary_slip_template
}

export function canvaEditUrlForQaCoa(): string {
  return CANVA_EDIT_URL_BY_TEMPLATE_CATEGORY.qa_coa_template
}
