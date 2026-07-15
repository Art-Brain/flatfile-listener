export const AM_REGISTRATIONS_SHEET_NAME = "amregistrations";
export const WB_REGISTRATIONS_SHEET_NAME = "wbregistrations";
export const IMAGE_LINKS_SHEET_NAME = "imagelinks";
export const UNDERBIDS_LOTS_SHEET_NAME = "underbidslots";
export const CATEGORIES_SHEET_NAME = "categories";
export const REF_SHEETS = [
  AM_REGISTRATIONS_SHEET_NAME,
  WB_REGISTRATIONS_SHEET_NAME,
  IMAGE_LINKS_SHEET_NAME,
  UNDERBIDS_LOTS_SHEET_NAME,
];

export const LOOKUP_FIELDS: Record<
  string,
  {
    refSheetName: string | null;
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
  WBCustomerNo: {
    refSheetName: WB_REGISTRATIONS_SHEET_NAME,
    fields: [
      {
        targetField: "buyerEmail",
        lookupField: "buyerEmail",
      },
    ],
  },
  code: {
    refSheetName: null,
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
  "lotNo.": {
    refSheetName: IMAGE_LINKS_SHEET_NAME,
    fields: [
      {
        targetField: "lotNo.",
        lookupField: "lotNo.",
      },
      {
        targetField: "primaryItemUrl",
        lookupField: "primaryItemUrl",
      },
      {
        targetField: "imageUrl",
        lookupField: "imageUrl",
      },
    ],
  },
  itemnoid: {
    refSheetName: UNDERBIDS_LOTS_SHEET_NAME,
    fields: [
      {
        targetField: "lotno",
        lookupField: "lotno",
      },
    ],
  },
};
