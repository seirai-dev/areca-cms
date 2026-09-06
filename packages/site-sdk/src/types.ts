export type FieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'image'
  | 'date'
  | 'datetime'
  | 'select'
  | 'reference'
  | 'slug'
  | 'boolean'
  | 'number'

export type Field = {
  key: string
  label: string
  type: FieldType
  required?: boolean
  options?: string[]
  collection?: string
  description?: string
}

export type SiteContentConfig = {
  siteKey: string
  collections: Record<
    string,
    {
      route: string
      label?: string
      fields: Field[]
    }
  >
}
