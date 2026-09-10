const CANVA_EDIT_URL_BY_TEMPLATE_CATEGORY: Readonly<Record<string, string>> = {
  'hr_letter_template:offer': 'https://www.canva.com/design/DAHT87sDHMg/PUKDHFpFeBxDw-4xSRimIw/edit',
  'hr_letter_template:appointment': 'https://www.canva.com/design/DAHUEPyZXc4/Vmt4NgaZqRJPs_cVWO_bwQ/edit',
  'hr_letter_template:spot_appreciation': 'https://www.canva.com/design/DAHUEEB-6E0/CT9TtPSezzIujpPzANqdAg/edit',
  'hr_letter_template:special_increment': 'https://www.canva.com/design/DAHUGkkmvBI/5pI0oRn9hbP_sNhAj4uD8w/edit',
  salary_slip_template: 'https://www.canva.com/design/DAHUClLJiSM/Rbjg2J5Od978rXjfNOZJvQ/edit',
  qa_coa_template: 'https://www.canva.com/design/DAHUIbep1j4/h7gaNI5L-yAJ7wzdlCqT7g/edit',
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
