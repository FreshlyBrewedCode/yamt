// The totals live in @yamt/shared (`totals.ts`), so the web app can preview with the same code;
// the server's modules keep importing them from here.
export { computeTotals, itemNutrients, roundNutrient, type TotalsItem } from "@yamt/shared";
