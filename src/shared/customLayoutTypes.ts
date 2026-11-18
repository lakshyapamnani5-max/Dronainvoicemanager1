export type CustomColumnDataType =
  | 'text'
  | 'number'
  | 'decimal'
  | 'currency'
  | 'quantity'
  | 'percentage'
  | 'date'
  | 'dropdown'
  | 'measurement'
  | 'formula';

export type CustomColumnAlign = 'left' | 'center' | 'right';

export type CoreFieldMapping =
  | 'name'
  | 'description'
  | 'hsnSac'
  | 'quantity'
  | 'unit'
  | 'rate'
  | 'taxRate'
  | 'totalAmount'
  | 'none';

export interface CustomColumnDef {
  id: string; // Unique internal ID, e.g., 'col_1731940000000'
  key: string; // Machine key for row data, e.g., 'particulars', 'total_sq_ft'
  label: string; // Display label in table header, e.g., 'Total Sq. Ft.'
  dataType: CustomColumnDataType;
  width?: string; // Percentage or CSS width, e.g., '14%', '90px'
  align: CustomColumnAlign;
  required?: boolean;
  visible?: boolean;
  dropdownOptions?: string[]; // Used when dataType is 'dropdown'
  formula?: string; // e.g., 'total_sq_ft * rate_sq_ft' or 'qty * rate'
  decimalPrecision?: number; // Defaults to 2 for decimal/currency
  numberFormat?: 'standard' | 'inr' | 'compact';
  measurementUnit?: string; // e.g., 'Sq. Ft.', 'mm', 'Kg', 'Mtr'
  mappingToCore?: CoreFieldMapping; // Maps custom column to core financial field
  editableCalculation?: boolean; // If true, calculated value can be manually overridden
  defaultValue?: string | number;
  placeholder?: string;
}

export interface CustomInvoiceLayout {
  id: string;
  userUid: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  columns: CustomColumnDef[];
  createdAt: string;
  updatedAt: string;
}
