# Delete order 78 from database (test order cleanup)
# Run: .\delete-order-78.ps1

$VpsIp = "187.77.187.213"
$VpsUser = "root"
$OrderId = 78

$Sql = @"
DELETE FROM procurement_requests WHERE order_item_id IN (SELECT item_id FROM order_items WHERE order_id = $OrderId);
DELETE FROM order_items WHERE order_id = $OrderId;
DELETE FROM order_status_history WHERE order_id = $OrderId;
DELETE FROM orders WHERE order_id = $OrderId;
"@

Write-Host "Deleting order $OrderId from database on $VpsIp..." -ForegroundColor Yellow
Write-Host "(Enter root password when prompted)" -ForegroundColor Gray

$Sql | ssh "${VpsUser}@${VpsIp}" "docker exec -i laptop-erp-postgres psql -U postgres -d postgres"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Order $OrderId deleted successfully." -ForegroundColor Green
} else {
    Write-Host "Delete may have failed. Check output above." -ForegroundColor Red
}
