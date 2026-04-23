import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { SaveUserDto } from './dto/save-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      include: { role: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async save(payload: SaveUserDto) {
    const data = {
      name: payload.name,
      email: payload.email,
      department: payload.department,
      roleId: payload.roleId,
      status: payload.status ?? 'ACTIVE',
    };

    if (payload.id) {
      return this.prisma.user.update({
        where: { id: payload.id },
        data,
        include: { role: true },
      });
    }

    return this.prisma.user.create({
      data,
      include: { role: true },
    });
  }
}
