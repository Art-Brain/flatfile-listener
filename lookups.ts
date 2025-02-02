export const LOOKUP_FIELDS = {
  AMCustomerNo: [
    {
      targetField: "buyerEmail",
      lookupField: "buyerEmail",
    },
  ],
  code: [
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
};
