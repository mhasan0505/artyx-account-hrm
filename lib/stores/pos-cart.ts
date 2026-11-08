import type { Product } from '@/lib/mock-data'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CartSerial {
  index: number
  value: string
}

export interface CartItem {
  id: string
  product: Product
  quantity: number
  unitPrice: number
  discountPct: number
  discountAmt: number
  serials: CartSerial[]
  isGift?: boolean
  note?: string
  parentItemId?: string
  selectedGifts?: ComplimentaryGiftOption[]
}

export type ComplimentaryGiftOption =
  | 'bag'
  | 'mouse'
  | 'mousePad'
  | 'dataCable'
  | 'chargerCable'

export interface HeldSale {
  id: string
  label: string
  items: CartItem[]
  customerId?: string
  customerName?: string
  customerPhone?: string
  customerGroupName?: string
  groupDiscountPct?: number
  orderDiscountAmt?: number
  discountPct?: number
  heldAt: string
}

export interface ReCheckoutItem {
  productId: string
  productName: string
  productCategory: string
  productCondition?: string
  productRequiresSerial: boolean
  unitPrice: number
  discountPct: number
  discountAmt?: number
  quantity: number
  isGift: boolean
  note?: string
  serials: string[]
}

interface PosCartState {
  items: CartItem[]
  complimentaryGifts: ComplimentaryGiftOption[]
  customerId: string | null
  customerName: string | null
  customerPhone: string | null
  customerGroupName: string | null
  groupDiscountPct: number
  orderDiscountAmt: number
  discountPct: number
  isQuotationMode: boolean
  heldSales: HeldSale[]
  editingSaleId: string | null
  editingSaleNumber: string | null

  addItem: (
    product: Product,
    initialSerial?: string,
    initialPrice?: number
  ) => void
  updateQuantity: (id: string, quantity: number) => void
  updateSerial: (id: string, index: number, serial: string) => void
  setItemSerials: (id: string, serials: string[]) => void
  updateUnitPrice: (id: string, price: number) => void
  updateDiscount: (id: string, discountPct: number) => void
  updateDiscountAmt: (id: string, discountAmt: number) => void
  updateNote: (id: string, note: string) => void
  removeItem: (id: string) => void
  clearCart: () => void
  setCustomer: (
    id: string | null,
    name: string | null,
    phone: string | null,
    groupDiscountPct?: number,
    groupName?: string | null
  ) => void
  setOrderDiscount: (amount: number) => void
  setQuotationMode: (val: boolean) => void
  holdSale: (label?: string) => void
  recallSale: (id: string) => void
  deleteHeldSale: (id: string) => void
  toggleGift: (id: string) => void
  setParentItem: (id: string, parentItemId: string | null) => void
  setItemGifts: (id: string, gifts: ComplimentaryGiftOption[]) => void
  toggleItemGift: (id: string, option: ComplimentaryGiftOption) => void
  setComplimentaryGift: (
    option: ComplimentaryGiftOption,
    checked: boolean
  ) => void
  clearComplimentaryGifts: () => void
  loadSaleIntoCart: (
    items: ReCheckoutItem[],
    customerId: string | null,
    customerName: string | null,
    customerPhone: string | null,
    groupDiscountPct?: number,
    groupName?: string | null
  ) => void
  setEditMode: (saleId: string, saleNumber: string) => void
  clearEditMode: () => void
}

