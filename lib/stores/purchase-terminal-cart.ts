import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface PurchaseCartItem {
  id: string
  productId: string
  name: string
  productCode?: string
  sku?: string
  categoryName?: string
  condition?: string
  requiresSerial: boolean
  currentStock: number
  quantity: number
  unitCost: number
  sellingPrice?: number
  discount: number
  serialNumbers: string[]
  note?: string
}

export interface ActiveSupplier {
  id: string
  name: string
  code?: string
  phone?: string
  outstandingBalance?: number
}

interface PurchaseTerminalState {
  items: PurchaseCartItem[]
  activeSupplier: ActiveSupplier | null
  directInvoiceMode: boolean

  // Actions
  addItem: (product: {
    id: string
    name: string
    productCode?: string | null
    sku?: string | null
    category?: { name: string } | null
    condition?: string | null
    requiresSerial?: boolean
    costPrice?: number | string | null
    sellingPrice?: number | string | null
    stock?: number
  }) => void
  updateQuantity: (id: string, qty: number) => void
  updateUnitCost: (id: string, cost: number) => void
  updateSellingPrice: (id: string, price?: number | null) => void
  updateDiscount: (id: string, discount: number) => void
  updateNote: (id: string, note: string) => void
  updateSerials: (id: string, serials: string[]) => void
  removeItem: (id: string) => void
  clearCart: () => void
  setActiveSupplier: (supplier: ActiveSupplier | null) => void
  setDirectInvoiceMode: (enabled: boolean) => void
}

export const usePurchaseCartStore = create<PurchaseTerminalState>()(
  persist(
    (set, get) => ({
      items: [],
      activeSupplier: null,
      directInvoiceMode: true,

      addItem: product => {
        const { items } = get()
        const existingIndex = items.findIndex(i => i.productId === product.id)
        const costPrice = Number(product.costPrice || 0)
        const sellingPrice = Number(product.sellingPrice || 0)
        const requiresSerial = Boolean(product.requiresSerial)

        if (existingIndex > -1 && !requiresSerial) {
          // Non-serialized item: increment quantity
          const updated = [...items]
          updated[existingIndex] = {
            ...updated[existingIndex],
            quantity: updated[existingIndex].quantity + 1,
          }
          set({ items: updated })
        } else {
          // Serialized or new item: add as new row
          const newItem: PurchaseCartItem = {
            id: `pci-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            productId: product.id,
            name: product.name,
            productCode: product.productCode || undefined,
            sku: product.sku || undefined,
            categoryName: product.category?.name || 'General',
            condition: product.condition || undefined,
            requiresSerial,
            currentStock: product.stock ?? 0,
            quantity: 1,
            unitCost: costPrice,
            sellingPrice: sellingPrice > 0 ? sellingPrice : undefined,
            discount: 0,
            serialNumbers: [],
          }
          set({ items: [...items, newItem] })
        }
      },

      updateQuantity: (id, qty) => {
        const validQty = Math.max(1, Math.floor(qty))
        set({
          items: get().items.map(item =>
            item.id === id ? { ...item, quantity: validQty } : item
          ),
        })
      },

      updateUnitCost: (id, cost) => {
        const validCost = Math.max(0, cost)
        set({
          items: get().items.map(item =>
            item.id === id ? { ...item, unitCost: validCost } : item
          ),
        })
      },

      updateSellingPrice: (id, price) => {
        const validPrice =
          price !== undefined && price !== null && !isNaN(Number(price)) && Number(price) > 0
            ? Math.round((Number(price) + Number.EPSILON) * 100) / 100
            : undefined
        set({
          items: get().items.map(item =>
            item.id === id ? { ...item, sellingPrice: validPrice } : item
          ),
        })
      },

      updateDiscount: (id, discount) => {
        const validDiscount = Math.max(0, discount)
        set({
          items: get().items.map(item =>
            item.id === id ? { ...item, discount: validDiscount } : item
          ),
        })
      },

      updateNote: (id, note) => {
        set({
          items: get().items.map(item =>
            item.id === id ? { ...item, note } : item
          ),
        })
      },

      updateSerials: (id, serials) => {
        set({
          items: get().items.map(item =>
            item.id === id ? { ...item, serialNumbers: serials } : item
          ),
        })
      },

      removeItem: id => {
        set({ items: get().items.filter(item => item.id !== id) })
      },

      clearCart: () => {
        set({ items: [] })
      },

      setActiveSupplier: supplier => {
        set({ activeSupplier: supplier })
      },

      setDirectInvoiceMode: enabled => {
        set({ directInvoiceMode: enabled })
      },
    }),
    {
      name: 'artyx-purchase-cart',
    }
  )
)
