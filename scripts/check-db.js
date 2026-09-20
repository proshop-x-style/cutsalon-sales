require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

(async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log('DB_URL_SET=false');
    process.exit(1);
  }

  console.log('DB_URL_SET=true');
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const count = await prisma.transaction.count();
    console.log('COUNT=' + count);
    const rows = await prisma.transaction.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
    });
    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await prisma.$disconnect();
  }
})();
