export type ProductProfile =
  | 'COMPUTE'
  | 'MEMORY'
  | 'STORAGE'
  | 'PROCESSOR'
  | 'GRAPHICS'
  | 'MONITOR'
  | 'PERIPHERAL'
  | 'NETWORKING'
  | 'SERVICE'
  | 'STANDARD'

export type LookupItem = {
  id: string
  name: string
}

export type SubCategoryLookupItem = LookupItem & {
  categoryId: string
}

export type FormLookups = {
  parents: LookupItem[]
  categories: LookupItem[]
  subcategories: SubCategoryLookupItem[]
  brands: LookupItem[]
  processors: LookupItem[]
  processorGens: LookupItem[]
  rams: LookupItem[]
  storages: LookupItem[]
}

export type FormSpecValues = {
  name?: string
  parent?: string
  category?: string
  subCategory?: string
  brand?: string
  series?: string
  model?: string
  condition?: string
  color?: string
  processor?: string
  processorGen?: string
  ram?: string
  ramType?: string
  storage?: string
  display?: string
  displayType?: string
  displaySize?: string
  displayResolution?: string
  feature1?: string
  feature2?: string
}

/**
 * Resolves the specification profile based on category and subcategory names.
 */
export function getProductProfile(
  categoryId?: string,
  subCategoryId?: string,
  lookups?: {
    categories?: LookupItem[]
    subcategories?: SubCategoryLookupItem[]
  }
): ProductProfile {
  if (!categoryId && !subCategoryId) return 'STANDARD'

  const catName = (
    lookups?.categories?.find(c => c.id === categoryId)?.name || ''
  ).toLowerCase()

  const subName = (
    lookups?.subcategories?.find(s => s.id === subCategoryId)?.name || ''
  ).toLowerCase()

  const combined = `${catName} ${subName}`.trim()

  // 1. Services
  if (catName.includes('service') || combined.includes('repair') || combined.includes('install')) {
    return 'SERVICE'
  }

  // 2. Compute / Systems (Laptops, Desktops, All-in-One, Mini PC, Workstations)
  if (
    catName.includes('laptop') ||
    catName.includes('desktop') ||
    combined.includes('all-in-one') ||
    combined.includes('mini pc') ||
    combined.includes('workstation') ||
    combined.includes('ultrabook') ||
    combined.includes('notebook')
  ) {
    return 'COMPUTE'
  }

  // 3. Components
  if (catName.includes('component') || catName.includes('hardware')) {
    if (subName.includes('ram') || subName.includes('memory')) return 'MEMORY'
    if (
      subName.includes('ssd') ||
      subName.includes('hdd') ||
      subName.includes('storage') ||
      subName.includes('nvme') ||
      subName.includes('hard drive')
    ) {
      return 'STORAGE'
    }
    if (subName.includes('processor') || subName.includes('cpu')) return 'PROCESSOR'
    if (subName.includes('gpu') || subName.includes('graphic') || subName.includes('vga')) {
      return 'GRAPHICS'
    }
  }

  // Check subcategory by itself if category was generic or not 'Components'
  if (subName.includes('ram') || subName.includes('memory')) return 'MEMORY'
  if (subName.includes('ssd') || subName.includes('hdd') || subName.includes('nvme')) return 'STORAGE'
  if (subName.includes('processor') || subName.includes('cpu')) return 'PROCESSOR'
  if (subName.includes('gpu') || subName.includes('graphics card')) return 'GRAPHICS'

  // 4. Monitors & Displays
  if (
    subName.includes('monitor') ||
    subName.includes('display') ||
    catName.includes('monitor') ||
    catName.includes('display')
  ) {
    return 'MONITOR'
  }

  // 5. Networking
  if (
    catName.includes('network') ||
    combined.includes('router') ||
    combined.includes('switch') ||
    combined.includes('access point') ||
    combined.includes('nas')
  ) {
    return 'NETWORKING'
  }

  // 6. Accessories / Peripherals
  if (
    catName.includes('accessor') ||
    combined.includes('mouse') ||
    combined.includes('keyboard') ||
    combined.includes('headset') ||
    combined.includes('webcam') ||
    combined.includes('charger') ||
    combined.includes('cable') ||
    combined.includes('adapter') ||
    combined.includes('bag') ||
    combined.includes('case') ||
    combined.includes('casing')
  ) {
    return 'PERIPHERAL'
  }

  return 'STANDARD'
}

