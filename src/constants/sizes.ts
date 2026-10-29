/**
 * Shared size presets used by Add Product and the AI import review screen.
 */
export const SIZE_GROUPS = [
    {
        id: 'letter',
        labelKey: 'addProduct.groupLetter',
        sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Free'],
    },
    {
        id: 'shirt',
        labelKey: 'addProduct.groupShirt',
        sizes: ['34', '36', '38', '40', '42', '44', '46'],
    },
    {
        id: 'waist',
        labelKey: 'addProduct.groupWaist',
        sizes: ['28', '30', '32', '34', '36', '38', '40', '42'],
    },
    {
        id: 'kids',
        labelKey: 'addProduct.groupKids',
        sizes: ['2Y', '3Y', '4Y', '5Y', '6Y', '7Y', '8Y', '10Y', '12Y', '14Y'],
    },
    {
        id: 'shoe',
        labelKey: 'addProduct.groupShoe',
        sizes: ['5', '6', '7', '8', '9', '10', '11'],
    },
];

/** Aligns action buttons with the AppInput label used beside them. */
export const LABEL_OFFSET = 22;
