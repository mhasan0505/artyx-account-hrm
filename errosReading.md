Here is a practical guide on how to read, dissect, and identify errors quickly, using the exact error you just encountered as a real-world example.

---

### The 3-Step Error Reading Rule

When a red error screen or toast pops up, don't try to read the entire wall of text at once. Look for **three specific markers**:

```
1. WHERE did it fail?   ➔ Function or file name (e.g. prisma.purchaseReturn.create)
2. WHAT broke?          ➔ The main message / underline (e.g. Unknown argument `reason`)
3. WHAT was expected?   ➔ Available options list or expected types
```

---

### Deconstructing Your Exact Error

Here is what appeared on your screen:

```text
Invalid `prisma.purchaseReturn.create()` invocation:
{
  data: {
    returnNumber: "PR-MTCW7OQ7",
    ...
    reason: "Quality Issue",
    ~~~~~~
    settlementMethod: "AP_REDUCTION",
  }
}
Unknown argument `reason`. Available options are marked with ?:
? id: String,
? purchaseInvoiceId: String | Null,
? notes?: String | Null,
...
```

#### How to read this:
1. **The First Line Tells You the Action**:
   `Invalid prisma.purchaseReturn.create() invocation`
   → Look at the server action or code where `prisma.purchaseReturn.create` is being called.

2. **The Underline `~~~~~~` Points Directly to the Mistake**:
   `reason: "Quality Issue"`
   → Prisma is saying: *"I don't know what `reason` is on this model."*

3. **The Hint / Available Options List**:
   `? notes?: String | Null`
   → Prisma gives you the exact valid field names from `schema.prisma`. In this case, it showed `notes`, revealing that the database column is named `notes`, not `reason`.

---

### The 4 Most Common Error Categories in Modern Web Apps

#### 1. Prisma & Database Errors

| Error Message | What it means | How to fix |
| :--- | :--- | :--- |
| **`Unknown argument 'XYZ'`** | You passed a property that doesn't exist on the Prisma model. | Open `schema.prisma`, find the model, and check the actual column name. |
| **`Unique constraint failed on the fields: ('slug')`** | You tried to insert a duplicate value into a unique column. | Ensure the value is unique or generate a new random/incremental ID. |
| **`Foreign key constraint failed on the field: 'supplierId'`** | The `supplierId` you provided does not exist in the `Supplier` table. | Verify that the parent record exists before creating the child record. |
| **`Record to update not found`** | `prisma.user.update({ where: { id } })` failed because `id` doesn't match any row. | Verify the ID or use `updateMany` / check if record exists first. |

---

#### 2. JSX / React Syntax Errors

When you see:
```text
Error: Turbopack build failed:
./app/(app)/purchases/create/page.tsx:952:21
Expected '</', got '{'
```
- **How to read**: Look at line `952:21` (Line 952, column 21).
- **The problem**: An opening `<div>` or `{` was not closed before starting a new tag or comment.
- **How to fix**: Check matching pairs of `{ }` and `<tag> </tag>`.

---

#### 3. TypeScript Type Errors

```text
Type 'number' is not assignable to type 'string'.
Property 'total' does not exist on type 'PurchaseReturnLine'.
```
- **How to read**: TypeScript is checking whether your object shape matches its interface definition before runtime.
- **How to fix**: Check the interface/type definition and only pass properties declared on that type.

---

#### 4. Next.js Dynamic / SSR Errors

```text
Route /b2b couldn't be rendered statically because it used `headers` (DYNAMIC_SERVER_USAGE)
```
- **How to read**: Next.js tried to pre-render the page at build time, but your code called `cookies()`, `headers()`, or `auth()` which require a real user request.
- **How to fix**: Add `export const dynamic = 'force-dynamic'` at the top of the route if it requires runtime authentication.

---

### Pro-Tips for Fast Troubleshooting

1. **Check `schema.prisma` first**: When an ORM operation fails, search `model ModelName` in `prisma/schema.prisma` to verify exact column names.
2. **Run `pnpm build` before pushing**: Running `pnpm build` locally catches 99% of syntax errors, type mismatches, and build failures before they reach production.
3. **Use the Network Tab in DevTools**:
   - Open Browser DevTools (F12) → **Network** tab.
   - Look for red requests (status `500` or `400`).
   - Click the request → check the **Response** or **Payload** tab to see the server error payload.
