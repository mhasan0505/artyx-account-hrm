export type ProductCategory =
  | 'Laptops'
  | 'Components'
  | 'Accessories'
  | 'Services'
  | 'Gifts'
export type Product = {
  id: string
  name: string
  price: number
  category: ProductCategory
  condition?: string
  stock: number
  requiresSerial: boolean
  availableSerials?: string[]
  specs?: string[] // E.g., ["16GB RAM", "1TB SSD", "M3 Pro"]
  image?: string
}

export const MOCK_PRODUCTS: Product[] = [
  {
    id: 'LAP-001',
    name: 'MacBook Pro 14"',
    price: 1999,
    category: 'Laptops',
    stock: 5,
    requiresSerial: true,
    specs: ['M3 Pro', '18GB RAM', '512GB SSD'],
    image: '/images/products/microsoft/Microsoft-Surface-laptop-4/main.png', // Using surface as placeholder for macbook
  },
  {
    id: 'LAP-002',
    name: 'Dell XPS 13 9370',
    price: 1500,
    category: 'Laptops',
    stock: 3,
    requiresSerial: true,
    specs: ['Core i7', '16GB RAM', '256GB SSD'],
    image: '/images/products/dell/Dell-XPS-13-9370code-i7-8th-Gen-16-256/main.png',
  },
  {
    id: 'LAP-003',
    name: 'Lenovo ThinkPad T14',
    price: 1350,
    category: 'Laptops',
    stock: 8,
    requiresSerial: true,
    specs: ['Ryzen 5 Pro', '16GB RAM', '512GB SSD'],
    image: '/images/products/lenovo/Lenovo-Thinkpad-T14/main.jpg',
  },
  {
    id: 'LAP-004',
    name: 'HP Elitebook 840 G8',
    price: 1850,
    category: 'Laptops',
    stock: 2,
    requiresSerial: true,
    specs: ['Core i7 11th Gen', '16GB RAM', '512GB SSD'],
    image: '/images/products/hp/HP-Elitebook-840-G8-Core-I7-11TH-Gen-16-512/main.jpg',
  },
  {
    id: 'COMP-001',
    name: 'NVIDIA RTX 4080 Super',
    price: 999,
    category: 'Components',
    stock: 4,
    requiresSerial: true,
    specs: ['16GB VRAM', 'PCIe 4.0'],
  },
  {
    id: 'COMP-002',
    name: 'Samsung 990 Pro 2TB',
    price: 170,
    category: 'Components',
    stock: 12,
    requiresSerial: true,
    specs: ['NVMe M.2', 'Gen 4'],
  },
  {
    id: 'ACC-001',
    name: 'Logitech MX Master 3S',
    price: 99,
    category: 'Accessories',
    stock: 15,
    requiresSerial: false,
    specs: ['Wireless', 'Ergonomic'],
  },
  {
    id: 'ACC-002',
    name: 'Laptop Sleeve 14"',
    price: 35,
    category: 'Accessories',
    stock: 25,
    requiresSerial: false,
  },
  {
    id: 'SER-001',
    name: 'Windows 11 Format & Install',
    price: 40,
    category: 'Services',
    stock: 999,
    requiresSerial: false,
  },
  {
    id: 'SER-002',
    name: 'RAM Upgrade Service',
    price: 20,
    category: 'Services',
    stock: 999,
    requiresSerial: false,
  },
]