/**
 * Strips brand name from the beginning of string to avoid "Corsair Corsair Vengeance"
 */
function stripLeadingBrand(text: string, brandName: string): string {
  if (!text || !brandName) return text
  const trimmedText = text.trim()
  const trimmedBrand = brandName.trim()

  const regex = new RegExp(`^${escapeRegex(trimmedBrand)}\\s*`, 'i')
  return trimmedText.replace(regex, '').trim()
}

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Cleans and formats multi-space strings into single spaces.
 */
function cleanSpaces(...parts: Array<string | undefined | null>): string {
  return parts
    .map(p => (p || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Appends condition tag if condition is not 'new' / empty.
 */
function formatCondition(condition?: string): string {
  if (!condition) return ''
  const c = condition.trim().toLowerCase()
  if (c === 'new' || c === 'brand new' || c === 'brand_new') return ''
  if (c === 'used') return ' - [USED]'
  if (c === 'refurbished') return ' - [REFURBISHED]'
  if (c === 'open_box' || c === 'open box') return ' - [OPEN BOX]'
  return ` - [${condition.toUpperCase()}]`
}

/**
 * Universal real-time product title synthesizer.
 */
export function generateProductName(
  profile: ProductProfile,
  values: FormSpecValues,
  lookups: FormLookups
): string {
  const brandObj = lookups.brands.find(b => b.id === values.brand)
  const brandName = brandObj?.name?.trim() || ''

  const subCatObj = lookups.subcategories.find(s => s.id === values.subCategory)
  const subCatName = subCatObj?.name?.trim() || ''

  const catObj = lookups.categories.find(c => c.id === values.category)
  const catName = catObj?.name?.trim() || ''

  const processorObj = lookups.processors.find(p => p.id === values.processor)
  const processorName = processorObj?.name?.trim() || ''

  const processorGenObj = lookups.processorGens.find(p => p.id === values.processorGen)
  const processorGenName = processorGenObj?.name?.trim() || ''

  const ramObj = lookups.rams.find(r => r.id === values.ram)
  const ramName = ramObj?.name?.trim() || ''

  const storageObj = lookups.storages.find(s => s.id === values.storage)
  const storageName = storageObj?.name?.trim() || ''

  // Deduplicate Series & Model from leading brand
  const seriesClean = stripLeadingBrand(values.series || '', brandName)
  const modelClean = stripLeadingBrand(values.model || '', brandName)
  const color = (values.color || '').trim()
  const conditionSuffix = formatCondition(values.condition)

  // 1. COMPUTE PROFILE (Laptops, Desktops, AIO, Mini PC)
  if (profile === 'COMPUTE') {
    const baseGroup = cleanSpaces(brandName, seriesClean, modelClean)
    const cpuGroup = cleanSpaces(processorName, processorGenName)
    const ramGroup = cleanSpaces(ramName, values.ramType)
    const storageGroup = storageName

    const displaySizeStr = values.displaySize
      ? values.displaySize.endsWith('"') || values.displaySize.toLowerCase().endsWith('inch')
        ? values.displaySize
        : `${values.displaySize}"`
      : ''
    const displayGroup = cleanSpaces(
      values.display,
      displaySizeStr,
      values.displayResolution,
      values.displayType
    )

    const additionalFeatures = [values.feature1, values.feature2]
      .map(f => (f || '').trim())
      .filter(Boolean)
    const featuresGroup = additionalFeatures.length > 0 ? `(${additionalFeatures.join(', ')})` : ''

    const sections = [
      baseGroup,
      cpuGroup,
      ramGroup,
      storageGroup,
      displayGroup,
      featuresGroup,
      color,
    ].filter(Boolean)

    const title = sections.join(' | ').trim()
    return title ? `${title}${conditionSuffix}` : ''
  }

  // 2. MEMORY (RAM)
  if (profile === 'MEMORY') {
    const busSpeed = (values.feature1 || '').trim()
    const memoryType = (values.ramType || '').trim()
    
    // Check if "RAM" or "Memory" already exists
    const ramModel = cleanSpaces(seriesClean, modelClean)
    const ramSize = cleanSpaces(ramName, memoryType, busSpeed)

    let name = cleanSpaces(brandName, ramModel, ramSize, color)
    if (name && !/\b(RAM|Memory)\b/i.test(name)) {
      name = `${name} RAM`
    }
    return name ? `${name}${conditionSuffix}` : ''
  }

  // 3. STORAGE (SSD, HDD, NVMe)
  if (profile === 'STORAGE') {
    const interfaceType = (values.feature1 || '').trim() // e.g. NVMe M.2 2280, 2.5" SATA
    const driveType = subCatName || 'SSD'
    
    let base = cleanSpaces(brandName, seriesClean, modelClean, storageName, interfaceType)
    if (base && !/\b(SSD|HDD|Hard Drive|Drive)\b/i.test(base)) {
      base = `${base} ${driveType}`
    }
    return base ? `${base}${conditionSuffix}` : ''
  }

  // 4. PROCESSORS (CPU)
  if (profile === 'PROCESSOR') {
    const socket = (values.feature1 || '').trim()
    const base = cleanSpaces(brandName, processorName, processorGenName, seriesClean, modelClean, socket)
    const name = base && !/\b(Processor|CPU)\b/i.test(base) ? `${base} Processor` : base
    return name ? `${name}${conditionSuffix}` : ''
  }

  // 5. GRAPHICS (GPU)
  if (profile === 'GRAPHICS') {
    const vram = ramName || (values.feature2 || '').trim()
    const edition = (values.feature1 || '').trim()
    let base = cleanSpaces(brandName, seriesClean, modelClean, vram, edition, color)
    if (base && !/\b(Graphics Card|GPU|VGA)\b/i.test(base)) {
      base = `${base} Graphics Card`
    }
    return base ? `${base}${conditionSuffix}` : ''
  }

  // 6. MONITORS
  if (profile === 'MONITOR') {
    const displaySizeStr = values.displaySize
      ? values.displaySize.endsWith('"') || values.displaySize.toLowerCase().endsWith('inch')
        ? values.displaySize
        : `${values.displaySize}"`
      : ''
    const refreshRate = (values.feature1 || '').trim()
    const panelType = values.displayType || ''
    const resolution = values.displayResolution || ''
    
    let base = cleanSpaces(
      brandName,
      seriesClean,
      modelClean,
      displaySizeStr,
      resolution,
      panelType,
      refreshRate,
      color
    )
    if (base && !/\b(Monitor|Display)\b/i.test(base)) {
      base = `${base} Monitor`
    }
    return base ? `${base}${conditionSuffix}` : ''
  }

  // 7. NETWORKING
  if (profile === 'NETWORKING') {
    const speedOrStandard = (values.feature1 || '').trim()
    const specs = (values.feature2 || '').trim()
    const deviceType = subCatName || 'Networking Device'
    
    let base = cleanSpaces(brandName, seriesClean, modelClean, speedOrStandard, specs, color)
    if (base && !new RegExp(`\\b(${deviceType}|Router|Switch|Access Point|NAS)\\b`, 'i').test(base)) {
      base = `${base} ${deviceType}`
    }
    return base ? `${base}${conditionSuffix}` : ''
  }

  // 8. PERIPHERALS & ACCESSORIES
  if (profile === 'PERIPHERAL') {
    const connectivity = (values.feature1 || '').trim()
    const extraSpec = (values.feature2 || '').trim()
    const accessoryType = subCatName || ''
    
    let base = cleanSpaces(brandName, seriesClean, modelClean, connectivity, extraSpec, color)
    if (accessoryType && base && !new RegExp(`\\b${escapeRegex(accessoryType)}\\b`, 'i').test(base)) {
      base = `${base} ${accessoryType}`
    }
    return base ? `${base}${conditionSuffix}` : ''
  }

  // 9. SERVICES
  if (profile === 'SERVICE') {
    const targetDevice = cleanSpaces(brandName, seriesClean, modelClean)
    const serviceTitle = subCatName || catName || 'Service'
    const serviceDetails = (values.feature1 || '').trim()
    
    const parts = [serviceTitle]
    if (targetDevice) parts.push(`for ${targetDevice}`)
    if (serviceDetails) parts.push(`(${serviceDetails})`)
    
    return parts.join(' ').replace(/\s+/g, ' ').trim()
  }

  // 10. STANDARD / GENERAL FALLBACK
  const additional = [values.feature1, values.feature2]
    .map(f => (f || '').trim())
    .filter(Boolean)
    .join(' ')

  const base = cleanSpaces(brandName, seriesClean, modelClean, additional, color)
  return base ? `${base}${conditionSuffix}` : ''
}
