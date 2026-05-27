/**
 * Port of Laravel helpers.php getTotalAmountOfPurchaseOrder:
 * Same state → SGST 9% + CGST 9%; else IGST 18%.
 */
function getTotalAmountOfPurchaseOrder(subtotal, isSameState) {
  const s = Number(subtotal) || 0;
  let total;
  if (isSameState) {
    const sgst = (s * 9) / 100;
    const cgst = (s * 9) / 100;
    total = s + sgst + cgst;
  } else {
    const igst = (s * 18) / 100;
    total = s + igst;
  }
  return Math.round(total * 100) / 100;
}

module.exports = { getTotalAmountOfPurchaseOrder };
