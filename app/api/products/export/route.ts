import { requireRole } from "@/lib/actions/auth-guard";
import { getProductList } from "@/lib/actions/products";
import { ProductCondition, UserRole } from "@prisma/client";
import ExcelJS from "exceljs";
import fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import path from "path";

export async function GET(request: NextRequest) {
  try {
    const user = await requireRole(
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.MANAGER,
    );

    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get("q") || undefined;
    const status =
      searchParams.get("status") === "archived" ? "archived" : "active";
    const categoryId = searchParams.get("categoryId") || undefined;
    const brandId = searchParams.get("brandId") || undefined;
    const conditionStr = searchParams.get("condition")?.toUpperCase();
    const validConditions = new Set(Object.values(ProductCondition));
    const condition = validConditions.has(conditionStr as ProductCondition)
      ? (conditionStr as ProductCondition)
      : undefined;

    const rawStock = searchParams.get("stock") || searchParams.get("inStock");
    const stock =
      rawStock === "in_stock" || rawStock === "instock" || rawStock === "true" || rawStock === "1"
        ? "in_stock"
        : rawStock === "out_of_stock" || rawStock === "outofstock" || rawStock === "false" || rawStock === "0"
          ? "out_of_stock"
          : undefined;

    const raw = await getProductList(user.outletId, {
      search,
      status,
      categoryId,
      brandId,
      condition,
      stock,
      page: 1,
      pageSize: 10000,
      includeSerials: true,
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Products", {
      views: [{ showGridLines: false }], // Hide default gridlines for cleaner look
    });

    // 1. Column Widths
    worksheet.getColumn(1).width = 30; // A: Product ID
    worksheet.getColumn(2).width = 20; // B: SKU
    worksheet.getColumn(3).width = 20; // C: Product Code
    worksheet.getColumn(4).width = 40; // D: Name
    worksheet.getColumn(5).width = 20; // E: Barcode
    worksheet.getColumn(6).width = 30; // F: SN
    worksheet.getColumn(7).width = 20; // G: Category
    worksheet.getColumn(8).width = 20; // H: Brand
    worksheet.getColumn(9).width = 15; // I: Condition
    worksheet.getColumn(10).width = 15; // J: Cost Price
    worksheet.getColumn(11).width = 15; // K: Selling Price

    // 2. Company Pad (Rows 1 to 3)
    worksheet.getRow(1).height = 30;
    worksheet.getRow(2).height = 30;
    worksheet.getRow(3).height = 30;

    worksheet.mergeCells("B1:K3");
    const titleCell = worksheet.getCell("B1");
    titleCell.value = "Artyx Digital - Product List";
    titleCell.font = { size: 24, bold: true, color: { argb: "FF333333" } };
    titleCell.alignment = { vertical: "middle", horizontal: "center" };

    // Set a light border around the company pad bounding box for aesthetics
    worksheet.getCell("B1").border = {
      top: { style: "thin", color: { argb: "FFDDDDDD" } },
      bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
      right: { style: "thin", color: { argb: "FFDDDDDD" } },
    };

    // 3. Add Logo
    try {
      const logoPath = path.join(process.cwd(), "public", "logo_icons.png");
      const logoImage = await fs.readFile(logoPath);
      const imageId = workbook.addImage({
        buffer: logoImage as any,
        extension: "png",
      });

      worksheet.addImage(imageId, {
        tl: { col: 0.1, row: 0.1 }, // slight offset in A1
        ext: { width: 100, height: 100 },
      });
    } catch (err) {
      console.error("Logo not found or could not be loaded:", err);
    }

    // 4. Spacer Row
    worksheet.getRow(4).height = 15;

    // 5. Table Headers
    const headerRow = worksheet.getRow(5);
    headerRow.height = 30;
    headerRow.values = [
      "Product ID",
      "SKU",
      "Product Code",
      "Name",
      "Barcode",
      "SN",
      "Category",
      "Brand",
      "Condition",
      "Cost Price",
      "Selling Price",
    ];

    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF2563EB" }, // Blue shade (Tailwind blue-600)
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        top: { style: "medium", color: { argb: "FF1D4ED8" } },
        bottom: { style: "medium", color: { argb: "FF1D4ED8" } },
        left: { style: "thin", color: { argb: "FF3B82F6" } },
        right: { style: "thin", color: { argb: "FF3B82F6" } },
      };
    });

    // 6. Table Data
    let currentRow = 6;
    raw.items.forEach((p, index) => {
      const row = worksheet.getRow(currentRow);
      row.height = 25;

      const serials = p.serialUnits || [];
      const snList = serials
        .map((s: { serialNumber: string }) => s.serialNumber)
        .join(", ");

      row.values = [
        p.id,
        p.sku || "-",
        p.productCode || "-",
        p.name,
        p.barcode || "-",
        snList || "-",
        p.category?.name || "-",
        p.brand?.name || "-",
        p.condition || "-",
        Number(p.costPrice),
        Number(p.sellingPrice),
      ];

      // Alternate row backgrounds for better readability
      const isEven = index % 2 === 0;
      const rowBgColor = isEven ? "FFFFFFFF" : "FFF8FAFC"; // white / slate-50

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        // Base styling for data cells
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: rowBgColor },
        };
        cell.border = {
          left: { style: "thin", color: { argb: "FFE2E8F0" } }, // slate-200
          right: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        };

        // Alignment formatting
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };

        // Currency formatting for cost and selling price
        if (colNumber === 10 || colNumber === 11) {
          cell.numFmt = '"৳"#,##0.00';
          cell.alignment = { vertical: "middle", horizontal: "right" };
        }

        // Center alignment for some fields
        if (colNumber === 5 || colNumber === 9) {
          cell.alignment = { vertical: "middle", horizontal: "center" };
        }
      });

      currentRow++;
    });

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Disposition": 'attachment; filename="Products.xlsx"',
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (error) {
    console.error("Error generating Excel:", error);
    return NextResponse.json(
      { error: "Failed to generate Excel file" },
      { status: 500 },
    );
  }
}
