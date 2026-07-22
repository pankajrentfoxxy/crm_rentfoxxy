require('dotenv').config();
const { recoverOrphanGrnTickets } = require('../services/grnTicketService');

async function main() {
  const result = await recoverOrphanGrnTickets();
  console.log('GRN orphan-ticket recovery:');
  console.log('  serials scanned (no ticket):', result.scanned);
  console.log('  tickets created:', result.created);
  if (result.errors.length) {
    console.log('  errors:', result.errors.length);
    result.errors.forEach((e) => console.log('   -', e.serial_id, e.error));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Recovery failed:', err.message);
  process.exit(1);
});
