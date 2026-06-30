import type { NewsBrandType } from '../api/client'

export type NewsTemplateExample = {
  id: string
  category: 'layout' | 'reference'
  name: string
  description: string
  templateName: string
  layoutPreset: string
  accentColor: string
  barBg: string
  ctaText: string
  brandType: NewsBrandType
  textSize: number
  ctaSize: number
  pageNameSize: number
  previewHeadline?: string
  previewAccentWords?: string[]
}

const POPCORN_BASE = {
  accentColor: '#00D4FF',
  barBg: '#000000',
  ctaText: 'READ MORE INFO IN THE COMMENT',
  brandType: 'page_picture' as NewsBrandType,
  ctaSize: 20,
  pageNameSize: 15,
}

/** Reference layouts matching Popcorn Feed–style posts. */
export const NEWS_TEMPLATE_EXAMPLES: NewsTemplateExample[] = [
  {
    id: 'popcorn_inset',
    category: 'layout',
    name: 'Popcorn + inset',
    description: 'Hero + left circle inset + page profile badge',
    templateName: 'Popcorn Feed — with inset',
    layoutPreset: 'popcorn',
    textSize: 50,
    previewHeadline: 'PUZZLES, SECRETS, AND EMOTIONAL STAKES DEEPEN IN LUDWIG SEASON TWO',
    previewAccentWords: ['PUZZLES', 'SECRETS', 'TWO'],
    ...POPCORN_BASE,
  },
  {
    id: 'popcorn_hero',
    category: 'layout',
    name: 'Popcorn hero only',
    description: 'Full-width hero, no inset circle',
    templateName: 'Popcorn Feed — hero only',
    layoutPreset: 'popcorn_hero',
    textSize: 50,
    previewHeadline: 'SHAKESPEARE & HATHAWAY IS BACK, AND SEASON 5 CHANGES MORE THAN EXPECTED',
    previewAccentWords: ['MORE', 'EXPECTED'],
    ...POPCORN_BASE,
  },
  {
    id: 'popcorn_bold',
    category: 'layout',
    name: 'Popcorn bold headline',
    description: 'Inset + larger headline for short punchy titles',
    templateName: 'Popcorn Feed — bold',
    layoutPreset: 'popcorn',
    textSize: 70,
    previewHeadline: 'DARKER CASES AND HIGHER STAKES DEFINE THE RETURN OF BBC CRIME DRAMA',
    previewAccentWords: ['DARKER', 'CASES', 'DRAMA'],
    ...POPCORN_BASE,
  },
  {
    id: 'ref_unforgotten',
    category: 'reference',
    name: 'Unforgotten',
    description: 'Cold-case drama — accent on hook + final word',
    templateName: 'Popcorn — Unforgotten style',
    layoutPreset: 'popcorn',
    textSize: 50,
    previewHeadline: 'A COLD CASE RESURFACES AS UNFORGOTTEN RETURNS WITH EMOTIONAL NEW MYSTERY',
    previewAccentWords: ['COLD', 'CASE', 'MYSTERY'],
    ...POPCORN_BASE,
  },
  {
    id: 'ref_midsomer',
    category: 'reference',
    name: 'Midsomer Murders',
    description: 'Village mystery — accent on place + closing word',
    templateName: 'Popcorn — Midsomer style',
    layoutPreset: 'popcorn',
    textSize: 50,
    previewHeadline: "PICTURESQUE VILLAGES HIDE DEADLY SECRETS IN MIDSOMER MURDERS' RETURN",
    previewAccentWords: ['PICTURESQUE', 'VILLAGES', 'RETURN'],
    ...POPCORN_BASE,
  },
  {
    id: 'ref_vandervalk',
    category: 'reference',
    name: 'Van der Valk',
    description: 'Amsterdam crime — accent on location + finale',
    templateName: 'Popcorn — Van der Valk style',
    layoutPreset: 'popcorn',
    textSize: 50,
    previewHeadline: "AMSTERDAM'S DARKEST SECRETS RETURN AS VAN DER VALK FACES NEW CHALLENGES",
    previewAccentWords: ['AMSTERDAM', 'DARKEST', 'CHALLENGES'],
    ...POPCORN_BASE,
  },
  {
    id: 'ref_gently',
    category: 'reference',
    name: 'Inspector George Gently',
    description: 'Period mystery — accent on lead name + closing word',
    templateName: 'Popcorn — Gently style',
    layoutPreset: 'popcorn',
    textSize: 50,
    previewHeadline: 'INSPECTOR GEORGE GENTLY RETURNS WITH THOUGHTFUL MYSTERIES & MORAL DEPTH',
    previewAccentWords: ['INSPECTOR', 'GEORGE', 'DEPTH'],
    ...POPCORN_BASE,
  },
  {
    id: 'ref_bookish',
    category: 'reference',
    name: 'Bookish / post-war London',
    description: 'Literary drama — accent on key adjective + place',
    templateName: 'Popcorn — Bookish style',
    layoutPreset: 'popcorn',
    textSize: 50,
    previewHeadline: 'A RESERVED BOOKSELLER UNRAVELS SECRETS IN POST-WAR LONDON',
    previewAccentWords: ['RESERVED', 'LONDON'],
    ...POPCORN_BASE,
  },
  {
    id: 'ref_hudson_rex',
    category: 'reference',
    name: 'Hudson & Rex',
    description: 'Detective duo — accent on hook + future',
    templateName: 'Popcorn — Hudson & Rex style',
    layoutPreset: 'popcorn',
    textSize: 50,
    previewHeadline: 'FAN-FAVOURITE DETECTIVE DUO RETURNS AS HUDSON & REX CONFIRMS ITS FUTURE',
    previewAccentWords: ['FAN-FAVOURITE', 'FUTURE'],
    ...POPCORN_BASE,
  },
  {
    id: 'ref_poirot',
    category: 'reference',
    name: 'Young Poirot',
    description: 'BBC prequel — accent on title + closing word',
    templateName: 'Popcorn — Young Poirot style',
    layoutPreset: 'popcorn',
    textSize: 50,
    previewHeadline: "YOUNG POIROT TAKES CENTRE STAGE IN BBC'S NEW DETECTIVE PREQUEL",
    previewAccentWords: ['YOUNG', 'POIROT', 'PREQUEL'],
    ...POPCORN_BASE,
  },
]

export const NEWS_TEMPLATE_LAYOUT_EXAMPLES = NEWS_TEMPLATE_EXAMPLES.filter((e) => e.category === 'layout')
export const NEWS_TEMPLATE_REFERENCE_EXAMPLES = NEWS_TEMPLATE_EXAMPLES.filter((e) => e.category === 'reference')
