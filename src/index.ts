import { testConnection } from './config/database.js';

async function main() {
  console.log('Leads Generation Backend');
  console.log('GDPR-compliant business contact intelligence engine for Greece\n');

  const connected = await testConnection();
  if (connected) {
    console.log('✓ Database connection successful');
  } else {
    console.error('✗ Database connection failed');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
