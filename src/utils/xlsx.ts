import ExcelJS from 'exceljs';

export interface XlsxColumn {
  header: string;
  key: string;
  width?: number;
}

export async function buildXlsxFile(
  rows: Record<string, unknown>[],
  columns: XlsxColumn[],
  worksheetName: string,
  watermark?: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(worksheetName || 'Export');

  worksheet.columns = columns.map(col => ({
    header: col.header,
    key: col.key,
    width: col.width ?? 20
  }));

  // Header styling
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };

  // Data rows
  for (const row of rows) {
    worksheet.addRow(row);
  }

  // Optional watermark/footer row
  if (watermark) {
    const footerRow = worksheet.addRow([watermark]);
    footerRow.getCell(1).font = { italic: true, color: { argb: 'FF808080' } };
    footerRow.getCell(1).alignment = {
      horizontal: 'left',
      vertical: 'middle'
    };
    worksheet.mergeCells(
      footerRow.number,
      1,
      footerRow.number,
      worksheet.columnCount
    );
  }

  workbook.creator = 'Dataset Export Worker';
  workbook.created = new Date();
  workbook.modified = new Date();

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

