import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { SaveRoleDto } from './dto/save-role.dto';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.role.findMany({
      orderBy: { updatedAt: 'desc' },
    });
  }

  async save(payload: SaveRoleDto) {
    if (payload.id) {
      return this.prisma.role.update({
        where: { id: payload.id },
        data: {
          name: payload.name,
          description: payload.description,
          permissions: payload.permissions,
        },
      });
    }

    return this.prisma.role.create({
      data: {
        name: payload.name,
        description: payload.description,
        permissions: payload.permissions,
      },
    });
  }
}
