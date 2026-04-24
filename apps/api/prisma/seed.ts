import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminPassword) {
    console.log('Skipping admin seed because SEED_ADMIN_PASSWORD is not set.');
    return;
  }

  const adminName = process.env.SEED_ADMIN_NAME || 'System Administrator';
  const adminUsername = process.env.SEED_ADMIN_USERNAME || 'admin';
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@system.local';
  const roleName = process.env.SEED_ADMIN_ROLE_NAME || 'Super Admin';
  const roleDescription =
    process.env.SEED_ADMIN_ROLE_DESCRIPTION || 'Full system access.';

  const superAdminRole = await prisma.role.upsert({
    where: { name: roleName },
    update: {
      description: roleDescription,
      permissions: ['*'],
    },
    create: {
      name: roleName,
      description: roleDescription,
      permissions: ['*'],
    },
  });

  const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });

  await prisma.user.upsert({
    where: { username: adminUsername },
    update: {
      name: adminName,
      email: adminEmail,
      passwordHash,
      status: 'ACTIVE',
      roleId: superAdminRole.id,
    },
    create: {
      name: adminName,
      username: adminUsername,
      email: adminEmail,
      passwordHash,
      status: 'ACTIVE',
      roleId: superAdminRole.id,
    },
  });

  console.log(`Admin user ensured in database (username: ${adminUsername}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