export const usePosCartStore = create<PosCartState>()(
  persist(
    (set, get) => ({
      items: [],
      complimentaryGifts: [],
      customerId: null,
      customerName: null,
      customerPhone: null,
      customerGroupName: null,
      groupDiscountPct: 0,
      orderDiscountAmt: 0,
      discountPct: 0,
      isQuotationMode: false,
      heldSales: [],
      editingSaleId: null,
      editingSaleNumber: null,

      addItem: (product, initialSerial, initialPrice) => {
        const items = get().items
        const resolvedPrice =
          initialPrice !== undefined && initialPrice > 0
            ? initialPrice
            : product.price

        // Check if this product is already in the cart (by product.id)
        const existing = items.find(i => i.product.id === product.id)
        if (existing) {
          const newQty = existing.quantity + 1
          const updatedSerials = [...existing.serials]

          if (initialSerial && !updatedSerials.some(s => s.value === initialSerial)) {
            const emptySlot = updatedSerials.find(s => !s.value)
            if (emptySlot) {
              emptySlot.value = initialSerial
            } else {
              updatedSerials.push({ index: updatedSerials.length, value: initialSerial })
            }
          }

          set({
            items: items.map(i =>
              i.id === existing.id
                ? {
                    ...i,
                    quantity: newQty,
                    serials: updatedSerials,
                  }
                : i
            ),
          })
          return
        }

        const initialSerials = initialSerial
          ? [{ index: 0, value: initialSerial }]
          : []

        set({
          items: [
            ...items,
            {
              id: product.id,
              product,
              quantity: 1,
              unitPrice: resolvedPrice,
              discountPct: 0,
              discountAmt: 0,
              isGift: false,
              serials: initialSerials,
              selectedGifts: [],
            },
          ],
        })
      },

      updateQuantity: (id, quantity) => {
        if (quantity < 1) {
          get().removeItem(id)
          return
        }
        set({
          items: get().items.map(i => {
            if (i.id !== id) return i
            const trimmedSerials = i.serials.slice(0, quantity)
            return {
              ...i,
              quantity,
              serials: trimmedSerials,
            }
          }),
        })
      },

      setItemSerials: (id: string, serials: string[]) => {
        set({
          items: get().items.map(i =>
            i.id === id
              ? {
                  ...i,
                  serials: serials.map((value, index) => ({ index, value })),
                }
              : i
          ),
        })
      },

      updateSerial: (id, index, serial) => {
        set({
          items: get().items.map(i => {
            if (i.id !== id) return i
            const existingSerials = [...i.serials]
            const foundIdx = existingSerials.findIndex(s => s.index === index)
            if (foundIdx >= 0) {
              existingSerials[foundIdx] = { index, value: serial }
            } else {
              existingSerials.push({ index, value: serial })
            }
            return {
              ...i,
              serials: existingSerials.sort((a, b) => a.index - b.index),
            }
          }),
        })
      },

      updateUnitPrice: (id, price) => {
        set({
          items: get().items.map(i =>
            i.id === id ? { ...i, unitPrice: price } : i
          ),
        })
      },

      updateDiscount: (id, discountPct) => {
        set({
          items: get().items.map(i =>
            i.id === id ? { ...i, discountPct } : i
          ),
        })
      },

      updateDiscountAmt: (id, discountAmt) => {
        const cleanAmt = Math.max(0, Number.isFinite(discountAmt) ? discountAmt : 0)
        set({
          items: get().items.map(i =>
            i.id === id ? { ...i, discountAmt: cleanAmt } : i
          ),
        })
      },

      updateNote: (id, note) => {
        set({
          items: get().items.map(i =>
            i.id === id ? { ...i, note } : i
          ),
        })
      },

      removeItem: id => {
        set({ items: get().items.filter(i => i.id !== id) })
      },

      clearCart: () => {
        set({
          items: [],
          complimentaryGifts: [],
          customerId: null,
          customerName: null,
          customerPhone: null,
          customerGroupName: null,
          groupDiscountPct: 0,
          orderDiscountAmt: 0,
          discountPct: 0,
          editingSaleId: null,
          editingSaleNumber: null,
        })
      },

      setCustomer: (
        id,
        name,
        phone,
        groupDiscountPct = 0,
        groupName = null
      ) => {
        set({
          customerId: id,
          customerName: name,
          customerPhone: phone,
          customerGroupName: groupName,
          groupDiscountPct,
          orderDiscountAmt: 0,
          discountPct: groupDiscountPct,
        })
      },

      setOrderDiscount: amount =>
        set({
          orderDiscountAmt: Number.isFinite(amount) ? Math.max(0, amount) : 0,
        }),

      setQuotationMode: val => set({ isQuotationMode: val }),

      holdSale: (label?: string) => {
        const state = get()
        if (state.items.length === 0) return
        const autoLabel =
          label?.trim() ||
          `Hold #${state.heldSales.length + 1} (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
        const held: HeldSale = {
          id: crypto.randomUUID(),
          label: autoLabel,
          items: state.items,
          customerId: state.customerId ?? undefined,
          customerName: state.customerName ?? undefined,
          customerPhone: state.customerPhone ?? undefined,
          customerGroupName: state.customerGroupName ?? undefined,
          groupDiscountPct: state.groupDiscountPct,
          orderDiscountAmt: state.orderDiscountAmt,
          discountPct: state.discountPct,
          heldAt: new Date().toISOString(),
        }
        set({
          heldSales: [...state.heldSales, held],
          items: [],
          complimentaryGifts: [],
          customerId: null,
          customerName: null,
          customerPhone: null,
          customerGroupName: null,
          groupDiscountPct: 0,
          orderDiscountAmt: 0,
          discountPct: 0,
        })
      },

      recallSale: id => {
        const state = get()
        const held = state.heldSales.find(h => h.id === id)
        if (!held) return

        set({
          items: held.items,
          complimentaryGifts: [],
          customerId: held.customerId ?? null,
          customerName: held.customerName ?? null,
          customerPhone: held.customerPhone ?? null,
          customerGroupName: held.customerGroupName ?? null,
          groupDiscountPct: held.groupDiscountPct ?? 0,
          orderDiscountAmt: held.orderDiscountAmt ?? 0,
          discountPct: held.discountPct ?? 0,
          heldSales: state.heldSales.filter(h => h.id !== id),
        })
      },

      deleteHeldSale: id => {
        set({ heldSales: get().heldSales.filter(h => h.id !== id) })
      },

      toggleGift: id => {
        set({
          items: get().items.map(i =>
            i.id === id ? { ...i, isGift: !i.isGift } : i
          ),
        })
      },

      setParentItem: (id, parentItemId) => {
        set({
          items: get().items.map(i =>
            i.id === id ? { ...i, parentItemId: parentItemId ?? undefined } : i
          ),
        })
      },

      setItemGifts: (id, gifts) => {
        set({
          items: get().items.map(i =>
            i.id === id ? { ...i, selectedGifts: [...gifts] } : i
          ),
        })
      },

      toggleItemGift: (id, option) => {
        set({
          items: get().items.map(i => {
            if (i.id !== id) return i
            const current = i.selectedGifts || []
            const exists = current.includes(option)
            const nextGifts = exists
              ? current.filter(g => g !== option)
              : [...current, option]
            return { ...i, selectedGifts: nextGifts }
          }),
        })
      },

      setComplimentaryGift: (option, checked) => {
        set(state => {
          const exists = state.complimentaryGifts.includes(option)
          if (checked && !exists) {
            return {
              complimentaryGifts: [...state.complimentaryGifts, option],
            }
          }
          if (!checked && exists) {
            return {
              complimentaryGifts: state.complimentaryGifts.filter(
                gift => gift !== option
              ),
            }
          }
          return state
        })
      },

      clearComplimentaryGifts: () => {
        set({ complimentaryGifts: [] })
      },

      loadSaleIntoCart: (items, customerId, customerName, customerPhone, groupDiscountPct = 0, groupName = null) => {
        const cartItems: CartItem[] = []
        for (const item of items) {
          if (item.productRequiresSerial && item.quantity > 1) {
            // Expand bundled historical lines into individual 1-unit cart items
            for (let idx = 0; idx < item.quantity; idx++) {
              const serialVal = item.serials[idx] || ''
              cartItems.push({
                id: `${item.productId}-${crypto.randomUUID()}`,
                product: {
                  id: item.productId,
                  name: item.productName,
                  price: item.unitPrice,
                  category: item.productCategory as any,
                  condition: item.productCondition,
                  stock: 99,
                  requiresSerial: true,
                  availableSerials: item.serials,
                },
                quantity: 1,
                unitPrice: item.unitPrice,
                discountPct: item.discountPct,
                discountAmt: item.discountAmt ?? 0,
                serials: [{ index: 0, value: serialVal }],
                isGift: item.isGift,
                note: item.note,
                selectedGifts: [],
              })
            }
          } else {
            cartItems.push({
              id: item.productRequiresSerial
                ? `${item.productId}-${crypto.randomUUID()}`
                : item.productId,
              product: {
                id: item.productId,
                name: item.productName,
                price: item.unitPrice,
                category: item.productCategory as any,
                condition: item.productCondition,
                stock: 99,
                requiresSerial: item.productRequiresSerial,
                availableSerials: item.serials,
              },
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discountPct: item.discountPct,
              discountAmt: item.discountAmt ?? 0,
              serials: item.serials.map((s, idx) => ({ index: idx, value: s })),
              isGift: item.isGift,
              note: item.note,
              selectedGifts: [],
            })
          }
        }
        set({
          items: cartItems,
          complimentaryGifts: [],
          customerId,
          customerName,
          customerPhone,
          customerGroupName: groupName,
          groupDiscountPct,
          orderDiscountAmt: 0,
          discountPct: groupDiscountPct,
        })
      },

      setEditMode: (saleId, saleNumber) => {
        set({ editingSaleId: saleId, editingSaleNumber: saleNumber })
      },

      clearEditMode: () => {
        set({ editingSaleId: null, editingSaleNumber: null })
      },
    }),
    {
      name: 'pos-cart',
      partialize: state => ({
        items: state.items,
        complimentaryGifts: state.complimentaryGifts,
        customerId: state.customerId,
        customerName: state.customerName,
        customerPhone: state.customerPhone,
        customerGroupName: state.customerGroupName,
        groupDiscountPct: state.groupDiscountPct,
        orderDiscountAmt: state.orderDiscountAmt,
        discountPct: state.discountPct,
        isQuotationMode: state.isQuotationMode,
        heldSales: state.heldSales,
        editingSaleId: state.editingSaleId,
        editingSaleNumber: state.editingSaleNumber,
      }),
      skipHydration: true,
    }
  )
)
