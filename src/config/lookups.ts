export const AM_REGISTRATIONS_SHEET_NAME = "amregistrations";
export const CATEGORIES_SHEET_NAME = "categories";

export const LOOKUP_FIELDS: Record<
  string,
  {
    refSheetName: string;
    fields: { targetField: string; lookupField: string }[];
  }
> = {
  AMCustomerNo: {
    refSheetName: AM_REGISTRATIONS_SHEET_NAME,
    fields: [
      {
        targetField: "buyerEmail",
        lookupField: "buyerEmail",
      },
    ],
  },
  code: {
    refSheetName: CATEGORIES_SHEET_NAME,
    fields: [
      {
        targetField: "departments",
        lookupField: "department",
      },
      {
        targetField: "categories",
        lookupField: "category",
      },
      {
        targetField: "optionalTags",
        lookupField: "tag",
      },
    ],
  },
};
