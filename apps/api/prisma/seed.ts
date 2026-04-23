import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const superAdminRole = await prisma.role.upsert({
    where: { name: '超级管理员' },
    update: {},
    create: {
      name: '超级管理员',
      description: '拥有所有权限',
      permissions: ['*'],
    },
  });

  const passwordHash = await argon2.hash('Ynj89800', { type: argon2.argon2id });

  await prisma.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash },
    create: {
      name: '超级管理员',
      username: 'admin',
      email: 'admin@system.local',
      passwordHash,
      status: 'ACTIVE',
      roleId: superAdminRole.id,
    },
  });

  console.log('✅ 超级管理员账号已写入数据库 (账号: admin)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
